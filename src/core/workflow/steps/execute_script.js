// 安装 workflow 步骤：用 bash 执行已下载到本地的官方安装脚本。
const fs = require("node:fs");
const fsConstants = fs.constants;
const os = require("node:os");
const path = require("node:path");
const { resolveCommand, runCommand } = require("../../../utils/shell");
const { getCommandEnv } = require("../../../utils/shell/env");

const NPM_INSTALLER_LOG_LINE_LIMIT = 100;
const NPM_INSTALLER_LOG_BYTE_LIMIT = 256 * 1024;
const NPM_DEBUG_LOG_CANDIDATE_LIMIT = 5;
const NPM_DEBUG_LOG_MTIME_TOLERANCE_MS = 5000;

module.exports = {
  id: "execute_script",
  name: "execute_script",
  condition: async () => true,
  skipIf: async () => false,
  retry: 0,
  onFail: "stop",
  label: "执行官方安装脚本",
  retryable: false,
  async run(ctx) {
    const installEnvironment = getCommandEnv(
      ctx.installEnvironment || ctx.commandEnv || process.env
    );
    const bashResolution = await resolveCommand("bash", {
      diagnosticLogger: ctx.diagnosticLogger,
      env: installEnvironment
    });
    ctx.diagnosticLogger.event("install_script_prepare", {
      bash: bashResolution,
      scriptPath: ctx.tempState.scriptPath,
      timeoutMs: ctx.config.installScriptTimeoutMs || 120000
    });
    ctx.diagnosticLogger.event("install_script_effective_env", {
      npmConfigPrefix: installEnvironment.NPM_CONFIG_PREFIX,
      commandPath: installEnvironment.PATH,
      prefixBinInPath: installEnvironment.PATH
        .split(path.delimiter)
        .includes(path.join(installEnvironment.NPM_CONFIG_PREFIX, "bin"))
    });
    const npmDiagnosticsCapture = createNpmDiagnosticsCapture(
      ctx.diagnosticLogger
    );
    const result = await runCommand("bash", [ctx.tempState.scriptPath], {
      allowFailure: true,
      timeoutMs: ctx.config.installScriptTimeoutMs || 120000,
      diagnosticLogger: ctx.diagnosticLogger,
      env: installEnvironment,
      onOutput(update) {
        if (update && update.stream === "stdout") {
          captureNpmDiagnosticsBeforeExit(
            npmDiagnosticsCapture,
            update.buffer
          );
        }
      }
    });
    ctx.logger.info("官方安装脚本 stdout：\n" + result.stdout);
    ctx.logger.info("官方安装脚本 stderr：\n" + result.stderr);

    if (result.code !== 0 || result.timedOut) {
      const output = result.stderr || result.stdout;
      const exitCode = getExitCode(result);

      if (result.timedOut || containsOnboardingMarker(output)) {
        const installed = await readInstalledOpenClawVersion(
          ctx,
          installEnvironment
        );

        if (installed.ok) {
          ctx.logger.warn("官方安装脚本可能进入 onboarding，但 openclaw --version 已可用：" + installed.version);
          ctx.diagnosticLogger.warn("install_script_timeout_verification_succeeded", {
            timedOut: result.timedOut,
            exitCode: result.exitCode,
            signal: result.signal,
            version: installed.version
          });
          return {
            success: true,
            message: "OpenClaw 本体已安装完成，下一步请配置 API。",
            data: {
              needsConfigure: true,
              installScriptResult: result,
              version: installed.version
            }
          };
        }
      }

      const errorCode = result.spawnError && result.spawnError.code === "ENOENT"
        ? "OPENCLAW_INSTALL_COMMAND_NOT_FOUND"
        : result.timedOut
          ? "OPENCLAW_INSTALL_SCRIPT_TIMEOUT"
          : "OPENCLAW_INSTALL_SCRIPT_FAILED";
      const npmInstallerLog = exitCode !== null && exitCode !== 0
        ? finalizeNpmDiagnosticsCapture(npmDiagnosticsCapture, result.stdout)
        : {};
      const npmEnvironment = shouldCollectNpmEnvironment(npmInstallerLog)
        ? await collectNpmEnvironment(ctx, installEnvironment)
        : null;
      ctx.diagnosticLogger.error("install_script_failure", {
        errorCode,
        exitCode,
        command: result.command || "bash",
        signal: result.signal,
        timedOut: result.timedOut,
        spawnError: result.spawnError,
        stdoutSummary: summarizeOutput(result.stdout),
        stderrSummary: summarizeOutput(result.stderr),
        stdoutBuffer: result.stdout,
        stderrBuffer: result.stderr,
        stdoutBufferTail: tailText(result.stdout),
        stderrBufferTail: tailText(result.stderr),
        ...(npmEnvironment ? { npmEnvironment } : {}),
        ...npmInstallerLog
      });
      return {
        success: false,
        message: "官方安装脚本执行失败。错误摘要：" + summarizeOutput(output),
        finalMessage: "OpenClaw 安装失败：官方安装脚本执行失败。",
        errorCode,
        userMessage: result.timedOut
          ? "OpenClaw 官方安装脚本执行超时，且未能验证安装结果。"
          : errorCode === "OPENCLAW_INSTALL_SCRIPT_FAILED"
            ? "OpenClaw 官方安装脚本执行失败。查看安装记录后可以看到 npm 原因。"
            : "OpenClaw 官方安装脚本执行失败。",
        technicalMessage: buildCommandTechnicalMessage(result),
        commandResult: result
      };
    }

    ctx.diagnosticLogger.event("install_script_success", {
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      durationMs: result.durationMs
    });
    return {
      success: true,
      message: "官方安装脚本执行完成",
      data: {
        installScriptResult: result
      }
    };
  }
};

