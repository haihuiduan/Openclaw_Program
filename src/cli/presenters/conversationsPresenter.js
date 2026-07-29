const {
  assertSafeStructuralIdentifier,
  sanitizeErrorSummary,
  sanitizeVisibleText
} = require("../../core/conversations/security");

function formatConversationList(conversations) {
  if (!conversations.length) {
    return "当前没有由 ToolBox 管理的 Conversation。";
  }
  return [
    "Conversations：",
    "",
    ...conversations.map(
      (conversation) =>
        `${safeIdentifier(conversation.conversationId)}  ` +
        `${safeVisible(conversation.title)}  ` +
        `${safeIdentifier(conversation.status)}  ` +
        `${safeCount(conversation.messageCount)} Messages`
    )
  ].join("\n");
}

function formatConversationInspect(conversation) {
  return [
    `Conversation ID：${safeIdentifier(conversation.conversationId)}`,
    `标题：${safeVisible(conversation.title)}`,
    `Agent Instance：${safeIdentifier(conversation.instanceId)}`,
    `Project：${conversation.projectId ? safeIdentifier(conversation.projectId) : "无"}`,
    `状态：${safeIdentifier(conversation.status)}`,
    `消息数量：${safeCount(conversation.messageCount)}`,
    `最近消息时间：${conversation.lastMessageAt ? safeIdentifier(conversation.lastMessageAt) : "无"}`,
    `OpenClaw Session：${conversation.hasOpenClawSession ? "已建立" : "未建立"}`,
    `可发送：${conversation.canSend ? "是" : "否"}`,
    `问题数量：${conversation.issues.length}`
  ].join("\n");
}

function formatConversationCreated(conversation) {
  return [
    `Conversation 创建完成：${safeIdentifier(conversation.conversationId)}`,
    `Agent Instance：${safeIdentifier(conversation.instanceId)}`,
    `标题：${safeVisible(conversation.title)}`
  ].join("\n");
}

function formatConversationSend(result) {
  const assistant = result.assistantMessage;
  const lines = [
    `Message 发送结果：${safeIdentifier(assistant.status)}`,
    `Conversation：${safeIdentifier(assistant.conversationId)}`,
    `Turn：${safeIdentifier(assistant.turnId)}`
  ];
  if (assistant.content) {
    lines.push("", safeVisible(assistant.content));
  }
  if (assistant.errorSummary) {
    lines.push(`错误摘要：${safeError(assistant.errorSummary)}`);
  }
  return lines.join("\n");
}

function formatConversationMessages(messages) {
  if (!messages.length) return "当前 Conversation 没有 Message。";
  return messages
    .map((message) => {
      const header =
        `#${safeCount(message.sequence)} ${safeIdentifier(message.role)} ` +
        `${safeIdentifier(message.status)} ` +
        `(${safeIdentifier(message.createdAt)})`;
      if (message.content) return `${header}\n${safeVisible(message.content)}`;
      if (message.errorSummary) {
        return `${header}\n错误摘要：${safeError(message.errorSummary)}`;
      }
      return header;
    })
    .join("\n\n");
}

function formatConversationArchived(conversation) {
  return [
    `Conversation 已归档：${safeIdentifier(conversation.conversationId)}`,
    "归档后为只读；首版不支持 unarchive 或 delete。"
  ].join("\n");
}

function formatConversationReconcile(result) {
  return [
    `Conversation reconcile 完成：${safeIdentifier(result.reconciledAt)}`,
    `标记 interrupted：${safeCount(result.interruptedMessageIds.length)}`,
    `修复 Session 认知：${safeCount(result.repairedConversationIds.length)}`,
    `跳过 busy Conversation：${(result.skippedConversationIds || []).length}`,
    `清理过期 Agent 调用租约：${result.staleLeaseRemoved ? "是" : "否"}`,
    `存在有效 Agent 调用：${result.activeAgentCall ? "是" : "否"}`
  ].join("\n");
}

function safeVisible(value) {
  return sanitizeVisibleText(value, 8000);
}

function safeError(value) {
  return sanitizeErrorSummary(value, 2000);
}

function safeIdentifier(value) {
  try {
    return assertSafeStructuralIdentifier(String(value || ""), "Presenter 标识", 300);
  } catch (error) {
    return "[REDACTED_IDENTIFIER]";
  }
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

module.exports = {
  formatConversationArchived,
  formatConversationCreated,
  formatConversationInspect,
  formatConversationList,
  formatConversationMessages,
  formatConversationReconcile,
  formatConversationSend
};
