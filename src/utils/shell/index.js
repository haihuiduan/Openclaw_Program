// 系统命令封装层：项目里凡是要调用系统命令，都应该从这里走。
// 这样可以统一处理 stdout/stderr、退出码、错误和跨平台差异。
const { spawn } = require("node:child_process");
const { getCommandEnv } = require("./env");

/**
 * 执行一个系统命令。
 * 输入：命令名、参数数组、可选执行配置。
 * 输出：Promise，成功时返回 { command, args, code, stdout, stderr, timedOut }。
 */
function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    // shell:false 避免把参数交给 shell 拼接，减少路径和特殊字符带来的风险。
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: getCommandEnv(options.env || process.env),
      shell: false,
      stdio: options.stdio || "pipe"
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timeout = null;

    if (options.timeoutMs) {
      timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, options.timeoutMs);
    }

    if (child.stdout) {
      // 收集标准输出，方便调用方读取命令结果。
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
    }

    if (child.stderr) {
      // 收集错误输出；命令失败时会放进 error.result 里，便于排查。
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    // 启动失败通常表示命令不存在或系统拒绝执行。
    child.on("error", (error) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      reject(error);
    });

    child.on("close", (code) => {
      if (timeout) {
        clearTimeout(timeout);
      }

      const result = {
        command,
        args,
        code,
        stdout,
        stderr,
        timedOut
      };

      if (code === 0 || options.allowFailure) {
        // allowFailure 用于“检测型命令”，例如检查某个命令是否存在。
        resolve(result);
        return;
      }

      // 对真正失败的命令抛错，同时把完整结果挂在 error.result 上。
      const error = new Error(`系统命令执行失败：${command} ${args.join(" ")}`);
      error.result = result;
      reject(error);
    });
  });
}

/**
 * 交互式执行系统命令。
 * 输入：命令名、参数数组、可选执行配置。
 * 输出：Promise，返回 { command, args, code, signal }。
 * 说明：stdio: "inherit" 会把当前终端交给子进程，适合官方配置向导这类交互式 CLI。
 */
function runInteractiveCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: getCommandEnv(options.env || process.env),
      shell: false,
      stdio: "inherit"
    });

    child.on("error", (error) => {
      const result = {
        command,
        args,
        code: 1,
        signal: null,
        error
      };

      if (options.allowFailure) {
        resolve(result);
        return;
      }

      error.result = result;
      reject(error);
    });

    child.on("close", (code, signal) => {
      const result = {
        command,
        args,
        code,
        signal
      };

      if (code === 0 || options.allowFailure) {
        resolve(result);
        return;
      }

      const error = new Error(`交互式命令执行失败：${command} ${args.join(" ")}`);
      error.result = result;
      reject(error);
    });
  });
}

/**
 * 后台启动一个系统命令，不等待它执行结束。
 * 输入：命令名、参数数组、可选执行配置。
 * 输出：Promise，命令成功启动后返回 { command, args, started }。
 */
function runDetachedCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: getCommandEnv(options.env || process.env),
      shell: false,
      detached: true,
      stdio: "ignore"
    });

    child.on("error", (error) => {
      if (options.allowFailure) {
        resolve({
          command,
          args,
          started: false,
          error
        });
        return;
      }

      reject(error);
    });

    child.on("spawn", () => {
      child.unref();
      resolve({
        command,
        args,
        started: true
      });
    });
  });
}

/**
 * 判断某个命令是否存在。
 * 输入：命令名，例如 "npm"。
 * 输出：true/false。
 */
async function commandExists(command) {
  // Windows 使用 where，macOS/Linux 通常使用 which。
  const lookupCommand = process.platform === "win32" ? "where" : "which";
  const lookupArgs = [command];
  const result = await runCommand(lookupCommand, lookupArgs, {
    allowFailure: true
  });

  return result.code === 0;
}

module.exports = {
  commandExists,
  getCommandEnv,
  runCommand,
  runDetachedCommand,
  runInteractiveCommand
};
