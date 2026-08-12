const crypto = require("node:crypto");
const publicApi = require("../../index");
const {
  assertSafeStructuralIdentifier,
  sanitizeConversationTitle,
  sanitizePublicErrorMessage,
  sanitizeVisibleText
} = require("../../core/conversations/security");

const INSTANCE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CONVERSATION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_OPEN_ERROR = "暂时无法打开 Agent 对话，请稍后重试。";
const SAFE_LIST_ERROR = "暂时无法读取对话消息，请稍后重试。";
const SAFE_SEND_ERROR = "消息发送未完成，请稍后重试。";
const SAFE_RECONCILE_ERROR = "对话状态恢复未完成，请稍后重试。";
const SAFE_CONVERSATION_LIST_ERROR = "聊天列表暂时无法加载，请稍后重试。";
const SAFE_CREATE_ERROR = "新聊天创建未完成，请稍后重试。";
const MESSAGE_PREVIEW_LENGTH = 80;
const CONVERSATION_TITLE_LENGTH = 100;

function createConversationService(api = publicApi, options = {}) {
  const conversationOptions = normalizeOptions(options.conversationOptions);
  const instanceOptions = normalizeOptions(options.instanceOptions);
  const roleOptions = normalizeOptions(options.roleOptions);
  const createConversationId =
    typeof options.createConversationId === "function"
      ? options.createConversationId
      : () => `chat-${crypto.randomUUID()}`;

  async function requireRegisteredInstance(instanceId) {
    const normalized = normalizeIdentifier(
      instanceId,
      INSTANCE_ID_PATTERN,
      "Agent Instance 标识无效。"
    );
    const instance = await api.inspectInstance(normalized, instanceOptions);
    if (!instance || instance.status !== "registered") {
      throw new Error("Agent Instance 当前不可用，请先修复注册状态。");
    }
    return instance;
  }

  async function requireAvailableConversation(instanceId, conversationId) {
    const expectedInstance = await requireRegisteredInstance(instanceId);
    const normalized = normalizeIdentifier(
      conversationId,
      CONVERSATION_ID_PATTERN,
      "Conversation 标识无效。"
    );
    const conversation = await api.inspectConversation(
      normalized,
      conversationOptions
    );
    if (conversation.instanceId !== expectedInstance.instanceId) {
      throw new Error("Conversation 不属于当前 Agent Instance。");
    }
    return conversation;
  }

  async function readMessages(conversationId, pagination = {}) {
    const filters = normalizePagination(pagination);
    const records = await api.listMessages(
      conversationId,
      filters,
      conversationOptions
    );
    const messages = (Array.isArray(records) ? records : [])
      .map(toMessageDto)
      .sort((left, right) => (
        left.sequence - right.sequence ||
        left.messageId.localeCompare(right.messageId)
      ));
    return {
      messages,
      hasMore:
        messages.length === filters.limit &&
        messages.length > 0 &&
        messages[0].sequence > 1,
      nextBeforeSequence:
        messages.length > 0 ? messages[0].sequence : null
    };
  }

  return {
    async listChatConversations() {
      try {
        await reconcileInstancesBestEffort();
        const [instanceRecords, registry, installedRoles, conversations] =
          await Promise.all([
            api.listInstances(instanceOptions),
            api.scanRoleRegistry(roleOptions),
            api.listInstalledRoles(roleOptions),
            api.listConversations(conversationOptions)
          ]);
        const availableAgents = createAvailableAgentMap(
          instanceRecords,
          registry,
          installedRoles
        );
        const active = (Array.isArray(conversations) ? conversations : [])
          .filter((conversation) => (
            conversation &&
            conversation.status === "active" &&
            availableAgents.has(conversation.instanceId)
          ))
          .sort(compareRecentConversations);
        const items = [];

        for (const conversation of active) {
          const agent = availableAgents.get(conversation.instanceId);
          const messages = await api.listMessages(
            conversation.conversationId,
            { limit: 1 },
            conversationOptions
          );
          const lastMessage = Array.isArray(messages) && messages.length > 0
            ? messages[messages.length - 1]
            : null;
          items.push(toChatConversationDto(conversation, agent, lastMessage));
        }

        return {
          ok: true,
          conversations: items.sort(compareChatConversationDtos),
          message: ""
        };
      } catch (error) {
        return {
          ok: false,
          conversations: [],
          message: SAFE_CONVERSATION_LIST_ERROR
        };
      }
    },

    async getOrCreateAgentConversation(instanceId) {
      try {
        const instance = await requireRegisteredInstance(instanceId);
        const all = await api.listConversations(conversationOptions);
        const active = (Array.isArray(all) ? all : [])
          .filter((conversation) => (
            conversation.instanceId === instance.instanceId &&
            conversation.status === "active"
          ))
          .sort(compareRecentConversations);
        const conversation = active[0] || await api.createConversation({
          conversationId: normalizeIdentifier(
            createConversationId(),
            CONVERSATION_ID_PATTERN,
            "无法创建安全的 Conversation 标识。"
          ),
          instanceId: instance.instanceId
        }, conversationOptions);
        const history = await readMessages(conversation.conversationId);
        return createChatResponse({
          ok: true,
          conversation: toConversationDto(conversation),
          ...history,
          message: active.length > 0 ? "已载入最近对话。" : "已创建新对话。"
        });
      } catch (error) {
        return createChatResponse({
          message: safeErrorMessage(error, SAFE_OPEN_ERROR)
        });
      }
    },

    async createNewAgentConversation(instanceId, title) {
      try {
        const instance = await requireRegisteredInstance(instanceId);
        const conversationTitle = normalizeConversationTitleInput(title);
        const conversation = await api.createConversation({
          conversationId: normalizeIdentifier(
            createConversationId(),
            CONVERSATION_ID_PATTERN,
            "无法创建安全的 Conversation 标识。"
          ),
          instanceId: instance.instanceId,
          title: conversationTitle
        }, conversationOptions);
        const history = await readMessages(conversation.conversationId);
        return createChatResponse({
          ok: true,
          conversation: toConversationDto(conversation),
          ...history,
          message: "已创建新聊天。"
        });
      } catch (error) {
        return createChatResponse({
          message: safeErrorMessage(error, SAFE_CREATE_ERROR)
        });
      }
    },

    async openChatConversation(conversationId) {
      try {
        const normalized = normalizeIdentifier(
          conversationId,
          CONVERSATION_ID_PATTERN,
          "Conversation 标识无效。"
        );
        const conversation = await api.inspectConversation(
          normalized,
          conversationOptions
        );
        const instance = await requireRegisteredInstance(conversation.instanceId);
        if (conversation.instanceId !== instance.instanceId) {
          throw new Error("Conversation 助手归属无效。");
        }
        const history = await readMessages(conversation.conversationId);
        return createChatResponse({
          ok: true,
          conversation: toConversationDto(conversation),
          ...history,
          message: ""
        });
      } catch (error) {
        return createChatResponse({
          message: safeErrorMessage(error, SAFE_OPEN_ERROR)
        });
      }
    },

    async listAgentConversations(instanceId) {
      try {
        const instance = await requireRegisteredInstance(instanceId);
        const all = await api.listConversations(conversationOptions);
        return {
          ok: true,
          conversations: (Array.isArray(all) ? all : [])
            .filter((conversation) => conversation.instanceId === instance.instanceId)
            .sort(compareRecentConversations)
            .map(toConversationDto),
          message: ""
        };
      } catch (error) {
        return {
          ok: false,
          conversations: [],
          message: safeErrorMessage(error, SAFE_LIST_ERROR)
        };
      }
    },

    async listConversationMessages(instanceId, conversationId, pagination = {}) {
      try {
        const conversation = await requireAvailableConversation(
          instanceId,
          conversationId
        );
        const history = await readMessages(
          conversation.conversationId,
          pagination
        );
        return createChatResponse({
          ok: true,
          conversation: toConversationDto(conversation),
          ...history,
          message: ""
        });
      } catch (error) {
        return createChatResponse({
          message: safeErrorMessage(error, SAFE_LIST_ERROR)
        });
      }
    },

    async sendConversationMessage(instanceId, conversationId, content) {
      try {
        const conversation = await requireAvailableConversation(
          instanceId,
          conversationId
        );
        await ensureConversationInstanceReady(conversation.instanceId);
        const message = normalizeMessageContent(content);
        const turn = await api.sendMessage(
          conversation.conversationId,
          { message },
          conversationOptions
        );
        const latestConversation = await api.inspectConversation(
          conversation.conversationId,
          conversationOptions
        );
        const history = await readMessages(conversation.conversationId);
        const assistantStatus = turn && turn.assistantMessage
          ? turn.assistantMessage.status
          : null;
        const succeeded = assistantStatus === "completed";
        return createChatResponse({
          ok: succeeded,
          conversation: toConversationDto(latestConversation),
          ...history,
          message: succeeded
            ? "消息已完成处理。"
            : safeErrorMessage(
              turn && turn.assistantMessage
                ? { message: turn.assistantMessage.errorSummary }
                : null,
              SAFE_SEND_ERROR
            )
        });
      } catch (error) {
        const recovered = await recoverConversationSnapshot(
          api,
          instanceId,
          conversationId,
          conversationOptions,
          instanceOptions,
          readMessages
        );
        return createChatResponse({
          ...recovered,
          message: safeErrorMessage(error, SAFE_SEND_ERROR)
        });
      }
    },

    async reconcileAgentConversation(instanceId, conversationId) {
      try {
        const conversation = await requireAvailableConversation(
          instanceId,
          conversationId
        );
        await api.reconcileConversations(conversationOptions);
        const latestConversation = await api.inspectConversation(
          conversation.conversationId,
          conversationOptions
        );
        const history = await readMessages(conversation.conversationId);
        return createChatResponse({
          ok: true,
          conversation: toConversationDto(latestConversation),
          ...history,
          message: "对话状态已检查。"
        });
      } catch (error) {
        return createChatResponse({
          message: safeErrorMessage(error, SAFE_RECONCILE_ERROR)
        });
      }
    }
  };

  async function reconcileInstancesBestEffort() {
    if (typeof api.reconcileInstances !== "function") {
      return null;
    }
    try {
      return await api.reconcileInstances(instanceOptions);
    } catch (error) {
      return null;
    }
  }

  async function ensureConversationInstanceReady(instanceId) {
    await api.reconcileInstances(instanceOptions);
    const instance = await api.inspectInstance(instanceId, instanceOptions);
    if (!instance || instance.instanceId === "main") {
      throw new Error("该角色的 OpenClaw Agent 已丢失，请重新安装或修复角色。");
    }
    if (instance.status === "registered") {
      return instance;
    }
    if (instance.status !== "missing") {
      throw new Error("该角色的 OpenClaw Agent 配置异常，请刷新状态或修复角色。");
    }
    if (!instance.roleId || !instance.roleAgentId) {
      throw new Error("该角色的 OpenClaw Agent 已丢失，请重新安装或修复角色。");
    }

    await api.registerInstance(instance.roleId, instance.roleAgentId, instanceOptions);
    const repaired = await api.inspectInstance(instanceId, instanceOptions);
    if (!repaired || repaired.status !== "registered") {
      throw new Error("该角色的 OpenClaw Agent 已丢失，请重新安装或修复角色。");
    }
    return repaired;
  }
}

