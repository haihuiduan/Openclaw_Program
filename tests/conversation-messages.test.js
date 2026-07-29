const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { projectPath } = require("./helpers");
const {
  createEmptyMessageState,
  getMessageState,
  listMessageStates,
  readMessageState,
  resolveMessageStatePath,
  updateMessageState,
  writeMessageState
} = require(projectPath("src/core/conversations/messageState.js"));

const USER_ID = "msg-00000000-0000-4000-8000-000000000001";
const ASSISTANT_ID = "msg-00000000-0000-4000-8000-000000000002";
const TURN_ID = "turn-00000000-0000-4000-8000-000000000001";
const NOW = "2026-07-23T00:00:00.000Z";
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-message-state-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function pair(conversationId = "test-chat", assistant = {}) {
  return {
    [USER_ID]: {
      messageId: USER_ID,
      turnId: TURN_ID,
      conversationId,
      sequence: 1,
      role: "user",
      status: "completed",
      content: "你好",
      errorSummary: null,
      openClawSessionId: null,
      openClawRunId: null,
      createdAt: NOW,
      updatedAt: NOW,
      completedAt: NOW,
      failedAt: null,
      interruptedAt: null
    },
    [ASSISTANT_ID]: {
      messageId: ASSISTANT_ID,
      turnId: TURN_ID,
      conversationId,
      sequence: 2,
      role: "assistant",
      status: "completed",
      content: "你好，我可以帮助你。",
      errorSummary: null,
      openClawSessionId: "session-safe",
      openClawRunId: "run-safe",
      createdAt: NOW,
      updatedAt: NOW,
      completedAt: NOW,
      failedAt: null,
      interruptedAt: null,
      ...assistant
    }
  };
}

test("Message State 路径隔离、初始化、权限和原子写入", async (t) => {
  const root = tempRoot(t);
  const directory = path.join(root, "messages");
  const statePath = resolveMessageStatePath(directory, "test-chat");
  assert.equal(statePath, path.join(directory, "test-chat.json"));
  assert.deepEqual(
    await readMessageState(statePath, "test-chat"),
    createEmptyMessageState("test-chat")
  );
  await writeMessageState(statePath, {
    schemaVersion: 1,
    conversationId: "test-chat",
    messages: pair()
  });
  assert.equal(fs.statSync(statePath).mode & 0o777, 0o600);
  assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  assert.deepEqual(fs.readdirSync(directory), ["test-chat.json"]);
  assert.throws(
    () => resolveMessageStatePath(directory, "../escape"),
    /不安全路径/
  );
});

test("Message State 强制 User/Assistant 配对、唯一 sequence 和生命周期组合", async (t) => {
  const root = tempRoot(t);
  const statePath = path.join(root, "messages.json");
  const messages = pair();
  delete messages[ASSISTANT_ID];
  await assert.rejects(
    () => writeMessageState(statePath, {
      schemaVersion: 1,
      conversationId: "test-chat",
      messages
    }),
    /恰好包含一条 user 和一条 assistant/
  );
  const duplicate = pair();
  duplicate[ASSISTANT_ID].sequence = 1;
  await assert.rejects(
    () => writeMessageState(statePath, {
      schemaVersion: 1,
      conversationId: "test-chat",
      messages: duplicate
    }),
    /sequence 不能重复/
  );
  const invalid = pair("test-chat", { status: "failed", content: "不应存在" });
  await assert.rejects(
    () => writeMessageState(statePath, {
      schemaVersion: 1,
      conversationId: "test-chat",
      messages: invalid
    }),
    /content 必须为 null/
  );
  const reversed = pair();
  reversed[USER_ID].sequence = 2;
  reversed[ASSISTANT_ID].sequence = 1;
  await assert.rejects(
    () => writeMessageState(statePath, {
      schemaVersion: 1,
      conversationId: "test-chat",
      messages: reversed
    }),
    /User sequence 必须小于 Assistant sequence/
  );
});

