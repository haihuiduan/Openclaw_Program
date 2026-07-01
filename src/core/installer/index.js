// installer 模块：集中管理 OpenClaw 的安装计划与执行流程。
// CLI 或未来 GUI 只需要调用 installOpenClaw，不应该自己拼安装步骤。
const fs = require("node:fs/promises");
const http = require("node:http");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");

const { runDoctor } = require("../doctor");
const { createTargetDirectory } = require("./steps/createTargetDirectory");
const { commandExists, runCommand } = require("../../utils/shell");
const { createInstallLogger } = require("../../utils/installLogger");

const OFFICIAL_INSTALL_SCRIPT_URL = "https://openclaw.ai/install.sh";

/**
 * 生成安装计划。
 * 输入：完整配置对象。
 * 输出：只描述“将要做什么”的计划对象，不修改电脑。
 */
function buildInstallPlan(config) {
  return {
    targetDir: config.targetDir,
    installScriptUrl: OFFICIAL_INSTALL_SCRIPT_URL,
    steps: [
      {
        name: "环境检测",
        description: "检查 Node.js、系统命令、网络和目标安装目录是否满足安装前置条件。",
        action: "run_doctor",
        changes: [],
        commands: ["openclaw-installer doctor"],
        canRunInDryRun: true,
        status: "planned"
      },
      {
        name: "检查 OpenClaw 是否已安装",
        description: "检查系统里是否已经存在 openclaw 命令，并尽量读取当前版本。",
        action: "check_existing_openclaw",
        changes: [],
        commands: ["openclaw --version"],
        canRunInDryRun: true,
        status: "planned"
      },
      {
        name: "准备目标安装目录",
        description: "确保 OpenClaw 的目标安装目录存在。",
        action: "create_target_directory",
        changes: ["可能创建目录：" + config.targetDir],
        commands: ["mkdir -p " + config.targetDir],
        canRunInDryRun: false,
        status: "planned"
      },
      {
        name: "获取 OpenClaw 安装资源",
        description: "从官方地址下载安装脚本：" + OFFICIAL_INSTALL_SCRIPT_URL,
        action: "download_install_script",
        changes: ["会在系统临时目录保存 openclaw-install.sh。"],
        commands: ["下载 " + OFFICIAL_INSTALL_SCRIPT_URL],
        canRunInDryRun: false,
        status: "planned"
      },
      {
        name: "执行官方安装脚本",
        description: "使用 bash 执行已下载到本地的官方安装脚本。",
        action: "run_install_script",
        changes: ["官方安装脚本可能安装或更新 OpenClaw 相关文件。"],
        commands: ["bash openclaw-install.sh"],
        canRunInDryRun: false,
        status: "planned"
      },
      {
        name: "验证 openclaw 命令",
        description: "执行 openclaw --version，确认安装后命令可用。",
        action: "verify_openclaw_command",
        changes: [],
        commands: ["openclaw --version"],
        canRunInDryRun: true,
        status: "planned"
      }
    ]
  };
}

/**
 * 执行安装计划。
 * 输入：安装计划、完整配置和执行选项。
 * 输出：安装或 dry-run 结果，包括中文报告和每一步状态。
 */
async function executeInstallPlan(plan, config, options = {}) {
  const dryRun = Boolean(options.dryRun);

  if (dryRun) {
    return runDryRun(plan, config);
  }

  return runInstall(plan, config);
}

/**
 * 执行 OpenClaw 安装流程。
 * 输入：完整配置对象。
 * 输出：安装结果，包括是否成功、展示文案、doctor 报告和步骤记录。
 */
async function installOpenClaw(config) {
  const plan = buildInstallPlan(config);
  return executeInstallPlan(plan, config, {
    dryRun: config.dryRun
  });
}

