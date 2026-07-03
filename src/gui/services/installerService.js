// GUI 服务层：统一封装 GUI 对 core 能力的调用，main 只负责 IPC 路由。
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { runDoctor: runCoreDoctor } = require("../../core/doctor");
const { runVerify: runCoreVerify } = require("../../core/verify");
const { runWorkflow } = require("../../core/workflow/engine");
const { commandExists, runCommand, runDetachedCommand } = require("../../utils/shell");

function runDoctor(config) {
  return runCoreDoctor(config);
}

function runVerify(config) {
  return runCoreVerify(config);
}

function runInstall(configOrProgress, maybeOnProgress) {
  return runNamedWorkflow("install", configOrProgress, maybeOnProgress);
}

function runSetup(configOrProgress, maybeOnProgress) {
  return runNamedWorkflow("setup", configOrProgress, maybeOnProgress);
}

function runUpdate(configOrProgress, maybeOnProgress) {
  const config = typeof configOrProgress === "function" ? {} : configOrProgress || {};
  const onProgress = typeof configOrProgress === "function" ? configOrProgress : maybeOnProgress;

  return runNamedWorkflow("install", {
    ...config,
    forceInstall: true
  }, onProgress);
}

async function checkOpenClawVersion() {
  const installed = await commandExists("openclaw");

  if (!installed) {
    return {
      installed: false,
      currentVersion: null,
      latestVersion: null,
      updateAvailable: false,
      canCheckLatest: false,
      message: "未检测到 OpenClaw。"
    };
  }

  const currentResult = await runCommand("openclaw", ["--version"], {
    allowFailure: true,
    timeoutMs: 5000
  });
  const currentText = sanitizeSingleLine(currentResult.stdout + currentResult.stderr);
  const currentVersion = currentResult.code === 0 && !currentResult.timedOut ? currentText : null;

  const latestResult = await runCommand("npm", ["view", "openclaw", "version"], {
    allowFailure: true,
    timeoutMs: 6000
  });
  const latestVersion = latestResult.code === 0 && !latestResult.timedOut
    ? sanitizeSingleLine(latestResult.stdout + latestResult.stderr)
    : null;
  const updateAvailable = Boolean(currentVersion && latestVersion && compareVersions(currentVersion, latestVersion) < 0);

  return {
    installed: true,
    currentVersion,
    latestVersion,
    updateAvailable,
    canCheckLatest: Boolean(latestVersion),
    message: latestVersion
      ? (updateAvailable ? "检测到 OpenClaw 有新版本。" : "OpenClaw 已是最新版本。")
      : "暂时无法检查最新版本。"
  };
}

function sanitizeSingleLine(output) {
  return String(output || "")
    .trim()
    .split("\n")
    .filter(Boolean)[0] || "";
}


function getConfigStatePath() {
  return path.join(os.homedir(), ".openclaw-installer", "config-state.json");
}

async function readConfigState() {
  const statePath = getConfigStatePath();

  try {
    const content = await fs.readFile(statePath, "utf8");
    const state = JSON.parse(content);

    return {
      success: true,
      ok: true,
      exists: true,
      statePath,
      state: sanitizeConfigState(state)
    };
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {
        success: true,
        ok: true,
        exists: false,
        statePath,
        state: null
      };
    }

    return {
      success: false,
      ok: false,
      exists: false,
      statePath,
      state: null,
      message: "无法读取安装器配置状态。"
    };
  }
}

async function saveConfigState(input = {}) {
  const statePath = getConfigStatePath();
  const state = sanitizeConfigState({
    configuredByGui: true,
    configuredAt: new Date().toISOString(),
    provider: input.provider,
    modelMode: input.modelMode,
    model: input.model,
    openclawVersion: input.openclawVersion
  });

  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");

  return {
    success: true,
    ok: true,
    statePath,
    state
  };
}

