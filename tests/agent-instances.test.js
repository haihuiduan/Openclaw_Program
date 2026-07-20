const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { projectPath } = require("./helpers");
const {
  assessRegistration,
  disableInstance,
  inspectInstance,
  listInstances,
  reconcileInstances,
  registerInstance
} = require(projectPath("src/core/agent-instances/manager.js"));
const {
  createEmptyInstanceState,
  readInstanceState,
  updateInstanceState,
  writeInstanceState
} = require(projectPath("src/core/agent-instances/state.js"));
const { writeRoleState } = require(projectPath("src/core/roles/state.js"));
const { removeRole } = require(projectPath("src/core/roles/installer.js"));

function createTempDirectory() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-instances-")));
}

async function createInstalledRole(root, overrides = {}) {
  const roleId = overrides.roleId || "test-role";
  const roleAgentIds = overrides.roleAgentIds || ["manager", "worker"];
  const roleRoot = path.join(root, "role-installed", roleId);
  const agents = roleAgentIds.map((agentId) => {
    const workspacePath = path.join(roleRoot, "workspaces", agentId);
    fs.mkdirSync(workspacePath, { recursive: true });
    fs.writeFileSync(path.join(workspacePath, "AGENTS.md"), `# ${agentId}\n`, "utf8");
    return {
      agentId,
      workspacePath,
      contentDigest: "a".repeat(64)
    };
  });
  const roleStatePath = path.join(root, "role-state.json");
  const now = "2026-07-20T00:00:00.000Z";
  await writeRoleState(roleStatePath, {
    schemaVersion: 1,
    roles: {
      [roleId]: {
        roleId,
        roleName: "测试角色",
        roleVersion: "2.0.0",
        status: "installed",
        installedAt: now,
        updatedAt: now,
        enabled: false,
        workspacePath: roleRoot,
        sourceRolePath: path.join(root, "role-source", roleId),
        agents
      }
    }
  });
  return { roleId, roleStatePath, roleRoot, agents };
}

function createOptions(root, roleStatePath, openClawAdapter, overrides = {}) {
  return {
    instanceStatePath: path.join(root, "instance-data", "state.json"),
    agentDirRoot: path.join(root, "instance-data", "agent-dirs"),
    roleStatePath,
    mainWorkspace: path.join(root, "main-workspace"),
    openClawAdapter,
    now: () => new Date("2026-07-20T01:02:03.000Z"),
    ...overrides
  };
}

function createAdapter(initialAgents = []) {
  const calls = [];
  const agents = initialAgents.map((agent) => ({ ...agent }));
  return {
    calls,
    agents,
    async listAgents() {
      calls.push({ method: "listAgents" });
      return agents.map((agent) => ({ ...agent }));
    },
    async registerAgent(input) {
      calls.push({ method: "registerAgent", input: { ...input } });
      agents.push({
        id: input.instanceId,
        workspacePath: input.workspacePath,
        agentDir: input.agentDir
      });
      return { ok: true };
    }
  };
}

function createInstanceRecord(root, overrides = {}) {
  const instanceId = overrides.instanceId || "test-role-worker";
  const now = "2026-07-20T00:00:00.000Z";
  return {
    instanceId,
    roleId: "test-role",
    roleVersion: "2.0.0",
    roleAgentId: "worker",
    workspacePath: path.join(root, "role-installed", "test-role", "workspaces", "worker"),
    agentDir: path.join(root, "instance-data", "agent-dirs", instanceId),
    status: "registered",
    registeredAt: now,
    updatedAt: now,
    lastReconciledAt: now,
    drift: [],
    ...overrides
  };
}

