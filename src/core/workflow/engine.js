// workflow engine：按 registry 中的流程定义执行步骤，并支持条件、跳过、重试、失败策略和恢复执行。
const fs = require("node:fs/promises");

const { createInstallLogger } = require("../../utils/installLogger");
const { createInstallDiagnosticLogger } = require("../../utils/installDiagnosticLogger");
const { getCommandEnv, resolveCommand } = require("../../utils/shell");
const { getWorkflow } = require("./registry");
const {
  clearState,
  loadState,
  saveState,
  shouldResumeState
} = require("./runtime");

const FORCED_INSTALL_RESUME_STEPS = new Set([
  "environment_check",
  "check_existing_install"
]);

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
  ctx.diagnosticLogger = ctx.diagnosticLogger || createInstallDiagnosticLogger({
    logPath: ctx.config.diagnosticLogPath
  });
  if (typeof ctx.diagnosticLogger.beginDiagnosticRun === "function") {
    ctx.diagnosticLogger.beginDiagnosticRun({ workflowId: definition.id });
  }

  const savedState = await loadState(ctx);
  if (shouldResumeState(savedState, definition.id, ctx.config)) {
    ctx.resumeState = savedState;
    ctx.resumeFromStep = savedState.failedStep;
    ctx.completedFromState = new Set(
      (savedState.completedSteps || []).filter(
        (stepId) => !FORCED_INSTALL_RESUME_STEPS.has(stepId)
      )
    );
    ctx.tempState = {
      ...ctx.tempState,
      ...(savedState.tempState || {})
    };
    ctx.logger.info("workflow 从 checkpoint 恢复，失败步骤：" + ctx.resumeFromStep);
    ctx.diagnosticLogger.event("workflow_checkpoint_resume", {
      workflowId: definition.id,
      failedStepId: ctx.resumeFromStep,
      checkpointSchemaVersion: savedState.schemaVersion || null,
      checkpointEnvironmentVersion: savedState.environmentVersion || null,
      forcedSteps: Array.from(FORCED_INSTALL_RESUME_STEPS)
    });
  } else {
    ctx.completedFromState = new Set();
  }

  ctx.logger.info("GUI 安装开始时间：" + new Date().toISOString());
  ctx.logger.info("平台信息：platform=" + process.platform + ", arch=" + process.arch + ", node=" + process.versions.node);
  ctx.logger.info("targetDir：" + ctx.config.targetDir);
  ctx.diagnosticLogger.event("workflow_start", {
    workflowId: definition.id,
    workflowName: definition.label,
    commandPath: getCommandEnv(process.env).PATH
  });
  await diagnoseInstallCommands(ctx);

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
      ctx.diagnosticLogger.event("workflow_step_start", {
        workflowId: definition.id,
        stepId,
        stepName: step.label || stepId
      });

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
        const failure = buildFailureDetails(step, gateResult, gateResult.message);
        ctx.diagnosticLogger.error("workflow_step_failure", {
          workflowId: definition.id,
          ...failure,
          durationMs: Date.now() - startedAt
        });
        await saveState(ctx, {
          failedStep: stepId
        });

        return {
          success: false,
          ok: false,
          steps: ctx.steps,
          finalMessage: gateResult.finalMessage || "OpenClaw 安装失败。",
          error: gateResult.message,
          ...failure,
          logPath: ctx.logger.getLogPath(),
          diagnosticLogPath: ctx.diagnosticLogger.getLogPath()
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
        const failure = buildFailureDetails(step, result, message);
        ctx.diagnosticLogger.error("workflow_step_failure", {
          workflowId: definition.id,
          ...failure,
          durationMs: Date.now() - startedAt
        });
        await saveState(ctx, {
          failedStep: stepId
        });

        return {
          success: false,
          ok: false,
          steps: ctx.steps,
          finalMessage: result && result.finalMessage ? result.finalMessage : "OpenClaw 安装失败。",
          error: message,
          ...failure,
          logPath: ctx.logger.getLogPath(),
          diagnosticLogPath: ctx.diagnosticLogger.getLogPath()
        };
      }

      emit(step, "success", result.message, startedAt);
      ctx.diagnosticLogger.event("workflow_step_success", {
        workflowId: definition.id,
        stepId,
        stepName: step.label || stepId,
        durationMs: Date.now() - startedAt
      });
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
            logPath: ctx.logger.getLogPath(),
            diagnosticLogPath: ctx.diagnosticLogger.getLogPath()
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
      logPath: ctx.logger.getLogPath(),
      diagnosticLogPath: ctx.diagnosticLogger.getLogPath()
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
      finalMessage: error && error.finalMessage ? error.finalMessage : "OpenClaw 安装失败。",
      errorCode: resolveThrownErrorCode(error),
      technicalMessage: error && error.message ? error.message : "步骤执行异常",
      commandResult: error && error.result ? error.result : null
    };
  }
}

async function diagnoseInstallCommands(ctx) {
  if (!["install", "setup"].includes(ctx.workflow)) {
    return;
  }

  const commands = ["node", "npm", "npx", "git", "bash", "zsh", "curl", "openclaw"];

  for (const command of commands) {
    try {
      const resolution = await resolveCommand(command, {
        diagnosticLogger: ctx.diagnosticLogger
      });
      ctx.diagnosticLogger.event("command_resolution", resolution);
    } catch (error) {
      ctx.diagnosticLogger.error("command_resolution", {
        command,
        found: false,
        resolvedPath: null,
        exitCode: null,
        signal: null,
        spawnError: error && error.code ? { code: error.code } : { code: "UNKNOWN" }
      });
    }
  }
}

function buildFailureDetails(step, result, fallbackMessage) {
  const commandResult = result && result.commandResult ? result.commandResult : null;
  const spawnError = commandResult && commandResult.spawnError;
  const errorCode = result && result.errorCode
    ? result.errorCode
    : spawnError && spawnError.code === "ENOENT"
      ? "OPENCLAW_INSTALL_COMMAND_NOT_FOUND"
      : "OPENCLAW_INSTALL_STEP_FAILED";

  return {
    failedStepId: getStepId(step),
    failedStepName: step.label || getStepId(step),
    errorCode,
    userMessage: result && result.userMessage ? result.userMessage : fallbackMessage,
    technicalMessage: result && result.technicalMessage
      ? result.technicalMessage
      : fallbackMessage,
    commandResult: summarizeCommandResult(commandResult)
  };
}

function summarizeCommandResult(result) {
  if (!result) {
    return null;
  }

  return {
    command: result.command,
    exitCode: result.exitCode === undefined ? result.code : result.exitCode,
    signal: result.signal || null,
    timedOut: Boolean(result.timedOut),
    spawnError: result.spawnError || null,
    durationMs: result.durationMs
  };
}

function resolveThrownErrorCode(error) {
  if (error && error.code === "EACCES") {
    return "OPENCLAW_INSTALL_PERMISSION_DENIED";
  }

  if (error && error.code === "ENOENT") {
    return "OPENCLAW_INSTALL_COMMAND_NOT_FOUND";
  }

  return error && error.code ? String(error.code) : "OPENCLAW_INSTALL_STEP_FAILED";
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
