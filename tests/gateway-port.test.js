const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { clearProjectModules, mockModule, projectPath } = require("./helpers");

function loadPortService(runCommand) {
  clearProjectModules();
  mockModule("src/utils/shell/index.js", { runCommand });
  return require(projectPath("src/gui/services/gatewayPortService.js"));
}

function result(code, stdout = "") {
  return { code, exitCode: code, stdout, stderr: "", timedOut: false, spawnError: null };
}

test("默认端口空闲时选择 18789 且不执行任何进程操作", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "gateway-port-free-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const calls = [];
  const service = loadPortService(async (command, args) => {
    calls.push([command, ...args]);
    return command === "/bin/launchctl" ? result(1) : result(1);
  });

  const selected = await service.selectGatewayPort({
    commandEnv: { HOME: home },
    getUid: () => 502,
    getUsername: () => "openclawtest2",
    probePortAvailability: async () => ({ availability: "free", errorCode: null })
  });

  assert.equal(selected.ok, true);
  assert.equal(selected.port, 18789);
  assert.equal(selected.changed, false);
  assert.equal(calls.every((call) => ["/bin/launchctl", "/usr/sbin/lsof"].includes(call[0])), true);
});

test("18789 被其他用户占用时稳定选择候选范围内第一个空闲端口", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "gateway-port-select-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const calls = [];
  const service = loadPortService(async (command, args) => {
    calls.push({ command, args });
    if (command === "/bin/launchctl") return result(0, "pid = 36787\n");
    const port = Number(args.find((arg) => arg.startsWith("-iTCP:")).slice(6));
    return port === 18789
      ? result(0, "p84342\ncnode\nu501\nLduanhaihui\n")
      : result(1);
  });
  const selected = await service.selectGatewayPort({
    commandEnv: { HOME: home, PATH: "/usr/bin" },
    getUid: () => 502,
    getUsername: () => "openclawtest2",
    probePortAvailability: async (port) => ({
      availability: port === 18789 ? "occupied" : "free",
      errorCode: port === 18789 ? "EADDRINUSE" : null
    })
  });
  assert.equal(selected.ok, true);
  assert.equal(selected.port, 18790);
  assert.equal(selected.changed, true);
  assert.equal(calls.some((call) => /kill|pkill|stop|restart/.test(call.args.join(" "))), false);
});

test("listener 与当前 LaunchAgent PID 一致时保留配置端口", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "gateway-port-own-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  await fs.mkdir(path.join(home, ".openclaw"));
  await fs.writeFile(path.join(home, ".openclaw", "openclaw.json"), JSON.stringify({
    gateway: { port: 18795 }
  }));
  const service = loadPortService(async (command) => command === "/bin/launchctl"
    ? result(0, "pid = 7001\n")
    : result(0, "p7001\ncnode\nu502\nLopenclawtest2\n"));
  const selected = await service.selectGatewayPort({
    commandEnv: { HOME: home },
    getUid: () => 502,
    getUsername: () => "openclawtest2",
    probePortAvailability: async () => ({ availability: "occupied", errorCode: "EADDRINUSE" })
  });
  assert.deepEqual({ ok: selected.ok, port: selected.port, changed: selected.changed }, {
    ok: true,
    port: 18795,
    changed: false
  });
  assert.equal(selected.ownership.listenerMatchesLaunchAgent, true);
});

test("同用户外部进程与其他用户 listener 使用不同冲突分类", async () => {
  for (const item of [
    { login: "openclawtest2", expected: "EXTERNAL_PORT_CONFLICT" },
    { login: "duanhaihui", expected: "CROSS_USER_GATEWAY_PORT_COLLISION" }
  ]) {
    const service = loadPortService(async (command) => command === "/bin/launchctl"
      ? result(0, "pid = 36787\n")
      : result(0, `p84342\ncnode\nu501\nL${item.login}\n`));
    const inspected = await service.inspectGatewayPort(18789, {
      getUid: () => 502,
      getUsername: () => "openclawtest2",
      probePortAvailability: async () => ({ availability: "occupied", errorCode: "EADDRINUSE" })
    });
    assert.equal(inspected.conflict, true);
    assert.equal(inspected.conflictKind, item.expected);
  }
});

