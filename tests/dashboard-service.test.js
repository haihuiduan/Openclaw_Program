const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  clearProjectModules,
  mockModule,
  projectPath
} = require("./helpers");

function loadInstallerService(results = [], options = {}) {
  clearProjectModules();

  const calls = [];
  const queue = [...results];
  let clipboardText = Object.hasOwn(options, "initialClipboard")
    ? options.initialClipboard
    : "user clipboard text";
  const clipboardWrites = [];
  const gatewayQueue = Array.isArray(options.gatewayResults)
    ? [...options.gatewayResults]
    : null;

  mockModule("src/gui/services/gatewayPortService.js", {
    inspectGatewayPort: async () => options.gatewayPortState || ({
      port: options.gatewayPort || 18789,
      available: true,
      verified: true,
      listenerPresent: false,
      launchAgentPid: null,
      listenerPid: null,
      listenerMatchesLaunchAgent: "unknown",
      conflict: false,
      conflictKind: null
    }),
    readConfiguredGatewayPort: async () => options.gatewayPort || 18789,
    readConfiguredGatewayPortState: async () => ({
      port: options.gatewayPort || 18789,
      configured: true
    }),
    readManagedGatewayServicePortState: async () => ({
      status: "available",
      port: options.gatewayPort || 18789,
      reason: null
    }),
    selectGatewayPort: async () => ({ ok: true, port: 18789, changed: false })
  });

  mockModule("src/utils/shell/index.js", {
    commandExists: async (command) => {
      calls.push({
        type: "commandExists",
        command
      });
      return true;
    },
    resolveCommand: async (command) => {
      calls.push({
        type: "resolveCommand",
        command
      });
      return options.installed === false
        ? { found: false, resolvedPath: null }
        : {
            found: true,
            resolvedPath: options.executablePath || "openclaw"
          };
    },
    runCommand: async (command, args, commandOptions) => {
      calls.push({
        type: "runCommand",
        command,
        args,
        options: commandOptions
      });
      if (isGatewayPreparationCommand(args)) {
        if (gatewayQueue) {
          return gatewayQueue.shift() || commandResult();
        }
        if (
          args[0] === "gateway" &&
          args[1] === "status"
        ) {
          return commandResult({
            stdout: '{"ok":true,"rpc":{"ok":true}}'
          });
        }
      }
      const result = queue.shift() || {
        code: 0,
        stdout: "",
        stderr: "",
        timedOut: false,
        spawnError: null
      };
      if (args[0] === "dashboard" && args[1] === "--no-open") {
        clipboardText = Object.hasOwn(options, "dashboardClipboard")
          ? options.dashboardClipboard
          : `http://127.0.0.1:${options.gatewayPort || 18789}/#token=test-dashboard-auth`;
      }
      return result;
    }
  });

  const rawService = require(projectPath("src/gui/services/installerService.js"));
  return {
    calls,
    clipboardWrites,
    service: {
      ...rawService,
      openDashboard(input = {}) {
        return rawService.openDashboard({
          readDashboardClipboard: () => clipboardText,
          writeDashboardClipboard(value) {
            clipboardWrites.push(value);
            clipboardText = value;
          },
          ...input
        });
      }
    }
  };
}

function commandResult(overrides = {}) {
  return {
    code: 0,
    stdout: "",
    stderr: "",
    timedOut: false,
    spawnError: null,
    ...overrides
  };
}

function isGatewayPreparationCommand(args) {
  return (
    args[0] === "gateway" &&
    ["status", "start", "install"].includes(args[1])
  ) || (
    args[0] === "config" &&
    args[1] === "get" &&
    args[2] === "gateway.mode"
  ) || (
    args[0] === "config" &&
    args[1] === "set" &&
    args[2] === "gateway.mode"
  );
}

function runningGatewayStatus(overrides = {}) {
  return commandResult({
    code: overrides.rpcOk === false ? 1 : 0,
    stdout: JSON.stringify({
      service: {
        loaded: true,
        runtime: {
          status: "running",
          ...(Number.isInteger(overrides.launchAgentPid)
            ? { pid: overrides.launchAgentPid }
            : {})
        }
      },
      health: { healthy: true },
      ...(Number.isInteger(overrides.listenerPid) ? {
        port: {
          port: 18789,
          listeners: [{ pid: overrides.listenerPid }]
        }
      } : {}),
      rpc: {
        ok: overrides.rpcOk !== false,
        ...(overrides.error ? { error: overrides.error } : {})
      }
    })
  });
}

