const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { projectPath } = require("./helpers");
const {
  addTeamMember,
  assessTeamHealth,
  createTeam,
  deleteTeam,
  inspectTeam,
  listTeams,
  removeTeamMember,
  setTeamManager,
  updateTeam
} = require(projectPath("src/core/teams/manager.js"));
const {
  readTeamState
} = require(projectPath("src/core/teams/state.js"));
const {
  readInstanceState,
  writeInstanceState
} = require(projectPath("src/core/agent-instances/state.js"));

function createTempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-teams-"));
}

function createInstance(root, instanceId, overrides = {}) {
  const parts = instanceId.split("-");
  const roleAgentId = parts.pop();
  const roleId = parts.join("-");
  const now = "2026-07-21T00:00:00.000Z";
  return {
    instanceId,
    roleId,
    roleVersion: "1.0.0",
    roleAgentId,
    workspacePath: path.join(root, "roles", roleId, "workspaces", roleAgentId),
    agentDir: path.join(root, "agent-dirs", instanceId),
    status: "registered",
    registeredAt: now,
    updatedAt: now,
    lastReconciledAt: now,
    drift: [],
    ...overrides
  };
}

async function createFixture() {
  const root = createTempDirectory();
  const instanceStatePath = path.join(root, "instances", "state.json");
  const teamStatePath = path.join(root, "teams", "state.json");
  const instances = {};
  for (const instanceId of [
    "test-role-manager",
    "test-role-researcher",
    "test-role-creator"
  ]) {
    instances[instanceId] = createInstance(root, instanceId);
  }
  await writeInstanceState(instanceStatePath, { schemaVersion: 1, instances });
  return {
    root,
    teamStatePath,
    instanceStatePath,
    options: {
      teamStatePath,
      instanceStatePath,
      now: () => new Date("2026-07-21T01:02:03.000Z")
    }
  };
}

function createInput(overrides = {}) {
  return {
    name: "测试团队",
    managerInstanceId: "test-role-manager",
    memberInstanceIds: ["test-role-researcher", "test-role-manager"],
    ...overrides
  };
}

test("create 仅用 registered Instance 建 Team 并应用首版默认值", async () => {
  const fixture = await createFixture();
  const team = await createTeam("test-team", createInput(), fixture.options);

  assert.equal(team.teamId, "test-team");
  assert.equal(team.description, "");
  assert.equal(team.executionMode, "confirm");
  assert.equal(team.maxConcurrency, 2);
  assert.equal(team.health.status, "ready");
  assert.deepEqual(team.memberInstanceIds, ["test-role-manager", "test-role-researcher"]);
  assert.deepEqual(team.resolvedManager, {
    instanceId: "test-role-manager",
    roleId: "test-role",
    roleVersion: "1.0.0",
    roleAgentId: "manager",
    status: "registered",
    drift: [],
    lastReconciledAt: "2026-07-21T00:00:00.000Z"
  });
  assert.doesNotMatch(JSON.stringify(team.resolvedMembers), /workspacePath|agentDir/);

  const raw = fs.readFileSync(fixture.teamStatePath, "utf8");
  assert.doesNotMatch(raw, /roleId|roleVersion|roleAgentId|workspacePath|agentDir|health/);
});

test("create 拒绝重复 Team、main、空成员、重复成员和未显式加入的 Manager", async () => {
  const fixture = await createFixture();
  await createTeam("test-team", createInput(), fixture.options);
  await assert.rejects(() => createTeam("test-team", createInput(), fixture.options), /Team 已存在/);
  await assert.rejects(() => createTeam("main", createInput(), fixture.options), /受保护名称/);
  await assert.rejects(
    () => createTeam("empty-team", createInput({ memberInstanceIds: [] }), fixture.options),
    /至少需要一个/
  );
  await assert.rejects(
    () => createTeam("duplicate-team", createInput({
      memberInstanceIds: ["test-role-manager", "test-role-manager"]
    }), fixture.options),
    /不能包含重复/
  );
  await assert.rejects(
    () => createTeam("manager-team", createInput({
      memberInstanceIds: ["test-role-researcher"]
    }), fixture.options),
    /必须显式包含/
  );
});

