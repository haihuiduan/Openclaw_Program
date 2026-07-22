const os = require("node:os");
const path = require("node:path");
const { getInstanceState, readInstanceState } = require("../agent-instances/state");
const { getProjectState, readProjectState } = require("../projects/state");
const { assessSnapshotHealth } = require("../projects/teamSnapshot");
const { calculateTaskBlocking } = require("../tasks/dependencies");
const { assertTaskId } = require("../tasks/id");
const {
  completeTaskFromExecution
} = require("../tasks/manager");
const { getTaskState, listTaskStates, readTaskState, updateTaskState } = require("../tasks/state");
const { createRunId, assertRunId } = require("./id");
const {
  DEFAULT_EXECUTION_STATE_PATH,
  RUN_STATUSES,
  getRunState,
  listActiveRuns,
  listRunStates,
  readExecutionState,
  updateExecutionState
} = require("./state");
const {
  DEFAULT_EXECUTION_LEASE_MAX_AGE_MS,
  DEFAULT_EXECUTION_LEASE_PATH,
  acquireExecutionLease,
  clearStaleExecutionLease,
  releaseExecutionLease,
  withExecutionLocks
} = require("./locks");
const { buildTaskExecutionPrompt } = require("./promptBuilder");
const { createOpenClawExecutionAdapter } = require("./openClawExecutionAdapter");

const DEFAULT_TIMEOUT_MS = 600000;
const MAX_SESSION_KEY_LENGTH = 300;
const DEFAULT_PROJECT_STATE_PATH = path.join(os.homedir(), ".openclaw-installer", "projects", "state.json");
const DEFAULT_TASK_STATE_PATH = path.join(os.homedir(), ".openclaw-installer", "tasks", "state.json");
const DEFAULT_INSTANCE_STATE_PATH = path.join(
  os.homedir(), ".openclaw-installer", "agent-instances", "state.json"
);

async function listExecutions(filters = {}, options = {}) {
  const normalized = normalizeFilters(filters);
  const settings = resolveSettings(options);
  const state = await settings.executionStateStore.readExecutionState(settings.executionStatePath);
  return listRunStates(state).filter((run) => (
    (!normalized.taskId || run.taskId === normalized.taskId) &&
    (!normalized.projectId || run.projectId === normalized.projectId) &&
    (!normalized.status || run.status === normalized.status)
  ));
}

async function inspectExecution(runId, options = {}) {
  assertRunId(runId);
  const settings = resolveSettings(options);
  const state = await settings.executionStateStore.readExecutionState(settings.executionStatePath);
  const run = getRunState(state, runId);
  if (!run) throw new Error("未找到 Execution Run：" + runId);
  return run;
}

async function runTask(taskId, input = {}, options = {}) {
  return executeTask(taskId, input, options, { trigger: "user" });
}

async function retryExecution(runId, input = {}, options = {}) {
  assertRunId(runId);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Execution retry 参数必须是对象。");
  }
  if (!input.confirm) throw new Error("executions retry 必须提供 --confirm。");
  const settings = resolveSettings(options);
  const [state, taskState] = await Promise.all([
    settings.executionStateStore.readExecutionState(settings.executionStatePath),
    settings.taskStateStore.readTaskState(settings.taskStatePath)
  ]);
  const previous = getRunState(state, runId);
  if (!previous) throw new Error("未找到 Execution Run：" + runId);
  if (!["failed", "interrupted"].includes(previous.status)) {
    throw new Error("只有 failed 或 interrupted Run 可以重试：" + runId);
  }
  const task = getTaskState(taskState, previous.taskId);
  if (!task) throw new Error("Execution Run 引用的 Task 不存在：" + previous.taskId);
  const runs = listRunStates(state).filter((run) => run.taskId === task.taskId);
  const nextAttempt = Math.max(0, ...runs.map((run) => run.attempt)) + 1;
  if (nextAttempt > 1 + task.retryPolicy.maxRetries) {
    throw new Error(`Task 已达到最大执行次数：${1 + task.retryPolicy.maxRetries}`);
  }
  const referenceTime = Date.parse(previous.failedAt || previous.interruptedAt || previous.updatedAt);
  const eligibleAt = referenceTime + task.retryPolicy.retryDelayMs;
  if (settings.now().getTime() < eligibleAt) {
    throw new Error("尚未达到 retryPolicy.retryDelayMs 要求的最早重试时间。");
  }
  return executeTask(previous.taskId, {
    confirm: true,
    confirmCritical: input.confirmCritical,
    instructions: input.instructions,
    timeoutMs: input.timeoutMs
  }, options, { trigger: "retry", previousRunId: runId });
}