function createAvailableAgentMap(instanceRecords, registry, installedRoles) {
  const installedRoleIds = new Set(
    (Array.isArray(installedRoles) ? installedRoles : [])
      .map((role) => safeText(role && role.id))
      .filter(Boolean)
  );
  const roles = new Map(
    (Array.isArray(registry && registry.roles) ? registry.roles : [])
      .map((role) => [safeText(role && role.id), role])
      .filter(([roleId]) => roleId && installedRoleIds.has(roleId))
  );
  const available = new Map();

  for (const instance of Array.isArray(instanceRecords) ? instanceRecords : []) {
    if (!instance || instance.status !== "registered") continue;
    const role = roles.get(safeText(instance.roleId));
    if (!role) continue;
    const agent = (Array.isArray(role.agents) ? role.agents : [])
      .find((candidate) => candidate.id === instance.roleAgentId);
    if (!agent) continue;
    available.set(safeText(instance.instanceId), {
      agentName: safeDisplayText(agent.name, 100, "助手"),
      roleName: safeDisplayText(role.name, 100, "已安装角色")
    });
  }
  return available;
}

function toChatConversationDto(conversation, agent, lastMessage) {
  return {
    conversationId: safeText(conversation && conversation.conversationId),
    instanceId: safeText(conversation && conversation.instanceId),
    agentName: agent.agentName,
    roleName: agent.roleName,
    title: createChatConversationTitle(conversation, agent),
    status: "active",
    lastMessagePreview: createLastMessagePreview(lastMessage),
    updatedAt: safeTimestamp(
      (lastMessage && (lastMessage.updatedAt || lastMessage.createdAt)) ||
      (conversation && conversation.updatedAt)
    )
  };
}

