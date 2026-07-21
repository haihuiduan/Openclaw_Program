const PROJECT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_PROJECT_ID_LENGTH = 128;

function assertProjectId(projectId) {
  if (projectId === "main") {
    throw new Error("main 是受保护名称，不能作为 Project id 操作。");
  }
  if (typeof projectId !== "string" || !PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error(`projectId 无效：${String(projectId || "")}`);
  }
  if (projectId.length > MAX_PROJECT_ID_LENGTH) {
    throw new Error(`Project id 不能超过 ${MAX_PROJECT_ID_LENGTH} 个字符。`);
  }
  return projectId;
}

module.exports = {
  MAX_PROJECT_ID_LENGTH,
  PROJECT_ID_PATTERN,
  assertProjectId
};
