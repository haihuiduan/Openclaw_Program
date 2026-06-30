// verify 输出格式化器：把基础验收结果转成中文终端报告。
const levelLabels = {
  pass: "通过",
  warning: "警告",
  fail: "失败",
  info: "提示"
};

function formatVerifyReport(report) {
  if (report.dryRun) {
    return [
      "OpenClaw 验证预览",
      "",
      "将检查：",
      "1. openclaw 命令是否存在",
      "2. openclaw --version 是否可用",
      "3. openclaw config file 是否能读取配置路径",
      "",
      "dry-run 已完成，没有执行任何检查命令。"
    ].join("\n");
  }

  const lines = [
    "OpenClaw 验证报告",
    "",
    "检查结果："
  ];

  for (const check of report.checks) {
    const label = levelLabels[check.level] || "提示";
    lines.push("[" + label + "] " + check.name + " - " + check.message);
  }

  lines.push("", "结论：");

  if (!report.ok) {
    lines.push("OpenClaw 基础验收未通过，请先处理失败项。");
  } else if (report.checks.some((check) => check.level === "warning")) {
    lines.push("OpenClaw 已安装并可以基本使用，但存在需要留意的提示。");
  } else {
    lines.push("OpenClaw 已安装并可以基本使用。");
  }

  return lines.join("\n");
}

module.exports = {
  formatVerifyReport
};