async function readInstalledOpenClawVersion(ctx, installEnvironment) {
  const result = await runCommand("openclaw", ["--version"], {
    allowFailure: true,
    timeoutMs: 5000,
    diagnosticLogger: ctx && ctx.diagnosticLogger,
    env: installEnvironment || ctx && ctx.installEnvironment
  });
  const version = (result.stdout + result.stderr).trim().split("\n")[0];

  return {
    ok: result.code === 0 && !result.timedOut && Boolean(version),
    version: version || null
  };
}

function buildCommandTechnicalMessage(result) {
  return [
    "exitCode=" + String(result.exitCode),
    "signal=" + String(result.signal || "none"),
    "timedOut=" + String(Boolean(result.timedOut)),
    "spawnError=" + String(result.spawnError && result.spawnError.code || "none")
  ].join(", ");
}

function containsOnboardingMarker(output) {
  return /openclaw-onboard|onboarding|starting setup|setup mode/i.test(String(output || ""));
}

function summarizeOutput(output) {
  const summary = String(output || "未提供错误详情")
    .trim()
    .split("\n")
    .filter(Boolean)
    .slice(0, 5)
    .join(" ");

  return summary || "未提供错误详情";
}

function createNpmDiagnosticsCapture(diagnosticLogger) {
  return {
    diagnosticLogger,
    startedAtMs: Date.now(),
    markerFound: false,
    pathLogged: false,
    snapshotLogged: false,
    npmInstallerLogPath: null,
    npmInstallerLogExists: false,
    npmInstallerLogReadError: null,
    npmInstallerLogTail: null,
    npmDebugLogCandidates: new Map()
  };
}

function captureNpmDiagnosticsBeforeExit(capture, stdoutBuffer) {
  if (!/Installer log:/i.test(String(stdoutBuffer || ""))) {
    return;
  }

  capture.markerFound = true;
  const detectedPath = extractNpmInstallerLogPath(stdoutBuffer);

  if (detectedPath && isAllowedNpmInstallerLogPath(detectedPath)) {
    capture.npmInstallerLogPath = capture.npmInstallerLogPath || detectedPath;

    if (!capture.pathLogged) {
      capture.diagnosticLogger.event("npm_installer_log_detected", {
        npmInstallerLogPath: capture.npmInstallerLogPath
      });
      capture.pathLogged = true;
    }

    captureInstallerLogSnapshot(capture);

    if (capture.npmInstallerLogTail && !capture.snapshotLogged) {
      capture.diagnosticLogger.event("npm_installer_log_captured_before_exit", {
        npmInstallerLogPath: capture.npmInstallerLogPath,
        npmInstallerLogExists: capture.npmInstallerLogExists,
        npmInstallerLogTail: capture.npmInstallerLogTail
      });
      capture.snapshotLogged = true;
    }
  }

  captureRecentNpmDebugLogs(capture);
}

