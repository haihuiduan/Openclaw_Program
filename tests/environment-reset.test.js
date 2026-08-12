"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  APP_BUNDLE_ID,
  APP_NAME,
  createEnvironmentResetService
} = require("../src/core/environment-reset/resetService");

async function createFixture(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "toolbox-reset-test-"));
  const homeDir = path.join(root, "home");
  const tempDir = path.join(root, "temp");
  await fs.mkdir(homeDir, { recursive: true });
  await fs.mkdir(tempDir, { recursive: true });
  const commandCalls = [];
  const diagnosticEvents = [];
  const runCommandImpl = options.runCommand || (async (command, args) => {
    if (command === "/bin/launchctl" && args[0] === "print") {
      return {
        exitCode: 113,
        stdout: "",
        stderr: "Could not find service in domain for user",
        spawnError: null
      };
    }
    if (command === "/usr/sbin/lsof") {
      return {
        exitCode: 1,
        stdout: "",
        stderr: "",
        spawnError: null
      };
    }
    return {
      exitCode: 0,
      stdout: "",
      stderr: "",
      spawnError: null
    };
  });
  const service = createEnvironmentResetService({
    homeDir,
    tempDir,
    fs: options.fs || fs,
    baseEnv: {
      HOME: homeDir,
      PATH: ""
    },
    getUid: () => 501,
    resolveCommand: options.resolveCommand || (async () => ({
      found: false,
      resolvedPath: null
    })),
    runCommand: async (command, args, commandOptions) => {
      commandCalls.push({ command, args });
      return runCommandImpl(command, args, commandOptions);
    },
    diagnosticLogger: {
      event(name, details) {
        diagnosticEvents.push({ name, details });
      }
    },
    appPaths: [
      path.join(homeDir, "Library", "Application Support", APP_NAME),
      path.join(homeDir, "Library", "Logs", APP_NAME)
    ]
  });
  return {
    root,
    homeDir,
    tempDir,
    service,
    commandCalls,
    diagnosticEvents,
    async cleanup() {
      await fs.rm(root, { recursive: true, force: true });
    }
  };
}

async function write(root, relativePath, content = "data") {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
  return filePath;
}

async function pathExists(filePath) {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

test("完整重置只删除 allowlist 中的 OpenClaw 和 ToolBox 数据", async (t) => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);
  const home = fixture.homeDir;

  await write(home, ".openclaw/openclaw.json", '{"apiKey":"test-secret"}');
  await write(home, ".openclaw/agents/agent.json");
  await write(home, ".openclaw/workspace/file.txt");
  await write(home, ".openclaw/sessions/chat.json");
  await write(home, ".openclaw/memory/store.json");
  await write(home, ".openclaw-installer/roles/state.json");
  await write(home, ".openclaw-installer/agent-instances/state.json");
  await write(home, ".openclaw-installer/conversations/state.json");
  await write(home, ".openclaw-installer/logs/openclaw-install-debug.log");
  await write(home, ".npm-global/bin/openclaw", "managed");
  await write(home, ".npm-global/lib/node_modules/openclaw/package.json");
  const otherPackage = await write(
    home,
    ".npm-global/lib/node_modules/other-package/package.json"
  );
  const nodeBinary = await write(home, "dev-tools/bin/node");
  const appBundle = await write(
    home,
    "Applications/OpenClaw 工具箱.app/Contents/MacOS/OpenClaw 工具箱"
  );
  await write(
    home,
    "Library/LaunchAgents/ai.openclaw.gateway.plist"
  );
  await write(
    home,
    `Library/Preferences/${APP_BUNDLE_ID}.plist`
  );
  await write(
    home,
    `Library/Application Support/${APP_NAME}/Local Storage/state`
  );
  const tempState = await write(
    fixture.tempDir,
    "openclaw-installer-session/script.sh"
  );
  const unrelatedTemp = await write(fixture.tempDir, "unrelated-temp/file");

  const reset = await fixture.service.reset();

  assert.equal(reset.ok, true);
  assert.equal(reset.status, "success");
  assert.equal(await pathExists(path.join(home, ".openclaw")), false);
  assert.equal(await pathExists(path.join(home, ".openclaw-installer")), false);
  assert.equal(await pathExists(path.join(home, ".npm-global/bin/openclaw")), false);
  assert.equal(
    await pathExists(path.join(home, ".npm-global/lib/node_modules/openclaw")),
    false
  );
  assert.equal(await pathExists(path.join(home, ".npm-global")), true);
  assert.equal(await pathExists(otherPackage), true);
  assert.equal(await pathExists(nodeBinary), true);
  assert.equal(await pathExists(appBundle), true);
  assert.equal(await pathExists(tempState), false);
  assert.equal(await pathExists(unrelatedTemp), true);
  assert.deepEqual(
    fixture.commandCalls.map((call) => call.args.slice(0, 2)),
    [
      ["print", "gui/501/ai.openclaw.gateway"],
      ["gateway", "stop"],
      ["gateway", "uninstall"],
      ["bootout", "gui/501"],
      ["print", "gui/501/ai.openclaw.gateway"],
      ["-nP", "-iTCP:18789"]
    ]
  );
});

