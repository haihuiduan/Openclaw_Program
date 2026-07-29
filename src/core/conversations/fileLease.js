const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  createSafeError,
  createSafeFileError
} = require("./security");

const FILE_LEASE_BUSY_CODE = "EFILELEASEBUSY";
const FILE_LEASE_MUTATION_GUARD_BUSY_CODE = "EFILELEASEMUTATIONBUSY";
const DEFAULT_MUTATION_GUARD_CORRUPT_GRACE_MS = 30 * 1000;
const DEFAULT_MUTATION_GUARD_WAIT_MS = 10 * 1000;
const DEFAULT_MUTATION_GUARD_RETRY_MS = 10;
const DEFAULT_STATE_LOCK_MAX_AGE_MS = 30 * 1000;
const DEFAULT_STATE_LOCK_WAIT_MS = 10 * 1000;
const DEFAULT_STATE_LOCK_RETRY_MS = 10;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

async function createExclusiveFileLease(
  leasePath,
  value,
  options = {}
) {
  const fileSystem = options.fileSystem || fs;
  const normalize = requireFunction(options.normalize, "normalize");
  const lease = normalize(value);
  const resolved = path.resolve(leasePath);
  return withFileLeaseMutationGuard(
    resolved,
    () => createExclusiveFileLeaseUnlocked(resolved, lease, options),
    { ...options, fileSystem }
  );
}

async function createExclusiveFileLeaseUnlocked(
  resolved,
  lease,
  options = {}
) {
  const fileSystem = options.fileSystem || fs;
  const directory = path.dirname(resolved);
  try {
    await fileSystem.mkdir(directory, { recursive: true, mode: 0o700 });
    if (typeof fileSystem.chmod === "function") {
      await fileSystem.chmod(directory, 0o700);
    }
  } catch (error) {
    throw createSafeFileError(
      options.label || "文件租约",
      "准备",
      error
    );
  }

  let handle = null;
  let ownedIdentity = null;
  let created = false;
  try {
    handle = await fileSystem.open(resolved, "wx", 0o600);
    created = true;
    if (typeof handle.stat === "function") {
      ownedIdentity = await handle.stat();
    }
    await handle.writeFile(JSON.stringify(lease) + "\n", "utf8");
    if (typeof handle.sync === "function") {
      await handle.sync();
    }
    await handle.close();
    handle = null;
    if (typeof fileSystem.chmod === "function") {
      await fileSystem.chmod(resolved, 0o600);
    }
    return { ...lease, leasePath: resolved };
  } catch (error) {
    if (!created && error && error.code === "EEXIST") {
      const busy = new Error(
        options.busyMessage || "文件租约正被其他进程持有。"
      );
      busy.code = FILE_LEASE_BUSY_CODE;
      throw busy;
    }
    if (!created) {
      throw createSafeFileError(
        options.label || "文件租约",
        "创建",
        error
      );
    }
    const cleanupError = await cleanupOwnedFile(
      resolved,
      handle,
      ownedIdentity,
      fileSystem
    );
    if (!cleanupError) {
      throw createSafeFileError(
        options.label || "文件租约",
        "创建",
        error
      );
    }
    throw createSafeError(
      `${options.label || "文件租约"}创建失败，且无法确认本次文件已安全清理（${safeError(error)}；${safeError(cleanupError)}）。`,
      error
    );
  }
}

