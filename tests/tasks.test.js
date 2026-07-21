const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { projectPath } = require("./helpers");
const { readInstanceState, writeInstanceState } = require(projectPath("src/core/agent-instances/state.js"));
const { createTeam } = require(projectPath("src/core/teams/manager.js"));
const { archiveProject, completeProject, createProject } = require(projectPath("src/core/projects/manager.js"));
const {
  addTaskDependency, assignTask, cancelTask, completeTask, createTask, inspectTask,
  listTasks, removeTaskDependency, setTaskCritical, updateTask
} = require(projectPath("src/core/tasks/manager.js"));

function instance(root, id) {
  const agent = id.split("-").pop();
  const now = "2026-07-21T00:00:00.000Z";
  return {
    instanceId: id, roleId: "test-role", roleVersion: "1.0.0", roleAgentId: agent,
    workspacePath: path.join(root, "workspace", agent), agentDir: path.join(root, "agents", id),
    status: "registered", registeredAt: now, updatedAt: now, lastReconciledAt: now, drift: []
  };
}
async function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-tasks-"));
  const clock = { value: "2026-07-21T01:00:00.000Z" };
  let openClawCalls = 0;
  const options = {
    instanceStatePath: path.join(root, "instances.json"), teamStatePath: path.join(root, "teams.json"),
    projectStatePath: path.join(root, "projects.json"), taskStatePath: path.join(root, "tasks.json"),
    now: () => new Date(clock.value),
    openClawAdapter: new Proxy({}, {
      get() {
        openClawCalls += 1;
        throw new Error("Task 测试禁止调用 OpenClaw Adapter");
      }
    })
  };
  await writeInstanceState(options.instanceStatePath, { schemaVersion: 1, instances: {
    "test-role-manager": instance(root, "test-role-manager"),
    "test-role-worker": instance(root, "test-role-worker"),
    "test-role-outsider": instance(root, "test-role-outsider")
  }});
  await createTeam("test-team", { name: "团队", managerInstanceId: "test-role-manager",
    memberInstanceIds: ["test-role-manager", "test-role-worker"] }, options);
  await createProject({ projectId: "test-project", name: "项目", teamId: "test-team" }, options);
  return { root, clock, options, getOpenClawCalls: () => openClawCalls };
}

async function setInstanceStatus(fixture, instanceId, status, drift) {
  const state = await readInstanceState(fixture.options.instanceStatePath);
  state.instances[instanceId].status = status;
  state.instances[instanceId].drift = drift;
  await writeInstanceState(fixture.options.instanceStatePath, state);
}

async function deleteInstance(fixture, instanceId) {
  const state = await readInstanceState(fixture.options.instanceStatePath);
  delete state.instances[instanceId];
  await writeInstanceState(fixture.options.instanceStatePath, state);
}

async function assertRejectedWithoutStateChanges(fixture, operation, pattern) {
  const before = {
    task: fs.existsSync(fixture.options.taskStatePath)
      ? fs.readFileSync(fixture.options.taskStatePath)
      : null,
    instance: fs.readFileSync(fixture.options.instanceStatePath),
    project: fs.readFileSync(fixture.options.projectStatePath),
    team: fs.readFileSync(fixture.options.teamStatePath)
  };
  await assert.rejects(operation, pattern);
  const after = {
    task: fs.existsSync(fixture.options.taskStatePath)
      ? fs.readFileSync(fixture.options.taskStatePath)
      : null,
    instance: fs.readFileSync(fixture.options.instanceStatePath),
    project: fs.readFileSync(fixture.options.projectStatePath),
    team: fs.readFileSync(fixture.options.teamStatePath)
  };
  assert.deepEqual(after, before);
}

