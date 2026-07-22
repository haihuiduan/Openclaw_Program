const path = require("node:path");
const { assertInstanceId } = require("../agent-instances/id");
const { readInstanceState } = require("../agent-instances/state");
const {
  ACTIVE_RUN_STATUSES,
  getRunState,
  listRunStates,
  readExecutionState
} = require("../executions/state");
const { assertRunId } = require("../executions/id");
const { assertProjectId } = require("../projects/id");
const { withProjectLock } = require("../projects/lock");
const {
  DEFAULT_PROJECT_STATE_PATH,
  getProjectState,
  readProjectState
} = require("../projects/state");
const {
  calculateTaskBlocking,
  validateTaskDependencies
} = require("./dependencies");
const { assertTaskId } = require("./id");
const {
  DEFAULT_TASK_STATE_PATH,
  getTaskState,
  listTaskStates,
  readTaskState,
  updateTaskState
} = require("./state");

const UPDATE_FIELDS = new Set(["title", "description", "priority", "failurePolicy", "retryPolicy"]);
const DEFAULT_INSTANCE_STATE_PATH = path.join(
  require("node:os").homedir(), ".openclaw-installer", "agent-instances", "state.json"
);

async function listTasks(projectIdOrOptions, maybeOptions) {
  const { projectId, options } = normalizeListArguments(projectIdOrOptions, maybeOptions);
  if (projectId) assertProjectId(projectId);
  const settings = resolveSettings(options);
  const [state, executionState] = await Promise.all([
    settings.taskStateStore.readTaskState(settings.taskStatePath),
    settings.executionStateStore.readExecutionState(settings.executionStatePath)
  ]);
  const tasks = listTaskStates(state).filter((task) => !projectId || task.projectId === projectId);
  const runs = listRunStates(executionState);
  return tasks.map((task) => enrichTask(task, tasks, runs));
}

async function inspectTask(taskId, options = {}) {
  assertTaskId(taskId);
  const settings = resolveSettings(options);
  const [state, executionState] = await Promise.all([
    settings.taskStateStore.readTaskState(settings.taskStatePath),
    settings.executionStateStore.readExecutionState(settings.executionStatePath)
  ]);
  const task = getTaskState(state, taskId);
  if (!task) throw new Error("未找到 Task：" + taskId);
  const projectTasks = listTaskStates(state).filter((item) => item.projectId === task.projectId);
  return enrichTask(task, projectTasks, listRunStates(executionState));
}

async function createTask(input, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Task 创建参数必须是对象。");
  const taskId = assertTaskId(input.taskId);
  const projectId = assertProjectId(input.projectId);
  validateRetryPatch(input.retryPolicy, true);
  return withProjectLock(projectId, async () => {
    const settings = resolveSettings(options);
    const assignedInstanceId = input.assignedInstanceId === undefined
      ? null
      : input.assignedInstanceId;
    const [projectState, instanceState, executionState] = await Promise.all([
      settings.projectStateStore.readProjectState(settings.projectStatePath),
      assignedInstanceId === null
        ? Promise.resolve(null)
        : settings.instanceStateStore.readInstanceState(settings.instanceStatePath),
      settings.executionStateStore.readExecutionState(settings.executionStatePath)
    ]);
    const project = getProjectState(projectState, projectId);
    if (!project) throw new Error("未找到 Project：" + projectId);
    assertProjectWritable(project);
    assertNoActiveRunForProject(projectId, executionState);
    validateAssignableInstance(assignedInstanceId, project, instanceState);
    const timestamp = settings.now().toISOString();
    const critical = input.critical === undefined ? false : input.critical;
    const record = {
      taskId,
      projectId,
      title: input.title,
      description: input.description === undefined ? "" : input.description,
      source: input.source === undefined ? "user" : input.source,
      status: "pending",
      priority: input.priority === undefined ? "medium" : input.priority,
      critical,
      criticalReason: critical ? input.criticalReason : null,
      criticalSource: critical ? input.criticalSource : null,
      assignedInstanceId,
      dependencies: input.dependencies === undefined ? [] : input.dependencies,
      failurePolicy: input.failurePolicy === undefined ? "continue" : input.failurePolicy,
      retryPolicy: {
        maxRetries: input.retryPolicy?.maxRetries === undefined ? 0 : input.retryPolicy.maxRetries,
        retryDelayMs: input.retryPolicy?.retryDelayMs === undefined ? 0 : input.retryPolicy.retryDelayMs
      },
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
      cancelledAt: null
    };
    const updated = await settings.taskStateStore.updateTaskState(settings.taskStatePath, (state) => {
      if (state.tasks[taskId]) throw new Error("Task 已存在：" + taskId);
      state.tasks[taskId] = record;
      validateTaskDependencies(record, state.tasks);
      return state;
    });
    return enrichFromState(getTaskState(updated, taskId), updated, settings);
  });
}