test("目录中的符号链接只随受管目录删除且不会跟随删除外部目标", async (t) => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);
  const outside = await write(fixture.root, "outside/keep.txt", "keep");
  const workspace = path.join(fixture.homeDir, ".openclaw", "workspace");
  await fs.mkdir(workspace, { recursive: true });
  await fs.symlink(outside, path.join(workspace, "outside-link"));

  const reset = await fixture.service.reset();

  assert.equal(reset.ok, true);
  assert.equal(await fs.readFile(outside, "utf8"), "keep");
});

test("受管 openclaw 符号链接被删除但外部目标保留", async (t) => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);
  const outside = await write(fixture.root, "outside/openclaw", "external");
  const managedLink = path.join(fixture.homeDir, ".npm-global", "bin", "openclaw");
  await fs.mkdir(path.dirname(managedLink), { recursive: true });
  await fs.symlink(outside, managedLink);

  const reset = await fixture.service.reset();

  assert.equal(reset.ok, false);
  assert.equal(reset.externalOpenClawDetected, true);
  assert.equal(await pathExists(managedLink), false);
  assert.equal(await fs.readFile(outside, "utf8"), "external");
});

test("检测到外部 OpenClaw 时不删除外部安装并返回部分完成", async (t) => {
  const fixture = await createFixture({
    resolveCommand: async () => ({
      found: true,
      resolvedPath: "/opt/homebrew/bin/openclaw"
    })
  });
  t.after(fixture.cleanup);
  await write(fixture.homeDir, ".openclaw/openclaw.json");

  const reset = await fixture.service.reset();

  assert.equal(reset.ok, false);
  assert.equal(reset.status, "partial");
  assert.equal(reset.externalOpenClawDetected, true);
  assert.doesNotMatch(JSON.stringify(reset), /opt\/homebrew/);
  assert.equal(await pathExists(path.join(fixture.homeDir, ".openclaw")), false);
});

test("删除权限失败会返回部分失败且不会伪装成功", async (t) => {
  let protectedPath;
  const fsApi = {
    ...fs,
    async rm(filePath, options) {
      if (filePath === protectedPath) {
        const error = new Error("permission denied");
        error.code = "EACCES";
        throw error;
      }
      return fs.rm(filePath, options);
    }
  };
  const fixture = await createFixture({ fs: fsApi });
  t.after(fixture.cleanup);
  protectedPath = path.join(fixture.homeDir, ".openclaw");
  await write(fixture.homeDir, ".openclaw/openclaw.json");

  const reset = await fixture.service.reset();

  assert.equal(reset.ok, false);
  assert.equal(reset.status, "partial");
  assert.equal(await pathExists(protectedPath), true);
  assert.match(reset.message, /未能清理/);
  assert.doesNotMatch(reset.message, new RegExp(fixture.homeDir));
});

test("服务不存在和连续重置均保持幂等", async (t) => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);

  const first = await fixture.service.reset();
  const second = await fixture.service.reset();

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(fixture.commandCalls.length, 6);
});