test("create 和 add-member 拒绝未知、missing 或 drifted Instance", async () => {
  const fixture = await createFixture();
  const state = await readInstanceState(fixture.instanceStatePath);
  state.instances["test-role-researcher"].status = "missing";
  state.instances["test-role-researcher"].drift = ["missing"];
  state.instances["test-role-creator"].status = "drifted";
  state.instances["test-role-creator"].drift = ["workspace"];
  await writeInstanceState(fixture.instanceStatePath, state);

  await assert.rejects(
    () => createTeam("missing-team", createInput(), fixture.options),
    /必须处于 registered.*missing/
  );
  await assert.rejects(
    () => createTeam("unknown-team", createInput({
      managerInstanceId: "unknown-role-manager",
      memberInstanceIds: ["unknown-role-manager"]
    }), fixture.options),
    /Instance 不存在/
  );
  const team = await createTeam("test-team", createInput({
    memberInstanceIds: ["test-role-manager"]
  }), fixture.options);
  assert.equal(team.health.status, "ready");
  await assert.rejects(
    () => addTeamMember("test-team", "test-role-creator", fixture.options),
    /必须处于 registered.*drifted/
  );
});

test("update 只允许名称、描述、执行模式和并发数并保留 createdAt", async () => {
  const fixture = await createFixture();
  const created = await createTeam("test-team", createInput(), fixture.options);
  const updated = await updateTeam("test-team", {
    name: "新名称",
    description: "新描述",
    executionMode: "auto",
    maxConcurrency: 8
  }, {
    ...fixture.options,
    now: () => new Date("2026-07-21T02:03:04.000Z")
  });

  assert.equal(updated.name, "新名称");
  assert.equal(updated.description, "新描述");
  assert.equal(updated.executionMode, "auto");
  assert.equal(updated.maxConcurrency, 8);
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.updatedAt, "2026-07-21T02:03:04.000Z");
  await assert.rejects(() => updateTeam("test-team", {}, fixture.options), /至少需要提供/);
  await assert.rejects(
    () => updateTeam("test-team", { memberInstanceIds: [] }, fixture.options),
    /不支持更新字段/
  );
});

test("成员与 Manager 操作保持约束且成员排序稳定", async () => {
  const fixture = await createFixture();
  await createTeam("test-team", createInput(), fixture.options);
  const added = await addTeamMember("test-team", "test-role-creator", fixture.options);
  assert.deepEqual(added.memberInstanceIds, [
    "test-role-creator",
    "test-role-manager",
    "test-role-researcher"
  ]);
  await assert.rejects(
    () => addTeamMember("test-team", "test-role-creator", fixture.options),
    /已是 Team 成员/
  );
  await assert.rejects(
    () => setTeamManager("test-team", "other-role-worker", fixture.options),
    /Instance 不存在/
  );

  const managerChanged = await setTeamManager(
    "test-team",
    "test-role-researcher",
    fixture.options
  );
  assert.equal(managerChanged.managerInstanceId, "test-role-researcher");
  await assert.rejects(
    () => removeTeamMember("test-team", "test-role-researcher", fixture.options),
    /不能移除当前 Team Manager/
  );
  const removed = await removeTeamMember("test-team", "test-role-manager", fixture.options);
  assert.deepEqual(removed.memberInstanceIds, ["test-role-creator", "test-role-researcher"]);
});

test("健康状态由 Instance State 动态计算为 ready、degraded 和 invalid", async () => {
  const fixture = await createFixture();
  await createTeam("test-team", createInput(), fixture.options);
  assert.equal((await assessTeamHealth("test-team", fixture.options)).health.status, "ready");

  let state = await readInstanceState(fixture.instanceStatePath);
  state.instances["test-role-researcher"].status = "drifted";
  state.instances["test-role-researcher"].drift = ["agent-dir"];
  await writeInstanceState(fixture.instanceStatePath, state);
  const degraded = await inspectTeam("test-team", fixture.options);
  assert.equal(degraded.health.status, "degraded");
  assert.deepEqual(degraded.health.issues[0].drift, ["agent-dir"]);
  assert.deepEqual(degraded.memberInstanceIds, ["test-role-manager", "test-role-researcher"]);

  state = await readInstanceState(fixture.instanceStatePath);
  delete state.instances["test-role-manager"];
  await writeInstanceState(fixture.instanceStatePath, state);
  const invalid = await inspectTeam("test-team", fixture.options);
  assert.equal(invalid.health.status, "invalid");
  assert.equal(invalid.resolvedManager, null);
  assert.match(invalid.health.issues.find((issue) => (
    issue.instanceId === "test-role-manager"
  )).message, /不存在于本地 Instance State/);
  assert.deepEqual(invalid.memberInstanceIds, ["test-role-manager", "test-role-researcher"]);
});

