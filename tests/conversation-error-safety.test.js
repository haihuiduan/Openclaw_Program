const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { projectPath } = require("./helpers");
const {
  acquireAgentCallLease,
  readAgentCallLease,
  releaseAgentCallLease
} = require(projectPath("src/core/openclaw-agent/agentCallLease.js"));
const {
  createOpenClawConversationAdapter
} = require(projectPath("src/core/conversations/openClawConversationAdapter.js"));
const {
  createConversation
} = require(projectPath("src/core/conversations/manager.js"));
const {
  createEmptyMessageState,
  readMessageState,
  writeMessageState
} = require(projectPath("src/core/conversations/messageState.js"));
const {
  createSafeError,
  sanitizeErrorSummary,
  sanitizePublicErrorMessage
} = require(projectPath("src/core/conversations/security.js"));
const {
  createEmptyConversationState,
  readConversationState,
  writeConversationState
} = require(projectPath("src/core/conversations/state.js"));
const {
  formatConversationSend
} = require(projectPath("src/cli/presenters/conversationsPresenter.js"));
const {
  reconcileExecutions
} = require(projectPath("src/core/executions/manager.js"));

const NOW = "2026-07-29T00:00:00.000Z";
const USER_PATH = "/Users/example/private-agent";
const PRIVATE_PATH = "/private/tmp/openclaw-state.json";
const WINDOWS_PATH = "C:\\Users\\example\\agent";
const UNC_PATH = "\\\\server\\share\\agent";

function tempRoot(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "openclaw-conversation-error-safety-")
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function assertSafeError(error, expectedCategory, forbidden = []) {
  assert.match(error.message, expectedCategory);
  for (const value of [
    ...forbidden,
    USER_PATH,
    PRIVATE_PATH,
    WINDOWS_PATH,
    UNC_PATH,
    "RAW_STDOUT_SECRET",
    "RAW_STDERR_SECRET",
    "fixture stack"
  ]) {
    assert.equal(
      error.message.includes(value),
      false,
      `错误信息不应包含 ${value}`
    );
  }
  assert.equal(Object.hasOwn(error, "stack"), true);
  assert.equal(error.stack, `${error.name}: ${error.message}`);
  assert.equal(Object.hasOwn(error, "cause"), false);
}

function conversationRecord() {
  return {
    conversationId: "test-chat",
    title: "测试",
    instanceId: "test-role-worker",
    projectId: null,
    status: "active",
    sessionKey: "agent:test-role-worker:toolbox-conversation-test-chat",
    openClawSessionId: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null
  };
}

test("统一错误清理隐藏绝对路径、内部字段、stack 和原始 JSON", () => {
  const raw = [
    `读取失败 ${USER_PATH}`,
    `备用位置 ${PRIVATE_PATH}`,
    `Windows ${WINDOWS_PATH}`,
    `UNC ${UNC_PATH}`,
    "stdout=RAW_STDOUT_SECRET",
    "stderr=RAW_STDERR_SECRET",
    "at fixture stack"
  ].join("\n");
  const safe = sanitizePublicErrorMessage(raw);
  assert.match(safe, /读取失败/);
  assert.match(safe, /\[REDACTED_PATH\]/);
  for (const value of [
    USER_PATH,
    PRIVATE_PATH,
    WINDOWS_PATH,
    UNC_PATH,
    "RAW_STDOUT_SECRET",
    "RAW_STDERR_SECRET",
    "fixture stack"
  ]) {
    assert.equal(safe.includes(value), false);
  }
  assert.equal(
    sanitizePublicErrorMessage('{"path":"/etc/passwd","raw":"secret"}'),
    "操作失败。"
  );
  assert.equal(
    sanitizePublicErrorMessage(
      "消息疑似包含 API Key、Bearer Token 或私钥，已拒绝发送和保存。"
    ),
    "消息疑似包含 API Key、Bearer Token 或私钥，已拒绝发送和保存。"
  );
  const source = new Error(raw);
  source.code = "EACCES";
  source.cause = new Error("raw cause");
  const wrapped = createSafeError(raw, source);
  assert.equal(wrapped.code, "EACCES");
  assert.equal(Object.hasOwn(wrapped, "cause"), false);
});

