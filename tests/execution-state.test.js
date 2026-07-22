const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { projectPath } = require("./helpers");
const { assertRunId } = require(projectPath("src/core/executions/id.js"));
const {
  createEmptyExecutionState,
  getRunState,
  listRunStates,
  readExecutionState,
  updateExecutionState,
  writeExecutionState
} = require(projectPath("src/core/executions/state.js"));

function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-execution-state-")); }
function runId(suffix = "1") { return `run-00000000-0000-4000-8000-${suffix.padStart(12, "0")}`; }
function record(id = runId(), overrides = {}) {
  const now = "2026-07-21T00:00:00.000Z";
  return {
    runId: id, taskId: "test-task", projectId: "test-project", teamId: "test-team",
    assignedInstanceId: "test-role-worker", status: "starting", attempt: 1, trigger: "user",
    inputSummary: "执行测试", inputHash: "a".repeat(64), outputSummary: null, errorSummary: null,
    openClawSessionKey: `agent:test-role-worker:toolbox-${id}`,
    openClawSessionId: null, openClawTaskId: null, openClawRunId: null,
    timeoutMs: 600000, taskSyncStatus: "none", createdAt: now, startedAt: null,
    updatedAt: now, completedAt: null, failedAt: null, cancelledAt: null,
    interruptedAt: null, ...overrides
  };
}

test("Execution State 初始化、0600 原子写入、深拷贝与稳定排序", async () => {
  const statePath = path.join(temp(), "executions", "state.json");
  assert.deepEqual(await readExecutionState(statePath), createEmptyExecutionState());
  await Promise.all([runId("2"), runId("1")].map((id) => updateExecutionState(statePath, async (state) => {
    await new Promise((resolve) => setTimeout(resolve, 2));
    state.runs[id] = record(id);
  })));
  const state = await readExecutionState(statePath);
  assert.deepEqual(listRunStates(state).map((run) => run.runId), [runId("1"), runId("2")]);
  assert.equal(fs.statSync(statePath).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(path.dirname(statePath)), ["state.json"]);
  const copy = getRunState(state, runId("1"));
  copy.inputSummary = "changed";
  assert.equal(getRunState(await readExecutionState(statePath), runId("1")).inputSummary, "执行测试");
});

test("Execution State 损坏保护、字段白名单与敏感摘要脱敏", async () => {
  const root = temp();
  const statePath = path.join(root, "state.json");
  fs.writeFileSync(statePath, "{broken", "utf8");
  await assert.rejects(() => readExecutionState(statePath), /不是有效 JSON/);
  assert.equal(fs.readFileSync(statePath, "utf8"), "{broken");
  await writeExecutionState(statePath, { schemaVersion: 1, runs: {
    [runId()]: record(runId(), {
      inputSummary: "apiKey=sk-1234567890 token=secret-token",
      openClawSessionId: "secret=session-secret",
      workspacePath: "/forbidden", agentDir: "/forbidden", rawOutput: "secret"
    })
  }});
  const content = fs.readFileSync(statePath, "utf8");
  assert.doesNotMatch(content, /sk-1234567890|secret-token|workspacePath|agentDir|rawOutput/);
  assert.match(content, /REDACTED/);
  await fs.promises.writeFile(statePath, JSON.stringify({ schemaVersion: 2, runs: {} }));
  await assert.rejects(() => readExecutionState(statePath), /schemaVersion/);
  assert.equal(JSON.parse(fs.readFileSync(statePath, "utf8")).schemaVersion, 2);
});

test("Execution State 拒绝非法 runId、状态和时间组合", async () => {
  assert.throws(() => assertRunId("main"), /受保护/);
  assert.throws(() => assertRunId("bad-run"), /runId 无效/);
  await assert.rejects(() => writeExecutionState(path.join(temp(), "bad.json"), {
    schemaVersion: 1, runs: { [runId()]: record(runId(), { status: "queued" }) }
  }), /status 无效/);
  await assert.rejects(() => writeExecutionState(path.join(temp(), "bad-time.json"), {
    schemaVersion: 1, runs: { [runId()]: record(runId(), { status: "completed" }) }
  }), /completedAt/);
});