async function runDryRun(plan, config) {
  const doctorReport = await runDoctor(config);
  const existingOpenClaw = await detectExistingOpenClaw();

  markStep(plan, "run_doctor", doctorReport.ok ? "passed" : "failed", doctorReport.ok
    ? "当前环境满足安装要求"
    : "当前环境存在失败项，真实安装时会先停止");
  markStep(plan, "check_existing_openclaw", existingOpenClaw.installed ? "passed" : "info", formatOpenClawStatus(existingOpenClaw));
  markStep(plan, "create_target_directory", "skipped", "dry-run 模式不会创建目录");
  markStep(plan, "download_install_script", "skipped", "dry-run 模式不会下载安装脚本");
  markStep(plan, "run_install_script", "skipped", "dry-run 模式不会执行安装脚本");
  markStep(plan, "verify_openclaw_command", "skipped", "dry-run 模式不会执行验证命令");

  return {
    ok: true,
    message: formatDryRunReport(plan, doctorReport, existingOpenClaw),
    doctorReport,
    existingOpenClaw,
    steps: plan.steps
  };
}

async function runInstall(plan, config) {
  const logger = createInstallLogger({
    logDir: config.logDir
  });

  logger.info("安装开始时间：" + new Date().toISOString());
  logger.info("平台信息：platform=" + process.platform + ", arch=" + process.arch + ", node=" + process.versions.node);
  logger.info("targetDir：" + config.targetDir);

  const doctorReport = await runDoctor(config);
  logger.info("doctor 检测结果摘要：" + summarizeDoctorReport(doctorReport));
  markStep(plan, "run_doctor", doctorReport.ok ? "passed" : "failed", doctorReport.ok
    ? "当前环境满足安装要求"
    : "当前环境未通过检测");

  if (!doctorReport.ok) {
    logger.error("安装失败：doctor 未通过");
    return withLogInfo({
      ok: false,
      message: formatInstallStoppedReport(plan),
      doctorReport,
      steps: plan.steps,
      logPath: logger.getLogPath()
    }, logger);
  }

  const existingOpenClaw = await detectExistingOpenClaw();
  logger.info("已有 OpenClaw 检测：" + JSON.stringify(existingOpenClaw));
  markStep(plan, "check_existing_openclaw", existingOpenClaw.installed ? "passed" : "info", formatOpenClawStatus(existingOpenClaw));

  if (existingOpenClaw.installed) {
    logger.info("检测到已安装 OpenClaw，本次不重复安装");
    return withLogInfo({
      ok: true,
      message: existingOpenClaw.version
        ? "检测到 OpenClaw 已经安装，当前版本：" + existingOpenClaw.version + "。本次未重复安装。"
        : "检测到 OpenClaw 已经安装，本次未重复安装。",
      doctorReport,
      existingOpenClaw,
      steps: plan.steps,
      logPath: logger.getLogPath()
    }, logger);
  }

  const tempState = {
    dir: null,
    scriptPath: null
  };

  try {
    const createDirectoryStep = await createTargetDirectory(config);
    logger.info("目标目录准备完成：" + createDirectoryStep.detail);
    markStep(plan, "create_target_directory", "completed", createDirectoryStep.detail);

    tempState.dir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-installer-"));
    tempState.scriptPath = path.join(tempState.dir, "openclaw-install.sh");
    logger.info("临时安装脚本路径：" + tempState.scriptPath);

    const downloadResult = await downloadInstallScript(OFFICIAL_INSTALL_SCRIPT_URL, tempState.scriptPath);
    if (!downloadResult.ok) {
      logger.error("下载官方安装脚本失败：" + summarizeOutput(downloadResult.error && downloadResult.error.message));
      markStep(plan, "download_install_script", "failed", "无法下载 OpenClaw 官方安装脚本");
      return withLogInfo({
        ok: false,
        message: "OpenClaw 安装失败：无法下载官方安装脚本，请检查网络连接后重试。",
        doctorReport,
        existingOpenClaw,
        steps: plan.steps,
        logPath: logger.getLogPath()
      }, logger);
    }

    logger.info("下载官方安装脚本成功：" + tempState.scriptPath);
    markStep(plan, "download_install_script", "completed", "已下载到：" + tempState.scriptPath);

    const scriptResult = await runCommand("bash", [tempState.scriptPath], {
      allowFailure: true
    });
    logger.info("官方安装脚本 stdout：\n" + scriptResult.stdout);
    logger.info("官方安装脚本 stderr：\n" + scriptResult.stderr);

    if (scriptResult.code !== 0) {
      logger.error("官方安装脚本执行失败，退出码：" + scriptResult.code);
      markStep(plan, "run_install_script", "failed", "官方安装脚本执行失败");
      return withLogInfo({
        ok: false,
        message: [
          "OpenClaw 安装失败：官方安装脚本执行失败。",
          "错误摘要：" + summarizeOutput(scriptResult.stderr || scriptResult.stdout)
        ].join("\n"),
        doctorReport,
        existingOpenClaw,
        steps: plan.steps,
        scriptResult,
        logPath: logger.getLogPath()
      }, logger);
    }

    logger.info("官方安装脚本执行成功");
    markStep(plan, "run_install_script", "completed", "官方安装脚本执行完成");

    const verification = await verifyOpenClawCommand();
    logger.info("openclaw --version stdout：\n" + verification.result.stdout);
    logger.info("openclaw --version stderr：\n" + verification.result.stderr);

    if (!verification.ok) {
      logger.error("安装后验证失败");
      markStep(plan, "verify_openclaw_command", "failed", "未能验证 openclaw 命令");
      return withLogInfo({
        ok: false,
        message: [
          "OpenClaw 安装脚本已执行，但未能验证 openclaw 命令。",
          "请重新打开终端，或检查 PATH 后运行 openclaw --version。"
        ].join("\n"),
        doctorReport,
        existingOpenClaw,
        steps: plan.steps,
        verification,
        logPath: logger.getLogPath()
      }, logger);
    }

    logger.info("安装成功，版本：" + verification.version);
    markStep(plan, "verify_openclaw_command", "completed", verification.version);

    return withLogInfo({
      ok: true,
      message: [
        "OpenClaw 安装完成。",
        "当前版本：" + verification.version
      ].join("\n"),
      doctorReport,
      existingOpenClaw,
      steps: plan.steps,
      verification,
      logPath: logger.getLogPath()
    }, logger);
  } finally {
    await cleanupTempDirectory(tempState.dir);
  }
}