async function executeTask(taskId, input, options, internal) {
  assertTaskId(taskId);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Execution run-task 参数必须是对象。");
  }
  if (!input.confirm) throw new Error("executions run-task 必须提供 --confirm。");
  const settings = resolveSettings(options);
  const timeoutMs = normalizeTimeout(input.timeoutMs);
  const runId = settings.createRunId();

  return withExecutionLocks({ taskId }, async () => {
    const context = await loadExecutionContext(taskId, settings);
    validateExecutionContext(context, input);
    const attempt = Math.max(
      0,
      ...listRunStates(context.executionState)
        .filter((run) => run.taskId === taskId)
        .map((run) => run.attempt)
    ) + 1;
    if (internal.trigger === "retry" && attempt > 1 + context.task.retryPolicy.maxRetries) {
      throw new Error(`Task 已达到最大执行次数：${1 + context.task.retryPolicy.maxRetries}`);
    }

    return withExecutionLocks({
      projectId: context.project.projectId,
      instanceId: context.task.assignedInstanceId
    }, async () => {
      const latestState = await settings.executionStateStore.readExecutionState(settings.executionStatePath);
      assertConcurrencyAvailable(context.project, context.task, latestState);
      const sessionKey = normalizeSessionKey(settings.createSessionKey(Object.freeze({
        runId,
        taskId: context.task.taskId,
        projectId: context.project.projectId,
        assignedInstanceId: context.task.assignedInstanceId,
        attempt,
        trigger: internal.trigger
      })));
      const prompt = buildTaskExecutionPrompt({
        project: context.project,
        task: context.task,
        dependencySummaries: buildDependencySummaries(context, latestState),
        instructions: input.instructions || ""
      });
      const createdAt = settings.now().toISOString();
      await settings.leaseStore.acquire(settings.executionLeasePath, {
        runId,
        pid: process.pid,
        createdAt
      });

      let runCreated = false;
      let spawnObserved = false;
      try {
        const record = createRunRecord({
          runId,
          context,
          attempt,
          trigger: internal.trigger,
          prompt,
          sessionKey,
          timeoutMs,
          timestamp: createdAt
        });
        await settings.executionStateStore.updateExecutionState(settings.executionStatePath, (state) => {
          if (state.runs[runId]) throw new Error("Execution Run 已存在：" + runId);
          state.runs[runId] = record;
          return state;
        });
        runCreated = true;

        let result;
        try {
          result = await settings.openClawExecutionAdapter.startAgentExecution({
            runId,
            agentId: context.task.assignedInstanceId,
            prompt: prompt.naturalLanguagePrompt,
            sessionKey,
            timeoutMs
          }, {
            onSpawn: async () => {
              spawnObserved = true;
              const timestamp = settings.now().toISOString();
              await updateRun(settings, runId, (run) => {
                run.status = "running";
                run.startedAt = timestamp;
                run.updatedAt = timestamp;
              });
            }
          });
        } catch (error) {
          result = {
            ok: false,
            interrupted: false,
            errorSummary: "OpenClaw Execution Adapter 调用失败。"
          };
        }

        if (result.ok && !spawnObserved) {
          result = {
            ok: false,
            interrupted: true,
            errorSummary: "Adapter 未确认子进程启动，Execution 按中断处理。"
          };
        }
        if (result.ok) {
          const completedAt = settings.now().toISOString();
          await updateRun(settings, runId, (run) => {
            ensureStarted(run, completedAt);
            run.status = "completed";
            run.outputSummary = result.outputSummary || "OpenClaw Agent 执行完成。";
            run.errorSummary = null;
            run.openClawSessionId = result.openClawSessionId || null;
            run.openClawTaskId = result.openClawTaskId || null;
            run.openClawRunId = result.openClawRunId || null;
            run.taskSyncStatus = "pending";
            run.completedAt = completedAt;
            run.updatedAt = completedAt;
          });
          try {
            await settings.completeTaskFromExecution(taskId, runId, taskManagerOptions(settings));
            await updateRun(settings, runId, (run) => {
              run.taskSyncStatus = "applied";
              run.updatedAt = settings.now().toISOString();
            });
          } catch (error) {
            await updateRun(settings, runId, (run) => {
              run.taskSyncStatus = "failed";
              run.errorSummary = "Agent 执行已完成，但 Task 状态同步失败；请运行 executions reconcile。";
              run.updatedAt = settings.now().toISOString();
            });
            throw new Error(`Execution Run 已完成，但 Task 状态同步失败：${runId}`);
          }
        } else {
          const terminalAt = settings.now().toISOString();
          await updateRun(settings, runId, (run) => {
            ensureStarted(run, spawnObserved ? terminalAt : null);
            run.status = result.interrupted ? "interrupted" : "failed";
            run.outputSummary = null;
            run.errorSummary = result.errorSummary || "OpenClaw Agent 执行失败。";
            run.taskSyncStatus = "none";
            run.failedAt = result.interrupted ? null : terminalAt;
            run.interruptedAt = result.interrupted ? terminalAt : null;
            run.updatedAt = terminalAt;
          });
        }

        const run = await inspectExecution(runId, options);
        return {
          run,
          executionMode: context.project.executionMode,
          autoSchedulingEnabled: false,
          retryOfRunId: internal.previousRunId || null
        };
      } catch (error) {
        if (!runCreated) throw error;
        const state = await settings.executionStateStore.readExecutionState(settings.executionStatePath);
        const current = getRunState(state, runId);
        if (current && ["starting", "running"].includes(current.status)) {
          const failedAt = settings.now().toISOString();
          await updateRun(settings, runId, (run) => {
            run.status = "failed";
            run.failedAt = failedAt;
            run.errorSummary = "Execution Manager 在完成执行状态前失败。";
            run.taskSyncStatus = "none";
            run.updatedAt = failedAt;
          });
        }
        throw error;
      } finally {
        await settings.leaseStore.release(settings.executionLeasePath, runId).catch(() => {});
      }
    });
  });
}

