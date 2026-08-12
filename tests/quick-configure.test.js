const assert = require("node:assert/strict");
const test = require("node:test");

const {
  clearProjectModules,
  mockModule,
  projectPath
} = require("./helpers");

function loadInstallerService(overrides = {}) {
  clearProjectModules();

  const calls = [];
  const results = Array.isArray(overrides.results)
    ? [...overrides.results]
    : [];

  mockModule("src/gui/services/gatewayPortService.js", {
    inspectGatewayPort: async () => ({ verified: true, conflict: false }),
    readConfiguredGatewayPort: async () => 18789,
    readConfiguredGatewayPortState: async () => ({ port: 18789, configured: true }),
    readManagedGatewayServicePortState: async () => ({
      status: "available",
      port: 18789,
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
      return overrides.installed !== false;
    },
    resolveCommand: async (command) => {
      calls.push({
        type: "resolveCommand",
        command
      });
      return overrides.installed === false
        ? { found: false, resolvedPath: null }
        : { found: true, resolvedPath: "openclaw" };
    },
    runCommand: async (command, args, options) => {
      calls.push({
        type: "runCommand",
        command,
        args,
        options
      });
      return results.shift() || {
        code: 0,
        stdout: "",
        stderr: "",
        timedOut: false
      };
    },
    runDetachedCommand: async () => ({
      started: true
    })
  });

  return {
    calls,
    service: require(projectPath("src/gui/services/installerService.js"))
  };
}

test("DeepSeek 快速配置使用官方无 TTY onboarding 参数", async () => {
  const { calls, service } = loadInstallerService();
  const result = await service.runQuickConfigure({
    provider: "deepseek",
    apiKey: "test-deepseek-key"
  });
  const commandCalls = calls.filter((call) => call.type === "runCommand");

  assert.equal(result.ok, true);
  assert.equal(commandCalls.length, 1);
  assert.equal(commandCalls[0].command, "openclaw");
  assert.deepEqual(commandCalls[0].args, [
    "onboard",
    "--non-interactive",
    "--accept-risk",
    "--mode",
    "local",
    "--auth-choice",
    "deepseek-api-key",
    "--deepseek-api-key",
    "test-deepseek-key",
    "--secret-input-mode",
    "plaintext",
    "--gateway-bind",
    "loopback",
    "--gateway-port",
    "18789",
    "--install-daemon",
    "--daemon-runtime",
    "node",
    "--skip-search",
    "--skip-skills",
    "--skip-channels",
    "--skip-health",
    "--skip-ui",
    "--json"
  ]);
  assert.equal(commandCalls[0].options.allowFailure, true);
  assert.equal(Object.hasOwn(commandCalls[0].options, "timeoutMs"), false);
  assert.equal(commandCalls[0].args.includes("--skip-hooks"), false);
  assert.equal(commandCalls[0].args.includes("--default-model"), false);
});

test("快速配置不向 onboarding 传递 Electron 继承的旧 Gateway token", async () => {
  const { calls, service } = loadInstallerService();
  const result = await service.runQuickConfigure({
    provider: "deepseek",
    apiKey: "test-deepseek-key"
  }, {
    commandEnv: {
      HOME: "/safe/test-home",
      PATH: "/usr/bin",
      OPENCLAW_GATEWAY_TOKEN: "stale-gateway-token",
      OPENCLAW_GATEWAY_PORT: "19999"
    }
  });
  const commandCall = calls.find((call) => call.type === "runCommand");

  assert.equal(result.ok, true);
  assert.equal(
    Object.hasOwn(commandCall.options.env, "OPENCLAW_GATEWAY_TOKEN"),
    false
  );
  assert.equal(
    Object.hasOwn(commandCall.options.env, "OPENCLAW_GATEWAY_PORT"),
    false
  );
});

test("默认端口冲突时把自动选择端口持久传给官方 onboarding", async () => {
  const { calls, service } = loadInstallerService();
  const result = await service.runQuickConfigure({
    provider: "deepseek",
    apiKey: "test-deepseek-key"
  }, {
    selectGatewayPort: async () => ({ ok: true, port: 18790, changed: true }),
    readConfiguredGatewayPortState: async () => ({ port: 18790, configured: true }),
    readManagedGatewayServicePortState: async () => ({ status: "available", port: 18790 })
  });
  const onboard = calls.find((call) => call.type === "runCommand");
  assert.equal(result.ok, true);
  assert.deepEqual(
    onboard.args.slice(onboard.args.indexOf("--gateway-port"), onboard.args.indexOf("--gateway-port") + 2),
    ["--gateway-port", "18790"]
  );
});

test("Reset 后无旧配置的首次生产配置仍在 onboarding 前执行端口选择", async () => {
  const { calls, service } = loadInstallerService();
  let selected = 0;
  const result = await service.runQuickConfigure({
    provider: "deepseek",
    apiKey: "test-deepseek-key"
  }, {
    selectGatewayPort: async () => {
      selected += 1;
      return { ok: true, port: 18790, changed: true };
    },
    readConfiguredGatewayPortState: async () => ({ port: 18790, configured: true }),
    readManagedGatewayServicePortState: async () => ({ status: "available", port: 18790 })
  });

  const onboard = calls.find((call) => call.type === "runCommand");
  assert.equal(result.ok, true);
  assert.equal(selected, 1);
  assert.equal(onboard.args[0], "onboard");
  assert.deepEqual(
    onboard.args.slice(onboard.args.indexOf("--gateway-port"), onboard.args.indexOf("--gateway-port") + 2),
    ["--gateway-port", "18790"]
  );
});

test("候选端口全部不可用时不执行 onboarding", async () => {
  const { calls, service } = loadInstallerService();
  const result = await service.runQuickConfigure({
    provider: "deepseek",
    apiKey: "test-deepseek-key"
  }, {
    selectGatewayPort: async () => ({
      ok: false,
      port: null,
      code: "NO_AVAILABLE_GATEWAY_PORT"
    })
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "NO_AVAILABLE_GATEWAY_PORT");
  assert.equal(calls.some((call) => call.type === "runCommand"), false);
});

test("onboarding 后配置端口被覆盖时明确失败", async () => {
  const { service } = loadInstallerService();
  const result = await service.runQuickConfigure({
    provider: "deepseek",
    apiKey: "test-deepseek-key"
  }, {
    selectGatewayPort: async () => ({ ok: true, port: 18790, changed: true }),
    readConfiguredGatewayPortState: async () => ({ port: 18789, configured: true }),
    readManagedGatewayServicePortState: async () => ({ status: "available", port: 18790 })
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "GATEWAY_PORT_CONFIGURATION_MISMATCH");
});

test("onboarding 后 service 端口不一致时明确失败", async () => {
  const { service } = loadInstallerService();
  const result = await service.runQuickConfigure({
    provider: "deepseek",
    apiKey: "test-deepseek-key"
  }, {
    selectGatewayPort: async () => ({ ok: true, port: 18790, changed: true }),
    readConfiguredGatewayPortState: async () => ({ port: 18790, configured: true }),
    readManagedGatewayServicePortState: async () => ({ status: "available", port: 18789 })
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "GATEWAY_PORT_CONFIGURATION_MISMATCH");
});

for (const fixture of [
  { name: "service 端口返回 null", state: null },
  {
    name: "service 缺失",
    state: { status: "unavailable", port: null, reason: "service_unavailable" }
  },
  {
    name: "launchctl 输出无法解析",
    state: { status: "unavailable", port: null, reason: "parse_failed" }
  }
]) {
  test(`onboarding 后${fixture.name}时端口验证 fail closed`, async () => {
    const { service } = loadInstallerService();
    const result = await service.runQuickConfigure({
      provider: "deepseek",
      apiKey: "test-deepseek-key"
    }, {
      selectGatewayPort: async () => ({ ok: true, port: 18790, changed: true }),
      readConfiguredGatewayPortState: async () => ({ port: 18790, configured: true }),
      readManagedGatewayServicePortState: async () => fixture.state
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, "GATEWAY_PORT_VERIFICATION_UNAVAILABLE");
  });
}

test("生产诊断记录 onboarding、配置和 service 的最终 Gateway 端口", async () => {
  const events = [];
  const { service } = loadInstallerService();
  const result = await service.runQuickConfigure({
    provider: "deepseek",
    apiKey: "test-deepseek-key"
  }, {
    diagnosticLogger: { event(name, details) { events.push({ name, details }); } },
    selectGatewayPort: async () => ({ ok: true, port: 18790, changed: true }),
    readConfiguredGatewayPortState: async () => ({ port: 18790, configured: true }),
    readManagedGatewayServicePortState: async () => ({ status: "available", port: 18790 })
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    events.find((event) => event.name === "onboard_gateway_port").details,
    { onboardGatewayPort: 18790 }
  );
  assert.deepEqual(
    events.find((event) => event.name === "gateway_port_selection_applied").details,
    {
      selectedPort: 18790,
      afterOnboardConfiguredPort: 18790,
      serviceGatewayPort: 18790,
      serviceGatewayPortStatus: "available"
    }
  );
});

test("选择默认模型时在 onboarding 成功后调用 models set", async () => {
  const { calls, service } = loadInstallerService();
  const result = await service.runQuickConfigure({
    provider: "deepseek",
    apiKey: "test-deepseek-key",
    defaultModel: "deepseek/deepseek-v4-pro"
  });
  const commandCalls = calls.filter((call) => call.type === "runCommand");

  assert.equal(result.ok, true);
  assert.equal(commandCalls.length, 2);
  assert.equal(commandCalls[0].args[0], "onboard");
  assert.deepEqual(commandCalls[1].args, [
    "models",
    "set",
    "deepseek/deepseek-v4-pro"
  ]);
  assert.equal(commandCalls[0].args.includes("--default-model"), false);
});

test("onboarding 失败时不继续设置模型且错误不泄露 API Key", async () => {
  const apiKey = "test-deepseek-secret-key";
  const { calls, service } = loadInstallerService({
    results: [{
      code: 1,
      stdout: "",
      stderr: `unknown option --skip-hooks ${apiKey}`,
      timedOut: false
    }]
  });
  const result = await service.runQuickConfigure({
    provider: "deepseek",
    apiKey,
    defaultModel: "deepseek/deepseek-v4-pro"
  });
  const commandCalls = calls.filter((call) => call.type === "runCommand");

  assert.equal(result.ok, false);
  assert.equal(commandCalls.length, 1);
  assert.match(result.message, /快速配置失败/);
  assert.doesNotMatch(result.message, new RegExp(apiKey));
  assert.match(result.message, /\[已隐藏\]/);
});

test("快速配置错误摘要统一清理全部凭据模式", async () => {
  const apiKey = "user-api-key-fixture";
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
    [`apiKey=${apiKey}`, apiKey]
  ];
  for (const [stderr, secret] of fixtures) {
    const { service } = loadInstallerService({
      results: [{ code: 1, stdout: "", stderr, timedOut: false }]
    });
    const result = await service.runQuickConfigure({ provider: "deepseek", apiKey });

    assert.equal(result.ok, false);
    assert.doesNotMatch(result.message, new RegExp(secret));
    assert.match(result.message, /REDACTED|已隐藏/);
  }
});

test("models set 失败返回安全错误且不重复 onboarding", async () => {
  const apiKey = "test-deepseek-secret-key";
  const { calls, service } = loadInstallerService({
    results: [
      {
        code: 0,
        stdout: "{}",
        stderr: "",
        timedOut: false
      },
      {
        code: 1,
        stdout: "",
        stderr: `model selection failed for ${apiKey}`,
        timedOut: false
      }
    ]
  });
  const result = await service.runQuickConfigure({
    provider: "deepseek",
    apiKey,
    defaultModel: "deepseek/deepseek-v4-pro"
  });
  const commandCalls = calls.filter((call) => call.type === "runCommand");

  assert.equal(result.ok, false);
  assert.equal(commandCalls.length, 2);
  assert.equal(commandCalls[0].args[0], "onboard");
  assert.equal(commandCalls[1].args[0], "models");
  assert.match(result.message, /默认模型设置失败/);
  assert.doesNotMatch(result.message, new RegExp(apiKey));
});

test("未检测到 OpenClaw 时不执行配置命令", async () => {
  const { calls, service } = loadInstallerService({
    installed: false
  });
  const result = await service.runQuickConfigure({
    provider: "deepseek",
    apiKey: "test-deepseek-key"
  });

  assert.equal(result.ok, false);
  assert.match(result.message, /未检测到 OpenClaw/);
  assert.equal(calls.filter((call) => call.type === "runCommand").length, 0);
});
