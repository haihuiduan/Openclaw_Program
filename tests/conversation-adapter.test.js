const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { projectPath } = require("./helpers");
const {
  createOpenClawConversationAdapter
} = require(projectPath("src/core/conversations/openClawConversationAdapter.js"));

const UNSAFE_STRUCTURAL_PATHS = [
  "/etc/passwd",
  "/opt/openclaw/session.json",
  "/Volumes/Data/agent",
  "C:\\Users\\example\\agent",
  "C:/Users/example/agent",
  "\\\\server\\share\\agent",
  "//server/share/agent",
  "\\\\?\\C:\\Users\\example",
  "../secret",
  "./state.json"
];

function fakeChild(payload) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 43210;
  child.kill = () => {};
  process.nextTick(() => {
    child.emit("spawn");
    child.stdout.emit("data", Buffer.from(JSON.stringify(payload)));
    child.emit("close", 0, null);
  });
  return child;
}

function input() {
  return {
    agentId: "test-role-worker",
    message: "只回复安全文本",
    sessionKey: "agent:test-role-worker:toolbox-conversation-test-chat",
    timeoutMs: 5000
  };
}

test("Conversation Adapter 薄封装固定命令并仅映射安全白名单", async () => {
  let captured;
  let spawnMetadata;
  const adapter = createOpenClawConversationAdapter({
    spawnImpl(command, args, options) {
      captured = { command, args, options };
      return fakeChild({
        status: "ok",
        runId: "remote-run",
        result: {
          payloads: [{ text: "安全回复" }],
          meta: {
            agentMeta: {
              sessionId: "remote-session",
              sessionFile: "/private/session.json",
              provider: "secret-provider"
            },
            finalPromptText: "不应返回",
            usage: { inputTokens: 10 }
          }
        }
      });
    }
  });
  const result = await adapter.sendConversationMessage(input(), {
    onSpawn: (metadata) => {
      spawnMetadata = metadata;
    }
  });
  assert.equal(captured.command, "openclaw");
  assert.deepEqual(captured.args, [
    "agent", "--agent", "test-role-worker", "--message", "只回复安全文本",
    "--session-key", "agent:test-role-worker:toolbox-conversation-test-chat",
    "--timeout", "5", "--json"
  ]);
  assert.equal(captured.options.shell, false);
  assert.equal(Object.hasOwn(captured.options, "cwd"), false);
  assert.deepEqual(spawnMetadata, { pid: 43210 });
  assert.deepEqual(result, {
    ok: true,
    interrupted: false,
    timedOut: false,
    code: 0,
    signal: null,
    content: "安全回复",
    openClawSessionId: "remote-session",
    openClawRunId: "remote-run",
    errorType: null,
    errorSummary: null
  });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /sessionFile|provider|usage|finalPromptText|private/);
});

test("Conversation Adapter 将安全诊断注入共享 Execution Adapter", async () => {
  const events = [];
  const adapter = createOpenClawConversationAdapter({
    diagnosticLogger: {
      event(event, details) {
        events.push({ event, details });
      }
    },
    spawnImpl: () => fakeChild({
      status: "ok",
      runId: "current-run",
      payloads: [{ text: "当前格式回复" }],
      meta: {
        agentMeta: {
          sessionId: "current-session"
        }
      }
    })
  });
  const result = await adapter.sendConversationMessage(input());

  assert.equal(result.ok, true);
  assert.equal(result.content, "当前格式回复");
  assert.deepEqual(events.map((entry) => entry.event), [
    "openclaw_agent_command",
    "openclaw_agent_result"
  ]);
  assert.doesNotMatch(
    JSON.stringify(events),
    /只回复安全文本|toolbox-conversation-test-chat|当前格式回复|current-session/
  );
});

test("Conversation Adapter 映射失败、timeout 与 signal 且不暴露原始结果", async () => {
  const queue = [
    {
      ok: false,
      interrupted: false,
      timedOut: false,
      code: 3,
      signal: null,
      errorType: "non-zero",
      errorSummary: "安全错误"
    },
    {
      ok: false,
      interrupted: true,
      timedOut: true,
      code: null,
      signal: "SIGTERM",
      errorType: "timeout",
      errorSummary: "安全超时"
    }
  ];
  const adapter = createOpenClawConversationAdapter({
    executionAdapter: {
      async startAgentExecution() {
        return queue.shift();
      }
    }
  });
  const failed = await adapter.sendConversationMessage(input());
  const interrupted = await adapter.sendConversationMessage(input());
  assert.equal(failed.ok, false);
  assert.equal(failed.interrupted, false);
  assert.equal(failed.errorSummary, "安全错误");
  assert.equal(interrupted.interrupted, true);
  assert.equal(interrupted.timedOut, true);
  assert.equal(interrupted.signal, "SIGTERM");
  assert.deepEqual(
    Object.keys(interrupted).sort(),
    [
      "code", "content", "errorSummary", "errorType", "interrupted", "ok",
      "openClawRunId", "openClawSessionId", "signal", "timedOut"
    ].sort()
  );
});

