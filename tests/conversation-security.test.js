const assert = require("node:assert/strict");
const test = require("node:test");
const { projectPath } = require("./helpers");
const {
  assertSafeStructuralIdentifier,
  sanitizeAssistantMessage,
  sanitizeErrorSummary,
  sanitizeUserMessage,
  sanitizeVisibleText
} = require(projectPath("src/core/conversations/security.js"));
const {
  formatConversationInspect,
  formatConversationMessages
} = require(projectPath("src/cli/presenters/conversationsPresenter.js"));

const PRIVATE_KEY_LABELS = [
  "PRIVATE KEY",
  "RSA PRIVATE KEY",
  "EC PRIVATE KEY",
  "OPENSSH PRIVATE KEY",
  "ENCRYPTED PRIVATE KEY"
];
const UNSAFE_STRUCTURAL_PATHS = [
  "/",
  "/etc/passwd",
  "/opt/openclaw/session.json",
  "/Volumes/Data/agent",
  "/usr/local/bin/openclaw",
  "/var/lib/openclaw",
  "///var/lib/openclaw",
  "C:\\Users\\example\\agent",
  "C:/Users/example/agent",
  "d:\\openclaw\\state.json",
  "Z:/network/share",
  "\\\\server\\share\\agent",
  "//server/share/agent",
  "\\\\?\\C:\\Users\\example",
  "\\\\.\\pipe\\openclaw",
  "../secret",
  "./state.json",
  "folder/../secret"
];

function privateKey(label, body = "FIXTURE_PRIVATE_BODY") {
  return [
    `-----BEGIN ${label}-----`,
    body,
    `-----END ${label}-----`
  ].join("\n");
}

test("可见文本完整替换常见多行私钥块并保留正常正文", () => {
  const input = [
    "正常开头",
    ...PRIVATE_KEY_LABELS.map((label, index) =>
      privateKey(label, `PRIVATE_BODY_${index}`)
    ),
    "正常结尾"
  ].join("\n");
  const output = sanitizeAssistantMessage(input, 4000);

  assert.equal(
    output.match(/\[REDACTED_PRIVATE_KEY\]/g).length,
    PRIVATE_KEY_LABELS.length
  );
  assert.match(output, /正常开头/);
  assert.match(output, /正常结尾/);
  assert.doesNotMatch(output, /BEGIN .*PRIVATE KEY|END .*PRIVATE KEY|PRIVATE_BODY_/);
  assert.equal(
    sanitizeVisibleText(
      "-----BEGIN PUBLIC KEY-----\nPUBLIC_BODY\n-----END PUBLIC KEY-----",
      4000
    ),
    "-----BEGIN PUBLIC KEY-----\nPUBLIC_BODY\n-----END PUBLIC KEY-----"
  );
});

test("错误摘要和明确内部路径字段被替换，但普通路径讨论不被误伤", () => {
  const error = sanitizeErrorSummary(
    `失败前正文\n${privateKey("RSA PRIVATE KEY")}\n失败后正文`,
    2000
  );
  assert.match(error, /失败前正文/);
  assert.match(error, /\[REDACTED_PRIVATE_KEY\]/);
  assert.match(error, /失败后正文/);

  const internal = sanitizeVisibleText([
    "workspacePath=/private/tmp/test",
    "workspaceDir=/Users/test/workspace",
    "agentDir=/Users/test/.openclaw/agents/demo",
    "sessionFile=/Users/test/.openclaw/sessions/demo.json"
  ].join("\n"), 4000);
  assert.equal(
    internal.match(/\[REDACTED_INTERNAL_PATH\]/g).length,
    4
  );
  assert.doesNotMatch(internal, /\/private\/tmp|\/Users\/test/);

  const normal = "Python 文件在 /Users/test/project/main.py，怎么运行？";
  assert.equal(sanitizeUserMessage(normal, 8000), normal);
});

test("结构性标识符拒绝路径、凭据、私钥和内部字段且错误不回显原值", () => {
  const unsafeValues = [
    "workspacePath=/private/tmp/test",
    "apiKey=sk-test",
    "Bearer test-token",
    privateKey("PRIVATE KEY"),
    "agentDir=/Users/test/.openclaw/agents/demo",
    "/Users/test/.openclaw/session.json",
    "secret=fixture-secret"
  ];
  for (const value of unsafeValues) {
    assert.throws(
      () => assertSafeStructuralIdentifier(value, "Session Key", 300),
      (error) => {
        assert.match(error.message, /包含不允许的敏感内容/);
        assert.doesNotMatch(error.message, new RegExp(escapeRegex(value)));
        return true;
      }
    );
  }
  assert.equal(
    assertSafeStructuralIdentifier(
      "agent:test-role-worker:toolbox-conversation-test-chat",
      "Session Key",
      300
    ),
    "agent:test-role-worker:toolbox-conversation-test-chat"
  );
  assert.equal(
    assertSafeStructuralIdentifier(
      "d6f85df1-32f0-4cc9-b719-e8efb44f4a12",
      "OpenClaw Session ID",
      300
    ),
    "d6f85df1-32f0-4cc9-b719-e8efb44f4a12"
  );
});

test("结构性标识符统一拒绝 POSIX、Windows、UNC、设备和穿越路径", () => {
  for (const value of UNSAFE_STRUCTURAL_PATHS) {
    assert.throws(
      () => assertSafeStructuralIdentifier(value, "结构标识符", 300),
      (error) => {
        assert.match(error.message, /不安全路径/);
        assert.doesNotMatch(error.message, new RegExp(escapeRegex(value)));
        return true;
      }
    );
  }
});

