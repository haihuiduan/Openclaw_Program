const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const publicApi = require("../src");
const {
  createConversationService
} = require("../src/gui/services/conversationService");
const {
  writeInstanceState
} = require("../src/core/agent-instances/state");

const MESSAGE_IDS = [
  "msg-00000000-0000-4000-8000-000000000001",
  "msg-00000000-0000-4000-8000-000000000002",
  "msg-00000000-0000-4000-8000-000000000003",
  "msg-00000000-0000-4000-8000-000000000004"
];
const TURN_IDS = [
  "turn-00000000-0000-4000-8000-000000000001",
  "turn-00000000-0000-4000-8000-000000000002"
];

function createMockApi(overrides = {}) {
  return {
    async inspectInstance(instanceId) {
      return {
        instanceId,
        status: "registered",
        workspacePath: "/private/workspace/hidden",
        agentDir: "/private/agent-dir/hidden"
      };
    },
    async listConversations() {
      return [];
    },
    async createConversation(input) {
      return conversationRecord(
        input.conversationId,
        input.instanceId,
        "2026-07-29T12:00:00.000Z",
        input.title || "安全对话"
      );
    },
    async inspectConversation(conversationId) {
      return conversationRecord(conversationId, "cross-border-team-manager");
    },
    async listMessages() {
      return [];
    },
    async sendMessage() {
      return {
        assistantMessage: { status: "completed" }
      };
    },
    async reconcileInstances() {
      return {};
    },
    async registerInstance() {
      return {};
    },
    async reconcileConversations() {
      return {};
    },
    ...overrides
  };
}

function conversationRecord(
  conversationId,
  instanceId,
  updatedAt = "2026-07-29T12:00:00.000Z",
  title = "安全对话"
) {
  return {
    conversationId,
    title,
    instanceId,
    projectId: null,
    status: "active",
    hasOpenClawSession: true,
    messageCount: 0,
    lastMessageAt: null,
    canSend: true,
    issues: [],
    createdAt: "2026-07-29T11:00:00.000Z",
    updatedAt,
    archivedAt: null,
    sessionKey: "agent:secret",
    openClawSessionId: "remote-secret"
  };
}

function messageRecord(overrides = {}) {
  return {
    messageId: "msg-00000000-0000-4000-8000-000000000001",
    turnId: "turn-00000000-0000-4000-8000-000000000001",
    conversationId: "chat-safe",
    sequence: 1,
    role: "user",
    status: "completed",
    content: "你好",
    errorSummary: null,
    openClawSessionId: "session-hidden",
    openClawRunId: "run-hidden",
    createdAt: "2026-07-29T12:00:00.000Z",
    updatedAt: "2026-07-29T12:00:00.000Z",
    completedAt: "2026-07-29T12:00:00.000Z",
    failedAt: null,
    interruptedAt: null,
    workspacePath: "/private/workspace/hidden",
    ...overrides
  };
}

