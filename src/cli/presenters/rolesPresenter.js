function formatRoleList(roles) {
  if (!roles.length) {
    return "未找到可用的离线角色。";
  }

  const lines = ["可用离线角色：", ""];
  for (const role of roles) {
    lines.push(`${role.name}  ${role.version}  ${role.agentCount} Agents`);
  }
  return lines.join("\n");
}

function formatRoleInspect(role) {
  const lines = [
    `Role ID：${role.id}`,
    `名称：${role.name}`,
    `版本：${role.version}`,
    `描述：${role.description || "无"}`,
    `Agent 数量：${role.agentCount}`,
    `安装状态：${role.installed ? "已安装" : "未安装"}`,
    `已安装版本：${role.installedVersion || "无"}`,
    `安装时间：${role.installedAt || "无"}`,
    "Agents："
  ];
  for (const agent of role.agents) {
    lines.push(`- ${agent.name} (${agent.id})${agent.description ? "：" + agent.description : ""}`);
  }
  return lines.join("\n");
}

function formatRoleInstallResult(result) {
  if (result.alreadyInstalled) {
    return `角色已安装，无需重复安装：${result.name} ${result.version}（${result.agentCount} Agents）`;
  }
  return `角色安装完成：${result.name} ${result.version}（${result.agentCount} Agents，尚未启用）`;
}

function formatInstalledRoleList(roles) {
  if (!roles.length) {
    return "当前没有已安装角色。";
  }

  const lines = ["已安装角色：", ""];
  for (const role of roles) {
    lines.push(
      `${role.id}  ${role.name}  ${role.version}  ${role.status}  ${role.agentCount} Agents  ${role.installedAt}`
    );
  }
  return lines.join("\n");
}

function formatRoleRemoveResult(result) {
  return "角色已删除：" + result.roleId;
}

module.exports = {
  formatInstalledRoleList,
  formatRoleInspect,
  formatRoleInstallResult,
  formatRoleList,
  formatRoleRemoveResult
};
