const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { projectPath } = require("./helpers");
const {
  archiveConversation,
  createConversation,
  inspectConversation,
  listConversations,
  listMessages,
  reconcileConversations,
  sendMessage
} = require(projectPath("src/core/conversations/manager.js"));
const {
  readConversationState
} = require(projectPath("src/core/conversations/state.js"));
const {
  readMessageState,
  resolveMessageStatePath,
  updateMessageState
} = require(projectPath("src/core/conversations/messageState.js"));
const {
  acquireAgentCallLease,
  releaseAgentCallLease
} = require(projectPath("src/core/openclaw-agent/agentCallLease.js"));
const {
  acquireConversationOperationLock,
  releaseConversationOperationLock
} = require(projectPath("src/core/conversations/locks.js"));
const {
  writeInstanceState
} = require(projectPath("src/core/agent-instances/state.js"));
const {
  writeProjectState
} = require(projectPath("src/core/projects/state.js"));
const {
  formatConversationInspect,
  formatConversationList,
  formatConversationMessages,
  formatConversationSend
} = require(projectPath("src/cli/presenters/conversationsPresenter.js"));

const MESSAGE_IDS = Array.from(
  { length: 20 },
  (_, index) =>
    `msg-00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
);
const TURN_IDS = Array.from(
  { length: 10 },
  (_, index) =>
    `turn-00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
);

function instance(root, id, status = "registered") {
  return {
    instanceId: id,
    roleId: "test-role",
    roleVersion: "1.0.0",
    roleAgentId: id.split("-").pop(),
    workspacePath: path.join(root, "workspaces", id),
    agentDir: path.join(root, "agents", id),
    status,
    registeredAt: "2026-07-23T00:00:00.000Z",
    updatedAt: "2026-07-23T00:00:00.000Z",
    lastReconciledAt: "2026-07-23T00:00:00.000Z",
    drift:
      status === "missing"
        ? ["missing"]
        : status === "drifted"
          ? ["workspace"]
          : []
  };
}

function projectRecord() {
  const timestamp = "2026-07-23T00:00:00.000Z";
  return {
    projectId: "test-project",
    name: "测试项目",
    description: "",
    teamId: "test-team",
    teamSnapshot: {
      managerInstanceId: "test-role-worker",
      memberInstanceIds: ["test-role-worker"],
      executionMode: "confirm",
      maxConcurrency: 1,
      capturedAt: timestamp,
      sourceTeamUpdatedAt: timestamp
    },
    status: "active",
    executionMode: "confirm",
    maxConcurrency: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    archivedAt: null
  };
}

async function fixture(t, adapterResults = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-conversations-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const clock = { value: "2026-07-23T01:00:00.000Z" };
  let messageIndex = 0;
  let turnIndex = 0;
  const adapterCalls = [];
  const sessionKeyInputs = [];
  const adapter = {
    async sendConversationMessage(input, runtime = {}) {
      adapterCalls.push(JSON.parse(JSON.stringify(input)));
      if (runtime.onSpawn) await runtime.onSpawn({ pid: 43210 });
      if (adapterResults.length) {
        const result = adapterResults.shift();
        if (result instanceof Error) throw result;
        return result;
      }
      return {
        ok: true,
        interrupted: false,
        timedOut: false,
        code: 0,
        signal: null,
        content: "安全回复",
        openClawSessionId: "session-safe",
        openClawRunId: "remote-run-safe",
        errorType: null,
        errorSummary: null
      };
    }
  };
  const options = {
    conversationStatePath: path.join(root, "state", "conversations", "state.json"),
    messageStateDirectory: path.join(root, "state", "conversations", "messages"),
    instanceStatePath: path.join(root, "state", "instances", "state.json"),
    projectStatePath: path.join(root, "state", "projects", "state.json"),
    agentCallLeasePath: path.join(root, "state", "agent-call", "active.lock"),
    conversationOperationLockDirectory: path.join(
      root,
      "state",
      "conversations",
      "operations"
    ),
    now: () => new Date(clock.value),
    createSessionKey(input) {
      sessionKeyInputs.push({ ...input });
      return `agent:${input.instanceId}:toolbox-conversation-${input.conversationId}`;
    },
    createMessageId: () => MESSAGE_IDS[messageIndex++],
    createTurnId: () => TURN_IDS[turnIndex++],
    openClawConversationAdapter: adapter
  };
  await writeInstanceState(options.instanceStatePath, {
    schemaVersion: 1,
    instances: {
      "test-role-worker": instance(root, "test-role-worker"),
      "test-role-missing": instance(root, "test-role-missing", "missing"),
      "test-role-drifted": instance(root, "test-role-drifted", "drifted")
    }
  });
  await writeProjectState(options.projectStatePath, {
    schemaVersion: 1,
    projects: { "test-project": projectRecord() }
  });
  const protectedPaths = {
    role: path.join(root, "protected", "role.json"),
    instance: options.instanceStatePath,
    team: path.join(root, "protected", "team.json"),
    project: options.projectStatePath,
    task: path.join(root, "protected", "task.json"),
    execution: path.join(root, "protected", "execution.json")
  };
  fs.mkdirSync(path.dirname(protectedPaths.role), { recursive: true });
  for (const [name, file] of Object.entries(protectedPaths)) {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, `${name}-sentinel\n`, "utf8");
    }
  }
  return {
    root,
    clock,
    options,
    adapterCalls,
    sessionKeyInputs,
    protectedPaths
  };
}

