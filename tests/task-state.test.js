const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { projectPath } = require("./helpers");
const {
  createEmptyTaskState, getTaskState, listTaskStates,
  readTaskState, updateTaskState, writeTaskState
} = require(projectPath("src/core/tasks/state.js"));

function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-task-state-")); }
function record(taskId = "test-task", overrides = {}) {
  const now = "2026-07-21T00:00:00.000Z";
  return {
    taskId, projectId: "test-project", title: "测试任务", description: "", source: "user",
    status: "pending", priority: "medium", critical: false, criticalReason: null,
    criticalSource: null, assignedInstanceId: null, dependencies: [], failurePolicy: "continue",
    retryPolicy: { maxRetries: 0, retryDelayMs: 0 }, createdAt: now, updatedAt: now,
    completedAt: null, cancelledAt: null, ...overrides
  };
}

test("Task State 初始化、0600 原子写入、并发更新与稳定排序", async () => {
  const statePath = path.join(temp(), "tasks", "state.json");
  assert.deepEqual(await readTaskState(statePath), createEmptyTaskState());
  await Promise.all(["z-task", "a-task"].map((taskId) => updateTaskState(statePath, async (state) => {
    await new Promise((resolve) => setTimeout(resolve, 3));
    state.tasks[taskId] = record(taskId);
  })));
  const state = await readTaskState(statePath);
  assert.deepEqual(listTaskStates(state).map((task) => task.taskId), ["a-task", "z-task"]);
  assert.equal(fs.statSync(statePath).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(path.dirname(statePath)), ["state.json"]);
  const copy = getTaskState(state, "a-task"); copy.retryPolicy.maxRetries = 9;
  assert.equal(getTaskState(await readTaskState(statePath), "a-task").retryPolicy.maxRetries, 0);
});

test("Task State 损坏保护、白名单和有限状态严格校验", async () => {
  const statePath = path.join(temp(), "state.json");
  fs.writeFileSync(statePath, "{broken", "utf8");
  await assert.rejects(() => readTaskState(statePath), /不是有效 JSON/);
  assert.equal(fs.readFileSync(statePath, "utf8"), "{broken");
  await writeTaskState(statePath, { schemaVersion: 1, tasks: {
    "test-task": record("test-task", { apiKey: "sk-secret", result: "secret", error: "secret", workspacePath: "/bad" })
  }});
  assert.doesNotMatch(fs.readFileSync(statePath, "utf8"), /apiKey|result|error|workspacePath|secret/);
  await assert.rejects(() => writeTaskState(path.join(temp(), "running.json"), {
    schemaVersion: 1, tasks: { "test-task": record("test-task", { status: "running" }) }
  }), /status 无效/);
  await assert.rejects(() => writeTaskState(path.join(temp(), "critical.json"), {
    schemaVersion: 1, tasks: { "test-task": record("test-task", { critical: true }) }
  }), /criticalReason/);
});
