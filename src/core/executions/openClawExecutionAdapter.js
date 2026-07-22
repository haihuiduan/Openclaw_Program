const { spawn } = require("node:child_process");
const { getCommandEnv } = require("../../utils/shell/env");
const { assertInstanceId } = require("../agent-instances/id");
const { redactSensitiveText } = require("./state");

const OPENCLAW_EXECUTABLE = "openclaw";
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_OUTPUT_SUMMARY_LENGTH = 4000;
const PAYLOAD_TEXT_SEPARATOR = "\n\n";
const REMOTE_STATUS_ERROR_CODE = "OPENCLAW_REMOTE_STATUS";

function createOpenClawExecutionAdapter(options = {}) {
  const spawnImpl = options.spawnImpl || spawn;
  const maxOutputBytes = options.maxOutputBytes || DEFAULT_MAX_OUTPUT_BYTES;

  return {
    startAgentExecution(input, runtimeOptions = {}) {
      assertSafeRuntimeOptions(runtimeOptions);
      const normalized = normalizeInput(input);
      const args = [
        "agent",
        "--agent", normalized.agentId,
        "--message", normalized.prompt,
        "--session-key", normalized.sessionKey,
        "--timeout", String(Math.ceil(normalized.timeoutMs / 1000)),
        "--json"
      ];
      return executeSpawn(spawnImpl, args, normalized, {
        ...runtimeOptions,
        maxOutputBytes,
        env: getCommandEnv(runtimeOptions.env || process.env),
        setTimeoutImpl: options.setTimeoutImpl || setTimeout,
        clearTimeoutImpl: options.clearTimeoutImpl || clearTimeout
      });
    }
  };
}

function executeSpawn(spawnImpl, args, input, options) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(OPENCLAW_EXECUTABLE, args, {
        env: options.env,
        shell: false,
        stdio: "pipe"
      });
    } catch (error) {
      resolve(failedResult("spawn", "无法启动 OpenClaw Agent 执行。"));
      return;
    }

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let settled = false;
    let spawnObserved = false;
    let spawnReady = Promise.resolve();
    const timeout = options.setTimeoutImpl(() => {
      timedOut = true;
      if (child && typeof child.kill === "function") child.kill("SIGTERM");
    }, input.timeoutMs);

    if (child.stdout) child.stdout.on("data", (chunk) => {
      const collected = appendLimited(stdout, stdoutBytes, chunk, options.maxOutputBytes);
      stdout = collected.value;
      stdoutBytes = collected.bytes;
    });
    if (child.stderr) child.stderr.on("data", (chunk) => {
      const collected = appendLimited(stderr, stderrBytes, chunk, options.maxOutputBytes);
      stderr = collected.value;
      stderrBytes = collected.bytes;
    });

    child.on("spawn", () => {
      spawnObserved = true;
      if (options.onSpawn) {
        spawnReady = Promise.resolve(options.onSpawn({ pid: child.pid || null }));
      }
    });
    child.on("error", () => finish(failedResult("spawn", "无法启动 OpenClaw Agent 执行。")));
    child.on("close", (code, signal) => {
      if (timedOut) {
        finish({
          ok: false,
          interrupted: true,
          timedOut: true,
          code,
          signal,
          errorType: "timeout",
          errorSummary: "OpenClaw Agent 执行超时，本地调用已请求终止；无法确认远端 Turn 是否停止。"
        });
        return;
      }
      if (signal) {
        finish({
          ok: false,
          interrupted: true,
          timedOut: false,
          code,
          signal,
          errorType: "signal",
          errorSummary: `OpenClaw Agent 本地调用被信号 ${signal} 中断；无法确认远端 Turn 是否停止。`
        });
        return;
      }
      if (code !== 0) {
        finish({
          ...failedResult("non-zero", `OpenClaw Agent 执行失败（退出码 ${Number.isInteger(code) ? code : "未知"}）。`),
          code,
          signal: null,
          timedOut: false
        });
        return;
      }
      if (!spawnObserved) {
        finish({
          ok: false,
          interrupted: true,
          timedOut: false,
          code,
          signal: null,
          errorType: "spawn-unconfirmed",
          errorSummary: "Adapter 未确认 OpenClaw 子进程已启动，执行结果按中断处理。"
        });
        return;
      }
      try {
        finish({
          ok: true,
          interrupted: false,
          timedOut: false,
          code: 0,
          signal: null,
          ...parseAgentExecutionResult(stdout)
        });
      } catch (error) {
        if (error && error.code === REMOTE_STATUS_ERROR_CODE) {
          finish({
            ...failedResult("remote-status", "OpenClaw Agent 返回了非成功状态。"),
            code: 0,
            signal: null,
            timedOut: false
          });
          return;
        }
        finish({
          ...failedResult("invalid-json", "OpenClaw Agent 返回的 JSON 结果无效。"),
          code: 0,
          signal: null,
          timedOut: false
        });
      }
    });

    function finish(result) {
      if (settled) return;
      settled = true;
      options.clearTimeoutImpl(timeout);
      Promise.resolve(spawnReady).then(
        () => resolve(result),
        () => resolve(failedResult("spawn-callback", "Execution 启动状态写入失败。"))
      );
    }
  });
}