test("Conversation Adapter runtimeOptions 只允许 onSpawn，不接受 env 或原始输出回调", async () => {
  let calls = 0;
  const adapter = createOpenClawConversationAdapter({
    executionAdapter: {
      async startAgentExecution() {
        calls += 1;
        return { ok: true, outputSummary: "安全回复" };
      }
    }
  });
  await assert.rejects(
    () => adapter.sendConversationMessage(input(), {
      env: { API_KEY: "secret" }
    }),
    /只允许 onSpawn/
  );
  await assert.rejects(
    () => adapter.sendConversationMessage(input(), {
      onStdout() {}
    }),
    /只允许 onSpawn/
  );
  assert.equal(calls, 0);
});

test("Conversation Adapter 对注入执行结果仍执行正文截断、脱敏和标识白名单", async () => {
  const adapter = createOpenClawConversationAdapter({
    executionAdapter: {
      async startAgentExecution() {
        return {
          ok: true,
          code: 0,
          signal: null,
          outputSummary:
            "x".repeat(5000) +
            " token=private-value workspacePath=/private/workspace " +
            "systemPromptReport=adapter-internal-report " +
            "finalPromptText=adapter-private-prompt",
          openClawSessionId: "session-safe",
          openClawRunId: "run-safe",
          provider: "must-not-return",
          usage: { tokens: 10 }
        };
      }
    }
  });
  const result = await adapter.sendConversationMessage(input());
  assert.ok(result.content.length <= 4000);
  assert.match(result.content, /\[内容已截断\]/);
  assert.doesNotMatch(
    result.content,
    /private-value|\/private\/workspace|adapter-internal-report|adapter-private-prompt/
  );
  assert.equal(Object.hasOwn(result, "provider"), false);
  assert.equal(Object.hasOwn(result, "usage"), false);
});

test("Conversation Adapter 完整清理多词、多行和结构化内部字段", async () => {
  const adapter = createOpenClawConversationAdapter({
    executionAdapter: {
      async startAgentExecution() {
        return {
          ok: true,
          code: 0,
          signal: null,
          outputSummary: [
            "正常回复",
            "result.meta={",
            '  "stdout": "ADAPTER_OBJECT_SECRET",',
            '  "nested": ["ADAPTER_ARRAY_SECRET"]',
            "}",
            "stderr=ADAPTER MULTI WORD SECRET",
            "回复结尾"
          ].join("\n"),
          openClawSessionId: "session-safe",
          openClawRunId: "run-safe",
          rawResult: {
            stdout: "RAW_RESULT_SECRET"
          },
          stdout: "RAW_STDOUT_SECRET",
          stderr: "RAW_STDERR_SECRET"
        };
      }
    }
  });

  const result = await adapter.sendConversationMessage(input());
  assert.match(result.content, /正常回复/);
  assert.match(result.content, /回复结尾/);
  assert.doesNotMatch(
    JSON.stringify(result),
    /ADAPTER_OBJECT_SECRET|ADAPTER_ARRAY_SECRET|ADAPTER MULTI WORD SECRET|RAW_RESULT_SECRET|RAW_STDOUT_SECRET|RAW_STDERR_SECRET/
  );
  assert.deepEqual(
    Object.keys(result).sort(),
    [
      "code", "content", "errorSummary", "errorType", "interrupted", "ok",
      "openClawRunId", "openClawSessionId", "signal", "timedOut"
    ].sort()
  );
});

test("Conversation Adapter 拒绝敏感远端标识而不静默改写", async () => {
  for (const [field, value] of [
    ["openClawSessionId", "workspacePath=/private/tmp/test"],
    [
      "openClawRunId",
      "-----BEGIN PRIVATE KEY-----\nPRIVATE_BODY\n-----END PRIVATE KEY-----"
    ]
  ]) {
    const adapter = createOpenClawConversationAdapter({
      executionAdapter: {
        async startAgentExecution() {
          return {
            ok: true,
            outputSummary: "正常回复",
            openClawSessionId: "session-safe",
            openClawRunId: "run-safe",
            [field]: value
          };
        }
      }
    });
    await assert.rejects(
      () => adapter.sendConversationMessage(input()),
      /OpenClaw 标识 包含不允许的敏感内容/
    );
  }
});

test("Conversation Adapter 拒绝路径形式的输入 Agent 与远端 ID 且不回显", async () => {
  let calls = 0;
  const inputAdapter = createOpenClawConversationAdapter({
    executionAdapter: {
      async startAgentExecution() {
        calls += 1;
        return { ok: true, outputSummary: "安全回复" };
      }
    }
  });
  for (const value of UNSAFE_STRUCTURAL_PATHS) {
    await assert.rejects(
      () => inputAdapter.sendConversationMessage({
        ...input(),
        agentId: value
      }),
      (error) => {
        assert.match(error.message, /不安全路径/);
        assert.equal(error.message.includes(value), false);
        return true;
      }
    );
  }
  assert.equal(calls, 0);

  for (const field of ["openClawSessionId", "openClawRunId"]) {
    for (const value of UNSAFE_STRUCTURAL_PATHS) {
      const adapter = createOpenClawConversationAdapter({
        executionAdapter: {
          async startAgentExecution() {
            return {
              ok: true,
              outputSummary: "正常回复",
              openClawSessionId: "session-safe",
              openClawRunId: "run-safe",
              [field]: value
            };
          }
        }
      });
      await assert.rejects(
        () => adapter.sendConversationMessage(input()),
        (error) => {
          assert.match(error.message, /不安全路径/);
          assert.equal(error.message.includes(value), false);
          return true;
        }
      );
    }
  }
});
