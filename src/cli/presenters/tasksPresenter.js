function formatTaskList(tasks) {
  if (!tasks.length) return "当前 Project 没有 Task。";
  return ["Tasks：", "", ...tasks.map((task) => (
    `${task.taskId}  ${task.title}  ${task.computedStatus}  ${task.priority}${task.critical ? "  critical" : ""}`
  ))].join("\n");
}
function formatTaskInspect(task) {
  return [
    `Task ID：${task.taskId}`, `Project：${task.projectId}`, `标题：${task.title}`,
    `状态：${task.status}`, `计算状态：${task.computedStatus}`, `来源：${task.source}`,
    `优先级：${task.priority}`, `分配：${task.assignedInstanceId || "未分配"}`,
    `依赖：${task.dependencies.join(", ") || "无"}`, `关键任务：${task.critical ? "是" : "否"}`,
    "说明：Phase 5 只管理定义与状态，不执行 Agent 或 Task。"
  ].join("\n");
}
function formatTaskMutation(task, action) { return `Task ${action}完成：${task.taskId}（${task.status}）`; }
module.exports = { formatTaskInspect, formatTaskList, formatTaskMutation };
