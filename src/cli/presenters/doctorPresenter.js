// doctor 输出格式化器：把环境检查结果变成适合终端阅读的文字。
// 它只负责展示，不决定检查规则，也不执行任何检测。

const categoryTitles = [
  ["runtime", "基础环境"],
  ["dependency", "基础环境"],
  ["system", "系统信息"],
  ["openclaw", "OpenClaw 状态"],
  ["network", "网络状态"],
  ["directory", "安装目录"]
];

const levelLabels = {
  pass: "通过",
  warning: "警告",
  fail: "失败",
  info: "提示"
};

/**
 * 格式化 doctor 报告。
 * 输入：core/doctor 返回的 report 对象。
 * 输出：多行字符串，CLI 会直接打印到终端。
 */
function formatDoctorReport(report) {
  const lines = ["OpenClaw 环境检测报告"];
  const printedTitles = new Set();

  for (const [category, title] of categoryTitles) {
    const checks = report.checks.filter((check) => check.category === category);

    if (checks.length === 0) {
      continue;
    }

    if (!printedTitles.has(title)) {
      lines.push("", `${title}：`);
      printedTitles.add(title);
    }

    for (const check of checks) {
      lines.push(formatCheck(check));
    }
  }

  const repairableIssues = report.checks.filter((check) => {
    return check.repairable && (check.level === "fail" || check.level === "warning");
  });

  if (repairableIssues.length > 0) {
    lines.push("", "可修复项：");
    lines.push("检测到一些后续可修复的问题。repair 功能将在后续版本提供。");
  }

  lines.push("", "结论：");
  lines.push(formatConclusion(report));

  return lines.join("\n");
}

function formatCheck(check) {
  const label = levelLabels[check.level] || "提示";
  return `[${label}] ${check.name} - ${check.message}`;
}

function formatConclusion(report) {
  const hasFail = report.checks.some((check) => check.level === "fail");
  const hasWarning = report.checks.some((check) => check.level === "warning");

  if (hasFail) {
    return "当前环境检测未通过，请先处理失败项后重新运行 openclaw-installer doctor。";
  }

  if (hasWarning) {
    return "当前环境可以继续，但存在一些可能影响安装或使用的风险。";
  }

  return "当前环境满足基本要求，可以继续安装或使用 OpenClaw。";
}

module.exports = {
  formatDoctorReport
};
