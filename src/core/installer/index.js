// installer 模块：集中管理 OpenClaw 的安装计划与执行流程。
// CLI 或未来 GUI 只需要调用 installOpenClaw，不应该自己拼安装步骤。
const { runDoctor } = require("../doctor");
const { createTargetDirectory } = require("./steps/createTargetDirectory");
const { commandExists, runCommand } = require("../../utils/shell");

/**
 * 生成安装计划。
 * 输入：完整配置对象。
 * 输出：只描述“将要做什么”的计划对象，不修改电脑。
 */
function buildInstallPlan(config) {
  return {
    targetDir: config.targetDir,
    steps: [
      {
        name: "环境检测",
        description: "检查 Node.js、系统命令、网络和目标安装目录是否满足安装前置条件。",
        action: "run_doctor",
        changes: [],
        commands: ["openclaw doctor"],
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
        changes: [`可能创建目录：${config.targetDir}`],
        commands: [`mkdir -p ${config.targetDir}`],
        canRunInDryRun: false,
        status: "planned"
      },
      {
        name: "获取 OpenClaw 安装资源",
        description: "下载或获取 OpenClaw 安装资源。",
        action: "fetch_openclaw_resource",
        changes: ["后续版本会下载或获取 OpenClaw 安装资源。"],
        commands: [],
        canRunInDryRun: false,
        status: "not_implemented"
      },
      {
        name: "安装依赖",
        description: "安装 OpenClaw 运行所需依赖。",
        action: "install_dependencies",
        changes: ["后续版本会安装 OpenClaw 依赖。"],
        commands: [],
        canRunInDryRun: false,
        status: "not_implemented"
      },
      {
        name: "验证 openclaw 命令",
        description: "验证安装完成后 openclaw 命令是否可用。",
        action: "verify_openclaw_command",
        changes: [],
        commands: ["openclaw --version"],
        canRunInDryRun: true,
        status: "not_implemented"
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
  markStep(plan, "check_existing_openclaw", "passed", formatOpenClawStatus(existingOpenClaw));
  markStep(plan, "create_target_directory", "skipped", "dry-run 模式不会创建目录");

  return {
    ok: true,
    message: formatDryRunReport(plan, doctorReport, existingOpenClaw),
    doctorReport,
    existingOpenClaw,
    steps: plan.steps
  };
}

async function runInstall(plan, config) {
  const doctorReport = await runDoctor(config);
  markStep(plan, "run_doctor", doctorReport.ok ? "passed" : "failed", doctorReport.ok
    ? "当前环境满足安装要求"
    : "当前环境未通过检测");

  if (!doctorReport.ok) {
    return {
      ok: false,
      message: formatInstallStoppedReport(plan),
      doctorReport,
      steps: plan.steps
    };
  }

  const existingOpenClaw = await detectExistingOpenClaw();
  markStep(plan, "check_existing_openclaw", "passed", formatOpenClawStatus(existingOpenClaw));

  if (existingOpenClaw.installed) {
    return {
      ok: true,
      message: existingOpenClaw.version
        ? `检测到 OpenClaw 已经安装，当前版本：${existingOpenClaw.version}。本次未重复安装。`
        : "检测到 OpenClaw 已经安装，本次未重复安装。",
      doctorReport,
      existingOpenClaw,
      steps: plan.steps
    };
  }

  const createDirectoryStep = await createTargetDirectory(config);
  markStep(plan, "create_target_directory", "completed", createDirectoryStep.detail);
  markStep(plan, "fetch_openclaw_resource", "not_implemented", "后续版本实现");
  markStep(plan, "install_dependencies", "not_implemented", "后续版本实现");
  markStep(plan, "verify_openclaw_command", "not_implemented", "后续版本实现");

  return {
    ok: true,
    message: formatInstallInitializedReport(plan, config),
    doctorReport,
    existingOpenClaw,
    steps: plan.steps
  };
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
    return "未检测到 OpenClaw，真实安装时会继续安装流程";
  }

  return existingOpenClaw.version
    ? `已安装，当前版本：${existingOpenClaw.version}`
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
    formatCheckLine("OpenClaw 状态", "通过", formatOpenClawStatus(existingOpenClaw)),
    "",
    "安装决策：",
    formatDryRunDecision(doctorReport, existingOpenClaw),
    "",
    "真实安装流程预览:",
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

function formatInstallInitializedReport(plan, config) {
  return [
    "OpenClaw 安装初始化完成。",
    "",
    `已完成：目标安装目录已准备好：${config.targetDir}`,
    "",
    "请注意：当前版本还没有真正下载、安装依赖或完成 openclaw 命令验证。",
    "后续版本会继续实现获取安装资源、安装依赖和验证安装结果。",
    "",
    "步骤状态：",
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

  return "未检测到 OpenClaw，真实安装时会先准备目标目录；下载和依赖安装仍待后续版本实现。";
}

function formatPlanPreview(plan) {
  return plan.steps.map((step, index) => {
    const suffix = step.status === "not_implemented" ? "（后续实现）" : "";
    return `${index + 1}. ${step.name}${suffix}`;
  });
}

function formatExecutedSteps(plan) {
  return plan.steps.map((step, index) => {
    const result = step.result ? ` - ${step.result}` : "";
    return `${index + 1}. [${formatStepStatus(step.status)}] ${step.name}${result}`;
  });
}

function formatCheckLine(name, label, message) {
  return `[${label}] ${name} - ${message}`;
}

function formatStepStatus(status) {
  const labels = {
    planned: "计划中",
    passed: "通过",
    failed: "失败",
    skipped: "跳过",
    completed: "完成",
    not_implemented: "后续实现"
  };

  return labels[status] || status;
}

module.exports = {
  buildInstallPlan,
  executeInstallPlan,
  installOpenClaw
};
