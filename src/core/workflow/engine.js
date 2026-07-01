// workflow engine：按 registry 中的流程定义执行步骤，并支持条件、跳过、重试、失败策略和恢复执行。
const fs = require("node:fs/promises");

const { createInstallLogger } = require("../../utils/installLogger");
const { getWorkflow } = require("./registry");
const {
  clearState,
  loadState,
  saveState,
  shouldResumeState
} = require("./runtime");

async function runWorkflow(workflow, context, onProgress) {
  const definition = getWorkflow(workflow);

  if (!definition) {
    throw new Error("未知 workflow：" + workflow);
  }

  const steps = definition.steps || [];
  const ctx = {
    ...(context || {}),
    workflow: definition.id,
    workflowLabel: definition.label,
    steps: [],
    tempState: {
      dir: null,
      scriptPath: null
    }
  };
  ctx.config = ctx.config || {};
  ctx.logger = ctx.logger || createInstallLogger({
    logDir: ctx.config.logDir
  });

  const savedState = await loadState(ctx);
  if (shouldResumeState(savedState, definition.id, ctx.config)) {
    ctx.resumeState = savedState;
    ctx.resumeFromStep = savedState.failedStep;
    ctx.completedFromState = new Set(savedState.completedSteps || []);
    ctx.tempState = {
      ...ctx.tempState,
      ...(savedState.tempState || {})
    };
    ctx.logger.info("workflow 从 checkpoint 恢复，失败步骤：" + ctx.resumeFromStep);
  } else {
    ctx.completedFromState = new Set();
  }

  ctx.logger.info("GUI 安装开始时间：" + new Date().toISOString());
  ctx.logger.info("平台信息：platform=" + process.platform + ", arch=" + process.arch + ", node=" + process.versions.node);
  ctx.logger.info("targetDir：" + ctx.config.targetDir);

  function emit(step, status, message, startedAt, extra) {
    const stepId = getStepId(step);
    const update = {
      name: stepId,
      id: stepId,
      label: step.label || stepId,
      status,
      message,
      retryable: Boolean(step.retryable),
      retry: normalizeRetry(step.retry),
      onFail: step.onFail || "stop",
      timeout: step.timeout,
      duration: startedAt ? Date.now() - startedAt : undefined,
      ...(extra || {})
    };
    const existingIndex = ctx.steps.findIndex((item) => item.name === stepId);

    if (existingIndex >= 0) {
      ctx.steps[existingIndex] = update;
    } else {
      ctx.steps.push(update);
    }

    if (onProgress) {
      onProgress(update);
    }

    return update;
  }

  try {
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      const stepId = getStepId(step);
      const startedAt = Date.now();

      if (ctx.completedFromState.has(stepId)) {
        emit(step, "skipped", "已从 checkpoint 恢复，跳过已完成步骤。", startedAt, {
          resumed: true,
          resumedFromStep: ctx.resumeFromStep
        });
        continue;
      }

      const gateResult = await evaluateStepGates(step, ctx);

      if (!gateResult.success) {
        emit(step, "fail", gateResult.message, startedAt);
        ctx.failedStep = stepId;
        ctx.runtimeFailed = true;
        await saveState(ctx, {
          failedStep: stepId
        });

        return {
          success: false,
          ok: false,
          steps: ctx.steps,
          finalMessage: gateResult.finalMessage || "OpenClaw 安装失败。",
          error: gateResult.message,
          logPath: ctx.logger.getLogPath()
        };
      }

      if (gateResult.skipped) {
        emit(step, "skipped", gateResult.message, startedAt);
        await saveState(ctx, {
          failedStep: null
        });
        continue;
      }

      const result = await executeStepWithPolicy(step, ctx, startedAt, emit);

      if (result && result.data) {
        Object.assign(ctx, result.data);
      }

      if (!result || !result.success) {
        const message = result && result.message ? result.message : "步骤执行失败。";

        if (getFailStrategy(step) === "continue") {
          emit(step, "fail", message, startedAt);
          await saveState(ctx, {
            failedStep: stepId
          });
          continue;
        }

        emit(step, "fail", message, startedAt);
        ctx.failedStep = stepId;
        ctx.runtimeFailed = true;
        await saveState(ctx, {
          failedStep: stepId
        });

        return {
          success: false,
          ok: false,
          steps: ctx.steps,
          finalMessage: result && result.finalMessage ? result.finalMessage : "OpenClaw 安装失败。",
          error: message,
          logPath: ctx.logger.getLogPath()
        };
      }

      emit(step, "success", result.message, startedAt);
      await saveState(ctx, {
        failedStep: null
      });

      if (ctx.skipRemainingInstallSteps) {
        while (index + 1 < steps.length && isInstallContinuationStep(steps[index + 1])) {
          index += 1;
          emit(steps[index], "success", "已安装，跳过此步骤");
          await saveState(ctx, {
            failedStep: null
          });
        }

        ctx.skipRemainingInstallSteps = false;

        if (index + 1 >= steps.length) {
          ctx.workflowSucceeded = true;
          await clearState(ctx);

          return {
            success: true,
            ok: true,
            steps: ctx.steps,
            finalMessage: ctx.installedMessage + "。本次未重复安装。",
            logPath: ctx.logger.getLogPath()
          };
        }
      }
    }

    ctx.workflowSucceeded = true;
    await clearState(ctx);

    return {
      success: true,
      ok: true,
      steps: ctx.steps,
      finalMessage: getSuccessMessage(ctx),
      version: ctx.version,
      logPath: ctx.logger.getLogPath()
    };
  } finally {
    if (!ctx.runtimeFailed) {
      await cleanupTempDirectory(ctx.tempState.dir);
    }
  }
}