function snapshot(paths) {
  return Object.fromEntries(
    Object.entries(paths).map(([name, file]) => [name, fs.readFileSync(file)])
  );
}

async function createDefault(f, overrides = {}) {
  return createConversation({
    conversationId: "test-chat",
    instanceId: "test-role-worker",
    ...overrides
  }, f.options);
}

test("Conversation 创建只绑定 registered Instance，可选 Project，并隐藏 Session Key", async (t) => {
  const f = await fixture(t);
  const created = await createDefault(f, {
    title: "测试会话",
    projectId: "test-project"
  });
  assert.equal(created.conversationId, "test-chat");
  assert.equal(created.projectId, "test-project");
  assert.equal(created.messageCount, 0);
  assert.equal(created.canSend, true);
  assert.deepEqual(f.sessionKeyInputs, [{
    conversationId: "test-chat",
    instanceId: "test-role-worker"
  }]);
  assert.deepEqual(Object.keys(f.sessionKeyInputs[0]).sort(), [
    "conversationId",
    "instanceId"
  ]);
  assert.equal(Object.hasOwn(created, "sessionKey"), false);
  assert.equal(Object.hasOwn(created, "openClawSessionId"), false);
  assert.equal(f.adapterCalls.length, 0);

  const stored = await readConversationState(f.options.conversationStatePath);
  assert.equal(
    stored.conversations["test-chat"].sessionKey,
    "agent:test-role-worker:toolbox-conversation-test-chat"
  );
});

test("Conversation 创建拒绝未知、missing、drifted、main Instance 和未知 Project", async (t) => {
  const f = await fixture(t);
  for (const [id, expected] of [
    ["unknown-agent", /当前不存在/],
    ["test-role-missing", /当前 missing/],
    ["test-role-drifted", /当前 drifted/],
    ["main", /当前不存在/]
  ]) {
    await assert.rejects(
      () => createConversation({
        conversationId: `chat-${id.replace(/[^a-z0-9-]/g, "-")}`,
        instanceId: id
      }, f.options),
      expected
    );
  }
  await assert.rejects(
    () => createDefault(f, { projectId: "unknown-project" }),
    /未找到 Project/
  );
  assert.equal(fs.existsSync(f.options.conversationStatePath), false);
});

test("Conversation Manager 在读取 State 前安全拒绝路径形式的 Instance 和 Project ID", async (t) => {
  const f = await fixture(t);
  for (const [field, value] of [
    ["instanceId", "/opt/openclaw/agent"],
    ["instanceId", "\\\\server\\share\\agent"],
    ["projectId", "C:\\Users\\example\\project"],
    ["projectId", "../secret"]
  ]) {
    await assert.rejects(
      () => createConversation({
        conversationId:
          `unsafe-${field === "instanceId" ? "instance" : "project"}-` +
          `${value.includes("..") ? "relative" : "absolute"}`,
        instanceId: "test-role-worker",
        [field]: value
      }, f.options),
      (error) => {
        assert.match(error.message, /不安全路径/);
        assert.equal(error.message.includes(value), false);
        return true;
      }
    );
  }
  assert.equal(fs.existsSync(f.options.conversationStatePath), false);
  assert.equal(fs.existsSync(f.options.messageStateDirectory), false);
  assert.equal(f.adapterCalls.length, 0);
});

