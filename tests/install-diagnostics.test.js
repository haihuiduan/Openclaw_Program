"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  clearProjectModules,
  mockModule,
  projectPath
} = require("./helpers");

test("诊断日志写入注入路径并脱敏主目录、凭据和私钥", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-diagnostic-log-"));
  const fakeHome = path.join(tempDir, "Users", "private-user");
  const logPath = path.join(tempDir, "userData", "logs", "openclaw-install-debug.log");
  const {
    createInstallDiagnosticLogger
  } = require(projectPath("src/utils/installDiagnosticLogger.js"));
  const logger = createInstallDiagnosticLogger({
    logPath,
    homeDir: fakeHome
  });

  logger.event("test", {
    path: path.join(fakeHome, ".openclaw"),
    apiKey: "sk-super-secret-value",
    authorization: "Bearer hidden-token",
    text: [
      "OPENAI_API_KEY=sk-another-secret",
      "Authorization: Bearer another-hidden-token",
      "-----BEGIN PRIVATE KEY-----",
      "private-material",
      "-----END PRIVATE KEY-----"
    ].join("\n")
  });

  const output = fs.readFileSync(logPath, "utf8");
  const mode = fs.statSync(logPath).mode & 0o777;

  assert.equal(mode, 0o600);
  assert.doesNotMatch(output, new RegExp(escapeRegExp(fakeHome)));
  assert.doesNotMatch(output, /private-user|sk-super|another-secret|private-material|hidden-token/);
  assert.match(output, /~\/\.openclaw/);
  assert.match(output, /REDACTED/);
  assert.deepEqual(logger.getStatus(), {
    writeFailed: false,
    lastWriteErrorCode: null
  });

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("诊断日志允许 tokenPresent 这类布尔存在性字段但仍脱敏真实 token", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-diagnostic-presence-"));
  const logPath = path.join(tempDir, "openclaw-install-debug.log");
  const {
    createInstallDiagnosticLogger
  } = require(projectPath("src/utils/installDiagnosticLogger.js"));
  const logger = createInstallDiagnosticLogger({ logPath });

  logger.event("dashboard_connection_resolved", {
    tokenPresent: true,
    queryPresent: true,
    token: "secret-token-value"
  });

  const entry = JSON.parse(fs.readFileSync(logPath, "utf8").trim());
  assert.equal(entry.tokenPresent, true);
  assert.equal(entry.queryPresent, true);
  assert.equal(entry.token, "[REDACTED]");
  assert.doesNotMatch(JSON.stringify(entry), /secret-token-value/);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("统一诊断脱敏器清理常见 header、cookie 和 credential 赋值", () => {
  const { sanitizeDiagnosticText } = require(
    projectPath("src/utils/installDiagnosticLogger.js")
  );
  const fixtures = [
    ["Authorization: Bearer authorization-secret", "authorization-secret"],
    ["Cookie: session=cookie-secret", "cookie-secret"],
    ["Set-Cookie: session=set-cookie-secret", "set-cookie-secret"],
    ["OPENCLAW_GATEWAY_TOKEN=gateway-token-secret", "gateway-token-secret"],
    ["gateway.auth.token=auth-token-secret", "auth-token-secret"],
    ["password=password-secret", "password-secret"],
    ["secret=generic-secret", "generic-secret"],
    ["access_token=access-token-secret", "access-token-secret"],
    ["refresh token: refresh-token-secret", "refresh-token-secret"],
    ["apiKey=user-api-key-fixture", "user-api-key-fixture"]
  ];

  for (const [input, secret] of fixtures) {
    const output = sanitizeDiagnosticText(input);
    assert.doesNotMatch(output, new RegExp(secret));
    assert.match(output, /REDACTED/);
  }
});

test("OpenClaw provider API Key 命令参数不会进入诊断日志", () => {
  const { sanitizeCommandArgs } = require(
    projectPath("src/utils/installDiagnosticLogger.js")
  );
  assert.deepEqual(
    sanitizeCommandArgs(["onboard", "--deepseek-api-key", "fixture-plain-api-key"]),
    ["onboard", "--deepseek-api-key", "[REDACTED]"]
  );
});

test("Gateway 诊断以单次随机盐比较 token 时间线并生成证据分类", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-gateway-trace-"));
  const logPath = path.join(tempDir, "openclaw-install-debug.log");
  const { createInstallDiagnosticLogger } = require(
    projectPath("src/utils/installDiagnosticLogger.js")
  );
  const logger = createInstallDiagnosticLogger({ logPath });
  const firstRunId = logger.beginDiagnosticRun({ workflowId: "install" });
  const tokenA = "gateway-token-fixture-a";
  const tokenB = "gateway-token-fixture-b";
  const fingerprintA = logger.fingerprintSecret(tokenA);
  const fingerprintB = logger.fingerprintSecret(tokenB);

  logger.recordGatewaySnapshot("T1_before_quick_configure", {
    configTokenPresent: false,
    configTokenType: "missing",
    serviceTokenPresent: false,
    listenerOwnership: "unknown"
  });
  logger.recordGatewaySnapshot("T2_after_quick_configure", {
    configTokenPresent: true,
    configTokenType: "literal",
    configTokenFingerprint: fingerprintA,
    configTokenSource: "disk_config",
    gatewayRuntimeTokenSource: "startup_auth_resolver_unobserved",
    gatewayRuntimeTokenFingerprint: "unknown",
    cliProbeTokenSource: "openclaw_internal_resolver_unobserved",
    rpcProbeResolvedTokenFingerprint: "unknown"
  });
  logger.recordGatewaySnapshot("T7_after_gateway_start", {
    runtimeRunning: true,
    configTokenFingerprint: fingerprintA,
    configVsProcessEnvEqual: false,
    configPathMismatch: true,
    stateDirOrProfileMismatch: true,
    cliProbeSourceMismatch: true,
    multipleGatewayProcesses: true
  });
  logger.recordGatewaySnapshot("T9_after_rpc_probe", {
    configTokenFingerprint: fingerprintB,
    configVsServiceEqual: false,
    configTokenType: "secret_ref",
    secretRefResolved: "unknown"
  });
  logger.writeGatewaySummary({
    rpcFailureKind: "token_mismatch",
    upstreamBehaviorSuspected: true
  });

  const entries = fs.readFileSync(logPath, "utf8").trim().split("\n")
    .map((line) => JSON.parse(line));
  const summary = entries.find((entry) => entry.event === "gateway_diagnostic_summary");
  const generated = entries.find((entry) => entry.stage === "T2_after_quick_configure");
  const categories = new Set(summary.rootCauseCategories);
  for (const expected of [
    "TOKEN_CHANGED_AFTER_GATEWAY_START", "ENV_OVERRIDE_MISMATCH",
    "SECRET_REF_RESOLUTION_MISMATCH", "CONFIG_PATH_MISMATCH",
    "STATE_DIR_OR_PROFILE_MISMATCH", "CLI_PROBE_SOURCE_MISMATCH",
    "SERVICE_METADATA_DRIFT", "MULTIPLE_GATEWAY_PROCESSES",
    "UPSTREAM_OPENCLAW_BEHAVIOR"
  ]) assert.equal(categories.has(expected), true);
  assert.equal(firstRunId, entries[0].diagnosticRunId);
  assert.equal(generated.configTokenType, "literal");
  assert.equal(generated.configTokenFingerprint, fingerprintA);
  assert.equal(generated.configTokenSource, "disk_config");
  assert.equal(generated.gatewayRuntimeTokenFingerprint, "unknown");
  assert.equal(generated.rpcProbeResolvedTokenFingerprint, "unknown");
  assert.doesNotMatch(fs.readFileSync(logPath, "utf8"), /gateway-token-fixture/);

  logger.beginDiagnosticRun({ workflowId: "install" });
  assert.notEqual(logger.fingerprintSecret(tokenA), fingerprintA);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("service token 缺失且 token 全程不变不会被单独判为根因", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-gateway-stable-"));
  const logPath = path.join(tempDir, "openclaw-install-debug.log");
  const { createInstallDiagnosticLogger } = require(
    projectPath("src/utils/installDiagnosticLogger.js")
  );
  const logger = createInstallDiagnosticLogger({ logPath });
  logger.beginDiagnosticRun();
  const fingerprint = logger.fingerprintSecret("stable-gateway-token-fixture");
  logger.recordGatewaySnapshot("T7_after_gateway_start", {
    runtimeRunning: true,
    configTokenType: "literal",
    configTokenFingerprint: fingerprint,
    serviceTokenPresent: false,
    listenerOwnership: "unknown"
  });
  logger.recordGatewaySnapshot("T9_after_rpc_probe", {
    configTokenFingerprint: fingerprint,
    serviceTokenPresent: false
  });
  logger.writeGatewaySummary({ rpcFailureKind: "token_mismatch" });
  const summary = fs.readFileSync(logPath, "utf8").trim().split("\n")
    .map((line) => JSON.parse(line))
    .find((entry) => entry.event === "gateway_diagnostic_summary");
  assert.deepEqual(summary.rootCauseCategories, ["INSUFFICIENT_EVIDENCE"]);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("诊断日志写入失败不抛错且状态可查询", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-diagnostic-fail-"));
  const blocker = path.join(tempDir, "blocker");
  fs.writeFileSync(blocker, "not a directory");
  const {
    createInstallDiagnosticLogger
  } = require(projectPath("src/utils/installDiagnosticLogger.js"));
  const logger = createInstallDiagnosticLogger({
    logPath: path.join(blocker, "logs", "openclaw-install-debug.log")
  });

  assert.equal(logger.event("test", { ok: true }), false);
  assert.equal(logger.getStatus().writeFailed, true);
  assert.ok(logger.getStatus().lastWriteErrorCode);

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("官方安装脚本失败时读取 npm installer log 末尾并安全写入诊断日志", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-npm-log-"));
  const npmLogPath = path.join(tempDir, "npm-installer.log");
  const diagnosticLogPath = path.join(tempDir, "openclaw-install-debug.log");
  const secret = "test-token-value-that-must-not-leak";
  const lines = Array.from({ length: 105 }, (_, index) => `line-${index + 1}`);
  lines.push("EACCES permission denied");
  lines.push(`token=${secret}`);
  fs.writeFileSync(npmLogPath, lines.join("\n"), "utf8");

  clearProjectModules();
  mockModule("src/utils/shell/index.js", {
    resolveCommand: async () => ({
      command: "bash",
      found: true,
      resolvedPath: "/bin/bash"
    }),
    runCommand: async (command, args, options = {}) => {
      const stdout = `Installer log: ${npmLogPath}\n`;

      assert.equal(command, "bash");
      assert.equal(typeof options.onOutput, "function");
      options.onOutput({
        stream: "stdout",
        chunk: stdout,
        buffer: stdout
      });
      fs.rmSync(npmLogPath);

      return {
        command: "bash",
        args: ["/tmp/install.sh"],
        code: 1,
        exitCode: 1,
        stdout,
        stderr: "npm install failed",
        signal: null,
        timedOut: false,
        spawnError: null
      };
    }
  });
  const {
    createInstallDiagnosticLogger
  } = require(projectPath("src/utils/installDiagnosticLogger.js"));
  const step = require(projectPath("src/core/workflow/steps/execute_script.js"));
  const diagnosticLogger = createInstallDiagnosticLogger({
    logPath: diagnosticLogPath,
    homeDir: tempDir
  });

  t.after(() => {
    clearProjectModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const result = await step.run({
    config: {
      installScriptTimeoutMs: 120000
    },
    tempState: {
      scriptPath: "/tmp/install.sh"
    },
    diagnosticLogger,
    logger: {
      info() {},
      warn() {}
    }
  });
  const entries = fs.readFileSync(diagnosticLogPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  const failure = entries.find((entry) => entry.event === "install_script_failure");
  const capturedBeforeExit = entries.find(
    (entry) => entry.event === "npm_installer_log_captured_before_exit"
  );

  assert.equal(result.success, false);
  assert.equal(result.errorCode, "OPENCLAW_INSTALL_SCRIPT_FAILED");
  assert.match(result.userMessage, /查看安装记录后可以看到 npm 原因/);
  assert.ok(failure);
  assert.equal(failure.exitCode, 1);
  assert.equal(failure.command, "bash");
  assert.ok(capturedBeforeExit);
  assert.match(capturedBeforeExit.npmInstallerLogTail, /EACCES permission denied/);
  assert.equal(failure.npmInstallerLogPath, "~/npm-installer.log");
  assert.equal(failure.npmInstallerLogExists, true);
  assert.equal(failure.npmInstallerLogReadError, null);
  assert.match(failure.npmInstallerLogTail, /EACCES permission denied/);
  assert.equal(failure.npmEnvironment, undefined);
  assert.doesNotMatch(failure.npmInstallerLogTail, /line-1(?:\D|$)/);
  assert.doesNotMatch(JSON.stringify(failure), new RegExp(secret));
  assert.match(failure.npmInstallerLogTail, /token=\[REDACTED\]/);
});

test("临时 installer log 已消失时读取本次执行产生的 npm debug log", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-npm-debug-"));
  const fakeHome = path.join(tempDir, "home");
  const npmDebugDirectory = path.join(fakeHome, ".npm", "_logs");
  const npmDebugLogPath = path.join(npmDebugDirectory, "debug.log");
  const missingInstallerLogPath = path.join(tempDir, "missing-installer.log");
  const diagnosticLogPath = path.join(tempDir, "openclaw-install-debug.log");
  const originalHome = process.env.HOME;
  fs.mkdirSync(npmDebugDirectory, { recursive: true });
  fs.writeFileSync(npmDebugLogPath, "npm ERR! EACCES permission denied\n", "utf8");
  process.env.HOME = fakeHome;

  clearProjectModules();
  mockModule("src/utils/shell/index.js", {
    resolveCommand: async () => ({
      command: "bash",
      found: true,
      resolvedPath: "/bin/bash"
    }),
    runCommand: async (command, args, options = {}) => {
      const stdout = `Installer log:\n${missingInstallerLogPath}\n`;

      assert.equal(command, "bash");
      options.onOutput({
        stream: "stdout",
        chunk: stdout,
        buffer: stdout
      });

      return {
        command,
        args,
        code: 1,
        exitCode: 1,
        stdout,
        stderr: "npm install failed",
        signal: null,
        timedOut: false,
        spawnError: null
      };
    }
  });
  const {
    createInstallDiagnosticLogger
  } = require(projectPath("src/utils/installDiagnosticLogger.js"));
  const step = require(projectPath("src/core/workflow/steps/execute_script.js"));
  const diagnosticLogger = createInstallDiagnosticLogger({
    logPath: diagnosticLogPath,
    homeDir: fakeHome
  });

  t.after(() => {
    process.env.HOME = originalHome;
    clearProjectModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await step.run(createStepContext(diagnosticLogger));
  const failure = readDiagnosticFailure(diagnosticLogPath);

  assert.equal(failure.npmInstallerLogExists, false);
  assert.equal(failure.npmInstallerLogReadError, "ENOENT");
  assert.equal(failure.npmInstallerLogPath, missingInstallerLogPath);
  assert.equal(failure.npmDebugLogCandidates.length, 1);
  assert.equal(failure.npmDebugLogCandidates[0].path, "~/.npm/_logs/debug.log");
  assert.match(failure.npmDebugLogCandidates[0].tail, /EACCES permission denied/);
  assert.equal(failure.npmEnvironment, undefined);
});

test("installer 和 npm debug log 都不可读时记录 node 与 npm 环境", async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-npm-env-"));
  const fakeHome = path.join(tempDir, "home");
  const missingInstallerLogPath = path.join(tempDir, "missing-installer.log");
  const diagnosticLogPath = path.join(tempDir, "openclaw-install-debug.log");
  const originalHome = process.env.HOME;
  process.env.HOME = fakeHome;

  clearProjectModules();
  mockModule("src/utils/shell/index.js", {
    resolveCommand: async () => ({
      command: "bash",
      found: true,
      resolvedPath: "/bin/bash"
    }),
    runCommand: async (command, args, options = {}) => {
      if (command === "bash") {
        const stdout = `Installer log: ${missingInstallerLogPath}\n`;
        options.onOutput({
          stream: "stdout",
          chunk: stdout,
          buffer: stdout
        });

        return {
          command,
          args,
          code: 1,
          exitCode: 1,
          stdout,
          stderr: "npm install failed",
          signal: null,
          timedOut: false,
          spawnError: null
        };
      }

      const key = [command, ...args].join(" ");
      const outputs = {
        "npm --version": "10.9.0\n",
        "node --version": "v22.0.0\n",
        "npm config get prefix": path.join(fakeHome, ".npm-global") + "\n",
        "npm config get registry": "https://registry.npmjs.org/\n"
      };

      return {
        command,
        args,
        code: 0,
        exitCode: 0,
        stdout: outputs[key],
        stderr: "",
        signal: null,
        timedOut: false,
        spawnError: null
      };
    }
  });
  const {
    createInstallDiagnosticLogger
  } = require(projectPath("src/utils/installDiagnosticLogger.js"));
  const step = require(projectPath("src/core/workflow/steps/execute_script.js"));
  const diagnosticLogger = createInstallDiagnosticLogger({
    logPath: diagnosticLogPath,
    homeDir: fakeHome
  });

  t.after(() => {
    process.env.HOME = originalHome;
    clearProjectModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await step.run(createStepContext(diagnosticLogger));
  const failure = readDiagnosticFailure(diagnosticLogPath);
  const environment = Object.fromEntries(
    failure.npmEnvironment.map((entry) => [entry.name, entry])
  );

  assert.equal(failure.npmInstallerLogExists, false);
  assert.equal(failure.npmInstallerLogReadError, "ENOENT");
  assert.deepEqual(failure.npmDebugLogCandidates, []);
  assert.equal(environment.npmVersion.stdout, "10.9.0");
  assert.equal(environment.nodeVersion.stdout, "v22.0.0");
  assert.equal(environment.npmPrefix.stdout, "~/.npm-global");
  assert.equal(environment.npmRegistry.stdout, "https://registry.npmjs.org/");
  assert.match(failure.stdoutBuffer, /Installer log:/);
  assert.equal(failure.stderrBuffer, "npm install failed");
});

function createStepContext(diagnosticLogger) {
  return {
    config: {
      installScriptTimeoutMs: 120000
    },
    tempState: {
      scriptPath: "/tmp/install.sh"
    },
    diagnosticLogger,
    logger: {
      info() {},
      warn() {}
    }
  };
}

function readDiagnosticFailure(logPath) {
  return fs.readFileSync(logPath, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .find((entry) => entry.event === "install_script_failure");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
