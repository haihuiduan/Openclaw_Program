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

test("非 macOS 环境不无条件注入 Homebrew 路径", () => {
  const { buildCommandPath } = require(projectPath("src/utils/shell/env.js"));
  const output = buildCommandPath("/usr/bin", "linux").split(":");

  assert.deepEqual(output, ["/usr/bin"]);
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
