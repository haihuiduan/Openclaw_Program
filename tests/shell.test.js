const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const {
  clearProjectModules,
  projectPath
} = require("./helpers");

function loadShellWithSpawn(fakeSpawn) {
  clearProjectModules();

  const childProcess = require("node:child_process");
  const originalSpawn = childProcess.spawn;
  childProcess.spawn = fakeSpawn;

  try {
    return {
      shell: require(projectPath("src/utils/shell/index.js")),
      restore() {
        childProcess.spawn = originalSpawn;
      }
    };
  } catch (error) {
    childProcess.spawn = originalSpawn;
    throw error;
  }
}

function createFakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  child.unref = () => {};
  return child;
}

test("macOS 默认 PATH 增加 Homebrew 和系统路径", () => {
  const { buildCommandPath } = require(projectPath("src/utils/shell/env.js"));
  const output = buildCommandPath("/custom/bin", "darwin").split(":");

  assert.ok(output.includes("/custom/bin"));
  assert.ok(output.includes("/opt/homebrew/bin"));
  assert.ok(output.includes("/opt/homebrew/sbin"));
  assert.ok(output.includes("/usr/local/bin"));
  assert.ok(output.includes("/usr/local/sbin"));
  assert.ok(output.includes("/usr/bin"));
  assert.ok(output.includes("/bin"));
  assert.ok(output.includes("/usr/sbin"));
  assert.ok(output.includes("/sbin"));
});

test("原有 PATH 被保留且重复路径会去重", () => {
  const { buildCommandPath } = require(projectPath("src/utils/shell/env.js"));
  const output = buildCommandPath("/usr/bin:/custom/bin:/usr/bin:/opt/homebrew/bin", "darwin").split(":");

  assert.deepEqual(output.filter((item) => item === "/usr/bin"), ["/usr/bin"]);
  assert.deepEqual(output.filter((item) => item === "/opt/homebrew/bin"), ["/opt/homebrew/bin"]);
  assert.ok(output.indexOf("/custom/bin") < output.indexOf("/opt/homebrew/bin"));
});

test("自定义 env 变量不丢失，且自定义 PATH 同样被增强", () => {
  const { getCommandEnv } = require(projectPath("src/utils/shell/env.js"));
  const env = getCommandEnv({
    PATH: "/custom/bin",
    OPENCLAW_TEST_VALUE: "kept"
  });

  assert.equal(env.OPENCLAW_TEST_VALUE, "kept");
  assert.ok(env.PATH.split(":").includes("/custom/bin"));
  assert.ok(env.PATH.split(":").includes("/opt/homebrew/bin"));
});

test("App 重启后的默认命令环境仍包含统一用户级 prefix 和 openclaw 路径", () => {
  const { getCommandEnv } = require(projectPath("src/utils/shell/env.js"));
  const env = getCommandEnv({
    HOME: "/Users/test-user",
    PATH: "/usr/bin:/bin"
  }, {
    platform: "darwin"
  });

  assert.equal(env.NPM_CONFIG_PREFIX, "/Users/test-user/.npm-global");
  assert.equal(
    env.PATH.split(":")[0],
    "/Users/test-user/.npm-global/bin"
  );
});

test("npm 原始 prefix 检测可以显式关闭工具箱 prefix 覆盖", () => {
  const { getCommandEnv } = require(projectPath("src/utils/shell/env.js"));
  const env = getCommandEnv({
    HOME: "/Users/test-user",
    PATH: "/usr/bin:/bin"
  }, {
    includeManagedNpm: false,
    platform: "darwin"
  });

  assert.equal(Object.hasOwn(env, "NPM_CONFIG_PREFIX"), false);
  assert.equal(
    env.PATH.split(":").includes("/Users/test-user/.npm-global/bin"),
    false
  );
});

test("非 macOS 环境不无条件注入 Homebrew 路径", () => {
  const { buildCommandPath } = require(projectPath("src/utils/shell/env.js"));
  const output = buildCommandPath("/usr/bin", "linux").split(":");

  assert.deepEqual(output, ["/usr/bin"]);
});

test("用户级 npm bin 会加入 PATH 首位且不会重复", () => {
  const { prependCommandPath } = require(projectPath("src/utils/shell/env.js"));
  const output = prependCommandPath(
    "/usr/bin:/Users/test-user/.npm-global/bin:/bin",
    "/Users/test-user/.npm-global/bin"
  ).split(":");

  assert.equal(output[0], "/Users/test-user/.npm-global/bin");
  assert.deepEqual(
    output.filter((item) => item === "/Users/test-user/.npm-global/bin"),
    ["/Users/test-user/.npm-global/bin"]
  );
});

test("runCommand 使用构造后的 env 且保持 shell:false", async () => {
  let captured = null;
  const { shell, restore } = loadShellWithSpawn((command, args, options) => {
    captured = { command, args, options };
    const child = createFakeChild();
    process.nextTick(() => child.emit("close", 0));
    return child;
  });

  try {
    await shell.runCommand("node", ["--version"], {
      env: {
        PATH: "/custom/bin",
        CUSTOM_VALUE: "kept"
      }
    });
  } finally {
    restore();
  }

  assert.equal(captured.command, "node");
  assert.deepEqual(captured.args, ["--version"]);
  assert.equal(captured.options.shell, false);
  assert.equal(captured.options.env.CUSTOM_VALUE, "kept");
  assert.ok(captured.options.env.PATH.split(":").includes("/custom/bin"));
  assert.ok(captured.options.env.PATH.split(":").includes("/opt/homebrew/bin"));
});

