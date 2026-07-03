// 安装 workflow 步骤：用 bash 执行已下载到本地的官方安装脚本。
const { runCommand } = require("../../../utils/shell");

module.exports = {
  id: "execute_script",
  name: "execute_script",
  condition: async () => true,
  skipIf: async () => false,
  retry: 0,
  onFail: "stop",
  label: "执行官方安装脚本",
  retryable: false,
  async run(ctx) {
    const result = await runCommand("bash", [ctx.tempState.scriptPath], {
      allowFailure: true,
      timeoutMs: ctx.config.installScriptTimeoutMs || 120000
    });
    ctx.logger.info("官方安装脚本 stdout：\n" + result.stdout);
    ctx.logger.info("官方安装脚本 stderr：\n" + result.stderr);

    if (result.code !== 0 || result.timedOut) {
      const output = result.stderr || result.stdout;

      if (result.timedOut || containsOnboardingMarker(output)) {
        const installed = await readInstalledOpenClawVersion();

        if (installed.ok) {
          ctx.logger.warn("官方安装脚本可能进入 onboarding，但 openclaw --version 已可用：" + installed.version);
          return {
            success: true,
            message: "OpenClaw 本体已安装完成，下一步请配置 API。",
            data: {
              needsConfigure: true,
              installScriptResult: result,
              version: installed.version
            }
          };
        }
      }

      return {
        success: false,
        message: "官方安装脚本执行失败。错误摘要：" + summarizeOutput(output),
        finalMessage: "OpenClaw 安装失败：官方安装脚本执行失败。"
      };
    }

    return {
      success: true,
      message: "官方安装脚本执行完成",
      data: {
        installScriptResult: result
      }
    };
  }
};

async function readInstalledOpenClawVersion() {
  const result = await runCommand("openclaw", ["--version"], {
    allowFailure: true,
    timeoutMs: 5000
  });
  const version = (result.stdout + result.stderr).trim().split("\n")[0];

  return {
    ok: result.code === 0 && !result.timedOut && Boolean(version),
    version: version || null
  };
}

function containsOnboardingMarker(output) {
  return /openclaw-onboard|onboarding|starting setup|setup mode/i.test(String(output || ""));
}

function summarizeOutput(output) {
  const summary = String(output || "未提供错误详情")
    .trim()
    .split("\n")
    .filter(Boolean)
    .slice(0, 5)
    .join(" ");

  return summary || "未提供错误详情";
}
