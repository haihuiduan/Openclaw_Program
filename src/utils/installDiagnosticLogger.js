"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const os = require("node:os");
const path = require("node:path");

const MAX_TEXT_LENGTH = 4000;
const diagnosticRuns = new Map();

function createInstallDiagnosticLogger(options = {}) {
  const logPath = options.logPath || null;
  const homeDir = options.homeDir || os.homedir();
  const state = {
    logPath,
    writeFailed: false,
    lastWriteErrorCode: null
  };

  function getRun() {
    return diagnosticRuns.get(logPath || state) || null;
  }

  function beginDiagnosticRun(details = {}) {
    const run = {
      id: crypto.randomUUID(),
      startedAt: new Date().toISOString(),
      salt: crypto.randomBytes(32),
      snapshots: []
    };
    diagnosticRuns.set(logPath || state, run);
    write("gateway_diagnostic_run_start", details);
    return run.id;
  }

  function fingerprintSecret(value) {
    const run = getRun();
    const secret = typeof value === "string" ? value.trim() : "";
    if (!run || !secret) {
      return null;
    }
    return crypto.createHmac("sha256", run.salt).update(secret).digest("hex").slice(0, 12);
  }

  function recordGatewaySnapshot(stage, details = {}) {
    const snapshot = { stage, ...details };
    const run = getRun();
    if (run) {
      run.snapshots.push(snapshot);
    }
    write("gateway_auth_snapshot", snapshot);
    return snapshot;
  }

  function writeGatewaySummary(details = {}) {
    const run = getRun();
    const snapshots = run ? run.snapshots : [];
    const categories = classifyGatewayRootCauses(snapshots, details);
    return write("gateway_diagnostic_summary", {
      ...details,
      snapshotCount: snapshots.length,
      probableRootCause: categories[0],
      rootCauseCategories: categories
    });
  }

  function write(event, details = {}) {
    if (!logPath) {
      return false;
    }

    const entry = sanitizeDiagnosticValue({
      timestamp: new Date().toISOString(),
      event,
      diagnosticRunId: getRun() && getRun().id,
      ...details
    }, { homeDir });

    try {
      fs.mkdirSync(path.dirname(logPath), {
        recursive: true,
        mode: 0o700
      });
      fs.appendFileSync(logPath, JSON.stringify(entry) + "\n", {
        encoding: "utf8",
        mode: 0o600
      });
      return true;
    } catch (error) {
      state.writeFailed = true;
      state.lastWriteErrorCode = error && error.code ? String(error.code) : "UNKNOWN";
      return false;
    }
  }

  return {
    beginDiagnosticRun,
    event: write,
    fingerprintSecret,
    info(event, details) {
      return write(event, {
        level: "info",
        ...(details || {})
      });
    },
    warn(event, details) {
      return write(event, {
        level: "warning",
        ...(details || {})
      });
    },
    error(event, details) {
      return write(event, {
        level: "error",
        ...(details || {})
      });
    },
    getLogPath() {
      return state.logPath;
    },
    getDiagnosticRunId() {
      return getRun() && getRun().id;
    },
    getDiagnosticRunStartedAt() {
      return getRun() && getRun().startedAt;
    },
    recordGatewaySnapshot,
    writeGatewaySummary,
    getStatus() {
      return {
        writeFailed: state.writeFailed,
        lastWriteErrorCode: state.lastWriteErrorCode
      };
    }
  };
}

function classifyGatewayRootCauses(snapshots, details) {
  const categories = [];
  const runningIndex = snapshots.findIndex((item) => item.runtimeRunning === true);
  const before = runningIndex >= 0 ? snapshots[runningIndex] : null;
  const after = runningIndex >= 0
    ? snapshots.slice(runningIndex + 1).find((item) => (
        before.configTokenFingerprint && item.configTokenFingerprint &&
        item.configTokenFingerprint !== before.configTokenFingerprint
      ))
    : null;
  if (after) categories.push("TOKEN_CHANGED_AFTER_GATEWAY_START");
  if (snapshots.some((item) => item.configVsProcessEnvEqual === false)) {
    categories.push("ENV_OVERRIDE_MISMATCH");
  }
  if (snapshots.some((item) => item.configTokenType === "secret_ref" && item.secretRefResolved !== true)) {
    categories.push("SECRET_REF_RESOLUTION_MISMATCH");
  }
  if (snapshots.some((item) => item.configPathMismatch === true)) categories.push("CONFIG_PATH_MISMATCH");
  if (snapshots.some((item) => item.stateDirOrProfileMismatch === true)) categories.push("STATE_DIR_OR_PROFILE_MISMATCH");
  if (snapshots.some((item) => item.cliProbeSourceMismatch === true)) categories.push("CLI_PROBE_SOURCE_MISMATCH");
  if (snapshots.some((item) => item.configVsServiceEqual === false)) categories.push("SERVICE_METADATA_DRIFT");
  if (snapshots.some((item) => item.multipleGatewayProcesses === true)) categories.push("MULTIPLE_GATEWAY_PROCESSES");
  if (details.upstreamBehaviorSuspected === true) categories.push("UPSTREAM_OPENCLAW_BEHAVIOR");
  if (!categories.length) categories.push("INSUFFICIENT_EVIDENCE");
  return categories;
}