async function reconcileExecutions(options = {}) {
  const settings = resolveSettings(options);
  return withExecutionLocks({}, async () => {
    const leaseResult = await settings.leaseStore.clearStale(settings.executionLeasePath);
    if (leaseResult.active) {
      throw new Error("当前仍有前台 Execution 租约存活，拒绝并发 reconcile。");
    }
    const reconciledAt = settings.now().toISOString();
    const interruptedRuns = [];
    const updated = await settings.executionStateStore.updateExecutionState(
      settings.executionStatePath,
      (state) => {
        for (const run of listRunStates(state).filter((item) => (
          item.status === "starting" || item.status === "running"
        ))) {
          const record = state.runs[run.runId];
          record.status = "interrupted";
          record.interruptedAt = reconciledAt;
          record.errorSummary = "ToolBox 启动后发现遗留 active Run，无法确认远端状态，已标记 interrupted。";
          record.taskSyncStatus = "none";
          record.updatedAt = reconciledAt;
          interruptedRuns.push(run.runId);
        }
        return state;
      }
    );
    const syncResults = [];
    for (const run of listRunStates(updated).filter((item) => (
      item.status === "completed" && ["pending", "failed"].includes(item.taskSyncStatus)
    ))) {
      try {
        await settings.completeTaskFromExecution(run.taskId, run.runId, taskManagerOptions(settings));
        await updateRun(settings, run.runId, (record) => {
          record.taskSyncStatus = "applied";
          record.updatedAt = settings.now().toISOString();
        });
        syncResults.push({ runId: run.runId, status: "applied" });
      } catch (error) {
        await updateRun(settings, run.runId, (record) => {
          record.taskSyncStatus = "failed";
          record.errorSummary = "Task 状态同步仍然失败，请人工检查。";
          record.updatedAt = settings.now().toISOString();
        });
        syncResults.push({ runId: run.runId, status: "failed" });
      }
    }
    return {
      reconciledAt,
      interruptedRuns,
      taskSyncResults: syncResults,
      staleLeaseRemoved: leaseResult.removed
    };
  });
}

async function loadExecutionContext(taskId, settings) {
  const [projectState, taskState, instanceState, executionState] = await Promise.all([
    settings.projectStateStore.readProjectState(settings.projectStatePath),
    settings.taskStateStore.readTaskState(settings.taskStatePath),
    settings.instanceStateStore.readInstanceState(settings.instanceStatePath),
    settings.executionStateStore.readExecutionState(settings.executionStatePath)
  ]);
  const task = getTaskState(taskState, taskId);
  if (!task) throw new Error("未找到 Task：" + taskId);
  const project = getProjectState(projectState, task.projectId);
  if (!project) throw new Error("Task 引用的 Project 不存在：" + task.projectId);
  const projectTasks = listTaskStates(taskState).filter((item) => item.projectId === project.projectId);
  return { project, task, projectTasks, instanceState, executionState };
}

