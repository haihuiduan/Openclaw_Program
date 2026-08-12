// 安装 workflow 步骤：安装后读取 openclaw --version，确认命令可用。
const path = require("node:path");
const { getCommandEnv, resolveCommand, runCommand } = require("../../../utils/shell");

module.exports = {
  id: "verify_installation",
  name: "verify_installation",
  condition: async () => true,
  skipIf: async () => false,
  retry: 0,
  onFail: "stop",
  label: "验证 openclaw 命令",
  retryable: true,
  timeout: 5000,
  async run(ctx) {
    const resolution = await resolveCommand("openclaw", {
      diagnosticLogger: ctx.diagnosticLogger,
      env: ctx.installEnvironment
    });
    ctx.diagnosticLogger.event("openclaw_verification_path", {
      resolvedPath: resolution.resolvedPath,
      found: resolution.found,
      effectivePrefix: ctx.installEnvironment
        && ctx.installEnvironment.NPM_CONFIG_PREFIX,
      prefixBinInPath: Boolean(
        ctx.installEnvironment
        && ctx.installEnvironment.NPM_CONFIG_PREFIX
        && ctx.installEnvironment.PATH
          .split(path.delimiter)
          .includes(
            path.join(
              ctx.installEnvironment.NPM_CONFIG_PREFIX,
              "bin"
            )
          )
      )
    });
    ctx.diagnosticLogger.event("install_verification_start", {
      commandPath: getCommandEnv(
        ctx.installEnvironment || process.env
      ).PATH,
      resolution
    });
    const result = await runCommand(
      resolution.resolvedPath || "openclaw",
      ["--version"],
      {
        allowFailure: true,
        timeoutMs: 5000,
        diagnosticLogger: ctx.diagnosticLogger,
        env: ctx.installEnvironment
      }
    );
    const version = (result.stdout + result.stderr).trim().split("\n")[0];
    ctx.logger.info("openclaw --version stdout：\n" + result.stdout);
    ctx.logger.info("openclaw --version stderr：\n" + result.stderr);

    if (result.code !== 0 || result.timedOut || !version) {
      const failure = classifyVerificationFailure(resolution, result);
      ctx.diagnosticLogger.error("install_verification_failure", {
        ...failure,
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        spawnError: result.spawnError,
        stderrSummary: String(result.stderr || "").trim().slice(0, 2000)
      });
      return {
        success: false,
        message: failure.userMessage,
        finalMessage: "OpenClaw 安装脚本已执行，但未能验证 openclaw 命令。",
        ...failure,
        commandResult: result
      };
    }

    ctx.diagnosticLogger.event("install_verification_success", {
      resolvedPath: resolution.resolvedPath,
      exitCode: result.exitCode,
      signal: result.signal,
      durationMs: result.durationMs,
      version
    });
    if (typeof ctx.diagnosticLogger.recordGatewaySnapshot === "function") {
      const installEnvironment = ctx.installEnvironment || {};
      const stateDir = installEnvironment.OPENCLAW_STATE_DIR || path.join(installEnvironment.HOME || "~", ".openclaw");
      ctx.diagnosticLogger.recordGatewaySnapshot("T0_install_complete", {
        openClawVersion: version,
        executable: resolution.resolvedPath,
        configPath: installEnvironment.OPENCLAW_CONFIG_PATH || path.join(stateDir, "openclaw.json"),
        stateDir,
        configPathOverridePresent: Boolean(installEnvironment.OPENCLAW_CONFIG_PATH),
        stateDirOverridePresent: Boolean(installEnvironment.OPENCLAW_STATE_DIR),
        profilePresent: Boolean(installEnvironment.OPENCLAW_PROFILE),
        gatewayMode: null,
        gatewayAuthMode: null,
        configTokenPresent: null,
        configTokenType: "unknown",
        processEnvGatewayTokenPresent: Boolean(installEnvironment.OPENCLAW_GATEWAY_TOKEN),
        serviceEnvGatewayTokenPresent: null,
        gatewayRuntimeTokenSource: "unknown",
        cliProbeTokenSource: "unknown",
        runtimeVsCliTokenEqual: "unknown"
      });
    }
    return {
      success: true,
      message: version,
      data: {
        version,
        verificationResult: result
      }
    };
  }
};

function classifyVerificationFailure(resolution, result) {
  if (!resolution.found || (result.spawnError && result.spawnError.code === "ENOENT")) {
    return {
      errorCode: "OPENCLAW_INSTALL_COMMAND_NOT_FOUND",
      userMessage: "安装脚本已执行，但当前应用环境仍找不到 openclaw 命令。",
      technicalMessage: "openclaw command resolution failed"
    };
  }

  if (result.timedOut) {
    return {
      errorCode: "OPENCLAW_INSTALL_VERIFY_TIMEOUT",
      userMessage: "验证 OpenClaw 安装结果时超时。",
      technicalMessage: "openclaw --version timed out"
    };
  }

  if (result.spawnError) {
    return {
      errorCode: "OPENCLAW_INSTALL_VERIFY_EXEC_FAILED",
      userMessage: "已找到 openclaw 命令，但无法启动它。",
      technicalMessage: "openclaw spawn failed: " + result.spawnError.code
    };
  }

  if (result.exitCode !== 0) {
    return {
      errorCode: "OPENCLAW_INSTALL_VERIFY_NONZERO_EXIT",
      userMessage: "openclaw 命令返回错误，安装结果未通过验证。",
      technicalMessage: "openclaw --version exitCode=" + String(result.exitCode)
    };
  }

  return {
    errorCode: "OPENCLAW_INSTALL_VERIFY_FAILED",
    userMessage: "未能读取 OpenClaw 版本，安装结果未通过验证。",
    technicalMessage: "openclaw --version returned no version"
  };
}

module.exports.classifyVerificationFailure = classifyVerificationFailure;
