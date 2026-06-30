// OpenClaw 安装状态检测：只判断是否已安装，不做更新或修复。
const { commandExists, runCommand } = require("../../../utils/shell");

async function checkOpenClawStatus() {
  const installed = await commandExists("openclaw");

  if (!installed) {
    return {
      name: "OpenClaw",
      ok: true,
      level: "info",
      category: "openclaw",
      code: "OPENCLAW_NOT_FOUND",
      message: "未检测到 OpenClaw，可运行 openclaw install 安装",
      suggestion: "如需安装 OpenClaw，请运行 openclaw install。",
      repairable: true,
      repairAction: "install_openclaw"
    };
  }

  const versionResult = await runCommand("openclaw", ["--version"], {
    allowFailure: true,
    timeoutMs: 3000
  });
  const version = (versionResult.stdout + versionResult.stderr).trim().split("\n")[0];

  if (!versionResult.timedOut && versionResult.code === 0 && version) {
    return {
      name: "OpenClaw",
      ok: true,
      level: "pass",
      category: "openclaw",
      code: "OPENCLAW_INSTALLED",
      message: `已安装，当前版本：${version}`,
      suggestion: "",
      repairable: false,
      repairAction: null
    };
  }

  return {
    name: "OpenClaw",
    ok: true,
    level: "warning",
    category: "openclaw",
    code: "OPENCLAW_VERSION_UNKNOWN",
    message: "已安装，但版本读取失败",
    suggestion: "可以继续使用；后续 update 功能会单独处理版本更新。",
    repairable: false,
    repairAction: null
  };
}

module.exports = {
  checkOpenClawStatus
};
