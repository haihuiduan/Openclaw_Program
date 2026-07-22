// 公共 API 入口：CLI、测试、未来 Electron GUI 都应该优先从这里调用核心能力。
// 这样界面层可以变化，但 doctor、installer、config 这些业务模块保持稳定。
const { runDoctor } = require("./core/doctor");
const {
  buildInstallPlan,
  executeInstallPlan,
  installOpenClaw
} = require("./core/installer");
const { loadConfig } = require("./config");
const { runConfigure } = require("./core/configure");
const { runVerify } = require("./core/verify");
const { runSetup } = require("./core/setup");
const { listRoles, scanRoleRegistry } = require("./core/roles/registry");
const { validateRolePackage } = require("./core/roles/validator");
const { inspectRole, installRole, listInstalledRoles, removeRole } = require("./core/roles/installer");
const { getRoleState, listRoleStates, readRoleState, updateRoleState, writeRoleState } = require("./core/roles/state");
const {
  disableInstance,
  inspectInstance,
  listInstances,
  reconcileInstances,
  registerInstance
} = require("./core/agent-instances/manager");
const {
  getInstanceState,
  listInstanceStates,
  readInstanceState,
  updateInstanceState,
  writeInstanceState
} = require("./core/agent-instances/state");
const { createOpenClawAdapter } = require("./core/agent-instances/openClawAdapter");
const {
  addTeamMember,
  assessTeamHealth,
  createTeam,
  deleteTeam,
  inspectTeam,
  listTeams,
  removeTeamMember,
  setTeamManager,
  updateTeam
} = require("./core/teams/manager");
const {
  createEmptyTeamState,
  getTeamState,
  listTeamStates,
  readTeamState,
  updateTeamState,
  writeTeamState
} = require("./core/teams/state");
const {
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
} = require("./core/projects/manager");
const {
  createEmptyProjectState,
  getProjectState,
  listProjectStates,
  readProjectState,
  updateProjectState,
  writeProjectState
} = require("./core/projects/state");
const {
  addTaskDependency,
  assignTask,
  cancelTask,
  completeTask,
  createTask,
  inspectTask,
  listTasks,
  removeTaskDependency,
  setTaskCritical,
  updateTask
} = require("./core/tasks/manager");
const {
  createEmptyTaskState,
  getTaskState,
  listTaskStates,
  readTaskState,
  updateTaskState,
  writeTaskState
} = require("./core/tasks/state");
const {
  buildTaskGraph,
  calculateTaskBlocking,
  detectDependencyCycle,
  getReadyTaskCandidates,
  validateTaskDependencies
} = require("./core/tasks/dependencies");
const {
  inspectExecution,
  listExecutions,
  reconcileExecutions,
  retryExecution,
  runTask
} = require("./core/executions/manager");
const {
  createEmptyExecutionState,
  getRunState,
  listActiveRuns,
  listRunStates,
  readExecutionState,
  updateExecutionState,
  writeExecutionState
} = require("./core/executions/state");
const { createOpenClawExecutionAdapter } = require("./core/executions/openClawExecutionAdapter");
const { buildTaskExecutionPrompt } = require("./core/executions/promptBuilder");

module.exports = {
  buildInstallPlan,
  executeInstallPlan,
  installOpenClaw,
  loadConfig,
  runConfigure,
  runDoctor,
  runVerify,
  runSetup,
  listRoles,
  scanRoleRegistry,
  validateRolePackage,
  inspectRole,
  installRole,
  listInstalledRoles,
  removeRole,
  getRoleState,
  listRoleStates,
  readRoleState,
  updateRoleState,
  writeRoleState,
  createOpenClawAdapter,
  disableInstance,
  inspectInstance,
  listInstances,
  reconcileInstances,
  registerInstance,
  getInstanceState,
  listInstanceStates,
  readInstanceState,
  updateInstanceState,
  writeInstanceState,
  addTeamMember,
  assessTeamHealth,
  createTeam,
  deleteTeam,
  inspectTeam,
  listTeams,
  removeTeamMember,
  setTeamManager,
  updateTeam,
  createEmptyTeamState,
  getTeamState,
  listTeamStates,
  readTeamState,
  updateTeamState,
  writeTeamState,
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
  updateProject,
  createEmptyProjectState,
  getProjectState,
  listProjectStates,
  readProjectState,
  updateProjectState,
  writeProjectState,
  addTaskDependency,
  assignTask,
  cancelTask,
  completeTask,
  createTask,
  inspectTask,
  listTasks,
  removeTaskDependency,
  setTaskCritical,
  updateTask,
  createEmptyTaskState,
  getTaskState,
  listTaskStates,
  readTaskState,
  updateTaskState,
  writeTaskState,
  buildTaskGraph,
  calculateTaskBlocking,
  detectDependencyCycle,
  getReadyTaskCandidates,
  validateTaskDependencies,
  buildTaskExecutionPrompt,
  createOpenClawExecutionAdapter,
  createEmptyExecutionState,
  getRunState,
  inspectExecution,
  listActiveRuns,
  listExecutions,
  listRunStates,
  readExecutionState,
  reconcileExecutions,
  retryExecution,
  runTask,
  updateExecutionState,
  writeExecutionState
};
