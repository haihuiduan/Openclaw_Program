const crypto = require("node:crypto");
const { redactSensitiveText } = require("./state");

const MAX_PROMPT_LENGTH = 20000;
const MAX_PROJECT_DESCRIPTION_LENGTH = 1000;
const MAX_TASK_DESCRIPTION_LENGTH = 5000;
const MAX_INSTRUCTIONS_LENGTH = 4000;
const MAX_DEPENDENCY_SUMMARY_LENGTH = 1000;

function buildTaskExecutionPrompt(input) {
  if (!input || typeof input !== "object") throw new Error("Task Execution Prompt 输入必须是对象。");
  const project = input.project;
  const task = input.task;
  if (!project || !task) throw new Error("Task Execution Prompt 需要 Project 和 Task。");

  const dependencySummaries = normalizeDependencies(input.dependencySummaries || []);
  const instructions = safeText(input.instructions || "", MAX_INSTRUCTIONS_LENGTH);
  const structuredContext = {
    project: {
      projectId: project.projectId,
      name: safeText(project.name, 100),
      description: safeText(project.description || "", MAX_PROJECT_DESCRIPTION_LENGTH),
      executionMode: project.executionMode,
      maxConcurrency: project.maxConcurrency
    },
    teamSnapshot: {
      managerInstanceId: project.teamSnapshot.managerInstanceId,
      memberInstanceIds: [...project.teamSnapshot.memberInstanceIds].sort()
    },
    task: {
      taskId: task.taskId,
      title: safeText(task.title, 200),
      description: safeText(task.description || "", MAX_TASK_DESCRIPTION_LENGTH),
      priority: task.priority,
      critical: task.critical,
      criticalReason: task.critical ? safeText(task.criticalReason, 1000) : null,
      criticalSource: task.critical ? task.criticalSource : null,
      failurePolicy: task.failurePolicy,
      assignedInstanceId: task.assignedInstanceId
    },
    completedDependencies: dependencySummaries,
    userInstructions: instructions
  };

  const lines = [
    "请执行以下 ToolBox Task。只处理给定 Project 和 Task，不修改 ToolBox 状态。",
    "",
    `Project: ${structuredContext.project.name} (${structuredContext.project.projectId})`,
    structuredContext.project.description ? `Project 描述: ${structuredContext.project.description}` : "Project 描述: 无",
    `执行策略: ${structuredContext.project.executionMode}; 最大并发: ${structuredContext.project.maxConcurrency}`,
    `Team Manager: ${structuredContext.teamSnapshot.managerInstanceId}`,
    `Team Members: ${structuredContext.teamSnapshot.memberInstanceIds.join(", ")}`,
    "",
    `Task: ${structuredContext.task.title} (${structuredContext.task.taskId})`,
    structuredContext.task.description ? `Task 描述: ${structuredContext.task.description}` : "Task 描述: 无",
    `优先级: ${structuredContext.task.priority}`,
    `分配 Agent: ${structuredContext.task.assignedInstanceId}`,
    `失败策略: ${structuredContext.task.failurePolicy}`,
    `关键任务: ${structuredContext.task.critical ? "是" : "否"}`
  ];
  if (structuredContext.task.critical) {
    lines.push(`关键原因: ${structuredContext.task.criticalReason}`);
    lines.push(`关键来源: ${structuredContext.task.criticalSource}`);
  }
  lines.push("", "已完成依赖:");
  if (!dependencySummaries.length) lines.push("- 无");
  for (const dependency of dependencySummaries) {
    lines.push(`- ${dependency.taskId} | ${dependency.title} | ${dependency.status}`);
    if (Object.hasOwn(dependency, "outputSummary")) {
      lines.push(`  结果摘要：${dependency.outputSummary}`);
    }
  }
  lines.push("", `用户补充说明: ${instructions || "无"}`);
  lines.push("", "请返回简洁、可核验的执行结果摘要。");

  let naturalLanguagePrompt = lines.join("\n");
  if (naturalLanguagePrompt.length > MAX_PROMPT_LENGTH) {
    naturalLanguagePrompt = naturalLanguagePrompt.slice(0, MAX_PROMPT_LENGTH - 20) + "\n[内容已安全截断]";
  }
  const inputSummary = safeText(
    `${task.taskId}: ${task.title}${instructions ? `；补充：${instructions}` : ""}`,
    1000
  );
  return {
    structuredContext,
    naturalLanguagePrompt,
    inputSummary,
    inputHash: crypto.createHash("sha256").update(naturalLanguagePrompt, "utf8").digest("hex")
  };
}

function normalizeDependencies(values) {
  if (!Array.isArray(values)) throw new Error("dependencySummaries 必须是数组。");
  return values.map((item) => {
    const status = safeText(item.status || "", 30);
    if (!status) throw new Error("依赖 Task status 不能为空。");
    const dependency = {
      taskId: item.taskId,
      title: safeText(item.title || "", 200),
      status
    };
    const outputSummary = safeDependencySummary(
      item.outputSummary,
      MAX_DEPENDENCY_SUMMARY_LENGTH
    );
    if (outputSummary) dependency.outputSummary = outputSummary;
    return dependency;
  }).sort((left, right) => left.taskId.localeCompare(right.taskId));
}

function safeDependencySummary(value, maximum) {
  if (typeof value !== "string" || !value.trim()) return "";
  const withoutUnsafeAssignments = value.replace(
    /\b(?:workspacePath|agentDir|env|prompt|stdout|stderr)\s*[:=]\s*[^\s,;]+/gi,
    "[REDACTED]"
  );
  return safeText(withoutUnsafeAssignments, maximum);
}

function safeText(value, maximum) {
  const redacted = redactSensitiveText(String(value || "")).trim();
  return redacted.length > maximum ? redacted.slice(0, maximum - 14) + "[内容已截断]" : redacted;
}

module.exports = {
  MAX_PROMPT_LENGTH,
  buildTaskExecutionPrompt
};
