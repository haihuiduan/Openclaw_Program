const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  assertConversationId,
  assertMessageId,
  assertTurnId
} = require("./id");
const {
  assertSafeStructuralIdentifier,
  createSafeError,
  createSafeFileError,
  sanitizeAssistantMessage,
  sanitizeErrorSummary,
  sanitizeUserMessage,
  sanitizeVisibleText
} = require("./security");
const { withStateFileLock } = require("./fileLease");
const {
  DEFAULT_CONVERSATION_DATA_DIRECTORY
} = require("./state");

const MESSAGE_STATE_SCHEMA_VERSION = 1;
const DEFAULT_MESSAGE_STATE_DIRECTORY = path.join(
  DEFAULT_CONVERSATION_DATA_DIRECTORY,
  "messages"
);
const MESSAGE_ROLES = new Set(["user", "assistant"]);
const ASSISTANT_MESSAGE_STATUSES = new Set([
  "pending",
  "sending",
  "completed",
  "failed",
  "interrupted"
]);
const MAX_USER_MESSAGE_LENGTH = 8000;
const MAX_ASSISTANT_MESSAGE_LENGTH = 4000;
const MAX_ERROR_SUMMARY_LENGTH = 2000;
const MAX_MESSAGES_PER_CONVERSATION = 1000;
const stateLocks = new Map();

function resolveMessageStatePath(
  messageStateDirectory,
  conversationId
) {
  assertConversationId(conversationId);
  const root = path.resolve(
    messageStateDirectory || DEFAULT_MESSAGE_STATE_DIRECTORY
  );
  const candidate = path.resolve(root, `${conversationId}.json`);
  const relative = path.relative(root, candidate);
  if (
    !relative ||
    relative.startsWith(".." + path.sep) ||
    relative === ".." ||
    path.isAbsolute(relative)
  ) {
    throw new Error("Message State 路径越出受管目录。");
  }
  return candidate;
}

function createEmptyMessageState(conversationId) {
  return {
    schemaVersion: MESSAGE_STATE_SCHEMA_VERSION,
    conversationId: assertConversationId(conversationId),
    messages: {}
  };
}

async function readMessageState(statePath, conversationId) {
  assertConversationId(conversationId);
  let content;
  try {
    content = await fs.readFile(statePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return createEmptyMessageState(conversationId);
    }
    throw createSafeFileError("Message 状态", "读取", error);
  }
  let state;
  try {
    state = JSON.parse(content);
  } catch (error) {
    throw createSafeError("Message 状态文件损坏：不是有效 JSON。", error);
  }
  try {
    const normalized = normalizeMessageState(state);
    if (normalized.conversationId !== conversationId) {
      throw new Error("Message State conversationId 与路径不一致");
    }
    return normalized;
  } catch (error) {
    throw createSafeError(
      `Message 状态文件结构无效：${error.message}`,
      error
    );
  }
}

async function writeMessageState(statePath, state, options = {}) {
  const conversationId = assertConversationId(
    state && state.conversationId
  );
  return withStateLock(statePath, async () => {
    return withStateFileLock(
      resolveMessageStateLockPath(
        statePath,
        conversationId,
        options.lockPath
      ),
      async () => {
        const normalized = normalizeMessageState(state);
        await writeUnlocked(statePath, normalized);
        return clone(normalized);
      },
      stateLockOptions(options)
    );
  });
}

async function updateMessageState(
  statePath,
  conversationId,
  updater,
  options = {}
) {
  if (typeof updater !== "function") {
    throw new TypeError("Message 状态更新器必须是函数。");
  }
  return withStateLock(statePath, async () => {
    return withStateFileLock(
      resolveMessageStateLockPath(
        statePath,
        conversationId,
        options.lockPath
      ),
      async () => {
        const current = await readMessageState(statePath, conversationId);
        const draft = clone(current);
        const result = await updater(draft);
        const normalized = normalizeMessageState(
          result === undefined ? draft : result
        );
        if (normalized.conversationId !== conversationId) {
          throw new Error("Message State conversationId 不能改变");
        }
        await writeUnlocked(statePath, normalized);
        return clone(normalized);
      },
      stateLockOptions(options)
    );
  });
}

function resolveMessageStateLockPath(statePath, conversationId, lockPath) {
  const normalizedId = assertConversationId(conversationId);
  if (lockPath) return path.resolve(lockPath);
  const resolvedStatePath = path.resolve(statePath);
  const stateDirectory = path.dirname(resolvedStatePath);
  const conversationRoot =
    path.basename(stateDirectory) === "messages"
      ? path.dirname(stateDirectory)
      : stateDirectory;
  return path.join(
    conversationRoot,
    "locks",
    "messages",
    `${normalizedId}.lock`
  );
}