test("聊天中心会话列表只返回已安装可用助手的 active Conversation", async () => {
  const service = createConversationService(createMockApi({
    async listInstances() {
      return [{
        instanceId: "cross-border-team-manager",
        roleId: "cross-border-team",
        roleAgentId: "manager",
        status: "registered",
        workspacePath: "/private/hidden/workspace",
        agentDir: "/private/hidden/agent-dir"
      }, {
        instanceId: "cross-border-team-creator",
        roleId: "cross-border-team",
        roleAgentId: "manager",
        status: "missing"
      }];
    },
    async scanRoleRegistry() {
      return {
        roles: [{
          id: "cross-border-team",
          name: "跨境运营团队",
          agents: [{ id: "manager", name: "运营协调助手" }, {
            id: "creator",
            name: "内容助手"
          }]
        }],
        invalidRoles: []
      };
    },
    async listInstalledRoles() {
      return [{ id: "cross-border-team", version: "1.0.0" }];
    },
    async listConversations() {
      return [
        conversationRecord(
          "chat-older",
          "cross-border-team-manager",
          "2026-07-29T10:00:00.000Z",
          "与 cross-border-team-manager 的对话"
        ),
        conversationRecord(
          "chat-newer",
          "cross-border-team-manager",
          "2026-07-29T12:00:00.000Z"
        ),
        {
          ...conversationRecord("chat-archived", "cross-border-team-manager"),
          status: "archived"
        },
        conversationRecord("chat-missing", "cross-border-team-creator")
      ];
    },
    async listMessages(conversationId) {
      return [messageRecord({
        conversationId,
        content: conversationId === "chat-newer"
          ? "最新消息 result.meta={\"stdout\":\"hidden\"}"
          : "较早消息",
        updatedAt: conversationId === "chat-newer"
          ? "2026-07-29T12:30:00.000Z"
          : "2026-07-29T10:30:00.000Z"
      })];
    }
  }));

  const result = await service.listChatConversations();
  const serialized = JSON.stringify(result);

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.conversations.map((conversation) => conversation.conversationId),
    ["chat-newer", "chat-older"]
  );
  assert.deepEqual(Object.keys(result.conversations[0]).sort(), [
    "agentName",
    "conversationId",
    "instanceId",
    "lastMessagePreview",
    "roleName",
    "status",
    "title",
    "updatedAt"
  ]);
  assert.equal(result.conversations[0].agentName, "运营协调助手");
  assert.equal(result.conversations[0].roleName, "跨境运营团队");
  assert.equal(result.conversations[1].title, "与运营协调助手的对话");
  assert.doesNotMatch(result.conversations[1].title, /cross-border-team-manager/);
  assert.match(result.conversations[0].lastMessagePreview, /\[REDACTED\]/);
  assert.doesNotMatch(
    serialized,
    /sessionKey|openClawSessionId|openClawRunId|workspacePath|agentDir|private\/hidden|stdout.*hidden/
  );
});

test("聊天中心会话列表错误返回固定安全摘要", async () => {
  const service = createConversationService(createMockApi({
    async listInstances() {
      throw new Error("读取失败 /Users/example/private/instances.json secret stack");
    },
    async scanRoleRegistry() {
      return { roles: [], invalidRoles: [] };
    },
    async listInstalledRoles() {
      return [];
    }
  }));

  const result = await service.listChatConversations();

  assert.deepEqual(result, {
    ok: false,
    conversations: [],
    message: "聊天列表暂时无法加载，请稍后重试。"
  });
  assert.doesNotMatch(JSON.stringify(result), /Users|private|secret|Error/);
});

test("Conversation GUI 服务复用同一 Instance 最近 active 对话", async () => {
  let createCalls = 0;
  const service = createConversationService(createMockApi({
    async listConversations() {
      return [
        conversationRecord(
          "chat-older",
          "cross-border-team-manager",
          "2026-07-29T12:00:00.000Z"
        ),
        conversationRecord(
          "chat-newer",
          "cross-border-team-manager",
          "2026-07-29T13:00:00.000Z"
        ),
        {
          ...conversationRecord(
            "chat-archived",
            "cross-border-team-manager",
            "2026-07-29T14:00:00.000Z"
          ),
          status: "archived",
          canSend: false
        },
        conversationRecord("chat-other", "cross-border-team-researcher")
      ];
    },
    async createConversation() {
      createCalls += 1;
    }
  }));

  const result = await service.getOrCreateAgentConversation(
    "cross-border-team-manager"
  );

  assert.equal(result.ok, true);
  assert.equal(result.conversation.conversationId, "chat-newer");
  assert.equal(createCalls, 0);
  assert.deepEqual(
    Object.keys(result.conversation).sort(),
    [
      "archivedAt",
      "canSend",
      "conversationId",
      "createdAt",
      "instanceId",
      "lastMessageAt",
      "messageCount",
      "status",
      "title",
      "updatedAt"
    ].sort()
  );
  assert.equal(JSON.stringify(result).includes("sessionKey"), false);
  assert.equal(JSON.stringify(result).includes("openClawSessionId"), false);
});

