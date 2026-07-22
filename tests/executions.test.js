const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { projectPath } = require("./helpers");
const { writeInstanceState, readInstanceState } = require(projectPath("src/core/agent-instances/state.js"));
const {
  inspectExecution, listExecutions, reconcileExecutions, retryExecution, runTask
} = require(projectPath("src/core/executions/manager.js"));
const {
  acquireExecutionLease, clearStaleExecutionLease, readExecutionLease, releaseExecutionLease
} = require(projectPath("src/core/executions/locks.js"));
const {
  readExecutionState, updateExecutionState, writeExecutionState
} = require(projectPath("src/core/executions/state.js"));
const {
  activateProject, archiveProject, completeProject, createProject, syncProjectTeam
} = require(projectPath("src/core/projects/manager.js"));
const { updateProjectState } = require(projectPath("src/core/projects/state.js"));
const { createTeam, updateTeam } = require(projectPath("src/core/teams/manager.js"));
const {
  addTaskDependency, assignTask, cancelTask, completeTask, createTask, inspectTask,
  removeTaskDependency, setTaskCritical, updateTask
} = require(projectPath("src/core/tasks/manager.js"));
const { updateTaskState } = require(projectPath("src/core/tasks/state.js"));
const {
  formatExecutionInspect, formatExecutionList, formatExecutionResult
} = require(projectPath("src/cli/presenters/executionsPresenter.js"));

function instance(root, id, overrides = {}) {
  return {
    instanceId: id,
    roleId: "test-role",
    roleVersion: "1.0.0",
    roleAgentId: id.split("-").pop(),
    workspacePath: path.join(root, "workspaces", id),
    agentDir: path.join(root, "agents", id),
    status: "registered",
    registeredAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
    lastReconciledAt: "2026-07-21T00:00:00.000Z",
    drift: [],
    ...overrides
  };
}

function runRecord(overrides = {}) {
  const timestamp = "2026-07-21T02:00:00.000Z";
  return {
    runId: "run-00000000-0000-4000-8000-000000000099",
    taskId: "test-task",
    projectId: "test-project",
    teamId: "test-team",
    assignedInstanceId: "test-role-worker",
    status: "running",
    attempt: 1,
    trigger: "user",
    inputSummary: "安全摘要",
    inputHash: "a".repeat(64),
    outputSummary: null,
    errorSummary: null,
    openClawSessionKey: "agent:test-role-worker:toolbox-run",
    openClawSessionId: null,
    openClawTaskId: null,
    openClawRunId: null,
    timeoutMs: 600000,
    taskSyncStatus: "none",
    createdAt: timestamp,
    startedAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    failedAt: null,
    cancelledAt: null,
    interruptedAt: null,
    ...overrides
  };
}

async function fixture(t, settings = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-executions-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const clock = { value: "2026-07-21T01:00:00.000Z" };
  let runCounter = 0;
  const calls = [];
  const results = [];
  const adapter = {
    async startAgentExecution(input, runtime = {}) {
      calls.push(JSON.parse(JSON.stringify(input)));
      if (runtime.onSpawn) await runtime.onSpawn({ pid: 12345 });
      return results.length ? results.shift() : {
        ok: true,
        outputSummary: "执行成功",
        openClawSessionId: "session-safe",
        openClawTaskId: "task-safe",
        openClawRunId: "remote-run-safe"
      };
    }
  };
  const options = {
    instanceStatePath: path.join(root, "state", "instances", "state.json"),
    teamStatePath: path.join(root, "state", "teams", "state.json"),
    projectStatePath: path.join(root, "state", "projects", "state.json"),
    taskStatePath: path.join(root, "state", "tasks", "state.json"),
    executionStatePath: path.join(root, "state", "executions", "state.json"),
    executionLeasePath: path.join(root, "state", "executions", "active.lock"),
    now: () => new Date(clock.value),
    createRunId: () => {
      runCounter += 1;
      return `run-00000000-0000-4000-8000-${String(runCounter).padStart(12, "0")}`;
    },
    openClawExecutionAdapter: adapter,
    ...settings
  };
  await writeInstanceState(options.instanceStatePath, {
    schemaVersion: 1,
    instances: {
      "test-role-manager": instance(root, "test-role-manager"),
      "test-role-worker": instance(root, "test-role-worker"),
      "test-role-other": instance(root, "test-role-other")
    }
  });
  await createTeam("test-team", {
    name: "测试团队",
    managerInstanceId: "test-role-manager",
    memberInstanceIds: ["test-role-manager", "test-role-worker"]
  }, options);
  await createProject({
    projectId: "test-project",
    name: "测试项目",
    description: "API_KEY=sk-1234567890 secret=very-secret",
    teamId: "test-team",
    executionMode: settings.executionMode || "confirm"
  }, options);
  if (settings.activate !== false) await activateProject("test-project", options);
  await createTask({
    taskId: "test-task",
    projectId: "test-project",
    title: "测试执行",
    description: "token=private-token",
    assignedInstanceId: "test-role-worker",
    retryPolicy: { maxRetries: 1, retryDelayMs: 1000 }
  }, options);
  const roleStatePath = path.join(root, "state", "roles", "state.json");
  const sentinelPath = path.join(root, "workspaces", "sentinel.txt");
  fs.mkdirSync(path.dirname(roleStatePath), { recursive: true });
  fs.mkdirSync(path.dirname(sentinelPath), { recursive: true });
  fs.writeFileSync(roleStatePath, "{\"schemaVersion\":1,\"roles\":{}}\n");
  fs.writeFileSync(sentinelPath, "workspace-safe\n");
  return { root, clock, options, calls, results, roleStatePath, sentinelPath };
}

