const os = require("node:os");
const path = require("node:path");
const { assertConversationId } = require("./id");
const {
  assertExactFields,
  clearStaleFileLease,
  createExclusiveFileLease,
  isFileLeaseBusyError,
  isoTimestamp,
  positiveInteger,
  readFileLease,
  releaseFileLease
} = require("./fileLease");

const conversationLocks = new Map();
const DEFAULT_CONVERSATION_OPERATION_LOCK_DIRECTORY = path.join(
  os.homedir(),
  ".openclaw-installer",
  "conversations",
  "operations"
);
const DEFAULT_CONVERSATION_OPERATION_LOCK_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const CONVERSATION_OPERATION_TYPES = new Set(["send", "archive", "reconcile"]);
const OPERATION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function withConversationLock(conversationId, operation) {
  const previous = conversationLocks.get(conversationId) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  const tail = current.catch(() => {});
  conversationLocks.set(conversationId, tail);
  return current.finally(() => {
    if (conversationLocks.get(conversationId) === tail) {
      conversationLocks.delete(conversationId);
    }
  });
}

function resolveConversationOperationLockPath(directory, conversationId) {
  const normalizedId = assertConversationId(conversationId);
  const root = path.resolve(
    directory || DEFAULT_CONVERSATION_OPERATION_LOCK_DIRECTORY
  );
  const candidate = path.resolve(root, `${normalizedId}.lock`);
  const relative = path.relative(root, candidate);
  if (
    !relative ||
    relative.startsWith(".." + path.sep) ||
    relative === ".." ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Conversation 操作锁路径越出受管目录。");
  }
  return candidate;
}

async function acquireConversationOperationLock(
  directory,
  metadata,
  options = {}
) {
  const normalized = normalizeConversationOperationLock(metadata);
  const lockPath = resolveConversationOperationLockPath(
    directory,
    normalized.conversationId
  );
  const leaseOptions = operationLeaseOptions(options);
  try {
    return await createExclusiveFileLease(lockPath, normalized, leaseOptions);
  } catch (error) {
    if (!isFileLeaseBusyError(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 10));
    const stale = await clearStaleFileLease(lockPath, {
      ...leaseOptions,
      now: options.now,
      maxAgeMs: options.maxAgeMs,
      defaultMaxAgeMs: DEFAULT_CONVERSATION_OPERATION_LOCK_MAX_AGE_MS,
      isProcessAlive: options.isProcessAlive
    });
    if (stale.removed) {
      return createExclusiveFileLease(lockPath, normalized, leaseOptions);
    }
    throw error;
  }
}

async function readConversationOperationLock(
  directory,
  conversationId,
  options = {}
) {
  return readFileLease(
    resolveConversationOperationLockPath(directory, conversationId),
    operationLeaseOptions(options)
  );
}

async function releaseConversationOperationLock(
  directory,
  holder,
  options = {}
) {
  const conversationId = holder && holder.conversationId;
  assertConversationId(conversationId);
  return releaseFileLease(
    resolveConversationOperationLockPath(directory, conversationId),
    holder,
    operationLeaseOptions(options)
  );
}

async function clearStaleConversationOperationLock(
  directory,
  conversationId,
  options = {}
) {
  return clearStaleFileLease(
    resolveConversationOperationLockPath(directory, conversationId),
    {
      ...operationLeaseOptions(options),
      now: options.now,
      maxAgeMs: options.maxAgeMs,
      defaultMaxAgeMs: DEFAULT_CONVERSATION_OPERATION_LOCK_MAX_AGE_MS,
      isProcessAlive: options.isProcessAlive
    }
  );
}

function normalizeConversationOperationLock(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Conversation 操作锁必须是 JSON 对象");
  }
  assertExactFields(
    value,
    ["operationId", "conversationId", "operationType", "pid", "createdAt"],
    "Conversation 操作锁"
  );
  if (
    typeof value.operationId !== "string" ||
    !OPERATION_ID_PATTERN.test(value.operationId) ||
    value.operationId.length > 128
  ) {
    throw new Error("Conversation 操作锁 operationId 无效");
  }
  const conversationId = assertConversationId(value.conversationId);
  if (!CONVERSATION_OPERATION_TYPES.has(value.operationType)) {
    throw new Error("Conversation 操作锁 operationType 无效");
  }
  return {
    operationId: value.operationId,
    conversationId,
    operationType: value.operationType,
    pid: positiveInteger(value.pid, "Conversation 操作锁 pid"),
    createdAt: isoTimestamp(
      value.createdAt,
      "Conversation 操作锁 createdAt"
    )
  };
}

function operationLeaseOptions(options) {
  return {
    fileSystem: options.fileSystem,
    normalize: normalizeConversationOperationLock,
    label: "Conversation 操作锁",
    matches: sameConversationOperationLock,
    busyMessage: "Conversation 正在执行其他操作，请稍后重试。"
  };
}

function sameConversationOperationLock(left, right) {
  return left.operationId === right.operationId &&
    left.conversationId === right.conversationId &&
    left.operationType === right.operationType &&
    left.pid === right.pid &&
    left.createdAt === right.createdAt;
}

module.exports = {
  CONVERSATION_OPERATION_TYPES,
  DEFAULT_CONVERSATION_OPERATION_LOCK_DIRECTORY,
  DEFAULT_CONVERSATION_OPERATION_LOCK_MAX_AGE_MS,
  acquireConversationOperationLock,
  clearStaleConversationOperationLock,
  normalizeConversationOperationLock,
  readConversationOperationLock,
  releaseConversationOperationLock,
  resolveConversationOperationLockPath,
  withConversationLock
};
