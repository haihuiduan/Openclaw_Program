function formatInstanceList(instances) {
  if (!instances.length) {
    return "当前没有由 ToolBox 管理的 Agent Instance。";
  }

  const lines = ["Agent Instances：", ""];
  for (const instance of instances) {
    lines.push(
      `${instance.instanceId}  ${instance.roleId}/${instance.roleAgentId}  ` +
      `${instance.roleVersion}  ${formatStatus(instance.status)}`
    );
  }
  return lines.join("\n");
}

function formatInstanceInspect(instance) {
  return [
    `Instance ID：${instance.instanceId}`,
    `来源角色：${instance.roleId} ${instance.roleVersion}`,
    `Role Agent：${instance.roleAgentId}`,
    `状态：${formatStatus(instance.status)}`,
    `workspace：${instance.workspacePath}`,
    `agentDir：${instance.agentDir}`,
    `注册时间：${instance.registeredAt}`,
    `最后核对：${instance.lastReconciledAt}`,
    `漂移：${instance.drift.length ? instance.drift.join(", ") : "无"}`
  ].join("\n");
}

function formatInstanceRegisterResult(result) {
  const prefix = result.alreadyRegistered ? "Agent Instance 已注册" : "Agent Instance 注册完成";
  return `${prefix}：${result.instance.instanceId}（${result.instance.roleId}/${result.instance.roleAgentId}）`;
}

function formatReconcileResult(result) {
  const counts = { registered: 0, missing: 0, drifted: 0 };
  for (const instance of result.instances) {
    counts[instance.status] += 1;
  }
  return [
    "Agent Instance 核对完成：",
    `- 正常：${counts.registered}`,
    `- 缺失：${counts.missing}`,
    `- 漂移：${counts.drifted}`,
    `- 未由 ToolBox 管理的 OpenClaw Agent：${result.unmanagedAgents.length}（未作修改）`
  ].join("\n");
}

function formatStatus(status) {
  return {
    registered: "已注册",
    missing: "OpenClaw 中缺失",
    drifted: "配置漂移"
  }[status] || status;
}

module.exports = {
  formatInstanceInspect,
  formatInstanceList,
  formatInstanceRegisterResult,
  formatReconcileResult
};
