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
      allowFailure: true
    });
    ctx.logger.info("官方安装脚本 stdout：\n" + result.stdout);
    ctx.logger.info("官方安装脚本 stderr：\n" + result.stderr);

    if (result.code !== 0) {
      return {
        success: false,
        message: "官方安装脚本执行失败。错误摘要：" + summarizeOutput(result.stderr || result.stdout),
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

function summarizeOutput(output) {
  const summary = String(output || "未提供错误详情")
    .trim()
    .split("\n")
    .filter(Boolean)
    .slice(0, 5)
    .join(" ");

  return summary || "未提供错误详情";
}
