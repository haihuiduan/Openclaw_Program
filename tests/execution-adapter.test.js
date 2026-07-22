const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { projectPath } = require("./helpers");
const {
  createOpenClawExecutionAdapter,
  parseAgentExecutionResult
} = require(projectPath("src/core/executions/openClawExecutionAdapter.js"));
const {
  formatExecutionInspect
} = require(projectPath("src/cli/presenters/executionsPresenter.js"));

function fakeChild(plan = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 12345;
  child.killedWith = null;
  child.kill = (signal) => { child.killedWith = signal; };
  process.nextTick(() => {
    if (plan.error) {
      child.emit("error", new Error(plan.error));
      return;
    }
    child.emit("spawn");
    const stdoutChunks = plan.stdoutChunks || (plan.stdout ? [plan.stdout] : []);
    const stderrChunks = plan.stderrChunks || (plan.stderr ? [plan.stderr] : []);
    for (const chunk of stdoutChunks) child.stdout.emit("data", Buffer.from(chunk));
    for (const chunk of stderrChunks) child.stderr.emit("data", Buffer.from(chunk));
    if (!plan.deferClose) child.emit("close", plan.code ?? 0, plan.signal || null);
  });
  return child;
}

function input() {
  return {
    agentId: "test-role-worker",
    prompt: "执行用户任务",
    sessionKey: "agent:test-role-worker:toolbox-run",
    timeoutMs: 1000
  };
}

async function executeJson(payload) {
  const adapter = createOpenClawExecutionAdapter({
    spawnImpl: () => fakeChild({ stdout: JSON.stringify(payload) })
  });
  return adapter.startAgentExecution(input());
}

test("Execution Adapter 固定 openclaw agent 参数、shell:false 并解析安全 JSON", async () => {
  let captured;
  const adapter = createOpenClawExecutionAdapter({
    spawnImpl(command, args, options) {
      captured = { command, args, options };
      return fakeChild({ stdout: JSON.stringify({
        reply: "完成", sessionId: "session-1", taskId: "remote-task", runId: "remote-run"
      }) });
    }
  });
  let spawnMetadata;
  const result = await adapter.startAgentExecution(input(), {
    onSpawn: (metadata) => { spawnMetadata = metadata; }
  });
  assert.equal(captured.command, "openclaw");
  assert.deepEqual(captured.args, [
    "agent", "--agent", "test-role-worker", "--message", "执行用户任务",
    "--session-key", "agent:test-role-worker:toolbox-run", "--timeout", "1", "--json"
  ]);
  assert.equal(captured.options.shell, false);
  assert.equal(Object.hasOwn(captured.options, "cwd"), false);
  assert.deepEqual(spawnMetadata, { pid: 12345 });
  assert.deepEqual(Object.keys(spawnMetadata), ["pid"]);
  assert.equal(Object.hasOwn(spawnMetadata, "stdout"), false);
  assert.equal(Object.hasOwn(spawnMetadata, "stderr"), false);
  assert.equal(Object.hasOwn(spawnMetadata, "args"), false);
  assert.equal(Object.hasOwn(spawnMetadata, "env"), false);
  assert.equal(Object.hasOwn(spawnMetadata, "prompt"), false);
  assert.equal(Object.hasOwn(spawnMetadata, "sessionKey"), false);
  assert.deepEqual(result, {
    ok: true, interrupted: false, timedOut: false, code: 0, signal: null,
    outputSummary: "完成", openClawSessionId: "session-1",
    openClawTaskId: "remote-task", openClawRunId: "remote-run"
  });
  assert.equal(captured.args.includes("delete"), false);
  assert.equal(captured.args.includes("bind"), false);
});

test("Execution Adapter 在 spawn 前拒绝 onStdout 原始输出回调", () => {
  let spawnCalls = 0;
  const adapter = createOpenClawExecutionAdapter({
    spawnImpl() { spawnCalls += 1; return fakeChild(); }
  });
  const sensitiveInput = {
    ...input(),
    prompt: "secret=must-not-appear",
    sessionKey: "agent:test-role-worker:private-session-key"
  };
  assert.throws(
    () => adapter.startAgentExecution(sensitiveInput, { onStdout() {} }),
    (error) => {
      assert.equal(error.message, "当前版本不支持原始 stdout/stderr 回调。");
      assert.doesNotMatch(error.message, /must-not-appear|private-session-key/);
      return true;
    }
  );
  assert.equal(spawnCalls, 0);
});

