const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { assertTeamId } = require("../teams/id");
const { assertProjectId } = require("./id");
const { normalizeConcurrency, normalizeTeamSnapshot } = require("./teamSnapshot");

const PROJECT_STATE_SCHEMA_VERSION = 1;
const DEFAULT_PROJECT_STATE_PATH = path.join(
  os.homedir(), ".openclaw-installer", "projects", "state.json"
);
const PROJECT_STATUSES = new Set(["draft", "active", "completed"]);
const EXECUTION_MODES = new Set(["confirm", "auto"]);
const stateLocks = new Map();

function createEmptyProjectState() {
  return { schemaVersion: PROJECT_STATE_SCHEMA_VERSION, projects: {} };
}

async function readProjectState(statePath) {
  let content;
  try {
    content = await fs.readFile(statePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return createEmptyProjectState();
    throw error;
  }
  let state;
  try {
    state = JSON.parse(content);
  } catch (error) {
    throw new Error("Project 状态文件不是有效 JSON：" + statePath);
  }
  try {
    return normalizeProjectState(state);
  } catch (error) {
    throw new Error(`Project 状态文件结构无效：${statePath}（${error.message}）`);
  }
}

async function writeProjectState(statePath, state) {
  return withStateLock(statePath, async () => {
    const normalized = normalizeProjectState(state);
    await writeUnlocked(statePath, normalized);
    return clone(normalized);
  });
}

async function updateProjectState(statePath, updater) {
  if (typeof updater !== "function") throw new TypeError("Project 状态更新器必须是函数。");
  return withStateLock(statePath, async () => {
    const current = await readProjectState(statePath);
    const draft = clone(current);
    const result = await updater(draft);
    const normalized = normalizeProjectState(result === undefined ? draft : result);
    await writeUnlocked(statePath, normalized);
    return clone(normalized);
  });
}

async function writeUnlocked(statePath, state) {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(state, null, 2) + "\n", {
      encoding: "utf8", mode: 0o600
    });
    await fs.rename(temporaryPath, statePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

function getProjectState(state, projectId) {
  const normalized = normalizeProjectState(state);
  return normalized.projects[projectId] ? clone(normalized.projects[projectId]) : null;
}

function listProjectStates(state) {
  return Object.values(normalizeProjectState(state).projects)
    .sort((left, right) => left.projectId.localeCompare(right.projectId)).map(clone);
}

function normalizeProjectState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("state 必须是 JSON 对象");
  }
  if (state.schemaVersion !== PROJECT_STATE_SCHEMA_VERSION) {
    throw new Error(`schemaVersion 必须为 ${PROJECT_STATE_SCHEMA_VERSION}`);
  }
  if (!state.projects || typeof state.projects !== "object" || Array.isArray(state.projects)) {
    throw new Error("projects 必须是 JSON 对象");
  }
  const projects = {};
  for (const projectId of Object.keys(state.projects).sort()) {
    projects[projectId] = normalizeProjectRecord(projectId, state.projects[projectId]);
  }
  return { schemaVersion: PROJECT_STATE_SCHEMA_VERSION, projects };
}

function normalizeProjectRecord(projectId, record) {
  assertProjectId(projectId);
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("Project 记录必须是 JSON 对象：" + projectId);
  }
  const normalized = {
    projectId: assertProjectId(requiredText(record.projectId, "projectId")),
    name: boundedText(record.name, "name", 100, false),
    description: boundedText(record.description, "description", 1000, true),
    teamId: assertTeamId(requiredText(record.teamId, "teamId")),
    teamSnapshot: normalizeTeamSnapshot(record.teamSnapshot),
    status: requiredText(record.status, "status"),
    executionMode: requiredText(record.executionMode, "executionMode"),
    maxConcurrency: normalizeConcurrency(record.maxConcurrency),
    createdAt: requiredTimestamp(record.createdAt, "createdAt"),
    updatedAt: requiredTimestamp(record.updatedAt, "updatedAt"),
    completedAt: optionalTimestamp(record.completedAt, "completedAt"),
    archivedAt: optionalTimestamp(record.archivedAt, "archivedAt")
  };
  if (normalized.projectId !== projectId) throw new Error("Project key 与 projectId 不一致：" + projectId);
  if (!PROJECT_STATUSES.has(normalized.status)) throw new Error("Project status 无效：" + normalized.status);
  if (!EXECUTION_MODES.has(normalized.executionMode)) throw new Error("executionMode 必须是 confirm 或 auto");
  if ((normalized.status === "completed") !== (normalized.completedAt !== null)) {
    throw new Error("completedAt 必须且只能在 completed 状态存在");
  }
  return normalized;
}

function boundedText(value, field, maximum, allowEmpty) {
  if (typeof value !== "string") throw new Error(field + " 必须是字符串");
  const normalized = value.trim();
  if (!allowEmpty && !normalized) throw new Error(field + " 必须是非空字符串");
  if (normalized.length > maximum) throw new Error(`${field} 不能超过 ${maximum} 个字符`);
  return normalized;
}
function requiredText(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(field + " 必须是非空字符串");
  return value.trim();
}
function requiredTimestamp(value, field) {
  const normalized = requiredText(value, field);
  if (!Number.isFinite(Date.parse(normalized))) throw new Error(field + " 必须是有效时间");
  return normalized;
}
function optionalTimestamp(value, field) {
  return value === null ? null : requiredTimestamp(value, field);
}
function withStateLock(statePath, operation) {
  const key = path.resolve(statePath);
  const previous = stateLocks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  const tail = current.catch(() => {});
  stateLocks.set(key, tail);
  return current.finally(() => { if (stateLocks.get(key) === tail) stateLocks.delete(key); });
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }

module.exports = {
  DEFAULT_PROJECT_STATE_PATH,
  PROJECT_STATE_SCHEMA_VERSION,
  createEmptyProjectState,
  getProjectState,
  listProjectStates,
  readProjectState,
  updateProjectState,
  writeProjectState
};