test("register 从已安装 Role Agent 创建全局唯一 Instance 并写独立状态", async () => {
  const root = createTempDirectory();
  const role = await createInstalledRole(root);
  const adapter = createAdapter();
  const options = createOptions(root, role.roleStatePath, adapter);

  const result = await registerInstance("test-role", "worker", options);
  assert.equal(result.ok, true);
  assert.equal(result.alreadyRegistered, false);
  assert.equal(result.instance.instanceId, "test-role-worker");
  assert.equal(result.instance.roleId, "test-role");
  assert.equal(result.instance.roleVersion, "2.0.0");
  assert.equal(result.instance.roleAgentId, "worker");
  assert.equal(result.instance.workspacePath, role.agents[1].workspacePath);
  assert.equal(result.instance.status, "registered");
  assert.deepEqual(result.instance.drift, []);

  const registerCall = adapter.calls.find((call) => call.method === "registerAgent");
  assert.deepEqual(registerCall.input, {
    instanceId: "test-role-worker",
    workspacePath: role.agents[1].workspacePath,
    agentDir: path.join(options.agentDirRoot, "test-role-worker")
  });
  assert.equal(fs.existsSync(options.agentDirRoot), true);
  const state = await readInstanceState(options.instanceStatePath);
  assert.deepEqual(state.instances["test-role-worker"], result.instance);
  assert.deepEqual(
    adapter.calls.map((call) => call.method),
    ["listAgents", "registerAgent", "listAgents"]
  );

  const roleState = JSON.parse(fs.readFileSync(role.roleStatePath, "utf8"));
  assert.equal(roleState.schemaVersion, 1);
  assert.equal(Object.hasOwn(roleState.roles["test-role"], "instances"), false);
});

test("register 同一映射且 OpenClaw 配置一致时幂等，不重复 add", async () => {
  const root = createTempDirectory();
  const role = await createInstalledRole(root);
  const adapter = createAdapter();
  const options = createOptions(root, role.roleStatePath, adapter);

  const first = await registerInstance("test-role", "worker", options);
  const second = await registerInstance("test-role", "worker", options);

  assert.equal(first.alreadyRegistered, false);
  assert.equal(second.alreadyRegistered, true);
  assert.equal(adapter.calls.filter((call) => call.method === "registerAgent").length, 1);
  assert.equal((await listInstances(options)).length, 1);
});

test("register 拒绝未安装角色、未知 Role Agent 和 main", async () => {
  const root = createTempDirectory();
  const role = await createInstalledRole(root);
  const options = createOptions(root, role.roleStatePath, createAdapter());

  await assert.rejects(() => registerInstance("unknown-role", "worker", options), /角色尚未安装/);
  await assert.rejects(() => registerInstance("test-role", "unknown", options), /不包含 Agent/);
  await assert.rejects(() => registerInstance("main", "worker", options), /受保护名称 main/);
  await assert.rejects(() => registerInstance("test-role", "main", options), /受保护名称 main/);
});

test("register 拒绝符号链接 workspace，且不会调用 OpenClaw", async () => {
  const root = createTempDirectory();
  const role = await createInstalledRole(root);
  const outside = path.join(root, "outside");
  fs.mkdirSync(outside);
  const workspace = role.agents[1].workspacePath;
  fs.rmSync(workspace, { recursive: true });
  fs.symlinkSync(outside, workspace);
  const adapter = createAdapter();
  const options = createOptions(root, role.roleStatePath, adapter);

  await assert.rejects(
    () => registerInstance("test-role", "worker", options),
    /不能是符号链接/
  );
  assert.equal(adapter.calls.length, 0);
});

test("register 拒绝接管 OpenClaw 中同名 Agent", async () => {
  const root = createTempDirectory();
  const role = await createInstalledRole(root);
  const adapter = createAdapter([{
    id: "test-role-worker",
    workspacePath: "/tmp/unmanaged-workspace",
    agentDir: "/tmp/unmanaged-agent-dir"
  }]);
  const options = createOptions(root, role.roleStatePath, adapter);

  await assert.rejects(
    () => registerInstance("test-role", "worker", options),
    /已存在同名 Agent，拒绝覆盖或接管/
  );
  assert.equal(adapter.calls.some((call) => call.method === "registerAgent"), false);
});

test("register 拒绝与其他 OpenClaw Agent 共用 agentDir", async () => {
  const root = createTempDirectory();
  const role = await createInstalledRole(root);
  const expectedAgentDir = path.join(root, "instance-data", "agent-dirs", "test-role-worker");
  const adapter = createAdapter([{
    id: "other-agent",
    workspacePath: "/tmp/other-workspace",
    agentDir: expectedAgentDir
  }]);
  const options = createOptions(root, role.roleStatePath, adapter);

  await assert.rejects(
    () => registerInstance("test-role", "worker", options),
    /agentDir 已由 OpenClaw Agent 使用/
  );
  assert.equal(adapter.calls.some((call) => call.method === "registerAgent"), false);
});