test("Conversation GUI 服务无 active 对话时创建安全 Conversation", async () => {
  const createInputs = [];
  const service = createConversationService(createMockApi({
    async listConversations() {
      return [{
        ...conversationRecord(
          "chat-archived-only",
          "cross-border-team-manager"
        ),
        status: "archived",
        canSend: false
      }];
    },
    async createConversation(input, options) {
      createInputs.push({ input, options });
      return conversationRecord(input.conversationId, input.instanceId);
    }
  }), {
    createConversationId: () => "chat-created",
    conversationOptions: { marker: "conversation" }
  });

  const result = await service.getOrCreateAgentConversation(
    "cross-border-team-manager"
  );

  assert.equal(result.ok, true);
  assert.equal(result.conversation.conversationId, "chat-created");
  assert.deepEqual(createInputs, [{
    input: {
      conversationId: "chat-created",
      instanceId: "cross-border-team-manager"
    },
    options: { marker: "conversation" }
  }]);
});

test("同一助手每次新建聊天都创建独立 Conversation 并保存安全标题", async () => {
  const ids = ["chat-task-one", "chat-task-two"];
  const createInputs = [];
  const service = createConversationService(createMockApi({
    async createConversation(input) {
      createInputs.push(input);
      return conversationRecord(
        input.conversationId,
        input.instanceId,
        "2026-07-29T12:00:00.000Z",
        input.title
      );
    }
  }), {
    createConversationId: () => ids.shift()
  });

  const first = await service.createNewAgentConversation(
    "cross-border-team-manager",
    "便携榨汁杯市场分析"
  );
  const second = await service.createNewAgentConversation(
    "cross-border-team-manager",
    "TikTok 宠物用品选品"
  );

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(
    first.conversation.conversationId,
    second.conversation.conversationId
  );
  assert.deepEqual(createInputs.map((input) => input.title), [
    "便携榨汁杯市场分析",
    "TikTok 宠物用品选品"
  ]);
  assert.deepEqual(createInputs.map((input) => input.instanceId), [
    "cross-border-team-manager",
    "cross-border-team-manager"
  ]);
});

test("打开已有 Conversation 只读取指定历史且不会新建", async () => {
  let createCalls = 0;
  const service = createConversationService(createMockApi({
    async createConversation() {
      createCalls += 1;
      throw new Error("不应调用");
    },
    async inspectConversation(conversationId) {
      return conversationRecord(
        conversationId,
        "cross-border-team-manager",
        "2026-07-29T12:00:00.000Z",
        conversationId === "chat-task-one" ? "任务一" : "任务二"
      );
    },
    async listMessages(conversationId) {
      return [messageRecord({
        conversationId,
        content: conversationId === "chat-task-one" ? "任务一历史" : "任务二历史"
      })];
    }
  }));

  const first = await service.openChatConversation("chat-task-one");
  const second = await service.openChatConversation("chat-task-two");

  assert.equal(createCalls, 0);
  assert.equal(first.conversation.conversationId, "chat-task-one");
  assert.equal(second.conversation.conversationId, "chat-task-two");
  assert.deepEqual(first.messages.map((message) => message.content), ["任务一历史"]);
  assert.deepEqual(second.messages.map((message) => message.content), ["任务二历史"]);
});

test("新聊天标题拒绝路径、凭据和超长内容且不回显输入", async () => {
  let createCalls = 0;
  const service = createConversationService(createMockApi({
    async createConversation() {
      createCalls += 1;
    }
  }));

  for (const title of [
    "/private/tmp/hidden-title",
    "apiKey=fixture-secret-value",
    "x".repeat(101)
  ]) {
    const result = await service.createNewAgentConversation(
      "cross-border-team-manager",
      title
    );
    assert.equal(result.ok, false);
    assert.equal(result.message.includes(title), false);
    assert.doesNotMatch(result.message, /private\/tmp|fixture-secret-value/);
  }
  assert.equal(createCalls, 0);
});