async function updateTask(taskId, patch, options = {}) {
  const fields = validatePatch(patch);
  return mutateTask(taskId, options, (task, project, settings) => {
    assertTaskMutable(task, project);
    for (const field of fields) {
      if (field === "retryPolicy") task.retryPolicy = { ...task.retryPolicy, ...patch.retryPolicy };
      else task[field] = patch[field];
    }
    task.updatedAt = settings.now().toISOString();
  });
}

async function assignTask(taskId, instanceId, options = {}) {
  if (instanceId !== null) assertInstanceId(instanceId);
  return mutateTask(taskId, options, async (task, project, settings) => {
    assertTaskMutable(task, project);
    const instanceState = instanceId === null
      ? null
      : await settings.instanceStateStore.readInstanceState(settings.instanceStatePath);
    validateAssignableInstance(instanceId, project, instanceState);
    task.assignedInstanceId = instanceId;
    task.updatedAt = settings.now().toISOString();
  });
}

async function setTaskCritical(taskId, value, options = {}) {
  const input = typeof value === "boolean" ? { critical: value } : value;
  if (!input || typeof input !== "object" || typeof input.critical !== "boolean") {
    throw new Error("set-critical 需要提供布尔值 critical。");
  }
  return mutateTask(taskId, options, (task, project, settings) => {
    assertTaskMutable(task, project);
    task.critical = input.critical;
    task.criticalReason = input.critical ? input.reason ?? input.criticalReason : null;
    task.criticalSource = input.critical ? input.source ?? input.criticalSource : null;
    task.updatedAt = settings.now().toISOString();
  });
}

async function addTaskDependency(taskId, dependencyTaskId, options = {}) {
  assertTaskId(dependencyTaskId);
  return mutateTask(taskId, options, (task, project, settings, state) => {
    assertTaskMutable(task, project);
    if (task.dependencies.includes(dependencyTaskId)) throw new Error("Task 已包含该依赖：" + dependencyTaskId);
    task.dependencies.push(dependencyTaskId);
    validateTaskDependencies(task, state.tasks);
    task.updatedAt = settings.now().toISOString();
  });
}

async function removeTaskDependency(taskId, dependencyTaskId, options = {}) {
  assertTaskId(dependencyTaskId);
  return mutateTask(taskId, options, (task, project, settings) => {
    assertTaskMutable(task, project);
    if (!task.dependencies.includes(dependencyTaskId)) throw new Error("Task 不包含该依赖：" + dependencyTaskId);
    task.dependencies = task.dependencies.filter((id) => id !== dependencyTaskId);
    task.updatedAt = settings.now().toISOString();
  });
}

async function completeTask(taskId, options = {}) {
  return closeTask(taskId, "completed", options);
}
async function cancelTask(taskId, options = {}) {
  return closeTask(taskId, "cancelled", options);
}