async function executeStepWithPolicy(step, ctx, startedAt, emit) {
  const retryCount = normalizeRetry(step.retry);
  const shouldRetry = getFailStrategy(step) === "retry";
  const maxAttempts = shouldRetry ? retryCount + 1 : 1;
  let lastResult = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    emit(step, "running", getRunningMessage(step, ctx), startedAt, {
      attempt,
      maxAttempts,
      resumed: Boolean(ctx.resumeFromStep && getStepId(step) === ctx.resumeFromStep),
      resumedFromStep: ctx.resumeFromStep
    });

    lastResult = await runStepSafely(step, ctx);

    if (lastResult && lastResult.success) {
      return lastResult;
    }

    if (shouldRetry && attempt < maxAttempts) {
      const message = lastResult && lastResult.message ? lastResult.message : "步骤执行失败，准备重试。";
      emit(step, "retry", message, startedAt, {
        attempt,
        nextAttempt: attempt + 1,
        maxAttempts
      });
    }
  }

  return lastResult;
}

async function runStepSafely(step, ctx) {
  try {
    return await step.run(ctx);
  } catch (error) {
    return {
      success: false,
      message: error && error.message ? error.message : String(error),
      finalMessage: error && error.finalMessage ? error.finalMessage : "OpenClaw 安装失败。"
    };
  }
}

async function evaluateStepGates(step, ctx) {
  const skipResult = await evaluateGate(step, ctx, "skipIf");

  if (!skipResult.success) {
    return skipResult;
  }

  if (skipResult.value) {
    return {
      success: true,
      skipped: true,
      message: "已跳过：满足 skipIf 条件。"
    };
  }

  const conditionResult = await evaluateGate(step, ctx, "condition");

  if (!conditionResult.success) {
    return conditionResult;
  }

  if (conditionResult.exists && !conditionResult.value) {
    return {
      success: true,
      skipped: true,
      message: "已跳过：condition 条件未满足。"
    };
  }

  return {
    success: true,
    skipped: false
  };
}

async function evaluateGate(step, ctx, field) {
  if (typeof step[field] !== "function") {
    return {
      success: true,
      exists: false,
      value: false
    };
  }

  try {
    return {
      success: true,
      exists: true,
      value: Boolean(await step[field](ctx))
    };
  } catch (error) {
    return {
      success: false,
      message: field + " 判断失败：" + (error && error.message ? error.message : String(error)),
      finalMessage: "OpenClaw 安装失败：流程条件判断失败。"
    };
  }
}

function getSuccessMessage(ctx) {
  if (ctx.workflow === "setup") {
    return "OpenClaw 一键准备流程已完成。";
  }

  return "OpenClaw 安装完成。当前版本：" + ctx.version;
}

function isInstallContinuationStep(step) {
  return [
    "prepare_directory",
    "download_script",
    "execute_script",
    "verify_installation"
  ].includes(getStepId(step));
}

function getRunningMessage(step, ctx) {
  const stepId = getStepId(step);

  if (ctx.resumeFromStep && stepId === ctx.resumeFromStep) {
    return "从失败步骤 " + stepId + " 继续执行...";
  }

  return "正在执行...";
}

function getFailStrategy(step) {
  if (["stop", "continue", "retry"].includes(step.onFail)) {
    return step.onFail;
  }

  return "stop";
}

function normalizeRetry(retry) {
  const value = Number(retry);

  if (!Number.isInteger(value) || value < 0) {
    return 0;
  }

  return value;
}

function getStepId(step) {
  return step.id || step.name;
}

async function cleanupTempDirectory(dir) {
  if (!dir) {
    return;
  }

  try {
    await fs.rm(dir, {
      force: true,
      recursive: true
    });
  } catch (error) {
    // 清理临时目录失败不影响安装结果。
  }
}

module.exports = {
  runWorkflow
};
