const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { projectPath } = require("./helpers");
const {
  createEmptyConversationState,
  getConversationState,
  listConversationStates,
  readConversationState,
  updateConversationState,
  writeConversationState
} = require(projectPath("src/core/conversations/state.js"));
const {
  assertConversationId,
  assertMessageId,
  assertTurnId,
  createMessageId,
  createTurnId
} = require(projectPath("src/core/conversations/id.js"));

const UNSAFE_STRUCTURAL_PATHS = [
  "/etc/passwd",
  "/opt/openclaw/session.json",
  "/Volumes/Data/agent",
  "/usr/local/bin/openclaw",
  "C:\\Users\\example\\agent",
  "C:/Users/example/agent",
  "d:\\openclaw\\state.json",
  "\\\\server\\share\\agent",
  "//server/share/agent",
  "\\\\?\\C:\\Users\\example",
  "../secret",
  "./state.json"
];

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-conversation-state-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function record(id, overrides = {}) {
  const now = "2026-07-23T00:00:00.000Z";
  return {
    conversationId: id,
    title: "测试对话",
    instanceId: "test-role-worker",
    projectId: null,
    status: "active",
    sessionKey: `agent:test-role-worker:conversation-${id}`,
    openClawSessionId: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    ...overrides
  };
}

test("CLI 显式 Conversation ID 以及 Message、Turn ID 均可校验", () => {
  const conversationId = "explicit-conversation";
  const messageId = createMessageId();
  const turnId = createTurnId();
  assert.equal(assertConversationId(conversationId), conversationId);
  assert.equal(assertMessageId(messageId), messageId);
  assert.equal(assertTurnId(turnId), turnId);
  assert.throws(() => assertConversationId("main"), /受保护/);
  assert.throws(() => assertConversationId("Upper_Case"), /无效/);
});

test("Conversation State 初始化、原子写入、权限与临时文件清理", async (t) => {
  const root = tempRoot(t);
  const statePath = path.join(root, "data", "conversations", "state.json");
  assert.deepEqual(await readConversationState(statePath), createEmptyConversationState());

  const state = createEmptyConversationState();
  state.conversations["test-chat"] = record("test-chat");
  await writeConversationState(statePath, state);

  assert.deepEqual(await readConversationState(statePath), state);
  assert.equal(fs.statSync(statePath).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(statePath)).mode & 0o777, 0o700);
  assert.deepEqual(
    fs.readdirSync(path.dirname(statePath)).sort(),
    ["locks", "state.json"]
  );
  assert.deepEqual(
    fs.readdirSync(path.join(path.dirname(statePath), "locks")),
    []
  );
});

test("Conversation State 损坏和 schema 错误明确拒绝且不覆盖原文件", async (t) => {
  const root = tempRoot(t);
  const statePath = path.join(root, "state.json");
  fs.writeFileSync(statePath, "{broken", "utf8");
  const original = fs.readFileSync(statePath);
  await assert.rejects(() => readConversationState(statePath), /不是有效 JSON/);
  await assert.rejects(
    () => updateConversationState(statePath, (state) => state),
    /不是有效 JSON/
  );
  assert.deepEqual(fs.readFileSync(statePath), original);

  fs.writeFileSync(statePath, JSON.stringify({ schemaVersion: 2, conversations: {} }));
  await assert.rejects(() => readConversationState(statePath), /schemaVersion 必须为 1/);
});

test("Conversation State 白名单、深拷贝和 conversationId 稳定排序", async (t) => {
  const root = tempRoot(t);
  const statePath = path.join(root, "state.json");
  await writeConversationState(statePath, {
    schemaVersion: 1,
    conversations: {
      "z-chat": {
        ...record("z-chat"),
        workspacePath: "/private/secret",
        token: "must-not-persist"
      },
      "a-chat": record("a-chat")
    },
    apiKey: "must-not-persist"
  });
  const raw = fs.readFileSync(statePath, "utf8");
  assert.doesNotMatch(raw, /workspacePath|must-not-persist|apiKey|token/);
  assert.deepEqual(
    listConversationStates(await readConversationState(statePath))
      .map((item) => item.conversationId),
    ["a-chat", "z-chat"]
  );
  const first = await readConversationState(statePath);
  first.conversations["a-chat"].title = "外部修改";
  assert.equal(
    getConversationState(await readConversationState(statePath), "a-chat").title,
    "测试对话"
  );
});

test("Conversation State write/update 会完整清理 title 中的多词和多行内部字段", async (t) => {
  const root = tempRoot(t);
  const statePath = path.join(root, "state.json");
  await writeConversationState(statePath, {
    schemaVersion: 1,
    conversations: {
      "test-chat": record("test-chat", {
        title: "正常标题\nstdout=STATE MULTI WORD SECRET\n标题结尾"
      })
    }
  });
  let raw = fs.readFileSync(statePath, "utf8");
  assert.doesNotMatch(raw, /STATE|MULTI|WORD|SECRET/);
  assert.match(raw, /stdout=\[REDACTED\]/);
  assert.match(raw, /标题结尾/);

  await updateConversationState(statePath, (state) => {
    state.conversations["test-chat"].title = [
      "标题开头",
      "result.meta={",
      '  \"stdout\": \"STATE_OBJECT_SECRET\"',
      "}",
      "标题结束"
    ].join("\n");
    return state;
  });
  raw = fs.readFileSync(statePath, "utf8");
  const title = (
    await readConversationState(statePath)
  ).conversations["test-chat"].title;
  assert.doesNotMatch(raw, /STATE_OBJECT_SECRET/);
  assert.doesNotMatch(title, /STATE_OBJECT_SECRET/);
  assert.match(title, /result\.meta=\[REDACTED\]/);
  assert.match(title, /标题开头/);
  assert.match(title, /标题结束/);
});