test("Conversation GUI 服务消息 DTO 不暴露远端标识或内部路径", async () => {
  const service = createConversationService(createMockApi({
    async listMessages() {
      return [
        messageRecord(),
        messageRecord({
          messageId: "msg-00000000-0000-4000-8000-000000000002",
          sequence: 2,
          role: "assistant",
          content: null,
          status: "failed",
          errorSummary: "调用失败 /private/internal/raw.json",
          completedAt: null,
          failedAt: "2026-07-29T12:00:01.000Z"
        })
      ];
    }
  }));

  const result = await service.listConversationMessages(
    "cross-border-team-manager",
    "chat-safe"
  );

  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.messages[0]).sort(), [
    "content",
    "createdAt",
    "errorSummary",
    "messageId",
    "role",
    "sequence",
    "status",
    "updatedAt"
  ].sort());
  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "session-hidden",
    "run-hidden",
    "workspacePath",
    "/private/internal/raw.json",
    "/private/workspace/hidden"
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.match(result.messages[1].errorSummary, /\[REDACTED_PATH\]/);
});

test("Conversation GUI 服务拒绝不可用 Instance、非法输入和路径参数", async () => {
  let conversationCalls = 0;
  const service = createConversationService(createMockApi({
    async inspectInstance(instanceId) {
      if (instanceId === "cross-border-team-missing") return { instanceId, status: "missing" };
      if (instanceId === "cross-border-team-drifted") return { instanceId, status: "drifted" };
      if (instanceId === "cross-border-team-unknown") throw new Error("不存在");
      return { instanceId, status: "registered" };
    },
    async listConversations() {
      conversationCalls += 1;
      return [];
    }
  }));

  for (const value of [
    "main",
    "/private/instance",
    "cross-border-team-missing",
    "cross-border-team-drifted",
    "cross-border-team-unknown"
  ]) {
    const result = await service.getOrCreateAgentConversation(value);
    assert.equal(result.ok, false);
    assert.doesNotMatch(result.message, /\/private\/instance/);
  }
  const pagination = await service.listConversationMessages(
    "cross-border-team-manager",
    "chat-safe",
    {
      limit: 20,
      statePath: "/private/hidden"
    }
  );
  assert.equal(pagination.ok, false);
  assert.doesNotMatch(pagination.message, /\/private\/hidden/);
  assert.equal(conversationCalls, 0);
});

test("Conversation GUI 服务拒绝跨 Instance 对话、空消息和超长消息", async () => {
  let sendCalls = 0;
  const service = createConversationService(createMockApi({
    async sendMessage() {
      sendCalls += 1;
      return { assistantMessage: { status: "completed" } };
    }
  }));

  const wrongOwner = await service.sendConversationMessage(
    "cross-border-team-researcher",
    "chat-safe",
    "不能越权发送"
  );
  const empty = await service.sendConversationMessage(
    "cross-border-team-manager",
    "chat-safe",
    "   "
  );
  const tooLong = await service.sendConversationMessage(
    "cross-border-team-manager",
    "chat-safe",
    "x".repeat(8001)
  );

  assert.equal(wrongOwner.ok, false);
  assert.match(wrongOwner.message, /不属于当前 Agent Instance/);
  assert.equal(empty.ok, false);
  assert.match(empty.message, /不能为空/);
  assert.equal(tooLong.ok, false);
  assert.match(tooLong.message, /8000/);
  assert.equal(sendCalls, 0);
});

