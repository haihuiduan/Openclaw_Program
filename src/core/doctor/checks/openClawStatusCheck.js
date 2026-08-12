// OpenClaw 安装状态检测：只判断是否已安装，不做更新或修复。
const { resolveCommand, runCommand } = require("../../../utils/shell");

async function checkOpenClawStatus(options = {}) {
  const resolution = await resolveCommand("openclaw", {
    diagnosticLogger: options.diagnosticLogger,
    env: options.commandEnv
  });

  if (!resolution.found || !resolution.resolvedPath) {
    return {
      name: "OpenClaw",
      ok: true,
      level: "info",
      category: "openclaw",
      code: "OPENCLAW_NOT_FOUND",
      message: "未检测到 OpenClaw，可运行 openclaw-installer install 安装",
      suggestion: "如需安装 OpenClaw，请运行 openclaw-installer install。",
      repairable: true,
      repairAction: "install_openclaw"
    };
  }

  const versionResult = await runCommand(resolution.resolvedPath, ["--version"], {
    allowFailure: true,
    timeoutMs: 3000,
    diagnosticLogger: options.diagnosticLogger,
    env: options.commandEnv
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
    level: "info",
    category: "openclaw",
    code: "OPENCLAW_COMMAND_UNUSABLE",
    message: "检测到 OpenClaw 命令文件，但无法执行，将按未安装处理",
    suggestion: "请重新运行 OpenClaw 准备流程。",
    repairable: true,
    repairAction: "install_openclaw"
  };
}

module.exports = {
  checkOpenClawStatus
};