test("Conversation 创建在落盘前拒绝敏感标题和非法 Session Key", async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    () => createDefault(f, { title: "sk-1234567890" }),
    /疑似包含 API Key/
  );
  const unsafeSessionKeys = [
    ["newline", "bad\nsession", /控制字符/],
    [
      "workspace",
      "workspacePath=/private/tmp/test",
      /包含不允许的敏感内容/
    ],
    ["api-key", "apiKey=sk-test", /包含不允许的敏感内容/],
    ["bearer", "Bearer test-token", /包含不允许的敏感内容/],
    [
      "private-key",
      "-----BEGIN PRIVATE KEY-----\nPRIVATE_BODY\n-----END PRIVATE KEY-----",
      /包含不允许的敏感内容/
    ],
    [
      "agent-dir",
      "agentDir=/Users/test/.openclaw/agents/demo",
      /包含不允许的敏感内容/
    ],
    ["posix-path", "/etc/passwd", /不安全路径/],
    ["unc-path", "\\\\server\\share\\session", /不安全路径/],
    ["relative-path", "../session.json", /不安全路径/]
  ];
  for (const [suffix, value, expected] of unsafeSessionKeys) {
    await assert.rejects(
      () => createConversation({
        conversationId: `bad-session-${suffix}`,
        instanceId: "test-role-worker"
      }, {
        ...f.options,
        createSessionKey: () => value
      }),
      (error) => {
        assert.match(error.message, expected);
        assert.doesNotMatch(error.message, new RegExp(escapeRegex(value)));
        return true;
      }
    );
  }
  assert.equal(fs.existsSync(f.options.conversationStatePath), false);
  assert.equal(fs.existsSync(f.options.messageStateDirectory), false);
  assert.equal(f.adapterCalls.length, 0);
});

test("Conversation 创建派生读取失败不写入，写入后不再执行可失败读取", async (t) => {
  const failed = await fixture(t);
  await assert.rejects(
    () => createConversation({
      conversationId: "test-chat",
      instanceId: "test-role-worker"
    }, {
      ...failed.options,
      messageStateStore: {
        async readMessageState() {
          throw new Error("fixture-message-read-failure");
        }
      }
    }),
    /fixture-message-read-failure/
  );
  assert.deepEqual(
    (await readConversationState(failed.options.conversationStatePath))
      .conversations,
    {}
  );

  const success = await fixture(t);
  let reads = 0;
  const created = await createConversation({
    conversationId: "test-chat",
    instanceId: "test-role-worker"
  }, {
    ...success.options,
    messageStateStore: {
      async readMessageState() {
        reads += 1;
        if (reads > 1) throw new Error("unexpected-second-read");
        return {
          schemaVersion: 1,
          conversationId: "test-chat",
          messages: {}
        };
      }
    }
  });
  assert.equal(created.conversationId, "test-chat");
  assert.equal(reads, 1);
});

test("send 原子创建 User/Assistant，复用固定 Session Key 并更新 Session/Run 标识", async (t) => {
  const f = await fixture(t);
  await createDefault(f);
  const protectedBefore = snapshot(f.protectedPaths);
  const result = await sendMessage("test-chat", {
    message: "请回复安全内容",
    timeoutMs: 5000
  }, f.options);

  assert.equal(result.userMessage.role, "user");
  assert.equal(result.userMessage.status, "completed");
  assert.equal(result.assistantMessage.status, "completed");
  assert.equal(result.assistantMessage.content, "安全回复");
  assert.equal(result.assistantMessage.openClawSessionId, "session-safe");
  assert.equal(result.assistantMessage.openClawRunId, "remote-run-safe");
  assert.equal(f.adapterCalls.length, 1);
  assert.deepEqual(f.adapterCalls[0], {
    agentId: "test-role-worker",
    message: "请回复安全内容",
    sessionKey: "agent:test-role-worker:toolbox-conversation-test-chat",
    timeoutMs: 5000
  });
  const messages = await listMessages("test-chat", {}, f.options);
  assert.deepEqual(messages.map((item) => [item.sequence, item.role]), [
    [1, "user"],
    [2, "assistant"]
  ]);
  const conversation = await readConversationState(f.options.conversationStatePath);
  assert.equal(conversation.conversations["test-chat"].openClawSessionId, "session-safe");
  assert.equal(fs.existsSync(f.options.agentCallLeasePath), false);

  const protectedAfter = snapshot(f.protectedPaths);
  for (const name of [
    "role",
    "instance",
    "team",
    "project",
    "task",
    "execution"
  ]) {
    assert.deepEqual(protectedAfter[name], protectedBefore[name]);
  }
});