function bytes(paths) {
  return Object.fromEntries(paths.map((file) => [file, fs.readFileSync(file)]));
}

test("run-task 使用 Mock Adapter 完成 Run，并只同步 Task 状态", async (t) => {
  const f = await fixture(t, { executionMode: "auto" });
  const protectedPaths = [
    f.options.instanceStatePath, f.options.teamStatePath, f.options.projectStatePath,
    f.roleStatePath, f.sentinelPath
  ];
  const before = bytes(protectedPaths);
  const result = await runTask("test-task", {
    confirm: true,
    instructions: "Bearer abc.def.ghi secret=do-not-store",
    timeoutMs: 5000
  }, f.options);

  assert.equal(result.run.status, "completed");
  assert.equal(result.run.taskSyncStatus, "applied");
  assert.equal(result.executionMode, "auto");
  assert.equal(result.autoSchedulingEnabled, false);
  assert.equal(result.run.attempt, 1);
  assert.equal(result.run.trigger, "user");
  assert.equal(result.run.timeoutMs, 5000);
  assert.match(result.run.openClawSessionKey, /^agent:test-role-worker:toolbox-run-/);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(Object.keys(f.calls[0]).sort(), ["agentId", "prompt", "runId", "sessionKey", "timeoutMs"]);
  assert.doesNotMatch(JSON.stringify(f.calls[0]), /workspacePath|agentDir|very-secret|private-token|do-not-store|abc\.def/);
  assert.doesNotMatch(JSON.stringify(result.run), /very-secret|private-token|do-not-store|workspacePath|agentDir/);
  assert.equal((await inspectTask("test-task", f.options)).status, "completed");
  const taskView = await inspectTask("test-task", f.options);
  assert.equal(taskView.executionStatus, "completed");
  assert.equal(taskView.lastRunId, result.run.runId);
  assert.equal(taskView.currentRunId, null);
  assert.equal(taskView.attemptCount, 1);
  assert.deepEqual(bytes(protectedPaths), before);
  assert.equal(fs.existsSync(f.options.executionLeasePath), false);
  assert.equal((fs.statSync(f.options.executionStatePath).mode & 0o777), 0o600);
  assert.deepEqual((await listExecutions({ status: "completed" }, f.options)).map((run) => run.runId), [result.run.runId]);
  assert.equal((await inspectExecution(result.run.runId, f.options)).openClawRunId, "remote-run-safe");
});

