// workflow 步骤：执行 doctor 环境检测，供 setup 等组合流程复用。
const { runDoctor } = require("../../doctor");

module.exports = {
  id: "run_doctor",
  name: "run_doctor",
  condition: async () => true,
  skipIf: async () => false,
  retry: 0,
  onFail: "stop",
  label: "运行环境检测",
  retryable: true,
  timeout: 30000,
  async run(ctx) {
    const doctorReport = await runDoctor(ctx.config);
    ctx.logger.info("setup doctor 检测结果：" + JSON.stringify(doctorReport));

    if (!doctorReport.ok) {
      return {
        success: false,
        message: "环境检测未通过，请先根据 doctor 报告修复问题。",
        finalMessage: "OpenClaw 一键准备流程已停止：环境检测未通过。",
        data: {
          doctorReport
        }
      };
    }

    return {
      success: true,
      message: "环境检测通过",
      data: {
        doctorReport
      }
    };
  }
};
