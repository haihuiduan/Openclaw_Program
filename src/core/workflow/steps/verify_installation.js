// 安装 workflow 步骤：安装后读取 openclaw --version，确认命令可用。
const { runCommand } = require("../../../utils/shell");

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
    const result = await runCommand("openclaw", ["--version"], {
      allowFailure: true,
      timeoutMs: 5000
    });
    const version = (result.stdout + result.stderr).trim().split("\n")[0];
    ctx.logger.info("openclaw --version stdout：\n" + result.stdout);
    ctx.logger.info("openclaw --version stderr：\n" + result.stderr);

    if (result.code !== 0 || result.timedOut || !version) {
      return {
        success: false,
        message: "安装脚本已执行，但未能验证 openclaw 命令，请重新打开终端或检查 PATH。",
        finalMessage: "OpenClaw 安装脚本已执行，但未能验证 openclaw 命令。"
      };
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
