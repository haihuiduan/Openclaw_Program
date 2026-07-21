function formatTeamList(teams) {
  if (!teams.length) {
    return "当前没有由 ToolBox 管理的 Team。";
  }

  const lines = ["Teams：", ""];
  for (const team of teams) {
    lines.push(
      `${team.teamId}  ${team.name}  Manager: ${team.managerInstanceId}  ` +
      `${team.memberInstanceIds.length} members  ${team.executionMode}  ${team.health.status}`
    );
  }
  return lines.join("\n");
}

function formatTeamInspect(team) {
  const issues = team.health.issues.length
    ? team.health.issues.map((issue) => `${issue.instanceId}: ${issue.message}`).join("；")
    : "无";
  return [
    `Team ID：${team.teamId}`,
    `名称：${team.name}`,
    `描述：${team.description || "无"}`,
    `Manager：${team.managerInstanceId}`,
    `成员：${team.memberInstanceIds.join(", ")}`,
    `执行模式：${team.executionMode}`,
    `最大并发：${team.maxConcurrency}`,
    `健康状态：${team.health.status}`,
    `问题：${issues}`,
    `创建时间：${team.createdAt}`,
    `更新时间：${team.updatedAt}`
  ].join("\n");
}

function formatTeamMutationResult(team, action) {
  return `Team ${action}完成：${team.teamId}（${team.name}，${team.health.status}）`;
}

function formatTeamDeleteResult(result) {
  return `Team State 已删除：${result.teamId}；未修改任何 Agent Instance 或 workspace。`;
}

module.exports = {
  formatTeamDeleteResult,
  formatTeamInspect,
  formatTeamList,
  formatTeamMutationResult
};