function finalizeNpmDiagnosticsCapture(capture, stdout) {
  captureNpmDiagnosticsBeforeExit(capture, stdout);

  if (!capture.markerFound) {
    return {};
  }

  captureInstallerLogSnapshot(capture);
  captureRecentNpmDebugLogs(capture);

  return {
    npmInstallerLogPath: capture.npmInstallerLogPath,
    npmInstallerLogExists: capture.npmInstallerLogExists,
    npmInstallerLogReadError: capture.npmInstallerLogReadError,
    npmInstallerLogTail: capture.npmInstallerLogTail,
    npmDebugLogCandidates: Array.from(capture.npmDebugLogCandidates.values())
      .sort((left, right) => right.modifiedAtMs - left.modifiedAtMs)
      .map(({ modifiedAtMs, ...candidate }) => candidate)
  };
}

function captureInstallerLogSnapshot(capture) {
  if (!capture.npmInstallerLogPath || capture.npmInstallerLogTail) {
    return;
  }

  const snapshot = readLogSnapshot(capture.npmInstallerLogPath);

  if (snapshot.exists) {
    capture.npmInstallerLogExists = true;
  }

  if (snapshot.tail) {
    capture.npmInstallerLogTail = snapshot.tail;
    capture.npmInstallerLogReadError = null;
    return;
  }

  capture.npmInstallerLogReadError = snapshot.readError;
}

function captureRecentNpmDebugLogs(capture) {
  const debugLogDirectory = path.join(
    process.env.HOME || os.homedir(),
    ".npm",
    "_logs"
  );
  let entries;

  try {
    entries = fs.readdirSync(debugLogDirectory, {
      withFileTypes: true
    });
  } catch (error) {
    return;
  }

  const candidates = [];

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }

    const candidatePath = path.join(debugLogDirectory, entry.name);

    try {
      const stat = fs.lstatSync(candidatePath);

      if (
        !stat.isFile()
        || stat.isSymbolicLink()
        || stat.mtimeMs < capture.startedAtMs - NPM_DEBUG_LOG_MTIME_TOLERANCE_MS
      ) {
        continue;
      }

      candidates.push({
        path: candidatePath,
        modifiedAtMs: stat.mtimeMs
      });
    } catch (error) {
      // 候选文件可能被 npm 同时移动；下一轮扫描会重新判断。
    }
  }

  candidates
    .sort((left, right) => right.modifiedAtMs - left.modifiedAtMs)
    .slice(0, NPM_DEBUG_LOG_CANDIDATE_LIMIT)
    .forEach((candidate) => {
      const snapshot = readLogSnapshot(candidate.path);
      capture.npmDebugLogCandidates.set(candidate.path, {
        path: candidate.path,
        modifiedAt: new Date(candidate.modifiedAtMs).toISOString(),
        modifiedAtMs: candidate.modifiedAtMs,
        exists: snapshot.exists,
        readError: snapshot.readError,
        tail: snapshot.tail
      });
    });
}

function readLogSnapshot(logPath) {
  try {
    const beforeOpen = fs.lstatSync(logPath);

    if (!beforeOpen.isFile() || beforeOpen.isSymbolicLink()) {
      return {
        exists: true,
        readError: "INVALID_NPM_INSTALLER_LOG",
        tail: null
      };
    }

    const noFollow = fsConstants.O_NOFOLLOW || 0;
    const descriptor = fs.openSync(logPath, fsConstants.O_RDONLY | noFollow);

    try {
      const opened = fs.fstatSync(descriptor);

      if (!opened.isFile() || opened.dev !== beforeOpen.dev || opened.ino !== beforeOpen.ino) {
        return {
          exists: true,
          readError: "NPM_INSTALLER_LOG_CHANGED",
          tail: null
        };
      }

      return {
        exists: true,
        readError: null,
        tail: readLastLinesFromDescriptor(descriptor, opened.size)
      };
    } finally {
      fs.closeSync(descriptor);
    }
  } catch (error) {
    return {
      exists: Boolean(error && error.code && error.code !== "ENOENT"),
      readError: error && error.code ? String(error.code) : "UNKNOWN",
      tail: null
    };
  }
}