function sanitizeConfigState(input = {}) {
  return {
    configuredByGui: input.configuredByGui === true,
    configuredAt: typeof input.configuredAt === "string" ? input.configuredAt : "",
    provider: sanitizeStateText(input.provider, 80),
    modelMode: sanitizeStateText(input.modelMode, 40),
    model: sanitizeStateText(input.model, 120),
    openclawVersion: sanitizeStateText(input.openclawVersion, 160)
  };
}

function sanitizeStateText(value, maxLength) {
  return String(value || "")
    .replace(/[\r\n]/g, " ")
    .trim()
    .slice(0, maxLength);
}

function compareVersions(current, latest) {
  const currentParts = extractVersionParts(current);
  const latestParts = extractVersionParts(latest);

  if (!currentParts.length || !latestParts.length) {
    return 0;
  }

  const length = Math.max(currentParts.length, latestParts.length);

  for (let index = 0; index < length; index += 1) {
    const left = currentParts[index] || 0;
    const right = latestParts[index] || 0;

    if (left < right) {
      return -1;
    }

    if (left > right) {
      return 1;
    }
  }

  return 0;
}

function extractVersionParts(text) {
  const match = String(text || "").match(/\d+(?:\.\d+){0,3}/);
  return match ? match[0].split(".").map((part) => Number(part) || 0) : [];
}

function getProviderConfig(provider) {
  const providers = {
    openrouter: {
      authChoice: "openrouter-api-key",
      keyArg: "--openrouter-api-key"
    },
    deepseek: {
      authChoice: "deepseek-api-key",
      keyArg: "--deepseek-api-key"
    },
    openai: {
      authChoice: "openai-api-key",
      keyArg: "--openai-api-key"
    },
    gemini: {
      authChoice: "gemini-api-key",
      keyArg: "--gemini-api-key"
    },
    qwen: {
      authChoice: "qwen-api-key",
      keyArg: "--qwen-api-key"
    }
  };

  return providers[provider] || null;
}

async function runQuickConfigure(options = {}) {
  const apiKey = String(options.apiKey || "").trim();
  const provider = String(options.provider || "openrouter").toLowerCase();
  const providerConfig = getProviderConfig(provider);

  if (!providerConfig) {
    return {
      success: false,
      ok: false,
      message: "暂不支持该 AI 服务商。"
    };
  }

  if (!apiKey) {
    return {
      success: false,
      ok: false,
      message: "请先输入 API Key。"
    };
  }

  const installed = await commandExists("openclaw");

  if (!installed) {
    return {
      success: false,
      ok: false,
      message: "未检测到 OpenClaw，请先执行一键安装。"
    };
  }

  const defaultModel = String(options.defaultModel || "").trim();
  const args = [
    "onboard",
    "--non-interactive",
    "--accept-risk",
    "--flow",
    "quickstart",
    "--auth-choice",
    providerConfig.authChoice,
    providerConfig.keyArg,
    apiKey,
    "--install-daemon",
    "--skip-search",
    "--skip-skills",
    "--skip-hooks",
    "--skip-channels",
    "--skip-ui",
    "--json"
  ];

  if (defaultModel) {
    args.push("--default-model", defaultModel);
  }

  const result = await runCommand("openclaw", args, {
    allowFailure: true
  });

  if (result.code !== 0) {
    return {
      success: false,
      ok: false,
      message: "OpenClaw 快速配置失败。错误摘要：" + sanitizeCommandOutput(result.stderr || result.stdout, [apiKey])
    };
  }

  return {
    success: true,
    ok: true,
    message: "OpenClaw 快速配置已完成，正在验证配置。"
  };
}

function sanitizeCommandOutput(output, secrets = []) {
  let text = String(output || "").trim();

  for (const secret of secrets) {
    if (secret) {
      text = text.split(secret).join("[已隐藏]");
    }
  }

  if (!text) {
    return "官方命令未返回详细错误。";
  }

  return text.split("\n").slice(0, 4).join("\n").slice(0, 500);
}

