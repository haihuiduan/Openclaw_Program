// 安装日志工具：正式 install 使用；dry-run 不应创建或写入日志。
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function createInstallLogger(options = {}) {
  const logDir = options.logDir || path.join(os.homedir(), ".openclaw-installer", "logs");
  const logPath = path.join(logDir, "install-" + formatTimestamp(new Date()) + ".log");
  const state = {
    logPath,
    writeFailed: false
  };

  function write(level, message) {
    try {
      fs.mkdirSync(logDir, { recursive: true });
      fs.appendFileSync(logPath, "[" + new Date().toISOString() + "] " + level + " " + redactSensitive(String(message)) + "\n");
    } catch (error) {
      state.writeFailed = true;
    }
  }

  return {
    info(message) {
      write("INFO", message);
    },
    warn(message) {
      write("WARN", message);
    },
    error(message) {
      write("ERROR", message);
    },
    getLogPath() {
      return state.logPath;
    },
    hasWriteFailed() {
      return state.writeFailed;
    }
  };
}

function formatTimestamp(date) {
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  const second = pad(date.getSeconds());

  return "" + year + month + day + "-" + hour + minute + second;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function redactSensitive(input) {
  return input
    .replace(/(api[_-]?key\s*[:=]\s*)[^\s,;]+/gi, "$1[已隐藏]")
    .replace(/(token\s*[:=]\s*)[^\s,;]+/gi, "$1[已隐藏]")
    .replace(/(secret\s*[:=]\s*)[^\s,;]+/gi, "$1[已隐藏]")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, "$1[已隐藏]");
}

module.exports = {
  createInstallLogger
};
