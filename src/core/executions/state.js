const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { assertInstanceId } = require("../agent-instances/id");
const { assertProjectId } = require("../projects/id");
const { assertTaskId } = require("../tasks/id");
const { assertTeamId } = require("../teams/id");
const { assertRunId } = require("./id");

const EXECUTION_STATE_SCHEMA_VERSION = 1;
const DEFAULT_EXECUTION_DATA_DIRECTORY = path.join(os.homedir(), ".openclaw-installer", "executions");
const DEFAULT_EXECUTION_STATE_PATH = path.join(DEFAULT_EXECUTION_DATA_DIRECTORY, "state.json");
const RUN_STATUSES = new Set([
  "pending", "starting", "running", "completed", "failed", "interrupted", "cancelled"
]);
const ACTIVE_RUN_STATUSES = new Set(["pending", "starting", "running"]);
const RUN_TRIGGERS = new Set(["user", "retry"]);
const TASK_SYNC_STATUSES = new Set(["none", "pending", "applied", "failed"]);
const stateLocks = new Map();

function createEmptyExecutionState() {
  return { schemaVersion: EXECUTION_STATE_SCHEMA_VERSION, runs: {} };
}

async function readExecutionState(statePath) {
  let content;
  try {
    content = await fs.readFile(statePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return createEmptyExecutionState();
    throw error;
  }
  let state;
  try {
    state = JSON.parse(content);
  } catch (error) {
    throw new Error("Execution 状态文件不是有效 JSON：" + statePath);
  }
  try {
    return normalizeExecutionState(state);
  } catch (error) {
    throw new Error(`Execution 状态文件结构无效：${statePath}（${error.message}）`);
  }
}

async function writeExecutionState(statePath, state) {
  return withStateLock(statePath, async () => {
    const normalized = normalizeExecutionState(state);
    await writeUnlocked(statePath, normalized);
    return clone(normalized);
  });
}

async function updateExecutionState(statePath, updater) {
  if (typeof updater !== "function") throw new TypeError("Execution 状态更新器必须是函数。");
  return withStateLock(statePath, async () => {
    const current = await readExecutionState(statePath);
    const draft = clone(current);
    const result = await updater(draft);
    const normalized = normalizeExecutionState(result === undefined ? draft : result);
    await writeUnlocked(statePath, normalized);
    return clone(normalized);
  });
}

async function writeUnlocked(statePath, state) {
  await fs.mkdir(path.dirname(statePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${statePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(state, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600
    });
    await fs.rename(temporaryPath, statePath);
    await fs.chmod(statePath, 0o600);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

function getRunState(state, runId) {
  const normalized = normalizeExecutionState(state);
  return normalized.runs[runId] ? clone(normalized.runs[runId]) : null;
}

function listRunStates(state) {
  return Object.values(normalizeExecutionState(state).runs)
    .sort((left, right) => left.runId.localeCompare(right.runId))
    .map(clone);
}

function listActiveRuns(state) {
  return listRunStates(state).filter((run) => ACTIVE_RUN_STATUSES.has(run.status));
}

function normalizeExecutionState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("state 必须是 JSON 对象");
  }
  if (state.schemaVersion !== EXECUTION_STATE_SCHEMA_VERSION) {
    throw new Error(`schemaVersion 必须为 ${EXECUTION_STATE_SCHEMA_VERSION}`);
  }
  if (!state.runs || typeof state.runs !== "object" || Array.isArray(state.runs)) {
    throw new Error("runs 必须是 JSON 对象");
  }
  const runs = {};
  for (const runId of Object.keys(state.runs).sort()) {
    runs[runId] = normalizeRunRecord(runId, state.runs[runId]);
  }
  return { schemaVersion: EXECUTION_STATE_SCHEMA_VERSION, runs };
}

function normalizeRunRecord(runId, record) {
  assertRunId(runId);
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("Execution Run 记录必须是 JSON 对象：" + runId);
  }
  const normalized = {
    runId: assertRunId(requiredText(record.runId, "runId")),
    taskId: assertTaskId(requiredText(record.taskId, "taskId")),
    projectId: assertProjectId(requiredText(record.projectId, "projectId")),
    teamId: assertTeamId(requiredText(record.teamId, "teamId")),
    assignedInstanceId: assertInstanceId(requiredText(record.assignedInstanceId, "assignedInstanceId")),
    status: enumValue(record.status, "status", RUN_STATUSES),
    attempt: integerRange(record.attempt, "attempt", 1, 100),
    trigger: enumValue(record.trigger, "trigger", RUN_TRIGGERS),
    inputSummary: summaryText(record.inputSummary, "inputSummary", 1000),
    inputHash: hashValue(record.inputHash),
    outputSummary: nullableSummary(record.outputSummary, "outputSummary", 4000),
    errorSummary: nullableSummary(record.errorSummary, "errorSummary", 2000),
    openClawSessionKey: safeBoundedText(record.openClawSessionKey, "openClawSessionKey", 300, false),
    openClawSessionId: nullableSafeBoundedText(record.openClawSessionId, "openClawSessionId", 300),
    openClawTaskId: nullableSafeBoundedText(record.openClawTaskId, "openClawTaskId", 300),
    openClawRunId: nullableSafeBoundedText(record.openClawRunId, "openClawRunId", 300),
    timeoutMs: integerRange(record.timeoutMs, "timeoutMs", 1000, 3600000),
    taskSyncStatus: enumValue(record.taskSyncStatus, "taskSyncStatus", TASK_SYNC_STATUSES),
    createdAt: requiredTimestamp(record.createdAt, "createdAt"),
    startedAt: optionalTimestamp(record.startedAt, "startedAt"),
    updatedAt: requiredTimestamp(record.updatedAt, "updatedAt"),
    completedAt: optionalTimestamp(record.completedAt, "completedAt"),
    failedAt: optionalTimestamp(record.failedAt, "failedAt"),
    cancelledAt: optionalTimestamp(record.cancelledAt, "cancelledAt"),
    interruptedAt: optionalTimestamp(record.interruptedAt, "interruptedAt")
  };
  if (normalized.runId !== runId) throw new Error("Execution Run key 与 runId 不一致：" + runId);
  assertRunTimestamps(normalized);
  return normalized;
}

function assertRunTimestamps(run) {
  const terminalFields = {
    completed: "completedAt",
    failed: "failedAt",
    cancelled: "cancelledAt",
    interrupted: "interruptedAt"
  };
  for (const [status, field] of Object.entries(terminalFields)) {
    if ((run.status === status) !== (run[field] !== null)) {
      throw new Error(`${field} 必须且只能在 ${status} 状态存在`);
    }
  }
  if (["pending", "starting"].includes(run.status) && run.startedAt !== null) {
    throw new Error(`${run.status} Run 不能包含 startedAt`);
  }
  if (["running", "completed"].includes(run.status) && !run.startedAt) {
    throw new Error(`${run.status} Run 必须包含 startedAt`);
  }
  if (run.status === "completed") {
    if (!["pending", "applied", "failed"].includes(run.taskSyncStatus)) {
      throw new Error("completed Run 的 taskSyncStatus 必须是 pending、applied 或 failed");
    }
  } else if (run.taskSyncStatus !== "none") {
    throw new Error("非 completed Run 的 taskSyncStatus 必须为 none");
  }
}

function redactSensitiveText(value) {
  return String(value || "")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*\b/gi, "Bearer [REDACTED]")
    .replace(/\b(api[_-]?key|token|secret)(\s*[:=]\s*)([^\s,;]+)/gi, "$1$2[REDACTED]");
}

