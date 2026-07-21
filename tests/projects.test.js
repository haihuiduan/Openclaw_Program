const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { projectPath } = require("./helpers");
const {
  activateProject, archiveProject, completeProject, createProject, inspectProject,
  listProjects, previewProjectTeamSync, syncProjectTeam, unarchiveProject, updateProject
} = require(projectPath("src/core/projects/manager.js"));
const { createTeam, deleteTeam, updateTeam } = require(projectPath("src/core/teams/manager.js"));
const { updateTeamState } = require(projectPath("src/core/teams/state.js"));
const { writeInstanceState, readInstanceState } = require(projectPath("src/core/agent-instances/state.js"));
const { createTask } = require(projectPath("src/core/tasks/manager.js"));

function instance(root, id, overrides = {}) {
  const agent = id.split("-").pop();
  return {
    instanceId: id, roleId: "test-role", roleVersion: "1.0.0", roleAgentId: agent,
    workspacePath: path.join(root, "roles", agent), agentDir: path.join(root, "agents", id),
    status: "registered", registeredAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z", lastReconciledAt: "2026-07-21T00:00:00.000Z",
    drift: [], ...overrides
  };
}
async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-projects-"));
  const clock = { value: "2026-07-21T01:00:00.000Z" };
  const options = {
    projectStatePath: path.join(root, "projects", "state.json"),
    taskStatePath: path.join(root, "tasks", "state.json"),
    teamStatePath: path.join(root, "teams", "state.json"),
    instanceStatePath: path.join(root, "instances", "state.json"),
    now: () => new Date(clock.value)
  };
  await writeInstanceState(options.instanceStatePath, { schemaVersion: 1, instances: {
    "test-role-manager": instance(root, "test-role-manager"),
    "test-role-worker": instance(root, "test-role-worker"),
    "test-role-other": instance(root, "test-role-other")
  }});
  await createTeam("test-team", {
    name: "测试团队", managerInstanceId: "test-role-manager",
    memberInstanceIds: ["test-role-worker", "test-role-manager"]
  }, options);
  return { root, clock, options };
}
function input(overrides = {}) {
  return { projectId: "test-project", name: "测试项目", teamId: "test-team", ...overrides };
}

test("Project 创建 ready Team 安全快照并继承或覆盖执行偏好", async () => {
  const f = await fixture();
  const project = await createProject(input(), f.options);
  assert.equal(project.status, "draft");
  assert.equal(project.executionMode, "confirm");
  assert.equal(project.maxConcurrency, 2);
  assert.equal(project.teamSyncStatus, "in-sync");
  assert.equal(project.teamSnapshotHealth.status, "ready");
  assert.deepEqual(project.teamSnapshot.memberInstanceIds, ["test-role-manager", "test-role-worker"]);
  assert.doesNotMatch(JSON.stringify(project.teamSnapshot), /workspacePath|agentDir|roleId|health/);
  const overridden = await createProject(input({
    projectId: "override-project", executionMode: "auto", maxConcurrency: 6,
    apiKey: "sk-secret", workspacePath: "/forbidden"
  }), f.options);
  assert.equal(overridden.executionMode, "auto");
  assert.equal(overridden.maxConcurrency, 6);
  assert.doesNotMatch(fs.readFileSync(f.options.projectStatePath, "utf8"), /sk-secret|workspacePath/);
  assert.deepEqual((await listProjects(f.options)).map((item) => item.projectId), ["override-project", "test-project"]);
});

test("Project 拒绝未知、degraded、invalid Team", async () => {
  const f = await fixture();
  await assert.rejects(() => createProject(input({ teamId: "unknown-team" }), f.options), /未找到 Team/);
  let state = await readInstanceState(f.options.instanceStatePath);
  state.instances["test-role-worker"].status = "missing";
  state.instances["test-role-worker"].drift = ["missing"];
  await writeInstanceState(f.options.instanceStatePath, state);
  await assert.rejects(() => createProject(input(), f.options), /当前 degraded/);
  state = await readInstanceState(f.options.instanceStatePath);
  delete state.instances["test-role-manager"];
  await writeInstanceState(f.options.instanceStatePath, state);
  await assert.rejects(() => createProject(input(), f.options), /当前 invalid/);
});