function createChatConversationTitle(conversation, agent) {
  const instanceId = safeText(conversation && conversation.instanceId);
  const title = safeDisplayText(
    conversation && conversation.title,
    120,
    agent.agentName
  );
  const legacyTitles = new Set([
    `与 ${instanceId} 的对话`,
    `与${instanceId}的对话`
  ]);
  return instanceId && legacyTitles.has(title)
    ? `与${agent.agentName}的对话`
    : title;
}

function createLastMessagePreview(message) {
  if (!message) return "还没有消息";
  if (typeof message.content === "string" && message.content.trim()) {
    return safeDisplayText(message.content, MESSAGE_PREVIEW_LENGTH, "消息");
  }
  if (message.status === "failed") return "消息处理失败";
  if (message.status === "interrupted") return "消息已中断";
  return "消息处理中";
}

function safeDisplayText(value, maximum, fallback) {
  const sanitized = sanitizeVisibleText(
    typeof value === "string" ? value : "",
    maximum
  );
  return sanitized || fallback;
}

function compareChatConversationDtos(left, right) {
  return (
    String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")) ||
    left.conversationId.localeCompare(right.conversationId)
  );
}

function normalizeOptions(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...value }
    : {};
}

function normalizeIdentifier(value, pattern, message) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 128 ||
    !pattern.test(value) ||
    value === "main"
  ) {
    throw new Error(message);
  }
  return value;
}

