const assert = require("node:assert/strict");
const test = require("node:test");

const {
  clearProjectModules,
  mockModule,
  projectPath
} = require("./helpers");

function loadConfigureWithShell({ installed = true, interactiveResult } = {}) {
  clearProjectModules();

  const calls = {
    commandExists: [],
    runCommand: [],
    runInteractiveCommand: []
  };

  mockModule("src/utils/shell/index.js", {
    commandExists: async (command) => {
      calls.commandExists.push(command);
      return installed;
    },
    runCommand: async (command, args = [], options = {}) => {
      calls.runCommand.push({ command, args, options });

      if (command === "openclaw" && args[0] === "--version") {
        return {
          code: 0,
          stdout: "OpenClaw 1.2.3\n",
          stderr: "",
          timedOut: false
        };
      }

      return {
        code: 0,
        stdout: "",
        stderr: "",
        timedOut: false
      };
    },
    runInteractiveCommand: async (command, args = [], options = {}) => {
      calls.runInteractiveCommand.push({ command, args, options });

      if (interactiveResult) {
        return interactiveResult(command, args, options);
      }

      return {
        command,
        args,
        code: 0,
        signal: null
      };
    }
  });

  return {
    ...require(projectPath("src/core/configure/index.js")),
    calls
  };
}

test("configure --dry-run 不执行官方命令，只返回预览", async () => {
  const { runConfigure, calls } = loadConfigureWithShell({ installed: true });

  const result = await runConfigure({ dryRun: true });

  assert.equal(result.ok, true);
  assert.match(result.message, /将启动 OpenClaw 官方配置向导/);
  assert.deepEqual(calls.runCommand.map((call) => call.args), [["--version"]]);
  assert.equal(calls.runInteractiveCommand.length, 0);
});

test("未安装 OpenClaw 时 configure 返回 ok:false", async () => {
  const { runConfigure, calls } = loadConfigureWithShell({ installed: false });

  const result = await runConfigure({});

  assert.equal(result.ok, false);
  assert.match(result.message, /未检测到 OpenClaw/);
  assert.equal(calls.runCommand.length, 0);
  assert.equal(calls.runInteractiveCommand.length, 0);
});

test("configure 正式模式调用 runInteractiveCommand", async () => {
  const { runConfigure, calls } = loadConfigureWithShell({ installed: true });

  await runConfigure({});

  assert.equal(calls.runInteractiveCommand.length, 1);
  assert.equal(calls.runInteractiveCommand[0].command, "openclaw");
});

test("configure 默认调用 openclaw onboard --install-daemon", async () => {
  const { runConfigure, calls } = loadConfigureWithShell({ installed: true });

  const result = await runConfigure({});

  assert.equal(result.ok, true);
  assert.equal(result.message, "OpenClaw 官方配置流程已结束。");
  assert.deepEqual(calls.runInteractiveCommand[0].args, ["onboard", "--install-daemon"]);
});

test("configure --onboard 调用 openclaw onboard --install-daemon", async () => {
  const { runConfigure, calls } = loadConfigureWithShell({ installed: true });

  await runConfigure({ onboard: true });

  assert.deepEqual(calls.runInteractiveCommand[0].args, ["onboard", "--install-daemon"]);
});

test("configure --reconfigure 调用 openclaw configure", async () => {
  const { runConfigure, calls } = loadConfigureWithShell({ installed: true });

  await runConfigure({ reconfigure: true });

  assert.deepEqual(calls.runInteractiveCommand[0].args, ["configure"]);
});

test("runInteractiveCommand 返回非 0 时 configure 返回 ok:false", async () => {
  const { runConfigure } = loadConfigureWithShell({
    installed: true,
    interactiveResult: async (command, args) => ({
      command,
      args,
      code: 130,
      signal: null
    })
  });

  const result = await runConfigure({});

  assert.equal(result.ok, false);
  assert.equal(result.message, "OpenClaw 官方配置流程未完成。");
});

test("configure 输出不包含官方流程中的敏感内容", async () => {
  const { runConfigure } = loadConfigureWithShell({
    installed: true,
    interactiveResult: async (command, args) => ({
      command,
      args,
      code: 0,
      signal: null,
      stdout: "api_key=sk-secret-value"
    })
  });

  const result = await runConfigure({});

  assert.equal(result.ok, true);
  assert.doesNotMatch(result.message, /sk-secret-value/);
});
