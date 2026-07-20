const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { projectPath } = require("./helpers");
const {
  createOpenClawAdapter
} = require(projectPath("src/core/agent-instances/openClawAdapter.js"));

test("OpenClaw Adapter 使用只读 JSON 命令列出并规范化 Agent", async () => {
  const calls = [];
  const adapter = createOpenClawAdapter({
    commandRunner: async (command, args, options) => {
      calls.push({ command, args, options });
      return {
        code: 0,
        timedOut: false,
        stdout: JSON.stringify({ agents: [
          { id: "worker-b", workspace: "/tmp/work-b", agentDir: "/tmp/agent-b" },
          { id: "worker-a", workspacePath: "/tmp/work-a", agentDirectory: "/tmp/agent-a" }
        ] })
      };
    }
  });

  const agents = await adapter.listAgents();
  assert.deepEqual(calls[0].args, ["agents", "list", "--json"]);
  assert.equal(calls[0].options.timeoutMs, 15000);
  assert.deepEqual(agents.map((agent) => agent.id), ["worker-a", "worker-b"]);
  assert.equal(agents[0].workspacePath, path.resolve("/tmp/work-a"));
  assert.equal(agents[0].agentDir, path.resolve("/tmp/agent-a"));
});

test("OpenClaw Adapter 注册只调用 agents add 且参数不含凭据", async () => {
  const calls = [];
  const adapter = createOpenClawAdapter({
    commandRunner: async (command, args, options) => {
      calls.push({ command, args, options });
      return { code: 0, timedOut: false, stdout: JSON.stringify({ ok: true }) };
    }
  });

  await adapter.registerAgent({
    instanceId: "test-role-worker",
    workspacePath: "/tmp/workspace",
    agentDir: "/tmp/agent-dir"
  });
  assert.deepEqual(calls[0].args, [
    "agents", "add", "test-role-worker",
    "--workspace", "/tmp/workspace",
    "--agent-dir", "/tmp/agent-dir",
    "--non-interactive",
    "--json"
  ]);
  assert.doesNotMatch(JSON.stringify(calls), /api.?key|token|secret/i);
  assert.equal(calls.some((call) => call.args.includes("delete")), false);
  assert.equal(calls.some((call) => call.args.includes("bind")), false);
  assert.equal(calls.some((call) => call.args.includes("unbind")), false);
});

test("OpenClaw Adapter 拒绝无效 JSON、重复 id 与无效路径", async () => {
  const outputs = [
    "not-json",
    JSON.stringify([
      { id: "same", workspace: "/tmp/a", agentDir: "/tmp/b" },
      { id: "same", workspace: "/tmp/c", agentDir: "/tmp/d" }
    ]),
    JSON.stringify([{ id: "bad", workspace: "relative", agentDir: "/tmp/d" }])
  ];

  const adapter = createOpenClawAdapter({
    commandRunner: async () => ({ code: 0, timedOut: false, stdout: outputs.shift() })
  });
  await assert.rejects(() => adapter.listAgents(), /不是有效 JSON/);
  await assert.rejects(() => adapter.listAgents(), /重复 id/);
  await assert.rejects(() => adapter.listAgents(), /无效的绝对路径/);
});

test("OpenClaw Adapter 命令失败时不回显可能含敏感信息的输出", async () => {
  const adapter = createOpenClawAdapter({
    commandRunner: async () => {
      const error = new Error("spawn failed: sk-sensitive");
      error.result = { code: 7, stderr: "token=secret-value" };
      throw error;
    }
  });

  await assert.rejects(
    () => adapter.listAgents(),
    (error) => {
      assert.match(error.message, /读取 OpenClaw Agent 列表失败（退出码 7）/);
      assert.doesNotMatch(error.message, /sensitive|secret-value|token/);
      return true;
    }
  );
});