test("createSessionKey 默认行为兼容，并允许首次执行注入安全固定生成器", async (t) => {
  const defaults = await fixture(t);
  const defaultResult = await runTask("test-task", { confirm: true }, defaults.options);
  assert.equal(
    defaultResult.run.openClawSessionKey,
    `agent:test-role-worker:toolbox-${defaultResult.run.runId}`
  );

  const received = [];
  const injected = await fixture(t, {
    createSessionKey(metadata) {
      received.push(metadata);
      return "fixed-safe-session-key";
    }
  });
  const result = await runTask("test-task", { confirm: true }, injected.options);
  assert.equal(received.length, 1);
  assert.deepEqual(received[0], {
    runId: result.run.runId,
    taskId: "test-task",
    projectId: "test-project",
    assignedInstanceId: "test-role-worker",
    attempt: 1,
    trigger: "user"
  });
  assert.deepEqual(Object.keys(received[0]).sort(), [
    "assignedInstanceId", "attempt", "projectId", "runId", "taskId", "trigger"
  ]);
  assert.doesNotMatch(
    JSON.stringify(received[0]),
    /prompt|inputSummary|outputSummary|errorSummary|apiKey|token|secret|workspacePath|agentDir|env/i
  );
  assert.equal(injected.calls[0].sessionKey, "fixed-safe-session-key");
  assert.equal(result.run.openClawSessionKey, "fixed-safe-session-key");
});

test("retry 使用统一 createSessionKey 生成新值且不修改旧 Run", async (t) => {
  const generated = [];
  const f = await fixture(t, {
    createSessionKey(metadata) {
      const value = `fixed-session-attempt-${metadata.attempt}`;
      generated.push({ metadata, value });
      return value;
    }
  });
  f.results.push({ ok: false, interrupted: false, errorSummary: "执行失败" });
  const first = await runTask("test-task", { confirm: true }, f.options);
  const oldRunBefore = await inspectExecution(first.run.runId, f.options);
  f.clock.value = "2026-07-21T01:00:01.000Z";
  const retried = await retryExecution(first.run.runId, { confirm: true }, f.options);

  assert.equal(generated.length, 2);
  assert.equal(generated[0].metadata.trigger, "user");
  assert.equal(generated[1].metadata.trigger, "retry");
  assert.equal(generated[1].metadata.attempt, 2);
  assert.notEqual(retried.run.runId, first.run.runId);
  assert.equal(first.run.openClawSessionKey, "fixed-session-attempt-1");
  assert.equal(retried.run.openClawSessionKey, "fixed-session-attempt-2");
  assert.notEqual(retried.run.openClawSessionKey, first.run.openClawSessionKey);
  assert.deepEqual(await inspectExecution(first.run.runId, f.options), oldRunBefore);
});

test("list、inspect 和 reconcile 不生成 Session Key", async (t) => {
  let calls = 0;
  const f = await fixture(t, {
    createSessionKey() {
      calls += 1;
      return "only-for-new-runs";
    }
  });
  assert.deepEqual(await listExecutions({}, f.options), []);
  await assert.rejects(
    () => inspectExecution("run-00000000-0000-4000-8000-000000000001", f.options),
    /未找到 Execution Run/
  );
  await reconcileExecutions(f.options);
  assert.equal(calls, 0);
  await runTask("test-task", { confirm: true }, f.options);
  assert.equal(calls, 1);
});

test("非法 createSessionKey 在 Adapter 和 State 写入前被拒绝", async (t) => {
  const invalidValues = [
    ["空字符串", "", /非空 Session Key/],
    ["非字符串", 123, /必须返回字符串/],
    ["超长值", "x".repeat(301), /不能超过 300/],
    ["换行", "unsafe\nsession", /换行或控制字符/],
    ["控制字符", "unsafe\u0000session", /换行或控制字符/],
    ["Unicode 换行", "unsafe\u2028session", /换行或控制字符/]
  ];
  for (const [name, value, pattern] of invalidValues) {
    const f = await fixture(t, { createSessionKey: () => value });
    const taskBefore = fs.readFileSync(f.options.taskStatePath);
    await assert.rejects(
      () => runTask("test-task", { confirm: true }, f.options),
      (error) => {
        assert.match(error.message, pattern, name);
        assert.doesNotMatch(error.message, /unsafe|xxx/);
        return true;
      }
    );
    assert.equal(f.calls.length, 0);
    assert.deepEqual(await readExecutionState(f.options.executionStatePath), {
      schemaVersion: 1, runs: {}
    });
    assert.deepEqual(fs.readFileSync(f.options.taskStatePath), taskBefore);
    assert.equal(fs.existsSync(f.options.executionLeasePath), false);
  }

  const nonFunction = await fixture(t);
  nonFunction.options.createSessionKey = "not-a-function";
  await assert.rejects(
    () => runTask("test-task", { confirm: true }, nonFunction.options),
    /createSessionKey 必须是函数/
  );
  assert.equal(nonFunction.calls.length, 0);
});