async function readFileLease(leasePath, options = {}) {
  const fileSystem = options.fileSystem || fs;
  const normalize = requireFunction(options.normalize, "normalize");
  const resolved = path.resolve(leasePath);
  let content;
  try {
    content = await fileSystem.readFile(resolved, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw createSafeFileError(
      options.label || "租约",
      "读取",
      error
    );
  }
  let value;
  try {
    value = JSON.parse(content);
  } catch (error) {
    throw createSafeError(
      `${options.label || "租约"}文件损坏：不是有效 JSON。`,
      error
    );
  }
  try {
    return normalize(value);
  } catch (error) {
    throw createSafeError(
      `${options.label || "租约"}文件结构无效：${error.message}`,
      error
    );
  }
}

async function releaseFileLease(
  leasePath,
  holder,
  options = {}
) {
  const fileSystem = options.fileSystem || fs;
  const matches = requireFunction(options.matches, "matches");
  return withFileLeaseMutationGuard(
    leasePath,
    async () => {
      const lease = await readFileLease(leasePath, options);
      if (!lease || !holder || !matches(lease, holder)) return false;
      try {
        await fileSystem.rm(path.resolve(leasePath), { force: true });
      } catch (error) {
        throw createSafeFileError(
          options.label || "租约",
          "释放",
          error
        );
      }
      return true;
    },
    { ...options, fileSystem }
  );
}

async function clearStaleFileLease(
  leasePath,
  options = {}
) {
  const fileSystem = options.fileSystem || fs;
  return withFileLeaseMutationGuard(
    leasePath,
    async () => {
      const lease = await readFileLease(leasePath, options);
      if (!lease) return { active: false, removed: false, lease: null };
      const now = resolveNow(options.now, options.label || "租约");
      resolvePositiveInteger(
        options.maxAgeMs,
        options.defaultMaxAgeMs,
        `${options.label || "租约"} maxAgeMs`
      );
      const ageMs = now.getTime() - Date.parse(lease.createdAt);
      if (ageMs < 0) {
        throw new Error(
          `${options.label || "租约"} createdAt 不能位于未来：${lease.createdAt}`
        );
      }
      const isProcessAlive = options.isProcessAlive || defaultIsProcessAlive;
      if (isProcessDefinitelyDead(isProcessAlive, lease.pid)) {
        try {
          await fileSystem.rm(path.resolve(leasePath), { force: true });
        } catch (error) {
          throw createSafeFileError(
            options.label || "租约",
            "清理",
            error
          );
        }
        return { active: false, removed: true, lease };
      }
      return { active: true, removed: false, lease };
    },
    { ...options, fileSystem }
  );
}

function resolveFileLeaseMutationGuardPath(leasePath) {
  return path.resolve(leasePath) + ".mutation";
}

async function withFileLeaseMutationGuard(
  leasePath,
  operation,
  options = {}
) {
  requireFunction(operation, "operation");
  const fileSystem = options.fileSystem || fs;
  const guardPath = resolveFileLeaseMutationGuardPath(leasePath);
  const waitMs = resolvePositiveInteger(
    options.mutationGuardWaitMs,
    DEFAULT_MUTATION_GUARD_WAIT_MS,
    "文件租约 mutation guard waitMs"
  );
  const retryMs = resolvePositiveInteger(
    options.mutationGuardRetryMs,
    DEFAULT_MUTATION_GUARD_RETRY_MS,
    "文件租约 mutation guard retryMs"
  );
  const guard = await acquireMutationGuard(
    guardPath,
    fileSystem,
    waitMs,
    retryMs,
    options
  );

  let result;
  let operationError = null;
  try {
    result = await operation();
  } catch (error) {
    operationError = error;
  }

  let releaseError = null;
  try {
    await releaseMutationGuard(guardPath, guard, fileSystem);
  } catch (error) {
    releaseError = error;
  }

  if (operationError && releaseError) {
    const combined = createSafeError(
      `文件租约操作失败：${safeError(operationError)}；释放 mutation guard 失败：${safeError(releaseError)}`,
      operationError
    );
    throw combined;
  }
  if (operationError) throw operationError;
  if (releaseError) throw releaseError;
  return result;
}

async function acquireMutationGuard(
  guardPath,
  fileSystem,
  waitMs,
  retryMs,
  options
) {
  const directory = path.dirname(guardPath);
  try {
    await fileSystem.mkdir(directory, { recursive: true, mode: 0o700 });
    if (typeof fileSystem.chmod === "function") {
      await fileSystem.chmod(directory, 0o700);
    }
  } catch (error) {
    throw mutationGuardOperationError("准备", error);
  }
  const startedAt = Date.now();
  const holder = {
    guardId: `guard-${crypto.randomUUID()}`,
    pid: process.pid,
    createdAt: new Date().toISOString()
  };

  while (true) {
    try {
      return await createMutationGuardFile(guardPath, holder, fileSystem);
    } catch (error) {
      if (!error || error.code !== "EEXIST") throw error;
      const recovered = await recoverStaleMutationGuard(
        guardPath,
        fileSystem,
        options
      );
      if (recovered) continue;
      if (Date.now() - startedAt >= waitMs) {
        const busy = new Error(
          "文件租约 mutation guard 正由其他进程持有，请稍后重试。"
        );
        busy.code = FILE_LEASE_MUTATION_GUARD_BUSY_CODE;
        throw busy;
      }
      await delay(retryMs);
    }
  }
}

async function createMutationGuardFile(guardPath, holder, fileSystem) {
  let handle = null;
  let ownedIdentity = null;
  let created = false;
  try {
    handle = await fileSystem.open(guardPath, "wx", 0o600);
    created = true;
    if (typeof handle.stat === "function") {
      ownedIdentity = await handle.stat();
    }
    await handle.writeFile(JSON.stringify(holder) + "\n", "utf8");
    if (typeof handle.sync === "function") {
      await handle.sync();
    }
    await handle.close();
    handle = null;
    return {
      holder: { ...holder },
      identity: fileIdentity(ownedIdentity)
    };
  } catch (error) {
    if (!created && error && error.code === "EEXIST") throw error;
    if (!created) throw mutationGuardOperationError("创建", error);
    const cleanupError = await cleanupOwnedFile(
      guardPath,
      handle,
      ownedIdentity,
      fileSystem
    );
    if (!cleanupError) throw mutationGuardOperationError("创建", error);
    throw createSafeError(
      "创建 mutation guard 失败，且无法确认本次 guard 已安全清理。",
      error
    );
  }
}

async function releaseMutationGuard(guardPath, guard, fileSystem) {
  const current = await readMutationGuardSnapshot(guardPath, fileSystem);
  if (
    !current ||
    current.kind !== "valid" ||
    !sameMutationGuard(current.holder, guard.holder) ||
    !sameFileIdentity(current.identity, guard.identity)
  ) {
    return false;
  }
  const cleanupError = await cleanupOwnedFile(
    guardPath,
    null,
    guard.identity,
    fileSystem
  );
  if (cleanupError) {
    throw mutationGuardOperationError("释放", cleanupError);
  }
  return true;
}

async function recoverStaleMutationGuard(guardPath, fileSystem, options) {
  const observed = await readMutationGuardSnapshot(guardPath, fileSystem);
  if (!observed) return true;
  if (observed.kind === "changing") return false;

  if (observed.kind === "valid") {
    const isProcessAlive =
      options.mutationGuardIsProcessAlive || defaultIsProcessAlive;
    if (!isProcessDefinitelyDead(isProcessAlive, observed.holder.pid)) {
      return false;
    }
  } else {
    const corruptGraceMs = resolvePositiveInteger(
      options.mutationGuardCorruptGraceMs,
      DEFAULT_MUTATION_GUARD_CORRUPT_GRACE_MS,
      "文件租约 mutation guard corruptGraceMs"
    );
    if (Date.now() - observed.modifiedAtMs < corruptGraceMs) return false;
  }

  const current = await readMutationGuardSnapshot(guardPath, fileSystem);
  if (!sameMutationGuardSnapshot(current, observed)) return false;
  const cleanupError = await cleanupOwnedFile(
    guardPath,
    null,
    observed.identity,
    fileSystem
  );
  if (cleanupError) {
    throw mutationGuardOperationError("恢复", cleanupError);
  }
  return true;
}

async function readMutationGuardSnapshot(guardPath, fileSystem) {
  let before;
  let content;
  let after;
  try {
    before = await fileSystem.lstat(guardPath);
    content = await fileSystem.readFile(guardPath, "utf8");
    after = await fileSystem.lstat(guardPath);
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw mutationGuardOperationError("读取", error);
  }
  if (!sameFileIdentity(fileIdentity(before), fileIdentity(after))) {
    return { kind: "changing" };
  }

  const identity = fileIdentity(after);
  try {
    return {
      kind: "valid",
      holder: normalizeMutationGuard(JSON.parse(content)),
      identity
    };
  } catch (error) {
    return {
      kind: "corrupt",
      contentHash: crypto.createHash("sha256").update(content).digest("hex"),
      identity,
      modifiedAtMs: after.mtimeMs
    };
  }
}

function normalizeMutationGuard(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("mutation guard 必须是 JSON 对象");
  }
  assertExactFields(value, ["guardId", "pid", "createdAt"], "mutation guard");
  if (
    typeof value.guardId !== "string" ||
    !/^guard-[0-9a-f-]{36}$/.test(value.guardId)
  ) {
    throw new Error("mutation guard guardId 无效");
  }
  return {
    guardId: value.guardId,
    pid: positiveInteger(value.pid, "mutation guard pid"),
    createdAt: isoTimestamp(value.createdAt, "mutation guard createdAt")
  };
}