test("Task 合法创建、默认值、分配快照成员和关键任务规则", async () => {
  const f = await fixture();
  const teamBefore = fs.readFileSync(f.options.teamStatePath, "utf8");
  const instanceBefore = fs.readFileSync(f.options.instanceStatePath, "utf8");
  const task = await createTask({
    taskId: "test-task", projectId: "test-project", title: "测试任务",
    assignedInstanceId: "test-role-manager", critical: true,
    criticalReason: "影响交付", criticalSource: "manager",
    failurePolicy: "pause-dependents", retryPolicy: { maxRetries: 2, retryDelayMs: 1000 }
  }, f.options);
  assert.equal(task.status, "pending");
  assert.equal(task.computedStatus, "pending");
  assert.equal(task.priority, "medium");
  assert.equal(task.source, "user");
  assert.equal(task.criticalSource, "manager");
  assert.deepEqual(task.retryPolicy, { maxRetries: 2, retryDelayMs: 1000 });
  await assert.rejects(() => createTask({ taskId: "bad-critical", projectId: "test-project", title: "x", critical: true }, f.options), /criticalReason/);
  await assert.rejects(() => createTask({ taskId: "bad-assign", projectId: "test-project", title: "x", assignedInstanceId: "test-role-outsider" }, f.options), /必须属于 Project Team 快照/);
  assert.doesNotMatch(fs.readFileSync(f.options.taskStatePath, "utf8"), /workspacePath|agentDir|apiKey|result|error/);
  assert.equal(fs.readFileSync(f.options.teamStatePath, "utf8"), teamBefore);
  assert.equal(fs.readFileSync(f.options.instanceStatePath, "utf8"), instanceBefore);
});

test("Task 更新白名单、分配、取消分配与关键属性均保留有限语义", async () => {
  const f = await fixture();
  await createTask({ taskId: "test-task", projectId: "test-project", title: "任务" }, f.options);
  f.clock.value = "2026-07-21T02:00:00.000Z";
  const updated = await updateTask("test-task", {
    title: "新任务", priority: "high", failurePolicy: "pause-project",
    retryPolicy: { maxRetries: 3 }
  }, f.options);
  assert.equal(updated.priority, "high");
  assert.deepEqual(updated.retryPolicy, { maxRetries: 3, retryDelayMs: 0 });
  assert.equal((await assignTask("test-task", "test-role-worker", f.options)).assignedInstanceId, "test-role-worker");
  assert.equal((await assignTask("test-task", null, f.options)).assignedInstanceId, null);
  const critical = await setTaskCritical("test-task", { critical: true, reason: "关键", source: "user" }, f.options);
  assert.equal(critical.criticalReason, "关键");
  const normal = await setTaskCritical("test-task", { critical: false }, f.options);
  assert.equal(normal.criticalReason, null);
  await assert.rejects(() => updateTask("test-task", {}, f.options), /至少需要/);
  await assert.rejects(() => updateTask("test-task", { status: "running" }, f.options), /不支持更新字段/);
});

test("Task 依赖限制同 Project、拒绝环并动态计算 blocked", async () => {
  const f = await fixture();
  await createTask({ taskId: "first-task", projectId: "test-project", title: "第一步" }, f.options);
  await createTask({ taskId: "second-task", projectId: "test-project", title: "第二步", dependencies: ["first-task"] }, f.options);
  assert.equal((await inspectTask("second-task", f.options)).computedStatus, "blocked");
  await assert.rejects(() => addTaskDependency("first-task", "second-task", f.options), /形成循环/);
  assert.deepEqual((await inspectTask("first-task", f.options)).dependencies, []);
  await completeTask("first-task", f.options);
  assert.equal((await inspectTask("second-task", f.options)).computedStatus, "pending");
  assert.deepEqual((await removeTaskDependency("second-task", "first-task", f.options)).dependencies, []);
});

test("Task 只允许 pending 到 completed 或 cancelled，关闭后不可修改", async () => {
  const f = await fixture();
  await createTask({ taskId: "done-task", projectId: "test-project", title: "完成" }, f.options);
  await createTask({ taskId: "cancel-task", projectId: "test-project", title: "取消" }, f.options);
  f.clock.value = "2026-07-21T03:00:00.000Z";
  const done = await completeTask("done-task", f.options);
  const cancelled = await cancelTask("cancel-task", f.options);
  assert.equal(done.completedAt, f.clock.value);
  assert.equal(cancelled.cancelledAt, f.clock.value);
  await assert.rejects(() => updateTask("done-task", { title: "禁止" }, f.options), /不能继续修改/);
  await assert.rejects(() => assignTask("cancel-task", "test-role-worker", f.options), /不能继续修改/);
  const completedProject = await completeProject("test-project", f.options);
  assert.equal(completedProject.status, "completed");
  await assert.rejects(() => createTask({ taskId: "late-task", projectId: "test-project", title: "迟到" }, f.options), /已完成/);
});

test("归档 Project 的 Task 只读，列表按 taskId 稳定且并发创建不丢失", async () => {
  const f = await fixture();
  await Promise.all([
    createTask({ taskId: "z-task", projectId: "test-project", title: "Z" }, f.options),
    createTask({ taskId: "a-task", projectId: "test-project", title: "A", source: "manager" }, f.options)
  ]);
  assert.deepEqual((await listTasks("test-project", f.options)).map((task) => task.taskId), ["a-task", "z-task"]);
  await archiveProject("test-project", f.options);
  await assert.rejects(() => updateTask("a-task", { title: "禁止" }, f.options), /归档/);
  await assert.rejects(() => createTask({ taskId: "new-task", projectId: "test-project", title: "禁止" }, f.options), /归档/);
});