function dashboardHelpResult(supportsJson = true) {
  return {
    code: 0,
    stdout: supportsJson
      ? "Usage: openclaw dashboard [--no-open] [--json] [--yes]"
      : "Usage: openclaw dashboard [--no-open] [--yes]",
    stderr: "",
    timedOut: false,
    spawnError: null
  };
}

test("新用户缺少 gateway.mode 时只初始化 local 并等待 RPC ready", async () => {
  const missingStatus = commandResult({
    code: 1,
    stderr: "Gateway start blocked: existing config is missing gateway.mode."
  });
  const missingMode = commandResult({
    code: 1,
    stdout: JSON.stringify({
      error: "Config path not found: gateway.mode"
    })
  });
  const { calls, service } = loadInstallerService([
    dashboardHelpResult(false),
    commandResult({
      stdout: "Dashboard: http://127.0.0.1:18789/#token=safe-test-token"
    })
  ], {
    gatewayResults: [
      missingStatus,
      missingMode,
      commandResult(),
      commandResult(),
      commandResult({
        stdout: '{"ok":true,"rpc":{"ok":true}}'
      })
    ]
  });
  const diagnosticEvents = [];
  const result = await service.openDashboard({
    gatewayReadyDelayMs: 0,
    diagnosticLogger: {
      event(event, details) {
        diagnosticEvents.push({ event, details });
      }
    }
  });
  const args = calls
    .filter((call) => call.type === "runCommand")
    .map((call) => call.args);

  assert.equal(result.ok, true);
  assert.deepEqual(args, [
    ["gateway", "status", "--json", "--require-rpc"],
    ["config", "get", "gateway.mode", "--json"],
    ["config", "set", "gateway.mode", "local"],
    ["gateway", "start"],
    ["gateway", "status", "--json", "--require-rpc"],
    ["dashboard", "--help"],
    ["dashboard", "--no-open"]
  ]);
  assert.equal(
    args.some((entry) => entry[0] === "onboard"),
    false
  );
  assert.equal(
    args.some((entry) => entry.includes("agents") || entry.includes("workspace")),
    false
  );
  assert.deepEqual(
    diagnosticEvents
      .filter((entry) => (
        entry.event === "gateway_mode_initialized" ||
        entry.event === "gateway_ready"
      ))
      .map((entry) => entry.event),
    ["gateway_mode_initialized", "gateway_ready"]
  );
});

test("跨用户或外部 listener 冲突在任何 RPC 与 token repair 前终止", async () => {
  for (const conflictKind of [
    "CROSS_USER_GATEWAY_PORT_COLLISION",
    "EXTERNAL_PORT_CONFLICT"
  ]) {
    const diagnosticEvents = [];
    const { calls, service } = loadInstallerService([], {
      gatewayPortState: {
        port: 18789,
        available: false,
        verified: true,
        listenerPresent: true,
        launchAgentPid: 36787,
        listenerPid: 84342,
        listenerMatchesLaunchAgent: false,
        conflict: true,
        conflictKind
      }
    });
    const result = await service.openDashboard({
      diagnosticLogger: {
        event(event, details) { diagnosticEvents.push({ event, details }); }
      }
    });
    assert.equal(result.ok, false);
    assert.match(result.message, /端口已被其他用户或外部程序占用/);
    assert.equal(calls.some((call) => call.type === "runCommand"), false);
    const event = diagnosticEvents.find((entry) => entry.event === "gateway_port_conflict");
    assert.equal(event.details.rootCause, conflictKind);
    assert.equal(event.details.secondarySymptom, "token_mismatch");
  }
});