test("runCommand 只记录最终 OpenClaw 环境的存在性", async () => {
  const events = [];
  const { shell, restore } = loadShellWithSpawn(() => {
    const child = createFakeChild();
    process.nextTick(() => child.emit("close", 0));
    return child;
  });
  try {
    await shell.runCommand("openclaw", ["gateway", "status"], {
      env: {
        HOME: "/Users/test-user",
        PATH: "/usr/bin",
        OPENCLAW_GATEWAY_TOKEN: "never-log-this-token",
        OPENCLAW_CONFIG_PATH: "/tmp/config.json",
        OPENCLAW_STATE_DIR: "/tmp/state",
        OPENCLAW_PROFILE: "test"
      },
      commandEnvOptions: { homeDir: "/Users/test-user" },
      diagnosticLogger: { event: (event, details) => events.push({ event, details }) }
    });
  } finally {
    restore();
  }
  const started = events.find((entry) => entry.event === "command_start");
  assert.deepEqual(started.details.effectiveEnv, {
    OPENCLAW_GATEWAY_TOKEN_PRESENT: true,
    OPENCLAW_CONFIG_PATH_PRESENT: true,
    OPENCLAW_STATE_DIR_PRESENT: true,
    OPENCLAW_PROFILE_PRESENT: true,
    homeMatchesToolboxUser: true
  });
  assert.doesNotMatch(JSON.stringify(events), /never-log-this-token/);
});

test("commandExists 使用增强后的 env 执行 which", async () => {
  let captured = null;
  const { shell, restore } = loadShellWithSpawn((command, args, options) => {
    captured = { command, args, options };
    const child = createFakeChild();
    process.nextTick(() => child.emit("close", 0));
    return child;
  });

  try {
    const exists = await shell.commandExists("openclaw");
    assert.equal(exists, true);
  } finally {
    restore();
  }

  assert.equal(captured.command, "which");
  assert.deepEqual(captured.args, ["openclaw"]);
  assert.equal(captured.options.shell, false);
  assert.ok(captured.options.env.PATH.split(":").includes("/opt/homebrew/bin"));
});

test("runCommand 成功结果包含完整结构化诊断字段", async () => {
  const { shell, restore } = loadShellWithSpawn(() => {
    const child = createFakeChild();
    process.nextTick(() => child.emit("close", 0, null));
    return child;
  });

  try {
    const result = await shell.runCommand("test-command", ["--version"], {
      allowFailure: true
    });

    assert.equal(result.exitCode, 0);
    assert.equal(result.code, 0);
    assert.equal(result.signal, null);
    assert.equal(result.timedOut, false);
    assert.equal(result.spawnError, null);
    assert.equal(result.shell, false);
    assert.equal(typeof result.startedAt, "string");
    assert.equal(typeof result.finishedAt, "string");
    assert.equal(typeof result.durationMs, "number");
  } finally {
    restore();
  }
});

test("runCommand 在子进程关闭前同步通知完整 stdout 和 stderr buffer", async () => {
  const updates = [];
  let closed = false;
  const { shell, restore } = loadShellWithSpawn(() => {
    const child = createFakeChild();
    process.nextTick(() => {
      child.stdout.emit("data", Buffer.from("Installer "));
      child.stdout.emit("data", Buffer.from("log: /tmp/npm.log\n"));
      child.stderr.emit("data", Buffer.from("npm failed"));
      closed = true;
      child.emit("close", 1, null);
    });
    return child;
  });

  try {
    const result = await shell.runCommand("bash", ["/tmp/install.sh"], {
      allowFailure: true,
      onOutput(update) {
        assert.equal(closed, false);
        updates.push(update);
      }
    });

    assert.equal(result.stdout, "Installer log: /tmp/npm.log\n");
    assert.equal(result.stderr, "npm failed");
    assert.deepEqual(updates.map((update) => update.stream), [
      "stdout",
      "stdout",
      "stderr"
    ]);
    assert.equal(updates[1].buffer, "Installer log: /tmp/npm.log\n");
    assert.equal(updates[2].buffer, "npm failed");
  } finally {
    restore();
  }
});

test("runCommand 保留 ENOENT spawnError 和结构化 result", async () => {
  const { shell, restore } = loadShellWithSpawn(() => {
    const child = createFakeChild();
    process.nextTick(() => {
      const error = new Error("spawn test-command ENOENT");
      error.code = "ENOENT";
      child.emit("error", error);
      child.emit("close", -2, null);
    });
    return child;
  });

  try {
    const result = await shell.runCommand("test-command", [], {
      allowFailure: true
    });

    assert.equal(result.exitCode, -2);
    assert.equal(result.spawnError.code, "ENOENT");
    assert.match(result.spawnError.message, /ENOENT/);
  } finally {
    restore();
  }
});

test("runCommand 记录退出 signal", async () => {
  const { shell, restore } = loadShellWithSpawn(() => {
    const child = createFakeChild();
    process.nextTick(() => child.emit("close", null, "SIGTERM"));
    return child;
  });

  try {
    const result = await shell.runCommand("test-command", [], {
      allowFailure: true
    });
    assert.equal(result.exitCode, null);
    assert.equal(result.signal, "SIGTERM");
  } finally {
    restore();
  }
});

test("runCommand 超时后等待 close 且只完成一次", async () => {
  let killCount = 0;
  const { shell, restore } = loadShellWithSpawn(() => {
    const child = createFakeChild();
    child.kill = () => {
      killCount += 1;
      process.nextTick(() => child.emit("close", null, "SIGTERM"));
    };
    return child;
  });

  try {
    const result = await shell.runCommand("slow-command", [], {
      allowFailure: true,
      timeoutMs: 1
    });
    assert.equal(killCount, 1);
    assert.equal(result.timedOut, true);
    assert.equal(result.signal, "SIGTERM");
  } finally {
    restore();
  }
});
