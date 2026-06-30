// configure 模块：封装 OpenClaw 官方配置/初始化命令。
// 本模块不管理 API Key，不写配置文件，只调用 OpenClaw 本体提供的官方流程。
const { commandExists, runCommand } = require("../../utils/shell");

const CONFIGURE_MODES = {
  onboard: {
    command: "openclaw",
    args: ["onboard", "--install-daemon"],
    description: "openclaw onboard --install-daemon"
  },
  reconfigure: {
    command: "openclaw",
    args: ["configure"],
    description: "openclaw configure"
  }
};

async function runConfigure(config = {}) {
  const mode = config.reconfigure ? "reconfigure" : "onboard";
  const officialCommand = CONFIGURE_MODES[mode];
  const installed = await commandExists("openclaw");

  if (!installed) {
    return {
      ok: false,
      mode,
      command: officialCommand.description,
      message: "未检测到 OpenClaw，请先运行 install 完成安装。"
    };
  }

  const version = await readOpenClawVersion();

  if (config.dryRun) {
    return {
      ok: true,
      dryRun: true,
      mode,
      version,
      command: officialCommand.description,
      message: "将启动 OpenClaw 官方配置向导：" + officialCommand.description
    };
  }

  const result = await runCommand(officialCommand.command, officialCommand.args, {
    allowFailure: true
  });

  if (result.code !== 0) {
    return {
      ok: false,
      mode,
      version,
      command: officialCommand.description,
      result,
      message: [
        "OpenClaw 官方配置流程执行失败。",
        "错误摘要：" + summarizeOutput(result.stderr || result.stdout)
      ].join("\n")
    };
  }

  return {
    ok: true,
    mode,
    version,
    command: officialCommand.description,
    result,
    message: "OpenClaw 官方配置流程已完成。"
  };
}

async function readOpenClawVersion() {
  const result = await runCommand("openclaw", ["--version"], {
    allowFailure: true,
    timeoutMs: 3000
  });
  const version = (result.stdout + result.stderr).trim().split("\n")[0];

  return result.code === 0 && !result.timedOut && version ? version : null;
}

function summarizeOutput(output) {
  const summary = redactSensitive(String(output || "未提供错误详情"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");

  return summary || "未提供错误详情";
}

function redactSensitive(input) {
  return input
    .replace(/(api[_-]?key\s*[:=]\s*)[^\s,;]+/gi, "$1[已隐藏]")
    .replace(/(token\s*[:=]\s*)[^\s,;]+/gi, "$1[已隐藏]")
    .replace(/(secret\s*[:=]\s*)[^\s,;]+/gi, "$1[已隐藏]")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, "$1[已隐藏]");
}

module.exports = {
  runConfigure
};