test("Conversation GUI 服务分页参数白名单透传且返回稳定顺序", async () => {
  const filterCalls = [];
  const service = createConversationService(createMockApi({
    async listMessages(conversationId, filters) {
      filterCalls.push({ conversationId, filters });
      return [
        messageRecord({
          messageId: "msg-00000000-0000-4000-8000-000000000002",
          sequence: 2,
          role: "assistant",
          content: "回复"
        }),
        messageRecord()
      ];
    }
  }));

  const result = await service.listConversationMessages(
    "cross-border-team-manager",
    "chat-safe",
    { limit: 2, beforeSequence: 3 }
  );

  assert.equal(result.ok, true);
  assert.deepEqual(filterCalls, [{
    conversationId: "chat-safe",
    filters: { limit: 2, beforeSequence: 3 }
  }]);
  assert.deepEqual(result.messages.map((message) => message.sequence), [1, 2]);
  assert.equal(result.hasMore, false);
  assert.equal(result.nextBeforeSequence, 1);
});

test("Conversation GUI 服务 reconcile 复用 Core 并重新读取安全状态", async () => {
  let reconcileCalls = 0;
  const service = createConversationService(createMockApi({
    async reconcileConversations() {
      reconcileCalls += 1;
      return {
        staleLeaseRemoved: true,
        internalPath: "/private/hidden"
      };
    }
  }));

  const result = await service.reconcileAgentConversation(
    "cross-border-team-manager",
    "chat-safe"
  );

  assert.equal(result.ok, true);
  assert.equal(reconcileCalls, 1);
  assert.equal(JSON.stringify(result).includes("staleLeaseRemoved"), false);
  assert.equal(JSON.stringify(result).includes("/private/hidden"), false);
});

test("Conversation GUI 服务发送失败保留真实失败消息但不伪装成功", async () => {
  const failed = messageRecord({
    messageId: "msg-00000000-0000-4000-8000-000000000002",
    sequence: 2,
    role: "assistant",
    status: "interrupted",
    content: null,
    errorSummary: "远端状态无法确认。",
    completedAt: null,
    interruptedAt: "2026-07-29T12:00:01.000Z"
  });
  const service = createConversationService(createMockApi({
    async sendMessage() {
      return { assistantMessage: failed };
    },
    async listMessages() {
      return [messageRecord(), failed];
    }
  }));

  const result = await service.sendConversationMessage(
    "cross-border-team-manager",
    "chat-safe",
    "测试"
  );

  assert.equal(result.ok, false);
  assert.equal(result.messages[1].status, "interrupted");
  assert.match(result.message, /远端状态无法确认/);
});

test("Conversation GUI 服务发送前发现远端 Agent 缺失时按 Instance 记录自动重注册并继续发送", async () => {
  const calls = [];
  let instanceStatus = "registered";
  const service = createConversationService(createMockApi({
    async inspectInstance(instanceId) {
      return {
        instanceId,
        roleId: "cross-border-team",
        roleAgentId: "creator",
        status: instanceStatus
      };
    },
    async reconcileInstances() {
      calls.push("reconcile");
      instanceStatus = "missing";
      return {};
    },
    async registerInstance(roleId, roleAgentId) {
      calls.push(`register:${roleId}:${roleAgentId}`);
      instanceStatus = "registered";
      return { ok: true, repaired: true };
    },
    async sendMessage() {
      calls.push("send");
      return { assistantMessage: { status: "completed" } };
    }
  }));

  const result = await service.sendConversationMessage(
    "cross-border-team-manager",
    "chat-safe",
    "测试自动修复"
  );

  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    "reconcile",
    "register:cross-border-team:creator",
    "send"
  ]);
});

test("Conversation GUI 服务发送前 Agent 已存在时不重复注册", async () => {
  const calls = [];
  const service = createConversationService(createMockApi({
    async inspectInstance(instanceId) {
      return {
        instanceId,
        roleId: "cross-border-team",
        roleAgentId: "manager",
        status: "registered"
      };
    },
    async reconcileInstances() {
      calls.push("reconcile");
      return {};
    },
    async registerInstance() {
      calls.push("register");
      return {};
    },
    async sendMessage() {
      calls.push("send");
      return { assistantMessage: { status: "completed" } };
    }
  }));

  const result = await service.sendConversationMessage(
    "cross-border-team-manager",
    "chat-safe",
    "测试"
  );

  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["reconcile", "send"]);
});