function parseAgentExecutionResult(stdout) {
  if (typeof stdout !== "string" || !stdout.trim()) throw new Error("OpenClaw Agent 没有返回 JSON。");
  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch (error) {
    throw new Error("OpenClaw Agent 返回的内容不是有效 JSON。");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("OpenClaw Agent JSON 必须是对象。");
  }
  assertSuccessfulStatus(payload);
  const agentMeta = nestedAgentMeta(payload);
  return {
    outputSummary: summarizePayload(payload),
    openClawSessionId: firstIdentifier([
      agentMeta && agentMeta.sessionId,
      payload.sessionId,
      payload.session_id
    ]),
    openClawTaskId: firstIdentifier([payload.taskId, payload.task_id]),
    openClawRunId: firstIdentifier([payload.runId, payload.run_id])
  };
}

function summarizePayload(payload) {
  const result = payload.result;
  if (isObject(result) && Object.hasOwn(result, "payloads")) {
    if (!Array.isArray(result.payloads)) {
      throw new Error("OpenClaw Agent result.payloads 必须是数组。");
    }
    const texts = result.payloads
      .filter(isObject)
      .map((item) => typeof item.text === "string" ? item.text.trim() : "")
      .filter(Boolean);
    if (!texts.length) throw new Error("OpenClaw Agent 没有返回可用的文本结果。");
    return normalizeOutputSummary(texts.join(PAYLOAD_TEXT_SEPARATOR));
  }

  const safeTopLevelCandidates = [
    payload.output,
    payload.response,
    payload.reply,
    payload.text,
    payload.message
  ];
  const compatibleText = safeTopLevelCandidates.find(isNonEmptyString);
  if (compatibleText !== undefined) return normalizeOutputSummary(compatibleText);
  if (isNonEmptyString(result)) return normalizeOutputSummary(result);
  throw new Error("OpenClaw Agent JSON 没有可用的安全文本结果。");
}

function optionalIdentifier(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, 300) : null;
}

function assertSuccessfulStatus(payload) {
  if (!Object.hasOwn(payload, "status")) return;
  if (payload.status === "ok") return;
  const error = new Error("OpenClaw Agent 返回了非成功状态。");
  error.code = REMOTE_STATUS_ERROR_CODE;
  throw error;
}

function nestedAgentMeta(payload) {
  if (!isObject(payload.result) || !isObject(payload.result.meta)) return null;
  return isObject(payload.result.meta.agentMeta) ? payload.result.meta.agentMeta : null;
}

function firstIdentifier(values) {
  for (const value of values) {
    const normalized = optionalIdentifier(value);
    if (normalized !== null) return normalized;
  }
  return null;
}

function normalizeOutputSummary(value) {
  const redacted = redactSensitiveText(value).trim();
  if (!redacted) throw new Error("OpenClaw Agent 没有返回可用的文本结果。");
  if (redacted.length <= MAX_OUTPUT_SUMMARY_LENGTH) return redacted;
  const suffix = "[内容已截断]";
  return redacted.slice(0, MAX_OUTPUT_SUMMARY_LENGTH - suffix.length) + suffix;
}

function isNonEmptyString(value) {
  return typeof value === "string" && Boolean(value.trim());
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertSafeRuntimeOptions(runtimeOptions) {
  if (!runtimeOptions || typeof runtimeOptions !== "object" || Array.isArray(runtimeOptions)) {
    throw new Error("OpenClaw Execution Adapter runtimeOptions 必须是对象。");
  }
  if (Object.hasOwn(runtimeOptions, "onStdout") || Object.hasOwn(runtimeOptions, "onStderr")) {
    throw new Error("当前版本不支持原始 stdout/stderr 回调。");
  }
}

function normalizeInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("OpenClaw Execution Adapter 输入必须是对象。");
  }
  const agentId = assertInstanceId(input.agentId);
  if (typeof input.prompt !== "string" || !input.prompt.trim()) throw new Error("Execution prompt 不能为空。");
  if (typeof input.sessionKey !== "string" || !input.sessionKey.trim()) throw new Error("sessionKey 不能为空。");
  if (!Number.isInteger(input.timeoutMs) || input.timeoutMs < 1000 || input.timeoutMs > 3600000) {
    throw new Error("timeoutMs 必须是 1000 到 3600000 之间的整数。");
  }
  return { agentId, prompt: input.prompt, sessionKey: input.sessionKey, timeoutMs: input.timeoutMs };
}

function appendLimited(current, currentBytes, chunk, maximum) {
  if (currentBytes >= maximum) return { value: current, bytes: currentBytes };
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
  const remaining = maximum - currentBytes;
  const slice = buffer.subarray(0, remaining);
  return { value: current + slice.toString(), bytes: currentBytes + slice.length };
}

function failedResult(errorType, errorSummary) {
  return {
    ok: false,
    interrupted: false,
    timedOut: false,
    code: null,
    signal: null,
    errorType,
    errorSummary
  };
}

module.exports = {
  DEFAULT_MAX_OUTPUT_BYTES,
  OPENCLAW_EXECUTABLE,
  createOpenClawExecutionAdapter,
  parseAgentExecutionResult
};