function normalizeMessageContent(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("消息内容不能为空。");
  }
  if (value.length > 8000) {
    throw new Error("消息内容不能超过 8000 个字符。");
  }
  return value;
}

function normalizeConversationTitleInput(value) {
  if (value === undefined || value === null || !String(value).trim()) {
    return "新的助手对话";
  }
  if (typeof value !== "string") {
    throw new Error("聊天名称无效。");
  }
  const safeInput = assertSafeStructuralIdentifier(
    value,
    "聊天名称",
    CONVERSATION_TITLE_LENGTH
  );
  return sanitizeConversationTitle(safeInput, CONVERSATION_TITLE_LENGTH);
}

function normalizePagination(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { limit: 50 };
  }
  const allowed = new Set(["limit", "beforeSequence"]);
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      throw new Error("消息分页参数无效。");
    }
  }
  const limit = value.limit === undefined ? 50 : value.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("消息分页数量无效。");
  }
  if (
    value.beforeSequence !== undefined &&
    (!Number.isInteger(value.beforeSequence) || value.beforeSequence <= 0)
  ) {
    throw new Error("消息分页位置无效。");
  }
  return value.beforeSequence === undefined
    ? { limit }
    : { limit, beforeSequence: value.beforeSequence };
}

function compareRecentConversations(left, right) {
  return (
    String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")) ||
    String(right.createdAt || "").localeCompare(String(left.createdAt || "")) ||
    String(left.conversationId || "").localeCompare(String(right.conversationId || ""))
  );
}

