const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { projectPath } = require("./helpers");
const {
  createEmptyInstanceState,
  getInstanceState,
  listInstanceStates,
  readInstanceState,
  updateInstanceState,
  writeInstanceState
} = require(projectPath("src/core/agent-instances/state.js"));

function createTempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-instance-state-"));
}

function createRecord(root, instanceId, overrides = {}) {
  const now = "2026-07-20T00:00:00.000Z";
  return {
    instanceId,
    roleId: "test-role",
    roleVersion: "1.0.0",
    roleAgentId: "worker",
    workspacePath: path.join(root, "roles", "test-role", "workspaces", "worker"),
    agentDir: path.join(root, "agent-dirs", instanceId),
    status: "registered",
    registeredAt: now,
    updatedAt: now,
    lastReconciledAt: now,
    drift: [],
    ...overrides
  };
}

test("Instance State 不存在时返回空状态并原子写入", async () => {
  const root = createTempDirectory();
  const statePath = path.join(root, "state", "instances.json");
  assert.deepEqual(await readInstanceState(statePath), createEmptyInstanceState());

  const state = createEmptyInstanceState();
  state.instances["test-role-worker"] = createRecord(root, "test-role-worker");
  await writeInstanceState(statePath, state);

  assert.deepEqual(await readInstanceState(statePath), state);
  assert.deepEqual(fs.readdirSync(path.dirname(statePath)), ["instances.json"]);
  assert.equal(fs.statSync(statePath).mode & 0o777, 0o600);
});

test("Instance State 拒绝损坏 JSON、未知 schema 与不一致状态", async () => {
  const root = createTempDirectory();
  const statePath = path.join(root, "state.json");
  fs.writeFileSync(statePath, "{", "utf8");
  await assert.rejects(() => readInstanceState(statePath), /不是有效 JSON/);

  fs.writeFileSync(statePath, JSON.stringify({ schemaVersion: 2, instances: {} }), "utf8");
  await assert.rejects(() => readInstanceState(statePath), /schemaVersion 必须为 1/);

  const invalid = createEmptyInstanceState();
  invalid.instances["test-role-worker"] = createRecord(root, "test-role-worker", {
    status: "registered",
    drift: ["workspace"]
  });
  fs.writeFileSync(statePath, JSON.stringify(invalid), "utf8");
  await assert.rejects(() => readInstanceState(statePath), /registered 状态不能包含 drift/);
});

test("Instance State 只保存白名单字段且不保存敏感信息", async () => {
  const root = createTempDirectory();
  const statePath = path.join(root, "state.json");
  const record = createRecord(root, "test-role-worker", {
    apiKey: "sk-secret",
    token: "token-secret",
    secret: "hidden"
  });
  await writeInstanceState(statePath, {
    schemaVersion: 1,
    instances: { "test-role-worker": record },
    globalConfig: "must-not-persist"
  });

  const raw = fs.readFileSync(statePath, "utf8");
  assert.doesNotMatch(raw, /sk-secret|token-secret|hidden|globalConfig|apiKey/);
  const first = await readInstanceState(statePath);
  first.instances["test-role-worker"].status = "missing";
  assert.equal(
    getInstanceState(await readInstanceState(statePath), "test-role-worker").status,
    "registered"
  );
});

test("Instance State 更新串行化且列表按 instanceId 稳定排序", async () => {
  const root = createTempDirectory();
  const statePath = path.join(root, "state.json");
  await Promise.all(["z-role-worker", "a-role-worker"].map((instanceId) => (
    updateInstanceState(statePath, async (state) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      state.instances[instanceId] = createRecord(root, instanceId, {
        roleId: instanceId.startsWith("z") ? "z-role" : "a-role",
        workspacePath: path.join(root, "workspaces", instanceId)
      });
      return state;
    })
  )));

  const state = await readInstanceState(statePath);
  assert.deepEqual(
    listInstanceStates(state).map((record) => record.instanceId),
    ["a-role-worker", "z-role-worker"]
  );
});

test("Instance State 禁止 main 与重复或未知漂移类型", async () => {
  const root = createTempDirectory();
  await assert.rejects(
    () => writeInstanceState(path.join(root, "main.json"), {
      schemaVersion: 1,
      instances: { main: createRecord(root, "main") }
    }),
    /main Agent 受保护/
  );
  await assert.rejects(
    () => writeInstanceState(path.join(root, "drift.json"), {
      schemaVersion: 1,
      instances: {
        "test-role-worker": createRecord(root, "test-role-worker", {
          status: "drifted",
          drift: ["unknown"]
        })
      }
    }),
    /未知 drift 类型/
  );
});

test("Instance State 拒绝多个 Instance 共用 Role Agent、workspace 或 agentDir", async () => {
  const root = createTempDirectory();
  const first = createRecord(root, "test-role-worker");
  const second = createRecord(root, "other-role-worker", {
    instanceId: "other-role-worker",
    roleId: "other-role",
    workspacePath: path.join(root, "roles", "other-role", "workspaces", "worker")
  });

  for (const [field, expected] of [
    ["roleAgent", /Role Agent 不能由多个/],
    ["workspacePath", /workspace 不能由多个/],
    ["agentDir", /agentDir 不能由多个/]
  ]) {
    const duplicate = { ...second };
    if (field === "roleAgent") {
      duplicate.roleId = first.roleId;
      duplicate.roleAgentId = first.roleAgentId;
    } else {
      duplicate[field] = first[field];
    }
    await assert.rejects(
      () => writeInstanceState(path.join(root, field + ".json"), {
        schemaVersion: 1,
        instances: {
          [first.instanceId]: first,
          [duplicate.instanceId]: duplicate
        }
      }),
      expected
    );
  }
});
