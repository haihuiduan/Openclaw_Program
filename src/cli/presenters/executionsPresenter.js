function formatExecutionList(runs) {
  if (!runs.length) return "当前没有由 ToolBox 管理的 Execution Run。";
  return ["Execution Runs：", "", ...runs.map((run) => (
    `${run.runId}  Task: ${run.taskId}  ${run.status}  attempt ${run.attempt}`
  ))].join("\n");
}

function formatExecutionInspect(run) {
  return [
    `Run ID：${run.runId}`,
    `Task：${run.taskId}`,
    `Project：${run.projectId}`,
    `Agent Instance：${run.assignedInstanceId}`,
    `状态：${run.status}`,
    `尝试次数：${run.attempt}`,
    `触发方式：${run.trigger}`,
    `Task 同步：${run.taskSyncStatus}`,
    `输出摘要：${run.outputSummary || "无"}`,
    `错误摘要：${run.errorSummary || "无"}`,
    "说明：首版不支持安全远端 cancel、pause、后台调度或 checkpoint 恢复。"
  ].join("\n");
}

function formatExecutionResult(result, action) {
  const lines = [
    `Execution ${action}完成：${result.run.runId}（${result.run.status}）`,
    `Task：${result.run.taskId}，attempt ${result.run.attempt}`
  ];
  if (result.executionMode === "auto") {
    lines.push("auto 策略已保存，但自动调度尚未开放。");
  }
  return lines.join("\n");
}

function formatExecutionReconcile(result) {
  return [
    `Execution reconcile 完成：${result.reconciledAt}`,
    `标记 interrupted：${result.interruptedRuns.length}`,
    `Task 同步处理：${result.taskSyncResults.length}`,
    `清理过期租约：${result.staleLeaseRemoved ? "是" : "否"}`
  ].join("\n");
}

module.exports = {
  formatExecutionInspect,
  formatExecutionList,
  formatExecutionReconcile,
  formatExecutionResult
};