test("listener 属于当前 managed Gateway 时才继续 RPC readiness", async () => {
  const diagnosticEvents = [];
  const { calls, service } = loadInstallerService([
    dashboardHelpResult(false),
    commandResult({ stdout: "Dashboard: http://127.0.0.1:18790/" })
  ], {
    gatewayPort: 18790,
    gatewayPortState: {
      port: 18790,
      available: false,
      verified: true,
      listenerPresent: true,
      launchAgentPid: 5001,
      listenerPid: 5001,
      listenerMatchesLaunchAgent: true,
      conflict: false,
      conflictKind: null
    },
    gatewayResults: [runningGatewayStatus()]
  });
  const result = await service.openDashboard({
    diagnosticLogger: {
      event(event, details) { diagnosticEvents.push({ event, details }); }
    }
  });
  assert.equal(result.ok, true, JSON.stringify(diagnosticEvents));
  assert.deepEqual(calls.filter((call) => call.type === "runCommand").map((call) => call.args), [
    ["gateway", "status", "--json", "--require-rpc"],
    ["dashboard", "--help"],
    ["dashboard", "--no-open"]
  ]);
});

test("已有 local gateway.mode 时不重复初始化，仅启动并等待 ready", async () => {
  const { calls, service } = loadInstallerService([
    dashboardHelpResult(false),
    commandResult({
      stdout: "Dashboard: http://127.0.0.1:18789/"
    })
  ], {
    gatewayResults: [
      commandResult({
        code: 1,
        stderr: "Gateway service is stopped."
      }),
      commandResult({
        stdout: '"local"'
      }),
      commandResult(),
      commandResult({
        stdout: '{"ok":true,"rpc":{"ok":true}}'
      })
    ]
  });
  const result = await service.openDashboard({
    gatewayReadyDelayMs: 0
  });
  const args = calls
    .filter((call) => call.type === "runCommand")
    .map((call) => call.args);

  assert.equal(result.ok, true);
  assert.deepEqual(args, [
    ["gateway", "status", "--json", "--require-rpc"],
    ["config", "get", "gateway.mode", "--json"],
    ["gateway", "start"],
    ["gateway", "status", "--json", "--require-rpc"],
    ["dashboard", "--help"],
    ["dashboard", "--no-open"]
  ]);
  assert.equal(
    args.some((entry) => entry[0] === "config" && entry[1] === "set"),
    false
  );
});

test("Gateway 已运行时不读取或改写 mode，也不重复等待", async () => {
  const { calls, service } = loadInstallerService([
    dashboardHelpResult(false),
    commandResult({
      stdout: "Dashboard: http://127.0.0.1:18789/"
    })
  ], {
    gatewayResults: [
      commandResult({
        stdout: '{"ok":true,"rpc":{"ok":true}}'
      })
    ]
  });
  const result = await service.openDashboard();
  const args = calls
    .filter((call) => call.type === "runCommand")
    .map((call) => call.args);

  assert.equal(result.ok, true);
  assert.deepEqual(args, [
    ["gateway", "status", "--json", "--require-rpc"],
    ["dashboard", "--help"],
    ["dashboard", "--no-open"]
  ]);
  assert.equal(
    args.some((entry) => entry[0] === "config"),
    false
  );
});

test("当前 managed Gateway 返回 token mismatch 时明确失败且不自动修复", async () => {
  const mismatch = runningGatewayStatus({
    rpcOk: false,
    error: "gateway closed (1008): unauthorized: gateway token mismatch"
  });
  const diagnosticEvents = [];
  const { calls, service } = loadInstallerService([], {
    gatewayPortState: {
      port: 18789,
      available: false,
      verified: true,
      listenerPresent: true,
      launchAgentPid: 5001,
      listenerPid: 5001,
      listenerMatchesLaunchAgent: true,
      conflict: false,
      conflictKind: null
    },
    gatewayResults: [mismatch]
  });

  const result = await service.openDashboard({
    commandEnv: {
      HOME: "/safe-home",
      PATH: "/usr/bin",
      OPENCLAW_GATEWAY_TOKEN: "ambient-token-value"
    },
    diagnosticLogger: {
      event(event, details) {
        diagnosticEvents.push({ event, details });
      }
    }
  });
  const commandCalls = calls.filter((call) => call.type === "runCommand");
  const args = commandCalls.map((call) => call.args);

  assert.equal(result.ok, false);
  assert.match(result.message, /RPC 认证失败/);
  assert.deepEqual(args, [["gateway", "status", "--json", "--require-rpc"]]);
  assert.equal(
    commandCalls.every((call) => !Object.hasOwn(
      call.options.env,
      "OPENCLAW_GATEWAY_TOKEN"
    )),
    true
  );
  const failure = diagnosticEvents.find(
    (entry) => entry.event === "gateway_rpc_auth_failed"
  );
  assert.equal(failure.details.gatewayRpcFailureKind, "token_mismatch");
  assert.equal(failure.details.automaticRepairAttempted, false);
  assert.doesNotMatch(
    JSON.stringify(diagnosticEvents),
    /ambient-token-value/
  );
});