function sameMutationGuard(left, right) {
  return Boolean(
    left &&
    right &&
    left.guardId === right.guardId &&
    left.pid === right.pid &&
    left.createdAt === right.createdAt
  );
}

function sameMutationGuardSnapshot(left, right) {
  if (!left || !right || left.kind !== right.kind) return false;
  if (!sameFileIdentity(left.identity, right.identity)) return false;
  if (left.kind === "valid") {
    return sameMutationGuard(left.holder, right.holder);
  }
  return left.kind === "corrupt" && left.contentHash === right.contentHash;
}

function fileIdentity(stat) {
  if (!stat) return null;
  return {
    dev: stat.dev,
    ino: stat.ino
  };
}

function sameFileIdentity(left, right) {
  return Boolean(
    left &&
    right &&
    left.dev === right.dev &&
    left.ino === right.ino
  );
}

function mutationGuardOperationError(action, error) {
  return createSafeError(
    `无法安全${action}文件租约 mutation guard。`,
    error
  );
}

async function withStateFileLock(lockPath, operation, options = {}) {
  requireFunction(operation, "operation");
  const now = options.now || (() => new Date());
  const holder = {
    operationId: `state-${crypto.randomUUID()}`,
    pid: process.pid,
    createdAt: resolveNow(now, "State 写锁").toISOString()
  };
  const leaseOptions = {
    fileSystem: options.fileSystem,
    normalize: normalizeStateWriteLease,
    label: "State 写锁",
    matches: sameStateWriteLease,
    busyMessage: "State 正由其他进程更新，请稍后重试。"
  };
  const maxAgeMs =
    options.maxAgeMs === undefined
      ? DEFAULT_STATE_LOCK_MAX_AGE_MS
      : options.maxAgeMs;
  const waitMs =
    options.waitMs === undefined ? DEFAULT_STATE_LOCK_WAIT_MS : options.waitMs;
  const retryMs =
    options.retryMs === undefined
      ? DEFAULT_STATE_LOCK_RETRY_MS
      : options.retryMs;
  resolvePositiveInteger(maxAgeMs, null, "State 写锁 maxAgeMs");
  resolvePositiveInteger(waitMs, null, "State 写锁 waitMs");
  resolvePositiveInteger(retryMs, null, "State 写锁 retryMs");
  const startedAt = Date.now();

  while (true) {
    try {
      await createExclusiveFileLease(lockPath, holder, leaseOptions);
      break;
    } catch (error) {
      if (!isFileLeaseBusyError(error)) throw error;
      let stale;
      try {
        stale = await clearStaleFileLease(lockPath, {
          ...leaseOptions,
          now,
          maxAgeMs,
          defaultMaxAgeMs: DEFAULT_STATE_LOCK_MAX_AGE_MS,
          isProcessAlive: options.isProcessAlive
        });
      } catch (readError) {
        if (
          !/文件不是有效 JSON/.test(readError.message) ||
          Date.now() - startedAt >= waitMs
        ) {
          throw readError;
        }
        await delay(retryMs);
        continue;
      }
      if (stale.removed) continue;
      if (Date.now() - startedAt >= waitMs) throw error;
      await delay(retryMs);
    }
  }

  try {
    return await operation();
  } finally {
    await releaseFileLease(lockPath, holder, leaseOptions);
  }
}

