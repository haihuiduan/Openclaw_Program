const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");
const {
  getInstanceState,
  readInstanceState
} = require("../agent-instances/state");
const { assertInstanceId } = require("../agent-instances/id");
const {
  DEFAULT_AGENT_CALL_LEASE_MAX_AGE_MS,
  DEFAULT_AGENT_CALL_LEASE_PATH,
  acquireAgentCallLease,
  clearStaleAgentCallLease,
  releaseAgentCallLease
} = require("../openclaw-agent/agentCallLease");
const {
  getProjectState,
  readProjectState
} = require("../projects/state");
const { assertProjectId } = require("../projects/id");
const {
  assertConversationId,
  createMessageId,
  createTurnId
} = require("./id");
const {
  DEFAULT_MESSAGE_STATE_DIRECTORY,
  MAX_ASSISTANT_MESSAGE_LENGTH,
  MAX_MESSAGES_PER_CONVERSATION,
  MAX_USER_MESSAGE_LENGTH,
  getMessageState,
  listMessageStates,
  readMessageState,
  resolveMessageStatePath,
  updateMessageState
} = require("./messageState");
const {
  createOpenClawConversationAdapter
} = require("./openClawConversationAdapter");
const {
  assertSafeStructuralIdentifier,
  createSafeError,
  sanitizeAssistantMessage,
  sanitizeErrorSummary,
  sanitizeUserMessage
} = require("./security");
const {
  DEFAULT_CONVERSATION_STATE_PATH,
  getConversationState,
  listConversationStates,
  normalizeSessionKey,
  readConversationState,
  updateConversationState
} = require("./state");
const {
  DEFAULT_CONVERSATION_OPERATION_LOCK_DIRECTORY,
  DEFAULT_CONVERSATION_OPERATION_LOCK_MAX_AGE_MS,
  acquireConversationOperationLock,
  releaseConversationOperationLock,
  withConversationLock
} = require("./locks");
const { isFileLeaseBusyError } = require("./fileLease");

const DEFAULT_TIMEOUT_MS = 600000;
const DEFAULT_INSTANCE_STATE_PATH = path.join(
  os.homedir(),
  ".openclaw-installer",
  "agent-instances",
  "state.json"
);
const DEFAULT_PROJECT_STATE_PATH = path.join(
  os.homedir(),
  ".openclaw-installer",
  "projects",
  "state.json"
);

async function listConversations(options = {}) {
  const settings = resolveSettings(options);
  const state = await settings.conversationStateStore.readConversationState(
    settings.conversationStatePath
  );
  const result = [];
  for (const conversation of listConversationStates(state)) {
    result.push(await buildConversationView(conversation, settings));
  }
  return result;
}

async function inspectConversation(conversationId, options = {}) {
  assertConversationId(conversationId);
  const settings = resolveSettings(options);
  const state = await settings.conversationStateStore.readConversationState(
    settings.conversationStatePath
  );
  const conversation = getConversationState(state, conversationId);
  if (!conversation) {
    throw new Error("未找到 Conversation：" + conversationId);
  }
  return buildConversationView(conversation, settings);
}

async function createConversation(input, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Conversation 创建参数必须是对象。");
  }
  const conversationId = assertConversationId(input.conversationId);
  const instanceId = normalizeInstanceId(input.instanceId);
  const projectId =
    input.projectId === undefined || input.projectId === null
      ? null
      : normalizeProjectId(input.projectId);
  return withConversationLock(conversationId, async () => {
    const settings = resolveSettings(options);
    const instanceState =
      await settings.instanceStateStore.readInstanceState(
        settings.instanceStatePath
      );
    const instance = getInstanceState(instanceState, instanceId);
    requireRegisteredInstance(instance, instanceId);

    if (projectId !== null) {
      const projectState =
        await settings.projectStateStore.readProjectState(
          settings.projectStatePath
        );
      if (!getProjectState(projectState, projectId)) {
        throw new Error("未找到 Project。");
      }
    }

    const sessionKey = normalizeSessionKey(
      settings.createSessionKey(
        Object.freeze({
          conversationId,
          instanceId: instance.instanceId
        })
      )
    );
    const messageState =
      await settings.messageStateStore.readMessageState(
        settings.resolveMessageStatePath(conversationId),
        conversationId
      );
    const messages = listMessageStates(messageState);
    if (messages.length) {
      throw new Error(
        "Conversation 创建前已存在孤立 Message State。"
      );
    }
    const timestamp = settings.now().toISOString();
    const record = {
      conversationId,
      title:
        input.title === undefined
          ? `与 ${instance.instanceId} 的对话`
          : input.title,
      instanceId: instance.instanceId,
      projectId,
      status: "active",
      sessionKey,
      openClawSessionId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      archivedAt: null
    };
    const updated =
      await settings.conversationStateStore.updateConversationState(
        settings.conversationStatePath,
        (state) => {
          if (state.conversations[conversationId]) {
            throw new Error("Conversation 已存在。");
          }
          state.conversations[conversationId] = record;
          return state;
        }
      );
    return buildConversationViewFromData(
      getConversationState(updated, conversationId),
      messages,
      instance
    );
  });
}