test("连续 send 复用 Session Key，分页稳定且 Conversation 间消息隔离", async (t) => {
  const f = await fixture(t);
  await createDefault(f);
  await createConversation({
    conversationId: "other-chat",
    instanceId: "test-role-worker"
  }, f.options);
  await sendMessage("test-chat", { message: "第一条" }, f.options);
  await sendMessage("test-chat", { message: "第二条" }, f.options);
  await sendMessage("other-chat", { message: "其他会话" }, f.options);
  assert.equal(f.adapterCalls[0].sessionKey, f.adapterCalls[1].sessionKey);
  assert.notEqual(f.adapterCalls[1].sessionKey, f.adapterCalls[2].sessionKey);
  assert.deepEqual(
    (await listMessages("test-chat", { limit: 2 }, f.options))
      .map((item) => item.sequence),
    [3, 4]
  );
  assert.deepEqual(
    (await listMessages("test-chat", {
      limit: 2,
      beforeSequence: 3
    }, f.options)).map((item) => item.sequence),
    [1, 2]
  );
  assert.equal((await listMessages("other-chat", {}, f.options)).length, 2);
});

test("send 在敏感、空、超长消息和异常 Instance 前拒绝且不部分写入", async (t) => {
  const f = await fixture(t);
  await createDefault(f);
  for (const [message, expected] of [
    ["", /非空字符串/],
    ["Bearer abcdefghijklmnop", /疑似包含/],
    ["-----BEGIN PRIVATE KEY-----", /疑似包含/],
    ["x".repeat(8001), /不能超过 8000/]
  ]) {
    await assert.rejects(
      () => sendMessage("test-chat", { message }, f.options),
      expected
    );
  }
  assert.equal(f.adapterCalls.length, 0);
  assert.equal((await listMessages("test-chat", {}, f.options)).length, 0);

  const state = JSON.parse(fs.readFileSync(f.options.instanceStatePath, "utf8"));
  state.instances["test-role-worker"].status = "missing";
  state.instances["test-role-worker"].drift = ["missing"];
  fs.writeFileSync(f.options.instanceStatePath, JSON.stringify(state));
  await assert.rejects(
    () => sendMessage("test-chat", { message: "安全文本" }, f.options),
    /当前 missing/
  );
  assert.equal((await listMessages("test-chat", {}, f.options)).length, 0);
});

