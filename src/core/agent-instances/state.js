const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { assertInstanceId } = require("./id");
const { ROLE_ID_PATTERN } = require("../roles/validator");

const INSTANCE_STATE_SCHEMA_VERSION = 1;
const INSTANCE_STATUSES = new Set(["registered", "missing", "drifted"]);
const DRIFT_REASONS = new Set(["missing", "workspace", "agent-dir"]);
const stateLocks = new Map();

function createEmptyInstanceState() {
  return {
    schemaVersion: INSTANCE_STATE_SCHEMA_VERSION,
    instances: {}
  };
}

async function readInstanceState(statePath) {
  let content;
  try {
    content = await fs.readFile(statePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return createEmptyInstanceState();
    }
    throw error;
  }

  let state;
  try {
    state = JSON.parse(content);
  } catch (error) {
    throw new Error("Agent Instance 状态文件不是有效 JSON：" + statePath);
  }

  try {
    return normalizeInstanceState(state);
  } catch (error) {
    throw new Error(`Agent Instance 状态文件结构无效：${statePath}（${error.message}）`);
  }
}

async function writeInstanceState(statePath, state) {
  return withStateLock(statePath, async () => {
    const normalized = normalizeInstanceState(state);
    await writeInstanceStateUnlocked(statePath, normalized);
    return clone(normalized);
  });
}

async function updateInstanceState(statePath, updater) {
  if (typeof updater !== "function") {
    throw new TypeError("Agent Instance 状态更新器必须是函数。");
  }

  return withStateLock(statePath, async () => {
    const current = await readInstanceState(statePath);
    const draft = clone(current);
    const updated = await updater(draft);
    const normalized = normalizeInstanceState(updated === undefined ? draft : updated);
    await writeInstanceStateUnlocked(statePath, normalized);
    return clone(normalized);
  });
}

async function writeInstanceStateUnlocked(statePath, state) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const temporaryPath = statePath + `.tmp-${process.pid}-${crypto.randomUUID()}`;
  const content = JSON.stringify(state, null, 2) + "\n";

  try {
    await fs.writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporaryPath, statePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

function getInstanceState(state, instanceId) {
  const normalized = normalizeInstanceState(state);
  return normalized.instances[instanceId] ? clone(normalized.instances[instanceId]) : null;
}

function listInstanceStates(state) {
  const normalized = normalizeInstanceState(state);
  return Object.values(normalized.instances)
    .sort((left, right) => left.instanceId.localeCompare(right.instanceId))
    .map(clone);
}

function normalizeInstanceState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("state 必须是 JSON 对象");
  }
  if (state.schemaVersion !== INSTANCE_STATE_SCHEMA_VERSION) {
    throw new Error(`schemaVersion 必须为 ${INSTANCE_STATE_SCHEMA_VERSION}`);
  }
  if (!state.instances || typeof state.instances !== "object" || Array.isArray(state.instances)) {
    throw new Error("instances 必须是 JSON 对象");
  }

  const instances = {};
  const roleAgentOwners = new Map();
  const workspaceOwners = new Map();
  const agentDirOwners = new Map();
  for (const [instanceId, record] of Object.entries(state.instances)) {
    const normalized = normalizeInstanceRecord(instanceId, record);
    assertUniqueOwnership(
      roleAgentOwners,
      `${normalized.roleId}\0${normalized.roleAgentId}`,
      instanceId,
      "Role Agent"
    );
    assertUniqueOwnership(
      workspaceOwners,
      normalized.workspacePath,
      instanceId,
      "workspace"
    );
    assertUniqueOwnership(
      agentDirOwners,
      normalized.agentDir,
      instanceId,
      "agentDir"
    );
    instances[instanceId] = normalized;
  }
  return { schemaVersion: INSTANCE_STATE_SCHEMA_VERSION, instances };
}

function assertUniqueOwnership(owners, value, instanceId, label) {
  const existing = owners.get(value);
  if (existing) {
    throw new Error(`${label} 不能由多个 Agent Instance 共用：${existing}, ${instanceId}`);
  }
  owners.set(value, instanceId);
}

function normalizeInstanceRecord(instanceId, record) {
  assertInstanceId(instanceId);
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("Agent Instance 记录必须是 JSON 对象：" + instanceId);
  }

  const normalized = {
    instanceId: assertInstanceId(requiredText(record.instanceId, "instanceId")),
    roleId: requiredId(record.roleId, "roleId"),
    roleVersion: requiredText(record.roleVersion, "roleVersion"),
    roleAgentId: requiredId(record.roleAgentId, "roleAgentId"),
    workspacePath: requiredAbsolutePath(record.workspacePath, "workspacePath"),
    agentDir: requiredAbsolutePath(record.agentDir, "agentDir"),
    status: requiredText(record.status, "status"),
    registeredAt: requiredTimestamp(record.registeredAt, "registeredAt"),
    updatedAt: requiredTimestamp(record.updatedAt, "updatedAt"),
    lastReconciledAt: requiredTimestamp(record.lastReconciledAt, "lastReconciledAt"),
    drift: normalizeDrift(record.drift)
  };

  if (normalized.instanceId !== instanceId) {
    throw new Error(`Agent Instance 记录 key 与 instanceId 不一致：${instanceId}`);
  }
  if (!INSTANCE_STATUSES.has(normalized.status)) {
    throw new Error("Agent Instance status 无效：" + normalized.status);
  }
  if (normalized.status === "registered" && normalized.drift.length !== 0) {
    throw new Error("registered 状态不能包含 drift：" + instanceId);
  }
  if (normalized.status === "missing" && normalized.drift.join(",") !== "missing") {
    throw new Error("missing 状态必须且只能包含 missing drift：" + instanceId);
  }
  if (normalized.status === "drifted" && (
    normalized.drift.length === 0 || normalized.drift.includes("missing")
  )) {
    throw new Error("drifted 状态必须包含配置漂移且不能包含 missing：" + instanceId);
  }
  return normalized;
}

function normalizeDrift(drift) {
  if (!Array.isArray(drift)) {
    throw new Error("drift 必须是数组");
  }
  const normalized = [...new Set(drift.map((value) => requiredText(value, "drift")))].sort();
  for (const value of normalized) {
    if (!DRIFT_REASONS.has(value)) {
      throw new Error("未知 drift 类型：" + value);
    }
  }
  return normalized;
}

function requiredId(value, field) {
  const normalized = requiredText(value, field);
  if (!ROLE_ID_PATTERN.test(normalized) || normalized === "main") {
    throw new Error(field + " 无效：" + normalized);
  }
  return normalized;
}

function requiredText(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(field + " 必须是非空字符串");
  }
  return value.trim();
}

function requiredTimestamp(value, field) {
  const normalized = requiredText(value, field);
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new Error(field + " 必须是有效时间");
  }
  return normalized;
}

function requiredAbsolutePath(value, field) {
  const normalized = requiredText(value, field);
  if (!path.isAbsolute(normalized)) {
    throw new Error(field + " 必须是绝对路径");
  }
  return path.resolve(normalized);
}

function withStateLock(statePath, operation) {
  const key = path.resolve(statePath);
  const previous = stateLocks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  const tail = current.catch(() => {});
  stateLocks.set(key, tail);

  return current.finally(() => {
    if (stateLocks.get(key) === tail) {
      stateLocks.delete(key);
    }
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  INSTANCE_STATE_SCHEMA_VERSION,
  createEmptyInstanceState,
  getInstanceState,
  listInstanceStates,
  readInstanceState,
  updateInstanceState,
  writeInstanceState
};