/**
 * 检测系统里是否已经存在 openclaw 命令。
 * 输入：无，直接检查当前系统 PATH。
 * 输出：{ installed, version }；version 获取不到时为 null，不影响安装流程。
 */
async function detectExistingOpenClaw() {
  const installed = await commandExists("openclaw");

  if (!installed) {
    return {
      installed: false,
      version: null
    };
  }

  return {
    installed: true,
    version: await readOpenClawVersion()
  };
}

/**
 * 尝试读取已安装 OpenClaw 的版本号。
 * 获取失败时返回 null，不抛错，避免因为版本命令异常打断安装判断。
 */
async function readOpenClawVersion() {
  const result = await runCommand("openclaw", ["--version"], {
    allowFailure: true,
    timeoutMs: 3000
  });
  const version = (result.stdout + result.stderr).trim().split("\n")[0];

  return result.code === 0 && !result.timedOut && version ? version : null;
}

async function verifyOpenClawCommand() {
  const result = await runCommand("openclaw", ["--version"], {
    allowFailure: true,
    timeoutMs: 5000
  });
  const version = (result.stdout + result.stderr).trim().split("\n")[0];

  return {
    ok: result.code === 0 && !result.timedOut && Boolean(version),
    version: version || null,
    result
  };
}

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

async function cleanupTempDirectory(dir) {
  if (!dir) {
    return;
  }

  try {
    await fs.rm(dir, {
      force: true,
      recursive: true
    });
  } catch (error) {
    // 清理临时文件失败不影响安装主流程。
  }
}

