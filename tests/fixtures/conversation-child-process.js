const fs = require("node:fs/promises");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..", "..");
const {
  archiveConversation,
  createConversation,
  reconcileConversations,
  sendMessage
} = require(path.join(projectRoot, "src/core/conversations/manager.js"));
const {
  listMessageStates,
  resolveMessageStatePath,
  updateMessageState
} = require(path.join(projectRoot, "src/core/conversations/messageState.js"));
const {
  acquireAgentCallLease,
  releaseAgentCallLease
} = require(path.join(projectRoot, "src/core/openclaw-agent/agentCallLease.js"));
const {
  withFileLeaseMutationGuard
} = require(path.join(projectRoot, "src/core/conversations/fileLease.js"));

const config = JSON.parse(
  Buffer.from(process.argv[2] || "", "base64url").toString("utf8")
);

function options() {
  return {
    conversationStatePath: config.conversationStatePath,
    conversationStateLockPath: config.conversationStateLockPath,
    messageStateDirectory: config.messageStateDirectory,
    messageStateLockDirectory: config.messageStateLockDirectory,
    instanceStatePath: config.instanceStatePath,
    projectStatePath: config.projectStatePath,
    agentCallLeasePath: config.agentCallLeasePath,
    conversationOperationLockDirectory:
      config.conversationOperationLockDirectory,
    now: () => new Date(config.now),
    createSessionKey: ({ conversationId, instanceId }) =>
      `agent:${instanceId}:toolbox-conversation-${conversationId}`,
    createMessageId: createValueGenerator(config.messageIds || []),
    createTurnId: createValueGenerator(config.turnIds || []),
    openClawConversationAdapter: {
      async sendConversationMessage(_input, runtime = {}) {
        if (runtime.onSpawn) await runtime.onSpawn({ pid: process.pid });
        if (config.adapterCallsPath) {
          await fs.appendFile(config.adapterCallsPath, "call\n", "utf8");
        }
        if (config.adapterEnteredPath) {
          await fs.writeFile(config.adapterEnteredPath, "entered\n", "utf8");
        }
        if (config.adapterReleasePath) {
          await waitForFile(config.adapterReleasePath, config.timeoutMs || 10000);
        }
        return {
          ok: true,
          interrupted: false,
          timedOut: false,
          code: 0,
          signal: null,
          content: "Mock 子进程回复",
          openClawSessionId: "session-safe",
          openClawRunId: "run-safe",
          errorType: null,
          errorSummary: null
        };
      }
    }
  };
}

async function main() {
  const managerOptions = options();
  switch (config.action) {
    case "create":
      return createConversation(
        {
          conversationId: config.conversationId,
          instanceId: "test-role-worker",
          title: config.title || config.conversationId
        },
        managerOptions
      );
    case "append-turn":
      return appendTurn(managerOptions);
    case "send":
      return sendMessage(
        config.conversationId,
        { message: config.message || "安全测试消息", timeoutMs: 5000 },
        managerOptions
      );
    case "archive":
      return archiveConversation(
        config.conversationId,
        { confirm: true },
        managerOptions
      );
    case "reconcile":
      return reconcileConversations(managerOptions);
    case "agent-call-critical":
      return runAgentCallCritical();
    case "mutation-guard-hold":
      return holdMutationGuard();
    case "agent-call-once":
      return runAgentCallOnce();
    default:
      throw new Error("未知子进程动作");
  }
}

async function holdMutationGuard() {
  return withFileLeaseMutationGuard(
    config.agentCallLeasePath,
    async () => {
      await fs.writeFile(config.guardEnteredPath, "entered\n", "utf8");
      await waitForFile(config.guardReleasePath, config.timeoutMs || 10000);
      return { released: true };
    }
  );
}

async function runAgentCallOnce() {
  const holder = {
    operationId: config.operationId,
    operationType: "conversation",
    instanceId: "test-role-worker",
    pid: process.pid,
    createdAt: new Date().toISOString()
  };
  await acquireAgentCallLease(config.agentCallLeasePath, holder);
  const released = await releaseAgentCallLease(
    config.agentCallLeasePath,
    holder
  );
  return { acquired: true, released };
}

