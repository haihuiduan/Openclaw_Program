const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { AsyncLocalStorage } = require("node:async_hooks");
const { assertRunId } = require("./id");

const DEFAULT_EXECUTION_LEASE_PATH = path.join(
  os.homedir(), ".openclaw-installer", "executions", "active.lock"
);
const DEFAULT_EXECUTION_LEASE_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const processLocks = new Map();
const heldLocks = new AsyncLocalStorage();

function withExecutionLocks(keys, operation) {
  const alreadyHeld = heldLocks.getStore() || new Set();
  const normalized = ["global", ...Object.entries(keys || {})
    .filter(([, value]) => typeof value === "string" && value)
    .map(([name, value]) => `${name}:${value}`)]
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort()
    .filter((key) => !alreadyHeld.has(key));

  function acquire(index) {
    if (index >= normalized.length) return operation();
    return withProcessLock(normalized[index], () => acquire(index + 1));
  }
  const nextHeld = new Set([...alreadyHeld, ...normalized]);
  return heldLocks.run(nextHeld, () => acquire(0));
}

function withProcessLock(key, operation) {
  const previous = processLocks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  const tail = current.catch(() => {});
  processLocks.set(key, tail);
  return current.finally(() => { if (processLocks.get(key) === tail) processLocks.delete(key); });
}

async function acquireExecutionLease(leasePath, metadata, options = {}) {
  const fileSystem = options.fileSystem || fs;
  const resolved = path.resolve(leasePath);
  const lease = normalizeExecutionLease({
    runId: metadata && metadata.runId,
    pid: metadata && metadata.pid,
    createdAt: metadata && metadata.createdAt
  });
  await fileSystem.mkdir(path.dirname(resolved), { recursive: true, mode: 0o700 });
  let handle;
  try {
    handle = await fileSystem.open(resolved, "wx", 0o600);
    await handle.writeFile(JSON.stringify(lease) + "\n", "utf8");
    await handle.close();
    handle = null;
    return { ...lease, leasePath: resolved };
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    if (error && error.code === "EEXIST") {
      throw new Error("已有其他前台 Execution 正在运行，当前版本只支持全局串行执行。");
    }
    throw error;
  }
}

async function readExecutionLease(leasePath, options = {}) {
  const fileSystem = options.fileSystem || fs;
  const resolved = path.resolve(leasePath);
  let content;
  try {
    content = await fileSystem.readFile(resolved, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }
  let value;
  try {
    value = JSON.parse(content);
  } catch (error) {
    throw new Error("Execution 租约文件不是有效 JSON：" + resolved);
  }
  try {
    return normalizeExecutionLease(value);
  } catch (error) {
    throw new Error(`Execution 租约文件结构无效：${resolved}（${error.message}）`);
  }
}

async function releaseExecutionLease(leasePath, runId, options = {}) {
  const fileSystem = options.fileSystem || fs;
  const lease = await readExecutionLease(leasePath, { fileSystem });
  if (!lease) {
    await fileSystem.rm(path.resolve(leasePath), { force: true }).catch(() => {});
    return false;
  }
  if (lease.runId !== runId) return false;
  await fileSystem.rm(path.resolve(leasePath), { force: true });
  return true;
}

async function clearStaleExecutionLease(leasePath, options = {}) {
  const fileSystem = options.fileSystem || fs;
  const isProcessAlive = options.isProcessAlive || defaultIsProcessAlive;
  const lease = await readExecutionLease(leasePath, { fileSystem });
  if (!lease) {
    await fileSystem.rm(path.resolve(leasePath), { force: true }).catch(() => {});
    return { active: false, removed: false, lease: null };
  }
  const now = resolveNow(options.now);
  const maxAgeMs = resolveMaxAge(options.maxAgeMs);
  const ageMs = now.getTime() - Date.parse(lease.createdAt);
  if (ageMs < 0) {
    throw new Error("Execution 租约 createdAt 不能位于未来：" + lease.createdAt);
  }
  if (ageMs >= maxAgeMs) {
    await fileSystem.rm(path.resolve(leasePath), { force: true });
    return { active: false, removed: true, lease };
  }
  if (isProcessAlive(lease.pid)) return { active: true, removed: false, lease };
  await fileSystem.rm(path.resolve(leasePath), { force: true });
  return { active: false, removed: true, lease };
}

function normalizeExecutionLease(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("租约必须是 JSON 对象");
  }
  const allowed = new Set(["runId", "pid", "createdAt"]);
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) throw new Error("租约包含未知字段：" + field);
  }
  const runId = assertRunId(value.runId);
  if (!Number.isInteger(value.pid) || value.pid <= 0) {
    throw new Error("租约 pid 必须是正整数");
  }
  if (typeof value.createdAt !== "string" || !value.createdAt.trim()) {
    throw new Error("租约 createdAt 必须是非空 ISO-8601 字符串");
  }
  const createdAt = value.createdAt.trim();
  if (!ISO_TIMESTAMP_PATTERN.test(createdAt) || !Number.isFinite(Date.parse(createdAt))) {
    throw new Error("租约 createdAt 必须是有效 ISO-8601 时间");
  }
  return { runId, pid: value.pid, createdAt };
}

function resolveNow(now) {
  const value = typeof now === "function" ? now() : (now || new Date());
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("Execution 租约 now 必须返回有效 Date");
  }
  return value;
}

function resolveMaxAge(maxAgeMs) {
  const value = maxAgeMs === undefined ? DEFAULT_EXECUTION_LEASE_MAX_AGE_MS : maxAgeMs;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error("Execution 租约 maxAgeMs 必须是正整数");
  }
  return value;
}

function defaultIsProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && error.code === "EPERM");
  }
}

module.exports = {
  DEFAULT_EXECUTION_LEASE_MAX_AGE_MS,
  DEFAULT_EXECUTION_LEASE_PATH,
  acquireExecutionLease,
  clearStaleExecutionLease,
  readExecutionLease,
  releaseExecutionLease,
  withExecutionLocks
};
