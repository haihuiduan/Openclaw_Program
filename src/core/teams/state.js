const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const { assertInstanceId } = require("../agent-instances/id");
const { assertTeamId } = require("./id");

const TEAM_STATE_SCHEMA_VERSION = 1;
const TEAM_EXECUTION_MODES = new Set(["confirm", "auto"]);
const MAX_TEAM_NAME_LENGTH = 100;
const MAX_TEAM_DESCRIPTION_LENGTH = 1000;
const MIN_TEAM_CONCURRENCY = 1;
const MAX_TEAM_CONCURRENCY = 32;
const stateLocks = new Map();

function createEmptyTeamState() {
  return {
    schemaVersion: TEAM_STATE_SCHEMA_VERSION,
    teams: {}
  };
}

async function readTeamState(statePath) {
  let content;
  try {
    content = await fs.readFile(statePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return createEmptyTeamState();
    }
    throw error;
  }

  let state;
  try {
    state = JSON.parse(content);
  } catch (error) {
    throw new Error("Team 状态文件不是有效 JSON：" + statePath);
  }

  try {
    return normalizeTeamState(state);
  } catch (error) {
    throw new Error(`Team 状态文件结构无效：${statePath}（${error.message}）`);
  }
}

async function writeTeamState(statePath, state) {
  return withStateLock(statePath, async () => {
    const normalized = normalizeTeamState(state);
    await writeTeamStateUnlocked(statePath, normalized);
    return clone(normalized);
  });
}

async function updateTeamState(statePath, updater) {
  if (typeof updater !== "function") {
    throw new TypeError("Team 状态更新器必须是函数。");
  }

  return withStateLock(statePath, async () => {
    const current = await readTeamState(statePath);
    const draft = clone(current);
    const updated = await updater(draft);
    const normalized = normalizeTeamState(updated === undefined ? draft : updated);
    await writeTeamStateUnlocked(statePath, normalized);
    return clone(normalized);
  });
}

async function writeTeamStateUnlocked(statePath, state) {
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

function getTeamState(state, teamId) {
  const normalized = normalizeTeamState(state);
  return normalized.teams[teamId] ? clone(normalized.teams[teamId]) : null;
}

function listTeamStates(state) {
  const normalized = normalizeTeamState(state);
  return Object.values(normalized.teams)
    .sort((left, right) => left.teamId.localeCompare(right.teamId))
    .map(clone);
}

function normalizeTeamState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("state 必须是 JSON 对象");
  }
  if (state.schemaVersion !== TEAM_STATE_SCHEMA_VERSION) {
    throw new Error(`schemaVersion 必须为 ${TEAM_STATE_SCHEMA_VERSION}`);
  }
  if (!state.teams || typeof state.teams !== "object" || Array.isArray(state.teams)) {
    throw new Error("teams 必须是 JSON 对象");
  }

  const teams = {};
  for (const [teamId, record] of Object.entries(state.teams)) {
    teams[teamId] = normalizeTeamRecord(teamId, record);
  }
  return { schemaVersion: TEAM_STATE_SCHEMA_VERSION, teams };
}

function normalizeTeamRecord(teamId, record) {
  assertTeamId(teamId);
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("Team 记录必须是 JSON 对象：" + teamId);
  }

  const normalized = {
    teamId: assertTeamId(requiredText(record.teamId, "teamId")),
    name: boundedText(record.name, "name", MAX_TEAM_NAME_LENGTH, false),
    description: boundedText(record.description, "description", MAX_TEAM_DESCRIPTION_LENGTH, true),
    managerInstanceId: assertInstanceId(requiredText(record.managerInstanceId, "managerInstanceId")),
    memberInstanceIds: normalizeMemberInstanceIds(record.memberInstanceIds),
    executionMode: requiredText(record.executionMode, "executionMode"),
    maxConcurrency: normalizeMaxConcurrency(record.maxConcurrency),
    createdAt: requiredTimestamp(record.createdAt, "createdAt"),
    updatedAt: requiredTimestamp(record.updatedAt, "updatedAt")
  };

  if (normalized.teamId !== teamId) {
    throw new Error(`Team 记录 key 与 teamId 不一致：${teamId}`);
  }
  if (!normalized.memberInstanceIds.includes(normalized.managerInstanceId)) {
    throw new Error("managerInstanceId 必须包含在 memberInstanceIds 中：" + teamId);
  }
  if (!TEAM_EXECUTION_MODES.has(normalized.executionMode)) {
    throw new Error("executionMode 必须是 confirm 或 auto");
  }
  return normalized;
}

function normalizeMemberInstanceIds(memberInstanceIds) {
  if (!Array.isArray(memberInstanceIds) || memberInstanceIds.length === 0) {
    throw new Error("memberInstanceIds 必须是至少包含一个 Instance ID 的数组");
  }
  const normalized = memberInstanceIds.map((instanceId) => (
    assertInstanceId(requiredText(instanceId, "memberInstanceIds"))
  ));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("memberInstanceIds 不能包含重复的 Instance ID");
  }
  return normalized.sort((left, right) => left.localeCompare(right));
}

function normalizeMaxConcurrency(value) {
  if (!Number.isInteger(value) || value < MIN_TEAM_CONCURRENCY || value > MAX_TEAM_CONCURRENCY) {
    throw new Error(
      `maxConcurrency 必须是 ${MIN_TEAM_CONCURRENCY} 到 ${MAX_TEAM_CONCURRENCY} 之间的整数`
    );
  }
  return value;
}

function boundedText(value, field, maxLength, allowEmpty) {
  if (typeof value !== "string") {
    throw new Error(`${field} 必须是字符串`);
  }
  const normalized = value.trim();
  if (!allowEmpty && !normalized) {
    throw new Error(`${field} 必须是非空字符串`);
  }
  if (normalized.length > maxLength) {
    throw new Error(`${field} 不能超过 ${maxLength} 个字符`);
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
  MAX_TEAM_CONCURRENCY,
  MAX_TEAM_DESCRIPTION_LENGTH,
  MAX_TEAM_NAME_LENGTH,
  MIN_TEAM_CONCURRENCY,
  TEAM_STATE_SCHEMA_VERSION,
  createEmptyTeamState,
  getTeamState,
  listTeamStates,
  readTeamState,
  updateTeamState,
  writeTeamState
};