test("Project 更新、激活、pending 阻止完成、归档只读与取消归档", async () => {
  const f = await fixture();
  const created = await createProject(input(), f.options);
  f.clock.value = "2026-07-21T02:00:00.000Z";
  const updated = await updateProject("test-project", { name: "新项目", executionMode: "auto" }, f.options);
  assert.equal(updated.createdAt, created.createdAt);
  assert.equal(updated.updatedAt, f.clock.value);
  assert.equal((await activateProject("test-project", f.options)).status, "active");
  await createTask({ taskId: "pending-task", projectId: "test-project", title: "待办" }, f.options);
  const summary = await inspectProject("test-project", f.options);
  assert.equal(summary.taskSummary.total, 1);
  assert.equal(summary.taskSummary.pending, 1);
  assert.equal(summary.taskSummary.unassigned, 1);
  await assert.rejects(() => completeProject("test-project", f.options), /pending Task.*pending-task/);
  const archived = await archiveProject("test-project", f.options);
  assert.equal(archived.archivedAt, f.clock.value);
  await assert.rejects(() => updateProject("test-project", { name: "禁止" }, f.options), /只读/);
  assert.equal((await unarchiveProject("test-project", f.options)).archivedAt, null);
});

test("Team 配置不自动改变 Project，预览并显式同步且支持乐观校验", async () => {
  const f = await fixture();
  const created = await createProject(input({ executionMode: "auto", maxConcurrency: 7 }), f.options);
  f.clock.value = "2026-07-21T03:00:00.000Z";
  await updateTeam("test-team", { executionMode: "auto", maxConcurrency: 4 }, f.options);
  const stale = await inspectProject("test-project", f.options);
  assert.equal(stale.teamSnapshot.executionMode, "confirm");
  assert.equal(stale.executionMode, "auto");
  assert.equal(stale.maxConcurrency, 7);
  assert.equal(stale.teamSyncStatus, "out-of-sync");
  const preview = await previewProjectTeamSync("test-project", f.options);
  assert.deepEqual(preview.differences.map((item) => item.field), ["executionMode", "maxConcurrency"]);
  await assert.rejects(() => syncProjectTeam("test-project", {
    confirm: true, expectedSourceTeamUpdatedAt: "2026-01-01T00:00:00.000Z"
  }, f.options), /预览后发生变化/);
  const synced = await syncProjectTeam("test-project", {
    confirm: true, expectedSourceTeamUpdatedAt: preview.currentTeamConfig.updatedAt
  }, f.options);
  assert.equal(synced.teamSyncStatus, "in-sync");
  assert.equal(synced.executionMode, "auto");
  assert.equal(synced.maxConcurrency, 7);
  f.clock.value = "2026-07-21T04:00:00.000Z";
  await updateTeam("test-team", { executionMode: "confirm", maxConcurrency: 3 }, f.options);
  const secondPreview = await previewProjectTeamSync("test-project", f.options);
  const applied = await syncProjectTeam("test-project", {
    confirm: true,
    expectedSourceTeamUpdatedAt: secondPreview.currentTeamConfig.updatedAt,
    syncExecutionSettings: true
  }, f.options);
  assert.equal(applied.executionMode, "confirm");
  assert.equal(applied.maxConcurrency, 3);
  await assert.rejects(() => syncProjectTeam("test-project", {}, f.options), /显式确认/);
});

test("Team 删除被所有 Project 引用保护且在 Team State 修改前拒绝", async () => {
  const f = await fixture();
  await createProject(input(), f.options);
  const before = fs.readFileSync(f.options.teamStatePath, "utf8");
  await assert.rejects(() => deleteTeam("test-team", f.options), (error) => {
    assert.match(error.message, /Project/);
    assert.match(error.message, /test-project/);
    assert.match(error.message, /暂时不能删除/);
    return true;
  });
  assert.equal(fs.readFileSync(f.options.teamStatePath, "utf8"), before);
  assert.equal((await inspectProject("test-project", f.options)).teamId, "test-team");
});

test("Project 动态报告快照健康与异常丢失的来源 Team，不改写持久快照", async () => {
  const f = await fixture();
  await createProject(input(), f.options);
  const before = fs.readFileSync(f.options.projectStatePath, "utf8");
  const instances = await readInstanceState(f.options.instanceStatePath);
  instances.instances["test-role-worker"].status = "drifted";
  instances.instances["test-role-worker"].drift = ["workspace"];
  await writeInstanceState(f.options.instanceStatePath, instances);
  assert.equal((await inspectProject("test-project", f.options)).teamSnapshotHealth.status, "degraded");
  await updateTeamState(f.options.teamStatePath, (state) => {
    delete state.teams["test-team"];
    return state;
  });
  const missing = await inspectProject("test-project", f.options);
  assert.equal(missing.teamSyncStatus, "source-missing");
  assert.equal(missing.teamSnapshot.managerInstanceId, "test-role-manager");
  assert.equal(fs.readFileSync(f.options.projectStatePath, "utf8"), before);
});
