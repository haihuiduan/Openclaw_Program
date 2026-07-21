function formatProjectList(projects) {
  if (!projects.length) return "当前没有由 ToolBox 管理的 Project。";
  return ["Projects：", "", ...projects.map((project) => (
    `${project.projectId}  ${project.name}  ${project.status}  Team: ${project.teamId}  ${project.teamSyncStatus}`
  ))].join("\n");
}
function formatProjectInspect(project) {
  return [
    `Project ID：${project.projectId}`, `名称：${project.name}`, `描述：${project.description || "无"}`,
    `Team：${project.teamId}`, `状态：${project.status}`, `归档：${project.archivedAt || "否"}`,
    `执行偏好：${project.executionMode}（仅保存配置，不会执行任务）`,
    `最大并发：${project.maxConcurrency}`, `Team 同步：${project.teamSyncStatus}`,
    `快照健康：${project.teamSnapshotHealth.status}`, `Task 总数：${project.taskSummary.total}`
  ].join("\n");
}
function formatProjectMutation(project, action) { return `Project ${action}完成：${project.projectId}（${project.status}）`; }
function formatProjectSyncPreview(preview) {
  return `Project Team 同步预览：${preview.projectId}（${preview.teamSyncStatus}，${preview.differences.length} 项差异）`;
}
module.exports = { formatProjectInspect, formatProjectList, formatProjectMutation, formatProjectSyncPreview };