test("Conversation GUI 服务缺少合法 Instance 配置或 drift 时不注册且不发送", async () => {
  for (const status of ["missing", "drifted"]) {
    const calls = [];
    let inspected = 0;
    const service = createConversationService(createMockApi({
      async inspectInstance(instanceId) {
        inspected += 1;
        if (inspected === 1) {
          return {
            instanceId,
            roleId: "cross-border-team",
            roleAgentId: "manager",
            status: "registered"
          };
        }
        return {
          instanceId,
          roleId: status === "missing" ? "" : "cross-border-team",
          roleAgentId: status === "missing" ? "" : "manager",
          status
        };
      },
      async reconcileInstances() {
        calls.push("reconcile");
        return {};
      },
      async registerInstance() {
        calls.push("register");
        return {};
      },
      async sendMessage() {
        calls.push("send");
        return { assistantMessage: { status: "completed" } };
      }
    }));

    const result = await service.sendConversationMessage(
      "cross-border-team-manager",
      "chat-safe",
      "测试"
    );

    assert.equal(result.ok, false);
    assert.doesNotMatch(result.message, /\/private|agentDir|workspacePath/);
    assert.deepEqual(calls, ["reconcile"]);
  }
});

test("Conversation GUI 服务重注册失败时只尝试一次且不继续发送", async () => {
  const calls = [];
  let instanceStatus = "registered";
  const service = createConversationService(createMockApi({
    async inspectInstance(instanceId) {
      return {
        instanceId,
        roleId: "cross-border-team",
        roleAgentId: "creator",
        status: instanceStatus
      };
    },
    async reconcileInstances() {
      calls.push("reconcile");
      instanceStatus = "missing";
      return {};
    },
    async registerInstance() {
      calls.push("register");
      throw new Error("OpenClaw Agent 注册失败：/Users/example/private");
    },
    async sendMessage() {
      calls.push("send");
      return { assistantMessage: { status: "completed" } };
    }
  }));

  const result = await service.sendConversationMessage(
    "cross-border-team-manager",
    "chat-safe",
    "测试"
  );

  assert.equal(result.ok, false);
  assert.deepEqual(calls, ["reconcile", "register"]);
  assert.doesNotMatch(result.message, /\/Users\/example|private/);
});