async function completeTaskFromExecution(taskId, runId, options = {}) {
  assertTaskId(taskId);
  assertRunId(runId);
  const initialSettings = resolveSettings(options);
  const initialState = await initialSettings.taskStateStore.readTaskState(initialSettings.taskStatePath);
  const initialTask = getTaskState(initialState, taskId);
  if (!initialTask) throw new Error("未找到 Task：" + taskId);
  return withProjectLock(initialTask.projectId, async () => {
    const settings = resolveSettings(options);
    const [projectState, executionState] = await Promise.all([
      settings.projectStateStore.readProjectState(settings.projectStatePath),
      settings.executionStateStore.readExecutionState(settings.executionStatePath)
    ]);
    const project = getProjectState(projectState, initialTask.projectId);
    if (!project) throw new Error("Task 引用的 Project 不存在：" + initialTask.projectId);
    const run = getRunState(executionState, runId);
    if (!run || run.taskId !== taskId || run.status !== "completed") {
      throw new Error("只有该 Task 的 completed Execution Run 可以完成 Task：" + runId);
    }
    const updated = await settings.taskStateStore.updateTaskState(settings.taskStatePath, (state) => {
      const task = state.tasks[taskId];
      if (!task) throw new Error("未找到 Task：" + taskId);
      if (task.status === "completed") return state;
      if (task.status !== "pending") throw new Error("Execution 完成时 Task 已不再是 pending：" + taskId);
      const timestamp = settings.now().toISOString();
      task.status = "completed";
      task.completedAt = timestamp;
      task.cancelledAt = null;
      task.updatedAt = timestamp;
      return state;
    });
    return enrichFromState(getTaskState(updated, taskId), updated, settings);
  });
}

async function closeTask(taskId, status, options) {
  return mutateTask(taskId, options, (task, project, settings) => {
    assertTaskMutable(task, project);
    const timestamp = settings.now().toISOString();
    task.status = status;
    task.completedAt = status === "completed" ? timestamp : null;
    task.cancelledAt = status === "cancelled" ? timestamp : null;
    task.updatedAt = timestamp;
  });
}

async function mutateTask(taskId, options, mutation) {
  assertTaskId(taskId);
  const initialSettings = resolveSettings(options);
  const initialState = await initialSettings.taskStateStore.readTaskState(initialSettings.taskStatePath);
  const initialTask = getTaskState(initialState, taskId);
  if (!initialTask) throw new Error("未找到 Task：" + taskId);
  return withProjectLock(initialTask.projectId, async () => {
    const settings = resolveSettings(options);
    const [projectState, executionState] = await Promise.all([
      settings.projectStateStore.readProjectState(settings.projectStatePath),
      settings.executionStateStore.readExecutionState(settings.executionStatePath)
    ]);
    const project = getProjectState(projectState, initialTask.projectId);
    if (!project) throw new Error("Task 引用的 Project 不存在：" + initialTask.projectId);
    assertNoActiveRunForTask(taskId, executionState);
    const updated = await settings.taskStateStore.updateTaskState(settings.taskStatePath, async (state) => {
      const task = state.tasks[taskId];
      if (!task) throw new Error("未找到 Task：" + taskId);
      await mutation(task, project, settings, state);
      return state;
    });
    return enrichFromState(getTaskState(updated, taskId), updated, settings);
  });
}

async function enrichFromState(task, state, settings) {
  const tasks = listTaskStates(state).filter((item) => item.projectId === task.projectId);
  const executionState = await settings.executionStateStore.readExecutionState(settings.executionStatePath);
  return enrichTask(task, tasks, listRunStates(executionState));
}
function enrichTask(task, projectTasks, runs = []) {
  const blocking = calculateTaskBlocking(task, projectTasks);
  const taskRuns = runs.filter((run) => run.taskId === task.taskId)
    .sort((left, right) => left.attempt - right.attempt || left.createdAt.localeCompare(right.createdAt));
  const currentRun = [...taskRuns].reverse().find((run) => ACTIVE_RUN_STATUSES.has(run.status)) || null;
  const lastRun = taskRuns.length ? taskRuns[taskRuns.length - 1] : null;
  return {
    ...task,
    computedStatus: blocking.status,
    dependencyIssues: blocking.issues,
    executionStatus: currentRun ? currentRun.status : lastRun ? lastRun.status : null,
    currentRunId: currentRun ? currentRun.runId : null,
    lastRunId: lastRun ? lastRun.runId : null,
    attemptCount: taskRuns.length
  };
}

function assertNoActiveRunForTask(taskId, executionState) {
  const active = listRunStates(executionState).find((run) => (
    run.taskId === taskId && ACTIVE_RUN_STATUSES.has(run.status)
  ));
  if (active) throw new Error(`Task 存在 active Execution Run，当前不能修改：${active.runId}`);
}