test("Conversation 和 Message State 损坏、读取与写入错误不回显路径或原文", async (t) => {
  const root = tempRoot(t);
  const conversationPath = path.join(root, "conversation-state.json");
  const messagePath = path.join(root, "message-state.json");
  fs.writeFileSync(conversationPath, '{"RAW_JSON_SECRET"', "utf8");
  fs.writeFileSync(messagePath, '{"RAW_MESSAGE_SECRET"', "utf8");

  await assert.rejects(
    () => readConversationState(conversationPath),
    (error) => {
      assertSafeError(error, /Conversation 状态文件损坏/, [
        root,
        "RAW_JSON_SECRET"
      ]);
      return true;
    }
  );
  await assert.rejects(
    () => readMessageState(messagePath, "test-chat"),
    (error) => {
      assertSafeError(error, /Message 状态文件损坏/, [
        root,
        "RAW_MESSAGE_SECRET"
      ]);
      return true;
    }
  );
  await assert.rejects(
    () => readConversationState(root),
    (error) => {
      assertSafeError(error, /Conversation 状态读取失败/, [root]);
      return true;
    }
  );
  await assert.rejects(
    () => readMessageState(root, "test-chat"),
    (error) => {
      assertSafeError(error, /Message 状态读取失败/, [root]);
      return true;
    }
  );

  const conversationDirectoryTarget = path.join(root, "conversation-target");
  fs.mkdirSync(conversationDirectoryTarget);
  const conversationState = createEmptyConversationState();
  conversationState.conversations["test-chat"] = conversationRecord();
  await assert.rejects(
    () => writeConversationState(conversationDirectoryTarget, conversationState),
    (error) => {
      assertSafeError(error, /Conversation 状态写入失败/, [
        conversationDirectoryTarget
      ]);
      return true;
    }
  );

  const messageDirectoryTarget = path.join(root, "message-target");
  fs.mkdirSync(messageDirectoryTarget);
  await assert.rejects(
    () => writeMessageState(
      messageDirectoryTarget,
      createEmptyMessageState("test-chat")
    ),
    (error) => {
      assertSafeError(error, /Message 状态写入失败/, [
        messageDirectoryTarget
      ]);
      return true;
    }
  );
});

test("Agent-call lease 损坏、读取和 unlink 失败只返回安全分类", async (t) => {
  const root = tempRoot(t);
  const leasePath = path.join(root, "active.lock");
  const lease = {
    operationId: "msg-00000000-0000-4000-8000-000000000001",
    operationType: "conversation",
    instanceId: "test-role-worker",
    pid: process.pid,
    createdAt: NOW
  };
  fs.writeFileSync(leasePath, '{"RAW_LEASE_SECRET"', "utf8");
  await assert.rejects(
    () => readAgentCallLease(leasePath),
    (error) => {
      assertSafeError(error, /Agent 调用租约文件损坏/, [
        root,
        "RAW_LEASE_SECRET"
      ]);
      return true;
    }
  );

  const readError = new Error(
    `read failed ${PRIVATE_PATH} stdout=RAW_STDOUT_SECRET`
  );
  readError.code = "EACCES";
  await assert.rejects(
    () => readAgentCallLease(leasePath, {
      fileSystem: {
        ...fsPromises,
        async readFile() {
          throw readError;
        }
      }
    }),
    (error) => {
      assertSafeError(error, /Agent 调用租约读取失败（权限不足）/, [
        readError.message
      ]);
      assert.equal(error.code, "EACCES");
      return true;
    }
  );

  fs.rmSync(leasePath);
  await acquireAgentCallLease(leasePath, lease);
  const fileSystem = {
    ...fsPromises,
    async rm(target, options) {
      if (path.resolve(target) === path.resolve(leasePath)) {
        const error = new Error(
          `unlink ${leasePath} failed stderr=RAW_STDERR_SECRET`
        );
        error.code = "EPERM";
        throw error;
      }
      return fsPromises.rm(target, options);
    }
  };
  await assert.rejects(
    () => releaseAgentCallLease(leasePath, lease, { fileSystem }),
    (error) => {
      assertSafeError(error, /Agent 调用租约释放失败（权限不足）/, [
        root
      ]);
      assert.equal(error.code, "EPERM");
      return true;
    }
  );
  assert.equal(fs.existsSync(leasePath), true);
  assert.equal(await releaseAgentCallLease(leasePath, lease), true);
});