test("Execution Adapter 在 spawn 前拒绝 onStderr 原始错误回调", () => {
  let spawnCalls = 0;
  const adapter = createOpenClawExecutionAdapter({
    spawnImpl() { spawnCalls += 1; return fakeChild(); }
  });
  assert.throws(
    () => adapter.startAgentExecution(input(), { onStderr() {} }),
    /当前版本不支持原始 stdout\/stderr 回调/
  );
  assert.equal(spawnCalls, 0);
});

test("Execution Adapter 同时收到两个原始输出回调时拒绝创建子进程", () => {
  let spawnCalls = 0;
  const adapter = createOpenClawExecutionAdapter({
    spawnImpl() { spawnCalls += 1; return fakeChild(); }
  });
  assert.throws(
    () => adapter.startAgentExecution(input(), { onStdout() {}, onStderr() {} }),
    /当前版本不支持原始 stdout\/stderr 回调/
  );
  assert.equal(spawnCalls, 0);
});

test("Execution Adapter 兼容真实 OpenClaw JSON 且只返回安全白名单字段", async () => {
  const fixture = {
    runId: "remote-run-id",
    status: "ok",
    summary: "completed",
    output: "不应覆盖真实 payload 正文",
    result: {
      payloads: [
        { text: "OPENCLAW_PHASE6_JSON_TEST_OK", mediaUrl: "/private/media.png" }
      ],
      meta: {
        agentMeta: {
          sessionId: "remote-session-id",
          sessionFile: "/sensitive/path/session.json",
          provider: "provider-name",
          model: "model-name",
          usage: { inputTokens: 123 }
        },
        systemPromptReport: {
          sessionKey: "sensitive-session-key",
          workspaceDir: "/sensitive/workspace",
          apiKey: "sk-fakecredential123456"
        },
        finalPromptText: "token=fake-token secret=fake-secret",
        finalAssistantVisibleText: "内部可见文本不应被读取",
        finalAssistantRawText: "内部原始文本不应被读取",
        executionTrace: { internal: true },
        completion: { internal: true }
      }
    }
  };

  const result = await executeJson(fixture);
  assert.deepEqual(result, {
    ok: true,
    interrupted: false,
    timedOut: false,
    code: 0,
    signal: null,
    outputSummary: "OPENCLAW_PHASE6_JSON_TEST_OK",
    openClawSessionId: "remote-session-id",
    openClawTaskId: null,
    openClawRunId: "remote-run-id"
  });

  const serialized = JSON.stringify(result);
  for (const forbidden of [
    "session.json", "sensitive-session-key", "/sensitive/workspace",
    "sk-fakecredential123456", "fake-token", "fake-secret", "usage",
    "executionTrace", "completion", "finalPromptText", "provider-name", "model-name"
  ]) {
    assert.doesNotMatch(serialized, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const presented = formatExecutionInspect({
    runId: "local-run",
    taskId: "local-task",
    projectId: "local-project",
    assignedInstanceId: "test-role-worker",
    status: "completed",
    attempt: 1,
    trigger: "user",
    taskSyncStatus: "applied",
    outputSummary: result.outputSummary,
    errorSummary: null,
    openClawSessionId: result.openClawSessionId
  });
  assert.match(presented, /OPENCLAW_PHASE6_JSON_TEST_OK/);
  assert.doesNotMatch(presented, /remote-session-id|sessionFile|workspaceDir|systemPromptReport/);
});

test("Execution Adapter 按原顺序拼接多个文本 payload 并统一脱敏截断", () => {
  const parsed = parseAgentExecutionResult(JSON.stringify({
    status: "ok",
    result: {
      payloads: [
        { text: "第一段", mediaUrl: "/sensitive/media.png" },
        { text: "   " },
        { mediaUrl: "secret=media-secret" },
        null,
        "未知类型",
        { text: "token=fake-token 第二段", unknown: "workspacePath=/private/workspace" }
      ]
    }
  }));
  assert.equal(parsed.outputSummary, "第一段\n\ntoken=[REDACTED] 第二段");
  assert.doesNotMatch(parsed.outputSummary, /media|workspace|fake-token|media-secret/);

  const truncated = parseAgentExecutionResult(JSON.stringify({
    status: "ok",
    result: { payloads: [{ text: "a".repeat(3998) }, { text: "尾部" }] }
  }));
  assert.equal(truncated.outputSummary.length, 4000);
  assert.match(truncated.outputSummary, /\[内容已截断\]$/);
});

test("Execution Adapter 仅对白名单旧 Mock 文本和标识保持兼容", () => {
  for (const field of ["output", "response", "reply", "text", "message"]) {
    const parsed = parseAgentExecutionResult(JSON.stringify({
      [field]: `兼容-${field}`,
      sessionId: "legacy-session",
      taskId: "legacy-task",
      runId: "legacy-run"
    }));
    assert.equal(parsed.outputSummary, `兼容-${field}`);
    assert.equal(parsed.openClawSessionId, "legacy-session");
    assert.equal(parsed.openClawTaskId, "legacy-task");
    assert.equal(parsed.openClawRunId, "legacy-run");
  }

  const stringResult = parseAgentExecutionResult(JSON.stringify({ result: "旧版字符串结果" }));
  assert.equal(stringResult.outputSummary, "旧版字符串结果");
  assert.equal(stringResult.openClawSessionId, null);
  assert.equal(stringResult.openClawTaskId, null);
  assert.equal(stringResult.openClawRunId, null);
});

test("Execution Adapter 拒绝空 payload 和未知对象结构且从不序列化 result", async () => {
  const cases = [
    { status: "ok", reply: "不能绕过空 payload", result: { payloads: [] } },
    { status: "ok", result: { payloads: [{ text: "  " }, { mediaUrl: "/secret/media" }] } },
    { status: "ok", result: { payloads: "not-array", meta: { secret: "hidden" } } },
    { status: "ok", result: { arbitrary: "secret=object-secret", nested: { workspaceDir: "/private/path" } } }
  ];
  for (const payload of cases) {
    const result = await executeJson(payload);
    assert.equal(result.ok, false);
    assert.equal(result.errorType, "invalid-json");
    assert.equal(result.errorSummary, "OpenClaw Agent 返回的 JSON 结果无效。");
    assert.doesNotMatch(JSON.stringify(result), /object-secret|hidden|private|payload|workspace|media/);
  }

  const fallback = parseAgentExecutionResult(JSON.stringify({
    status: "ok",
    reply: "安全顶层回退",
    result: { meta: { finalPromptText: "secret=must-not-leak" } }
  }));
  assert.equal(fallback.outputSummary, "安全顶层回退");
  assert.doesNotMatch(JSON.stringify(fallback), /must-not-leak|finalPromptText/);
});

test("Execution Adapter 将明确非成功 status 安全处理为失败", async () => {
  for (const status of ["error", "failed", "unknown-status", ""]) {
    const result = await executeJson({
      status,
      result: {
        payloads: [{ text: "即使有正文也不能成功" }],
        meta: {
          finalPromptText: "apiKey=sk-fakecredential123456",
          agentMeta: { sessionFile: "/private/session.json" }
        }
      }
    });
    assert.equal(result.ok, false);
    assert.equal(result.errorType, "remote-status");
    assert.equal(result.errorSummary, "OpenClaw Agent 返回了非成功状态。");
    assert.doesNotMatch(JSON.stringify(result), /正文|fakecredential|session\.json|private|apiKey/);
  }
});

test("Execution Adapter 只接受非空字符串标识且不从其他字段猜测 Task ID", () => {
  const parsed = parseAgentExecutionResult(JSON.stringify({
    runId: 123,
    taskId: {},
    status: "ok",
    result: {
      payloads: [{ text: "完成" }],
      meta: {
        agentMeta: {
          sessionId: "   ",
          sessionFile: "remote-session-id",
          taskId: "不能猜测"
        },
        sessionKey: "也不能猜测"
      }
    }
  }));
  assert.equal(parsed.openClawSessionId, null);
  assert.equal(parsed.openClawTaskId, null);
  assert.equal(parsed.openClawRunId, null);
});

test("Execution Adapter 对非零退出码和无效 JSON 使用脱敏错误", async () => {
  const secret = "sk-very-sensitive-value";
  const failed = createOpenClawExecutionAdapter({
    spawnImpl: () => fakeChild({ code: 7, stderr: `token=${secret}` })
  });
  const failedResult = await failed.startAgentExecution({ ...input(), prompt: secret });
  assert.equal(failedResult.ok, false);
  assert.match(failedResult.errorSummary, /退出码 7/);
  assert.doesNotMatch(JSON.stringify(failedResult), /sensitive|token/);

  const invalid = createOpenClawExecutionAdapter({ spawnImpl: () => fakeChild({ stdout: "not-json" }) });
  const invalidResult = await invalid.startAgentExecution(input());
  assert.equal(invalidResult.errorType, "invalid-json");
  assert.doesNotMatch(JSON.stringify(invalidResult), /执行用户任务/);

  const empty = createOpenClawExecutionAdapter({ spawnImpl: () => fakeChild({ stdout: "" }) });
  const emptyResult = await empty.startAgentExecution(input());
  assert.equal(emptyResult.errorType, "invalid-json");
  assert.equal(emptyResult.errorSummary, "OpenClaw Agent 返回的 JSON 结果无效。");
});

test("Execution Adapter 不暴露跨 chunk 的 stdout、stderr、路径或凭据", async () => {
  const adapter = createOpenClawExecutionAdapter({
    spawnImpl: () => fakeChild({
      code: 9,
      stdoutChunks: [
        "token=cross-chunk-",
        "secret-value finalPromptText=private-prompt"
      ],
      stderrChunks: [
        "sessionFile=/private/",
        "session.json workspaceDir=/private/workspace secret=cross-",
        "chunk-secret-value"
      ]
    })
  });
  const result = await adapter.startAgentExecution(input());
  const serialized = JSON.stringify(result);
  assert.equal(result.ok, false);
  assert.equal(result.errorType, "non-zero");
  assert.match(result.errorSummary, /退出码 9/);
  assert.equal(Object.hasOwn(result, "stdout"), false);
  assert.equal(Object.hasOwn(result, "stderr"), false);
  assert.doesNotMatch(
    serialized,
    /cross-chunk|secret-value|private-prompt|sessionFile|session\.json|workspaceDir|private\/workspace|token|secret/
  );
});

test("Execution Adapter 支持 timeout 与 signal 中断但不宣称远端取消", async () => {
  let timeoutCallback;
  let timeoutChild;
  const timeoutAdapter = createOpenClawExecutionAdapter({
    setTimeoutImpl(callback) { timeoutCallback = callback; return 1; },
    clearTimeoutImpl() {},
    spawnImpl() {
      timeoutChild = fakeChild({
        deferClose: true,
        stdoutChunks: ["token=timeout-", "secret-value"],
        stderrChunks: ["sessionFile=/private/", "timeout-session.json"]
      });
      process.nextTick(() => {
        timeoutCallback();
        timeoutChild.emit("close", null, "SIGTERM");
      });
      return timeoutChild;
    }
  });
  const timedOut = await timeoutAdapter.startAgentExecution(input());
  assert.equal(timedOut.interrupted, true);
  assert.equal(timedOut.timedOut, true);
  assert.equal(timeoutChild.killedWith, "SIGTERM");
  assert.match(timedOut.errorSummary, /无法确认远端 Turn/);
  assert.doesNotMatch(JSON.stringify(timedOut), /timeout-secret|sessionFile|private|session\.json|token/);

  const signalAdapter = createOpenClawExecutionAdapter({
    spawnImpl: () => fakeChild({
      signal: "SIGINT",
      stdoutChunks: ["finalPromptText=private-", "signal-prompt"],
      stderrChunks: ["secret=signal-", "secret-value"]
    })
  });
  const signalled = await signalAdapter.startAgentExecution(input());
  assert.equal(signalled.interrupted, true);
  assert.match(signalled.errorSummary, /SIGINT/);
  assert.doesNotMatch(JSON.stringify(signalled), /finalPromptText|private-signal|signal-prompt|secret-value/);
});

test("Execution Adapter 限制 stdout 大小且不返回完整原始输出", async () => {
  const adapter = createOpenClawExecutionAdapter({
    maxOutputBytes: 80,
    spawnImpl: () => fakeChild({ stdout: JSON.stringify({ reply: "x".repeat(500) }) })
  });
  const result = await adapter.startAgentExecution(input());
  assert.equal(result.ok, false);
  assert.equal(result.errorType, "invalid-json");
  assert.equal(Object.hasOwn(result, "stdout"), false);
});