test("内部字段支持多格式、多字段和多行清理，且落盘内容与 Adapter 输入一致", async (t) => {
  const f = await fixture(t);
  await createDefault(f);
  const sensitiveValues = [
    "INTERNAL_REPORT_FIXTURE",
    "ORIGINAL_PRIVATE_PROMPT",
    "RAW_ASSISTANT_FIXTURE",
    "VISIBLE_ASSISTANT_FIXTURE",
    "TRACE_FIXTURE",
    "COMPLETION_FIXTURE",
    "/private/session.json",
    "/private/workspace",
    "/private/agent",
    "INTERNAL_PROVIDER",
    "INTERNAL_MODEL",
    "USAGE_FIXTURE",
    "RESULT_META_FIXTURE",
    "RAW_JSON_FIXTURE",
    "GENERAL_API_FIXTURE",
    "GENERAL_TOKEN_FIXTURE",
    "GENERAL_SECRET_FIXTURE"
  ];
  const message = [
    "systemPromptReport=INTERNAL_REPORT_FIXTURE finalPromptText : ORIGINAL_PRIVATE_PROMPT",
    "\"finalAssistantRawText\": \"RAW_ASSISTANT_FIXTURE\"",
    "FINALASSISTANTVISIBLETEXT = VISIBLE_ASSISTANT_FIXTURE",
    "executionTrace={\"value\":\"TRACE_FIXTURE\"}; completion=[COMPLETION_FIXTURE]",
    "sessionFile=/private/session.json workspaceDir=/private/workspace",
    "workspacePath : /private/workspace agentDir=/private/agent",
    "provider=INTERNAL_PROVIDER model: INTERNAL_MODEL usage = USAGE_FIXTURE",
    "\"result.meta\": \"RESULT_META_FIXTURE\" openClawRawJson={\"value\":\"RAW_JSON_FIXTURE\"}",
    "apiKey=GENERAL_API_FIXTURE token: GENERAL_TOKEN_FIXTURE secret = GENERAL_SECRET_FIXTURE"
  ].join("\n");
  const result = await sendMessage("test-chat", { message }, f.options);
  assert.equal(f.adapterCalls.length, 1);
  assert.equal(result.userMessage.content, f.adapterCalls[0].message);
  assert.match(result.userMessage.content, /systemPromptReport=\[REDACTED\]/);
  assert.match(result.userMessage.content, /FINALASSISTANTVISIBLETEXT = \[REDACTED\]/);
  for (const value of sensitiveValues) {
    assert.doesNotMatch(result.userMessage.content, new RegExp(escapeRegex(value)));
    assert.doesNotMatch(f.adapterCalls[0].message, new RegExp(escapeRegex(value)));
  }
  const messagePath = resolveMessageStatePath(
    f.options.messageStateDirectory,
    "test-chat"
  );
  const raw = fs.readFileSync(messagePath, "utf8");
  const presented = formatConversationMessages(
    await listMessages("test-chat", {}, f.options)
  );
  const metadataOutput =
    formatConversationList(await listConversations(f.options)) +
    formatConversationInspect(
      await inspectConversation("test-chat", f.options)
    );
  for (const value of sensitiveValues) {
    const pattern = new RegExp(escapeRegex(value));
    assert.doesNotMatch(raw, pattern);
    assert.doesNotMatch(presented, pattern);
    assert.doesNotMatch(metadataOutput, pattern);
  }
});

test("高可信凭据在 Message、租约和 Adapter 前拒绝且错误不回显原文", async (t) => {
  const f = await fixture(t);
  await createDefault(f);
  const credentials = [
    "sk-FIXTURE123456789",
    "Bearer FIXTURE_TOKEN_123456789",
    "-----BEGIN PRIVATE KEY-----\nFIXTURE_PRIVATE_KEY\n-----END PRIVATE KEY-----"
  ];
  for (const credential of credentials) {
    await assert.rejects(
      () => sendMessage("test-chat", { message: credential }, f.options),
      (error) => {
        assert.match(error.message, /疑似包含 API Key、Bearer Token 或私钥/);
        assert.doesNotMatch(error.message, new RegExp(escapeRegex(credential)));
        return true;
      }
    );
  }
  assert.equal(f.adapterCalls.length, 0);
  assert.equal(fs.existsSync(f.options.agentCallLeasePath), false);
  assert.equal((await listMessages("test-chat", {}, f.options)).length, 0);
});

test("Assistant 回复与错误摘要在落盘和 Presenter 前清理内部字段", async (t) => {
  const assistantValues = [
    "ASSISTANT_INTERNAL_FIXTURE",
    "ASSISTANT_PROMPT_FIXTURE",
    "/private/session.json",
    "/private/workspace",
    "internal-provider",
    "internal-model",
    "assistant-usage"
  ];
  const f = await fixture(t, [{
    ok: true,
    interrupted: false,
    timedOut: false,
    code: 0,
    signal: null,
    content: [
      "systemPromptReport=ASSISTANT_INTERNAL_FIXTURE",
      "finalPromptText=ASSISTANT_PROMPT_FIXTURE",
      "sessionFile=/private/session.json workspaceDir=/private/workspace",
      "provider=internal-provider model=internal-model usage=assistant-usage"
    ].join("\n"),
    openClawSessionId: "session-safe",
    openClawRunId: "run-safe",
    errorType: null,
    errorSummary: null
  }]);
  await createDefault(f);
  const result = await sendMessage("test-chat", { message: "普通问题" }, f.options);
  assert.equal(result.assistantMessage.openClawSessionId, "session-safe");
  assert.equal(result.assistantMessage.openClawRunId, "run-safe");
  const raw = fs.readFileSync(
    resolveMessageStatePath(f.options.messageStateDirectory, "test-chat"),
    "utf8"
  );
  const presented = formatConversationMessages(
    await listMessages("test-chat", {}, f.options)
  );
  for (const value of assistantValues) {
    const pattern = new RegExp(escapeRegex(value));
    assert.doesNotMatch(result.assistantMessage.content, pattern);
    assert.doesNotMatch(raw, pattern);
    assert.doesNotMatch(presented, pattern);
  }

  const failed = await fixture(t, [{
    ok: false,
    interrupted: false,
    errorType: "adapter",
    errorSummary:
      "systemPromptReport=ERROR_INTERNAL_FIXTURE finalPromptText=ERROR_PROMPT_FIXTURE"
  }]);
  await createDefault(failed);
  const failureResult = await sendMessage(
    "test-chat",
    { message: "触发安全失败" },
    failed.options
  );
  assert.doesNotMatch(
    failureResult.assistantMessage.errorSummary,
    /ERROR_INTERNAL_FIXTURE|ERROR_PROMPT_FIXTURE/
  );
});