function stateLockOptions(options) {
  return {
    fileSystem: options.fileSystem,
    isProcessAlive: options.isProcessAlive,
    maxAgeMs: options.lockMaxAgeMs,
    now: options.now,
    retryMs: options.lockRetryMs,
    waitMs: options.lockWaitMs
  };
}

async function writeUnlocked(statePath, state) {
  const directory = path.dirname(statePath);
  const temporaryPath = `${statePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.chmod(directory, 0o700);
    await fs.writeFile(temporaryPath, JSON.stringify(state, null, 2) + "\n", {
      encoding: "utf8",
      mode: 0o600
    });
    await fs.rename(temporaryPath, statePath);
    await fs.chmod(statePath, 0o600);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw createSafeFileError("Message 状态", "写入", error);
  }
}

function getMessageState(state, messageId) {
  const normalized = normalizeMessageState(state);
  return normalized.messages[messageId]
    ? clone(normalized.messages[messageId])
    : null;
}

function listMessageStates(state) {
  return Object.values(normalizeMessageState(state).messages)
    .sort(
      (left, right) =>
        left.sequence - right.sequence ||
        left.messageId.localeCompare(right.messageId)
    )
    .map(clone);
}

function normalizeMessageState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("state 必须是 JSON 对象");
  }
  if (state.schemaVersion !== MESSAGE_STATE_SCHEMA_VERSION) {
    throw new Error(`schemaVersion 必须为 ${MESSAGE_STATE_SCHEMA_VERSION}`);
  }
  const conversationId = assertConversationId(
    requiredText(state.conversationId, "conversationId")
  );
  if (
    !state.messages ||
    typeof state.messages !== "object" ||
    Array.isArray(state.messages)
  ) {
    throw new Error("messages 必须是 JSON 对象");
  }
  if (Object.keys(state.messages).length > MAX_MESSAGES_PER_CONVERSATION) {
    throw new Error(
      `单个 Conversation 不能超过 ${MAX_MESSAGES_PER_CONVERSATION} 条 Message`
    );
  }

  const records = Object.entries(state.messages).map(([messageId, record]) =>
    normalizeMessageRecord(messageId, record, conversationId)
  );
  const sequences = new Set();
  const turns = new Map();
  for (const record of records) {
    if (sequences.has(record.sequence)) {
      throw new Error("Message sequence 不能重复。");
    }
    sequences.add(record.sequence);
    const roles = turns.get(record.turnId) || new Map();
    if (roles.has(record.role)) {
      throw new Error(`同一 turnId 不能包含重复 ${record.role} Message`);
    }
    roles.set(record.role, record);
    turns.set(record.turnId, roles);
  }
  for (const [turnId, roles] of turns) {
    if (!roles.has("user") || !roles.has("assistant") || roles.size !== 2) {
      throw new Error("每个 turnId 必须恰好包含一条 user 和一条 assistant Message。");
    }
    if (roles.get("user").sequence >= roles.get("assistant").sequence) {
      throw new Error(
        "同一 turnId 的 User sequence 必须小于 Assistant sequence。"
      );
    }
  }

  const messages = {};
  for (const record of records.sort(
    (left, right) =>
      left.sequence - right.sequence ||
      left.messageId.localeCompare(right.messageId)
  )) {
    messages[record.messageId] = record;
  }
  return {
    schemaVersion: MESSAGE_STATE_SCHEMA_VERSION,
    conversationId,
    messages
  };
}

function normalizeMessageRecord(messageId, record, conversationId) {
  assertMessageId(messageId);
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("Message 记录必须是 JSON 对象。");
  }
  const role = enumValue(record.role, "role", MESSAGE_ROLES);
  const status =
    role === "user"
      ? enumValue(record.status, "status", new Set(["completed"]))
      : enumValue(record.status, "status", ASSISTANT_MESSAGE_STATUSES);
  const content = normalizeContent(record.content, role, status);
  const normalized = {
    messageId: assertMessageId(requiredText(record.messageId, "messageId")),
    turnId: assertTurnId(requiredText(record.turnId, "turnId")),
    conversationId: assertConversationId(
      requiredText(record.conversationId, "conversationId")
    ),
    sequence: positiveInteger(record.sequence, "sequence"),
    role,
    status,
    content,
    errorSummary:
      record.errorSummary === null
        ? null
        : safeBoundedText(
          record.errorSummary,
          "errorSummary",
          MAX_ERROR_SUMMARY_LENGTH,
          false
        ),
    openClawSessionId: nullableStructuralIdentifier(
      record.openClawSessionId,
      "openClawSessionId",
      300
    ),
    openClawRunId: nullableStructuralIdentifier(
      record.openClawRunId,
      "openClawRunId",
      300
    ),
    createdAt: requiredTimestamp(record.createdAt, "createdAt"),
    updatedAt: requiredTimestamp(record.updatedAt, "updatedAt"),
    completedAt: optionalTimestamp(record.completedAt, "completedAt"),
    failedAt: optionalTimestamp(record.failedAt, "failedAt"),
    interruptedAt: optionalTimestamp(
      record.interruptedAt,
      "interruptedAt"
    )
  };
  if (normalized.messageId !== messageId) {
    throw new Error("Message key 与 messageId 不一致。");
  }
  if (normalized.conversationId !== conversationId) {
    throw new Error("Message conversationId 与根状态不一致。");
  }
  assertMessageLifecycle(normalized);
  return normalized;
}

function normalizeContent(content, role, status) {
  if (role === "assistant" && status !== "completed") {
    if (content !== null) {
      throw new Error(`${status} Assistant Message 的 content 必须为 null`);
    }
    return null;
  }
  const maximum =
    role === "user"
      ? MAX_USER_MESSAGE_LENGTH
      : MAX_ASSISTANT_MESSAGE_LENGTH;
  return role === "user"
    ? sanitizeUserMessage(content, maximum)
    : sanitizeAssistantMessage(content, maximum);
}

function assertMessageLifecycle(message) {
  const terminalField = {
    completed: "completedAt",
    failed: "failedAt",
    interrupted: "interruptedAt"
  };
  for (const field of ["completedAt", "failedAt", "interruptedAt"]) {
    const expected = terminalField[message.status] === field;
    if (expected !== (message[field] !== null)) {
      throw new Error(`${field} 必须且只能在对应终态存在`);
    }
  }
  if (
    ["failed", "interrupted"].includes(message.status) !==
    (message.errorSummary !== null)
  ) {
    throw new Error("errorSummary 必须且只能在 failed/interrupted 状态存在");
  }
  if (message.role === "user") {
    if (message.errorSummary || message.openClawSessionId || message.openClawRunId) {
      throw new Error("User Message 不能包含错误或 OpenClaw 标识");
    }
  } else if (
    message.status !== "completed" &&
    (message.openClawSessionId || message.openClawRunId)
  ) {
    throw new Error("只有 completed Assistant Message 可以包含 OpenClaw 标识");
  }
}

function safeBoundedText(value, field, maximum, allowEmpty) {
  if (field === "errorSummary") {
    return sanitizeErrorSummary(value, maximum);
  }
  return boundedText(
    sanitizeVisibleText(value, maximum),
    field,
    maximum,
    allowEmpty
  );
}

function nullableStructuralIdentifier(value, field, maximum) {
  return value === null
    ? null
    : assertSafeStructuralIdentifier(value, field, maximum);
}

function enumValue(value, field, allowed) {
  const normalized = requiredText(value, field);
  if (!allowed.has(normalized)) {
    throw new Error(`${field} 无效。`);
  }
  return normalized;
}

function boundedText(value, field, maximum, allowEmpty) {
  if (typeof value !== "string") {
    throw new Error(field + " 必须是字符串");
  }
  const normalized = value.trim();
  if (!allowEmpty && !normalized) {
    throw new Error(field + " 必须是非空字符串");
  }
  if (normalized.length > maximum) {
    throw new Error(`${field} 不能超过 ${maximum} 个字符`);
  }
  return normalized;
}

function requiredText(value, field) {
  return boundedText(value, field, Number.MAX_SAFE_INTEGER, false);
}

function positiveInteger(value, field) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(field + " 必须是正整数");
  }
  return value;
}

function requiredTimestamp(value, field) {
  const normalized = requiredText(value, field);
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new Error(field + " 必须是有效时间");
  }
  return normalized;
}

function optionalTimestamp(value, field) {
  return value === null ? null : requiredTimestamp(value, field);
}

function withStateLock(statePath, operation) {
  const key = path.resolve(statePath);
  const previous = stateLocks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  const tail = current.catch(() => {});
  stateLocks.set(key, tail);
  return current.finally(() => {
    if (stateLocks.get(key) === tail) {
      stateLocks.delete(key);
    }
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

module.exports = {
  ASSISTANT_MESSAGE_STATUSES,
  DEFAULT_MESSAGE_STATE_DIRECTORY,
  MAX_ASSISTANT_MESSAGE_LENGTH,
  MAX_ERROR_SUMMARY_LENGTH,
  MAX_MESSAGES_PER_CONVERSATION,
  MAX_USER_MESSAGE_LENGTH,
  MESSAGE_STATE_SCHEMA_VERSION,
  createEmptyMessageState,
  getMessageState,
  listMessageStates,
  normalizeMessageState,
  readMessageState,
  resolveMessageStateLockPath,
  resolveMessageStatePath,
  updateMessageState,
  writeMessageState
};
