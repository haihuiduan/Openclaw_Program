// setup 输出格式化器：把一键准备流程结果转成中文终端文案。

function formatSetupResult(result) {
  if (result.dryRun) {
    return [
      "OpenClaw 一键准备流程预览",
      "",
      "将执行：",
      "1. 检测环境和依赖",
      "2. 安装 OpenClaw，已安装则跳过",
      "3. 启动 OpenClaw 官方配置向导",
      "4. 验证 OpenClaw 是否可用",
      "",
      "说明：",
      "默认 setup 不会自动填写 API Key。",
      "配置阶段会调用 OpenClaw 官方配置向导。",
      "",
      "结论：",
      "dry-run 已完成，没有修改任何文件。"
    ].join("\n");
  }

  if (!result.ok && result.stage === "doctor") {
    return [
      "OpenClaw 一键准备流程已停止",
      "",
      "原因：",
      "环境检测未通过，请先根据 doctor 报告修复问题。",
      "",
      "建议：",
      "运行 node bin/cli.js doctor 查看详细问题。"
    ].join("\n");
  }

  if (!result.ok && result.stage === "install") {
    return [
      "OpenClaw 一键准备流程已停止",
      "",
      "原因：",
      "OpenClaw 安装失败。",
      "",
      "建议：",
      "查看安装日志，或运行 node bin/cli.js install 重试。"
    ].join("\n");
  }

  return [
    "OpenClaw 安装准备已完成。",
    "",
    "下一步：",
    "1. 运行 node bin/cli.js configure 启动官方配置向导",
    "2. 配置完成后运行 node bin/cli.js verify 验证是否可用"
  ].join("\n");
}

module.exports = {
  formatSetupResult
};