test("register 命令失败时不写状态且不调用危险清理", async () => {
  const root = createTempDirectory();
  const role = await createInstalledRole(root);
  const calls = [];
  const adapter = {
    async listAgents() {
      calls.push("list");
      return [];
    },
    async registerAgent() {
      calls.push("add");
      throw new Error("simulated add failure");
    },
    async deleteAgent() {
      calls.push("delete");
    }
  };
  const options = createOptions(root, role.roleStatePath, adapter);

  await assert.rejects(
    () => registerInstance("test-role", "worker", options),
    /未执行 agents delete 自动清理/
  );
  assert.deepEqual(calls, ["list", "add"]);
  assert.deepEqual(await readInstanceState(options.instanceStatePath), createEmptyInstanceState());
});

test("OpenClaw add 成功但状态写入失败时保留 Agent 并给出人工核对提示", async () => {
  const root = createTempDirectory();
  const role = await createInstalledRole(root);
  const adapter = createAdapter();
  const options = createOptions(root, role.roleStatePath, adapter, {
    instanceStateStore: {
      readInstanceState: async () => createEmptyInstanceState(),
      updateInstanceState: async () => {
        throw new Error("simulated state failure");
      }
    }
  });

  await assert.rejects(
    () => registerInstance("test-role", "worker", options),
    /已注册.*未执行 agents delete.*人工核对/
  );
  assert.deepEqual(
    adapter.calls.map((call) => call.method),
    ["listAgents", "registerAgent", "listAgents"]
  );
});

test("OpenClaw add 成功但复查缺失时不写入错误的 registered 状态", async () => {
  const root = createTempDirectory();
  const role = await createInstalledRole(root);
  const calls = [];
  const adapter = {
    async listAgents() {
      calls.push("list");
      return [];
    },
    async registerAgent() {
      calls.push("add");
      return { ok: true };
    }
  };
  const options = createOptions(root, role.roleStatePath, adapter);

  await assert.rejects(
    () => registerInstance("test-role", "worker", options),
    /add 命令已成功.*注册结果缺失.*未执行 agents delete/
  );
  assert.deepEqual(calls, ["list", "add", "list"]);
  assert.deepEqual(await readInstanceState(options.instanceStatePath), createEmptyInstanceState());
});

test("reconcile 标记正常、缺失和配置漂移，并保留未知 Agent", async () => {
  const root = createTempDirectory();
  const instanceStatePath = path.join(root, "instance-data", "state.json");
  const records = {
    "a-role-worker": createInstanceRecord(root, {
      instanceId: "a-role-worker",
      roleId: "a-role",
      workspacePath: path.join(root, "workspaces", "a"),
      agentDir: path.join(root, "agent-dirs", "a")
    }),
    "b-role-worker": createInstanceRecord(root, {
      instanceId: "b-role-worker",
      roleId: "b-role",
      workspacePath: path.join(root, "workspaces", "b"),
      agentDir: path.join(root, "agent-dirs", "b")
    }),
    "c-role-worker": createInstanceRecord(root, {
      instanceId: "c-role-worker",
      roleId: "c-role",
      workspacePath: path.join(root, "workspaces", "c"),
      agentDir: path.join(root, "agent-dirs", "c")
    })
  };
  await writeInstanceState(instanceStatePath, { schemaVersion: 1, instances: records });
  const calls = [];
  const adapter = {
    async listAgents() {
      calls.push("list");
      return [
        { id: "a-role-worker", workspacePath: records["a-role-worker"].workspacePath, agentDir: records["a-role-worker"].agentDir },
        { id: "c-role-worker", workspacePath: "/tmp/drifted-workspace", agentDir: "/tmp/drifted-agent-dir" },
        { id: "unmanaged", workspacePath: "/tmp/unmanaged", agentDir: "/tmp/unmanaged-agent" },
        { id: "main", workspacePath: "/tmp/main", agentDir: "/tmp/main-agent" }
      ];
    },
    async registerAgent() {
      calls.push("add");
    },
    async deleteAgent() {
      calls.push("delete");
    }
  };
  const options = createOptions(root, path.join(root, "unused-role-state.json"), adapter, {
    instanceStatePath
  });

  const result = await reconcileInstances(options);
  assert.deepEqual(calls, ["list"]);
  assert.deepEqual(result.instances.map((record) => [record.instanceId, record.status]), [
    ["a-role-worker", "registered"],
    ["b-role-worker", "missing"],
    ["c-role-worker", "drifted"]
  ]);
  assert.deepEqual(result.instances[1].drift, ["missing"]);
  assert.deepEqual(result.instances[2].drift, ["agent-dir", "workspace"]);
  assert.deepEqual(result.unmanagedAgents.map((agent) => agent.id), ["unmanaged", "main"]);
  assert.equal((await readInstanceState(instanceStatePath)).instances["c-role-worker"].status, "drifted");
});