test("Execution Presenter 和列表不输出完整 Session Key", () => {
  const run = runRecord({ openClawSessionKey: "fixed-private-session-key" });
  const outputs = [
    formatExecutionList([run]),
    formatExecutionInspect(run),
    formatExecutionResult({ run, executionMode: "confirm" }, "运行")
  ].join("\n");
  assert.doesNotMatch(outputs, /fixed-private-session-key/);
  assert.doesNotMatch(outputs, /openClawSessionKey/);
});

test("依赖 Prompt 只使用 completed Run 的非空安全摘要并保留真实 Task status", async (t) => {
  const f = await fixture(t);
  await createTask({
    taskId: "dependency-task",
    projectId: "test-project",
    title: "前置任务",
    assignedInstanceId: "test-role-worker"
  }, f.options);
  await completeTask("dependency-task", f.options);
  await addTaskDependency("test-task", "dependency-task", f.options);

  const failed = runRecord({
    runId: "run-00000000-0000-4000-8000-000000000090",
    taskId: "dependency-task",
    status: "failed",
    attempt: 1,
    errorSummary: "failed secret=must-not-enter-prompt",
    failedAt: "2026-07-21T02:00:01.000Z"
  });
  const interrupted = runRecord({
    runId: "run-00000000-0000-4000-8000-000000000091",
    taskId: "dependency-task",
    status: "interrupted",
    attempt: 2,
    errorSummary: "interrupted token=must-not-enter-prompt",
    interruptedAt: "2026-07-21T02:00:02.000Z"
  });
  await writeExecutionState(f.options.executionStatePath, {
    schemaVersion: 1,
    runs: { [failed.runId]: failed, [interrupted.runId]: interrupted }
  });
  f.results.push({ ok: false, interrupted: false, errorSummary: "目标任务 Mock 失败" });
  await runTask("test-task", { confirm: true }, f.options);
  const withoutSummaryPrompt = f.calls[0].prompt;
  assert.match(withoutSummaryPrompt, /- dependency-task \| 前置任务 \| completed/);
  assert.doesNotMatch(withoutSummaryPrompt, /无输出摘要|must-not-enter-prompt/);
  assert.doesNotMatch(withoutSummaryPrompt, /dependency-task \| 前置任务 \| completed\n\s+结果摘要：/);

  const completed = runRecord({
    runId: "run-00000000-0000-4000-8000-000000000092",
    taskId: "dependency-task",
    status: "completed",
    attempt: 3,
    outputSummary: "已完成依赖分析",
    taskSyncStatus: "applied",
    completedAt: "2026-07-21T02:00:03.000Z"
  });
  await updateExecutionState(f.options.executionStatePath, (state) => {
    state.runs[completed.runId] = completed;
    return state;
  });
  await runTask("test-task", { confirm: true }, f.options);
  const withSummaryPrompt = f.calls[1].prompt;
  assert.match(withSummaryPrompt, /- dependency-task \| 前置任务 \| completed/);
  assert.match(withSummaryPrompt, /结果摘要：已完成依赖分析/);
  assert.doesNotMatch(withSummaryPrompt, /must-not-enter-prompt/);
});

test("执行失败或中断保留 pending Task，显式 retry 创建新 Run 并遵守次数和延迟", async (t) => {
  const f = await fixture(t);
  f.results.push({ ok: false, interrupted: false, errorSummary: "远端执行失败" });
  const failed = await runTask("test-task", { confirm: true }, f.options);
  assert.equal(failed.run.status, "failed");
  assert.equal((await inspectTask("test-task", f.options)).status, "pending");
  await assert.rejects(() => retryExecution(failed.run.runId, { confirm: true }, f.options), /retryDelayMs/);

  f.clock.value = "2026-07-21T01:00:02.000Z";
  f.results.push({ ok: true, outputSummary: "重试成功" });
  const retried = await retryExecution(failed.run.runId, { confirm: true }, f.options);
  assert.equal(retried.run.status, "completed");
  assert.equal(retried.run.trigger, "retry");
  assert.equal(retried.run.attempt, 2);
  assert.equal(retried.retryOfRunId, failed.run.runId);
  assert.equal(f.calls.length, 2);
  assert.equal((await inspectExecution(failed.run.runId, f.options)).status, "failed");
  await assert.rejects(() => retryExecution(failed.run.runId, { confirm: true }, f.options), /最大执行次数/);

  const interruptedFixture = await fixture(t);
  interruptedFixture.results.push({ ok: false, interrupted: true, errorSummary: "本地进程已中断" });
  const interrupted = await runTask("test-task", { confirm: true }, interruptedFixture.options);
  assert.equal(interrupted.run.status, "interrupted");
  assert.equal(interrupted.run.interruptedAt, interruptedFixture.clock.value);
  assert.equal((await inspectTask("test-task", interruptedFixture.options)).status, "pending");
});