function sanitizeDiagnosticValue(value, options = {}, key = "") {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDiagnosticValue(item, options, key));
  }

  if (typeof value === "object") {
    const output = {};

    for (const [entryKey, entryValue] of Object.entries(value)) {
      if (isSafePresenceFlag(entryKey, entryValue)) {
        output[entryKey] = entryValue;
      } else if (isSafeFingerprint(entryKey, entryValue)) {
        output[entryKey] = entryValue;
      } else if (isSafeTokenMetadata(entryKey, entryValue)) {
        output[entryKey] = entryValue;
      } else if (isSensitiveKey(entryKey)) {
        output[entryKey] = "[REDACTED]";
      } else {
        output[entryKey] = sanitizeDiagnosticValue(entryValue, options, entryKey);
      }
    }

    return output;
  }

  if (typeof value !== "string") {
    return value;
  }

  if (isSensitiveKey(key)) {
    return "[REDACTED]";
  }

  return sanitizeDiagnosticText(value, options);
}

function sanitizeDiagnosticText(input, options = {}) {
  let output = String(input);
  const homeDir = String(options.homeDir || os.homedir() || "");

  if (homeDir) {
    output = output.split(homeDir).join("~");
  }

  output = output
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_API_KEY]")
    .replace(
      /(["']?(?:api[_-]?key|access[-_ ]?token|refresh[-_ ]?token|token|password|secret|authorization|set[-_ ]?cookie|cookie)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1[REDACTED]"
    )
    .replace(/((?:OPENAI|DEEPSEEK|ANTHROPIC|OPENROUTER|GEMINI|QWEN)_API_KEY\s*=\s*)[^\s]+/gi, "$1[REDACTED]");

  if (output.length > MAX_TEXT_LENGTH) {
    return output.slice(0, MAX_TEXT_LENGTH) + "…[TRUNCATED]";
  }

  return output;
}

function sanitizeCommandArgs(args, options = {}) {
  const output = [];
  let redactNext = false;

  for (const rawArg of Array.isArray(args) ? args : []) {
    const arg = String(rawArg);

    if (redactNext) {
      output.push("[REDACTED]");
      redactNext = false;
      continue;
    }

    if (/^--(?:[a-z0-9-]+-)?(?:api-key|token|authorization|cookie|password|secret)$/i.test(arg)) {
      output.push(arg);
      redactNext = true;
      continue;
    }

    if (/^--(?:[a-z0-9-]+-)?(?:api-key|token|authorization|cookie|password|secret)=/i.test(arg)) {
      output.push(arg.replace(/=.*/, "=[REDACTED]"));
      continue;
    }

    output.push(sanitizeDiagnosticText(arg, options));
  }

  return output;
}

function isSensitiveKey(key) {
  return /(?:api[_-]?key|token|password|secret|authorization|cookie|privateKey)/i.test(String(key || ""));
}

function isSafePresenceFlag(key, value) {
  return typeof value === "boolean" && /Present$/i.test(String(key || ""));
}

function isSafeFingerprint(key, value) {
  return /Fingerprint$/i.test(String(key || "")) && (
    value === "unknown" || /^[a-f0-9]{12}$/.test(String(value || ""))
  );
}

function isSafeTokenMetadata(key, value) {
  const name = String(key || "");
  if (/(?:Equal|Resolved)$/i.test(name)) return value === true || value === false || value === "unknown";
  if (!/(?:TokenType|TokenSource)$/i.test(name)) return false;
  return [
    "literal",
    "env_reference",
    "secret_ref",
    "missing",
    "unknown",
    "config",
    "disk_config",
    "process_environment",
    "service_environment_fallback",
    "startup_auth_resolver_unobserved",
    "openclaw_internal_resolver_unobserved"
  ].includes(value);
}

module.exports = {
  createInstallDiagnosticLogger,
  sanitizeCommandArgs,
  sanitizeDiagnosticText,
  sanitizeDiagnosticValue
};
