// workflow 步骤：执行 verify 基础验收，供 setup 等组合流程复用。
const { runVerify } = require("../../verify");

module.exports = {
  id: "run_verify",
  name: "run_verify",
  condition: async () => true,
  skipIf: async () => false,
  retry: 0,
  onFail: "stop",
  label: "验证 OpenClaw 是否可用",
  retryable: true,
  timeout: 10000,
  async run(ctx) {
    const verifyReport = await runVerify(ctx.config);
    ctx.logger.info("setup verify 验证结果：" + JSON.stringify(verifyReport));

    if (!verifyReport.ok) {
      return {
        success: false,
        message: verifyReport.message || "OpenClaw 基础验收未通过。",
        finalMessage: "OpenClaw 一键准备流程已停止：验证未通过。",
        data: {
          verifyReport
        }
      };
    }

    return {
      success: true,
      message: verifyReport.message || "OpenClaw 基础验收通过",
      data: {
        verifyReport
      }
    };
  }
};
