function buildTaskGraph(tasks) {
  const records = Array.isArray(tasks) ? tasks : Object.values(tasks.tasks || tasks);
  const graph = new Map();
  for (const task of records) graph.set(task.taskId, [...task.dependencies].sort());
  return graph;
}

function detectDependencyCycle(tasks) {
  const graph = buildTaskGraph(tasks);
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  function visit(taskId) {
    if (visiting.has(taskId)) {
      const start = stack.indexOf(taskId);
      return [...stack.slice(start), taskId];
    }
    if (visited.has(taskId)) return null;
    visiting.add(taskId);
    stack.push(taskId);
    for (const dependencyId of graph.get(taskId) || []) {
      if (!graph.has(dependencyId)) continue;
      const cycle = visit(dependencyId);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(taskId);
    visited.add(taskId);
    return null;
  }
  for (const taskId of [...graph.keys()].sort()) {
    const cycle = visit(taskId);
    if (cycle) return cycle;
  }
  return null;
}

function validateTaskDependencies(task, tasks) {
  const records = Array.isArray(tasks) ? tasks : Object.values(tasks.tasks || tasks);
  const byId = new Map(records.map((record) => [record.taskId, record]));
  for (const dependencyId of task.dependencies) {
    if (dependencyId === task.taskId) throw new Error("Task 不能依赖自身：" + task.taskId);
    const dependency = byId.get(dependencyId);
    if (!dependency) throw new Error("依赖 Task 不存在：" + dependencyId);
    if (dependency.projectId !== task.projectId) {
      throw new Error(`Task 依赖不能跨 Project：${dependencyId}`);
    }
  }
  const cycle = detectDependencyCycle(records);
  if (cycle) throw new Error("Task 依赖形成循环：" + cycle.join(" -> "));
  return true;
}

function calculateTaskBlocking(task, tasks) {
  const records = Array.isArray(tasks) ? tasks : Object.values(tasks.tasks || tasks);
  const byId = new Map(records.map((record) => [record.taskId, record]));
  if (task.status !== "pending") return { status: task.status, issues: [] };
  const issues = [];
  for (const dependencyId of task.dependencies) {
    const dependency = byId.get(dependencyId);
    if (!dependency) {
      issues.push({ dependencyId, type: "missing", message: "依赖 Task 不存在" });
    } else if (dependency.status === "cancelled") {
      issues.push({ dependencyId, type: "cancelled", message: "依赖 Task 已取消" });
    } else if (dependency.status !== "completed") {
      issues.push({ dependencyId, type: "unfinished", message: "依赖 Task 尚未完成" });
    }
  }
  return { status: issues.length ? "blocked" : "pending", issues };
}

function getReadyTaskCandidates(tasks) {
  const records = Array.isArray(tasks) ? tasks : Object.values(tasks.tasks || tasks);
  return records.filter((task) => calculateTaskBlocking(task, records).status === "pending")
    .sort((left, right) => left.taskId.localeCompare(right.taskId));
}

module.exports = {
  buildTaskGraph,
  calculateTaskBlocking,
  detectDependencyCycle,
  getReadyTaskCandidates,
  validateTaskDependencies
};