async function sendMessage(conversationId, input, options = {}) {
  assertConversationId(conversationId);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Conversation send 参数必须是对象。");
  }
  const safeUserMessage = sanitizeUserMessage(
    input.message,
    MAX_USER_MESSAGE_LENGTH
  );
  const timeoutMs = normalizeTimeout(input.timeoutMs);

  return withConversationLock(conversationId, async () => {
    const settings = resolveSettings(options);
    const turnId = settings.createTurnId();
    const userMessageId = settings.createMessageId();
    const assistantMessageId = settings.createMessageId();
    const messagePath = settings.resolveMessageStatePath(conversationId);
    const operationLock = {
      operationId: assistantMessageId,
      conversationId,
      operationType: "send",
      pid: process.pid,
      createdAt: settings.now().toISOString()
    };
    await settings.conversationOperationLockStore.acquire(
      settings.conversationOperationLockDirectory,
      operationLock
    );
    try {
      const initialConversationState =
        await settings.conversationStateStore.readConversationState(
          settings.conversationStatePath
        );
      const initialConversation = getConversationState(
        initialConversationState,
        conversationId
      );
      if (!initialConversation) {
        throw new Error("未找到 Conversation：" + conversationId);
      }
      const agentCallLease = {
        operationId: assistantMessageId,
        operationType: "conversation",
        instanceId: initialConversation.instanceId,
        pid: process.pid,
        createdAt: settings.now().toISOString()
      };
      await settings.agentCallLeaseStore.acquire(
        settings.agentCallLeasePath,
        agentCallLease
      );

      let pairCreated = false;
      let spawnObserved = false;
      try {
        const conversationState =
          await settings.conversationStateStore.readConversationState(
            settings.conversationStatePath
          );
        const conversation = getConversationState(
          conversationState,
          conversationId
        );
        if (!conversation) {
          throw new Error("未找到 Conversation：" + conversationId);
        }
        if (conversation.status !== "active") {
          throw new Error("archived Conversation 为只读，不能发送消息。");
        }

        const instanceState =
          await settings.instanceStateStore.readInstanceState(
            settings.instanceStatePath
          );
        const instance = getInstanceState(
          instanceState,
          conversation.instanceId
        );
        requireRegisteredInstance(instance, conversation.instanceId);

        const currentMessages =
          await settings.messageStateStore.readMessageState(
            messagePath,
            conversationId
          );
        assertNoActiveAssistant(currentMessages);
        if (
          listMessageStates(currentMessages).length + 2 >
          MAX_MESSAGES_PER_CONVERSATION
        ) {
          throw new Error(
            `Conversation 已达到 ${MAX_MESSAGES_PER_CONVERSATION} 条 Message 上限。`
          );
        }
        const timestamp = settings.now().toISOString();
        const existingMessages = listMessageStates(currentMessages);
        const nextSequence = existingMessages.length
          ? existingMessages[existingMessages.length - 1].sequence + 1
          : 1;
        await settings.messageStateStore.updateMessageState(
          messagePath,
          conversationId,
          (state) => {
            state.messages[userMessageId] = createUserMessage({
              messageId: userMessageId,
              turnId,
              conversationId,
              sequence: nextSequence,
              content: safeUserMessage,
              timestamp
            });
            state.messages[assistantMessageId] = createPendingAssistant({
              messageId: assistantMessageId,
              turnId,
              conversationId,
              sequence: nextSequence + 1,
              timestamp
            });
            return state;
          }
        );
        pairCreated = true;

        let result;
        try {
          result =
            await settings.openClawConversationAdapter.sendConversationMessage(
              {
                agentId: conversation.instanceId,
                message: safeUserMessage,
                sessionKey: conversation.sessionKey,
                timeoutMs
              },
              {
                onSpawn: async () => {
                  spawnObserved = true;
                  const startedAt = settings.now().toISOString();
                  await updateAssistant(
                    settings,
                    messagePath,
                    conversationId,
                    assistantMessageId,
                    (message) => {
                      message.status = "sending";
                      message.updatedAt = startedAt;
                    }
                  );
                }
              }
            );
        } catch (error) {
          result = {
            ok: false,
            interrupted: spawnObserved,
            errorType: "adapter",
            errorSummary: "OpenClaw Conversation Adapter 调用失败。"
          };
        }

        if (result.ok && !spawnObserved) {
          result = {
            ok: false,
            interrupted: true,
            errorType: "spawn-unconfirmed",
            errorSummary: "Adapter 未确认子进程启动，Conversation 按中断处理。"
          };
        }
        if (result.ok) {
          const completedAt = settings.now().toISOString();
          const safeAssistantContent = sanitizeAssistantMessage(
            result.content,
            MAX_ASSISTANT_MESSAGE_LENGTH
          );
          await updateAssistant(
            settings,
            messagePath,
            conversationId,
            assistantMessageId,
            (message) => {
              message.status = "completed";
              message.content = safeAssistantContent;
              message.errorSummary = null;
              message.openClawSessionId =
                result.openClawSessionId || null;
              message.openClawRunId = result.openClawRunId || null;
              message.completedAt = completedAt;
              message.updatedAt = completedAt;
            }
          );
          await settings.conversationStateStore.updateConversationState(
            settings.conversationStatePath,
            (state) => {
              const record = state.conversations[conversationId];
              if (!record) {
                throw new Error(
                  "Conversation 状态发生并发冲突：" + conversationId
                );
              }
              record.openClawSessionId =
                result.openClawSessionId || record.openClawSessionId;
              record.updatedAt = completedAt;
              return state;
            }
          );
        } else {
          const terminalAt = settings.now().toISOString();
          const interrupted =
            Boolean(result.interrupted) ||
            result.errorType === "spawn-callback" ||
            (spawnObserved && result.errorType === "adapter");
          await updateAssistant(
            settings,
            messagePath,
            conversationId,
            assistantMessageId,
            (message) => {
              message.status = interrupted ? "interrupted" : "failed";
              message.errorSummary = sanitizeErrorSummary(
                result.errorSummary,
                2000
              );
              message.failedAt = interrupted ? null : terminalAt;
              message.interruptedAt = interrupted ? terminalAt : null;
              message.updatedAt = terminalAt;
            }
          );
        }

        const latest =
          await settings.messageStateStore.readMessageState(
            messagePath,
            conversationId
          );
        return {
          userMessage: getMessageState(latest, userMessageId),
          assistantMessage: getMessageState(latest, assistantMessageId),
          conversation: await inspectConversation(conversationId, options)
        };
      } catch (error) {
        if (pairCreated) {
          const latest =
            await settings.messageStateStore.readMessageState(
              messagePath,
              conversationId
            );
          const assistant = getMessageState(latest, assistantMessageId);
          if (assistant && ["pending", "sending"].includes(assistant.status)) {
            const interruptedAt = settings.now().toISOString();
            await updateAssistant(
              settings,
              messagePath,
              conversationId,
              assistantMessageId,
              (message) => {
                message.status = "interrupted";
                message.errorSummary =
                  "Conversation Manager 在确认远端结果前失败，无法确认远端 Turn 状态。";
                message.interruptedAt = interruptedAt;
                message.updatedAt = interruptedAt;
              }
            ).catch(() => {});
          }
        }
        throw createSafeError(
          error && error.message,
          error,
          { fallback: "Conversation 发送失败。" }
        );
      } finally {
        await settings.agentCallLeaseStore.release(
          settings.agentCallLeasePath,
          agentCallLease
        ).catch(() => {});
      }
    } finally {
      await settings.conversationOperationLockStore.release(
        settings.conversationOperationLockDirectory,
        operationLock
      ).catch(() => {});
    }
  });
}

