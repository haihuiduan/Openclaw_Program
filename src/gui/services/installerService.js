// GUI 服务层：统一封装 GUI 对 core 能力的调用，main 只负责 IPC 路由。
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { runDoctor: runCoreDoctor } = require("../../core/doctor");
const { runVerify: runCoreVerify } = require("../../core/verify");
const { runWorkflow } = require("../../core/workflow/engine");
const {
  sanitizeDiagnosticText
} = require("../../utils/installDiagnosticLogger");
const {
  commandExists,
  resolveCommand,
  runCommand
} = require("../../utils/shell");
const {
  inspectGatewayPort,
  readConfiguredGatewayPort,
  readConfiguredGatewayPortState,
  readManagedGatewayServicePortState,
  selectGatewayPort
} = require("./gatewayPortService");

const DASHBOARD_STDERR_SUMMARY_MAX_LENGTH = 800;
const GATEWAY_READY_MAX_ATTEMPTS = 20;
const GATEWAY_READY_DELAY_MS = 500;

async function runDoctor(config, options = {}) {
  const report = await runCoreDoctor(config);
  return applyMissingDepsDevOverride(report, options);
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

async function checkOpenClawVersion(options = {}) {
  const resolution = await resolveCommand("openclaw", {
    timeoutMs: 3000,
    env: options.commandEnv,
    commandEnvOptions: options.commandEnvOptions
  });

  if (!resolution.found || !resolution.resolvedPath) {
    return {
      installed: false,
      currentVersion: null,
      latestVersion: null,
      updateAvailable: false,
      canCheckLatest: false,
      message: "未检测到 OpenClaw。"
    };
  }

  const currentResult = await runCommand(
    resolution.resolvedPath,
    ["--version"],
    {
      allowFailure: true,
      timeoutMs: 5000,
      env: options.commandEnv,
      commandEnvOptions: options.commandEnvOptions
    }
  );
  const currentText = sanitizeSingleLine(
    currentResult.stdout + currentResult.stderr
  );
  const currentVersion =
    currentResult.code === 0 &&
    !currentResult.timedOut &&
    !currentResult.spawnError &&
    currentText
      ? currentText
      : null;

  if (!currentVersion) {
    return {
      installed: false,
      currentVersion: null,
      latestVersion: null,
      updateAvailable: false,
      canCheckLatest: false,
      message: "检测到 OpenClaw 命令文件，但无法正常执行。"
    };
  }

  const latestResult = await runCommand("npm", ["view", "openclaw", "version"], {
    allowFailure: true,
    timeoutMs: 6000,
    env: options.commandEnv,
    commandEnvOptions: options.commandEnvOptions
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

async function resolveOpenClawExecutable(options = {}) {
  const resolution = await resolveCommand("openclaw", {
    timeoutMs: 3000,
    env: options.commandEnv,
    commandEnvOptions: options.commandEnvOptions
  });

  return {
    ok: Boolean(resolution.found && resolution.resolvedPath),
    executablePath: resolution.resolvedPath || "openclaw"
  };
}

function sanitizeSingleLine(output) {
  return String(output || "")
    .trim()
    .split("\n")
    .filter(Boolean)[0] || "";
}

function applyMissingDepsDevOverride(report, options = {}) {
  const missingDeps = parseMissingDepsDevOverride(options);

  if (!missingDeps.size) {
    return report;
  }

  const checks = (Array.isArray(report.checks) ? report.checks : []).map((check) => {
    if (missingDeps.has("node") && isNodeCheck(check)) {
      return createMissingDependencyCheck(check, "node");
    }

    if (missingDeps.has("npm") && isCommandCheck(check, "npm")) {
      return createMissingDependencyCheck(check, "npm");
    }

    if (missingDeps.has("git") && isCommandCheck(check, "git")) {
      return createMissingDependencyCheck(check, "git");
    }

    return check;
  });

  return {
    ...report,
    ok: !checks.some((check) => check.level === "fail"),
    checks
  };
}

function parseMissingDepsDevOverride(options = {}) {
  if (options.isDevRuntime !== true) {
    return new Set();
  }

  const rawValue = String(process.env.OPENCLAW_TEST_MISSING_DEPS || "").trim().toLowerCase();

  if (!rawValue) {
    return new Set();
  }

  const allowed = new Set(["node", "npm", "git"]);
  const values = rawValue.split(",").map((item) => item.trim()).filter(Boolean);

  if (values.includes("all")) {
    return new Set(allowed);
  }

  return new Set(values.filter((item) => allowed.has(item)));
}

function isNodeCheck(check) {
  return String(check.name || "") === "Node.js 版本" || isCommandCheck(check, "node");
}

function isCommandCheck(check, command) {
  return String(check.name || "") === `系统命令：${command}`;
}

function createMissingDependencyCheck(check, command) {
  const meta = {
    node: {
      code: "NODE_NOT_FOUND",
      message: "未找到 node，安装或运行 OpenClaw 可能需要该工具。",
      suggestion: "请安装 Node.js LTS 版本。安装 Node.js 后通常会自带 npm。",
      repairAction: "install_node"
    },
    npm: {
      code: "NPM_NOT_FOUND",
      message: "未找到 npm，安装或运行 OpenClaw 可能需要该工具。",
      suggestion: "请安装 Node.js LTS 版本。安装 Node.js 后通常会自带 npm。",
      repairAction: "install_node"
    },
    git: {
      code: "GIT_NOT_FOUND",
      message: "未找到 git，安装或运行 OpenClaw 可能需要该工具。",
      suggestion: "请安装 Git，或在 macOS 上通过 Xcode Command Line Tools 安装。",
      repairAction: "install_git"
    }
  }[command];

  return {
    ...check,
    ok: false,
    level: "fail",
    category: command === "node" ? "runtime" : "dependency",
    code: meta.code,
    message: meta.message,
    suggestion: meta.suggestion,
    repairable: true,
    repairAction: meta.repairAction
  };
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

async function runQuickConfigure(options = {}, runtimeOptions = {}) {
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

  const gatewayOptions = createGatewayOperationOptions(runtimeOptions);
  ensureGatewayDiagnosticRun(gatewayOptions.diagnosticLogger, "quick_configure");
  const runtime = await resolveOpenClawExecutable(gatewayOptions);

  if (!runtime.ok) {
    return {
      success: false,
      ok: false,
      message: "未检测到 OpenClaw，请先执行一键安装。"
    };
  }

  const defaultModel = String(options.defaultModel || "").trim();
  const portSelection = await (runtimeOptions.selectGatewayPort || selectGatewayPort)(gatewayOptions);
  if (!portSelection || !portSelection.ok) {
    logSafeDiagnostic(gatewayOptions.diagnosticLogger, "gateway_port_selection_failed", {
      code: portSelection && portSelection.code || "NO_AVAILABLE_GATEWAY_PORT"
    });
    return {
      success: false,
      ok: false,
      code: "NO_AVAILABLE_GATEWAY_PORT",
      message: "无法为当前用户分配安全的 OpenClaw Gateway 端口，请关闭冲突服务后重试。"
    };
  }
  gatewayOptions.gatewayPort = portSelection.port;
  const args = [
    "onboard",
    "--non-interactive",
    "--accept-risk",
    "--mode",
    "local",
    "--auth-choice",
    providerConfig.authChoice,
    providerConfig.keyArg,
    apiKey,
    "--secret-input-mode",
    "plaintext",
    "--gateway-bind",
    "loopback",
    "--gateway-port",
    String(portSelection.port),
    "--install-daemon",
    "--daemon-runtime",
    "node",
    "--skip-search",
    "--skip-skills",
    "--skip-channels",
    "--skip-health",
    "--skip-ui",
    "--json"
  ];

  logSafeDiagnostic(gatewayOptions.diagnosticLogger, "onboard_gateway_port", {
    onboardGatewayPort: portSelection.port
  });

  await captureGatewayAuthSnapshot(runtime.executablePath, gatewayOptions, "T1_before_quick_configure");

  const result = await runCommand(
    runtime.executablePath,
    args,
    createGatewayCommandOptions(gatewayOptions)
  );
  await captureGatewayAuthSnapshot(runtime.executablePath, gatewayOptions, "T2_after_quick_configure");

  if (result.code !== 0) {
    return {
      success: false,
      ok: false,
      message: "OpenClaw 快速配置失败。错误摘要：" + sanitizeCommandOutput(result.stderr || result.stdout, [apiKey])
    };
  }

  const configuredPortState = await (
    runtimeOptions.readConfiguredGatewayPortState || readConfiguredGatewayPortState
  )(gatewayOptions.commandEnv);
  const serviceGatewayPortState = normalizeManagedGatewayServicePortState(await (
    runtimeOptions.readManagedGatewayServicePortState || readManagedGatewayServicePortState
  )(gatewayOptions));
  logSafeDiagnostic(gatewayOptions.diagnosticLogger, "gateway_port_selection_applied", {
    selectedPort: portSelection.port,
    afterOnboardConfiguredPort: configuredPortState.configured
      ? configuredPortState.port
      : null,
    serviceGatewayPort: serviceGatewayPortState.port,
    serviceGatewayPortStatus: serviceGatewayPortState.status
  });
  if (
    !configuredPortState.configured ||
    configuredPortState.port !== portSelection.port
  ) {
    return {
      success: false,
      ok: false,
      code: "GATEWAY_PORT_CONFIGURATION_MISMATCH",
      message: "OpenClaw Gateway 端口配置未正确保存，请进入问题排查看安装记录。"
    };
  }
  if (!serviceGatewayPortState || serviceGatewayPortState.status !== "available") {
    return {
      success: false,
      ok: false,
      code: "GATEWAY_PORT_VERIFICATION_UNAVAILABLE",
      message: "无法确认 OpenClaw Gateway 服务端口，请进入问题排查看安装记录。"
    };
  }
  if (serviceGatewayPortState.port !== portSelection.port) {
    return {
      success: false,
      ok: false,
      code: "GATEWAY_PORT_CONFIGURATION_MISMATCH",
      message: "OpenClaw Gateway 端口配置未正确保存，请进入问题排查看安装记录。"
    };
  }

  if (defaultModel) {
    const modelResult = await runCommand(
      runtime.executablePath,
      ["models", "set", defaultModel],
      createGatewayCommandOptions(gatewayOptions)
    );
    await captureGatewayAuthSnapshot(runtime.executablePath, gatewayOptions, "T3_after_model_set");

    if (modelResult.code !== 0) {
      return {
        success: false,
        ok: false,
        message: "AI 服务商已配置，但默认模型设置失败。错误摘要："
          + sanitizeCommandOutput(modelResult.stderr || modelResult.stdout, [apiKey])
      };
    }
  }

  return {
    success: true,
    ok: true,
    message: "OpenClaw 快速配置已完成，正在验证配置。"
  };
}

function sanitizeCommandOutput(output, secrets = []) {
  let text = String(output || "");

  for (const secret of secrets) {
    if (secret) {
      text = text.split(secret).join("[已隐藏]");
    }
  }

  text = sanitizeDiagnosticText(text).trim();

  if (!text) {
    return "官方命令未返回详细错误。";
  }

  return text.split("\n").slice(0, 4).join("\n").slice(0, 500);
}

function normalizeManagedGatewayServicePortState(value) {
  if (
    value &&
    value.status === "available" &&
    Number.isInteger(value.port)
  ) {
    return { status: "available", port: value.port, reason: null };
  }
  return {
    status: "unavailable",
    port: null,
    reason: value && value.reason || "unavailable"
  };
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

async function openDashboard(options = {}) {
  const gatewayOptions = createGatewayOperationOptions(options);
  ensureGatewayDiagnosticRun(gatewayOptions.diagnosticLogger, "dashboard");
  const runtime = await resolveOpenClawExecutable(gatewayOptions);

  if (!runtime.ok) {
    return {
      success: false,
      ok: false,
      message: "未检测到 OpenClaw，请先执行一键安装。"
    };
  }

  const port = await readConfiguredGatewayPort(gatewayOptions.commandEnv);
  const ownership = await (gatewayOptions.inspectGatewayPort || inspectGatewayPort)(
    port,
    gatewayOptions
  );
  gatewayOptions.gatewayPort = port;
  logSafeDiagnostic(gatewayOptions.diagnosticLogger, "gateway_port_ownership_checked", {
    port,
    listenerPresent: ownership.listenerPresent,
    launchAgentPid: ownership.launchAgentPid,
    listenerPid: ownership.listenerPid,
    listenerMatchesLaunchAgent: ownership.listenerMatchesLaunchAgent,
    conflict: ownership.conflict,
    conflictKind: ownership.conflictKind
  });
  if (!ownership.verified) {
    return {
      success: false,
      ok: false,
      message: "无法确认 OpenClaw Gateway 端口状态，请进入问题排查后重试。"
    };
  }
  if (ownership.conflict) {
    logSafeDiagnostic(gatewayOptions.diagnosticLogger, "gateway_port_conflict", {
      rootCause: ownership.conflictKind,
      secondarySymptom: "token_mismatch",
      port,
      launchAgentPid: ownership.launchAgentPid,
      listenerPid: ownership.listenerPid
    });
    return {
      success: false,
      ok: false,
      message: "OpenClaw Gateway 端口已被其他用户或外部程序占用，工具箱不会操作该进程。"
    };
  }

  const gatewayPreparation = await prepareLocalGateway(
    runtime.executablePath,
    gatewayOptions
  );
  if (!gatewayPreparation.ok) {
    return {
      success: false,
      ok: false,
      message: gatewayPreparation.message
    };
  }

  if (!gatewayPreparation.alreadyReady) {
    if (!gatewayPreparation.skipStart) {
      const gatewayStart = await startManagedGateway(
        runtime.executablePath,
        gatewayOptions
      );
      if (!gatewayStart.ok) {
        return {
          success: false,
          ok: false,
          message: "OpenClaw Gateway 启动失败，请进入问题排查看安装记录后重试。"
        };
      }
    }

    const readiness = await waitForGatewayReady(
      runtime.executablePath,
      gatewayOptions
    );
    if (!readiness.ready) {
      writeGatewayDiagnosticSummary(gatewayOptions.diagnosticLogger, readiness.status);
      return {
        success: false,
        ok: false,
        message: "OpenClaw Gateway 启动命令已完成，但 RPC 未就绪，请进入问题排查看安装记录后重试。"
      };
    }
  }

  const dashboardHelpResult = await runCommand(
    runtime.executablePath,
    ["dashboard", "--help"],
    createDashboardCommandOptions(gatewayOptions, 10000)
  );
  const supportsDashboardJson = dashboardHelpSupportsJson(
    dashboardHelpResult.stdout,
    dashboardHelpResult.stderr
  );
  logSafeDiagnostic(gatewayOptions.diagnosticLogger, "dashboard_capability_detected", {
    exitCode: dashboardHelpResult.code,
    timedOut: Boolean(dashboardHelpResult.timedOut),
    spawnFailed: Boolean(dashboardHelpResult.spawnError),
    supportsJson: supportsDashboardJson
  });

  const authenticated = await runAuthenticatedDashboardCommand(
    runtime.executablePath,
    gatewayOptions
  );
  const dashboardTextResult = authenticated.result;
  const connection = authenticated.connection;
  const baseConnection = authenticated.baseConnection;

  logSafeDiagnostic(gatewayOptions.diagnosticLogger, "dashboard_connection_resolved", {
    exitCode: dashboardTextResult.code,
    timedOut: Boolean(dashboardTextResult.timedOut),
    spawnFailed: Boolean(dashboardTextResult.spawnError),
    resolverMode: "clipboard_authenticated_url",
    supportsJson: supportsDashboardJson,
    stdoutPresent: Boolean(String(dashboardTextResult.stdout || "").trim()),
    stdoutBaseUrlValid: baseConnection.ok,
    stdoutBasePortMatches: baseConnection.port === String(port),
    stderrPresent: Boolean(String(dashboardTextResult.stderr || "").trim()),
    stderrSummary: summarizeDashboardStderr(dashboardTextResult.stderr),
    dashboardUrlResolved: connection.ok,
    protocol: connection.protocol,
    hostname: connection.hostname,
    port: connection.port,
    queryPresent: connection.queryPresent,
    hashPresent: connection.hashPresent,
    tokenPresent: connection.tokenPresent,
    clipboardRead: authenticated.clipboardRead,
    clipboardChanged: authenticated.clipboardChanged,
    clipboardRestored: authenticated.clipboardRestored,
    failureKind: authenticated.failureKind
  });

  if (
    dashboardTextResult.code !== 0 ||
    dashboardTextResult.timedOut ||
    dashboardTextResult.spawnError ||
    !authenticated.ok
  ) {
    writeGatewayDiagnosticSummary(gatewayOptions.diagnosticLogger, null);
    return {
      success: false,
      ok: false,
      code: "DASHBOARD_AUTH_URL_UNAVAILABLE",
      message: "无法获取 OpenClaw 控制台认证地址，请稍后重试，或进入问题排查看日志。"
    };
  }

  writeGatewayDiagnosticSummary(gatewayOptions.diagnosticLogger, null);

  return {
    success: true,
    ok: true,
    dashboardUrl: connection.url,
    message: "已打开 OpenClaw 控制台，请在浏览器中完成连接。"
  };
}

async function runAuthenticatedDashboardCommand(executablePath, options) {
  const invalid = createInvalidDashboardConnection();
  if (typeof options.readDashboardClipboard !== "function" ||
      typeof options.writeDashboardClipboard !== "function") {
    return createDashboardClipboardResult(
      invalid,
      invalid,
      "clipboard_unavailable",
      { result: createUnavailableDashboardResult() }
    );
  }

  let previousClipboard;
  let clipboardText;
  let result = createUnavailableDashboardResult();
  let clipboardRead = false;
  let clipboardRestored = false;
  let readFailure = false;
  try {
    previousClipboard = await options.readDashboardClipboard();
    clipboardRead = true;
    result = await runCommand(
      executablePath,
      ["dashboard", "--no-open"],
      createDashboardCommandOptions(options, 10000)
    );
    clipboardText = await options.readDashboardClipboard();
  } catch (error) {
    readFailure = true;
  } finally {
    if (clipboardRead) {
      try {
        await options.writeDashboardClipboard(String(previousClipboard || ""));
        clipboardRestored = true;
      } catch (error) {}
    }
  }

  const baseConnection = parseDashboardTextConnection(result.stdout, result.stderr);
  const connection = parseDashboardTextConnection(clipboardText, "");
  const expectedPort = String(options.gatewayPort || "");
  const clipboardChanged = String(clipboardText || "") !== String(previousClipboard || "");
  let failureKind = null;
  if (readFailure) failureKind = "clipboard_read_failed";
  else if (!commandSucceeded(result)) failureKind = "dashboard_command_failed";
  else if (!baseConnection.ok || baseConnection.port !== expectedPort) {
    failureKind = "stdout_base_url_mismatch";
  } else if (!clipboardChanged) failureKind = "clipboard_not_updated";
  else if (!connection.ok) failureKind = "clipboard_url_invalid";
  else if (connection.port !== expectedPort) failureKind = "clipboard_port_mismatch";
  else if (!connection.tokenPresent) failureKind = "clipboard_auth_missing";

  return createDashboardClipboardResult(connection, baseConnection, failureKind, {
    result,
    clipboardRead,
    clipboardChanged,
    clipboardRestored
  });
}

function createDashboardClipboardResult(connection, baseConnection, failureKind, details = {}) {
  return {
    ok: failureKind === null,
    connection,
    baseConnection,
    result: details.result || createUnavailableDashboardResult(),
    failureKind,
    clipboardRead: Boolean(details.clipboardRead),
    clipboardChanged: Boolean(details.clipboardChanged),
    clipboardRestored: Boolean(details.clipboardRestored)
  };
}

function createUnavailableDashboardResult() {
  return {
    code: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    spawnError: true
  };
}

async function startManagedGateway(executablePath, options) {
  let startResult = await runGatewayLifecycleCommand(
    executablePath,
    ["gateway", "start"],
    "dashboard_gateway_start",
    options
  );

  if (commandSucceeded(startResult)) {
    return { ok: true };
  }

  if (!resultMentionsMissingGatewayService(startResult)) {
    return { ok: false };
  }

  await captureGatewayAuthSnapshot(executablePath, options, "T5_before_gateway_install");
  const installResult = await runGatewayLifecycleCommand(
    executablePath,
    ["gateway", "install"],
    "dashboard_gateway_install",
    options
  );
  if (!commandSucceeded(installResult)) {
    return { ok: false };
  }
  await captureGatewayAuthSnapshot(executablePath, options, "T6_after_gateway_install");

  startResult = await runGatewayLifecycleCommand(
    executablePath,
    ["gateway", "start"],
    "dashboard_gateway_start",
    options,
    "after_install"
  );
  await captureGatewayAuthSnapshot(executablePath, options, "T7_after_gateway_start");
  return { ok: commandSucceeded(startResult) };
}

async function runGatewayLifecycleCommand(
  executablePath,
  args,
  event,
  options,
  phase = "initial"
) {
  const result = await runCommand(
    executablePath,
    args,
    createDashboardCommandOptions(options, 30000)
  );
  logSafeDiagnostic(options.diagnosticLogger, event, {
    command: "openclaw",
    args,
    phase,
    exitCode: result.code,
    timedOut: Boolean(result.timedOut),
    spawnFailed: Boolean(result.spawnError),
    durationMs: Number.isFinite(result.durationMs) ? result.durationMs : null,
    stdoutPresent: Boolean(String(result.stdout || "").trim()),
    stdoutSummary: summarizeDashboardOutput(result.stdout),
    stderrPresent: Boolean(String(result.stderr || "").trim()),
    stderrSummary: summarizeDashboardOutput(result.stderr)
  });
  return result;
}

async function prepareLocalGateway(executablePath, options) {
  await captureGatewayAuthSnapshot(executablePath, options, "T8_before_rpc_probe");
  const status = await queryGatewayReadiness(executablePath, options);
  await captureGatewayAuthSnapshot(executablePath, options, "T9_after_rpc_probe", status);
  logSafeDiagnostic(options.diagnosticLogger, "gateway_readiness_checked", {
    phase: "before_start",
    exitCode: status.result.code,
    timedOut: Boolean(status.result.timedOut),
    spawnFailed: Boolean(status.result.spawnError),
    ready: status.ready,
    gatewayRuntimeState: status.gatewayRuntimeState,
    gatewayServiceLoaded: status.gatewayServiceLoaded,
    gatewayHealthHealthy: status.gatewayHealthHealthy,
    gatewayRpcOk: status.gatewayRpcOk,
    gatewayRpcFailureKind: status.gatewayRpcFailureKind,
    inheritedGatewayTokenIgnored: options.inheritedGatewayTokenPresent === true
  });

  if (status.ready) {
    return {
      ok: true,
      alreadyReady: true
    };
  }

  if (
    status.running &&
    ["token_mismatch", "unauthorized"].includes(status.gatewayRpcFailureKind)
  ) {
    logSafeDiagnostic(options.diagnosticLogger, "gateway_rpc_auth_failed", {
      gatewayRuntimeState: status.gatewayRuntimeState,
      gatewayServiceLoaded: status.gatewayServiceLoaded,
      gatewayHealthHealthy: status.gatewayHealthHealthy,
      gatewayRpcFailureKind: status.gatewayRpcFailureKind,
      automaticRepairAttempted: false
    });
    writeGatewayDiagnosticSummary(options.diagnosticLogger, status);
    return {
      ok: false,
      alreadyReady: false,
      message: "OpenClaw Gateway 正在运行，但 RPC 认证失败。工具箱未自动重装或重启服务，请进入问题排查看安装记录。"
    };
  }

  if (status.running) {
    return {
      ok: true,
      alreadyReady: false,
      skipStart: true
    };
  }

  const modeResult = await runCommand(
    executablePath,
    ["config", "get", "gateway.mode", "--json"],
    createDashboardCommandOptions(options, 10000)
  );
  const mode = parseGatewayMode(modeResult);
  const modeMissing =
    statusMentionsMissingGatewayMode(status.result) ||
    configResultIsMissingGatewayMode(modeResult);

  logSafeDiagnostic(options.diagnosticLogger, "gateway_mode_checked", {
    exitCode: modeResult.code,
    timedOut: Boolean(modeResult.timedOut),
    spawnFailed: Boolean(modeResult.spawnError),
    modePresent: Boolean(mode),
    modeLocal: mode === "local",
    modeMissing
  });

  if (mode === "remote") {
    return {
      ok: false,
      alreadyReady: false,
      message: "当前 OpenClaw 使用远程 Gateway，工具箱不会自动改写为本地模式。"
    };
  }

  if (!mode && !modeMissing) {
    return {
      ok: false,
      alreadyReady: false,
      message: "无法确认 OpenClaw Gateway 配置，请进入问题排查看安装记录。"
    };
  }

  if (modeMissing) {
    const initializeResult = await runCommand(
      executablePath,
      ["config", "set", "gateway.mode", "local"],
      createDashboardCommandOptions(options, 10000)
    );
    const initialized = commandSucceeded(initializeResult);

    logSafeDiagnostic(options.diagnosticLogger, "gateway_mode_initialized", {
      exitCode: initializeResult.code,
      timedOut: Boolean(initializeResult.timedOut),
      spawnFailed: Boolean(initializeResult.spawnError),
      initialized
    });

    if (!initialized) {
      return {
        ok: false,
        alreadyReady: false,
        message: "无法初始化本地 OpenClaw Gateway，请进入问题排查看安装记录。"
      };
    }
  }

  await captureGatewayAuthSnapshot(executablePath, options, "T4_after_gateway_mode");

  return {
    ok: true,
    alreadyReady: false,
    skipStart: false
  };
}

async function waitForGatewayReady(executablePath, options) {
  const maxAttempts = Number.isInteger(options.gatewayReadyMaxAttempts)
    ? Math.max(1, options.gatewayReadyMaxAttempts)
    : GATEWAY_READY_MAX_ATTEMPTS;
  const delayMs = Number.isInteger(options.gatewayReadyDelayMs)
    ? Math.max(0, options.gatewayReadyDelayMs)
    : GATEWAY_READY_DELAY_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const status = await queryGatewayReadiness(executablePath, options);
    if (status.ready) {
      logSafeDiagnostic(options.diagnosticLogger, "gateway_ready", {
        ready: true,
        attempts: attempt,
        endpoint: `ws://127.0.0.1:${options.gatewayPort || 18789}`
      });
      return {
        ready: true,
        attempts: attempt,
        status
      };
    }

    logSafeDiagnostic(options.diagnosticLogger, "gateway_readiness_attempt", {
      attempt,
      ready: false,
      exitCode: status.result.code,
      timedOut: Boolean(status.result.timedOut),
      spawnFailed: Boolean(status.result.spawnError),
      failureType: classifyGatewayReadinessFailure(status.result)
    });

    if (attempt < maxAttempts) {
      await delay(delayMs, options.setTimeoutImpl);
    }
  }

  logSafeDiagnostic(options.diagnosticLogger, "gateway_ready", {
    ready: false,
    attempts: maxAttempts,
    endpoint: `ws://127.0.0.1:${options.gatewayPort || 18789}`
  });
  return {
    ready: false,
    attempts: maxAttempts,
    status: null
  };
}

function classifyGatewayReadinessFailure(result) {
  const status = parseGatewayStatus(result);
  if (status.gatewayRpcFailureKind !== "unknown") {
    return status.gatewayRpcFailureKind;
  }
  if (result && result.timedOut) {
    return "timeout";
  }
  if (result && result.spawnError) {
    return "spawn_failed";
  }
  return "rpc_not_ready";
}

function resultMentionsMissingGatewayService(result) {
  const text = stripAnsi(
    `${String(result && result.stdout || "")}\n`
    + String(result && result.stderr || "")
  );
  return /(?:gateway\s+)?service\s+(?:is\s+)?not\s+installed|install\s+the\s+gateway\s+service|run\s+[`'"]?openclaw gateway install/i
    .test(text);
}

async function queryGatewayReadiness(executablePath, options) {
  const result = await runCommand(
    executablePath,
    ["gateway", "status", "--json", "--require-rpc"],
    createDashboardCommandOptions(options, 5000)
  );

  return parseGatewayStatus(result);
}

function parseGatewayStatus(result) {
  let payload = null;
  try {
    const parsed = JSON.parse(String(result && result.stdout || "").trim());
    payload = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch (error) {
    payload = null;
  }
  const service = payload && payload.service || {};
  const runtime = service.runtime || payload && payload.runtime || {};
  const health = payload && payload.health || {};
  const rpc = payload && payload.rpc || {};
  const runtimeValue = runtime.status || runtime.state;
  const gatewayRuntimeState = typeof runtimeValue === "string"
    ? runtimeValue.trim().toLowerCase()
    : null;
  const gatewayServiceLoaded = typeof service.loaded === "boolean"
    ? service.loaded
    : null;
  const gatewayHealthHealthy = typeof health.healthy === "boolean"
    ? health.healthy
    : null;
  const gatewayRpcOk = typeof rpc.ok === "boolean" ? rpc.ok : null;
  const failureText = [
    payload && payload.rpc && payload.rpc.error,
    result && result.stderr,
    result && result.stdout
  ].filter(Boolean).join("\n");
  const gatewayRpcFailureKind = classifyGatewayRpcFailure(
    result,
    failureText
  );
  const running = ["running", "active"].includes(
    String(gatewayRuntimeState || "").toLowerCase()
  ) || gatewayHealthHealthy === true;
  const ready = gatewayRpcOk === true && commandSucceeded(result);

  return {
    ready,
    running,
    result,
    gatewayRuntimeState,
    gatewayServiceLoaded,
    gatewayHealthHealthy,
    gatewayRpcOk,
    gatewayRpcFailureKind
  };
}

function classifyGatewayRpcFailure(result, text) {
  if (result && result.timedOut) {
    return "timeout";
  }
  if (result && result.spawnError) {
    return "spawn_failed";
  }

  const normalized = stripAnsi(text).toLowerCase();
  if (/token\s+mismatch|gateway\s+auth\s+token/.test(normalized)) {
    return "token_mismatch";
  }
  if (/unauthori[sz]ed|\b1008\b/.test(normalized)) {
    return "unauthorized";
  }
  if (/connection\s+refused|econnrefused|port\s+\d+\s+is\s+not\s+listening/.test(normalized)) {
    return "connection_refused";
  }
  if (/service\s+(?:is\s+)?not\s+(?:installed|running)|gateway\s+is\s+stopped/.test(normalized)) {
    return "service_not_running";
  }
  return "unknown";
}

function createGatewayOperationOptions(options = {}) {
  const sourceEnv = options.commandEnv || process.env;
  const commandEnv = { ...sourceEnv };
  const inheritedGatewayTokenPresent = Boolean(
    String(commandEnv.OPENCLAW_GATEWAY_TOKEN || "").trim()
  );
  const inheritedGatewayPortPresent = Boolean(
    String(commandEnv.OPENCLAW_GATEWAY_PORT || "").trim()
  );

  delete commandEnv.OPENCLAW_GATEWAY_TOKEN;
  delete commandEnv.OPENCLAW_GATEWAY_PORT;

  return {
    ...options,
    commandEnv,
    inheritedGatewayTokenPresent,
    inheritedGatewayPortPresent
  };
}

function createDashboardCommandOptions(options, timeoutMs) {
  return {
    allowFailure: true,
    timeoutMs,
    env: options.commandEnv,
    commandEnvOptions: options.commandEnvOptions,
    diagnosticLogger: options.diagnosticLogger
  };
}

function createGatewayCommandOptions(options) {
  return {
    allowFailure: true,
    env: options.commandEnv,
    commandEnvOptions: options.commandEnvOptions,
    diagnosticLogger: options.diagnosticLogger
  };
}

function commandSucceeded(result) {
  return Boolean(
    result &&
    result.code === 0 &&
    !result.timedOut &&
    !result.spawnError
  );
}

function parseGatewayMode(result) {
  if (!commandSucceeded(result)) {
    return null;
  }

  const output = String(result.stdout || "").trim();
  if (!output) {
    return null;
  }

  try {
    const parsed = JSON.parse(output);
    return typeof parsed === "string" ? parsed.trim().toLowerCase() : null;
  } catch (error) {
    return /^(?:local|remote)$/i.test(output) ? output.toLowerCase() : null;
  }
}

function configResultIsMissingGatewayMode(result) {
  if (!result || result.code === 0) {
    return false;
  }

  const text = `${String(result.stdout || "")}\n${String(result.stderr || "")}`;
  return /config path not found:\s*gateway\.mode/i.test(text);
}

function statusMentionsMissingGatewayMode(result) {
  const text = `${String(result.stdout || "")}\n${String(result.stderr || "")}`;
  return (
    /existing config is missing gateway\.mode/i.test(text) ||
    /gateway start blocked:\s*(?:set\s+)?gateway\.mode(?:=local)?/i.test(text) ||
    /gateway\.mode\s+(?:is\s+)?not set/i.test(text)
  );
}

function delay(milliseconds, setTimeoutImpl = setTimeout) {
  return new Promise((resolve) => {
    setTimeoutImpl(resolve, milliseconds);
  });
}

function parseDashboardConnection(output) {
  let payload;
  try {
    payload = JSON.parse(String(output || ""));
  } catch (error) {
    return createInvalidDashboardConnection();
  }

  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    payload.ok === false
  ) {
    return createInvalidDashboardConnection({ jsonValid: true });
  }

  const candidates = [payload.url, payload.httpUrl];

  for (const candidate of candidates) {
    const connection = parseDashboardUrl(candidate, {
      jsonValid: true,
      tokenIncluded: payload.tokenIncluded === true
    });
    if (connection.ok) {
      return connection;
    }
  }

  return createInvalidDashboardConnection({ jsonValid: true });
}

function parseDashboardTextConnection(stdout, stderr) {
  const text = stripAnsi(
    [stdout, stderr]
      .map((value) => String(value || ""))
      .filter(Boolean)
      .join("\n")
  );
  const candidates = text.match(/\bhttps?:\/\/[^\s<>"']+/gi) || [];

  for (const rawCandidate of candidates) {
    const candidate = rawCandidate.replace(/[),.;\]]+$/g, "");
    const connection = parseDashboardUrl(candidate, {
      jsonValid: false,
      tokenIncluded: false
    });
    if (connection.ok) {
      return connection;
    }
  }

  return createInvalidDashboardConnection();
}

function parseDashboardUrl(candidate, options = {}) {
  if (typeof candidate !== "string" || !candidate.trim()) {
    return createInvalidDashboardConnection({
      jsonValid: Boolean(options.jsonValid)
    });
  }

  try {
    const url = new URL(candidate.trim());
    const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

    if (
      !["http:", "https:"].includes(url.protocol) ||
      !loopbackHosts.has(url.hostname)
    ) {
      return createInvalidDashboardConnection({
        jsonValid: Boolean(options.jsonValid)
      });
    }

    return {
      ok: true,
      jsonValid: Boolean(options.jsonValid),
      url: url.toString(),
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || null,
      queryPresent: Boolean(url.search),
      hashPresent: Boolean(url.hash),
      tokenPresent:
        Boolean(options.tokenIncluded) ||
        url.searchParams.has("token") ||
        new URLSearchParams(url.hash.replace(/^#/, "")).has("token")
    };
  } catch (error) {
    return createInvalidDashboardConnection({
      jsonValid: Boolean(options.jsonValid)
    });
  }
}

function dashboardHelpSupportsJson(stdout, stderr) {
  const help = stripAnsi(`${String(stdout || "")}\n${String(stderr || "")}`);
  return /(?:^|[^A-Za-z0-9_-])--json(?=$|[^A-Za-z0-9_-])/m.test(help);
}

function stripAnsi(value) {
  return String(value || "").replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}

function createInvalidDashboardConnection(overrides = {}) {
  return {
    ok: false,
    jsonValid: false,
    url: null,
    protocol: null,
    hostname: null,
    port: null,
    queryPresent: false,
    hashPresent: false,
    tokenPresent: false,
    ...overrides
  };
}

function logSafeDiagnostic(logger, event, details) {
  if (!logger || typeof logger.event !== "function") {
    return;
  }

  try {
    logger.event(event, details);
  } catch (error) {
    // 诊断写入失败不能改变控制台启动结果。
  }
}

function ensureGatewayDiagnosticRun(logger, phase) {
  if (!logger || typeof logger.beginDiagnosticRun !== "function") return;
  if (typeof logger.getDiagnosticRunId !== "function" || !logger.getDiagnosticRunId()) {
    logger.beginDiagnosticRun({ phase });
  }
}

async function captureGatewayAuthSnapshot(executablePath, options, stage, status) {
  const logger = options.diagnosticLogger;
  if (!logger || typeof logger.recordGatewaySnapshot !== "function") return;
  try {
    const homeDir = String(options.commandEnv.HOME || os.homedir() || "").trim();
    const stateDir = options.commandEnv.OPENCLAW_STATE_DIR || path.join(homeDir, ".openclaw");
    const configPath = options.commandEnv.OPENCLAW_CONFIG_PATH || path.join(stateDir, "openclaw.json");
    const [versionResult, gateway] = await Promise.all([
      runCommand(executablePath, ["--version"], createDashboardCommandOptions(options, 5000)),
      readGatewayConfigFile(configPath)
    ]);
    const token = gateway && gateway.auth && gateway.auth.token;
    const tokenType = classifyGatewayTokenInput(token);
    const configTokenFingerprint = tokenType === "literal"
      ? logger.fingerprintSecret(token)
      : null;
    const envToken = String(options.commandEnv.OPENCLAW_GATEWAY_TOKEN || "").trim();
    const envFingerprint = logger.fingerprintSecret(envToken);
    const payload = parseGatewayStatusPayload(status && status.result);
    const serviceEnvironment = payload && payload.service && payload.service.command && payload.service.command.environment || {};
    const service = await readGatewayServiceCredential(options, logger, serviceEnvironment);
    const runtime = payload && payload.service && payload.service.runtime || {};
    const listeners = payload && payload.port && Array.isArray(payload.port.listeners)
      ? payload.port.listeners
      : [];
    const listenerPids = [...new Set(listeners.map((item) => item && item.pid).filter(Number.isInteger))];
    const cliConfigPath = payload && payload.config && payload.config.cli && payload.config.cli.path;
    const daemonConfigPath = payload && payload.config && payload.config.daemon && payload.config.daemon.path;
    logger.recordGatewaySnapshot(stage, {
      openClawVersion: sanitizeSingleLine(versionResult.stdout || versionResult.stderr) || null,
      executable: executablePath,
      configPath,
      stateDir,
      profilePresent: Boolean(String(options.commandEnv.OPENCLAW_PROFILE || "").trim()),
      configPathOverridePresent: Boolean(options.commandEnv.OPENCLAW_CONFIG_PATH),
      stateDirOverridePresent: Boolean(options.commandEnv.OPENCLAW_STATE_DIR),
      gatewayMode: gateway && gateway.mode || null,
      gatewayAuthMode: gateway && gateway.auth && gateway.auth.mode || null,
      configTokenPresent: tokenType !== "missing",
      configTokenType: tokenType,
      configTokenSource: tokenType === "literal" ? "disk_config" : "unknown",
      secretRefResolved: tokenType === "secret_ref" ? "unknown" : null,
      configTokenFingerprint,
      processEnvGatewayTokenPresent: Boolean(envToken),
      serviceEnvGatewayTokenPresent: service.present,
      configVsProcessEnvEqual: compareFingerprints(configTokenFingerprint, envFingerprint),
      configVsServiceEqual: compareFingerprints(configTokenFingerprint, service.fingerprint),
      gatewayRuntimeTokenSource: "startup_auth_resolver_unobserved",
      gatewayRuntimeTokenFingerprint: "unknown",
      cliProbeTokenSource: "openclaw_internal_resolver_unobserved",
      rpcProbeResolvedTokenFingerprint: "unknown",
      configVsRpcProbeEqual: "unknown",
      runtimeVsCliTokenEqual: "unknown",
      serviceLoaded: payload && payload.service && payload.service.loaded,
      serviceLabel: payload && payload.service && payload.service.label || null,
      runtimeState: runtime.status || runtime.state || null,
      runtimePid: Number.isInteger(runtime.pid) ? runtime.pid : null,
      runtimeRunning: ["running", "active"].includes(String(runtime.status || runtime.state || "").toLowerCase()),
      port: payload && payload.port && payload.port.port || null,
      listenerIdentity: !listenerPids.length || !Number.isInteger(runtime.pid)
        ? "unknown"
        : listenerPids.includes(runtime.pid) ? "runtime" : "different_process",
      multipleGatewayProcesses: listenerPids.length > 1,
      configPathMismatch: Boolean(payload && payload.config && payload.config.mismatch) || Boolean(cliConfigPath && daemonConfigPath && cliConfigPath !== daemonConfigPath),
      stateDirOrProfileMismatch: Boolean(
        cliConfigPath && daemonConfigPath && path.dirname(cliConfigPath) !== path.dirname(daemonConfigPath) ||
        serviceEnvironment.OPENCLAW_STATE_DIR && serviceEnvironment.OPENCLAW_STATE_DIR !== stateDir ||
        serviceEnvironment.OPENCLAW_PROFILE && serviceEnvironment.OPENCLAW_PROFILE !== options.commandEnv.OPENCLAW_PROFILE
      ),
      rpcFailureKind: status && status.gatewayRpcFailureKind || null,
      healthHealthy: status && status.gatewayHealthHealthy === true,
      configAudit: await readConfigAuditSummary(stateDir, logger.getDiagnosticRunStartedAt())
    });
  } catch (error) {
    logSafeDiagnostic(logger, "gateway_auth_snapshot_failed", { stage, failureType: "snapshot_unavailable" });
  }
}

async function readGatewayConfigFile(configPath) {
  try {
    const parsed = JSON.parse(await fs.readFile(configPath, "utf8"));
    const gateway = parsed && parsed.gateway;
    return gateway && typeof gateway === "object" && !Array.isArray(gateway)
      ? gateway
      : null;
  } catch (error) {
    return null;
  }
}

function parseGatewayStatusPayload(result) {
  try {
    const parsed = JSON.parse(String(result && result.stdout || "").trim());
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (error) {
    return null;
  }
}

function classifyGatewayTokenInput(value) {
  if (value === null || value === undefined || value === "") return "missing";
  if (value && typeof value === "object") return "secret_ref";
  if (typeof value === "string" && /\$\{[A-Z_][A-Z0-9_]*\}/.test(value)) return "env_reference";
  return typeof value === "string" ? "literal" : "unknown";
}

async function readGatewayServiceCredential(options, logger, serviceEnvironment = {}) {
  const embeddedToken = String(serviceEnvironment.OPENCLAW_GATEWAY_TOKEN || "").trim();
  if (embeddedToken) return { present: true, fingerprint: logger.fingerprintSecret(embeddedToken) };
  const homeDir = String(options.commandEnv.HOME || os.homedir() || "").trim();
  const serviceEnvPath = options.gatewayServiceEnvPath || path.join(homeDir, ".openclaw/service-env/ai.openclaw.gateway.env");
  try {
    const content = await fs.readFile(serviceEnvPath, "utf8");
    const match = content.match(/^\s*(?:export\s+)?OPENCLAW_GATEWAY_TOKEN\s*=\s*(.*)\s*$/m);
    const token = match ? String(match[1]).trim().replace(/^(["'])(.*)\1$/, "$2") : "";
    return { present: Boolean(token), fingerprint: logger.fingerprintSecret(token) };
  } catch (error) {
    return { present: error && error.code === "ENOENT" ? false : null, fingerprint: null };
  }
}

function compareFingerprints(left, right) {
  return left && right ? left === right : "unknown";
}

async function readConfigAuditSummary(stateDir, startedAt) {
  try {
    const content = await fs.readFile(path.join(stateDir, "logs", "config-audit.jsonl"), "utf8");
    const startMs = Date.parse(startedAt || "");
    return content.trim().split("\n").slice(-200).flatMap((line) => {
      try {
        const entry = JSON.parse(line);
        if (Number.isFinite(startMs) && Date.parse(entry.ts) < startMs) return [];
        return [{
          timestamp: entry.ts || null,
          source: entry.source || null,
          event: entry.event || null,
          changedKeys: Array.isArray(entry.changedKeys) ? entry.changedKeys.filter(isRelevantConfigKey) : [],
          changedPathCount: Number.isInteger(entry.changedPathCount) ? entry.changedPathCount : null,
          gatewayModeBefore: entry.gatewayModeBefore || null,
          gatewayModeAfter: entry.gatewayModeAfter || null
        }];
      } catch (error) {
        return [];
      }
    }).slice(-20);
  } catch (error) {
    return [];
  }
}

function isRelevantConfigKey(key) {
  return /^(?:gateway\.(?:mode|auth|remote)|models|agents)(?:\.|$)/.test(String(key || ""));
}

function writeGatewayDiagnosticSummary(logger, status) {
  if (!logger || typeof logger.writeGatewaySummary !== "function") return;
  logger.writeGatewaySummary({
    gatewayState: status && status.gatewayRuntimeState || null,
    rpcFailureKind: status && status.gatewayRpcFailureKind || null
  });
}

function summarizeDashboardOutput(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  let summary = sanitizeDiagnosticText(raw)
    .replace(/\b(?:https?|wss?|file):\/\/[^\s"'<>]+/gi, "[REDACTED_URL]")
    .replace(
      /((?:session[-_ ]?key)\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1[REDACTED]"
    )
    .replace(/\/Users\/[^/\s]+/g, "~")
    .replace(/\s+/g, " ")
    .trim();

  if (summary.length > DASHBOARD_STDERR_SUMMARY_MAX_LENGTH) {
    summary = summary.slice(0, DASHBOARD_STDERR_SUMMARY_MAX_LENGTH)
      + "…[TRUNCATED]";
  }

  return summary || null;
}

function summarizeDashboardStderr(stderr) {
  return summarizeDashboardOutput(stderr);
}

async function stopDashboard(options = {}) {
  const runtime = await resolveOpenClawExecutable(options);

  if (!runtime.ok) {
    return {
      success: false,
      ok: false,
      message: "未检测到 OpenClaw，请先执行一键安装。"
    };
  }

  const result = await runCommand(
    runtime.executablePath,
    ["gateway", "stop"],
    {
      allowFailure: true,
      timeoutMs: 10000
    }
  );

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

async function openLogsDirectory(preferredLogPath) {
  const logPath = preferredLogPath || path.join(os.homedir(), ".openclaw-installer", "logs");

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
