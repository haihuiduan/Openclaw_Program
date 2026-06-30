const assert = require("node:assert/strict");
const test = require("node:test");

const {
  clearProjectModules,
  mockModule,
  projectPath
} = require("./helpers");

function loadVerifyWithShell({ installed = true, runCommand } = {}) {
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

      if (runCommand) {
        return runCommand(command, args, options);
      }

      if (args[0] === "--version") {
        return {
          code: 0,
          stdout: "OpenClaw 1.2.3\n",
          stderr: "",
          timedOut: false
        };
      }

      return {
        code: 0,
        stdout: "/Users/test/.openclaw/config.json\n",
        stderr: "",
        timedOut: false
      };
    }
  });

  return {
    ...require(projectPath("src/core/verify/index.js")),
    calls
  };
}

test("verify --dry-run 不执行 openclaw 命令", async () => {
  const { runVerify, calls } = loadVerifyWithShell({ installed: true });

  const result = await runVerify({ dryRun: true });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(calls.commandExists.length, 0);
  assert.equal(calls.runCommand.length, 0);
});

test("未安装 OpenClaw 时 verify 返回 ok:false", async () => {
  const { runVerify, calls } = loadVerifyWithShell({ installed: false });

  const result = await runVerify({});

  assert.equal(result.ok, false);
  assert.match(result.checks[0].message, /未检测到 OpenClaw/);
  assert.deepEqual(calls.commandExists, ["openclaw"]);
  assert.equal(calls.runCommand.length, 0);
});

test("openclaw --version 成功时 verify 返回 ok:true", async () => {
  const { runVerify } = loadVerifyWithShell({ installed: true });

  const result = await runVerify({});

  assert.equal(result.ok, true);
  assert.equal(result.checks.find((check) => check.name === "OpenClaw 版本").level, "pass");
});

test("openclaw config file 失败时 verify 返回 ok:true 但包含 warning", async () => {
  const { runVerify } = loadVerifyWithShell({
    installed: true,
    runCommand: async (command, args) => {
      if (args[0] === "--version") {
        return { code: 0, stdout: "OpenClaw 1.2.3\n", stderr: "", timedOut: false };
      }

      return { code: 1, stdout: "", stderr: "not supported", timedOut: false };
    }
  });

  const result = await runVerify({});

  assert.equal(result.ok, true);
  assert.equal(result.checks.find((check) => check.name === "配置文件").level, "warning");
});

test("openclaw --version 失败时 verify 返回 ok:false", async () => {
  const { runVerify } = loadVerifyWithShell({
    installed: true,
    runCommand: async () => ({ code: 1, stdout: "", stderr: "bad", timedOut: false })
  });

  const result = await runVerify({});

  assert.equal(result.ok, false);
  assert.equal(result.checks.find((check) => check.name === "OpenClaw 版本").level, "fail");
});

test("verify 输出不包含敏感信息", async () => {
  const { runVerify } = loadVerifyWithShell({
    installed: true,
    runCommand: async (command, args) => {
      if (args[0] === "--version") {
        return { code: 0, stdout: "OpenClaw api_key=sk-secret\n", stderr: "", timedOut: false };
      }

      return { code: 0, stdout: "token=my-token\n", stderr: "", timedOut: false };
    }
  });

  const result = await runVerify({});

  assert.doesNotMatch(JSON.stringify(result), /sk-secret|my-token/);
  assert.match(JSON.stringify(result), /已隐藏/);
});

test("verify presenter 输出 dry-run 预览", () => {
  clearProjectModules();
  const { formatVerifyReport } = require(projectPath("src/cli/presenters/verifyPresenter.js"));

  const output = formatVerifyReport({ ok: true, dryRun: true, checks: [] });

  assert.match(output, /OpenClaw 验证预览/);
  assert.match(output, /dry-run 已完成/);
});