function normalizeStateWriteLease(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("State 写锁必须是 JSON 对象");
  }
  assertExactFields(value, ["operationId", "pid", "createdAt"], "State 写锁");
  if (
    typeof value.operationId !== "string" ||
    !/^state-[0-9a-f-]{36}$/.test(value.operationId)
  ) {
    throw new Error("State 写锁 operationId 无效");
  }
  return {
    operationId: value.operationId,
    pid: positiveInteger(value.pid, "State 写锁 pid"),
    createdAt: isoTimestamp(value.createdAt, "State 写锁 createdAt")
  };
}

function sameStateWriteLease(left, right) {
  return left.operationId === right.operationId &&
    left.pid === right.pid &&
    left.createdAt === right.createdAt;
}

function assertExactFields(value, allowedFields, label) {
  const allowed = new Set(allowedFields);
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      throw new Error(`${label}包含未知字段：${field}`);
    }
  }
  for (const field of allowedFields) {
    if (!Object.hasOwn(value, field)) {
      throw new Error(`${label}缺少字段：${field}`);
    }
  }
}

function isoTimestamp(value, field) {
  if (
    typeof value !== "string" ||
    !ISO_TIMESTAMP_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new Error(field + " 必须是有效 ISO-8601 时间");
  }
  return value;
}

