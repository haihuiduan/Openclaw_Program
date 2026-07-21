const TASK_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_TASK_ID_LENGTH = 128;

function assertTaskId(taskId) {
  if (taskId === "main") throw new Error("main 是受保护名称，不能作为 Task id 操作。");
  if (typeof taskId !== "string" || !TASK_ID_PATTERN.test(taskId)) {
    throw new Error(`taskId 无效：${String(taskId || "")}`);
  }
  if (taskId.length > MAX_TASK_ID_LENGTH) {
    throw new Error(`Task id 不能超过 ${MAX_TASK_ID_LENGTH} 个字符。`);
  }
  return taskId;
}

module.exports = { MAX_TASK_ID_LENGTH, TASK_ID_PATTERN, assertTaskId };