function validateExecutionContext(context, input) {
  const { project, task, projectTasks, instanceState, executionState } = context;
  if (project.archivedAt) throw new Error("Project 已归档，不能执行 Task：" + project.projectId);
  if (project.status !== "active") throw new Error(`只有 active Project 可以执行 Task（当前 ${project.status}）。`);
  if (task.status !== "pending") throw new Error(`只有 pending Task 可以执行（当前 ${task.status}）。`);
  const blocking = calculateTaskBlocking(task, projectTasks);
  if (blocking.status === "blocked" || blocking.issues.length) {
    throw new Error("Task 当前被依赖阻塞，不能执行：" + task.taskId);
  }
  if (!task.assignedInstanceId) throw new Error("Task 尚未分配 Agent Instance，不能执行：" + task.taskId);
  if (!project.teamSnapshot.memberInstanceIds.includes(task.assignedInstanceId)) {
    throw new Error("Task assignedInstanceId 不属于 Project Team 快照：" + task.assignedInstanceId);
  }
  const instance = getInstanceState(instanceState, task.assignedInstanceId);
  if (!instance) throw new Error("Agent Instance 当前不存在，不能执行：" + task.assignedInstanceId);
  if (instance.status !== "registered") {
    throw new Error(`Agent Instance 必须处于 registered 状态（当前 ${instance.status}）：${instance.instanceId}`);
  }
  const snapshotHealth = assessSnapshotHealth(project.teamSnapshot, instanceState);
  if (snapshotHealth.status !== "ready") {
    throw new Error(`Project Team 快照健康状态必须为 ready（当前 ${snapshotHealth.status}）。`);
  }
  if (task.critical && !input.confirmCritical) {
    throw new Error("关键 Task 必须额外提供 --confirm-critical。");
  }
  assertConcurrencyAvailable(project, task, executionState);
}

function assertConcurrencyAvailable(project, task, executionState) {
  const active = listActiveRuns(executionState);
  if (active.some((run) => run.taskId === task.taskId)) {
    throw new Error("Task 已存在 active Execution Run：" + task.taskId);
  }
  if (active.length) {
    throw new Error("已有其他前台 Execution 正在运行，当前版本只支持全局串行执行。");
  }
  const projectActive = active.filter((run) => run.projectId === project.projectId).length;
  if (projectActive >= project.maxConcurrency) {
    throw new Error("Project 已达到 maxConcurrency：" + project.projectId);
  }
  if (active.some((run) => run.assignedInstanceId === task.assignedInstanceId)) {
    throw new Error("Agent Instance 已有 active Run，当前并发上限为 1：" + task.assignedInstanceId);
  }
}

function buildDependencySummaries(context, executionState) {
  return context.task.dependencies.map((dependencyId) => {
    const dependency = context.projectTasks.find((task) => task.taskId === dependencyId);
    const runs = listRunStates(executionState)
      .filter((run) => (
        run.taskId === dependencyId &&
        run.status === "completed" &&
        typeof run.outputSummary === "string" &&
        run.outputSummary.trim()
      ))
      .sort((left, right) => (
        right.attempt - left.attempt ||
        right.updatedAt.localeCompare(left.updatedAt) ||
        right.runId.localeCompare(left.runId)
      ));
    const summary = {
      taskId: dependencyId,
      title: dependency ? dependency.title : "",
      status: dependency ? dependency.status : ""
    };
    if (runs[0]) summary.outputSummary = runs[0].outputSummary;
    return summary;
  });
}

function createRunRecord({ runId, context, attempt, trigger, prompt, sessionKey, timeoutMs, timestamp }) {
  return {
    runId,
    taskId: context.task.taskId,
    projectId: context.project.projectId,
    teamId: context.project.teamId,
    assignedInstanceId: context.task.assignedInstanceId,
    status: "starting",
    attempt,
    trigger,
    inputSummary: prompt.inputSummary,
    inputHash: prompt.inputHash,
    outputSummary: null,
    errorSummary: null,
    openClawSessionKey: sessionKey,
    openClawSessionId: null,
    openClawTaskId: null,
    openClawRunId: null,
    timeoutMs,
    taskSyncStatus: "none",
    createdAt: timestamp,
    startedAt: null,
    updatedAt: timestamp,
    completedAt: null,
    failedAt: null,
    cancelledAt: null,
    interruptedAt: null
  };
}

async function updateRun(settings, runId, mutation) {
  return settings.executionStateStore.updateExecutionState(settings.executionStatePath, (state) => {
    const run = state.runs[runId];
    if (!run) throw new Error("Execution Run 状态发生并发冲突：" + runId);
    mutation(run);
    return state;
  });
}

function ensureStarted(run, timestamp) {
  if (!run.startedAt && timestamp) run.startedAt = timestamp;
}