async function listMessages(conversationId, filters = {}, options = {}) {
  assertConversationId(conversationId);
  const settings = resolveSettings(options);
  const state = await settings.conversationStateStore.readConversationState(
    settings.conversationStatePath
  );
  if (!getConversationState(state, conversationId)) {
    throw new Error("未找到 Conversation：" + conversationId);
  }
  const normalized = normalizeMessageFilters(filters);
  const messageState = await settings.messageStateStore.readMessageState(
    settings.resolveMessageStatePath(conversationId),
    conversationId
  );
  const eligible = listMessageStates(messageState).filter(
    (message) =>
      normalized.beforeSequence === null ||
      message.sequence < normalized.beforeSequence
  );
  return eligible.slice(-normalized.limit);
}

async function archiveConversation(
  conversationId,
  input = {},
  options = {}
) {
  assertConversationId(conversationId);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Conversation archive 参数必须是对象。");
  }
  if (!input.confirm) {
    throw new Error("conversations archive 必须提供 --confirm。");
  }
  return withConversationLock(conversationId, async () => {
    const settings = resolveSettings(options);
    const operationLock = createOperationLock(
      conversationId,
      "archive",
      settings
    );
    await settings.conversationOperationLockStore.acquire(
      settings.conversationOperationLockDirectory,
      operationLock
    );
    try {
      const conversationState =
        await settings.conversationStateStore.readConversationState(
          settings.conversationStatePath
        );
      const currentConversation = getConversationState(
        conversationState,
        conversationId
      );
      if (!currentConversation) {
        throw new Error("未找到 Conversation：" + conversationId);
      }
      if (currentConversation.status === "archived") {
        throw new Error("Conversation 已归档：" + conversationId);
      }
      const messageState = await settings.messageStateStore.readMessageState(
        settings.resolveMessageStatePath(conversationId),
        conversationId
      );
      assertNoActiveAssistant(messageState);
      const timestamp = settings.now().toISOString();
      const updated =
        await settings.conversationStateStore.updateConversationState(
          settings.conversationStatePath,
          (state) => {
            const conversation = state.conversations[conversationId];
            if (!conversation) {
              throw new Error("未找到 Conversation：" + conversationId);
            }
            if (conversation.status === "archived") {
              throw new Error("Conversation 已归档：" + conversationId);
            }
            conversation.status = "archived";
            conversation.archivedAt = timestamp;
            conversation.updatedAt = timestamp;
            return state;
          }
        );
      return buildConversationView(
        getConversationState(updated, conversationId),
        settings
      );
    } finally {
      await settings.conversationOperationLockStore.release(
        settings.conversationOperationLockDirectory,
        operationLock
      ).catch(() => {});
    }
  });
}

