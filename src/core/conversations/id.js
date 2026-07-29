const crypto = require("node:crypto");
const {
  assertSafeStructuralIdentifier,
  createSafeError
} = require("./security");

const CONVERSATION_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MESSAGE_ID_PATTERN = /^msg-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TURN_ID_PATTERN = /^turn-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_CONVERSATION_ID_LENGTH = 128;

function createMessageId() {
  return `msg-${crypto.randomUUID()}`;
}

function createTurnId() {
  return `turn-${crypto.randomUUID()}`;
}

function assertConversationId(conversationId) {
  assertSafeStructuralIdentifier(
    conversationId,
    "conversationId",
    MAX_CONVERSATION_ID_LENGTH
  );
  if (conversationId === "main") {
    throw createSafeError("main 是受保护名称，不能作为 Conversation id 操作。");
  }
  if (
    typeof conversationId !== "string" ||
    !CONVERSATION_ID_PATTERN.test(conversationId)
  ) {
    throw createSafeError("conversationId 无效。");
  }
  if (conversationId.length > MAX_CONVERSATION_ID_LENGTH) {
    throw createSafeError(
      `Conversation id 不能超过 ${MAX_CONVERSATION_ID_LENGTH} 个字符。`
    );
  }
  return conversationId;
}

function assertMessageId(messageId) {
  assertSafeStructuralIdentifier(messageId, "messageId", 40);
  if (typeof messageId !== "string" || !MESSAGE_ID_PATTERN.test(messageId)) {
    throw createSafeError("messageId 无效。");
  }
  return messageId;
}

function assertTurnId(turnId) {
  assertSafeStructuralIdentifier(turnId, "turnId", 41);
  if (typeof turnId !== "string" || !TURN_ID_PATTERN.test(turnId)) {
    throw createSafeError("turnId 无效。");
  }
  return turnId;
}

module.exports = {
  CONVERSATION_ID_PATTERN,
  MAX_CONVERSATION_ID_LENGTH,
  MESSAGE_ID_PATTERN,
  TURN_ID_PATTERN,
  assertConversationId,
  assertMessageId,
  assertTurnId,
  createMessageId,
  createTurnId
};