function summaryText(value, field, maximum) {
  return boundedText(redactSensitiveText(value), field, maximum, true);
}
function nullableSummary(value, field, maximum) {
  return value === null ? null : summaryText(value, field, maximum);
}
function hashValue(value) {
  const normalized = requiredText(value, "inputHash");
  if (!/^[0-9a-f]{64}$/.test(normalized)) throw new Error("inputHash 必须是 SHA-256 十六进制字符串");
  return normalized;
}
function enumValue(value, field, allowed) {
  const normalized = requiredText(value, field);
  if (!allowed.has(normalized)) throw new Error(`${field} 无效：${normalized}`);
  return normalized;
}
function integerRange(value, field, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${field} 必须是 ${minimum} 到 ${maximum} 之间的整数`);
  }
  return value;
}
function boundedText(value, field, maximum, allowEmpty) {
  if (typeof value !== "string") throw new Error(field + " 必须是字符串");
  const normalized = value.trim();
  if (!allowEmpty && !normalized) throw new Error(field + " 必须是非空字符串");
  if (normalized.length > maximum) throw new Error(`${field} 不能超过 ${maximum} 个字符`);
  return normalized;
}
function safeBoundedText(value, field, maximum, allowEmpty) {
  return boundedText(redactSensitiveText(value), field, maximum, allowEmpty);
}
function nullableSafeBoundedText(value, field, maximum) {
  return value === null ? null : safeBoundedText(value, field, maximum, false);
}
function requiredText(value, field) {
  return boundedText(value, field, Number.MAX_SAFE_INTEGER, false);
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
  ACTIVE_RUN_STATUSES,
  DEFAULT_EXECUTION_DATA_DIRECTORY,
  DEFAULT_EXECUTION_STATE_PATH,
  EXECUTION_STATE_SCHEMA_VERSION,
  RUN_STATUSES,
  createEmptyExecutionState,
  getRunState,
  listActiveRuns,
  listRunStates,
  normalizeExecutionState,
  readExecutionState,
  redactSensitiveText,
  updateExecutionState,
  writeExecutionState
};