function assertNoActiveRunForProject(projectId, executionState) {
  const active = listRunStates(executionState).find((run) => (
    run.projectId === projectId && ACTIVE_RUN_STATUSES.has(run.status)
  ));
  if (active) throw new Error(`Project 存在 active Execution Run，当前不能创建 Task：${active.runId}`);
}
function validateAssignableInstance(instanceId, project, instanceState) {
  if (instanceId === null) return;
  assertInstanceId(instanceId);
  if (!project.teamSnapshot.memberInstanceIds.includes(instanceId)) {
    throw new Error("assignedInstanceId 必须属于 Project Team 快照：" + instanceId);
  }
  const instance = instanceState.instances[instanceId];
  if (!instance) {
    throw new Error("Agent Instance 当前不存在，不能分配 Task：" + instanceId);
  }
  if (instance.status === "missing") {
    throw new Error("Agent Instance 当前为 missing，不能分配 Task：" + instanceId);
  }
  if (instance.status === "drifted") {
    throw new Error("Agent Instance 当前为 drifted，不能分配 Task：" + instanceId);
  }
  if (instance.status !== "registered") {
    throw new Error(
      `Agent Instance 当前状态不是 registered，不能分配 Task：${instanceId}（当前 ${instance.status}）`
    );
  }
}
function assertProjectWritable(project) {
  if (project.archivedAt) throw new Error("Project 已归档，Task 为只读状态：" + project.projectId);
  if (project.status === "completed") throw new Error("Project 已完成，不能修改 Task：" + project.projectId);
}
function assertTaskMutable(task, project) {
  assertProjectWritable(project);
  if (task.status !== "pending") throw new Error(`Task 已${task.status === "completed" ? "完成" : "取消"}，不能继续修改：${task.taskId}`);
}
function validatePatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Task 更新参数必须是对象。");
  const fields = Object.keys(patch);
  if (!fields.length) throw new Error("tasks update 至少需要一个可更新字段。");
  for (const field of fields) if (!UPDATE_FIELDS.has(field)) throw new Error("Task 不支持更新字段：" + field);
  if (Object.hasOwn(patch, "retryPolicy")) validateRetryPatch(patch.retryPolicy, false);
  return fields;
}
function validateRetryPatch(retryPolicy, allowUndefined) {
  if (retryPolicy === undefined && allowUndefined) return;
  if (!retryPolicy || typeof retryPolicy !== "object" || Array.isArray(retryPolicy)) {
    throw new Error("retryPolicy 必须是对象。");
  }
  const fields = Object.keys(retryPolicy);
  if (!allowUndefined && fields.length === 0) throw new Error("retryPolicy 至少需要一个字段。");
  for (const field of fields) {
    if (!["maxRetries", "retryDelayMs"].includes(field)) {
      throw new Error("retryPolicy 不支持字段：" + field);
    }
  }
}
function normalizeListArguments(first, second) {
  if (typeof first === "string") return { projectId: first, options: second || {} };
  const options = first || {};
  return { projectId: options.projectId || null, options };
}
function resolveSettings(options = {}) {
  const taskStatePath = path.resolve(options.taskStatePath || DEFAULT_TASK_STATE_PATH);
  const taskDirectory = path.dirname(taskStatePath);
  const stateRoot = path.basename(taskDirectory) === "tasks"
    ? path.dirname(taskDirectory)
    : taskDirectory;
  return {
    projectStatePath: path.resolve(options.projectStatePath || DEFAULT_PROJECT_STATE_PATH),
    taskStatePath,
    instanceStatePath: path.resolve(options.instanceStatePath || DEFAULT_INSTANCE_STATE_PATH),
    executionStatePath: path.resolve(
      options.executionStatePath || path.join(stateRoot, "executions", "state.json")
    ),
    now: options.now || (() => new Date()),
    projectStateStore: options.projectStateStore || { readProjectState },
    taskStateStore: options.taskStateStore || { readTaskState, updateTaskState },
    instanceStateStore: options.instanceStateStore || { readInstanceState },
    executionStateStore: options.executionStateStore || { readExecutionState }
  };
}

module.exports = {
  addTaskDependency,
  assignTask,
  cancelTask,
  completeTaskFromExecution,
  completeTask,
  createTask,
  inspectTask,
  listTasks,
  removeTaskDependency,
  setTaskCritical,
  updateTask
};
