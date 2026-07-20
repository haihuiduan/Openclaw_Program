const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { ROLE_ID_PATTERN } = require("./validator");

const ROLE_STATE_SCHEMA_VERSION = 1;
const stateLocks = new Map();

function createEmptyRoleState() {
  return {
    schemaVersion: ROLE_STATE_SCHEMA_VERSION,
    roles: {}
  };
}

async function readRoleState(statePath) {
  let content;
  try {
    content = await fs.readFile(statePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return createEmptyRoleState();
    }
    throw error;
  }

  let state;
  try {
    state = JSON.parse(content);
  } catch (error) {
    throw new Error("角色状态文件不是有效 JSON：" + statePath);
  }

  try {
    return normalizeRoleState(state);
  } catch (error) {
    throw new Error(`角色状态文件结构无效：${statePath}（${error.message}）`);
  }
}

async function writeRoleState(statePath, state) {
  return withStateLock(statePath, async () => {
    const normalized = normalizeRoleState(state);
    await writeRoleStateUnlocked(statePath, normalized);
    return clone(normalized);
  });
}

async function updateRoleState(statePath, updater) {
  if (typeof updater !== "function") {
    throw new TypeError("角色状态更新器必须是函数。");
  }

  return withStateLock(statePath, async () => {
    const current = await readRoleState(statePath);
    const draft = clone(current);
    const updated = await updater(draft);
    const normalized = normalizeRoleState(updated === undefined ? draft : updated);
    await writeRoleStateUnlocked(statePath, normalized);
    return clone(normalized);
  });
}

async function writeRoleStateUnlocked(statePath, state) {
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

function getRoleState(state, roleId) {
  const normalized = normalizeRoleState(state);
  return normalized.roles[roleId] ? clone(normalized.roles[roleId]) : null;
}

function listRoleStates(state) {
  const normalized = normalizeRoleState(state);
  return Object.values(normalized.roles)
    .sort((left, right) => left.roleId.localeCompare(right.roleId))
    .map(clone);
}

function normalizeRoleState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("state 必须是 JSON 对象");
  }
  if (state.schemaVersion !== ROLE_STATE_SCHEMA_VERSION) {
    throw new Error(`schemaVersion 必须为 ${ROLE_STATE_SCHEMA_VERSION}`);
  }
  if (!state.roles || typeof state.roles !== "object" || Array.isArray(state.roles)) {
    throw new Error("roles 必须是 JSON 对象");
  }

  const roles = {};
  for (const [roleId, record] of Object.entries(state.roles)) {
    roles[roleId] = normalizeRoleRecord(roleId, record);
  }
  return { schemaVersion: ROLE_STATE_SCHEMA_VERSION, roles };
}

function normalizeRoleRecord(roleId, record) {
  if (!ROLE_ID_PATTERN.test(roleId) || roleId === "main") {
    throw new Error("roleId 无效：" + roleId);
  }
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("角色记录必须是 JSON 对象：" + roleId);
  }

  const normalized = {
    roleId: requiredText(record.roleId, "roleId"),
    roleName: requiredText(record.roleName, "roleName"),
    roleVersion: requiredText(record.roleVersion, "roleVersion"),
    status: requiredText(record.status, "status"),
    installedAt: requiredText(record.installedAt, "installedAt"),
    updatedAt: requiredText(record.updatedAt, "updatedAt"),
    enabled: record.enabled === true,
    workspacePath: requiredAbsolutePath(record.workspacePath, "workspacePath"),
    sourceRolePath: requiredAbsolutePath(record.sourceRolePath, "sourceRolePath"),
    agents: normalizeAgents(record.agents, roleId)
  };

  if (normalized.roleId !== roleId) {
    throw new Error(`角色记录 key 与 roleId 不一致：${roleId}`);
  }
  if (normalized.status !== "installed") {
    throw new Error("角色 status 仅支持 installed：" + roleId);
  }
  return normalized;
}

function normalizeAgents(agents, roleId) {
  if (!Array.isArray(agents) || agents.length === 0) {
    throw new Error("角色 agents 必须是非空数组：" + roleId);
  }

  const ids = new Set();
  return agents.map((agent) => {
    if (!agent || typeof agent !== "object" || Array.isArray(agent)) {
      throw new Error("Agent 状态必须是 JSON 对象：" + roleId);
    }
    const agentId = requiredText(agent.agentId, "agentId");
    if (!ROLE_ID_PATTERN.test(agentId) || agentId === "main") {
      throw new Error("Agent 状态 id 无效：" + agentId);
    }
    if (ids.has(agentId)) {
      throw new Error("Agent 状态 id 重复：" + agentId);
    }
    ids.add(agentId);

    const contentDigest = requiredText(agent.contentDigest, "contentDigest");
    if (!/^[a-f0-9]{64}$/.test(contentDigest)) {
      throw new Error("Agent contentDigest 无效：" + agentId);
    }

    return {
      agentId,
      workspacePath: requiredAbsolutePath(agent.workspacePath, "agent workspacePath"),
      contentDigest
    };
  });
}

function requiredText(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(field + " 必须是非空字符串");
  }
  return value.trim();
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
  ROLE_STATE_SCHEMA_VERSION,
  createEmptyRoleState,
  getRoleState,
  listRoleStates,
  readRoleState,
  updateRoleState,
  writeRoleState
};