test("普通自然语言不会因提及相关概念被误删或拒绝", async (t) => {
  const f = await fixture(t);
  await createDefault(f);
  const message = "请解释系统提示词报告是什么，并说明模型使用量的含义";
  const result = await sendMessage("test-chat", { message }, f.options);
  assert.equal(result.userMessage.content, message);
  assert.equal(f.adapterCalls[0].message, message);
});

test("Adapter 失败、timeout、signal 和异常形成安全终态并释放共享租约", async (t) => {
  const results = [
    {
      ok: false,
      interrupted: false,
      errorType: "non-zero",
      errorSummary: "token=private-token 失败"
    },
    {
      ok: false,
      interrupted: true,
      timedOut: true,
      errorType: "timeout",
      errorSummary: "超时"
    },
    {
      ok: false,
      interrupted: true,
      signal: "SIGTERM",
      errorType: "signal",
      errorSummary: "被信号中断"
    },
    new Error("包含 secret=private-secret 的内部异常")
  ];
  const f = await fixture(t, results);
  await createDefault(f);
  const statuses = [];
  for (const text of ["失败", "超时", "信号", "异常"]) {
    const result = await sendMessage("test-chat", { message: text }, f.options);
    statuses.push(result.assistantMessage.status);
    assert.equal(fs.existsSync(f.options.agentCallLeasePath), false);
  }
  assert.deepEqual(statuses, ["failed", "interrupted", "interrupted", "interrupted"]);
  const raw = fs.readFileSync(
    resolveMessageStatePath(f.options.messageStateDirectory, "test-chat"),
    "utf8"
  );
  assert.doesNotMatch(raw, /private-token|private-secret/);
});

test("共享 Agent-call lease 阻止 Conversation 并发，且不创建 Message", async (t) => {
  const f = await fixture(t);
  await createDefault(f);
  const holder = {
    operationId: "run-00000000-0000-4000-8000-000000000001",
    operationType: "execution",
    instanceId: "test-role-worker",
    pid: process.pid,
    createdAt: f.clock.value
  };
  await acquireAgentCallLease(f.options.agentCallLeasePath, holder);
  await assert.rejects(
    () => sendMessage("test-chat", { message: "不能并发" }, f.options),
    /全局串行/
  );
  assert.equal((await listMessages("test-chat", {}, f.options)).length, 0);
  assert.equal(f.adapterCalls.length, 0);
  await releaseAgentCallLease(f.options.agentCallLeasePath, holder);
});