async function reconcileConversations(options = {}) {
  const settings = resolveSettings(options);
  const agentCallLeaseResult =
    await settings.agentCallLeaseStore.clearStale(
      settings.agentCallLeasePath
    );
  const reconciledAt = settings.now().toISOString();
  const state = await settings.conversationStateStore.readConversationState(
    settings.conversationStatePath
  );
  const interruptedMessageIds = [];
  const repairedConversationIds = [];
  const skippedConversationIds = [];

  for (const conversation of listConversationStates(state)) {
    if (conversation.status !== "active") continue;
    await withConversationLock(conversation.conversationId, async () => {
      const operationLock = createOperationLock(
        conversation.conversationId,
        "reconcile",
        settings
      );
      try {
        await settings.conversationOperationLockStore.acquire(
          settings.conversationOperationLockDirectory,
          operationLock
        );
      } catch (error) {
        if (isFileLeaseBusyError(error)) {
          skippedConversationIds.push(conversation.conversationId);
          return;
        }
        throw createSafeError(
          error && error.message,
          error,
          { fallback: "Conversation reconcile 失败。" }
        );
      }

      try {
        const latestConversationState =
          await settings.conversationStateStore.readConversationState(
            settings.conversationStatePath
          );
        const latestConversation = getConversationState(
          latestConversationState,
          conversation.conversationId
        );
        if (!latestConversation || latestConversation.status !== "active") {
          return;
        }
        const messagePath = settings.resolveMessageStatePath(
          conversation.conversationId
        );
        const messages = await settings.messageStateStore.readMessageState(
          messagePath,
          conversation.conversationId
        );
        let latestCompletedSessionId = null;
        for (const message of listMessageStates(messages)) {
          if (
            message.role === "assistant" &&
            message.status === "completed" &&
            message.openClawSessionId
          ) {
            latestCompletedSessionId = message.openClawSessionId;
          }
        }
        const active = listMessageStates(messages).filter(
          (message) =>
            message.role === "assistant" &&
            ["pending", "sending"].includes(message.status)
        );
        if (active.length) {
          await settings.messageStateStore.updateMessageState(
            messagePath,
            conversation.conversationId,
            (draft) => {
              for (const message of active) {
                const record = draft.messages[message.messageId];
                record.status = "interrupted";
                record.errorSummary =
                  "ToolBox 发现遗留 active Message，无法确认远端 Turn 状态，已标记 interrupted。";
                record.interruptedAt = reconciledAt;
                record.updatedAt = reconciledAt;
                interruptedMessageIds.push(record.messageId);
              }
              return draft;
            }
          );
        }
        if (
          latestCompletedSessionId &&
          latestCompletedSessionId !== latestConversation.openClawSessionId
        ) {
          await settings.conversationStateStore.updateConversationState(
            settings.conversationStatePath,
            (draft) => {
              const record = draft.conversations[conversation.conversationId];
              if (!record) {
                throw new Error(
                  "Conversation 状态发生并发冲突：" +
                  conversation.conversationId
                );
              }
              record.openClawSessionId = latestCompletedSessionId;
              record.updatedAt = reconciledAt;
              return draft;
            }
          );
          repairedConversationIds.push(conversation.conversationId);
        }
      } finally {
        await settings.conversationOperationLockStore.release(
          settings.conversationOperationLockDirectory,
          operationLock
        ).catch(() => {});
      }
    });
  }
  return {
    reconciledAt,
    interruptedMessageIds: interruptedMessageIds.sort(),
    repairedConversationIds: repairedConversationIds.sort(),
    skippedConversationIds: skippedConversationIds.sort(),
    staleLeaseRemoved: agentCallLeaseResult.removed,
    activeAgentCall:
      Boolean(agentCallLeaseResult.active) ||
      skippedConversationIds.length > 0
  };
}

