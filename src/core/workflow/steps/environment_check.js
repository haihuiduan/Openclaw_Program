// 安装 workflow 步骤：运行 doctor，确认当前电脑具备安装 OpenClaw 的基础条件。
const { runDoctor } = require("../../doctor");

module.exports = {
  id: "environment_check",
  name: "environment_check",
  condition: async () => true,
  skipIf: async (ctx) => Boolean(ctx.doctorReport),
  retry: 0,
  onFail: "stop",
  label: "环境检查",
  retryable: true,
  timeout: 30000,
  async run(ctx) {
    const doctorReport = await runDoctor(ctx.config);
    ctx.logger.info("doctor 检测结果：" + JSON.stringify(doctorReport));

    if (!doctorReport.ok) {
      return {
        success: false,
        message: "当前电脑环境未通过检测，请先处理 doctor 报告中的失败项。",
        finalMessage: "OpenClaw 安装已停止：环境检测未通过。",
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