test("候选范围全部占用时明确失败且不执行任何进程操作", async () => {
  const calls = [];
  const service = loadPortService(async (command, args) => {
    calls.push([command, ...args]);
    return command === "/bin/launchctl"
      ? result(1)
      : result(0, "p9001\ncserver\nu503\nLother\n");
  });
  const selected = await service.selectGatewayPort({
    commandEnv: { HOME: "/safe/test-home" },
    getUid: () => 502,
    getUsername: () => "openclawtest2",
    probePortAvailability: async () => ({ availability: "occupied", errorCode: "EADDRINUSE" })
  });
  assert.equal(selected.ok, false);
  assert.equal(calls.every((call) => ["/bin/launchctl", "/usr/sbin/lsof"].includes(call[0])), true);
  assert.equal(selected.code, "NO_AVAILABLE_GATEWAY_PORT");
});

test("lsof 看不到 listener 但 bind 返回 EADDRINUSE 时跳过 18789", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "gateway-port-bind-truth-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const service = loadPortService(async (command) => command === "/bin/launchctl"
    ? result(1)
    : result(1));

  const selected = await service.selectGatewayPort({
    commandEnv: { HOME: home },
    getUid: () => 502,
    getUsername: () => "openclawtest2",
    probePortAvailability: async (port) => ({
      availability: port === 18789 ? "occupied" : "free",
      errorCode: port === 18789 ? "EADDRINUSE" : null
    })
  });

  assert.equal(selected.ok, true);
  assert.equal(selected.port, 18790);
  assert.equal(selected.ownership.listenerPid, null);
  assert.equal(selected.changed, true);
});

test("bind 状态无法确认时 fail closed 且不回退到默认端口", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "gateway-port-unknown-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const service = loadPortService(async () => result(1));

  const selected = await service.selectGatewayPort({
    commandEnv: { HOME: home },
    getUid: () => 502,
    getUsername: () => "openclawtest2",
    probePortAvailability: async () => ({ availability: "unknown", errorCode: "EACCES" })
  });

  assert.equal(selected.ok, false);
  assert.equal(selected.code, "NO_AVAILABLE_GATEWAY_PORT");
});

test("原生 bind probe 将 EADDRINUSE 分类为 occupied", async () => {
  const service = loadPortService(async () => result(1));
  class FakeServer extends EventEmitter {
    unref() {}
    listen() {
      const error = new Error("address in use");
      error.code = "EADDRINUSE";
      queueMicrotask(() => this.emit("error", error));
    }
  }

  const availability = await service.probePortAvailability(18789, {
    createServer: () => new FakeServer()
  });

  assert.deepEqual(availability, {
    availability: "occupied",
    errorCode: "EADDRINUSE"
  });
});

test("端口选择诊断记录候选可用性和最终端口但不包含敏感信息", async (t) => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "gateway-port-log-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  const events = [];
  const service = loadPortService(async () => result(1));

  const selected = await service.selectGatewayPort({
    commandEnv: { HOME: home },
    getUid: () => 502,
    diagnosticLogger: { event(name, details) { events.push({ name, details }); } },
    probePortAvailability: async (port) => ({
      availability: port === 18789 ? "occupied" : "free",
      errorCode: port === 18789 ? "EADDRINUSE" : null
    })
  });

  assert.equal(selected.port, 18790);
  assert.deepEqual(events.map((event) => [event.name, event.details.candidate, event.details.availability]), [
    ["gateway_port_selection_candidate", 18789, "occupied"],
    ["gateway_port_selection_candidate", 18790, "free"],
    ["gateway_port_selection_completed", undefined, undefined]
  ]);
  assert.equal(events[2].details.selectedPort, 18790);
  assert.equal(events[0].details.ownerPid, "unknown");
  assert.doesNotMatch(JSON.stringify(events), /token|api.?key|secret/i);
});

test("LaunchAgent 端口读取区分 available、service unavailable 和 parse failed", async () => {
  const fixtures = [
    {
      result: result(0, "OPENCLAW_GATEWAY_PORT => 18790\n"),
      expected: { status: "available", port: 18790, reason: null }
    },
    {
      result: result(1, ""),
      expected: { status: "unavailable", port: null, reason: "service_unavailable" }
    },
    {
      result: result(0, "pid = 4321\n"),
      expected: { status: "unavailable", port: null, reason: "parse_failed" }
    }
  ];

  for (const fixture of fixtures) {
    const service = loadPortService(async () => fixture.result);
    const state = await service.readManagedGatewayServicePortState({
      getUid: () => 502,
      commandEnv: { HOME: "/safe/test-home" }
    });
    assert.deepEqual(state, fixture.expected);
  }
});
