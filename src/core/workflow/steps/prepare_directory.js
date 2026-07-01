// 安装 workflow 步骤：准备 OpenClaw 目标安装目录。
const { createTargetDirectory } = require("../../installer/steps/createTargetDirectory");

module.exports = {
  id: "prepare_directory",
  name: "prepare_directory",
  condition: async () => true,
  skipIf: async () => false,
  retry: 0,
  onFail: "stop",
  label: "准备目标目录",
  retryable: true,
  timeout: 10000,
  async run(ctx) {
    const result = await createTargetDirectory(ctx.config);
    ctx.logger.info("目标目录准备完成：" + result.detail);

    return {
      success: true,
      message: "安装目录已准备：" + result.detail,
      data: {
        targetDirectoryStep: result
      }
    };
  }
};
