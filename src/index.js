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
  writeRoleState
};