test("archive 强制确认、有 active Assistant 时拒绝，成功后完全只读", async (t) => {
  const f = await fixture(t);
  await createDefault(f);
  await assert.rejects(
    () => archiveConversation("test-chat", {}, f.options),
    /必须提供 --confirm/
  );
  const messagePath = resolveMessageStatePath(
    f.options.messageStateDirectory,
    "test-chat"
  );
  await updateMessageState(messagePath, "test-chat", (state) => {
    state.messages[MESSAGE_IDS[0]] = {
      messageId: MESSAGE_IDS[0],
      turnId: TURN_IDS[0],
      conversationId: "test-chat",
      sequence: 1,
      role: "user",
      status: "completed",
      content: "遗留消息",
      errorSummary: null,
      openClawSessionId: null,
      openClawRunId: null,
      createdAt: f.clock.value,
      updatedAt: f.clock.value,
      completedAt: f.clock.value,
      failedAt: null,
      interruptedAt: null
    };
    state.messages[MESSAGE_IDS[1]] = {
      messageId: MESSAGE_IDS[1],
      turnId: TURN_IDS[0],
      conversationId: "test-chat",
      sequence: 2,
      role: "assistant",
      status: "pending",
      content: null,
      errorSummary: null,
      openClawSessionId: null,
      openClawRunId: null,
      createdAt: f.clock.value,
      updatedAt: f.clock.value,
      completedAt: null,
      failedAt: null,
      interruptedAt: null
    };
    return state;
  });
  await assert.rejects(
    () => archiveConversation("test-chat", { confirm: true }, f.options),
    /active Assistant/
  );
  await assert.rejects(
    () => sendMessage("test-chat", { message: "不能重复发送" }, f.options),
    /active Assistant/
  );
  assert.equal(f.adapterCalls.length, 0);
  await reconcileConversations(f.options);
  const archived = await archiveConversation(
    "test-chat",
    { confirm: true },
    f.options
  );
  assert.equal(archived.status, "archived");
  await assert.rejects(
    () => sendMessage("test-chat", { message: "归档后发送" }, f.options),
    /只读/
  );
  await assert.rejects(
    () => archiveConversation("test-chat", { confirm: true }, f.options),
    /已归档/
  );
  const archivedBytes = fs.readFileSync(f.options.conversationStatePath);
  await reconcileConversations(f.options);
  assert.deepEqual(
    fs.readFileSync(f.options.conversationStatePath),
    archivedBytes
  );
});

test("reconcile 无有效租约时中断遗留 Message 并修复最新 Session，不调用 Adapter", async (t) => {
  const f = await fixture(t);
  await createDefault(f);
  const messagePath = resolveMessageStatePath(
    f.options.messageStateDirectory,
    "test-chat"
  );
  await sendMessage("test-chat", { message: "先完成" }, f.options);
  await updateMessageState(messagePath, "test-chat", (state) => {
    state.messages[MESSAGE_IDS[2]] = {
      ...state.messages[MESSAGE_IDS[0]],
      messageId: MESSAGE_IDS[2],
      turnId: TURN_IDS[1],
      sequence: 3,
      content: "遗留请求"
    };
    state.messages[MESSAGE_IDS[3]] = {
      ...state.messages[MESSAGE_IDS[1]],
      messageId: MESSAGE_IDS[3],
      turnId: TURN_IDS[1],
      sequence: 4,
      status: "sending",
      content: null,
      errorSummary: null,
      openClawSessionId: null,
      openClawRunId: null,
      completedAt: null,
      failedAt: null,
      interruptedAt: null
    };
    return state;
  });
  const conversation = JSON.parse(
    fs.readFileSync(f.options.conversationStatePath, "utf8")
  );
  conversation.conversations["test-chat"].openClawSessionId = null;
  fs.writeFileSync(f.options.conversationStatePath, JSON.stringify(conversation));
  const callCount = f.adapterCalls.length;
  const result = await reconcileConversations(f.options);
  assert.deepEqual(result.interruptedMessageIds, [MESSAGE_IDS[3]]);
  assert.deepEqual(result.repairedConversationIds, ["test-chat"]);
  assert.equal(f.adapterCalls.length, callCount);
  const messages = await readMessageState(messagePath, "test-chat");
  assert.equal(messages.messages[MESSAGE_IDS[3]].status, "interrupted");
  const repaired = await readConversationState(f.options.conversationStatePath);
  assert.equal(repaired.conversations["test-chat"].openClawSessionId, "session-safe");
});

test("reconcile 只清理 stale 全局 Agent lease，不用它代替 Conversation 操作锁", async (t) => {
  const f = await fixture(t);
  await createDefault(f);
  const holder = {
    operationId: MESSAGE_IDS[10],
    operationType: "conversation",
    instanceId: "test-role-worker",
    pid: 999999,
    createdAt: f.clock.value
  };
  await acquireAgentCallLease(f.options.agentCallLeasePath, holder);
  const result = await reconcileConversations({
    ...f.options,
    isProcessAlive: () => false
  });
  assert.equal(result.staleLeaseRemoved, true);
  assert.equal(fs.existsSync(f.options.agentCallLeasePath), false);
  assert.equal(f.adapterCalls.length, 0);
});