function summarizeDoctorReport(report) {
  return report.checks.map((check) => {
    return "[" + check.level + "] " + check.name + " - " + check.message;
  }).join("; ");
}

function summarizeOutput(output) {
  const summary = String(output || "未提供错误详情")
    .trim()
    .split("\n")
    .filter(Boolean)
    .slice(0, 5)
    .join(" ");

  return summary || "未提供错误详情";
}

function withLogInfo(result, logger) {
  if (logger.hasWriteFailed()) {
    return {
      ...result,
      message: result.message + "\n安装日志写入失败，但不影响主安装流程。"
    };
  }

  return {
    ...result,
    message: result.message + "\n详细日志：" + logger.getLogPath()
  };
}

function markStep(plan, action, status, result) {
  const step = plan.steps.find((item) => item.action === action);

  if (!step) {
    return;
  }

  step.status = status;
  step.result = result;
}

function formatOpenClawStatus(existingOpenClaw) {
  if (!existingOpenClaw.installed) {
    return "未检测到 OpenClaw，真实安装时将继续安装";
  }

  return existingOpenClaw.version
    ? "已安装，当前版本：" + existingOpenClaw.version
    : "已安装，但版本读取失败";
}

function formatDryRunReport(plan, doctorReport, existingOpenClaw) {
  const lines = [
    "OpenClaw 模拟安装报告",
    "",
    "当前处于 dry-run 模式，不会修改任何文件。",
    "",
    "检查结果：",
    formatCheckLine("环境检测", doctorReport.ok ? "通过" : "失败", doctorReport.ok
      ? "当前环境满足安装要求"
      : "当前环境存在失败项，真实安装时会先停止"),
    formatCheckLine("OpenClaw 状态", existingOpenClaw.installed ? "通过" : "提示", existingOpenClaw.installed
      ? formatOpenClawStatus(existingOpenClaw) + "，真实安装时不会重复安装"
      : formatOpenClawStatus(existingOpenClaw)),
    "",
    "安装决策：",
    formatDryRunDecision(doctorReport, existingOpenClaw),
    "",
    "真实安装流程预览：",
    ...formatPlanPreview(plan),
    "",
    "结论：",
    "dry-run 已完成，没有修改任何文件。"
  ];

  return lines.join("\n");
}

function formatInstallStoppedReport(plan) {
  return [
    "安装已停止：当前电脑环境未通过检测，请先处理 doctor 报告中的失败项。",
    "",
    "已执行步骤：",
    ...formatExecutedSteps(plan)
  ].join("\n");
}

function formatDryRunDecision(doctorReport, existingOpenClaw) {
  if (!doctorReport.ok) {
    return "当前环境存在失败项，真实安装时会先停止，不会继续修改电脑。";
  }

  if (existingOpenClaw.installed) {
    return "检测到 OpenClaw 已经安装，真实安装时不会重复安装。";
  }

  return "未检测到 OpenClaw，真实安装时将下载官方安装脚本并执行安装。";
}

function formatPlanPreview(plan) {
  return plan.steps.map((step, index) => {
    if (step.action === "download_install_script") {
      return String(index + 1) + ". 下载 OpenClaw 官方安装脚本：" + OFFICIAL_INSTALL_SCRIPT_URL;
    }

    return String(index + 1) + ". " + step.name;
  });
}

function formatExecutedSteps(plan) {
  return plan.steps.map((step, index) => {
    const result = step.result ? " - " + step.result : "";
    return String(index + 1) + ". [" + formatStepStatus(step.status) + "] " + step.name + result;
  });
}

function formatCheckLine(name, label, message) {
  return "[" + label + "] " + name + " - " + message;
}

function formatStepStatus(status) {
  const labels = {
    planned: "计划中",
    passed: "通过",
    failed: "失败",
    skipped: "跳过",
    completed: "完成",
    info: "提示"
  };

  return labels[status] || status;
}

module.exports = {
  buildInstallPlan,
  executeInstallPlan,
  installOpenClaw
};