test("Message State 稳定排序、白名单、深拷贝和敏感字段脱敏", async (t) => {
  const root = tempRoot(t);
  const statePath = path.join(root, "messages.json");
  const messages = pair();
  messages[USER_ID].apiKey = "must-not-persist";
  messages[ASSISTANT_ID].content = "token=private-value 安全正文";
  await writeMessageState(statePath, {
    schemaVersion: 1,
    conversationId: "test-chat",
    messages,
    workspacePath: "/private/path"
  });
  const raw = fs.readFileSync(statePath, "utf8");
  assert.doesNotMatch(raw, /must-not-persist|private-value|workspacePath|apiKey/);
  const state = await readMessageState(statePath, "test-chat");
  assert.deepEqual(
    listMessageStates(state).map((item) => item.sequence),
    [1, 2]
  );
  state.messages[USER_ID].content = "外部修改";
  assert.equal(
    getMessageState(await readMessageState(statePath, "test-chat"), USER_ID).content,
    "你好"
  );
});

test("Message State 损坏文件和 conversationId 不一致时不覆盖", async (t) => {
  const root = tempRoot(t);
  const statePath = path.join(root, "messages.json");
  fs.writeFileSync(statePath, "{", "utf8");
  const original = fs.readFileSync(statePath);
  await assert.rejects(
    () => readMessageState(statePath, "test-chat"),
    /不是有效 JSON/
  );
  assert.deepEqual(fs.readFileSync(statePath), original);
  await assert.rejects(
    () => writeMessageState(path.join(root, "other.json"), {
      schemaVersion: 1,
      conversationId: "other-chat",
      messages: pair("test-chat")
    }),
    /根状态不一致/
  );
});

test("Message State 直接写入也会在落盘前拒绝高可信 User 凭据", async (t) => {
  const root = tempRoot(t);
  const statePath = path.join(root, "messages.json");
  const messages = pair();
  messages[USER_ID].content = "Bearer abcdefghijklmnop";
  await assert.rejects(
    () => writeMessageState(statePath, {
      schemaVersion: 1,
      conversationId: "test-chat",
      messages
    }),
    /疑似包含 API Key/
  );
  assert.equal(fs.existsSync(statePath), false);
});

test("Message State 并发追加完整 Turn 时串行化且不丢失", async (t) => {
  const root = tempRoot(t);
  const statePath = path.join(root, "messages.json");
  const secondUserId = "msg-00000000-0000-4000-8000-000000000003";
  const secondAssistantId = "msg-00000000-0000-4000-8000-000000000004";
  const secondTurnId = "turn-00000000-0000-4000-8000-000000000002";
  await Promise.all([
    updateMessageState(statePath, "test-chat", async (state) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      Object.assign(state.messages, pair());
      return state;
    }),
    updateMessageState(statePath, "test-chat", (state) => {
      const messages = pair();
      const user = {
        ...messages[USER_ID],
        messageId: secondUserId,
        turnId: secondTurnId,
        sequence: 3
      };
      const assistant = {
        ...messages[ASSISTANT_ID],
        messageId: secondAssistantId,
        turnId: secondTurnId,
        sequence: 4
      };
      state.messages[secondUserId] = user;
      state.messages[secondAssistantId] = assistant;
      return state;
    })
  ]);
  assert.deepEqual(
    listMessageStates(await readMessageState(statePath, "test-chat"))
      .map((item) => item.sequence),
    [1, 2, 3, 4]
  );
});

