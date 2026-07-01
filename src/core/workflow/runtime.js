// workflow runtime：负责保存、读取和恢复 workflow 执行状态。
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const DEFAULT_STATE_PATH = path.join(os.homedir(), ".openclaw-installer", "workflow-state.json");

async function saveState(ctx, update = {}) {
  const statePath = getStatePath(ctx);
  const state = buildState(ctx, update);

  try {
    await fs.mkdir(path.dirname(statePath), {
      recursive: true
    });
    await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
    return state;
  } catch (error) {
    if (ctx && ctx.logger) {
      ctx.logger.warn("workflow checkpoint 写入失败：" + (error && error.message ? error.message : String(error)));
    }

    return null;
  }
}

async function loadState(options = {}) {
  const statePath = getStatePath(options);

  try {
    const content = await fs.readFile(statePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    return null;
  }
}

async function clearState(options = {}) {
  const statePath = getStatePath(options);

  try {
    await fs.unlink(statePath);
  } catch (error) {
    // 没有历史状态或清理失败都不影响主流程。
  }
}

async function resumeWorkflow(workflow, context = {}, onProgress) {
  const { runWorkflow } = require("./engine");

  return runWorkflow(workflow, {
    ...context,
    resume: true
  }, onProgress);
}

function shouldResumeState(state, workflow, config = {}) {
  if (!state || state.workflow !== workflow || !state.failedStep) {
    return false;
  }

  const savedTargetDir = state.config && state.config.targetDir;
  const currentTargetDir = config && config.targetDir;

  if (savedTargetDir && currentTargetDir && savedTargetDir !== currentTargetDir) {
    return false;
  }

  return true;
}

function buildState(ctx, update) {
  const stepProgress = Array.isArray(ctx.steps) ? ctx.steps : [];
  const completedSteps = stepProgress
    .filter((step) => step.status === "success" || step.status === "skipped")
    .map((step) => step.id || step.name)
    .filter(Boolean);

  return {
    workflow: ctx.workflow,
    workflowLabel: ctx.workflowLabel,
    stepProgress,
    completedSteps: Array.from(new Set(completedSteps)),
    failedStep: Object.prototype.hasOwnProperty.call(update, "failedStep") ? update.failedStep : ctx.failedStep || null,
    tempState: ctx.tempState || {},
    config: {
      targetDir: ctx.config && ctx.config.targetDir
    },
    timestamp: new Date().toISOString()
  };
}

function getStatePath(input = {}) {
  if (input.statePath) {
    return input.statePath;
  }

  if (input.runtimeStatePath) {
    return input.runtimeStatePath;
  }

  if (input.config && input.config.runtimeStatePath) {
    return input.config.runtimeStatePath;
  }

  return DEFAULT_STATE_PATH;
}

module.exports = {
  DEFAULT_STATE_PATH,
  clearState,
  loadState,
  resumeWorkflow,
  saveState,
  shouldResumeState
};
