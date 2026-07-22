const path = require("node:path");
const { readInstanceState } = require("../agent-instances/state");
const {
  ACTIVE_RUN_STATUSES,
  listRunStates,
  readExecutionState
} = require("../executions/state");
const { getTeamState, readTeamState } = require("../teams/state");
const { assertTeamId } = require("../teams/id");
const { listTaskStates, readTaskState } = require("../tasks/state");
const { calculateTaskBlocking } = require("../tasks/dependencies");
const { assertProjectId } = require("./id");
const { withProjectLock } = require("./lock");
const {
  DEFAULT_PROJECT_STATE_PATH,
  getProjectState,
  listProjectStates,
  readProjectState,
  updateProjectState
} = require("./state");
const {
  assessSnapshotHealth,
  captureTeamSnapshot,
  compareTeamSnapshot
} = require("./teamSnapshot");
const { DEFAULT_TEAM_STATE_PATH } = require("../teams/manager");
const { DEFAULT_TASK_STATE_PATH } = require("../tasks/state");

const DEFAULT_INSTANCE_STATE_PATH = path.join(
  require("node:os").homedir(), ".openclaw-installer", "agent-instances", "state.json"
);
const UPDATE_FIELDS = new Set(["name", "description", "executionMode", "maxConcurrency"]);

async function listProjects(options = {}) {
  const settings = resolveSettings(options);
  const [projectState, teamState, instanceState, taskState] = await Promise.all([
    settings.projectStateStore.readProjectState(settings.projectStatePath),
    settings.teamStateStore.readTeamState(settings.teamStatePath),
    settings.instanceStateStore.readInstanceState(settings.instanceStatePath),
    settings.taskStateStore.readTaskState(settings.taskStatePath)
  ]);
  return listProjectStates(projectState).map((project) => (
    enrichProject(project, teamState, instanceState, taskState)
  ));
}

async function inspectProject(projectId, options = {}) {
  assertProjectId(projectId);
  const settings = resolveSettings(options);
  const [projectState, teamState, instanceState, taskState] = await Promise.all([
    settings.projectStateStore.readProjectState(settings.projectStatePath),
    settings.teamStateStore.readTeamState(settings.teamStatePath),
    settings.instanceStateStore.readInstanceState(settings.instanceStatePath),
    settings.taskStateStore.readTaskState(settings.taskStatePath)
  ]);
  const project = getProjectState(projectState, projectId);
  if (!project) throw new Error("未找到 Project：" + projectId);
  return enrichProject(project, teamState, instanceState, taskState);
}

async function createProject(input, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Project 创建参数必须是对象。");
  }
  const projectId = assertProjectId(input.projectId);
  const teamId = assertTeamId(input.teamId);
  return withProjectLock(projectId, async () => {
    const settings = resolveSettings(options);
    const [teamState, instanceState] = await Promise.all([
      settings.teamStateStore.readTeamState(settings.teamStatePath),
      settings.instanceStateStore.readInstanceState(settings.instanceStatePath)
    ]);
    const team = getTeamState(teamState, teamId);
    if (!team) throw new Error("未找到 Team：" + teamId);
    const teamHealth = require("../teams/health").assessTeamHealth(team, instanceState).health;
    if (teamHealth.status !== "ready") {
      throw new Error(`只有健康状态为 ready 的 Team 才能创建 Project：${team.teamId}（当前 ${teamHealth.status}）`);
    }
    const timestamp = settings.now().toISOString();
    const snapshot = captureTeamSnapshot(team, timestamp);
    const record = {
      projectId,
      name: input.name,
      description: input.description === undefined ? "" : input.description,
      teamId: team.teamId,
      teamSnapshot: snapshot,
      status: "draft",
      executionMode: input.executionMode === undefined ? team.executionMode : input.executionMode,
      maxConcurrency: input.maxConcurrency === undefined ? team.maxConcurrency : input.maxConcurrency,
      createdAt: timestamp,
      updatedAt: timestamp,
      completedAt: null,
      archivedAt: null
    };
    const updated = await settings.projectStateStore.updateProjectState(
      settings.projectStatePath,
      (state) => {
        if (state.projects[projectId]) throw new Error("Project 已存在：" + projectId);
        state.projects[projectId] = record;
        return state;
      }
    );
    return enrichCurrent(getProjectState(updated, projectId), settings);
  });
}

async function updateProject(projectId, patch, options = {}) {
  assertProjectId(projectId);
  const fields = validatePatch(patch);
  return mutateProject(projectId, options, (project, settings) => {
    assertProjectWritable(project);
    for (const field of fields) project[field] = patch[field];
    project.updatedAt = settings.now().toISOString();
  });
}

async function activateProject(projectId, options = {}) {
  return mutateProject(projectId, options, (project, settings) => {
    assertProjectWritable(project);
    if (project.status !== "draft") throw new Error("只有 draft Project 可以激活。");
    project.status = "active";
    project.updatedAt = settings.now().toISOString();
  });
}

