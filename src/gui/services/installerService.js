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
    await runDetachedCommand("openclaw", ["dashboard"]);
    return {
      success: true,
      ok: true,
      message: "已尝试打开 OpenClaw Dashboard。请在浏览器中继续使用。"
    };
  } catch (error) {
    return {
      success: false,
      ok: false,
      message: "无法打开 OpenClaw Dashboard，请稍后手动运行：openclaw dashboard"
    };
  }
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
  openLogsDirectory,
  runConfigure,
  runDoctor,
  runInstall,
  runSetup,
  runVerify
};