test("执行前校验 Project、依赖、分配、Instance 健康、关键确认和 active Run", async (t) => {
  const noConfirm = await fixture(t);
  await assert.rejects(() => runTask("test-task", {}, noConfirm.options), /--confirm/);
  assert.equal(noConfirm.calls.length, 0);

  const critical = await fixture(t);
  await setTaskCritical("test-task", { critical: true, reason: "高风险", source: "user" }, critical.options);
  await assert.rejects(() => runTask("test-task", { confirm: true }, critical.options), /confirm-critical/);
  assert.equal(critical.calls.length, 0);
  assert.equal((await runTask("test-task", { confirm: true, confirmCritical: true }, critical.options)).run.status, "completed");

  const missing = await fixture(t);
  const instanceState = await readInstanceState(missing.options.instanceStatePath);
  instanceState.instances["test-role-worker"].status = "missing";
  instanceState.instances["test-role-worker"].drift = ["missing"];
  await writeInstanceState(missing.options.instanceStatePath, instanceState);
  await assert.rejects(() => runTask("test-task", { confirm: true }, missing.options), /registered.*missing/);
  assert.equal(missing.calls.length, 0);

  const blocked = await fixture(t);
  await createTask({ taskId: "first-task", projectId: "test-project", title: "前置" }, blocked.options);
  await createTask({
    taskId: "blocked-task", projectId: "test-project", title: "被阻塞",
    assignedInstanceId: "test-role-worker", dependencies: ["first-task"]
  }, blocked.options);
  await assert.rejects(() => runTask("blocked-task", { confirm: true }, blocked.options), /依赖阻塞/);

  const active = await fixture(t);
  await writeExecutionState(active.options.executionStatePath, {
    schemaVersion: 1,
    runs: { [runRecord().runId]: runRecord() }
  });
  await assert.rejects(() => runTask("test-task", { confirm: true }, active.options), /active Execution Run/);
  assert.equal(active.calls.length, 0);
});

test("run-task 完整拒绝无效 Project、Task、分配和快照健康，验证失败不写 Run", async (t) => {
  const unknownTask = await fixture(t);
  await assert.rejects(() => runTask("unknown-task", { confirm: true }, unknownTask.options), /未找到 Task/);

  const missingProject = await fixture(t);
  await updateProjectState(missingProject.options.projectStatePath, (state) => {
    delete state.projects["test-project"];
    return state;
  });
  await assert.rejects(() => runTask("test-task", { confirm: true }, missingProject.options), /Project 不存在/);

  const draft = await fixture(t, { activate: false });
  await assert.rejects(() => runTask("test-task", { confirm: true }, draft.options), /只有 active Project/);

  const archived = await fixture(t);
  await archiveProject("test-project", archived.options);
  await assert.rejects(() => runTask("test-task", { confirm: true }, archived.options), /Project 已归档/);

  const completedTask = await fixture(t);
  await completeTask("test-task", completedTask.options);
  await assert.rejects(() => runTask("test-task", { confirm: true }, completedTask.options), /只有 pending Task/);

  const unassigned = await fixture(t);
  await assignTask("test-task", null, unassigned.options);
  await assert.rejects(() => runTask("test-task", { confirm: true }, unassigned.options), /尚未分配/);

  const outside = await fixture(t);
  await updateTaskState(outside.options.taskStatePath, (state) => {
    state.tasks["test-task"].assignedInstanceId = "test-role-other";
    return state;
  });
  await assert.rejects(() => runTask("test-task", { confirm: true }, outside.options), /不属于 Project Team 快照/);

  const drifted = await fixture(t);
  const driftedState = await readInstanceState(drifted.options.instanceStatePath);
  driftedState.instances["test-role-worker"].status = "drifted";
  driftedState.instances["test-role-worker"].drift = ["workspace"];
  await writeInstanceState(drifted.options.instanceStatePath, driftedState);
  await assert.rejects(() => runTask("test-task", { confirm: true }, drifted.options), /registered.*drifted/);

  const invalidSnapshot = await fixture(t);
  const invalidState = await readInstanceState(invalidSnapshot.options.instanceStatePath);
  delete invalidState.instances["test-role-manager"];
  await writeInstanceState(invalidSnapshot.options.instanceStatePath, invalidState);
  await assert.rejects(() => runTask("test-task", { confirm: true }, invalidSnapshot.options), /快照健康状态.*invalid/);

  const globalActive = await fixture(t);
  const otherRun = runRecord({ taskId: "other-task" });
  await writeExecutionState(globalActive.options.executionStatePath, {
    schemaVersion: 1, runs: { [otherRun.runId]: otherRun }
  });
  await assert.rejects(() => runTask("test-task", { confirm: true }, globalActive.options), /其他前台 Execution/);

  const outOfSync = await fixture(t);
  await updateTeam("test-team", { maxConcurrency: 3 }, outOfSync.options);
  assert.equal((await runTask("test-task", { confirm: true }, outOfSync.options)).run.status, "completed");

  for (const item of [
    unknownTask, missingProject, draft, archived, completedTask, unassigned,
    outside, drifted, invalidSnapshot
  ]) {
    assert.equal(item.calls.length, 0);
    assert.deepEqual(await readExecutionState(item.options.executionStatePath), { schemaVersion: 1, runs: {} });
  }
  assert.equal(globalActive.calls.length, 0);
  assert.deepEqual(
    Object.keys((await readExecutionState(globalActive.options.executionStatePath)).runs),
    [otherRun.runId]
  );
});