test("reconcile 不因损坏状态覆盖原文件，也不删除未知 Agent", async () => {
  const root = createTempDirectory();
  const instanceStatePath = path.join(root, "state.json");
  fs.writeFileSync(instanceStatePath, "{broken", "utf8");
  const adapter = createAdapter([{ id: "unknown", workspacePath: "/tmp/w", agentDir: "/tmp/a" }]);
  const options = createOptions(root, path.join(root, "role-state.json"), adapter, {
    instanceStatePath
  });

  await assert.rejects(() => reconcileInstances(options), /不是有效 JSON/);
  assert.equal(fs.readFileSync(instanceStatePath, "utf8"), "{broken");
  assert.deepEqual(adapter.calls.map((call) => call.method), []);
});

test("list 和 inspect 只读取本地 Instance State，且 inspect 拒绝未知 id", async () => {
  const root = createTempDirectory();
  const instanceStatePath = path.join(root, "state.json");
  const record = createInstanceRecord(root);
  await writeInstanceState(instanceStatePath, {
    schemaVersion: 1,
    instances: { [record.instanceId]: record }
  });
  const adapter = createAdapter();
  const options = createOptions(root, path.join(root, "role-state.json"), adapter, {
    instanceStatePath
  });

  assert.deepEqual(await listInstances(options), [record]);
  assert.deepEqual(await inspectInstance(record.instanceId, options), record);
  await assert.rejects(() => inspectInstance("unknown-instance", options), /未找到 Agent Instance/);
  assert.equal(adapter.calls.length, 0);
});

test("disable 明确返回不支持，不调用 delete、unbind 或配置写入", async () => {
  await assert.rejects(
    () => disableInstance("test-role-worker"),
    /不支持安全无损停用.*不会使用 agents delete、unbind.*openclaw\.json/
  );
});

test("注册状态判断分别识别缺失、workspace 漂移和 agentDir 漂移", () => {
  const root = createTempDirectory();
  const record = createInstanceRecord(root);
  assert.deepEqual(assessRegistration(record, null), {
    status: "missing",
    drift: ["missing"]
  });
  assert.deepEqual(assessRegistration(record, {
    id: record.instanceId,
    workspacePath: "/tmp/other",
    agentDir: record.agentDir
  }), {
    status: "drifted",
    drift: ["workspace"]
  });
  assert.deepEqual(assessRegistration(record, {
    id: record.instanceId,
    workspacePath: record.workspacePath,
    agentDir: "/tmp/other"
  }), {
    status: "drifted",
    drift: ["agent-dir"]
  });
});

test("Instance State 不会持久化传入的 API Key、token 或 secret", async () => {
  const root = createTempDirectory();
  const statePath = path.join(root, "state.json");
  const record = createInstanceRecord(root, {
    apiKey: "sk-private",
    token: "private-token",
    secret: "private-secret"
  });
  await writeInstanceState(statePath, {
    schemaVersion: 1,
    instances: { [record.instanceId]: record }
  });
  assert.doesNotMatch(fs.readFileSync(statePath, "utf8"), /sk-private|private-token|private-secret/);
});

test("Role Lifecycle 拒绝删除仍被 Agent Instance 引用的 workspace", async () => {
  const root = createTempDirectory();
  const role = await createInstalledRole(root);
  const adapter = createAdapter();
  const options = createOptions(root, role.roleStatePath, adapter);
  await registerInstance("test-role", "worker", options);

  await assert.rejects(
    () => removeRole("test-role", {
      installRoot: path.join(root, "role-installed"),
      statePath: role.roleStatePath,
      instanceStatePath: options.instanceStatePath,
      mainWorkspace: options.mainWorkspace
    }),
    /仍被 Agent Instance 引用.*test-role-worker/
  );
  assert.equal(fs.existsSync(role.roleRoot), true);
});
