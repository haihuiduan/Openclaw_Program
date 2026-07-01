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

    const result = await downloadInstallScript(OFFICIAL_INSTALL_SCRIPT_URL, ctx.tempState.scriptPath);

    if (!result.ok) {
      return {
        success: false,
        message: "无法下载 OpenClaw 官方安装脚本，请检查网络连接后重试。",
        finalMessage: "OpenClaw 安装失败：无法下载官方安装脚本。"
      };
    }

    ctx.logger.info("下载官方安装脚本成功：" + ctx.tempState.scriptPath);

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
      .then(() => resolve({ ok: true }))
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
        reject(new Error("HTTP status " + response.statusCode));
        return;
      }

      const file = require("node:fs").createWriteStream(destination, {
        mode: 0o700
      });

      response.pipe(file);
      file.on("finish", () => {
        file.close(resolve);
      });
      file.on("error", reject);
    });

    request.on("timeout", () => {
      request.destroy(new Error("Download timed out"));
    });
    request.on("error", reject);
  });
}
