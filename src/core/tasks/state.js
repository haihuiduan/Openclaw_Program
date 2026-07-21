const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { assertInstanceId } = require("../agent-instances/id");
const { assertProjectId } = require("../projects/id");
const { assertTaskId } = require("./id");

const TASK_STATE_SCHEMA_VERSION = 1;
const DEFAULT_TASK_STATE_PATH = path.join(os.homedir(), ".openclaw-installer", "tasks", "state.json");
const TASK_SOURCES = new Set(["user", "manager"]);
const TASK_STATUSES = new Set(["pending", "completed", "cancelled"]);
const TASK_PRIORITIES = new Set(["low", "medium", "high"]);
const FAILURE_POLICIES = new Set(["continue", "pause-dependents", "pause-project"]);
const stateLocks = new Map();

function createEmptyTaskState() { return { schemaVersion: TASK_STATE_SCHEMA_VERSION, tasks: {} }; }

async function readTaskState(statePath) {
  let content;
  try { content = await fs.readFile(statePath, "utf8"); }
  catch (error) {
    if (error && error.code === "ENOENT") return createEmptyTaskState();
    throw error;
  }
  let state;
  try { state = JSON.parse(content); }
  catch (error) { throw new Error("Task 状态文件不是有效 JSON：" + statePath); }
  try { return normalizeTaskState(state); }
  catch (error) { throw new Error(`Task 状态文件结构无效：${statePath}（${error.message}）`); }
}

async function writeTaskState(statePath, state) {
  return withStateLock(statePath, async () => {
    const normalized = normalizeTaskState(state);
    await writeUnlocked(statePath, normalized);
    return clone(normalized);
  });
}

async function updateTaskState(statePath, updater) {
  if (typeof updater !== "function") throw new TypeError("Task 状态更新器必须是函数。");
  return withStateLock(statePath, async () => {
    const current = await readTaskState(statePath);
    const draft = clone(current);
    const result = await updater(draft);
    const normalized = normalizeTaskState(result === undefined ? draft : result);
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

function getTaskState(state, taskId) {
  const normalized = normalizeTaskState(state);
  return normalized.tasks[taskId] ? clone(normalized.tasks[taskId]) : null;
}
function listTaskStates(state) {
  return Object.values(normalizeTaskState(state).tasks)
    .sort((left, right) => left.taskId.localeCompare(right.taskId)).map(clone);
}

function normalizeTaskState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) throw new Error("state 必须是 JSON 对象");
  if (state.schemaVersion !== TASK_STATE_SCHEMA_VERSION) {
    throw new Error(`schemaVersion 必须为 ${TASK_STATE_SCHEMA_VERSION}`);
  }
  if (!state.tasks || typeof state.tasks !== "object" || Array.isArray(state.tasks)) {
    throw new Error("tasks 必须是 JSON 对象");
  }
  const tasks = {};
  for (const taskId of Object.keys(state.tasks).sort()) {
    tasks[taskId] = normalizeTaskRecord(taskId, state.tasks[taskId]);
  }
  return { schemaVersion: TASK_STATE_SCHEMA_VERSION, tasks };
}

function normalizeTaskRecord(taskId, record) {
  assertTaskId(taskId);
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("Task 记录必须是 JSON 对象：" + taskId);
  }
  const critical = normalizeBoolean(record.critical, "critical");
  const normalized = {
    taskId: assertTaskId(requiredText(record.taskId, "taskId")),
    projectId: assertProjectId(requiredText(record.projectId, "projectId")),
    title: boundedText(record.title, "title", 200, false),
    description: boundedText(record.description, "description", 5000, true),
    source: enumValue(record.source, "source", TASK_SOURCES),
    status: enumValue(record.status, "status", TASK_STATUSES),
    priority: enumValue(record.priority, "priority", TASK_PRIORITIES),
    critical,
    criticalReason: critical ? boundedText(record.criticalReason, "criticalReason", 1000, false) : null,
    criticalSource: critical ? enumValue(record.criticalSource, "criticalSource", TASK_SOURCES) : null,
    assignedInstanceId: record.assignedInstanceId === null
      ? null : assertInstanceId(requiredText(record.assignedInstanceId, "assignedInstanceId")),
    dependencies: normalizeDependencies(record.dependencies, taskId),
    failurePolicy: enumValue(record.failurePolicy, "failurePolicy", FAILURE_POLICIES),
    retryPolicy: normalizeRetryPolicy(record.retryPolicy),
    createdAt: requiredTimestamp(record.createdAt, "createdAt"),
    updatedAt: requiredTimestamp(record.updatedAt, "updatedAt"),
    completedAt: optionalTimestamp(record.completedAt, "completedAt"),
    cancelledAt: optionalTimestamp(record.cancelledAt, "cancelledAt")
  };
  if (normalized.taskId !== taskId) throw new Error("Task key 与 taskId 不一致：" + taskId);
  if (!critical && (record.criticalReason !== null || record.criticalSource !== null)) {
    throw new Error("非关键 Task 的 criticalReason 和 criticalSource 必须为 null");
  }
  if ((normalized.status === "completed") !== (normalized.completedAt !== null)) {
    throw new Error("completedAt 必须且只能在 completed 状态存在");
  }
  if ((normalized.status === "cancelled") !== (normalized.cancelledAt !== null)) {
    throw new Error("cancelledAt 必须且只能在 cancelled 状态存在");
  }
  if (normalized.status === "pending" && (normalized.completedAt || normalized.cancelledAt)) {
    throw new Error("pending Task 不能包含关闭时间");
  }
  return normalized;
}

function normalizeDependencies(values, taskId) {
  if (!Array.isArray(values)) throw new Error("dependencies 必须是数组");
  const result = values.map((value) => assertTaskId(requiredText(value, "dependencies")));
  if (result.includes(taskId)) throw new Error("Task 不能依赖自身：" + taskId);
  return [...new Set(result)].sort((left, right) => left.localeCompare(right));
}
function normalizeRetryPolicy(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("retryPolicy 必须是对象");
  if (!Number.isInteger(value.maxRetries) || value.maxRetries < 0 || value.maxRetries > 10) {
    throw new Error("retryPolicy.maxRetries 必须是 0 到 10 之间的整数");
  }
  if (!Number.isInteger(value.retryDelayMs) || value.retryDelayMs < 0 || value.retryDelayMs > 86400000) {
    throw new Error("retryPolicy.retryDelayMs 必须是 0 到 86400000 之间的整数");
  }
  return { maxRetries: value.maxRetries, retryDelayMs: value.retryDelayMs };
}
function enumValue(value, field, allowed) {
  const normalized = requiredText(value, field);
  if (!allowed.has(normalized)) throw new Error(`${field} 无效：${normalized}`);
  return normalized;
}
function normalizeBoolean(value, field) {
  if (typeof value !== "boolean") throw new Error(field + " 必须是布尔值");
  return value;
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
function optionalTimestamp(value, field) { return value === null ? null : requiredTimestamp(value, field); }
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
  DEFAULT_TASK_STATE_PATH,
  FAILURE_POLICIES,
  TASK_PRIORITIES,
  TASK_SOURCES,
  TASK_STATE_SCHEMA_VERSION,
  TASK_STATUSES,
  createEmptyTaskState,
  getTaskState,
  listTaskStates,
  readTaskState,
  updateTaskState,
  writeTaskState
};
