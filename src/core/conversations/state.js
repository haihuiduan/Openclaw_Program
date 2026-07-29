const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { assertInstanceId } = require("../agent-instances/id");
const { assertProjectId } = require("../projects/id");
const { assertConversationId } = require("./id");
const { withStateFileLock } = require("./fileLease");
const {
  assertSafeStructuralIdentifier,
  createSafeError,
  createSafeFileError,
  sanitizeConversationTitle
} = require("./security");

const CONVERSATION_STATE_SCHEMA_VERSION = 1;
const DEFAULT_CONVERSATION_DATA_DIRECTORY = path.join(
  os.homedir(),
  ".openclaw-installer",
  "conversations"
);
const DEFAULT_CONVERSATION_STATE_PATH = path.join(
  DEFAULT_CONVERSATION_DATA_DIRECTORY,
  "state.json"
);
const CONVERSATION_STATUSES = new Set(["active", "archived"]);
const MAX_CONVERSATION_TITLE_LENGTH = 100;
const MAX_SESSION_KEY_LENGTH = 300;
const stateLocks = new Map();
const CONVERSATION_STATE_LOCK_FILENAME = "state-write.lock";

function createEmptyConversationState() {
  return {
    schemaVersion: CONVERSATION_STATE_SCHEMA_VERSION,
    conversations: {}
  };
}

async function readConversationState(statePath) {
  let content;
  try {
    content = await fs.readFile(statePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return createEmptyConversationState();
    }
    throw createSafeFileError("Conversation 状态", "读取", error);
  }

  let state;
  try {
    state = JSON.parse(content);
  } catch (error) {
    throw createSafeError(
      "Conversation 状态文件损坏：不是有效 JSON。",
      error
    );
  }

  try {
    return normalizeConversationState(state);
  } catch (error) {
    throw createSafeError(
      `Conversation 状态文件结构无效：${error.message}`,
      error
    );
  }
}

async function writeConversationState(statePath, state, options = {}) {
  return withStateLock(statePath, async () => {
    return withStateFileLock(
      resolveConversationStateLockPath(statePath, options.lockPath),
      async () => {
        const normalized = normalizeConversationState(state);
        await writeUnlocked(statePath, normalized);
        return clone(normalized);
      },
      stateLockOptions(options)
    );
  });
}

async function updateConversationState(statePath, updater, options = {}) {
  if (typeof updater !== "function") {
    throw new TypeError("Conversation 状态更新器必须是函数。");
  }
  return withStateLock(statePath, async () => {
    return withStateFileLock(
      resolveConversationStateLockPath(statePath, options.lockPath),
      async () => {
        const current = await readConversationState(statePath);
        const draft = clone(current);
        const result = await updater(draft);
        const normalized = normalizeConversationState(
          result === undefined ? draft : result
        );
        await writeUnlocked(statePath, normalized);
        return clone(normalized);
      },
      stateLockOptions(options)
    );
  });
}

function resolveConversationStateLockPath(statePath, lockPath) {
  return path.resolve(
    lockPath ||
      path.join(
        path.dirname(path.resolve(statePath)),
        "locks",
        CONVERSATION_STATE_LOCK_FILENAME
      )
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
    throw createSafeFileError("Conversation 状态", "写入", error);
  }
}

function getConversationState(state, conversationId) {
  const normalized = normalizeConversationState(state);
  return normalized.conversations[conversationId]
    ? clone(normalized.conversations[conversationId])
    : null;
}

function listConversationStates(state) {
  return Object.values(normalizeConversationState(state).conversations)
    .sort((left, right) => left.conversationId.localeCompare(right.conversationId))
    .map(clone);
}

function normalizeConversationState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("state 必须是 JSON 对象");
  }
  if (state.schemaVersion !== CONVERSATION_STATE_SCHEMA_VERSION) {
    throw new Error(
      `schemaVersion 必须为 ${CONVERSATION_STATE_SCHEMA_VERSION}`
    );
  }
  if (
    !state.conversations ||
    typeof state.conversations !== "object" ||
    Array.isArray(state.conversations)
  ) {
    throw new Error("conversations 必须是 JSON 对象");
  }
  const conversations = {};
  for (const conversationId of Object.keys(state.conversations).sort()) {
    conversations[conversationId] = normalizeConversationRecord(
      conversationId,
      state.conversations[conversationId]
    );
  }
  return {
    schemaVersion: CONVERSATION_STATE_SCHEMA_VERSION,
    conversations
  };
}

function normalizeConversationRecord(conversationId, record) {
  assertConversationId(conversationId);
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("Conversation 记录必须是 JSON 对象。");
  }
  const normalized = {
    conversationId: assertConversationId(
      requiredText(record.conversationId, "conversationId")
    ),
    title: sanitizeConversationTitle(
      record.title,
      MAX_CONVERSATION_TITLE_LENGTH
    ),
    instanceId: normalizedInstanceId(record.instanceId),
    projectId:
      record.projectId === null
        ? null
        : normalizedProjectId(record.projectId),
    status: enumValue(record.status, "status", CONVERSATION_STATUSES),
    sessionKey: normalizeSessionKey(record.sessionKey),
    openClawSessionId: nullableStructuralIdentifier(
      record.openClawSessionId,
      "openClawSessionId",
      300
    ),
    createdAt: requiredTimestamp(record.createdAt, "createdAt"),
    updatedAt: requiredTimestamp(record.updatedAt, "updatedAt"),
    archivedAt: optionalTimestamp(record.archivedAt, "archivedAt")
  };
  if (normalized.conversationId !== conversationId) {
    throw new Error("Conversation key 与 conversationId 不一致。");
  }
  if (
    (normalized.status === "archived") !==
    (normalized.archivedAt !== null)
  ) {
    throw new Error("archivedAt 必须且只能在 archived 状态存在");
  }
  return normalized;
}

function normalizeSessionKey(value) {
  return assertSafeStructuralIdentifier(
    value,
    "sessionKey",
    MAX_SESSION_KEY_LENGTH
  );
}

function nullableStructuralIdentifier(value, field, maximum) {
  if (value === null) return null;
  return assertSafeStructuralIdentifier(value, field, maximum);
}

function structuralIdentifier(value, field, maximum) {
  return assertSafeStructuralIdentifier(value, field, maximum);
}

function normalizedInstanceId(value) {
  const normalized = structuralIdentifier(value, "instanceId", 128);
  try {
    return assertInstanceId(normalized);
  } catch (error) {
    throw createSafeError("instanceId 无效。", error);
  }
}

function normalizedProjectId(value) {
  const normalized = structuralIdentifier(value, "projectId", 128);
  try {
    return assertProjectId(normalized);
  } catch (error) {
    throw createSafeError("projectId 无效。", error);
  }
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
  CONVERSATION_STATE_SCHEMA_VERSION,
  CONVERSATION_STATUSES,
  DEFAULT_CONVERSATION_DATA_DIRECTORY,
  DEFAULT_CONVERSATION_STATE_PATH,
  MAX_CONVERSATION_TITLE_LENGTH,
  MAX_SESSION_KEY_LENGTH,
  CONVERSATION_STATE_LOCK_FILENAME,
  createEmptyConversationState,
  getConversationState,
  listConversationStates,
  normalizeConversationState,
  normalizeSessionKey,
  readConversationState,
  resolveConversationStateLockPath,
  updateConversationState,
  writeConversationState
};