test("launchctl 中间命令非零但最终服务、plist 和端口均干净时视为成功", async (t) => {
  const fixture = await createFixture({
    async runCommand(command, args) {
      if (command === "/bin/launchctl" && args[0] === "bootout") {
        return {
          exitCode: 113,
          stdout: "",
          stderr: "Could not find service in domain for user",
          spawnError: null
        };
      }
      if (command === "/bin/launchctl" && args[0] === "print") {
        return {
          exitCode: 113,
          stdout: "",
          stderr: "Could not find service in domain for user",
          spawnError: null
        };
      }
      if (command === "/usr/sbin/lsof") {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "",
          spawnError: null
        };
      }
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
        spawnError: null
      };
    }
  });
  t.after(fixture.cleanup);
  await write(
    fixture.homeDir,
    "Library/LaunchAgents/ai.openclaw.gateway.plist"
  );

  const reset = await fixture.service.reset();
  const gateway = reset.categories.find((item) => item.id === "gateway");

  assert.equal(reset.ok, true);
  assert.equal(gateway.status, "completed");
  assert.equal(
    await pathExists(path.join(
      fixture.homeDir,
      "Library/LaunchAgents/ai.openclaw.gateway.plist"
    )),
    false
  );
});

test("Gateway 服务或 18789 仍残留时保持部分失败", async (t) => {
  for (const residual of ["service", "port"]) {
    const fixture = await createFixture({
      async runCommand(command, args) {
        if (command === "/bin/launchctl" && args[0] === "print") {
          return residual === "service"
            ? {
                exitCode: 0,
                stdout: "service is loaded",
                stderr: "",
                spawnError: null
              }
            : {
                exitCode: 113,
                stdout: "",
                stderr: "Could not find service in domain for user",
                spawnError: null
              };
        }
        if (command === "/usr/sbin/lsof") {
          return residual === "port"
            ? {
                exitCode: 0,
                stdout: "node TCP 127.0.0.1:18789 (LISTEN)",
                stderr: "",
                spawnError: null
              }
            : {
                exitCode: 1,
                stdout: "",
                stderr: "",
                spawnError: null
              };
        }
        return {
          exitCode: 0,
          stdout: "",
          stderr: "",
          spawnError: null
        };
      }
    });
    t.after(fixture.cleanup);

    const reset = await fixture.service.reset();
    const gateway = reset.categories.find((item) => item.id === "gateway");

    assert.equal(reset.ok, false);
    assert.equal(reset.status, "partial");
    assert.equal(gateway.status, "failed");
    assert.deepEqual(gateway.issues, ["Gateway 服务未能完全清理"]);
  }
});

test("其他用户占用当前端口时只清理本用户 Gateway 并视为幂等成功", async (t) => {
  let launchctlPrintCount = 0;
  const fixture = await createFixture({
    async runCommand(command, args) {
      if (command === "/bin/launchctl" && args[0] === "print") {
        launchctlPrintCount += 1;
        return launchctlPrintCount === 1
          ? {
              exitCode: 0,
              stdout: "pid = 36787\n",
              stderr: "",
              spawnError: null
            }
          : {
              exitCode: 113,
              stdout: "",
              stderr: "Could not find service in domain for user",
              spawnError: null
            };
      }
      if (command === "/usr/sbin/lsof") {
        return {
          exitCode: 0,
          stdout: "p84342\ncnode\nu501\nLduanhaihui\n",
          stderr: "",
          spawnError: null
        };
      }
      return {
        exitCode: 0,
        stdout: "",
        stderr: "",
        spawnError: null
      };
    }
  });
  t.after(fixture.cleanup);
  await write(
    fixture.homeDir,
    "Library/LaunchAgents/ai.openclaw.gateway.plist"
  );

  const reset = await fixture.service.reset();
  const gateway = reset.categories.find((item) => item.id === "gateway");

  assert.equal(reset.ok, true);
  assert.equal(gateway.status, "completed");
  assert.equal(
    fixture.commandCalls.some((call) => /kill|pkill/.test([call.command, ...call.args].join(" "))),
    false
  );
  const verified = fixture.diagnosticEvents.find(
    (item) => item.name === "environment_reset_gateway_verified"
  );
  assert.equal(verified.details.portAvailable, false);
  assert.equal(verified.details.managedListenerAbsent, true);
});