test("Gateway 进程已运行但 RPC 未就绪时等待而不重复 start", async () => {
  const runningNotReady = runningGatewayStatus({
    rpcOk: false,
    error: "connection refused while RPC is starting"
  });
  const { calls, service } = loadInstallerService([], {
    gatewayResults: [runningNotReady, runningNotReady]
  });

  const result = await service.openDashboard({
    gatewayReadyMaxAttempts: 1,
    gatewayReadyDelayMs: 0
  });
  const args = calls
    .filter((call) => call.type === "runCommand")
    .map((call) => call.args);

  assert.equal(result.ok, false);
  assert.match(result.message, /RPC 未就绪/);
  assert.equal(
    args.some((entry) => entry[0] === "gateway" && entry[1] === "start"),
    false
  );
  assert.equal(args.some((entry) => entry[0] === "config"), false);
});

test("远程 Gateway 配置不会被工具箱覆盖为 local", async () => {
  const { calls, service } = loadInstallerService([], {
    gatewayResults: [
      commandResult({
        code: 1,
        stderr: "Remote Gateway is unavailable."
      }),
      commandResult({
        stdout: '"remote"'
      })
    ]
  });
  const result = await service.openDashboard();
  const args = calls
    .filter((call) => call.type === "runCommand")
    .map((call) => call.args);

  assert.equal(result.ok, false);
  assert.match(result.message, /远程 Gateway/);
  assert.deepEqual(args, [
    ["gateway", "status", "--json", "--require-rpc"],
    ["config", "get", "gateway.mode", "--json"]
  ]);
  assert.equal(
    args.some((entry) => entry[0] === "config" && entry[1] === "set"),
    false
  );
});

test("Gateway 启动命令成功但 RPC 未 ready 时不返回 Dashboard URL", async () => {
  const notReady = commandResult({
    code: 1,
    stderr: "Gateway RPC is not ready."
  });
  const { calls, service } = loadInstallerService([
    dashboardHelpResult(false),
    commandResult({
      stdout: "Dashboard: http://127.0.0.1:18789/#token=not-opened"
    })
  ], {
    gatewayResults: [
      notReady,
      commandResult({
        stdout: '"local"'
      }),
      commandResult(),
      notReady,
      notReady
    ]
  });
  const result = await service.openDashboard({
    gatewayReadyDelayMs: 0,
    gatewayReadyMaxAttempts: 2
  });
  const args = calls
    .filter((call) => call.type === "runCommand")
    .map((call) => call.args);

  assert.equal(result.ok, false);
  assert.match(result.message, /RPC 未就绪/);
  assert.equal(Object.hasOwn(result, "dashboardUrl"), false);
  assert.equal(
    args.filter((entry) => (
      entry[0] === "gateway" &&
      entry[1] === "status"
    )).length,
    3
  );
  assert.equal(
    args.some((entry) => entry[0] === "dashboard" && entry[1] === "--json"),
    false
  );
});

test("stdout 基础地址与 clipboard 认证地址并存时只返回 clipboard 地址", async () => {
  const { calls, service } = loadInstallerService([
    dashboardHelpResult(),
    commandResult({ stdout: "Dashboard URL: http://127.0.0.1:18789/" })
  ], {
    dashboardClipboard: "http://127.0.0.1:18789/?token=test-dashboard-token"
  });
  const diagnosticEvents = [];
  const result = await service.openDashboard({
    diagnosticLogger: {
      event(event, details) {
        diagnosticEvents.push({ event, details });
      }
    }
  });
  const commandCalls = calls.filter((call) => call.type === "runCommand");

  assert.equal(result.ok, true);
  assert.equal(
    result.dashboardUrl,
    "http://127.0.0.1:18789/?token=test-dashboard-token"
  );
  const diagnostic = diagnosticEvents.find(
    (entry) => entry.event === "dashboard_connection_resolved"
  );
  assert.equal(diagnostic.details.dashboardUrlResolved, true);
  assert.equal(diagnostic.details.queryPresent, true);
  assert.equal(diagnostic.details.hashPresent, false);
  assert.equal(diagnostic.details.tokenPresent, true);
  assert.equal(diagnostic.details.resolverMode, "clipboard_authenticated_url");
  assert.equal(diagnostic.details.clipboardChanged, true);
  assert.equal(diagnostic.details.clipboardRestored, true);
  assert.equal(Object.hasOwn(diagnostic.details, "connectionOk"), false);
  assert.equal(Object.hasOwn(diagnostic.details, "tokenIncluded"), false);
  assert.deepEqual(commandCalls.map((call) => call.args), [
    ["gateway", "status", "--json", "--require-rpc"],
    ["dashboard", "--help"],
    ["dashboard", "--no-open"]
  ]);
  assert.deepEqual(
    diagnosticEvents.map((entry) => entry.event),
    [
      "gateway_port_ownership_checked",
      "gateway_readiness_checked",
      "dashboard_capability_detected",
      "dashboard_connection_resolved"
    ]
  );
  assert.doesNotMatch(
    JSON.stringify(diagnosticEvents),
    /test-dashboard-token|\?token=/
  );
});

