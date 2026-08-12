const {
  createOpenClawExecutionAdapter
} = require("../executions/openClawExecutionAdapter");
const { assertInstanceId } = require("../agent-instances/id");
const { MAX_USER_MESSAGE_LENGTH } = require("./messageState");
const {
  assertSafeStructuralIdentifier,
  createSafeError,
  sanitizeAssistantMessage,
  sanitizeErrorSummary,
} = require("./security");
const { normalizeSessionKey } = require("./state");

function createOpenClawConversationAdapter(options = {}) {
  const executionAdapter =
    options.executionAdapter ||
    createOpenClawExecutionAdapter({
      diagnosticLogger: options.diagnosticLogger,
      spawnImpl: options.spawnImpl,
      maxOutputBytes: options.maxOutputBytes,
      setTimeoutImpl: options.setTimeoutImpl,
      clearTimeoutImpl: options.clearTimeoutImpl
    });

  return {
    async sendConversationMessage(input, runtimeOptions = {}) {
      const normalized = normalizeInput(input);
      const runtime = normalizeRuntimeOptions(runtimeOptions);
      let result;
      try {
        result = await executionAdapter.startAgentExecution(
          {
            agentId: normalized.agentId,
            prompt: normalized.message,
            sessionKey: normalized.sessionKey,
            timeoutMs: normalized.timeoutMs
          },
          runtime
        );
      } catch (error) {
        throw createSafeError(
          "OpenClaw Conversation Adapter 调用失败。",
          error
        );
      }
      return mapResult(result);
    }
  };
}

function normalizeRuntimeOptions(runtimeOptions) {
  if (
    !runtimeOptions ||
    typeof runtimeOptions !== "object" ||
    Array.isArray(runtimeOptions)
  ) {
    throw new Error("OpenClaw Conversation Adapter runtimeOptions 必须是对象。");
  }
  for (const field of Object.keys(runtimeOptions)) {
    if (field !== "onSpawn") {
      throw new Error(
        "OpenClaw Conversation Adapter runtimeOptions 只允许 onSpawn。"
      );
    }
  }
  if (
    Object.hasOwn(runtimeOptions, "onSpawn") &&
    typeof runtimeOptions.onSpawn !== "function"
  ) {
    throw new Error("onSpawn 必须是函数。");
  }
  return Object.hasOwn(runtimeOptions, "onSpawn")
    ? { onSpawn: runtimeOptions.onSpawn }
    : {};
}

function normalizeInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("OpenClaw Conversation Adapter 输入必须是对象。");
  }
  let agentId;
  try {
    const safeAgentId = assertSafeStructuralIdentifier(
      input.agentId,
      "agentId",
      128
    );
    agentId = assertInstanceId(safeAgentId);
  } catch (error) {
    throw createSafeError(
      error && error.message,
      error,
      { fallback: "agentId 无效。" }
    );
  }
  if (
    typeof input.message !== "string" ||
    !input.message.trim() ||
    input.message.trim().length > MAX_USER_MESSAGE_LENGTH
  ) {
    throw new Error(
      `Conversation message 必须是 1 到 ${MAX_USER_MESSAGE_LENGTH} 个字符。`
    );
  }
  const sessionKey = normalizeSessionKey(input.sessionKey);
  if (
    !Number.isInteger(input.timeoutMs) ||
    input.timeoutMs < 1000 ||
    input.timeoutMs > 3600000
  ) {
    throw new Error("timeoutMs 必须是 1000 到 3600000 之间的整数。");
  }
  return {
    agentId,
    message: input.message.trim(),
    sessionKey,
    timeoutMs: input.timeoutMs
  };
}

function mapResult(result) {
  if (result && result.ok) {
    return {
      ok: true,
      interrupted: false,
      timedOut: false,
      code: Number.isInteger(result.code) ? result.code : null,
      signal: typeof result.signal === "string" ? result.signal : null,
      content: sanitizeAssistantMessage(result.outputSummary, 4000),
      openClawSessionId: safeIdentifier(result.openClawSessionId),
      openClawRunId: safeIdentifier(result.openClawRunId),
      errorType: null,
      errorSummary: null
    };
  }
  return {
    ok: false,
    interrupted: Boolean(result && result.interrupted),
    timedOut: Boolean(result && result.timedOut),
    code: result && Number.isInteger(result.code) ? result.code : null,
    signal:
      result && typeof result.signal === "string" ? result.signal : null,
    content: null,
    openClawSessionId: null,
    openClawRunId: null,
    errorType:
      result && typeof result.errorType === "string"
        ? result.errorType
        : "adapter",
    errorSummary:
      result && typeof result.errorSummary === "string"
        ? sanitizeErrorSummary(result.errorSummary, 2000)
        : "OpenClaw Conversation Adapter 调用失败。"
  };
}

function safeIdentifier(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  return assertSafeStructuralIdentifier(value, "OpenClaw 标识", 300);
}

module.exports = {
  createOpenClawConversationAdapter
};