async function completeProject(projectId, options = {}) {
  assertProjectId(projectId);
  return withProjectLock(projectId, async () => {
    const settings = resolveSettings(options);
    const [taskState, executionState] = await Promise.all([
      settings.taskStateStore.readTaskState(settings.taskStatePath),
      settings.executionStateStore.readExecutionState(settings.executionStatePath)
    ]);
    assertNoActiveRunForProject(projectId, executionState, "完成");
    const pending = listTaskStates(taskState).filter((task) => (
      task.projectId === projectId && task.status === "pending"
    ));
    if (pending.length) {
      throw new Error("Project 仍有 pending Task，暂时不能完成：" + pending.map((task) => task.taskId).join(", "));
    }
    const updated = await settings.projectStateStore.updateProjectState(
      settings.projectStatePath,
      (state) => {
        const project = requireProject(state, projectId);
        assertProjectWritable(project);
        if (!['draft', 'active'].includes(project.status)) throw new Error("Project 当前状态不能完成。");
        const timestamp = settings.now().toISOString();
        project.status = "completed";
        project.completedAt = timestamp;
        project.updatedAt = timestamp;
        return state;
      }
    );
    return enrichCurrent(getProjectState(updated, projectId), settings);
  });
}

async function archiveProject(projectId, options = {}) {
  return mutateProject(projectId, options, async (project, settings) => {
    const executionState = await settings.executionStateStore.readExecutionState(
      settings.executionStatePath
    );
    assertNoActiveRunForProject(projectId, executionState, "归档");
    if (project.archivedAt) throw new Error("Project 已归档：" + project.projectId);
    const timestamp = settings.now().toISOString();
    project.archivedAt = timestamp;
    project.updatedAt = timestamp;
  });
}

async function unarchiveProject(projectId, options = {}) {
  return mutateProject(projectId, options, (project, settings) => {
    if (!project.archivedAt) throw new Error("Project 尚未归档：" + project.projectId);
    project.archivedAt = null;
    project.updatedAt = settings.now().toISOString();
  });
}

async function previewProjectTeamSync(projectId, options = {}) {
  const project = await inspectProject(projectId, options);
  const currentTeam = project.currentTeam;
  return {
    projectId,
    teamId: project.teamId,
    teamSyncStatus: project.teamSyncStatus,
    projectSnapshot: project.teamSnapshot,
    currentTeamConfig: currentTeam,
    differences: currentTeam ? buildDifferences(project.teamSnapshot, currentTeam) : []
  };
}

async function syncProjectTeam(projectId, input = {}, options = {}) {
  assertProjectId(projectId);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Project Team 同步参数必须是对象。");
  }
  if (!input.confirm) throw new Error("同步 Team 配置必须显式确认。");
  return withProjectLock(projectId, async () => {
    const settings = resolveSettings(options);
    const [projectState, teamState, instanceState, executionState] = await Promise.all([
      settings.projectStateStore.readProjectState(settings.projectStatePath),
      settings.teamStateStore.readTeamState(settings.teamStatePath),
      settings.instanceStateStore.readInstanceState(settings.instanceStatePath),
      settings.executionStateStore.readExecutionState(settings.executionStatePath)
    ]);
    const existing = getProjectState(projectState, projectId);
    if (!existing) throw new Error("未找到 Project：" + projectId);
    assertProjectWritable(existing);
    assertNoActiveRunForProject(projectId, executionState, "同步 Team 快照");
    const team = getTeamState(teamState, existing.teamId);
    if (!team) throw new Error("来源 Team 不存在，不能同步：" + existing.teamId);
    const health = require("../teams/health").assessTeamHealth(team, instanceState).health;
    if (health.status !== "ready") throw new Error(`来源 Team 必须为 ready 才能同步（当前 ${health.status}）。`);
    if (input.expectedSourceTeamUpdatedAt && input.expectedSourceTeamUpdatedAt !== team.updatedAt) {
      throw new Error("Team 已在预览后发生变化，请重新执行 sync-preview。");
    }
    const timestamp = settings.now().toISOString();
    const snapshot = captureTeamSnapshot(team, timestamp);
    const updated = await settings.projectStateStore.updateProjectState(
      settings.projectStatePath,
      (state) => {
        const project = requireProject(state, projectId);
        project.teamSnapshot = snapshot;
        if (input.syncExecutionSettings) {
          project.executionMode = team.executionMode;
          project.maxConcurrency = team.maxConcurrency;
        }
        project.updatedAt = timestamp;
        return state;
      }
    );
    return enrichCurrent(getProjectState(updated, projectId), settings);
  });
}

async function summarizeProject(projectId, options = {}) {
  const project = await inspectProject(projectId, options);
  return {
    projectId: project.projectId,
    status: project.status,
    archived: project.archivedAt !== null,
    teamSyncStatus: project.teamSyncStatus,
    teamSnapshotHealth: project.teamSnapshotHealth,
    taskSummary: project.taskSummary
  };
}