test("结构性标识符兼容正常 OpenClaw ID，并允许非穿越相对分段", () => {
  const safeValues = [
    "session-123",
    "run_abc123",
    "openclaw:session:abc",
    "conversation-001",
    "agent-instance-01",
    "d6f85df1-32f0-4cc9-b719-e8efb44f4a12",
    "safe.name:value_1",
    "folder/session.json"
  ];
  for (const value of safeValues) {
    assert.equal(
      assertSafeStructuralIdentifier(value, "结构标识符", 300),
      value
    );
  }
});

test("可见聊天文本中的通用绝对路径不被结构 ID 规则误伤", () => {
  const message = [
    "请解释 /etc/passwd 是什么。",
    "Windows 路径 C:\\Users 应该如何表示？",
    "我正在处理 /opt/openclaw 目录。"
  ].join("\n");
  assert.equal(sanitizeUserMessage(message, 8000), message);
});

test("明确敏感字段完整清理多词、引号值并支持连续字段", () => {
  const fixtures = [
    ["stdout=first secret output line", ["first", "secret", "output", "line"]],
    ["stderr: internal failure details here", ["internal", "failure", "details", "here"]],
    ['systemPrompt="multi word private prompt"', ["multi", "word", "private", "prompt"]],
    ["debug='multi word diagnostic value'", ["multi", "word", "diagnostic", "value"]]
  ];
  for (const [input, secrets] of fixtures) {
    const output = sanitizeVisibleText(input);
    assert.match(output, /\[REDACTED\]/);
    for (const secret of secrets) {
      assert.doesNotMatch(output, new RegExp(`\\b${secret}\\b`, "i"));
    }
  }

  const consecutive = sanitizeVisibleText(
    "保留开头 stdout=first secret; stderr: second secret 保留结尾"
  );
  assert.equal(
    consecutive,
    "保留开头 stdout=[REDACTED]; stderr: [REDACTED]"
  );
  assert.doesNotMatch(consecutive, /first|second|secret|保留结尾/);
});

test("敏感对象和数组按嵌套边界完整消费，多行结构保持正常前后文", () => {
  const input = [
    "正常开头",
    'result.meta={"stdout":"OBJECT_SECRET","nested":{"items":[1,{"value":"NESTED_SECRET"}]}}',
    "toolOutput=[",
    '  "ARRAY_SECRET",',
    '  {"nested": ["SECOND_ARRAY_SECRET", {"value": "THIRD_ARRAY_SECRET"}]}',
    "]",
    "正常结尾"
  ].join("\n");
  const output = sanitizeVisibleText(input);
  assert.match(output, /^正常开头/m);
  assert.match(output, /result\.meta=\[REDACTED\]/);
  assert.match(output, /toolOutput=\[REDACTED\]/);
  assert.match(output, /正常结尾$/m);
  assert.doesNotMatch(
    output,
    /OBJECT_SECRET|NESTED_SECRET|ARRAY_SECRET|SECOND_ARRAY_SECRET|THIRD_ARRAY_SECRET/
  );
});

test("多行文本块和损坏结构采用保守清理且不泄漏敏感后半段", () => {
  const block = sanitizeVisibleText([
    "前文",
    "stdout: first internal line",
    "  second internal line",
    "  third internal line",
    "后文"
  ].join("\n"));
  assert.equal(block, "前文\nstdout: [REDACTED]\n后文");

  const malformed = sanitizeVisibleText([
    "正常前文",
    "rawResult={",
    '  "stdout": "BROKEN_SECRET",',
    '  "nested": ["BROKEN_TAIL"',
    "明显敏感后半段"
  ].join("\n"));
  assert.equal(malformed, "正常前文\nrawResult=[REDACTED]");
  assert.doesNotMatch(malformed, /BROKEN_SECRET|BROKEN_TAIL|明显敏感后半段/);
});

test("普通自然语言提及字段概念不会被过度清理", () => {
  const normal = [
    "stdout 是什么？",
    "系统提示词应该怎么写？",
    "我的代码返回了一个 result 对象。",
    "我正在讨论 result.meta、toolOutput、debug 和 trace 的含义。"
  ].join("\n");
  assert.equal(sanitizeVisibleText(normal), normal);
});

test("Conversation Presenter 对历史脏文本完整清理多行字段值", () => {
  const output = formatConversationMessages([{
    sequence: 1,
    role: "assistant",
    status: "completed",
    createdAt: "2026-07-23T00:00:00.000Z",
    content: [
      "正常回复",
      "result.meta={",
      '  "stdout": "PRESENTER_OBJECT_SECRET"',
      "}",
      "stderr=PRESENTER_MULTI WORD SECRET",
      "回复结尾"
    ].join("\n"),
    errorSummary: null
  }]);
  assert.match(output, /正常回复/);
  assert.match(output, /回复结尾/);
  assert.doesNotMatch(
    output,
    /PRESENTER_OBJECT_SECRET|PRESENTER_MULTI|WORD SECRET/
  );
});

test("Conversation Presenter 将历史脏结构 ID 显示为安全占位符", () => {
  const output = formatConversationInspect({
    conversationId: "/etc/passwd",
    title: "正常标题",
    instanceId: "\\\\server\\share\\agent",
    projectId: "C:\\Users\\example\\project",
    status: "active",
    messageCount: 0,
    lastMessageAt: null,
    hasOpenClawSession: false,
    canSend: false,
    issues: []
  });
  assert.equal(
    output.match(/\[REDACTED_IDENTIFIER\]/g).length,
    3
  );
  assert.doesNotMatch(output, /etc\/passwd|server|share|C:\\Users/);
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