test("Conversation State 校验 ID、状态时间组合和 Session Key", async (t) => {
  const root = tempRoot(t);
  const statePath = path.join(root, "state.json");
  for (const [id, item, expected] of [
    ["main", record("main"), /main 是受保护名称/],
    ["Bad_ID", record("Bad_ID"), /conversationId 无效/],
    ["archived", record("archived", { status: "archived" }), /archivedAt/],
    ["newline", record("newline", { sessionKey: "bad\nkey" }), /控制字符/],
    ["credential", record("credential", {
      title: "sk-1234567890"
    }), /疑似包含 API Key/]
  ]) {
    await assert.rejects(
      () => writeConversationState(statePath, {
        schemaVersion: 1,
        conversations: { [id]: item }
      }),
      expected
    );
  }
  await writeConversationState(statePath, {
    schemaVersion: 1,
    conversations: {
      archived: record("archived", {
        status: "archived",
        archivedAt: "2026-07-23T01:00:00.000Z"
      })
    }
  });
});

test("Conversation State 并发更新串行化且不会互相覆盖", async (t) => {
  const root = tempRoot(t);
  const statePath = path.join(root, "state.json");
  await Promise.all(["z-chat", "a-chat"].map((id) =>
    updateConversationState(statePath, async (state) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      state.conversations[id] = record(id);
      return state;
    })
  ));
  assert.deepEqual(
    listConversationStates(await readConversationState(statePath))
      .map((item) => item.conversationId),
    ["a-chat", "z-chat"]
  );
});

test("Conversation State 公开写入边界拒绝敏感 Session Key 且不创建部分状态", async (t) => {
  const root = tempRoot(t);
  const unsafeValues = [
    "workspacePath=/private/tmp/test",
    "apiKey=sk-test",
    "Bearer test-token",
    "-----BEGIN PRIVATE KEY-----\nPRIVATE_BODY\n-----END PRIVATE KEY-----",
    "agentDir=/Users/test/.openclaw/agents/demo",
    ...UNSAFE_STRUCTURAL_PATHS
  ];
  for (const [index, value] of unsafeValues.entries()) {
    const statePath = path.join(root, `unsafe-session-${index}.json`);
    await assert.rejects(
      () => writeConversationState(statePath, {
        schemaVersion: 1,
        conversations: {
          "test-chat": record("test-chat", { sessionKey: value })
        }
      }),
      (error) => {
        assert.match(error.message, /sessionKey 包含不允许的敏感内容/);
        assert.doesNotMatch(error.message, new RegExp(escapeRegex(value)));
        return true;
      }
    );
    assert.equal(fs.existsSync(statePath), false);
    assertNoStateArtifacts(path.dirname(statePath));
  }
});

test("Conversation State 的结构字段在格式校验前安全拒绝路径且不回显", async (t) => {
  const root = tempRoot(t);
  for (const [field, value] of [
    ["conversationId", "/etc/passwd"],
    ["instanceId", "/opt/openclaw/agent"],
    ["projectId", "C:\\Users\\example\\project"]
  ]) {
    const statePath = path.join(root, `${field}.json`);
    const item = record("test-chat", { [field]: value });
    const key = field === "conversationId" ? value : "test-chat";
    await assert.rejects(
      () => writeConversationState(statePath, {
        schemaVersion: 1,
        conversations: { [key]: item }
      }),
      (error) => {
        assert.match(error.message, /不安全路径/);
        assert.doesNotMatch(error.message, new RegExp(escapeRegex(value)));
        return true;
      }
    );
    assert.equal(fs.existsSync(statePath), false);
  }
});

test("Conversation State 直接 write/update 拒绝敏感远端标识且原文件字节不变", async (t) => {
  const root = tempRoot(t);
  const statePath = path.join(root, "state.json");
  await writeConversationState(statePath, {
    schemaVersion: 1,
    conversations: {
      "test-chat": record("test-chat", {
        openClawSessionId: "session-safe"
      })
    }
  });
  const original = fs.readFileSync(statePath);
  const unsafeValues = [
    "workspaceDir=/Users/test/workspace",
    "-----BEGIN RSA PRIVATE KEY-----\nPRIVATE_BODY\n-----END RSA PRIVATE KEY-----",
    "token=fixture-token",
    ...UNSAFE_STRUCTURAL_PATHS
  ];

  for (const value of unsafeValues) {
    await assert.rejects(
      () => updateConversationState(statePath, (state) => {
        state.conversations["test-chat"].openClawSessionId = value;
        return state;
      }),
      /openClawSessionId 包含不允许的敏感内容/
    );
    assert.deepEqual(fs.readFileSync(statePath), original);
  }

  const directPath = path.join(root, "direct.json");
  await assert.rejects(
    () => writeConversationState(directPath, {
      schemaVersion: 1,
      conversations: {
        "test-chat": record("test-chat", {
          openClawSessionId: "sessionFile=/Users/test/session.json"
        })
      }
    }),
    /openClawSessionId 包含不允许的敏感内容/
  );
  assert.equal(fs.existsSync(directPath), false);
  assertNoStateArtifacts(root);
});

function assertNoStateArtifacts(directory) {
  const files = fs.readdirSync(directory, { recursive: true })
    .filter((entry) =>
      /\.tmp-|\.lock$|\.mutation$/.test(String(entry))
    );
  assert.deepEqual(files, []);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