test("reconcile 有有效 Conversation 操作锁时跳过且不修改任何 Message", async (t) => {
  const f = await fixture(t);
  await createDefault(f);
  const messagePath = resolveMessageStatePath(
    f.options.messageStateDirectory,
    "test-chat"
  );
  await updateMessageState(messagePath, "test-chat", (state) => {
    state.messages[MESSAGE_IDS[0]] = {
      messageId: MESSAGE_IDS[0],
      turnId: TURN_IDS[0],
      conversationId: "test-chat",
      sequence: 1,
      role: "user",
      status: "completed",
      content: "进行中",
      errorSummary: null,
      openClawSessionId: null,
      openClawRunId: null,
      createdAt: f.clock.value,
      updatedAt: f.clock.value,
      completedAt: f.clock.value,
      failedAt: null,
      interruptedAt: null
    };
    state.messages[MESSAGE_IDS[1]] = {
      messageId: MESSAGE_IDS[1],
      turnId: TURN_IDS[0],
      conversationId: "test-chat",
      sequence: 2,
      role: "assistant",
      status: "sending",
      content: null,
      errorSummary: null,
      openClawSessionId: null,
      openClawRunId: null,
      createdAt: f.clock.value,
      updatedAt: f.clock.value,
      completedAt: null,
      failedAt: null,
      interruptedAt: null
    };
    return state;
  });
  const holder = {
    operationId: MESSAGE_IDS[1],
    conversationId: "test-chat",
    operationType: "send",
    pid: process.pid,
    createdAt: f.clock.value
  };
  await acquireConversationOperationLock(
    f.options.conversationOperationLockDirectory,
    holder
  );
  const before = fs.readFileSync(messagePath);
  const result = await reconcileConversations(f.options);
  assert.equal(result.activeAgentCall, true);
  assert.deepEqual(result.skippedConversationIds, ["test-chat"]);
  assert.deepEqual(fs.readFileSync(messagePath), before);
  await releaseConversationOperationLock(
    f.options.conversationOperationLockDirectory,
    holder
  );
});

test("list/inspect Presenter 只显示元数据，不泄露 Session Key、完整 Session ID或正文", async (t) => {
  const f = await fixture(t);
  await createDefault(f);
  await sendMessage("test-chat", { message: "用户秘密正文" }, f.options);
  const listed = formatConversationList(await listConversations(f.options));
  const inspected = formatConversationInspect(
    await inspectConversation("test-chat", f.options)
  );
  const output = listed + "\n" + inspected;
  assert.doesNotMatch(output, /toolbox-conversation|session-safe|用户秘密正文|安全回复/);
  assert.match(output, /OpenClaw Session：已建立/);
});

test("Conversation Presenter 对历史脏数据保持最后一道安全边界", () => {
  const privateKey = [
    "-----BEGIN PRIVATE KEY-----",
    "PRESENTER_PRIVATE_BODY",
    "-----END PRIVATE KEY-----"
  ].join("\n");
  const content = [
    "正常回复",
    privateKey,
    "workspacePath=/private/tmp/presenter",
    "stdout=RAW_STDOUT_FIXTURE"
  ].join("\n");
  const messages = formatConversationMessages([{
    sequence: 1,
    role: "assistant",
    status: "completed",
    createdAt: "2026-07-23T00:00:00.000Z",
    content,
    errorSummary: null
  }]);
  const sent = formatConversationSend({
    assistantMessage: {
      status: "completed",
      conversationId: "workspaceDir=/Users/test/private",
      turnId: "token=presenter-token",
      content,
      errorSummary: null
    }
  });
  const listed = formatConversationList([{
    conversationId: "test-chat",
    title: "sessionFile=/Users/test/session.json",
    status: "active",
    messageCount: 1
  }]);
  const output = [messages, sent, listed].join("\n");

  assert.match(output, /正常回复/);
  assert.match(output, /\[REDACTED_PRIVATE_KEY\]/);
  assert.match(output, /\[REDACTED_INTERNAL_PATH\]/);
  assert.match(output, /\[REDACTED_IDENTIFIER\]/);
  assert.doesNotMatch(
    output,
    /BEGIN PRIVATE KEY|END PRIVATE KEY|PRESENTER_PRIVATE_BODY|\/private\/tmp\/presenter|\/Users\/test|presenter-token|RAW_STDOUT_FIXTURE/
  );
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
