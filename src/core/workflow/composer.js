// workflow composer：把多个 workflow 组合成一个新的 workflow 定义。

function compose(workflowList, registry) {
  if (!Array.isArray(workflowList)) {
    throw new Error("workflowList 必须是数组。");
  }

  if (!registry) {
    throw new Error("compose 需要传入 workflow registry。");
  }

  const mergedSteps = [];
  const seenStepIds = new Set();

  for (const workflowId of workflowList) {
    const workflow = getWorkflow(workflowId, registry);

    if (!workflow) {
      throw new Error("未知 workflow：" + workflowId);
    }

    for (const step of workflow.steps || []) {
      const stepId = step.id || step.name;

      if (!stepId || seenStepIds.has(stepId)) {
        continue;
      }

      seenStepIds.add(stepId);
      mergedSteps.push(step);
    }
  }

  return {
    id: "composed_workflow",
    steps: mergedSteps
  };
}

function getWorkflow(workflowId, registry) {
  if (typeof registry.getWorkflow === "function") {
    return registry.getWorkflow(workflowId);
  }

  if (registry.workflows) {
    return registry.workflows[workflowId] || null;
  }

  return registry[workflowId] || null;
}

module.exports = {
  compose
};