function normalizeFilters(filters) {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
    throw new Error("Execution list 过滤参数必须是对象。");
  }
  const allowed = new Set(["taskId", "projectId", "status"]);
  for (const field of Object.keys(filters)) {
    if (!allowed.has(field)) throw new Error("Execution list 不支持过滤字段：" + field);
  }
  if (filters.taskId) assertTaskId(filters.taskId);
  if (filters.status && !RUN_STATUSES.has(filters.status)) throw new Error("Execution status 无效：" + filters.status);
  return {
    taskId: filters.taskId || null,
    projectId: filters.projectId || null,
    status: filters.status || null
  };
}

function normalizeTimeout(value) {
  const timeoutMs = value === undefined ? DEFAULT_TIMEOUT_MS : value;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 3600000) {
    throw new Error("timeoutMs 必须是 1000 到 3600000 之间的整数。");
  }
  return timeoutMs;
}

function defaultCreateSessionKey(input) {
  return `agent:${input.assignedInstanceId}:toolbox-${input.runId}`;
}

function normalizeSessionKey(value) {
  if (typeof value !== "string") {
    throw new Error("createSessionKey 必须返回字符串。");
  }
  const normalized = value.trim();
  if (!normalized) {
    throw new Error("createSessionKey 必须返回非空 Session Key。");
  }
  if (normalized.length > MAX_SESSION_KEY_LENGTH) {
    throw new Error(`createSessionKey 返回的 Session Key 不能超过 ${MAX_SESSION_KEY_LENGTH} 个字符。`);
  }
  if (/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(value)) {
    throw new Error("createSessionKey 返回的 Session Key 不能包含换行或控制字符。");
  }
  return normalized;
}

function taskManagerOptions(settings) {
  return {
    projectStatePath: settings.projectStatePath,
    taskStatePath: settings.taskStatePath,
    executionStatePath: settings.executionStatePath,
    projectStateStore: settings.projectStateStore,
    taskStateStore: settings.taskStateStore,
    executionStateStore: settings.executionStateStore,
    now: settings.now
  };
}

function resolveSettings(options = {}) {
  const fileSystem = options.fileSystem;
  const now = options.now || (() => new Date());
  const executionLeaseMaxAgeMs = options.executionLeaseMaxAgeMs === undefined
    ? DEFAULT_EXECUTION_LEASE_MAX_AGE_MS
    : options.executionLeaseMaxAgeMs;
  const createSessionKey = options.createSessionKey === undefined
    ? defaultCreateSessionKey
    : options.createSessionKey;
  if (typeof createSessionKey !== "function") {
    throw new Error("createSessionKey 必须是函数。");
  }
  return {
    projectStatePath: path.resolve(options.projectStatePath || DEFAULT_PROJECT_STATE_PATH),
    taskStatePath: path.resolve(options.taskStatePath || DEFAULT_TASK_STATE_PATH),
    instanceStatePath: path.resolve(options.instanceStatePath || DEFAULT_INSTANCE_STATE_PATH),
    executionStatePath: path.resolve(options.executionStatePath || DEFAULT_EXECUTION_STATE_PATH),
    executionLeasePath: path.resolve(options.executionLeasePath || DEFAULT_EXECUTION_LEASE_PATH),
    now,
    createRunId: options.createRunId || createRunId,
    createSessionKey,
    projectStateStore: options.projectStateStore || { readProjectState },
    taskStateStore: options.taskStateStore || { readTaskState, updateTaskState },
    instanceStateStore: options.instanceStateStore || { readInstanceState },
    executionStateStore: options.executionStateStore || { readExecutionState, updateExecutionState },
    completeTaskFromExecution: options.completeTaskFromExecution || completeTaskFromExecution,
    openClawExecutionAdapter: options.openClawExecutionAdapter || createOpenClawExecutionAdapter({
      spawnImpl: options.spawnImpl,
      maxOutputBytes: options.maxOutputBytes
    }),
    leaseStore: options.leaseStore || {
      acquire: (leasePath, metadata) => acquireExecutionLease(leasePath, metadata, { fileSystem }),
      release: (leasePath, runId) => releaseExecutionLease(leasePath, runId, { fileSystem }),
      clearStale: (leasePath) => clearStaleExecutionLease(leasePath, {
        fileSystem,
        isProcessAlive: options.isProcessAlive,
        maxAgeMs: executionLeaseMaxAgeMs,
        now
      })
    }
  };
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  MAX_SESSION_KEY_LENGTH,
  inspectExecution,
  listExecutions,
  reconcileExecutions,
  retryExecution,
  runTask
};
