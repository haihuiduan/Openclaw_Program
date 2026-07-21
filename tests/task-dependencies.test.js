const assert = require("node:assert/strict");
const test = require("node:test");
const { projectPath } = require("./helpers");
const {
  buildTaskGraph, calculateTaskBlocking, detectDependencyCycle,
  getReadyTaskCandidates, validateTaskDependencies
} = require(projectPath("src/core/tasks/dependencies.js"));

function task(taskId, dependencies = [], status = "pending", projectId = "test-project") {
  return { taskId, dependencies, status, projectId };
}

test("依赖图检测自依赖、未知依赖、跨 Project 和循环", () => {
  assert.throws(() => validateTaskDependencies(task("a", ["a"]), [task("a", ["a"])]), /依赖自身/);
  assert.throws(() => validateTaskDependencies(task("a", ["missing"]), [task("a", ["missing"])]), /不存在/);
  assert.throws(() => validateTaskDependencies(task("a", ["b"]), [task("a", ["b"]), task("b", [], "pending", "other")]), /跨 Project/);
  const cyclic = [task("a", ["b"]), task("b", ["c"]), task("c", ["a"])];
  assert.deepEqual(detectDependencyCycle(cyclic), ["a", "b", "c", "a"]);
  assert.throws(() => validateTaskDependencies(cyclic[0], cyclic), /形成循环/);
  assert.deepEqual([...buildTaskGraph(cyclic).keys()], ["a", "b", "c"]);
});

test("动态阻塞、取消依赖问题和候选任务均不持久化执行态", () => {
  const tasks = [task("a"), task("b", ["a"]), task("c", [], "completed"), task("d", [], "cancelled")];
  assert.equal(calculateTaskBlocking(tasks[1], tasks).status, "blocked");
  tasks[0].status = "completed";
  assert.equal(calculateTaskBlocking(tasks[1], tasks).status, "pending");
  tasks[0].status = "cancelled";
  assert.deepEqual(calculateTaskBlocking(tasks[1], tasks).issues[0].type, "cancelled");
  assert.deepEqual(getReadyTaskCandidates(tasks).map((item) => item.taskId), []);
});
