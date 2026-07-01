// GUI 服务层：统一封装 GUI 对 core 能力的调用，main 只负责 IPC 路由。
const { runDoctor: runCoreDoctor } = require("../../core/doctor");
const { runWorkflow } = require("../../core/workflow/engine");

function runDoctor(config) {
  return runCoreDoctor(config);
}

function runInstall(configOrProgress, maybeOnProgress) {
  return runNamedWorkflow("install", configOrProgress, maybeOnProgress);
}

function runSetup(configOrProgress, maybeOnProgress) {
  return runNamedWorkflow("setup", configOrProgress, maybeOnProgress);
}

function runNamedWorkflow(workflowName, configOrProgress, maybeOnProgress) {
  const config = typeof configOrProgress === "function" ? {} : configOrProgress;
  const onProgress = typeof configOrProgress === "function" ? configOrProgress : maybeOnProgress;

  return runWorkflow(workflowName, { config }, onProgress);
}

module.exports = {
  runDoctor,
  runInstall,
  runSetup
};