test("同 Project 并发依赖更新被串行化且不会留下循环或部分修改", async () => {
  const f = await fixture();
  await createTask({ taskId: "left-task", projectId: "test-project", title: "左" }, f.options);
  await createTask({ taskId: "right-task", projectId: "test-project", title: "右" }, f.options);
  const results = await Promise.allSettled([
    addTaskDependency("left-task", "right-task", f.options),
    addTaskDependency("right-task", "left-task", f.options)
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const left = await inspectTask("left-task", f.options);
  const right = await inspectTask("right-task", f.options);
  assert.notDeepEqual([left.dependencies, right.dependencies], [["right-task"], ["left-task"]]);
});

test("createTask 只允许分配给快照内且当前 registered 的 Instance", async () => {
  const f = await fixture();
  const registered = await createTask({
    taskId: "registered-task",
    projectId: "test-project",
    title: "registered",
    assignedInstanceId: "test-role-worker"
  }, f.options);
  assert.equal(registered.assignedInstanceId, "test-role-worker");

  const unassigned = await createTask({
    taskId: "unassigned-task",
    projectId: "test-project",
    title: "unassigned",
    assignedInstanceId: null
  }, f.options);
  assert.equal(unassigned.assignedInstanceId, null);

  await setInstanceStatus(f, "test-role-worker", "missing", ["missing"]);
  await assertRejectedWithoutStateChanges(f, () => createTask({
    taskId: "missing-task", projectId: "test-project", title: "missing",
    assignedInstanceId: "test-role-worker"
  }, f.options), /当前为 missing/);

  await setInstanceStatus(f, "test-role-worker", "drifted", ["workspace"]);
  await assertRejectedWithoutStateChanges(f, () => createTask({
    taskId: "drifted-task", projectId: "test-project", title: "drifted",
    assignedInstanceId: "test-role-worker"
  }, f.options), /当前为 drifted/);

  await deleteInstance(f, "test-role-worker");
  await assertRejectedWithoutStateChanges(f, () => createTask({
    taskId: "deleted-instance-task", projectId: "test-project", title: "deleted",
    assignedInstanceId: "test-role-worker"
  }, f.options), /当前不存在/);

  await assertRejectedWithoutStateChanges(f, () => createTask({
    taskId: "outside-task", projectId: "test-project", title: "outside",
    assignedInstanceId: "test-role-outsider"
  }, f.options), /必须属于 Project Team 快照/);
  assert.equal(f.getOpenClawCalls(), 0);
});

test("assignTask 校验当前 Instance 状态，但 unassign 不受旧分配状态影响", async () => {
  const f = await fixture();
  await createTask({
    taskId: "assigned-task", projectId: "test-project", title: "assigned",
    assignedInstanceId: "test-role-worker"
  }, f.options);
  await createTask({ taskId: "target-task", projectId: "test-project", title: "target" }, f.options);

  await setInstanceStatus(f, "test-role-worker", "missing", ["missing"]);
  assert.equal((await inspectTask("assigned-task", f.options)).assignedInstanceId, "test-role-worker");
  await assertRejectedWithoutStateChanges(
    f,
    () => assignTask("target-task", "test-role-worker", f.options),
    /当前为 missing/
  );
  const unassigned = await assignTask("assigned-task", null, f.options);
  assert.equal(unassigned.assignedInstanceId, null);

  await setInstanceStatus(f, "test-role-worker", "drifted", ["agent-dir"]);
  await assertRejectedWithoutStateChanges(
    f,
    () => assignTask("target-task", "test-role-worker", f.options),
    /当前为 drifted/
  );

  await deleteInstance(f, "test-role-worker");
  await assertRejectedWithoutStateChanges(
    f,
    () => assignTask("target-task", "test-role-worker", f.options),
    /当前不存在/
  );
  await assertRejectedWithoutStateChanges(
    f,
    () => assignTask("target-task", "test-role-outsider", f.options),
    /必须属于 Project Team 快照/
  );

  const managerAssigned = await assignTask("target-task", "test-role-manager", f.options);
  assert.equal(managerAssigned.assignedInstanceId, "test-role-manager");
  assert.equal(f.getOpenClawCalls(), 0);
});