test("Gateway 认证快照读取磁盘配置且不推断 RPC 或 runtime token 相等", async (t) => {
  const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "gateway-auth-snapshot-"));
  t.after(() => fs.rm(homeDir, { recursive: true, force: true }));
  await fs.mkdir(path.join(homeDir, ".openclaw"), { recursive: true });
  await fs.writeFile(
    path.join(homeDir, ".openclaw", "openclaw.json"),
    JSON.stringify({
      gateway: {
        mode: "local",
        auth: { mode: "token", token: "snapshot-secret" }
      }
    }),
    { mode: 0o600 }
  );
  const { service } = loadInstallerService([
    commandResult({ stdout: "OpenClaw test" }),
    commandResult({ stdout: "OpenClaw test" }),
    dashboardHelpResult(false),
    commandResult({ stdout: "Dashboard: http://127.0.0.1:18789/" })
  ]);
  const snapshots = [];
  const result = await service.openDashboard({
    commandEnv: {
      HOME: homeDir,
      PATH: "/usr/bin"
    },
    diagnosticLogger: {
      event() {},
      recordGatewaySnapshot(stage, details) {
        snapshots.push({ stage, details });
      },
      fingerprintSecret(value) {
        return value ? "configfp" : null;
      },
      getDiagnosticRunStartedAt() {
        return null;
      }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(snapshots.length, 2);
  for (const snapshot of snapshots) {
    assert.equal(snapshot.details.configTokenFingerprint, "configfp");
    assert.equal(snapshot.details.gatewayRuntimeTokenFingerprint, "unknown");
    assert.equal(snapshot.details.rpcProbeResolvedTokenFingerprint, "unknown");
    assert.equal(snapshot.details.configVsRpcProbeEqual, "unknown");
    assert.equal(snapshot.details.runtimeVsCliTokenEqual, "unknown");
  }
  assert.doesNotMatch(JSON.stringify(snapshots), /snapshot-secret/);
});

test("Dashboard 使用解析到的 OpenClaw executable", async () => {
  const executablePath = "/managed/npm/bin/openclaw";
  const { calls, service } = loadInstallerService([
    dashboardHelpResult(false),
    {
      code: 0,
      stdout: "Dashboard: http://127.0.0.1:18789/",
      stderr: "",
      timedOut: false,
      spawnError: null
    }
  ], { executablePath });
  const result = await service.openDashboard();
  const commandCalls = calls.filter((call) => call.type === "runCommand");

  assert.equal(result.ok, true);
  assert.equal(commandCalls.length, 3);
  assert.equal(
    commandCalls.every((call) => call.command === executablePath),
    true
  );
});

test("打开控制台拒绝非 loopback、非 HTTP 和无效 dashboard 结果", async () => {
  for (const output of [
    '{"ok":true,"url":"https://example.com/control"}',
    '{"ok":true,"url":"file:///private/tmp/control.html"}',
    '{"ok":false,"reason":"gateway unavailable"}',
    "not-json"
  ]) {
    const { service } = loadInstallerService([
      dashboardHelpResult(),
      {
        code: 0,
        stdout: "{}",
        stderr: "",
        timedOut: false,
        spawnError: null
      },
      {
        code: 0,
        stdout: output,
        stderr: "",
        timedOut: false,
        spawnError: null
      }
    ]);
    const result = await service.openDashboard();

    assert.equal(result.ok, false);
    assert.equal(Object.hasOwn(result, "dashboardUrl"), false);
  }
});

test("Gateway 启动失败时不再读取或打开 dashboard", async () => {
  const { calls, service } = loadInstallerService([], {
    gatewayResults: [
      commandResult({ code: 1, stderr: "Gateway RPC is not ready." }),
      commandResult({ stdout: '"local"' }),
      commandResult({ code: 1, stderr: "internal failure" })
    ]
  });
  const result = await service.openDashboard();

  assert.equal(result.ok, false);
  assert.match(result.message, /Gateway 启动失败/);
  assert.equal(calls.filter((call) => call.type === "runCommand").length, 3);
});

test("dashboard --no-open 失败时记录安全 stderr 摘要", async () => {
  const { service } = loadInstallerService([
    dashboardHelpResult(),
    {
      code: 1,
      stdout: "Dashboard URL unavailable",
      stderr: "Gateway is not ready for dashboard connections.",
      timedOut: false,
      spawnError: null
    }
  ]);
  const diagnosticEvents = [];
  const result = await service.openDashboard({
    diagnosticLogger: {
      event(event, details) {
        diagnosticEvents.push({ event, details });
      }
    }
  });
  const diagnostic = diagnosticEvents.find(
    (entry) => entry.event === "dashboard_connection_resolved"
  );

  assert.equal(result.ok, false);
  assert.equal(diagnostic.details.exitCode, 1);
  assert.equal(diagnostic.details.timedOut, false);
  assert.equal(diagnostic.details.spawnFailed, false);
  assert.equal(diagnostic.details.stdoutPresent, true);
  assert.equal(diagnostic.details.stdoutBaseUrlValid, false);
  assert.equal(diagnostic.details.stderrPresent, true);
  assert.equal(
    diagnostic.details.stderrSummary,
    "Gateway is not ready for dashboard connections."
  );
});

test("dashboard stderr 摘要隐藏凭据、Session Key、完整 URL 和用户路径", async () => {
  const userPath = os.homedir() + "/Library/Application Support/private.json";
  const stderr = [
    "apiKey=sk-test-dashboard-secret",
    "token=test-dashboard-token",
    "sessionKey=private-dashboard-session",
    "url=https://127.0.0.1:18789/?token=test-url-token",
    `path=${userPath}`
  ].join("\n");
  const { service } = loadInstallerService([
    dashboardHelpResult(),
    {
      code: 1,
      stdout: "",
      stderr,
      timedOut: false,
      spawnError: null
    }
  ]);
  const diagnosticEvents = [];
  await service.openDashboard({
    diagnosticLogger: {
      event(event, details) {
        diagnosticEvents.push({ event, details });
      }
    }
  });
  const serialized = JSON.stringify(
    diagnosticEvents.find(
      (entry) => entry.event === "dashboard_connection_resolved"
    )
  );

  assert.doesNotMatch(serialized, /sk-test-dashboard-secret/);
  assert.doesNotMatch(serialized, /test-dashboard-token/);
  assert.doesNotMatch(serialized, /private-dashboard-session/);
  assert.doesNotMatch(serialized, /test-url-token/);
  assert.doesNotMatch(serialized, /https:\/\/127\.0\.0\.1/);
  assert.doesNotMatch(serialized, new RegExp(escapeRegExp(os.homedir())));
  assert.match(serialized, /\[REDACTED/);
});

test("dashboard stderr 摘要按固定上限截断", async () => {
  const { service } = loadInstallerService([
    dashboardHelpResult(),
    {
      code: 1,
      stdout: "",
      stderr: "dashboard-error-" + "x".repeat(5000),
      timedOut: false,
      spawnError: null
    }
  ]);
  const diagnosticEvents = [];
  await service.openDashboard({
    diagnosticLogger: {
      event(event, details) {
        diagnosticEvents.push({ event, details });
      }
    }
  });
  const diagnostic = diagnosticEvents.find(
    (entry) => entry.event === "dashboard_connection_resolved"
  );

  assert.ok(diagnostic.details.stderrSummary.length < 900);
  assert.match(diagnostic.details.stderrSummary, /…\[TRUNCATED\]$/);
});

test("dashboard --no-open 的 stdout 只用于校验且认证地址来自 clipboard", async () => {
  const { calls, service } = loadInstallerService([
    dashboardHelpResult(false),
    {
      code: 0,
      stdout: [
        "Gateway is running.",
        "Dashboard: http://127.0.0.1:18789/"
      ].join("\n"),
      stderr: "",
      timedOut: false,
      spawnError: null
    }
  ], {
    dashboardClipboard: "http://127.0.0.1:18789/#token=legacy-dashboard-token"
  });
  const diagnosticEvents = [];
  const result = await service.openDashboard({
    diagnosticLogger: {
      event(event, details) {
        diagnosticEvents.push({ event, details });
      }
    }
  });
  const commandCalls = calls.filter((call) => call.type === "runCommand");
  const diagnostic = diagnosticEvents.find(
    (entry) => entry.event === "dashboard_connection_resolved"
  );

  assert.equal(result.ok, true);
  assert.equal(
    result.dashboardUrl,
    "http://127.0.0.1:18789/#token=legacy-dashboard-token"
  );
  assert.deepEqual(commandCalls.map((call) => call.args), [
    ["gateway", "status", "--json", "--require-rpc"],
    ["dashboard", "--help"],
    ["dashboard", "--no-open"]
  ]);
  assert.equal(diagnostic.details.resolverMode, "clipboard_authenticated_url");
  assert.equal(diagnostic.details.supportsJson, false);
  assert.equal(diagnostic.details.hostname, "127.0.0.1");
  assert.equal(diagnostic.details.port, "18789");
  assert.equal(diagnostic.details.dashboardUrlResolved, true);
  assert.equal(diagnostic.details.queryPresent, false);
  assert.equal(diagnostic.details.hashPresent, true);
  assert.equal(diagnostic.details.tokenPresent, true);
  assert.doesNotMatch(
    JSON.stringify(diagnosticEvents),
    /legacy-dashboard-token/
  );
});

for (const fixture of [
  {
    name: "clipboard host 非 loopback",
    clipboard: "https://example.com:18789/#token=secret",
    failureKind: "clipboard_url_invalid"
  },
  {
    name: "clipboard port 与 Gateway 配置不一致",
    clipboard: "http://127.0.0.1:18790/#token=secret",
    failureKind: "clipboard_port_mismatch"
  },
  {
    name: "clipboard URL 不含认证信息",
    clipboard: "http://127.0.0.1:18789/",
    failureKind: "clipboard_auth_missing"
  }
]) {
  test(`${fixture.name} 时拒绝打开 stdout 基础地址`, async () => {
    const events = [];
    const { service } = loadInstallerService([
      dashboardHelpResult(false),
      commandResult({ stdout: "Dashboard URL: http://127.0.0.1:18789/" })
    ], { dashboardClipboard: fixture.clipboard });
    const result = await service.openDashboard({
      diagnosticLogger: {
        event(event, details) { events.push({ event, details }); }
      }
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, "DASHBOARD_AUTH_URL_UNAVAILABLE");
    assert.equal(Object.hasOwn(result, "dashboardUrl"), false);
    const diagnostic = events.find((entry) => entry.event === "dashboard_connection_resolved");
    assert.equal(diagnostic.details.failureKind, fixture.failureKind);
    assert.doesNotMatch(JSON.stringify(events), /token=secret/);
  });
}

test("clipboard 读取失败时不打开 stdout 基础地址", async () => {
  const { calls, service } = loadInstallerService([
    dashboardHelpResult(false)
  ]);
  const result = await service.openDashboard({
    readDashboardClipboard() {
      throw new Error("clipboard unavailable");
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "DASHBOARD_AUTH_URL_UNAVAILABLE");
  assert.equal(Object.hasOwn(result, "dashboardUrl"), false);
  assert.equal(
    calls.some((call) => call.args && call.args[0] === "dashboard" && call.args[1] === "--no-open"),
    false
  );
});

test("dashboard 完成后恢复用户原 clipboard 且保留自定义 18790 端口", async () => {
  const { clipboardWrites, service } = loadInstallerService([
    dashboardHelpResult(false),
    commandResult({ stdout: "Dashboard URL: http://127.0.0.1:18790/" })
  ], {
    gatewayPort: 18790,
    initialClipboard: "original clipboard",
    dashboardClipboard: "http://localhost:18790/#token=custom-port-secret"
  });
  const result = await service.openDashboard();

  assert.equal(result.ok, true);
  assert.equal(result.dashboardUrl, "http://localhost:18790/#token=custom-port-secret");
  assert.equal(clipboardWrites.at(-1), "original clipboard");
});

test("旧版 dashboard --no-open 没有 URL 时明确失败", async () => {
  const { calls, service } = loadInstallerService([
    dashboardHelpResult(false),
    {
      code: 0,
      stdout: "Gateway started.",
      stderr: "",
      timedOut: false,
      spawnError: null
    }
  ]);
  const result = await service.openDashboard();

  assert.equal(result.ok, false);
  assert.equal(Object.hasOwn(result, "dashboardUrl"), false);
  assert.deepEqual(
    calls
      .filter((call) => call.type === "runCommand")
      .map((call) => call.args),
    [
      ["gateway", "status", "--json", "--require-rpc"],
      ["dashboard", "--help"],
      ["dashboard", "--no-open"]
    ]
  );
});

test("Gateway service 未安装时先安装再显式启动", async () => {
  const { calls, service } = loadInstallerService([
    dashboardHelpResult(false),
    commandResult({ stdout: "Dashboard: http://127.0.0.1:18789/" })
  ], {
    gatewayResults: [
      commandResult({ code: 1, stderr: "Gateway RPC is not ready." }),
      commandResult({ stdout: '"local"' }),
      commandResult({
        code: 1,
        stderr: "Gateway service is not installed. Run openclaw gateway install."
      }),
      commandResult(),
      commandResult(),
      commandResult({ stdout: '{"ok":true,"rpc":{"ok":true}}' })
    ]
  });

  const result = await service.openDashboard({ gatewayReadyDelayMs: 0 });
  const args = calls
    .filter((call) => call.type === "runCommand")
    .map((call) => call.args);

  assert.equal(result.ok, true);
  assert.deepEqual(args.slice(2, 6), [
    ["gateway", "start"],
    ["gateway", "install"],
    ["gateway", "start"],
    ["gateway", "status", "--json", "--require-rpc"]
  ]);
});

test("Gateway 启动诊断安全记录命令结果且所有步骤复用同一环境", async () => {
  const commandEnv = {
    HOME: "/safe/test-home",
    PATH: "/safe/test-home/.npm-global/bin:/usr/bin"
  };
  const commandEnvOptions = {
    homeDir: "/safe/test-home"
  };
  const diagnosticEvents = [];
  const { calls, service } = loadInstallerService([
    dashboardHelpResult(false),
    commandResult({ stdout: "Dashboard: http://127.0.0.1:18789/" })
  ], {
    gatewayResults: [
      commandResult({ code: 1, stderr: "Gateway RPC is not ready." }),
      commandResult({ stdout: '"local"' }),
      commandResult({
        durationMs: 42,
        stdout: "service started",
        stderr: [
          "token=secret-dashboard-token",
          "path=/Users/private-user/.openclaw/openclaw.json"
        ].join("\n")
      }),
      commandResult({ stdout: '{"ok":true,"rpc":{"ok":true}}' })
    ]
  });

  const result = await service.openDashboard({
    commandEnv,
    commandEnvOptions,
    gatewayReadyDelayMs: 0,
    diagnosticLogger: {
      event(event, details) {
        diagnosticEvents.push({ event, details });
      }
    }
  });
  const commandCalls = calls.filter((call) => call.type === "runCommand");
  const startEvent = diagnosticEvents.find(
    (entry) => entry.event === "dashboard_gateway_start"
  );

  assert.equal(result.ok, true);
  assert.equal(
    commandCalls.every((call) => (
      call.options.env.HOME === commandEnv.HOME &&
      call.options.env.PATH === commandEnv.PATH &&
      !Object.hasOwn(call.options.env, "OPENCLAW_GATEWAY_TOKEN") &&
      call.options.commandEnvOptions === commandEnvOptions
    )),
    true
  );
  assert.deepEqual(startEvent.details.args, ["gateway", "start"]);
  assert.equal(startEvent.details.durationMs, 42);
  assert.equal(startEvent.details.stdoutPresent, true);
  assert.equal(startEvent.details.stderrPresent, true);
  assert.doesNotMatch(
    JSON.stringify(startEvent),
    /secret-dashboard-token|private-user/
  );
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