test("active Run 阻止 Task 修改、Project 完成归档同步和新建 Task，且不产生部分写入", async (t) => {
  const f = await fixture(t);
  const active = runRecord();
  await writeExecutionState(f.options.executionStatePath, { schemaVersion: 1, runs: { [active.runId]: active } });
  const protectedPaths = [f.options.taskStatePath, f.options.projectStatePath, f.options.teamStatePath];
  const before = bytes(protectedPaths);
  const operations = [
    () => updateTask("test-task", { title: "禁止" }, f.options),
    () => assignTask("test-task", null, f.options),
    () => setTaskCritical("test-task", { critical: true, reason: "禁止", source: "user" }, f.options),
    () => addTaskDependency("test-task", "other-task", f.options),
    () => removeTaskDependency("test-task", "other-task", f.options),
    () => completeTask("test-task", f.options),
    () => cancelTask("test-task", f.options),
    () => createTask({ taskId: "late-task", projectId: "test-project", title: "禁止" }, f.options),
    () => completeProject("test-project", f.options),
    () => archiveProject("test-project", f.options),
    () => syncProjectTeam("test-project", { confirm: true }, f.options)
  ];
  for (const operation of operations) await assert.rejects(operation, /active Execution Run/);
  assert.deepEqual(bytes(protectedPaths), before);
});

test("reconcile 将遗留 active Run 标记 interrupted，并重试 completed Run 的 Task 同步", async (t) => {
  const f = await fixture(t);
  await createTask({
    taskId: "sync-task", projectId: "test-project", title: "待同步",
    assignedInstanceId: "test-role-worker"
  }, f.options);
  const active = runRecord();
  const completed = runRecord({
    runId: "run-00000000-0000-4000-8000-000000000100",
    taskId: "sync-task",
    status: "completed",
    outputSummary: "已完成",
    taskSyncStatus: "pending",
    completedAt: "2026-07-21T02:00:01.000Z"
  });
  await writeExecutionState(f.options.executionStatePath, {
    schemaVersion: 1,
    runs: { [active.runId]: active, [completed.runId]: completed }
  });
  await fsp.mkdir(path.dirname(f.options.executionLeasePath), { recursive: true });
  await fsp.writeFile(f.options.executionLeasePath, JSON.stringify({
    runId: active.runId, pid: 99999999, createdAt: active.createdAt
  }) + "\n", { mode: 0o600 });
  f.options.isProcessAlive = () => false;
  f.clock.value = "2026-07-21T03:00:00.000Z";
  const result = await reconcileExecutions(f.options);
  assert.equal(result.staleLeaseRemoved, true);
  assert.ok(result.interruptedRuns.includes(active.runId));
  assert.deepEqual(result.taskSyncResults, [{ runId: completed.runId, status: "applied" }]);
  assert.equal((await inspectExecution(active.runId, f.options)).status, "interrupted");
  assert.equal((await inspectExecution(completed.runId, f.options)).taskSyncStatus, "applied");
  assert.equal((await inspectTask("sync-task", f.options)).status, "completed");
  assert.equal((await inspectTask("test-task", f.options)).status, "pending");
  assert.equal(f.calls.length, 0);
  assert.equal(fs.existsSync(f.options.executionLeasePath), false);
});