function extractNpmInstallerLogPath(stdout) {
  const match = String(stdout || "").match(
    /(?:^|\r?\n)[ \t]*Installer log:[ \t]*(?:\r?\n[ \t]*)?([^\r\n]+)/i
  );

  if (!match) {
    return null;
  }

  const candidate = stripMatchingQuotes(
    match[1]
      .replace(/\u001b\[[0-9;]*m/g, "")
      .trim()
  );

  if (!candidate || candidate.includes("\0") || !path.isAbsolute(candidate)) {
    return null;
  }

  return path.resolve(candidate);
}

function stripMatchingQuotes(value) {
  if (value.length < 2) {
    return value;
  }

  const first = value[0];
  const last = value[value.length - 1];

  if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
    return value.slice(1, -1).trim();
  }

  return value;
}

function isAllowedNpmInstallerLogPath(logPath) {
  const allowedRoots = [
    os.tmpdir(),
    "/tmp",
    "/private/tmp",
    "/var/folders",
    path.join(os.homedir(), ".npm", "_logs")
  ];

  return allowedRoots.some((root) => isPathInside(logPath, root));
}

function isPathInside(candidate, root) {
  const normalizedCandidate = path.resolve(candidate);
  const normalizedRoot = path.resolve(root);
  const relative = path.relative(normalizedRoot, normalizedCandidate);

  return relative === "" || (
    relative !== ".."
    && !relative.startsWith(".." + path.sep)
    && !path.isAbsolute(relative)
  );
}

function readLastLinesFromDescriptor(descriptor, fileSize) {
  const bytesToRead = Math.min(fileSize, NPM_INSTALLER_LOG_BYTE_LIMIT);
  const start = Math.max(0, fileSize - bytesToRead);
  const buffer = Buffer.alloc(bytesToRead);
  const bytesRead = fs.readSync(descriptor, buffer, 0, bytesToRead, start);
  let text = buffer.subarray(0, bytesRead).toString("utf8");

  if (start > 0) {
    const firstLineEnd = text.indexOf("\n");
    text = firstLineEnd === -1 ? "" : text.slice(firstLineEnd + 1);
  }

  return text
    .split(/\r?\n/)
    .slice(-NPM_INSTALLER_LOG_LINE_LIMIT)
    .join("\n")
    .trim();
}

function shouldCollectNpmEnvironment(diagnostics) {
  if (!diagnostics || !Object.prototype.hasOwnProperty.call(
    diagnostics,
    "npmInstallerLogExists"
  )) {
    return false;
  }

  if (diagnostics.npmInstallerLogTail) {
    return false;
  }

  return !diagnostics.npmDebugLogCandidates.some((candidate) => candidate.tail);
}

async function collectNpmEnvironment(ctx, installEnvironment) {
  const commands = [
    {
      command: "npm",
      args: ["--version"],
      name: "npmVersion"
    },
    {
      command: "node",
      args: ["--version"],
      name: "nodeVersion"
    },
    {
      command: "npm",
      args: ["config", "get", "prefix"],
      name: "npmPrefix"
    },
    {
      command: "npm",
      args: ["config", "get", "registry"],
      name: "npmRegistry"
    }
  ];
  const results = await Promise.all(commands.map(async (spec) => {
    try {
      const result = await runCommand(spec.command, spec.args, {
        allowFailure: true,
        timeoutMs: 5000,
        diagnosticLogger: ctx.diagnosticLogger,
        env: installEnvironment || ctx.installEnvironment
      });

      return {
        name: spec.name,
        command: spec.command,
        args: spec.args,
        exitCode: getExitCode(result),
        timedOut: Boolean(result.timedOut),
        spawnError: result.spawnError,
        stdout: String(result.stdout || "").trim(),
        stderr: String(result.stderr || "").trim()
      };
    } catch (error) {
      return {
        name: spec.name,
        command: spec.command,
        args: spec.args,
        exitCode: null,
        timedOut: false,
        spawnError: {
          code: error && error.code ? String(error.code) : "DIAGNOSTIC_COMMAND_FAILED"
        },
        stdout: "",
        stderr: ""
      };
    }
  }));

  return results;
}

function tailText(value, maxLength = 4000) {
  const text = String(value || "");

  if (text.length <= maxLength) {
    return text;
  }

  return "…[TAIL]\n" + text.slice(-maxLength);
}

function getExitCode(result) {
  if (Number.isInteger(result.exitCode)) {
    return result.exitCode;
  }

  return Number.isInteger(result.code) ? result.code : null;
}