async function mutateProject(projectId, options, mutation) {
  assertProjectId(projectId);
  return withProjectLock(projectId, async () => {
    const settings = resolveSettings(options);
    const updated = await settings.projectStateStore.updateProjectState(settings.projectStatePath, async (state) => {
      const project = requireProject(state, projectId);
      await mutation(project, settings);
      return state;
    });
    return enrichCurrent(getProjectState(updated, projectId), settings);
  });
}

async function enrichCurrent(project, settings) {
  const [teamState, instanceState, taskState] = await Promise.all([
    settings.teamStateStore.readTeamState(settings.teamStatePath),
    settings.instanceStateStore.readInstanceState(settings.instanceStatePath),
    settings.taskStateStore.readTaskState(settings.taskStatePath)
  ]);
  return enrichProject(project, teamState, instanceState, taskState);
}

function enrichProject(project, teamState, instanceState, taskState) {
  const team = getTeamState(teamState, project.teamId);
  const currentTeam = team ? {
    managerInstanceId: team.managerInstanceId,
    memberInstanceIds: [...team.memberInstanceIds],
    executionMode: team.executionMode,
    maxConcurrency: team.maxConcurrency,
    updatedAt: team.updatedAt
  } : null;
  const differences = team ? compareTeamSnapshot(project.teamSnapshot, team) : [];
  const tasks = listTaskStates(taskState).filter((task) => task.projectId === project.projectId);
  return {
    ...project,
    teamSyncStatus: !team ? "source-missing" : differences.length ? "out-of-sync" : "in-sync",
    teamSnapshotHealth: assessSnapshotHealth(project.teamSnapshot, instanceState),
    currentTeam,
    taskSummary: summarizeTasks(tasks)
  };
}

function summarizeTasks(tasks) {
  const summary = {
    total: tasks.length, pending: 0, completed: 0, cancelled: 0,
    unassigned: 0, critical: 0, dependencyIssues: 0
  };
  for (const task of tasks) {
    summary[task.status] += 1;
    if (!task.assignedInstanceId) summary.unassigned += 1;
    if (task.critical) summary.critical += 1;
    summary.dependencyIssues += calculateTaskBlocking(task, tasks).issues.length;
  }
  return summary;
}

function buildDifferences(snapshot, team) {
  return compareTeamSnapshot(snapshot, team).map((field) => ({
    field,
    projectValue: snapshot[field],
    teamValue: team[field]
  }));
}
function validatePatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("Project 更新参数必须是对象。");
  const fields = Object.keys(patch);
  if (!fields.length) throw new Error("projects update 至少需要一个可更新字段。");
  for (const field of fields) if (!UPDATE_FIELDS.has(field)) throw new Error("Project 不支持更新字段：" + field);
  return fields;
}
function assertProjectWritable(project) {
  if (project.archivedAt) throw new Error("Project 已归档，当前为只读状态：" + project.projectId);
  if (project.status === "completed") throw new Error("Project 已完成，当前为只读状态：" + project.projectId);
}
function requireProject(state, projectId) {
  const project = state.projects[projectId];
  if (!project) throw new Error("未找到 Project：" + projectId);
  return project;
}

function assertNoActiveRunForProject(projectId, executionState, action) {
  const active = listRunStates(executionState).find((run) => (
    run.projectId === projectId && ACTIVE_RUN_STATUSES.has(run.status)
  ));
  if (active) {
    throw new Error(`Project 存在 active Execution Run，暂时不能${action}：${active.runId}`);
  }
}
function resolveSettings(options = {}) {
  const projectStatePath = path.resolve(options.projectStatePath || DEFAULT_PROJECT_STATE_PATH);
  const projectDirectory = path.dirname(projectStatePath);
  const stateRoot = path.basename(projectDirectory) === "projects"
    ? path.dirname(projectDirectory)
    : projectDirectory;
  return {
    projectStatePath,
    teamStatePath: path.resolve(options.teamStatePath || DEFAULT_TEAM_STATE_PATH),
    instanceStatePath: path.resolve(options.instanceStatePath || DEFAULT_INSTANCE_STATE_PATH),
    taskStatePath: path.resolve(options.taskStatePath || DEFAULT_TASK_STATE_PATH),
    executionStatePath: path.resolve(
      options.executionStatePath || path.join(stateRoot, "executions", "state.json")
    ),
    now: options.now || (() => new Date()),
    projectStateStore: options.projectStateStore || { readProjectState, updateProjectState },
    teamStateStore: options.teamStateStore || { readTeamState },
    instanceStateStore: options.instanceStateStore || { readInstanceState },
    taskStateStore: options.taskStateStore || { readTaskState },
    executionStateStore: options.executionStateStore || { readExecutionState }
  };
}

module.exports = {
  activateProject,
  archiveProject,
  completeProject,
  createProject,
  inspectProject,
  listProjects,
  previewProjectTeamSync,
  summarizeProject,
  syncProjectTeam,
  unarchiveProject,
  updateProject
};
