const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { projectPath } = require("./helpers");
const {
  createEmptyProjectState, getProjectState, listProjectStates,
  readProjectState, updateProjectState, writeProjectState
} = require(projectPath("src/core/projects/state.js"));

function temp() { return fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-project-state-")); }
function record(projectId = "test-project", overrides = {}) {
  const now = "2026-07-21T00:00:00.000Z";
  return {
    projectId, name: "测试项目", description: "", teamId: "test-team",
    teamSnapshot: {
      managerInstanceId: "test-role-manager",
      memberInstanceIds: ["test-role-worker", "test-role-manager"],
      executionMode: "confirm", maxConcurrency: 2, capturedAt: now, sourceTeamUpdatedAt: now
    },
    status: "draft", executionMode: "confirm", maxConcurrency: 2,
    createdAt: now, updatedAt: now, completedAt: null, archivedAt: null, ...overrides
  };
}

test("Project State 初始化、0600 原子写入、深拷贝和稳定排序", async () => {
  const statePath = path.join(temp(), "projects", "state.json");
  assert.deepEqual(await readProjectState(statePath), createEmptyProjectState());
  await Promise.all(["z-project", "a-project"].map((projectId) => updateProjectState(statePath, async (state) => {
    await new Promise((resolve) => setTimeout(resolve, 3));
    state.projects[projectId] = record(projectId);
    return state;
  })));
  const state = await readProjectState(statePath);
  assert.deepEqual(listProjectStates(state).map((item) => item.projectId), ["a-project", "z-project"]);
  assert.equal(fs.statSync(statePath).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(path.dirname(statePath)), ["state.json"]);
  const copy = getProjectState(state, "a-project");
  copy.teamSnapshot.memberInstanceIds.push("test-role-other");
  assert.equal(getProjectState(await readProjectState(statePath), "a-project").teamSnapshot.memberInstanceIds.length, 2);
});

test("Project State 拒绝损坏 JSON 和 schema，且不覆盖原文件", async () => {
  const statePath = path.join(temp(), "state.json");
  fs.writeFileSync(statePath, "{broken", "utf8");
  await assert.rejects(() => readProjectState(statePath), /不是有效 JSON/);
  assert.equal(fs.readFileSync(statePath, "utf8"), "{broken");
  fs.writeFileSync(statePath, JSON.stringify({ schemaVersion: 2, projects: {} }), "utf8");
  await assert.rejects(() => readProjectState(statePath), /schemaVersion 必须为 1/);
});

test("Project State 只持久化安全白名单并严格校验生命周期字段", async () => {
  const statePath = path.join(temp(), "state.json");
  await writeProjectState(statePath, { schemaVersion: 1, projects: {
    "test-project": record("test-project", {
      workspacePath: "/forbidden", agentDir: "/forbidden", apiKey: "sk-secret", token: "secret",
      teamSnapshot: { ...record().teamSnapshot, roleId: "secret", health: { status: "ready" } }
    })
  }});
  assert.doesNotMatch(fs.readFileSync(statePath, "utf8"), /workspacePath|agentDir|apiKey|token|roleId|health|secret/);
  await assert.rejects(() => writeProjectState(path.join(temp(), "bad.json"), {
    schemaVersion: 1, projects: { "test-project": record("test-project", { status: "completed" }) }
  }), /completedAt 必须/);
  await assert.rejects(() => writeProjectState(path.join(temp(), "main.json"), {
    schemaVersion: 1, projects: { main: record("main") }
  }), /受保护名称/);
});