async function runAgentCallCritical() {
  await waitForFile(config.startBarrierPath, config.timeoutMs || 10000);
  const holder = {
    operationId: config.operationId,
    operationType: "conversation",
    instanceId: "test-role-worker",
    pid: process.pid,
    createdAt: config.now
  };
  try {
    await acquireAgentCallLease(config.agentCallLeasePath, holder);
  } catch (error) {
    await fs.appendFile(
      config.criticalBusyPath,
      `${config.operationId}:busy\n`,
      "utf8"
    );
    return { entered: false, error: error.message, code: error.code };
  }

  let markerHandle = null;
  let overlap = false;
  try {
    try {
      markerHandle = await fs.open(config.criticalMarkerPath, "wx", 0o600);
    } catch (error) {
      if (!error || error.code !== "EEXIST") throw error;
      overlap = true;
    }
    await fs.appendFile(
      config.criticalEnteredPath,
      `${config.operationId}:${overlap ? "overlap" : "entered"}\n`,
      "utf8"
    );
    await waitForFile(config.criticalReleasePath, config.timeoutMs || 10000);
    return { entered: true, overlap };
  } finally {
    if (markerHandle) {
      await markerHandle.close().catch(() => {});
      await fs.rm(config.criticalMarkerPath, { force: true }).catch(() => {});
    }
    await releaseAgentCallLease(config.agentCallLeasePath, holder);
  }
}

async function appendTurn(managerOptions) {
  const messagePath = resolveMessageStatePath(
    config.messageStateDirectory,
    config.conversationId
  );
  return updateMessageState(
    messagePath,
    config.conversationId,
    async (state) => {
      if (config.barrierPath) {
        await fs.appendFile(config.barrierPath, "ready\n", "utf8");
        await waitForFile(config.barrierReleasePath, config.timeoutMs || 10000);
      }
      const messages = listMessageStates(state);
      const nextSequence = messages.length
        ? messages[messages.length - 1].sequence + 1
        : 1;
      const timestamp = config.now;
      state.messages[config.messageIds[0]] = messageRecord({
        messageId: config.messageIds[0],
        turnId: config.turnIds[0],
        conversationId: config.conversationId,
        sequence: nextSequence,
        role: "user",
        content: config.message || "User"
      }, timestamp);
      state.messages[config.messageIds[1]] = messageRecord({
        messageId: config.messageIds[1],
        turnId: config.turnIds[0],
        conversationId: config.conversationId,
        sequence: nextSequence + 1,
        role: "assistant",
        content: "Assistant"
      }, timestamp);
      return state;
    },
    {
      lockPath: path.join(
        config.messageStateLockDirectory,
        `${config.conversationId}.lock`
      ),
      now: managerOptions.now
    }
  );
}

function messageRecord(input, timestamp) {
  return {
    messageId: input.messageId,
    turnId: input.turnId,
    conversationId: input.conversationId,
    sequence: input.sequence,
    role: input.role,
    status: "completed",
    content: input.content,
    errorSummary: null,
    openClawSessionId: input.role === "assistant" ? "session-safe" : null,
    openClawRunId: input.role === "assistant" ? "run-safe" : null,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: timestamp,
    failedAt: null,
    interruptedAt: null
  };
}

function createValueGenerator(values) {
  const queue = [...values];
  return () => {
    if (!queue.length) throw new Error("测试 ID 队列为空");
    return queue.shift();
  };
}

async function waitForFile(filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fs.access(filePath);
      return;
    } catch (error) {
      if (!error || error.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("等待测试屏障超时");
}

main().then(
  (result) => {
    process.stdout.write(JSON.stringify({ ok: true, result }) + "\n");
  },
  (error) => {
    process.stdout.write(
      JSON.stringify({ ok: false, error: error.message, code: error.code }) +
        "\n"
    );
    process.exitCode = 2;
  }
);