async function buildConversationView(conversation, settings) {
  const messageState = await settings.messageStateStore.readMessageState(
    settings.resolveMessageStatePath(conversation.conversationId),
    conversation.conversationId
  );
  const messages = listMessageStates(messageState);
  const instanceState =
    await settings.instanceStateStore.readInstanceState(
      settings.instanceStatePath
    );
  const instance = getInstanceState(instanceState, conversation.instanceId);
  return buildConversationViewFromData(
    conversation,
    listMessageStates(messageState),
    instance
  );
}

function buildConversationViewFromData(conversation, messages, instance) {
  const issues = [];
  if (!instance) {
    issues.push({
      type: "instance-missing",
      instanceId: conversation.instanceId
    });
  } else if (instance.status !== "registered") {
    issues.push({
      type: "instance-not-registered",
      instanceId: instance.instanceId,
      status: instance.status
    });
  }
  return {
    conversationId: conversation.conversationId,
    title: conversation.title,
    instanceId: conversation.instanceId,
    projectId: conversation.projectId,
    status: conversation.status,
    hasOpenClawSession: Boolean(conversation.openClawSessionId),
    messageCount: messages.length,
    lastMessageAt: messages.length
      ? messages[messages.length - 1].createdAt
      : null,
    canSend: conversation.status === "active" && issues.length === 0,
    issues,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    archivedAt: conversation.archivedAt
  };
}

function createOperationLock(conversationId, operationType, settings) {
  return {
    operationId: `${operationType}-${crypto.randomUUID()}`,
    conversationId,
    operationType,
    pid: process.pid,
    createdAt: settings.now().toISOString()
  };
}

function createUserMessage(input) {
  return {
    messageId: input.messageId,
    turnId: input.turnId,
    conversationId: input.conversationId,
    sequence: input.sequence,
    role: "user",
    status: "completed",
    content: input.content,
    errorSummary: null,
    openClawSessionId: null,
    openClawRunId: null,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
    completedAt: input.timestamp,
    failedAt: null,
    interruptedAt: null
  };
}

function createPendingAssistant(input) {
  return {
    messageId: input.messageId,
    turnId: input.turnId,
    conversationId: input.conversationId,
    sequence: input.sequence,
    role: "assistant",
    status: "pending",
    content: null,
    errorSummary: null,
    openClawSessionId: null,
    openClawRunId: null,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
    completedAt: null,
    failedAt: null,
    interruptedAt: null
  };
}