async function runConfigure() {
  if (process.platform !== "darwin") {
    return {
      success: false,
      ok: false,
      message: "当前 GUI 配置向导暂时只支持在 macOS 上打开系统终端。"
    };
  }

  const installed = await commandExists("openclaw");

  if (!installed) {
    return {
      success: false,
      ok: false,
      message: "未检测到 OpenClaw，请先执行一键安装。"
    };
  }

  const command = "mkdir -p ~/.openclaw-installer; rm -f ~/.openclaw-installer/configure-done.flag; openclaw onboard --install-daemon; echo done > ~/.openclaw-installer/configure-done.flag";
  const script = 'tell application "Terminal" to do script "' + command + '"';
  const result = await runCommand("osascript", ["-e", script], {
    allowFailure: true
  });

  if (result.code !== 0) {
    return {
      success: false,
      ok: false,
      message: "无法打开系统终端，请手动运行：openclaw onboard --install-daemon"
    };
  }

  return {
    success: true,
    ok: true,
    message: "已打开终端，请按提示完成 OpenClaw 官方配置。"
  };
}

async function openDashboard() {
  const installed = await commandExists("openclaw");

  if (!installed) {
    return {
      success: false,
      ok: false,
      message: "未检测到 OpenClaw，请先执行一键安装。"
    };
  }

  try {
    await runDetachedCommand("openclaw", ["dashboard", "--yes"]);
    return {
      success: true,
      ok: true,
      message: "已尝试启动 OpenClaw 控制台，请在浏览器中继续使用。"
    };
  } catch (error) {
    return {
      success: false,
      ok: false,
      message: "控制台打开失败，请稍后重试，或进入问题排查看日志。"
    };
  }
}

async function stopDashboard() {
  const installed = await commandExists("openclaw");

  if (!installed) {
    return {
      success: false,
      ok: false,
      message: "未检测到 OpenClaw，请先执行一键安装。"
    };
  }

  const result = await runCommand("openclaw", ["gateway", "stop"], {
    allowFailure: true,
    timeoutMs: 10000
  });

  if (result.code !== 0 || result.timedOut) {
    return {
      success: false,
      ok: false,
      message: "控制台停止失败，请稍后重试，或进入问题排查看日志。"
    };
  }

  return {
    success: true,
    ok: true,
    message: "已停止 OpenClaw 控制台。"
  };
}

async function checkConfigureDoneFlag() {
  const flagPath = path.join(os.homedir(), ".openclaw-installer", "configure-done.flag");

  try {
    await fs.access(flagPath);
    return {
      success: true,
      ok: true,
      done: true,
      flagPath,
      message: "检测到配置向导已结束，请点击‘立即验证’确认配置是否可用。"
    };
  } catch (error) {
    return {
      success: true,
      ok: true,
      done: false,
      flagPath,
      message: "配置向导仍在进行，或尚未写入完成标记。"
    };
  }
}

async function openLogsDirectory() {
  const logPath = path.join(os.homedir(), ".openclaw-installer", "logs");

  try {
    const stat = await fs.stat(logPath);

    if (!stat.isDirectory()) {
      return {
        success: false,
        ok: false,
        logPath,
        message: "还没有安装日志。请先执行一键安装。"
      };
    }
  } catch (error) {
    return {
      success: false,
      ok: false,
      logPath,
      message: "还没有安装日志。请先执行一键安装。"
    };
  }

  return {
    success: true,
    ok: true,
    logPath,
    message: "已打开安装日志目录。"
  };
}

function runNamedWorkflow(workflowName, configOrProgress, maybeOnProgress) {
  const config = typeof configOrProgress === "function" ? {} : configOrProgress;
  const onProgress = typeof configOrProgress === "function" ? configOrProgress : maybeOnProgress;

  return runWorkflow(workflowName, { config }, onProgress);
}

module.exports = {
  checkConfigureDoneFlag,
  openDashboard,
  stopDashboard,
  openLogsDirectory,
  readConfigState,
  saveConfigState,
  runConfigure,
  runDoctor,
  checkOpenClawVersion,
  runQuickConfigure,
  runInstall,
  runUpdate,
  runSetup,
  runVerify
};