test("list 和 inspect 稳定排序且只读取本地 Team/Instance State", async () => {
  const fixture = await createFixture();
  const calls = [];
  const teamStore = {
    readTeamState: async (statePath) => {
      calls.push(["team-read", statePath]);
      return readTeamState(statePath);
    },
    updateTeamState: async () => {
      throw new Error("不应更新");
    }
  };
  const instanceStore = {
    readInstanceState: async (statePath) => {
      calls.push(["instance-read", statePath]);
      return readInstanceState(statePath);
    }
  };
  await createTeam("z-team", createInput(), fixture.options);
  await createTeam("a-team", createInput(), fixture.options);

  const readOptions = { ...fixture.options, teamStateStore: teamStore, instanceStateStore: instanceStore };
  assert.deepEqual((await listTeams(readOptions)).map((team) => team.teamId), ["a-team", "z-team"]);
  assert.equal((await inspectTeam("z-team", readOptions)).teamId, "z-team");
  await assert.rejects(() => inspectTeam("unknown-team", readOptions), /未找到 Team/);
  assert.equal(calls.some(([method]) => !["team-read", "instance-read"].includes(method)), false);
});

test("delete 只删除 Team State，不触碰 Role State、Instance State 或 workspace", async () => {
  const fixture = await createFixture();
  const roleStatePath = path.join(fixture.root, "role-state.json");
  const workspacePath = path.join(fixture.root, "workspace", "keep.txt");
  fs.mkdirSync(path.dirname(workspacePath), { recursive: true });
  fs.writeFileSync(roleStatePath, "role-state-sentinel", "utf8");
  fs.writeFileSync(workspacePath, "workspace-sentinel", "utf8");
  const instanceBefore = fs.readFileSync(fixture.instanceStatePath, "utf8");
  await createTeam("test-team", createInput(), fixture.options);

  assert.deepEqual(await deleteTeam("test-team", fixture.options), {
    teamId: "test-team",
    deleted: true
  });
  assert.deepEqual(await listTeams(fixture.options), []);
  assert.equal(fs.readFileSync(roleStatePath, "utf8"), "role-state-sentinel");
  assert.equal(fs.readFileSync(workspacePath, "utf8"), "workspace-sentinel");
  assert.equal(fs.readFileSync(fixture.instanceStatePath, "utf8"), instanceBefore);
});

test("Team Manager 不调用 OpenClaw，且敏感输入不会进入 Team State", async () => {
  const fixture = await createFixture();
  const calls = [];
  const options = {
    ...fixture.options,
    openClawAdapter: new Proxy({}, {
      get() {
        calls.push("openclaw");
        throw new Error("禁止访问 OpenClaw");
      }
    })
  };
  await createTeam("test-team", {
    ...createInput(),
    apiKey: "sk-sensitive",
    token: "token-sensitive",
    secret: "secret-sensitive"
  }, options);
  await inspectTeam("test-team", options);
  await listTeams(options);
  assert.deepEqual(calls, []);
  assert.doesNotMatch(
    fs.readFileSync(fixture.teamStatePath, "utf8"),
    /sk-sensitive|token-sensitive|secret-sensitive|apiKey|token|secret/
  );
});

test("同一 Team 的并发成员更新不会互相覆盖", async () => {
  const fixture = await createFixture();
  await createTeam("test-team", createInput({
    memberInstanceIds: ["test-role-manager"]
  }), fixture.options);
  await Promise.all([
    addTeamMember("test-team", "test-role-researcher", fixture.options),
    addTeamMember("test-team", "test-role-creator", fixture.options)
  ]);
  assert.deepEqual((await inspectTeam("test-team", fixture.options)).memberInstanceIds, [
    "test-role-creator",
    "test-role-manager",
    "test-role-researcher"
  ]);
});
