const { ROLE_ID_PATTERN } = require("../roles/validator");

const MAX_INSTANCE_ID_LENGTH = 128;

function createInstanceId(roleId, roleAgentId) {
  assertSafeId(roleId, "roleId");
  assertSafeId(roleAgentId, "roleAgentId");
  return assertInstanceId(`${roleId}-${roleAgentId}`);
}

function assertInstanceId(instanceId) {
  if (instanceId === "main") {
    throw new Error("main Agent 受保护，不能作为 Agent Instance 操作。");
  }
  assertSafeId(instanceId, "instanceId");
  if (instanceId.length > MAX_INSTANCE_ID_LENGTH) {
    throw new Error(`Agent Instance id 不能超过 ${MAX_INSTANCE_ID_LENGTH} 个字符。`);
  }
  return instanceId;
}

function assertSafeId(value, field) {
  if (typeof value !== "string" || !ROLE_ID_PATTERN.test(value)) {
    throw new Error(`${field} 无效：${String(value || "")}`);
  }
  if (value === "main") {
    throw new Error(`${field} 不能使用受保护名称 main。`);
  }
}

module.exports = {
  MAX_INSTANCE_ID_LENGTH,
  assertInstanceId,
  createInstanceId
};