test("跨进程租约使用 O_EXCL 拒绝并发，且仅持有者可释放", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-execution-lease-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const leasePath = path.join(root, "active.lock");
  const first = {
    runId: "run-00000000-0000-4000-8000-000000000201",
    pid: process.pid,
    createdAt: "2026-07-21T00:00:00.000Z",
    prompt: "不得保存",
    sessionKey: "不得保存",
    token: "不得保存"
  };
  await acquireExecutionLease(leasePath, first);
  const expected = { runId: first.runId, pid: first.pid, createdAt: first.createdAt };
  assert.deepEqual(await readExecutionLease(leasePath), expected);
  assert.deepEqual(JSON.parse(fs.readFileSync(leasePath, "utf8")), expected);
  assert.deepEqual(Object.keys(expected).sort(), ["createdAt", "pid", "runId"]);
  assert.equal(fs.statSync(leasePath).mode & 0o777, 0o600);
  assert.doesNotMatch(fs.readFileSync(leasePath, "utf8"), /acquiredAt|prompt|sessionKey|token|不得保存/);
  const secondRunId = "run-00000000-0000-4000-8000-000000000202";
  await assert.rejects(() => acquireExecutionLease(leasePath, {
    ...expected, runId: secondRunId
  }), /全局串行/);
  assert.equal(await releaseExecutionLease(leasePath, secondRunId), false);
  assert.equal(fs.existsSync(leasePath), true);
  assert.deepEqual(await clearStaleExecutionLease(leasePath, {
    isProcessAlive: () => true,
    maxAgeMs: 60 * 60 * 1000,
    now: () => new Date("2026-07-21T00:30:00.000Z")
  }), {
    active: true, removed: false, lease: expected
  });
  assert.equal(await releaseExecutionLease(leasePath, first.runId), true);
  assert.equal(fs.existsSync(leasePath), false);
});

test("租约 createdAt 决定过期边界，且非法租约明确报错并保留原文件", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-execution-lease-age-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const now = () => new Date("2026-07-21T01:00:00.000Z");
  const base = {
    runId: "run-00000000-0000-4000-8000-000000000203",
    pid: process.pid,
    createdAt: "2026-07-21T00:59:59.001Z"
  };

  const currentPath = path.join(root, "current.lock");
  await acquireExecutionLease(currentPath, base);
  assert.deepEqual(await clearStaleExecutionLease(currentPath, {
    isProcessAlive: () => true, maxAgeMs: 1000, now
  }), { active: true, removed: false, lease: base });

  const boundaryPath = path.join(root, "boundary.lock");
  await acquireExecutionLease(boundaryPath, {
    ...base,
    runId: "run-00000000-0000-4000-8000-000000000204",
    createdAt: "2026-07-21T00:59:59.000Z"
  });
  assert.equal((await clearStaleExecutionLease(boundaryPath, {
    isProcessAlive: () => true, maxAgeMs: 1000, now
  })).removed, true);
  assert.equal(fs.existsSync(boundaryPath), false);

  const invalidCases = [
    ["missing-created-at", { runId: base.runId, pid: process.pid }, /createdAt/],
    ["non-string-created-at", { ...base, createdAt: 123 }, /createdAt/],
    ["invalid-created-at", { ...base, createdAt: "not-a-date" }, /createdAt/],
    ["date-only-created-at", { ...base, createdAt: "2026-07-21" }, /createdAt/],
    ["future-created-at", { ...base, createdAt: "2026-07-21T01:00:00.001Z" }, /位于未来/],
    ["invalid-pid", { ...base, pid: 0 }, /pid/],
    ["invalid-run-id", { ...base, runId: "main" }, /受保护/],
    ["acquired-at-only", {
      runId: base.runId, pid: process.pid, acquiredAt: base.createdAt
    }, /acquiredAt|createdAt/],
    ["unknown-field", { ...base, secret: "must-stay-on-disk" }, /未知字段/]
  ];
  for (const [name, value, pattern] of invalidCases) {
    const leasePath = path.join(root, name + ".lock");
    const content = JSON.stringify(value) + "\n";
    fs.writeFileSync(leasePath, content, { mode: 0o600 });
    await assert.rejects(() => clearStaleExecutionLease(leasePath, {
      isProcessAlive: () => true, maxAgeMs: 1000, now
    }), pattern, name);
    assert.equal(fs.readFileSync(leasePath, "utf8"), content, name);
  }

  const brokenPath = path.join(root, "broken.lock");
  fs.writeFileSync(brokenPath, "{broken", { mode: 0o600 });
  await assert.rejects(() => clearStaleExecutionLease(brokenPath, { now }), /不是有效 JSON/);
  assert.equal(fs.readFileSync(brokenPath, "utf8"), "{broken");
});

