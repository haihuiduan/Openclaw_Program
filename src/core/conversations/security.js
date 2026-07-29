const { redactSensitiveText } = require("../executions/state");

const PRIVATE_KEY_BLOCK_PATTERN =
  /-----BEGIN ((?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY)-----[\s\S]*?-----END \1-----/gi;
const PRIVATE_KEY_MARKER_PATTERN =
  /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/i;
const HIGH_CONFIDENCE_CREDENTIAL_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{8,}\b/i,
  /\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*\b/i,
  PRIVATE_KEY_MARKER_PATTERN
];
const SENSITIVE_VALUE_FIELDS = [
  "systemPromptReport",
  "finalPromptText",
  "finalAssistantRawText",
  "finalAssistantVisibleText",
  "executionTrace",
  "completion",
  "sessionFile",
  "workspaceDir",
  "workspacePath",
  "agentDir",
  "provider",
  "model",
  "usage",
  "result.meta",
  "openClawJson",
  "openClawRawJson",
  "rawOpenClawJson",
  "stdout",
  "stderr",
  "apiKey",
  "api_key",
  "api-key",
  "token",
  "secret",
  "password"
];
const VISIBLE_SENSITIVE_VALUE_FIELDS = [
  ...SENSITIVE_VALUE_FIELDS,
  "systemPrompt",
  "toolOutput",
  "debug",
  "trace",
  "rawResult",
  "credentials",
  "meta"
];
const INTERNAL_PATH_FIELDS = new Set([
  "sessionfile",
  "workspacedir",
  "workspacepath",
  "agentdir"
]);
const STRUCTURED_SENSITIVE_FIELD_ASSIGNMENT_PATTERN = new RegExp(
  `(["']?)\\b(${VISIBLE_SENSITIVE_VALUE_FIELDS
    .map(escapeRegularExpression)
    .join("|")})\\1(\\s*[:=]\\s*)`,
  "gi"
);
const STRUCTURAL_SENSITIVE_FIELD_PATTERN = new RegExp(
  `\\b(?:${SENSITIVE_VALUE_FIELDS
    .map(escapeRegularExpression)
    .join("|")})\\b\\s*[:=]`,
  "i"
);
const ROOTED_PATH_PATTERN =
  /(?:^|[\s=:;,])(?:[\\/]+)/;
const WINDOWS_DRIVE_ABSOLUTE_PATH_PATTERN =
  /(?:^|[\s=:;,])[A-Za-z]:[\\/]/;
const HOME_RELATIVE_PATH_PATTERN =
  /(?:^|[\s=:;,])~[\\/]/;
const RELATIVE_TRAVERSAL_PATH_PATTERN =
  /(?:^|[\\/])\.\.?(?:[\\/]|$)/;
const STRUCTURAL_CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

function sanitizeUserMessage(value, maximum) {
  const normalized = requireBoundedText(value, "message", maximum);
  rejectHighConfidenceCredentials(normalized, "消息");
  return sanitizeVisibleText(normalized, maximum);
}

function sanitizeConversationTitle(value, maximum) {
  const normalized = requireBoundedText(value, "title", maximum);
  rejectHighConfidenceCredentials(normalized, "Conversation title");
  return sanitizeVisibleText(normalized, maximum);
}

function sanitizeAssistantMessage(value, maximum) {
  return sanitizeVisibleText(
    requireNonEmptyText(value, "Assistant content"),
    maximum
  );
}

function sanitizeErrorSummary(value, maximum) {
  const safe = sanitizePublicErrorMessage(
    String(value || "Conversation 调用失败。"),
    maximum
  );
  return safe || "Conversation 调用失败。";
}