test("本用户受管 Gateway PID 仍监听配置端口时重置保持部分失败", async (t) => {
  let launchctlPrintCount = 0;
  const fixture = await createFixture({
    async runCommand(command, args) {
      if (command === "/bin/launchctl" && args[0] === "print") {
        launchctlPrintCount += 1;
        return launchctlPrintCount === 1
          ? { exitCode: 0, stdout: "pid = 36787\n", stderr: "", spawnError: null }
          : {
              exitCode: 113,
              stdout: "",
              stderr: "Could not find service in domain for user",
              spawnError: null
            };
      }
      if (command === "/usr/sbin/lsof") {
        return {
          exitCode: 0,
          stdout: "p36787\ncnode\nu502\nLopenclawtest2\n",
          stderr: "",
          spawnError: null
        };
      }
      return { exitCode: 0, stdout: "", stderr: "", spawnError: null };
    }
  });
  t.after(fixture.cleanup);

  const reset = await fixture.service.reset();
  const gateway = reset.categories.find((item) => item.id === "gateway");

  assert.equal(reset.ok, false);
  assert.equal(gateway.status, "failed");
});

test("重置按当前用户配置端口核对且不把其他用户 listener 当作残留", async (t) => {
  const lsofArgs = [];
  const fixture = await createFixture({
    async runCommand(command, args) {
      if (command === "/bin/launchctl") {
        return {
          exitCode: 113,
          stdout: "",
          stderr: "Could not find service in domain for user",
          spawnError: null
        };
      }
      if (command === "/usr/sbin/lsof") {
        lsofArgs.push(args);
        return {
          exitCode: 0,
          stdout: "p84342\ncnode\nu501\nLduanhaihui\n",
          stderr: "",
          spawnError: null
        };
      }
      return { exitCode: 0, stdout: "", stderr: "", spawnError: null };
    }
  });
  t.after(fixture.cleanup);
  await write(fixture.homeDir, ".openclaw/openclaw.json", JSON.stringify({
    gateway: { port: 18790 }
  }));

  const reset = await fixture.service.reset();

  assert.equal(reset.ok, true);
  assert.equal(lsofArgs.length, 1);
  assert.equal(lsofArgs[0].includes("-iTCP:18790"), true);
});

test("执行中拒绝重复重置且不会并发删除", async (t) => {
  let continueScan;
  let firstScan = true;
  const scanGate = new Promise((resolve) => {
    continueScan = resolve;
  });
  const fsApi = {
    ...fs,
    async readdir(filePath, options) {
      if (firstScan) {
        firstScan = false;
        await scanGate;
      }
      return fs.readdir(filePath, options);
    }
  };
  const fixture = await createFixture({ fs: fsApi });
  t.after(fixture.cleanup);

  const first = fixture.service.reset();
  const second = await fixture.service.reset();
  assert.equal(second.status, "busy");
  continueScan();
  assert.equal((await first).ok, true);
});

test("危险父目录和非白名单 appPath 永远不会成为删除目标", async (t) => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);
  const protectedFiles = [
    await write(fixture.homeDir, "Library/keep.txt"),
    await write(fixture.homeDir, "Desktop/keep.txt"),
    await write(fixture.homeDir, "Documents/keep.txt"),
    await write(fixture.homeDir, "Downloads/keep.txt")
  ];

  const reset = await fixture.service.reset();

  assert.equal(reset.ok, true);
  for (const filePath of protectedFiles) {
    assert.equal(await pathExists(filePath), true);
  }
});

test("诊断事件不包含路径、凭据、聊天正文或删除目标", async (t) => {
  const fixture = await createFixture();
  t.after(fixture.cleanup);
  await write(
    fixture.homeDir,
    ".openclaw/openclaw.json",
    '{"apiKey":"sk-test-secret","content":"private chat"}'
  );

  await fixture.service.reset();
  const serialized = JSON.stringify(fixture.diagnosticEvents);

  assert.match(serialized, /environment_reset_start/);
  assert.doesNotMatch(serialized, /sk-test-secret|private chat|openclaw\.json/);
  assert.doesNotMatch(serialized, new RegExp(fixture.homeDir));
});
