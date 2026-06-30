const assert = require("node:assert/strict");
const test = require("node:test");

const {
  clearProjectModules,
  mockModule,
  projectPath
} = require("./helpers");

function loadConfigureWithShell({ installed = true, commandResult } = {}) {
  clearProjectModules();

  const calls = {
    commandExists: [],
    runCommand: []
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

      if (commandResult) {
        return commandResult(command, args, options);
      }

      return {
        code: 0,
        stdout: "配置完成",
        stderr: "",
        timedOut: false
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
});

test("未安装 OpenClaw 时 configure 返回 ok:false", async () => {
  const { runConfigure, calls } = loadConfigureWithShell({ installed: false });

  const result = await runConfigure({});

  assert.equal(result.ok, false);
  assert.match(result.message, /未检测到 OpenClaw/);
  assert.equal(calls.runCommand.length, 0);
});

test("已安装 OpenClaw 时 configure 默认调用 onboard", async () => {
  const { runConfigure, calls } = loadConfigureWithShell({ installed: true });

  const result = await runConfigure({});

  assert.equal(result.ok, true);
  assert.deepEqual(calls.runCommand[1].args, ["onboard", "--install-daemon"]);
});

test("configure --onboard 调用 onboard", async () => {
  const { runConfigure, calls } = loadConfigureWithShell({ installed: true });

  await runConfigure({ onboard: true });

  assert.deepEqual(calls.runCommand[1].args, ["onboard", "--install-daemon"]);
});

test("configure --reconfigure 调用 openclaw configure", async () => {
  const { runConfigure, calls } = loadConfigureWithShell({ installed: true });

  await runConfigure({ reconfigure: true });

  assert.deepEqual(calls.runCommand[1].args, ["configure"]);
});

test("官方配置命令失败时返回中文错误摘要并隐藏敏感信息", async () => {
  const { runConfigure } = loadConfigureWithShell({
    installed: true,
    commandResult: async () => ({
      code: 1,
      stdout: "",
      stderr: "api_key=sk-secret-value\n配置失败",
      timedOut: false
    })
  });

  const result = await runConfigure({});

  assert.equal(result.ok, false);
  assert.match(result.message, /官方配置流程执行失败/);
  assert.match(result.message, /错误摘要/);
  assert.doesNotMatch(result.message, /sk-secret-value/);
  assert.ok(result.message.includes("api_key=[已隐藏]"));
});

test("成功时不完整打印 stdout", async () => {
  const { runConfigure } = loadConfigureWithShell({
    installed: true,
    commandResult: async () => ({
      code: 0,
      stdout: "api_key=sk-secret-value\n配置完成",
      stderr: "",
      timedOut: false
    })
  });

  const result = await runConfigure({});

  assert.equal(result.ok, true);
  assert.equal(result.message, "OpenClaw 官方配置流程已完成。");
  assert.doesNotMatch(result.message, /sk-secret-value/);
});