function sanitizePublicErrorMessage(
  value,
  maximum = 2000,
  fallback = "操作失败。"
) {
  const safeBearerLabel = "__OPENCLAW_SAFE_BEARER_LABEL__";
  const source = String(value || "").replace(
    /\bBearer Token\b/g,
    safeBearerLabel
  );
  if (/^\s*[\[{]/.test(source)) return fallback;
  const visible = sanitizeVisibleText(source, maximum)
    .replaceAll(safeBearerLabel, "Bearer Token")
    .replace(/\n\s*at\s+.*(?:\n\s*at\s+.*)*/g, "")
    .replace(
      /(^|[\s("'=：])(?:\\\\[?.]\\|\\\\|\/\/)[^\s"'，。；;）)\]}]*/gm,
      "$1[REDACTED_PATH]"
    )
    .replace(
      /(^|[\s("'=：])[A-Za-z]:[\\/][^\s"'，。；;）)\]}]*/gm,
      "$1[REDACTED_PATH]"
    )
    .replace(
      /(^|[\s("'=：])\/+[^\s"'，。；;）)\]}]*/gm,
      "$1[REDACTED_PATH]"
    )
    .trim();
  if (!visible) return fallback;
  if (visible.length <= maximum) return visible;
  const suffix = "[错误信息已截断]";
  return visible.slice(0, maximum - suffix.length) + suffix;
}

function createSafeError(message, sourceError, options = {}) {
  const safeMessage = options.trustedMessage
    ? String(message || options.fallback || "操作失败。")
    : sanitizePublicErrorMessage(
      message,
      options.maximum || 2000,
      options.fallback || "操作失败。"
    );
  const error = new Error(safeMessage);
  error.stack = `${error.name}: ${error.message}`;
  const code =
    options.code ||
    (sourceError && typeof sourceError.code === "string"
      ? sourceError.code
      : null);
  if (code && /^[A-Z0-9_]+$/.test(code)) {
    error.code = code;
  }
  return error;
}

function createSafeFileError(label, action, sourceError) {
  const code =
    sourceError && typeof sourceError.code === "string"
      ? sourceError.code
      : null;
  const category = safeFileErrorCategory(code);
  return createSafeError(
    `${label}${action}失败${category ? `（${category}）` : ""}。`,
    sourceError
  );
}

function safeFileErrorCategory(code) {
  if (code === "ENOENT") return "文件不存在";
  if (code === "EACCES" || code === "EPERM") return "权限不足";
  if (code === "EEXIST") return "资源已存在";
  if (code === "EBUSY") return "资源正忙";
  if (code === "ENOSPC") return "存储空间不足";
  if (code === "EROFS") return "文件系统只读";
  return "";
}

function sanitizeVisibleText(value, maximum = Number.MAX_SAFE_INTEGER) {
  const privateKeysRedacted = String(value || "").replace(
    PRIVATE_KEY_BLOCK_PATTERN,
    "[REDACTED_PRIVATE_KEY]"
  );
  const structuredValuesRedacted =
    redactStructuredSensitiveValues(privateKeysRedacted);
  const redacted = redactSensitiveText(structuredValuesRedacted)
    .replace(
      /\b(password)(\s*[:=]\s*)([^\s,;]+)/gi,
      "$1$2[REDACTED]"
    )
    .trim();
  if (!redacted) return "";
  if (redacted.length <= maximum) return redacted;
  const suffix = "[内容已截断]";
  return redacted.slice(0, maximum - suffix.length) + suffix;
}

function redactStructuredSensitiveValues(value) {
  const source = String(value || "");
  const pattern = createSensitiveFieldAssignmentPattern();
  let cursor = 0;
  let output = "";
  let match;

  while ((match = pattern.exec(source)) !== null) {
    if (match.index < cursor) continue;
    output += source.slice(cursor, match.index);
    output += match[0];
    const placeholder = INTERNAL_PATH_FIELDS.has(match[2].toLowerCase())
      ? "[REDACTED_INTERNAL_PATH]"
      : "[REDACTED]";
    const consumed = consumeSensitiveFieldValue(
      source,
      pattern.lastIndex
    );
    output += placeholder + consumed.preservedSeparator;
    cursor = consumed.end;
    pattern.lastIndex = cursor;
  }

  return output + source.slice(cursor);
}

function consumeSensitiveFieldValue(source, start) {
  if (start >= source.length) {
    return { end: start, preservedSeparator: "" };
  }
  const first = source[start];
  if (first === '"' || first === "'") {
    return {
      end: consumeQuotedValue(source, start, first),
      preservedSeparator: ""
    };
  }
  if (first === "{" || first === "[") {
    return {
      end: consumeStructuredValue(source, start),
      preservedSeparator: ""
    };
  }
  return consumePlainTextValue(source, start);
}

function consumeQuotedValue(source, start, quote) {
  let escaped = false;
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === quote) {
      return index + 1;
    }
  }
  return source.length;
}

function consumeStructuredValue(source, start) {
  const stack = [source[start]];
  let quote = null;
  let escaped = false;
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{" || character === "[") {
      stack.push(character);
      continue;
    }
    if (character !== "}" && character !== "]") continue;
    const expected = character === "}" ? "{" : "[";
    if (stack.at(-1) !== expected) return source.length;
    stack.pop();
    if (stack.length === 0) return index + 1;
  }
  return source.length;
}

function consumePlainTextValue(source, start) {
  const lineEnd = findLineEnd(source, start);
  const nextAssignment = findNextSensitiveAssignment(
    source,
    start,
    lineEnd
  );
  if (nextAssignment !== null) {
    const between = source.slice(start, nextAssignment);
    const separator = between.match(/[\s,;]+$/);
    return {
      end: nextAssignment,
      preservedSeparator: separator ? separator[0] : ""
    };
  }

  let end = lineEnd;
  let nextLineStart = lineEnd < source.length ? lineEnd + 1 : source.length;
  while (nextLineStart < source.length) {
    const nextLineEnd = findLineEnd(source, nextLineStart);
    const line = source.slice(nextLineStart, nextLineEnd);
    if (
      !line.trim() ||
      lineStartsWithSensitiveAssignment(line) ||
      !/^[ \t]+/.test(line)
    ) {
      break;
    }
    end = nextLineEnd;
    nextLineStart =
      nextLineEnd < source.length ? nextLineEnd + 1 : source.length;
  }
  return { end, preservedSeparator: "" };
}

function findLineEnd(source, start) {
  const newline = source.indexOf("\n", start);
  return newline === -1 ? source.length : newline;
}

function findNextSensitiveAssignment(source, start, end) {
  const pattern = createSensitiveFieldAssignmentPattern();
  pattern.lastIndex = start;
  const match = pattern.exec(source);
  return match && match.index < end ? match.index : null;
}

function lineStartsWithSensitiveAssignment(line) {
  const pattern = createSensitiveFieldAssignmentPattern();
  const match = pattern.exec(line);
  return Boolean(match && line.slice(0, match.index).trim() === "");
}

function createSensitiveFieldAssignmentPattern() {
  return new RegExp(
    STRUCTURED_SENSITIVE_FIELD_ASSIGNMENT_PATTERN.source,
    STRUCTURED_SENSITIVE_FIELD_ASSIGNMENT_PATTERN.flags
  );
}

function assertSafeStructuralIdentifier(value, field, maximum = 300) {
  if (typeof value !== "string") {
    throw createSafeError(field + " 必须是字符串");
  }
  const normalized = value.trim();
  if (!normalized) {
    throw createSafeError(field + " 必须是非空字符串");
  }
  if (isUnsafePathLike(normalized)) {
    throw createSafeError(field + " 包含不允许的敏感内容或不安全路径");
  }
  if (containsSensitiveStructuralContent(normalized)) {
    throw createSafeError(field + " 包含不允许的敏感内容");
  }
  if (STRUCTURAL_CONTROL_CHARACTER_PATTERN.test(value)) {
    throw createSafeError(field + " 不能包含换行或控制字符");
  }
  if (normalized.length > maximum) {
    throw createSafeError(`${field} 不能超过 ${maximum} 个字符`);
  }
  return normalized;
}

function containsSensitiveStructuralContent(value) {
  return (
    PRIVATE_KEY_MARKER_PATTERN.test(value) ||
    HIGH_CONFIDENCE_CREDENTIAL_PATTERNS.some((pattern) =>
      pattern.test(value)
    ) ||
    STRUCTURAL_SENSITIVE_FIELD_PATTERN.test(value) ||
    redactSensitiveText(value) !== value
  );
}

function isUnsafePathLike(value) {
  return (
    ROOTED_PATH_PATTERN.test(value) ||
    WINDOWS_DRIVE_ABSOLUTE_PATH_PATTERN.test(value) ||
    HOME_RELATIVE_PATH_PATTERN.test(value) ||
    RELATIVE_TRAVERSAL_PATH_PATTERN.test(value)
  );
}

function requireBoundedText(value, field, maximum) {
  const normalized = requireNonEmptyText(value, field);
  if (normalized.length > maximum) {
    throw createSafeError(`${field} 不能超过 ${maximum} 个字符。`);
  }
  return normalized;
}

function requireNonEmptyText(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw createSafeError(field + " 必须是非空字符串。");
  }
  return value.trim();
}

function rejectHighConfidenceCredentials(value, label) {
  if (
    HIGH_CONFIDENCE_CREDENTIAL_PATTERNS.some((pattern) =>
      pattern.test(value)
    )
  ) {
    throw createSafeError(
      `${label}疑似包含 API Key、Bearer Token 或私钥，已拒绝发送和保存。`,
      null,
      { trustedMessage: true }
    );
  }
}

function escapeRegularExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  assertSafeStructuralIdentifier,
  createSafeError,
  createSafeFileError,
  sanitizeAssistantMessage,
  sanitizeConversationTitle,
  sanitizeErrorSummary,
  sanitizePublicErrorMessage,
  sanitizeUserMessage,
  sanitizeVisibleText
};
