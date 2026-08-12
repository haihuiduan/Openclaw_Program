const os = require("node:os");
const path = require("node:path");
const { assertInstanceId } = require("../agent-instances/id");
const {
  assertExactFields,
  clearStaleFileLease,
  createExclusiveFileLease,
  isoTimestamp,
  positiveInteger,
  readFileLease,
  releaseFileLease
} = require("../conversations/fileLease");

const DEFAULT_AGENT_CALL_LEASE_PATH = path.join(
  os.homedir(),
  ".openclaw-installer",
  "openclaw-agent",
  "active.lock"
);
const DEFAULT_AGENT_CALL_LEASE_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const AGENT_CALL_OPERATION_TYPES = new Set(["execution", "conversation"]);
const OPERATION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

async function acquireAgentCallLease(leasePath, metadata, options = {}) {
  return createExclusiveFileLease(leasePath, metadata, {
    fileSystem: options.fileSystem,
    normalize: normalizeAgentCallLease,
    label: "Agent 调用租约",
    busyMessage:
      "已有其他前台 Agent 调用正在运行，当前版本只支持全局串行调用。"
  });
}

async function readAgentCallLease(leasePath, options = {}) {
  return readFileLease(leasePath, {
    fileSystem: options.fileSystem,
    normalize: normalizeAgentCallLease,
    label: "Agent 调用租约"
  });
}

async function releaseAgentCallLease(
  leasePath,
  holder,
  options = {}
) {
  return releaseFileLease(leasePath, holder, {
    fileSystem: options.fileSystem,
    normalize: normalizeAgentCallLease,
    label: "Agent 调用租约",
    matches: sameAgentCallLease
  });
}

async function clearStaleAgentCallLease(leasePath, options = {}) {
  return clearStaleFileLease(leasePath, {
    fileSystem: options.fileSystem,
    normalize: normalizeAgentCallLease,
    label: "Agent 调用租约",
    maxAgeMs: options.maxAgeMs,
    defaultMaxAgeMs: DEFAULT_AGENT_CALL_LEASE_MAX_AGE_MS,
    isProcessAlive: options.isProcessAlive,
    now: options.now
  });
}

function normalizeAgentCallLease(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("租约必须是 JSON 对象");
  }
  const allowed = [
    "operationId",
    "operationType",
    "instanceId",
    "pid",
    "createdAt"
  ];
  assertExactFields(value, allowed, "租约");
  if (
    typeof value.operationId !== "string" ||
    !OPERATION_ID_PATTERN.test(value.operationId) ||
    value.operationId.length > 128
  ) {
    throw new Error("租约 operationId 无效");
  }
  if (!AGENT_CALL_OPERATION_TYPES.has(value.operationType)) {
    throw new Error("租约 operationType 无效");
  }
  const instanceId = assertInstanceId(value.instanceId);
  return {
    operationId: value.operationId,
    operationType: value.operationType,
    instanceId,
    pid: positiveInteger(value.pid, "租约 pid"),
    createdAt: isoTimestamp(value.createdAt, "租约 createdAt")
  };
}

function sameAgentCallLease(left, right) {
  return left.operationId === right.operationId &&
    left.operationType === right.operationType &&
    left.instanceId === right.instanceId &&
    left.pid === right.pid &&
    left.createdAt === right.createdAt;
}

module.exports = {
  AGENT_CALL_OPERATION_TYPES,
  DEFAULT_AGENT_CALL_LEASE_MAX_AGE_MS,
  DEFAULT_AGENT_CALL_LEASE_PATH,
  acquireAgentCallLease,
  clearStaleAgentCallLease,
  normalizeAgentCallLease,
  readAgentCallLease,
  releaseAgentCallLease
};
