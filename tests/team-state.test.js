const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { projectPath } = require("./helpers");
const {
  createEmptyTeamState,
  getTeamState,
  listTeamStates,
  readTeamState,
  updateTeamState,
  writeTeamState
} = require(projectPath("src/core/teams/state.js"));

function createTempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-team-state-"));
}

function createRecord(teamId = "test-team", overrides = {}) {
  const now = "2026-07-21T00:00:00.000Z";
  return {
    teamId,
    name: "测试团队",
    description: "仅用于测试",
    managerInstanceId: "test-role-manager",
    memberInstanceIds: ["test-role-worker", "test-role-manager"],
    executionMode: "confirm",
    maxConcurrency: 2,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

test("Team State 不存在时返回空状态并以 0600 原子写入", async () => {
  const root = createTempDirectory();
  const statePath = path.join(root, "teams", "state.json");
  assert.deepEqual(await readTeamState(statePath), createEmptyTeamState());

  const state = createEmptyTeamState();
  state.teams["test-team"] = createRecord();
  await writeTeamState(statePath, state);

  assert.deepEqual(
    (await readTeamState(statePath)).teams["test-team"].memberInstanceIds,
    ["test-role-manager", "test-role-worker"]
  );
  assert.deepEqual(fs.readdirSync(path.dirname(statePath)), ["state.json"]);
  assert.equal(fs.statSync(statePath).mode & 0o777, 0o600);
});

test("Team State 拒绝损坏 JSON、未知 schema 和无效根结构且不覆盖原文件", async () => {
  const root = createTempDirectory();
  const statePath = path.join(root, "state.json");
  fs.writeFileSync(statePath, "{broken", "utf8");
  await assert.rejects(() => readTeamState(statePath), /不是有效 JSON/);
  assert.equal(fs.readFileSync(statePath, "utf8"), "{broken");

  fs.writeFileSync(statePath, JSON.stringify({ schemaVersion: 2, teams: {} }), "utf8");
  await assert.rejects(() => readTeamState(statePath), /schemaVersion 必须为 1/);

  fs.writeFileSync(statePath, JSON.stringify({ schemaVersion: 1, teams: [] }), "utf8");
  await assert.rejects(() => readTeamState(statePath), /teams 必须是 JSON 对象/);
});

test("Team State 只保存白名单字段、排序成员且返回值不共享可变引用", async () => {
  const root = createTempDirectory();
  const statePath = path.join(root, "state.json");
  await writeTeamState(statePath, {
    schemaVersion: 1,
    teams: {
      "test-team": createRecord("test-team", {
        workspacePath: "/private/forbidden",
        agentDir: "/private/agent-dir",
        apiKey: "sk-forbidden",
        token: "token-forbidden",
        secret: "secret-forbidden"
      })
    },
    openClawConfig: "forbidden"
  });

  const raw = fs.readFileSync(statePath, "utf8");
  assert.doesNotMatch(raw, /workspacePath|agentDir|apiKey|token|secret|openClawConfig|forbidden/);
  const first = await readTeamState(statePath);
  assert.deepEqual(first.teams["test-team"].memberInstanceIds, [
    "test-role-manager",
    "test-role-worker"
  ]);
  first.teams["test-team"].memberInstanceIds.push("test-role-other");
  assert.equal(
    getTeamState(await readTeamState(statePath), "test-team").memberInstanceIds.length,
    2
  );
});

test("Team State 并发更新串行化且 Team 列表按 teamId 稳定排序", async () => {
  const root = createTempDirectory();
  const statePath = path.join(root, "state.json");
  await Promise.all(["z-team", "a-team"].map((teamId) => (
    updateTeamState(statePath, async (state) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      state.teams[teamId] = createRecord(teamId);
      return state;
    })
  )));

  const state = await readTeamState(statePath);
  assert.deepEqual(listTeamStates(state).map((team) => team.teamId), ["a-team", "z-team"]);
});

test("Team State 严格校验 id、名称、描述、执行模式和并发数", async () => {
  const root = createTempDirectory();
  const cases = [
    ["main", createRecord("main"), /受保护名称/],
    ["bad_id", createRecord("bad_id"), /teamId 无效/],
    ["test-team", createRecord("test-team", { name: "" }), /name 必须是非空字符串/],
    ["test-team", createRecord("test-team", { name: "x".repeat(101) }), /name 不能超过 100/],
    ["test-team", createRecord("test-team", { description: "x".repeat(1001) }), /description 不能超过 1000/],
    ["test-team", createRecord("test-team", { executionMode: "execute" }), /confirm 或 auto/],
    ["test-team", createRecord("test-team", { maxConcurrency: 0 }), /1 到 32/],
    ["test-team", createRecord("test-team", { maxConcurrency: 1.5 }), /1 到 32/]
  ];

  for (const [teamId, record, pattern] of cases) {
    await assert.rejects(
      () => writeTeamState(path.join(root, `${teamId}-${Math.random()}.json`), {
        schemaVersion: 1,
        teams: { [teamId]: record }
      }),
      pattern
    );
  }
});

test("Team State 拒绝空成员、重复成员和不在成员中的 Manager", async () => {
  const root = createTempDirectory();
  for (const [overrides, pattern] of [
    [{ memberInstanceIds: [] }, /至少包含一个/],
    [{ memberInstanceIds: ["test-role-manager", "test-role-manager"] }, /不能包含重复/],
    [{ memberInstanceIds: ["test-role-worker"] }, /managerInstanceId 必须包含/]
  ]) {
    await assert.rejects(
      () => writeTeamState(path.join(root, `${Math.random()}.json`), {
        schemaVersion: 1,
        teams: { "test-team": createRecord("test-team", overrides) }
      }),
      pattern
    );
  }
});
