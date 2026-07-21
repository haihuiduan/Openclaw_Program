function assessTeamHealth(team, instanceState) {
  const issues = [];
  const resolvedMembers = [];

  for (const instanceId of team.memberInstanceIds) {
    const instance = instanceState.instances[instanceId];
    if (!instance) {
      issues.push({
        instanceId,
        type: "unknown-instance",
        message: "Instance 不存在于本地 Instance State"
      });
      continue;
    }

    const resolved = resolveInstance(instance);
    resolvedMembers.push(resolved);
    if (instance.status !== "registered") {
      issues.push({
        instanceId,
        type: "instance-not-registered",
        status: instance.status,
        drift: [...instance.drift],
        message: `Instance 当前状态为 ${instance.status}`
      });
    }
  }

  const hasUnknownInstance = issues.some((issue) => issue.type === "unknown-instance");
  const status = hasUnknownInstance ? "invalid" : issues.length ? "degraded" : "ready";
  const resolvedManager = resolvedMembers.find((instance) => (
    instance.instanceId === team.managerInstanceId
  )) || null;

  return {
    health: { status, issues },
    resolvedManager,
    resolvedMembers
  };
}

function resolveInstance(instance) {
  return {
    instanceId: instance.instanceId,
    roleId: instance.roleId,
    roleVersion: instance.roleVersion,
    roleAgentId: instance.roleAgentId,
    status: instance.status,
    drift: [...instance.drift],
    lastReconciledAt: instance.lastReconciledAt
  };
}

module.exports = {
  assessTeamHealth
};