test("Message State 直接写入清理 Assistant 私钥、错误摘要和明确内部路径", async (t) => {
  const root = tempRoot(t);
  const completedPath = path.join(root, "completed.json");
  const privateBlocks = [
    "PRIVATE KEY",
    "RSA PRIVATE KEY",
    "EC PRIVATE KEY",
    "OPENSSH PRIVATE KEY",
    "ENCRYPTED PRIVATE KEY"
  ].map((label, index) => [
    `-----BEGIN ${label}-----`,
    `PRIVATE_BODY_${index}`,
    `-----END ${label}-----`
  ].join("\n"));
  const completed = pair();
  completed[ASSISTANT_ID].content = [
    "正常回复",
    ...privateBlocks,
    "workspacePath=/private/tmp/test",
    "workspaceDir=/Users/test/workspace",
    "agentDir=/Users/test/.openclaw/agents/demo",
    "sessionFile=/Users/test/.openclaw/sessions/demo.json",
    "回复结尾"
  ].join("\n");
  completed[USER_ID].content =
    "Python 文件在 /Users/test/project/main.py，怎么运行？";
  await writeMessageState(completedPath, {
    schemaVersion: 1,
    conversationId: "test-chat",
    messages: completed
  });
  const completedRaw = fs.readFileSync(completedPath, "utf8");
  assert.doesNotMatch(
    completedRaw,
    /BEGIN .*PRIVATE KEY|END .*PRIVATE KEY|PRIVATE_BODY_|\/private\/tmp|\/Users\/test\/workspace|\.openclaw\/agents|\.openclaw\/sessions/
  );
  assert.match(completedRaw, /\[REDACTED_PRIVATE_KEY\]/);
  assert.match(completedRaw, /\[REDACTED_INTERNAL_PATH\]/);
  assert.match(completedRaw, /\/Users\/test\/project\/main\.py/);

  const failedPath = path.join(root, "failed.json");
  const failed = pair("test-chat", {
    status: "failed",
    content: null,
    errorSummary: [
      "失败前正文",
      "-----BEGIN RSA PRIVATE KEY-----",
      "ERROR_PRIVATE_BODY",
      "-----END RSA PRIVATE KEY-----",
      "失败后正文"
    ].join("\n"),
    openClawSessionId: null,
    openClawRunId: null,
    completedAt: null,
    failedAt: NOW
  });
  await writeMessageState(failedPath, {
    schemaVersion: 1,
    conversationId: "test-chat",
    messages: failed
  });
  const errorSummary = (
    await readMessageState(failedPath, "test-chat")
  ).messages[ASSISTANT_ID].errorSummary;
  assert.equal(
    errorSummary,
    "失败前正文\n[REDACTED_PRIVATE_KEY]\n失败后正文"
  );
});

test("Message State 完整清理 User、Assistant 和 errorSummary 的多词多行字段值", async (t) => {
  const root = tempRoot(t);
  const completedPath = path.join(root, "completed-structured.json");
  const completed = pair();
  completed[USER_ID].content = [
    "用户前文",
    "stdout=USER MULTI WORD SECRET",
    "用户后文"
  ].join("\n");
  completed[ASSISTANT_ID].content = [
    "助手前文",
    "result.meta={",
    '  "stdout": "ASSISTANT_OBJECT_SECRET",',
    '  "nested": ["ASSISTANT_ARRAY_SECRET"]',
    "}",
    "助手后文"
  ].join("\n");
  await writeMessageState(completedPath, {
    schemaVersion: 1,
    conversationId: "test-chat",
    messages: completed
  });

  const completedRaw = fs.readFileSync(completedPath, "utf8");
  const completedState = await readMessageState(
    completedPath,
    "test-chat"
  );
  for (const secret of [
    "USER MULTI WORD SECRET",
    "ASSISTANT_OBJECT_SECRET",
    "ASSISTANT_ARRAY_SECRET"
  ]) {
    assert.doesNotMatch(completedRaw, new RegExp(secret));
    assert.doesNotMatch(
      JSON.stringify(completedState),
      new RegExp(secret)
    );
  }
  assert.match(completedState.messages[USER_ID].content, /用户前文/);
  assert.match(completedState.messages[USER_ID].content, /用户后文/);
  assert.match(completedState.messages[ASSISTANT_ID].content, /助手前文/);
  assert.match(completedState.messages[ASSISTANT_ID].content, /助手后文/);

  const failedPath = path.join(root, "failed-structured.json");
  const failed = pair("test-chat", {
    status: "failed",
    content: null,
    errorSummary: [
      "错误前文",
      "stderr: ERROR MULTI WORD SECRET",
      "错误后文"
    ].join("\n"),
    openClawSessionId: null,
    openClawRunId: null,
    completedAt: null,
    failedAt: NOW
  });
  await writeMessageState(failedPath, {
    schemaVersion: 1,
    conversationId: "test-chat",
    messages: failed
  });
  const failedRaw = fs.readFileSync(failedPath, "utf8");
  const failedState = await readMessageState(failedPath, "test-chat");
  assert.doesNotMatch(failedRaw, /ERROR MULTI WORD SECRET/);
  assert.doesNotMatch(
    failedState.messages[ASSISTANT_ID].errorSummary,
    /ERROR MULTI WORD SECRET/
  );
  assert.match(
    failedState.messages[ASSISTANT_ID].errorSummary,
    /错误前文[\s\S]*stderr: \[REDACTED\][\s\S]*错误后文/
  );
});