function positiveInteger(value, field) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(field + " 必须是正整数");
  }
  return value;
}

async function cleanupOwnedFile(
  resolved,
  handle,
  ownedIdentity,
  fileSystem
) {
  const failures = [];
  if (handle) {
    try {
      await handle.close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (!ownedIdentity || typeof fileSystem.lstat !== "function") {
    return failures[0] || new Error("无法确认锁文件仍属于本次调用");
  }
  try {
    const current = await fileSystem.lstat(resolved);
    if (
      current.dev !== ownedIdentity.dev ||
      current.ino !== ownedIdentity.ino
    ) {
      return failures[0] || new Error("锁文件已被其他进程替换");
    }
    await fileSystem.rm(resolved, { force: true });
  } catch (error) {
    if (!error || error.code !== "ENOENT") failures.push(error);
  }
  return failures[0] || null;
}

function isFileLeaseBusyError(error) {
  return Boolean(error && error.code === FILE_LEASE_BUSY_CODE);
}

function resolveNow(now, label) {
  const value = typeof now === "function" ? now() : now || new Date();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(label + " now 必须返回有效 Date");
  }
  return value;
}

function resolvePositiveInteger(value, fallback, field) {
  const resolved = value === undefined ? fallback : value;
  if (!Number.isInteger(resolved) || resolved <= 0) {
    throw new Error(field + " 必须是正整数");
  }
  return resolved;
}

function defaultIsProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error && error.code === "ESRCH");
  }
}

function isProcessDefinitelyDead(isProcessAlive, pid) {
  try {
    return isProcessAlive(pid) === false;
  } catch (error) {
    return false;
  }
}

function requireFunction(value, field) {
  if (typeof value !== "function") {
    throw new TypeError(field + " 必须是函数");
  }
  return value;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function safeError(error) {
  if (!error) return "未知错误";
  const code = typeof error.code === "string" ? ` [${error.code}]` : "";
  return `文件操作失败${code}`;
}

module.exports = {
  DEFAULT_MUTATION_GUARD_CORRUPT_GRACE_MS,
  DEFAULT_MUTATION_GUARD_RETRY_MS,
  DEFAULT_MUTATION_GUARD_WAIT_MS,
  DEFAULT_STATE_LOCK_MAX_AGE_MS,
  DEFAULT_STATE_LOCK_RETRY_MS,
  DEFAULT_STATE_LOCK_WAIT_MS,
  FILE_LEASE_BUSY_CODE,
  FILE_LEASE_MUTATION_GUARD_BUSY_CODE,
  assertExactFields,
  clearStaleFileLease,
  createExclusiveFileLease,
  defaultIsProcessAlive,
  isFileLeaseBusyError,
  isoTimestamp,
  positiveInteger,
  readFileLease,
  releaseFileLease,
  resolveFileLeaseMutationGuardPath,
  withFileLeaseMutationGuard,
  withStateFileLock
};
