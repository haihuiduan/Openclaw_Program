// 安装 workflow 步骤：下载 OpenClaw 官方 install.sh 到系统临时目录。
const fs = require("node:fs/promises");
const http = require("node:http");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");

const OFFICIAL_INSTALL_SCRIPT_URL = "https://openclaw.ai/install.sh";

module.exports = {
  id: "download_script",
  name: "download_script",
  condition: async () => true,
  skipIf: async () => false,
  retry: 0,
  onFail: "stop",
  label: "下载官方安装脚本",
  retryable: true,
  timeout: 15000,
  async run(ctx) {
    ctx.tempState.dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-installer-"));
    ctx.tempState.scriptPath = path.join(ctx.tempState.dir, "openclaw-install.sh");

    const safeUrl = describeUrl(OFFICIAL_INSTALL_SCRIPT_URL);
    ctx.diagnosticLogger.event("download_start", safeUrl);
    const result = await downloadInstallScript(OFFICIAL_INSTALL_SCRIPT_URL, ctx.tempState.scriptPath);

    if (!result.ok) {
      const failure = classifyDownloadError(result.error);
      ctx.diagnosticLogger.error("download_failure", {
        ...safeUrl,
        ...failure
      });
      return {
        success: false,
        message: failure.userMessage,
        finalMessage: "OpenClaw 安装失败：无法下载官方安装脚本。",
        errorCode: failure.errorCode,
        userMessage: failure.userMessage,
        technicalMessage: failure.technicalMessage
      };
    }

    ctx.logger.info("下载官方安装脚本成功：" + ctx.tempState.scriptPath);
    ctx.diagnosticLogger.event("download_success", {
      ...safeUrl,
      httpStatus: result.httpStatus,
      redirectCount: result.redirectCount
    });

    return {
      success: true,
      message: "已下载官方安装脚本",
      data: {
        scriptPath: ctx.tempState.scriptPath,
        installScriptUrl: OFFICIAL_INSTALL_SCRIPT_URL
      }
    };
  }
};

function downloadInstallScript(url, destination) {
  return new Promise((resolve) => {
    downloadToFile(url, destination, 0)
      .then((details) => resolve({ ok: true, ...details }))
      .catch((error) => resolve({ ok: false, error }));
  });
}

function downloadToFile(url, destination, redirectCount) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) {
      reject(new Error("Too many redirects"));
      return;
    }

    const client = url.startsWith("https:") ? https : http;
    const request = client.get(url, { timeout: 15000 }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        const location = response.headers.location;

        if (!location) {
          reject(new Error("Redirect without location"));
          return;
        }

        const nextUrl = new URL(location, url).toString();
        downloadToFile(nextUrl, destination, redirectCount + 1).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(createDownloadError("HTTP status " + response.statusCode, {
          kind: "http",
          httpStatus: response.statusCode,
          redirectCount
        }));
        return;
      }

      const file = require("node:fs").createWriteStream(destination, {
        mode: 0o700
      });

      response.pipe(file);
      file.on("finish", () => {
        file.close(() => resolve({
          httpStatus: response.statusCode,
          redirectCount
        }));
      });
      file.on("error", (error) => {
        reject(createDownloadError("无法写入安装脚本", {
          kind: "write",
          code: error && error.code,
          redirectCount
        }));
      });
    });

    request.on("timeout", () => {
      request.destroy(createDownloadError("下载请求超时", {
        kind: "timeout",
        code: "ETIMEDOUT",
        redirectCount
      }));
    });
    request.on("error", reject);
  });
}

function classifyDownloadError(error) {
  const code = String(error && error.code || "");
  const kind = String(error && error.kind || "");
  let errorCode = "OPENCLAW_DOWNLOAD_UNKNOWN_FAILED";
  let userMessage = "无法下载 OpenClaw 官方安装脚本，请稍后重试。";

  if (kind === "write") {
    errorCode = "OPENCLAW_DOWNLOAD_WRITE_FAILED";
    userMessage = "无法保存 OpenClaw 安装脚本，请检查磁盘空间或权限。";
  } else if (kind === "http") {
    errorCode = "OPENCLAW_DOWNLOAD_HTTP_FAILED";
    userMessage = "OpenClaw 官方安装源返回异常，请稍后重试。";
  } else if (kind === "timeout" || ["ETIMEDOUT", "ESOCKETTIMEDOUT"].includes(code)) {
    errorCode = "OPENCLAW_DOWNLOAD_TIMEOUT";
    userMessage = "下载 OpenClaw 安装脚本超时，请检查网络后重试。";
  } else if (["ENOTFOUND", "EAI_AGAIN"].includes(code)) {
    errorCode = "OPENCLAW_DOWNLOAD_DNS_FAILED";
    userMessage = "无法解析 OpenClaw 官方安装地址，请检查网络或 DNS。";
  } else if (/^(?:ERR_TLS|CERT_|UNABLE_TO_VERIFY|DEPTH_ZERO)/.test(code)) {
    errorCode = "OPENCLAW_DOWNLOAD_TLS_FAILED";
    userMessage = "与 OpenClaw 官方安装源建立安全连接失败。";
  }

  return {
    errorCode,
    userMessage,
    technicalMessage: buildTechnicalMessage(error),
    networkErrorCode: code || null,
    httpStatus: error && error.httpStatus || null,
    redirectCount: error && Number.isInteger(error.redirectCount)
      ? error.redirectCount
      : null
  };
}

function createDownloadError(message, details = {}) {
  const error = new Error(message);
  Object.assign(error, details);
  return error;
}

function buildTechnicalMessage(error) {
  const parts = [];
  if (error && error.code) parts.push("code=" + error.code);
  if (error && error.kind) parts.push("kind=" + error.kind);
  if (error && error.httpStatus) parts.push("httpStatus=" + error.httpStatus);
  return parts.join(", ") || "下载失败，未返回可识别的错误分类。";
}

function describeUrl(value) {
  const url = new URL(value);
  return {
    host: url.host,
    pathname: url.pathname
  };
}

module.exports.classifyDownloadError = classifyDownloadError;