test("Message State 公开 write/update 拒绝敏感远端标识且保持原文件不变", async (t) => {
  const root = tempRoot(t);
  const statePath = path.join(root, "messages.json");
  await writeMessageState(statePath, {
    schemaVersion: 1,
    conversationId: "test-chat",
    messages: pair()
  });
  const original = fs.readFileSync(statePath);
  const unsafe = [
    ["openClawSessionId", "workspacePath=/private/tmp/test"],
    [
      "openClawRunId",
      "-----BEGIN PRIVATE KEY-----\nPRIVATE_BODY\n-----END PRIVATE KEY-----"
    ],
    ["openClawRunId", "token=fixture-token"]
  ];
  for (const [field, value] of unsafe) {
    await assert.rejects(
      () => updateMessageState(
        statePath,
        "test-chat",
        (state) => {
          state.messages[ASSISTANT_ID][field] = value;
          return state;
        }
      ),
      new RegExp(`${field} 包含不允许的敏感内容`)
    );
    assert.deepEqual(fs.readFileSync(statePath), original);
  }

  const directPath = path.join(root, "direct.json");
  const direct = pair();
  direct[ASSISTANT_ID].openClawSessionId =
    "agentDir=/Users/test/.openclaw/agents/demo";
  await assert.rejects(
    () => writeMessageState(directPath, {
      schemaVersion: 1,
      conversationId: "test-chat",
      messages: direct
    }),
    /openClawSessionId 包含不允许的敏感内容/
  );
  assert.equal(fs.existsSync(directPath), false);
  assertNoMessageArtifacts(root);
});

test("Message State 的 Session/Run ID 拒绝通用路径且失败更新保持字节不变", async (t) => {
  const root = tempRoot(t);
  const statePath = path.join(root, "path-identifiers.json");
  await writeMessageState(statePath, {
    schemaVersion: 1,
    conversationId: "test-chat",
    messages: pair()
  });
  const original = fs.readFileSync(statePath);

  for (const field of ["openClawSessionId", "openClawRunId"]) {
    for (const value of UNSAFE_STRUCTURAL_PATHS) {
      await assert.rejects(
        () => updateMessageState(
          statePath,
          "test-chat",
          (state) => {
            state.messages[ASSISTANT_ID][field] = value;
            return state;
          }
        ),
        (error) => {
          assert.match(error.message, /不安全路径/);
          assert.doesNotMatch(error.message, new RegExp(escapeRegex(value)));
          return true;
        }
      );
      assert.deepEqual(fs.readFileSync(statePath), original);
    }
  }
  assertNoMessageArtifacts(root);
});

function assertNoMessageArtifacts(directory) {
  const files = fs.readdirSync(directory, { recursive: true })
    .filter((entry) =>
      /\.tmp-|\.lock$|\.mutation$/.test(String(entry))
    );
  assert.deepEqual(files, []);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