test("Conversation GUI 服务使用临时 State 与 Mock Adapter完成两轮真实 Core 对话", async (t) => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "openclaw-conversation-service-")
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const instanceId = "cross-border-team-manager";
  const instanceStatePath = path.join(root, "instances", "state.json");
  await writeInstanceState(instanceStatePath, {
    schemaVersion: 1,
    instances: {
      [instanceId]: {
        instanceId,
        roleId: "cross-border-team",
        roleVersion: "1.0.0",
        roleAgentId: "manager",
        workspacePath: path.join(root, "workspaces", "manager"),
        agentDir: path.join(root, "agent-dirs", instanceId),
        status: "registered",
        registeredAt: "2026-07-29T10:00:00.000Z",
        updatedAt: "2026-07-29T10:00:00.000Z",
        lastReconciledAt: "2026-07-29T10:00:00.000Z",
        drift: []
      }
    }
  });

  const adapterCalls = [];
  const responses = ["第一轮真实回复", "第二轮真实回复"];
  let messageIndex = 0;
  let turnIndex = 0;
  const conversationOptions = {
    conversationStatePath: path.join(root, "conversations", "state.json"),
    messageStateDirectory: path.join(root, "conversations", "messages"),
    conversationOperationLockDirectory: path.join(
      root,
      "conversations",
      "operations"
    ),
    instanceStatePath,
    projectStatePath: path.join(root, "projects", "state.json"),
    agentCallLeasePath: path.join(root, "agent-call", "active.lock"),
    now: () => new Date("2026-07-29T12:00:00.000Z"),
    createSessionKey: () => "agent:cross-border-team-manager:test-session",
    createMessageId: () => MESSAGE_IDS[messageIndex++],
    createTurnId: () => TURN_IDS[turnIndex++],
    openClawConversationAdapter: {
      async sendConversationMessage(input, runtime) {
        adapterCalls.push({ ...input });
        await runtime.onSpawn({ pid: 43210 });
        return {
          ok: true,
          interrupted: false,
          timedOut: false,
          code: 0,
          signal: null,
          content: responses.shift(),
          openClawSessionId: "safe-session-id",
          openClawRunId: `safe-run-${adapterCalls.length}`,
          errorType: null,
          errorSummary: null
        };
      }
    }
  };
  const serviceOptions = {
    conversationOptions,
    instanceOptions: {
      instanceStatePath,
      openClawAdapter: {
        async listAgents() {
          return [{
            id: instanceId,
            workspacePath: path.join(root, "workspaces", "manager"),
            agentDir: path.join(root, "agent-dirs", instanceId)
          }];
        },
        async registerAgent() {
          throw new Error("不应重新注册");
        }
      }
    },
    createConversationId: () => "chat-integration"
  };
  const service = createConversationService(publicApi, serviceOptions);

  const opened = await service.getOrCreateAgentConversation(instanceId);
  const first = await service.sendConversationMessage(
    instanceId,
    opened.conversation.conversationId,
    "第一轮"
  );
  const second = await service.sendConversationMessage(
    instanceId,
    opened.conversation.conversationId,
    "第二轮"
  );
  const rebuiltService = createConversationService(publicApi, serviceOptions);
  const reopened = await rebuiltService.getOrCreateAgentConversation(instanceId);
  const internalMessages = await publicApi.listMessages(
    "chat-integration",
    { limit: 20 },
    conversationOptions
  );

  assert.equal(opened.ok, true);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(reopened.conversation.conversationId, "chat-integration");
  assert.deepEqual(
    reopened.messages.map((message) => [
      message.sequence,
      message.role,
      message.status,
      message.content
    ]),
    [
      [1, "user", "completed", "第一轮"],
      [2, "assistant", "completed", "第一轮真实回复"],
      [3, "user", "completed", "第二轮"],
      [4, "assistant", "completed", "第二轮真实回复"]
    ]
  );
  assert.equal(adapterCalls.length, 2);
  assert.equal(adapterCalls[0].sessionKey, adapterCalls[1].sessionKey);
  assert.equal(adapterCalls[0].sessionKey.includes("test-session"), true);
  assert.deepEqual(
    internalMessages
      .filter((message) => message.role === "assistant")
      .map((message) => message.openClawSessionId),
    ["safe-session-id", "safe-session-id"]
  );
  assert.deepEqual(
    internalMessages
      .filter((message) => message.role === "assistant")
      .map((message) => message.openClawRunId),
    ["safe-run-1", "safe-run-2"]
  );
  assert.equal(JSON.stringify(reopened).includes("sessionKey"), false);
  assert.equal(fs.existsSync(path.join(root, "agent-call", "active.lock")), false);
});

