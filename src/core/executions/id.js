const crypto = require("node:crypto");

const RUN_ID_PATTERN = /^run-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function createRunId() {
  return `run-${crypto.randomUUID()}`;
}

function assertRunId(runId) {
  if (runId === "main") {
    throw new Error("main 是受保护名称，不能作为 Execution Run id 操作。");
  }
  if (typeof runId !== "string" || !RUN_ID_PATTERN.test(runId)) {
    throw new Error(`runId 无效：${String(runId || "")}`);
  }
  return runId;
}

module.exports = {
  RUN_ID_PATTERN,
  assertRunId,
  createRunId
};