async function updateAssistant(
  settings,
  messagePath,
  conversationId,
  messageId,
  mutation
) {
  return settings.messageStateStore.updateMessageState(
    messagePath,
    conversationId,
    (state) => {
      const message = state.messages[messageId];
      if (!message || message.role !== "assistant") {
        throw new Error("Assistant Message 状态发生并发冲突。");
      }
      mutation(message);
      return state;
    }
  );
}

function assertNoActiveAssistant(state) {
  const active = listMessageStates(state).find(
    (message) =>
      message.role === "assistant" &&
      ["pending", "sending"].includes(message.status)
  );
  if (active) {
    throw new Error(
      "Conversation 已存在 active Assistant Message。"
    );
  }
}

function requireRegisteredInstance(instance, instanceId) {
  if (!instance) {
    throw new Error("Agent Instance 当前不存在。");
  }
  if (instance.status !== "registered") {
    const status = ["missing", "drifted"].includes(instance.status)
      ? instance.status
      : "非 registered";
    throw new Error(
      `Agent Instance 必须处于 registered 状态（当前 ${status}）。`
    );
  }
}

function normalizeMessageFilters(filters) {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) {
    throw new Error("Message list 参数必须是对象。");
  }
  const allowed = new Set(["limit", "beforeSequence"]);
  for (const field of Object.keys(filters)) {
    if (!allowed.has(field)) {
      throw new Error("Message list 不支持参数：" + field);
    }
  }
  const limit = filters.limit === undefined ? 20 : filters.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("limit 必须是 1 到 100 之间的整数。");
  }
  const beforeSequence =
    filters.beforeSequence === undefined ? null : filters.beforeSequence;
  if (
    beforeSequence !== null &&
    (!Number.isInteger(beforeSequence) || beforeSequence <= 0)
  ) {
    throw new Error("beforeSequence 必须是正整数。");
  }
  return { limit, beforeSequence };
}

function normalizeTimeout(value) {
  const timeoutMs = value === undefined ? DEFAULT_TIMEOUT_MS : value;
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1000 ||
    timeoutMs > 3600000
  ) {
    throw new Error("timeoutMs 必须是 1000 到 3600000 之间的整数。");
  }
  return timeoutMs;
}

function defaultCreateSessionKey(input) {
  return `agent:${input.instanceId}:toolbox-conversation-${input.conversationId}`;
}

function normalizeInstanceId(value) {
  try {
    const normalized = assertSafeStructuralIdentifier(
      value,
      "instanceId",
      128
    );
    if (normalized === "main") return normalized;
    return assertInstanceId(normalized);
  } catch (error) {
    throw createSafeError(
      error && error.message,
      error,
      { fallback: "instanceId 无效。" }
    );
  }
}

function normalizeProjectId(value) {
  try {
    const normalized = assertSafeStructuralIdentifier(
      value,
      "projectId",
      128
    );
    if (normalized === "main") return normalized;
    return assertProjectId(normalized);
  } catch (error) {
    throw createSafeError(
      error && error.message,
      error,
      { fallback: "projectId 无效。" }
    );
  }
}