test("隔离环境安装角色、注册三个 Instance 后 researcher 可连续聊天", async (t) => {
  const root = fs.realpathSync(fs.mkdtempSync(
    path.join(os.tmpdir(), "openclaw-role-chat-acceptance-")
  ));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const roleOptions = {
    rolesDirectory: path.join(__dirname, "..", "roles"),
    installRoot: path.join(root, "roles", "installed"),
    statePath: path.join(root, "roles", "state.json"),
    mainWorkspace: path.join(root, "main-workspace")
  };
  const remoteAgents = [];
  const openClawAgentAdapter = {
    async listAgents() {
      return remoteAgents.map((agent) => ({ ...agent }));
    },
    async registerAgent(input) {
      remoteAgents.push({
        id: input.instanceId,
        workspacePath: input.workspacePath,
        agentDir: input.agentDir
      });
      return { ok: true };
    }
  };
  const instanceOptions = {
    instanceStatePath: path.join(root, "instances", "state.json"),
    agentDirRoot: path.join(root, "instances", "agent-dirs"),
    roleStatePath: roleOptions.statePath,
    mainWorkspace: roleOptions.mainWorkspace,
    openClawAdapter: openClawAgentAdapter,
    now: () => new Date("2026-07-29T11:00:00.000Z")
  };

  await publicApi.installRole("cross-border-team", roleOptions);
  for (const roleAgentId of ["manager", "researcher", "creator"]) {
    await publicApi.registerInstance(
      "cross-border-team",
      roleAgentId,
      instanceOptions
    );
  }

  const adapterCalls = [];
  let messageIndex = 0;
  let turnIndex = 0;
  const conversationOptions = {
    conversationStatePath: path.join(root, "conversations", "state.json"),
    messageStateDirectory: path.join(root, "conversations", "messages"),
    conversationOperationLockDirectory: path.join(
      root,
      "conversations",
      "operations"
    ),
    instanceStatePath: instanceOptions.instanceStatePath,
    projectStatePath: path.join(root, "projects", "state.json"),
    agentCallLeasePath: path.join(root, "agent-call", "active.lock"),
    now: () => new Date("2026-07-29T12:00:00.000Z"),
    createSessionKey: () => "agent:cross-border-team-researcher:fixed-chat",
    createMessageId: () => MESSAGE_IDS[messageIndex++],
    createTurnId: () => TURN_IDS[turnIndex++],
    openClawConversationAdapter: {
      async sendConversationMessage(input, runtime) {
        adapterCalls.push({ ...input });
        await runtime.onSpawn({ pid: 54321 });
        return {
          ok: true,
          interrupted: false,
          timedOut: false,
          code: 0,
          signal: null,
          content: `隔离回复 ${adapterCalls.length}`,
          openClawSessionId: "remote-session-fixed",
          openClawRunId: `remote-run-${adapterCalls.length}`,
          errorType: null,
          errorSummary: null
        };
      }
    }
  };
  const serviceOptions = {
    conversationOptions,
    instanceOptions,
    createConversationId: () => "chat-researcher"
  };
  const service = createConversationService(publicApi, serviceOptions);

  const opened = await service.getOrCreateAgentConversation(
    "cross-border-team-researcher"
  );
  const first = await service.sendConversationMessage(
    "cross-border-team-researcher",
    opened.conversation.conversationId,
    "第一轮研究问题"
  );
  const second = await service.sendConversationMessage(
    "cross-border-team-researcher",
    opened.conversation.conversationId,
    "第二轮继续追问"
  );
  const rebuilt = createConversationService(publicApi, serviceOptions);
  const reopened = await rebuilt.getOrCreateAgentConversation(
    "cross-border-team-researcher"
  );

  assert.equal((await publicApi.listInstalledRoles(roleOptions)).length, 1);
  assert.deepEqual(
    (await publicApi.listInstances(instanceOptions))
      .map((instance) => instance.instanceId),
    [
      "cross-border-team-creator",
      "cross-border-team-manager",
      "cross-border-team-researcher"
    ]
  );
  assert.equal(opened.ok, true);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(reopened.conversation.conversationId, "chat-researcher");
  assert.equal(reopened.messages.length, 4);
  assert.equal(adapterCalls.length, 2);
  assert.equal(adapterCalls[0].sessionKey, adapterCalls[1].sessionKey);
  assert.equal(JSON.stringify(reopened).includes("sessionKey"), false);
  assert.equal(JSON.stringify(reopened).includes("openClawSessionId"), false);
  assert.equal(JSON.stringify(reopened).includes(root), false);
  assert.equal(remoteAgents.length, 3);
  assert.equal(fs.existsSync(path.join(root, "agent-call", "active.lock")), false);
});
