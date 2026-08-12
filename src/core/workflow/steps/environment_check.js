// 安装 workflow 步骤：运行 doctor，确认当前电脑具备安装 OpenClaw 的基础条件。
const { runDoctor } = require("../../doctor");
const { ensureWritableNpmPrefix } = require("../npmPrefix");

module.exports = {
  id: "environment_check",
  name: "environment_check",
  condition: async () => true,
  skipIf: async () => false,
  retry: 0,
  onFail: "stop",
  label: "环境检查",
  retryable: true,
  timeout: 30000,
  async run(ctx) {
    const npmPrefix = await ensureWritableNpmPrefix(ctx);

    if (!npmPrefix.success) {
      return {
        success: false,
        message: npmPrefix.message,
        finalMessage: "OpenClaw 安装已停止：npm 安装环境准备失败。",
        errorCode: npmPrefix.errorCode,
        userMessage: "无法自动准备当前用户的 npm 安装环境。",
        technicalMessage: npmPrefix.errorCode,
        data: {
          npmPrefix
        }
      };
    }

    ctx.installEnvironment = npmPrefix.environment;
    ctx.commandEnv = npmPrefix.environment;
    const doctorReport = ctx.doctorReport || await runDoctor({
      ...ctx.config,
      diagnosticLogger: ctx.diagnosticLogger,
      commandEnv: npmPrefix.environment
    });
    ctx.logger.info("doctor 检测结果：" + JSON.stringify(doctorReport));

    if (!doctorReport.ok) {
      return {
        success: false,
        message: "当前电脑环境未通过检测，请先处理 doctor 报告中的失败项。",
        finalMessage: "OpenClaw 安装已停止：环境检测未通过。",
        errorCode: "OPENCLAW_INSTALL_ENVIRONMENT_FAILED",
        userMessage: "当前电脑缺少安装所需的基础环境，请查看环境检查结果。",
        technicalMessage: "doctor 环境检测包含失败项。",
        data: {
          doctorReport
        }
      };
    }

    return {
      success: true,
      message: "环境检测通过，已准备用户级 npm 安装环境",
      data: {
        doctorReport,
        npmPrefix,
        installEnvironment: npmPrefix.environment,
        commandEnv: npmPrefix.environment
      }
    };
  }
};
