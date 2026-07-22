const assert = require("node:assert/strict");
const test = require("node:test");
const { projectPath } = require("./helpers");
const { buildTaskExecutionPrompt, MAX_PROMPT_LENGTH } = require(projectPath("src/core/executions/promptBuilder.js"));

function input(overrides = {}) {
  return {
    project: {
      projectId: "test-project", name: "测试项目", description: "项目说明",
      executionMode: "confirm", maxConcurrency: 2,
      teamSnapshot: {
        managerInstanceId: "test-role-manager",
        memberInstanceIds: ["test-role-worker", "test-role-manager"]
      },
      workspacePath: "/forbidden", agentDir: "/forbidden"
    },
    task: {
      taskId: "test-task", title: "执行任务", description: "任务说明", priority: "high",
      critical: true, criticalReason: "影响发布", criticalSource: "user",
      failurePolicy: "continue", assignedInstanceId: "test-role-worker",
      apiKey: "sk-forbidden-value"
    },
    dependencySummaries: [
      { taskId: "z-task", title: "Z", status: "completed", outputSummary: "token=secret-value" },
      { taskId: "a-task", title: "A", status: "completed", outputSummary: "完成" }
    ],
    instructions: "请处理 apiKey=sk-1234567890",
    ...overrides
  };
}

test("Prompt Builder 输出稳定安全结构并排除路径、配置和凭据", () => {
  const first = buildTaskExecutionPrompt(input());
  const second = buildTaskExecutionPrompt(input());
  assert.deepEqual(first, second);
  assert.deepEqual(first.structuredContext.teamSnapshot.memberInstanceIds, ["test-role-manager", "test-role-worker"]);
  assert.deepEqual(first.structuredContext.completedDependencies.map((item) => item.taskId), ["a-task", "z-task"]);
  const serialized = JSON.stringify(first);
  assert.doesNotMatch(serialized, /workspacePath|agentDir|sk-1234567890|secret-value|sk-forbidden-value/);
  assert.match(serialized, /REDACTED/);
  assert.match(first.naturalLanguagePrompt, /Task: 执行任务/);
  assert.match(first.inputHash, /^[0-9a-f]{64}$/);
});

test("Prompt Builder 限制补充说明和总 Prompt 长度", () => {
  const result = buildTaskExecutionPrompt(input({ instructions: "x".repeat(50000) }));
  assert.ok(result.structuredContext.userInstructions.length <= 4000);
  assert.ok(result.naturalLanguagePrompt.length <= MAX_PROMPT_LENGTH);
});

test("已完成依赖没有真实摘要时只保留 taskId、title 和 status", () => {
  const result = buildTaskExecutionPrompt(input({
    dependencySummaries: [
      { taskId: "empty-task", title: "空字符串", status: "completed", outputSummary: "" },
      { taskId: "null-task", title: "空值", status: "completed", outputSummary: null },
      { taskId: "space-task", title: "空白", status: "completed", outputSummary: "   " },
      {
        taskId: "failed-task", title: "失败记录", status: "completed",
        errorSummary: "failed secret=should-not-appear", runStatus: "failed"
      }
    ]
  }));
  for (const dependency of result.structuredContext.completedDependencies) {
    assert.deepEqual(Object.keys(dependency).sort(), ["status", "taskId", "title"]);
    assert.equal(dependency.status, "completed");
    assert.equal(Object.hasOwn(dependency, "outputSummary"), false);
  }
  assert.doesNotMatch(result.naturalLanguagePrompt, /无输出摘要|结果摘要：\s*(?:\n|$)|outputSummary/i);
  assert.doesNotMatch(JSON.stringify(result), /should-not-appear/);
});

test("依赖真实安全摘要经过脱敏和长度限制后才进入结构与 Prompt", () => {
  const result = buildTaskExecutionPrompt(input({
    dependencySummaries: [{
      taskId: "summary-task",
      title: "有摘要",
      status: "completed",
      outputSummary: [
        "已完成分析",
        "apiKey=sk-1234567890",
        "token=private-token",
        "secret=private-secret",
        "workspacePath=/private/workspace",
        "agentDir=/private/agent",
        "x".repeat(2000)
      ].join(" ")
    }]
  }));
  const dependency = result.structuredContext.completedDependencies[0];
  assert.deepEqual(Object.keys(dependency).sort(), ["outputSummary", "status", "taskId", "title"]);
  assert.ok(dependency.outputSummary.length <= 1000);
  assert.match(dependency.outputSummary, /已完成分析/);
  assert.match(dependency.outputSummary, /REDACTED/);
  assert.doesNotMatch(JSON.stringify(result), /sk-1234567890|private-token|private-secret|workspacePath|agentDir|\/private\/workspace|\/private\/agent/);
  assert.match(result.naturalLanguagePrompt, /summary-task \| 有摘要 \| completed/);
  assert.match(result.naturalLanguagePrompt, /结果摘要：已完成分析/);
});

test("多依赖有无摘要结构稳定且摘要存在性影响 inputHash", () => {
  const mixed = input({
    dependencySummaries: [
      { taskId: "z-task", title: "无摘要", status: "completed" },
      { taskId: "a-task", title: "有摘要", status: "completed", outputSummary: "安全结果" }
    ]
  });
  const first = buildTaskExecutionPrompt(mixed);
  const second = buildTaskExecutionPrompt(mixed);
  const withoutSummary = buildTaskExecutionPrompt(input({
    dependencySummaries: [
      { taskId: "z-task", title: "无摘要", status: "completed" },
      { taskId: "a-task", title: "有摘要", status: "completed" }
    ]
  }));
  assert.deepEqual(first, second);
  assert.deepEqual(first.structuredContext.completedDependencies.map((item) => item.taskId), ["a-task", "z-task"]);
  assert.equal(Object.hasOwn(first.structuredContext.completedDependencies[0], "outputSummary"), true);
  assert.equal(Object.hasOwn(first.structuredContext.completedDependencies[1], "outputSummary"), false);
  assert.notEqual(first.inputHash, withoutSummary.inputHash);
});

test("依赖缺少真实 status 时明确拒绝", () => {
  assert.throws(() => buildTaskExecutionPrompt(input({
    dependencySummaries: [{ taskId: "missing-status", title: "缺少状态" }]
  })), /status 不能为空/);
});