test("runTask 使用注入 now 写 createdAt，并在成功、失败或 Adapter 异常后清理租约", async (t) => {
  const captured = [];
  const leaseStore = {
    async acquire(leasePath, metadata) {
      captured.push({ ...metadata });
      return acquireExecutionLease(leasePath, metadata);
    },
    release: releaseExecutionLease,
    clearStale: clearStaleExecutionLease
  };
  const success = await fixture(t, { leaseStore });
  await runTask("test-task", { confirm: true }, success.options);
  assert.deepEqual(captured[0], {
    runId: "run-00000000-0000-4000-8000-000000000001",
    pid: process.pid,
    createdAt: success.clock.value
  });
  assert.equal(fs.existsSync(success.options.executionLeasePath), false);

  const failed = await fixture(t);
  failed.results.push({ ok: false, interrupted: false, errorSummary: "Mock 失败" });
  await runTask("test-task", { confirm: true }, failed.options);
  assert.equal(fs.existsSync(failed.options.executionLeasePath), false);

  const thrown = await fixture(t, {
    openClawExecutionAdapter: {
      async startAgentExecution() { throw new Error("Mock Adapter 异常"); }
    }
  });
  const result = await runTask("test-task", { confirm: true }, thrown.options);
  assert.equal(result.run.status, "failed");
  assert.equal(fs.existsSync(thrown.options.executionLeasePath), false);
});

test("reconcile 保留有效租约、清理过期租约并拒绝损坏租约", async (t) => {
  const active = await fixture(t);
  active.options.executionLeaseMaxAgeMs = 1000;
  active.options.isProcessAlive = () => true;
  active.clock.value = "2026-07-21T01:00:00.000Z";
  await acquireExecutionLease(active.options.executionLeasePath, {
    runId: "run-00000000-0000-4000-8000-000000000205",
    pid: process.pid,
    createdAt: "2026-07-21T00:59:59.001Z"
  });
  await assert.rejects(() => reconcileExecutions(active.options), /租约存活/);
  assert.equal(fs.existsSync(active.options.executionLeasePath), true);
  await releaseExecutionLease(
    active.options.executionLeasePath,
    "run-00000000-0000-4000-8000-000000000205"
  );

  const expired = await fixture(t);
  expired.options.executionLeaseMaxAgeMs = 1000;
  expired.options.isProcessAlive = () => true;
  expired.clock.value = "2026-07-21T01:00:00.000Z";
  await acquireExecutionLease(expired.options.executionLeasePath, {
    runId: "run-00000000-0000-4000-8000-000000000206",
    pid: process.pid,
    createdAt: "2026-07-21T00:59:59.000Z"
  });
  const result = await reconcileExecutions(expired.options);
  assert.equal(result.staleLeaseRemoved, true);
  assert.equal(fs.existsSync(expired.options.executionLeasePath), false);
  assert.equal(expired.calls.length, 0);

  const invalid = await fixture(t);
  const invalidContent = JSON.stringify({
    runId: "run-00000000-0000-4000-8000-000000000207",
    pid: process.pid
  }) + "\n";
  await fsp.mkdir(path.dirname(invalid.options.executionLeasePath), { recursive: true });
  await fsp.writeFile(invalid.options.executionLeasePath, invalidContent, { mode: 0o600 });
  await assert.rejects(() => reconcileExecutions(invalid.options), /createdAt/);
  assert.equal(fs.readFileSync(invalid.options.executionLeasePath, "utf8"), invalidContent);
  assert.equal(invalid.calls.length, 0);
});
