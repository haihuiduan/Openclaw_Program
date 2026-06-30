// verify 模块：安装和配置后的基础验收，只检查，不安装、不配置、不写文件。
const { commandExists, runCommand } = require("../../utils/shell");

async function runVerify(config = {}) {
  if (config.dryRun) {
    return {
      ok: true,
      dryRun: true,
      checks: [
        plannedCheck("OpenClaw 命令", "将检查 openclaw 命令是否存在"),
        plannedCheck("OpenClaw 版本", "将检查 openclaw --version 是否可用"),
        plannedCheck("配置文件", "将检查 openclaw config file 是否能读取配置路径")
      ]
    };
  }

  const checks = [];
  const installed = await commandExists("openclaw");

  if (!installed) {
    checks.push({
      name: "OpenClaw 命令",
      ok: false,
      level: "fail",
      message: "未检测到 OpenClaw，请先运行 install 完成安装。"
    });

    return {
      ok: false,
      checks
    };
  }

  checks.push({
    name: "OpenClaw 命令",
    ok: true,
    level: "pass",
    message: "已找到"
  });

  const versionResult = await runCommand("openclaw", ["--version"], {
    allowFailure: true,
    timeoutMs: 5000
  });
  const version = sanitizeOutput(versionResult.stdout + versionResult.stderr);

  if (versionResult.code !== 0 || versionResult.timedOut || !version) {
    checks.push({
      name: "OpenClaw 版本",
      ok: false,
      level: "fail",
      message: "openclaw --version 执行失败，请检查 OpenClaw 是否安装完整。"
    });

    return {
      ok: false,
      checks
    };
  }

  checks.push({
    name: "OpenClaw 版本",
    ok: true,
    level: "pass",
    message: version
  });

  const configFileResult = await runCommand("openclaw", ["config", "file"], {
    allowFailure: true,
    timeoutMs: 5000
  });
  const configPath = sanitizeOutput(configFileResult.stdout + configFileResult.stderr);

  if (configFileResult.code === 0 && !configFileResult.timedOut && configPath) {
    checks.push({
      name: "配置文件",
      ok: true,
      level: "info",
      message: "已检测到配置文件路径：" + configPath
    });
  } else {
    checks.push({
      name: "配置文件",
      ok: true,
      level: "warning",
      message: "暂时无法读取配置文件路径，可稍后通过 openclaw configure 重新配置"
    });
  }

  return {
    ok: !checks.some((check) => check.level === "fail"),
    checks
  };
}

function plannedCheck(name, message) {
  return {
    name,
    ok: true,
    level: "info",
    message
  };
}

function sanitizeOutput(output) {
  return redactSensitive(String(output || ""))
    .trim()
    .split("\n")
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");
}

function redactSensitive(input) {
  return input
    .replace(/(api[_-]?key\s*[:=]\s*)[^\s,;]+/gi, "$1[已隐藏]")
    .replace(/(token\s*[:=]\s*)[^\s,;]+/gi, "$1[已隐藏]")
    .replace(/(secret\s*[:=]\s*)[^\s,;]+/gi, "$1[已隐藏]")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, "$1[已隐藏]");
}

module.exports = {
  runVerify
};