function toConversationDto(conversation) {
  return {
    conversationId: safeText(conversation && conversation.conversationId),
    title: safeDisplayText(
      conversation && conversation.title,
      CONVERSATION_TITLE_LENGTH,
      "新的助手对话"
    ),
    instanceId: safeText(conversation && conversation.instanceId),
    status: ["active", "archived"].includes(conversation && conversation.status)
      ? conversation.status
      : "unknown",
    messageCount: safeInteger(conversation && conversation.messageCount),
    lastMessageAt: safeTimestamp(conversation && conversation.lastMessageAt),
    canSend: conversation && conversation.canSend === true,
    createdAt: safeTimestamp(conversation && conversation.createdAt),
    updatedAt: safeTimestamp(conversation && conversation.updatedAt),
    archivedAt: safeTimestamp(conversation && conversation.archivedAt)
  };
}

function toMessageDto(message) {
  const role = message && message.role === "user" ? "user" : "assistant";
  const status = [
    "pending",
    "sending",
    "completed",
    "failed",
    "interrupted"
  ].includes(message && message.status)
    ? message.status
    : "failed";
  return {
    messageId: safeText(message && message.messageId),
    sequence: safeInteger(message && message.sequence),
    role,
    status,
    content:
      typeof (message && message.content) === "string"
        ? message.content
        : null,
    errorSummary:
      typeof (message && message.errorSummary) === "string"
        ? sanitizePublicErrorMessage(
          message.errorSummary,
          500,
          "消息处理失败。"
        )
        : null,
    createdAt: safeTimestamp(message && message.createdAt),
    updatedAt: safeTimestamp(message && message.updatedAt)
  };
}

function createChatResponse(overrides = {}) {
  return {
    ok: false,
    conversation: null,
    messages: [],
    hasMore: false,
    nextBeforeSequence: null,
    message: SAFE_OPEN_ERROR,
    ...overrides
  };
}

function safeErrorMessage(error, fallback) {
  return sanitizePublicErrorMessage(
    error && error.message,
    500,
    fallback
  );
}

function safeText(value) {
  return typeof value === "string" ? value : "";
}

function safeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function safeTimestamp(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  return value;
}

async function recoverConversationSnapshot(
  api,
  instanceId,
  conversationId,
  conversationOptions,
  instanceOptions,
  readMessages
) {
  try {
    const normalizedInstanceId = normalizeIdentifier(
      instanceId,
      INSTANCE_ID_PATTERN,
      "Agent Instance 标识无效。"
    );
    const normalizedConversationId = normalizeIdentifier(
      conversationId,
      CONVERSATION_ID_PATTERN,
      "Conversation 标识无效。"
    );
    const [instance, conversation] = await Promise.all([
      api.inspectInstance(normalizedInstanceId, instanceOptions),
      api.inspectConversation(normalizedConversationId, conversationOptions)
    ]);
    if (
      !instance ||
      instance.status !== "registered" ||
      conversation.instanceId !== normalizedInstanceId
    ) {
      return {};
    }
    const history = await readMessages(normalizedConversationId);
    return {
      conversation: toConversationDto(conversation),
      ...history
    };
  } catch (error) {
    return {};
  }
}

const conversationService = createConversationService();

module.exports = {
  createConversationService,
  createNewAgentConversation: conversationService.createNewAgentConversation,
  getOrCreateAgentConversation:
    conversationService.getOrCreateAgentConversation,
  listAgentConversations: conversationService.listAgentConversations,
  listChatConversations: conversationService.listChatConversations,
  listConversationMessages: conversationService.listConversationMessages,
  openChatConversation: conversationService.openChatConversation,
  reconcileAgentConversation:
    conversationService.reconcileAgentConversation,
  sendConversationMessage: conversationService.sendConversationMessage
};