function resolveSettings(options = {}) {
  const now = options.now || (() => new Date());
  const createSessionKey =
    options.createSessionKey === undefined
      ? defaultCreateSessionKey
      : options.createSessionKey;
  if (typeof createSessionKey !== "function") {
    throw new Error("createSessionKey 必须是函数。");
  }
  const messageStateDirectory = path.resolve(
    options.messageStateDirectory || DEFAULT_MESSAGE_STATE_DIRECTORY
  );
  const conversationStatePath = path.resolve(
    options.conversationStatePath || DEFAULT_CONVERSATION_STATE_PATH
  );
  const conversationOperationLockDirectory = path.resolve(
    options.conversationOperationLockDirectory ||
      (
        options.messageStateDirectory || options.conversationStatePath
          ? path.join(path.dirname(messageStateDirectory), "operations")
          : DEFAULT_CONVERSATION_OPERATION_LOCK_DIRECTORY
      )
  );
  const messageStateLockDirectory = path.resolve(
    options.messageStateLockDirectory ||
      path.join(path.dirname(messageStateDirectory), "locks", "messages")
  );
  const fileSystem = options.fileSystem;
  const agentCallLeaseMaxAgeMs =
    options.agentCallLeaseMaxAgeMs === undefined
      ? DEFAULT_AGENT_CALL_LEASE_MAX_AGE_MS
      : options.agentCallLeaseMaxAgeMs;
  const stateLockOptions = {
    fileSystem,
    isProcessAlive: options.isProcessAlive,
    lockMaxAgeMs: options.stateLockMaxAgeMs,
    lockRetryMs: options.stateLockRetryMs,
    lockWaitMs: options.stateLockWaitMs,
    now
  };
  const conversationStateStore = protectStore(
    options.conversationStateStore || {
      readConversationState,
      updateConversationState: (statePath, updater) =>
        updateConversationState(statePath, updater, {
          ...stateLockOptions,
          lockPath: options.conversationStateLockPath
        })
    },
    ["readConversationState", "updateConversationState"],
    "Conversation 状态操作失败。"
  );
  const messageStateStore = protectStore(
    options.messageStateStore || {
      readMessageState,
      updateMessageState: (statePath, conversationId, updater) =>
        updateMessageState(statePath, conversationId, updater, {
          ...stateLockOptions,
          lockPath: path.join(
            messageStateLockDirectory,
            `${conversationId}.lock`
          )
        })
    },
    ["readMessageState", "updateMessageState"],
    "Message 状态操作失败。"
  );
  const instanceStateStore = protectStore(
    options.instanceStateStore || { readInstanceState },
    ["readInstanceState"],
    "Agent Instance 状态读取失败。"
  );
  const projectStateStore = protectStore(
    options.projectStateStore || { readProjectState },
    ["readProjectState"],
    "Project 状态读取失败。"
  );
  const agentCallLeaseStore = protectStore(
    options.agentCallLeaseStore || {
      acquire: (leasePath, metadata) =>
        acquireAgentCallLease(leasePath, metadata, { fileSystem }),
      release: (leasePath, holder) =>
        releaseAgentCallLease(leasePath, holder, { fileSystem }),
      clearStale: (leasePath) =>
        clearStaleAgentCallLease(leasePath, {
          fileSystem,
          isProcessAlive: options.isProcessAlive,
          maxAgeMs: agentCallLeaseMaxAgeMs,
          now
        })
    },
    ["acquire", "release", "clearStale"],
    "Agent 调用租约操作失败。"
  );
  const conversationOperationLockStore = protectStore(
    options.conversationOperationLockStore || {
      acquire: (directory, metadata) =>
        acquireConversationOperationLock(directory, metadata, {
          fileSystem,
          isProcessAlive: options.isProcessAlive,
          maxAgeMs:
            options.conversationOperationLockMaxAgeMs === undefined
              ? DEFAULT_CONVERSATION_OPERATION_LOCK_MAX_AGE_MS
              : options.conversationOperationLockMaxAgeMs,
          now
        }),
      release: (directory, holder) =>
        releaseConversationOperationLock(directory, holder, {
          fileSystem,
          now
        })
    },
    ["acquire", "release"],
    "Conversation 操作锁处理失败。"
  );
  return {
    conversationStatePath,
    messageStateDirectory,
    conversationOperationLockDirectory,
    instanceStatePath: path.resolve(
      options.instanceStatePath || DEFAULT_INSTANCE_STATE_PATH
    ),
    projectStatePath: path.resolve(
      options.projectStatePath || DEFAULT_PROJECT_STATE_PATH
    ),
    agentCallLeasePath: path.resolve(
      options.agentCallLeasePath || DEFAULT_AGENT_CALL_LEASE_PATH
    ),
    now,
    createSessionKey,
    createMessageId: options.createMessageId || createMessageId,
    createTurnId: options.createTurnId || createTurnId,
    resolveMessageStatePath: (conversationId) =>
      resolveMessageStatePath(messageStateDirectory, conversationId),
    conversationStateStore,
    messageStateStore,
    instanceStateStore,
    projectStateStore,
    openClawConversationAdapter:
      options.openClawConversationAdapter ||
      createOpenClawConversationAdapter({
        spawnImpl: options.spawnImpl,
        maxOutputBytes: options.maxOutputBytes
      }),
    agentCallLeaseStore,
    conversationOperationLockStore
  };
}

function protectStore(store, methods, fallback) {
  const protectedStore = { ...store };
  for (const method of methods) {
    if (typeof store[method] !== "function") continue;
    protectedStore[method] = async (...args) => {
      try {
        return await store[method](...args);
      } catch (error) {
        throw createSafeError(
          error && error.message,
          error,
          { fallback }
        );
      }
    };
  }
  return protectedStore;
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  archiveConversation,
  createConversation,
  inspectConversation,
  listConversations,
  listMessages,
  reconcileConversations,
  sendMessage
};
