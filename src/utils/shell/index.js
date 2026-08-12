// 系统命令封装层：项目里凡是要调用系统命令，都应该从这里走。
// 这样可以统一处理 stdout/stderr、退出码、错误和跨平台差异。
const { spawn } = require("node:child_process");
const { getCommandEnv } = require("./env");
const {
  sanitizeCommandArgs,
  sanitizeDiagnosticText
} = require("../installDiagnosticLogger");

/**
 * 执行一个系统命令。
 * 输入：命令名、参数数组、可选执行配置。
 * 输出：Promise，成功时返回 { command, args, code, stdout, stderr, timedOut }。
 */
function runCommand(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    const startedAtDate = new Date();
    const startedAt = startedAtDate.toISOString();
    const cwd = options.cwd || process.cwd();
    const shell = false;
    const env = getCommandEnv(
      options.env || process.env,
      options.commandEnvOptions
    );
    const diagnosticLogger = options.diagnosticLogger;
    let child;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timeout = null;
    let spawnError = null;
    let settled = false;

    logCommandEvent(diagnosticLogger, "command_start", {
      command,
      args: sanitizeCommandArgs(args),
      cwd,
      shell,
      startedAt,
      effectiveEnv: summarizeOpenClawEnvironment(env, options)
    });

    // shell:false 避免把参数交给 shell 拼接，减少路径和特殊字符带来的风险。
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env,
        shell,
        stdio: options.stdio || "pipe"
      });
    } catch (error) {
      spawnError = normalizeSpawnError(error);
      finish(null, null);
      return;
    }

    if (options.timeoutMs) {
      timeout = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, options.timeoutMs);
    }

    if (child.stdout) {
      // 收集标准输出，方便调用方读取命令结果。
      child.stdout.on("data", (chunk) => {
        const text = chunk.toString();
        stdout += text;
        notifyOutputObserver(options.onOutput, {
          stream: "stdout",
          chunk: text,
          buffer: stdout
        });
      });
    }

    if (child.stderr) {
      // 收集错误输出；命令失败时会放进 error.result 里，便于排查。
      child.stderr.on("data", (chunk) => {
        const text = chunk.toString();
        stderr += text;
        notifyOutputObserver(options.onOutput, {
          stream: "stderr",
          chunk: text,
          buffer: stderr
        });
      });
    }

    // 启动失败通常表示命令不存在或系统拒绝执行。
    child.on("error", (error) => {
      spawnError = normalizeSpawnError(error);
    });

    child.on("close", (code, signal) => {
      finish(code, signal);
    });

    function finish(code, signal) {
      if (settled) {
        return;
      }

      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }

      const finishedAtDate = new Date();
      const result = {
        command,
        args,
        cwd,
        shell,
        exitCode: code,
        // 兼容已有调用方；新代码应优先读取 exitCode。
        code,
        stdout,
        stderr,
        signal: signal || null,
        timedOut,
        spawnError,
        startedAt,
        finishedAt: finishedAtDate.toISOString(),
        durationMs: finishedAtDate.getTime() - startedAtDate.getTime()
      };

      logCommandEvent(diagnosticLogger, "command_finish", {
        ...result,
        args: sanitizeCommandArgs(args),
        stdout: options.sensitiveOutput ? undefined : summarizeCommandOutput(stdout),
        stderr: options.sensitiveOutput ? undefined : summarizeCommandOutput(stderr),
        stdoutPresent: Boolean(stdout.trim()),
        stderrPresent: Boolean(stderr.trim())
      });

      if ((code === 0 && !spawnError) || options.allowFailure) {
        // allowFailure 用于“检测型命令”，例如检查某个命令是否存在。
        resolve(result);
        return;
      }

      // 对真正失败的命令抛错，同时把完整结果挂在 error.result 上。
      const error = new Error(spawnError
        ? `系统命令无法启动：${command}`
        : `系统命令执行失败：${command}`);
      error.code = spawnError && spawnError.code
        ? spawnError.code
        : "COMMAND_FAILED";
      error.result = result;
      reject(error);
    }
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
      env: getCommandEnv(
        options.env || process.env,
        options.commandEnvOptions
      ),
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
      env: getCommandEnv(
        options.env || process.env,
        options.commandEnvOptions
      ),
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
async function commandExists(command, options = {}) {
  // Windows 使用 where，macOS/Linux 通常使用 which。
  const lookupCommand = process.platform === "win32" ? "where" : "which";
  const lookupArgs = [command];
  const result = await runCommand(lookupCommand, lookupArgs, {
    allowFailure: true,
    diagnosticLogger: options.diagnosticLogger,
    env: options.env,
    commandEnvOptions: options.commandEnvOptions
  });

  return result.code === 0;
}

async function resolveCommand(command, options = {}) {
  const result = await runCommand(
    process.platform === "win32" ? "where" : "/usr/bin/which",
    [command],
    {
      allowFailure: true,
      timeoutMs: options.timeoutMs || 3000,
      env: options.env,
      commandEnvOptions: options.commandEnvOptions,
      diagnosticLogger: options.diagnosticLogger
    }
  );
  const resolvedPath = result.exitCode === 0 && !result.spawnError
    ? String(result.stdout || "").trim().split("\n").filter(Boolean)[0] || null
    : null;

  return {
    command,
    found: Boolean(resolvedPath),
    resolvedPath,
    exitCode: result.exitCode,
    signal: result.signal,
    spawnError: result.spawnError,
    timedOut: result.timedOut
  };
}

function normalizeSpawnError(error) {
  if (!error) {
    return null;
  }

  return {
    code: error.code ? String(error.code) : "SPAWN_FAILED",
    message: sanitizeDiagnosticText(error.message || "命令启动失败")
  };
}

function notifyOutputObserver(observer, update) {
  if (typeof observer !== "function") {
    return;
  }

  try {
    // 同步通知只用于需要在子进程退出前抢救临时诊断文件的内部调用方。
    observer(update);
  } catch (error) {
    // 诊断观察失败不能改变原命令的退出状态或执行时序。
  }
}

function summarizeCommandOutput(value) {
  return sanitizeDiagnosticText(String(value || "").trim().slice(0, 2000));
}

function summarizeOpenClawEnvironment(env, options) {
  const expectedHome = String(
    options.commandEnvOptions && options.commandEnvOptions.homeDir ||
    options.env && options.env.HOME || process.env.HOME || ""
  ).trim();
  return {
    OPENCLAW_GATEWAY_TOKEN_PRESENT: Boolean(String(env.OPENCLAW_GATEWAY_TOKEN || "").trim()),
    OPENCLAW_CONFIG_PATH_PRESENT: Boolean(String(env.OPENCLAW_CONFIG_PATH || "").trim()),
    OPENCLAW_STATE_DIR_PRESENT: Boolean(String(env.OPENCLAW_STATE_DIR || "").trim()),
    OPENCLAW_PROFILE_PRESENT: Boolean(String(env.OPENCLAW_PROFILE || "").trim()),
    homeMatchesToolboxUser: Boolean(expectedHome && env.HOME === expectedHome)
  };
}

function logCommandEvent(logger, event, details) {
  if (logger && typeof logger.event === "function") {
    logger.event(event, details);
  }
}

module.exports = {
  commandExists,
  getCommandEnv,
  resolveCommand,
  runCommand,
  runDetachedCommand,
  runInteractiveCommand
};