test("非法结构 ID 和 Adapter 原始异常不会回显输入、路径或输出", async () => {
  for (const [field, value] of [
    ["instanceId", `agentDir=${USER_PATH}`],
    ["projectId", PRIVATE_PATH]
  ]) {
    await assert.rejects(
      () => createConversation({
        conversationId: "test-chat",
        instanceId:
          field === "instanceId" ? value : "test-role-worker",
        projectId: field === "projectId" ? value : null
      }),
      (error) => {
        assertSafeError(error, new RegExp(`${field}.*不安全路径|${field}.*敏感内容`), [
          value
        ]);
        return true;
      }
    );
  }

  const adapter = createOpenClawConversationAdapter({
    executionAdapter: {
      async startAgentExecution() {
        const error = new Error(
          `Adapter failed at ${PRIVATE_PATH} stdout=RAW_STDOUT_SECRET stderr=RAW_STDERR_SECRET`
        );
        error.stack = `Error: fixture stack\n    at ${USER_PATH}:1:1`;
        throw error;
      }
    }
  });
  await assert.rejects(
    () => adapter.sendConversationMessage({
      agentId: "test-role-worker",
      message: "安全消息",
      sessionKey: "agent:test-role-worker:toolbox-conversation-test-chat",
      timeoutMs: 60000
    }),
    (error) => {
      assertSafeError(error, /OpenClaw Conversation Adapter 调用失败/);
      return true;
    }
  );
  await assert.rejects(
    () => adapter.sendConversationMessage({
      agentId: `agentDir=${USER_PATH}`,
      message: "安全消息",
      sessionKey: "agent:test-role-worker:toolbox-conversation-test-chat",
      timeoutMs: 60000
    }),
    (error) => {
      assertSafeError(error, /agentId.*敏感内容/, [
        `agentDir=${USER_PATH}`
      ]);
      return true;
    }
  );
});

test("Manager、Presenter、CLI 与 Execution reconcile 保持安全错误边界", async () => {
  const rawStoreError = new Error(
    `state read failed ${USER_PATH} stdout=RAW_STDOUT_SECRET`
  );
  await assert.rejects(
    () => createConversation(
      {
        conversationId: "test-chat",
        instanceId: "test-role-worker",
        projectId: null
      },
      {
        instanceStateStore: {
          async readInstanceState() {
            throw rawStoreError;
          }
        }
      }
    ),
    (error) => {
      assertSafeError(error, /state read failed/, [rawStoreError.message]);
      return true;
    }
  );

  const presenter = formatConversationSend({
    assistantMessage: {
      status: "failed",
      conversationId: "test-chat",
      turnId: "turn-00000000-0000-4000-8000-000000000001",
      content: null,
      errorSummary: [
        `failure ${PRIVATE_PATH}`,
        "stdout=RAW_STDOUT_SECRET",
        "stderr=RAW_STDERR_SECRET"
      ].join("\n")
    }
  });
  assert.match(presenter, /错误摘要/);
  for (const value of [
    PRIVATE_PATH,
    "RAW_STDOUT_SECRET",
    "RAW_STDERR_SECRET"
  ]) {
    assert.equal(presenter.includes(value), false);
  }

  await assert.rejects(
    () => reconcileExecutions({
      leaseStore: {
        async clearStale() {
          return { active: false, removed: false, lease: null };
        }
      },
      agentCallLeaseStore: {
        async clearStale() {
          throw new Error(
            `lease failed ${PRIVATE_PATH} stderr=RAW_STDERR_SECRET`
          );
        }
      }
    }),
    (error) => {
      assertSafeError(error, /Agent 调用租约检查失败/);
      return true;
    }
  );

  const cli = spawnSync(
    process.execPath,
    [projectPath("bin/cli.js"), "conversations", "inspect", PRIVATE_PATH],
    { encoding: "utf8" }
  );
  assert.equal(cli.status, 1);
  assert.match(cli.stderr, /conversationId.*不安全路径/);
  assert.equal(cli.stderr.includes(PRIVATE_PATH), false);
  assert.equal(cli.stderr.includes(USER_PATH), false);

  const history = sanitizeErrorSummary(
    `历史错误 ${WINDOWS_PATH}\nstdout=RAW_STDOUT_SECRET`,
    2000
  );
  assert.match(history, /\[REDACTED_PATH\]/);
  assert.equal(history.includes(WINDOWS_PATH), false);
  assert.equal(history.includes("RAW_STDOUT_SECRET"), false);
});
