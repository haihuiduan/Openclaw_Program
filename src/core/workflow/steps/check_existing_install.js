// 安装 workflow 步骤：检查系统中是否已经存在官方 openclaw 命令。
const { resolveCommand, runCommand } = require("../../../utils/shell");

module.exports = {
  id: "check_existing_install",
  name: "check_existing_install",
  condition: async () => true,
  skipIf: async () => false,
  retry: 0,
  onFail: "stop",
  label: "检查是否已安装",
  retryable: true,
  timeout: 10000,
  async run(ctx) {
    const existing = await detectExistingOpenClaw(ctx);
    ctx.logger.info("已有 OpenClaw 检测：" + JSON.stringify(existing));

    if (existing.installed) {
      const installedMessage = existing.version
        ? "检测到 OpenClaw 已安装，当前版本：" + existing.version
        : "检测到 OpenClaw 已安装";

      if (ctx.config && ctx.config.forceInstall) {
        return {
          success: true,
          message: installedMessage + "，将继续通过官方安装脚本检查更新",
          data: {
            existingOpenClaw: existing,
            installedMessage
          }
        };
      }

      return {
        success: true,
        message: installedMessage,
        data: {
          existingOpenClaw: existing,
          installedMessage,
          skipRemainingInstallSteps: true
        }
      };
    }

    return {
      success: true,
      message: "未检测到 OpenClaw，将继续安装",
      data: {
        existingOpenClaw: existing
      }
    };
  }
};

async function detectExistingOpenClaw(ctx) {
  const resolution = await resolveCommand("openclaw", {
    diagnosticLogger: ctx && ctx.diagnosticLogger,
    env: ctx && ctx.installEnvironment
  });

  if (!resolution.found || !resolution.resolvedPath) {
    return {
      installed: false,
      version: null
    };
  }

  const result = await runCommand(resolution.resolvedPath, ["--version"], {
    allowFailure: true,
    timeoutMs: 3000,
    diagnosticLogger: ctx && ctx.diagnosticLogger,
    env: ctx && ctx.installEnvironment
  });
  const version = (result.stdout + result.stderr).trim().split("\n")[0];
  const installed = Boolean(
    result.code === 0 &&
    !result.timedOut &&
    !result.spawnError &&
    version
  );

  return {
    installed,
    version: installed ? version : null
  };
}
