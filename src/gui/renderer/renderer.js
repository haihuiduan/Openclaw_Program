// Renderer：通过 preload 暴露的安全 API 调用 doctor/install；其他按钮仍是占位逻辑。
const outputLog = document.querySelector("#outputLog");
const lastAction = document.querySelector("#lastAction");
const appStage = document.querySelector("#appStage");
const buttons = document.querySelectorAll("button[data-action]");

const installStepNames = [
  "environment_check",
  "check_existing_install",
  "prepare_directory",
  "download_script",
  "execute_script",
  "verify_installation"
];

const setupStepNames = [
  "run_doctor",
  "environment_check",
  "check_existing_install",
  "prepare_directory",
  "download_script",
  "execute_script",
  "verify_installation",
  "run_verify"
];

const moduleDescriptions = {
  setup: "正在接入 setup workflow。",
  configure: "后续将接入 configure，并启动 OpenClaw 官方配置向导。",
  verify: "后续将接入 verify。",
  logs: "后续将打开安装日志目录。"
};

const levelMeta = {
  pass: {
    icon: "✔",
    label: "通过"
  },
  warning: {
    icon: "⚠",
    label: "警告"
  },
  fail: {
    icon: "✖",
    label: "失败"
  },
  info: {
    icon: "i",
    label: "提示"
  }
};

const installStatusMeta = {
  pending: {
    icon: "○",
    label: "等待中"
  },
  running: {
    icon: "●",
    label: "执行中"
  },
  success: {
    icon: "✔",
    label: "成功"
  },
  fail: {
    icon: "✖",
    label: "失败"
  },
  skipped: {
    icon: "↷",
    label: "已跳过"
  },
  retry: {
    icon: "↻",
    label: "重试中"
  }
};

let installProgressState = createInitialInstallProgress();
let currentProgressTitle = "正在安装 OpenClaw...";

if (window.openClawInstaller) {
  appStage.textContent = window.openClawInstaller.stage;
}

for (const button of buttons) {
  button.addEventListener("click", async () => {
    const action = button.dataset.action;
    const moduleName = button.dataset.module;

    lastAction.textContent = action;

    if (moduleName === "doctor") {
      await runDoctorFromGui(button);
      return;
    }

    if (moduleName === "install") {
      await handleInstall();
      return;
    }

    if (moduleName === "setup") {
      await handleSetup();
      return;
    }

    showPlaceholder(action, moduleName);
  });
}

async function runDoctorFromGui(button) {
  button.disabled = true;
  showLoading("正在检测...");

  try {
    const report = await window.openClawInstaller.runDoctor();
    renderDoctorReport(report);
  } catch (error) {
    showError("doctor 执行失败。", error);
  } finally {
    button.disabled = false;
  }
}

async function handleInstall() {
  await runWorkflowFromGui({
    title: "正在安装 OpenClaw...",
    errorTitle: "install 执行失败。",
    run: () => window.openClawInstaller.runInstall(),
    subscribe: (callback) => window.openClawInstaller.onInstallProgress(callback),
    stepNames: installStepNames
  });
}

async function handleSetup() {
  await runWorkflowFromGui({
    title: "正在执行 OpenClaw 一键准备流程...",
    errorTitle: "setup 执行失败。",
    run: () => window.openClawInstaller.runSetup(),
    subscribe: (callback) => window.openClawInstaller.onSetupProgress(callback),
    stepNames: setupStepNames
  });
}

async function runWorkflowFromGui(options) {
  const startedAt = Date.now();
  const unsubscribe = options.subscribe((stepUpdate) => {
    updateInstallProgress(stepUpdate);
  });

  currentProgressTitle = options.title;
  installProgressState = createInitialInstallProgress(options.stepNames);
  setButtonsDisabled(true);
  renderInstallProgress(currentProgressTitle);

  try {
    const result = await options.run();
    renderInstallResult(result, Date.now() - startedAt);
  } catch (error) {
    showError(options.errorTitle, error);
  } finally {
    unsubscribe();
    setButtonsDisabled(false);
  }
}

function renderDoctorReport(report) {
  outputLog.classList.remove("is-loading");
  outputLog.replaceChildren();

  const summary = document.createElement("div");
  summary.className = "doctor-summary " + (report.ok ? "pass" : "fail");
  summary.textContent = report.ok
    ? "环境检测完成：当前环境满足基本要求。"
    : "环境检测完成：存在需要处理的失败项。";
  outputLog.appendChild(summary);

  for (const check of report.checks || []) {
    outputLog.appendChild(createCheckCard(check));
  }
}

function renderInstallProgress(titleText) {
  outputLog.classList.remove("is-loading");
  outputLog.replaceChildren();

  const panel = document.createElement("div");
  panel.className = "install-progress-panel";

  const title = document.createElement("div");
  title.className = "install-progress-title";
  title.textContent = titleText;

  const bar = document.createElement("div");
  bar.className = "progress-track";
  const fill = document.createElement("div");
  fill.className = "progress-fill";
  fill.style.width = calculateInstallProgress() + "%";
  bar.appendChild(fill);

  const list = document.createElement("div");
  list.className = "install-progress-list";

  for (const step of installProgressState) {
    list.appendChild(createInstallProgressRow(step));
  }

  panel.append(title, bar, list);
  outputLog.appendChild(panel);
}

function updateInstallProgress(stepUpdate) {
  let found = false;
  installProgressState = installProgressState.map((step) => {
    if (step.name !== stepUpdate.name) {
      return step;
    }

    found = true;
    return {
      ...step,
      status: stepUpdate.status,
      message: stepUpdate.message || step.message,
      duration: stepUpdate.duration
    };
  });

  if (!found) {
    installProgressState.push({
      name: stepUpdate.name,
      status: stepUpdate.status,
      message: stepUpdate.message || "正在执行",
      duration: stepUpdate.duration
    });
  }

  renderInstallProgress(currentProgressTitle);
}

function createInstallProgressRow(step) {
  const meta = installStatusMeta[step.status] || installStatusMeta.pending;
  const row = document.createElement("div");
  row.className = "install-progress-row " + step.status;

  const icon = document.createElement("div");
  icon.className = "install-progress-icon";
  icon.textContent = meta.icon;

  const body = document.createElement("div");
  body.className = "install-progress-body";

  const name = document.createElement("div");
  name.className = "install-progress-name";
  name.textContent = step.name;

  const message = document.createElement("div");
  message.className = "install-progress-message";
  message.textContent = step.duration
    ? step.message + "（" + formatDuration(step.duration) + "）"
    : step.message;

  body.append(name, message);
  row.append(icon, body);

  return row;
}

function renderInstallResult(result, durationMs) {
  outputLog.classList.remove("is-loading");
  outputLog.replaceChildren();

  const success = Boolean(result.success);
  const panel = document.createElement("div");
  panel.className = "install-result " + (success ? "pass" : "fail");

  const title = document.createElement("div");
  title.className = "install-result-title";
  title.textContent = success ? "✔ 安装成功" : "✖ 安装失败";

  const message = document.createElement("div");
  message.className = "install-result-message";
  message.textContent = result.finalMessage || "未返回详细安装信息。";

  const summary = document.createElement("div");
  summary.className = "install-result-summary";
  summary.appendChild(createSummaryItem("状态", success ? "成功" : "失败"));
  summary.appendChild(createSummaryItem("耗时", formatDuration(durationMs)));

  if (result.version) {
    summary.appendChild(createSummaryItem("版本", result.version));
  }

  if (result.error) {
    summary.appendChild(createSummaryItem("错误", result.error));
  }

  if (result.logPath) {
    summary.appendChild(createSummaryItem("安装日志", result.logPath));
  }

  panel.append(title, message, summary);

  if (Array.isArray(result.steps) && result.steps.length > 0) {
    const steps = document.createElement("div");
    steps.className = "install-steps";

    for (const step of result.steps) {
      const row = document.createElement("div");
      row.className = "install-step " + step.status;
      row.textContent = [
        step.name || "未命名步骤",
        step.status ? "状态：" + step.status : "",
        step.message || "",
        step.duration ? formatDuration(step.duration) : ""
      ].filter(Boolean).join(" - ");
      steps.appendChild(row);
    }

    panel.appendChild(steps);
  }

  outputLog.appendChild(panel);
}

function createInitialInstallProgress(stepNames = installStepNames) {
  return stepNames.map((name) => ({
    name,
    status: "pending",
    message: "等待执行"
  }));
}

function calculateInstallProgress() {
  const completed = installProgressState.filter((step) => {
    return step.status === "success" || step.status === "fail" || step.status === "skipped";
  }).length;

  return Math.round((completed / installProgressState.length) * 100);
}

function createSummaryItem(label, value) {
  const item = document.createElement("div");
  item.className = "summary-item";

  const labelNode = document.createElement("span");
  labelNode.textContent = label;

  const valueNode = document.createElement("strong");
  valueNode.textContent = value;

  item.append(labelNode, valueNode);
  return item;
}

function createCheckCard(check) {
  const level = check.level || (check.ok ? "pass" : "info");
  const meta = levelMeta[level] || levelMeta.info;
  const card = document.createElement("div");
  card.className = "check-card " + level;

  const header = document.createElement("div");
  header.className = "check-card-header";

  const name = document.createElement("div");
  name.className = "check-card-name";
  name.textContent = check.name || "未命名检查项";

  const status = document.createElement("div");
  status.className = "check-card-status";
  status.setAttribute("aria-label", meta.label);
  status.textContent = meta.icon;

  const message = document.createElement("div");
  message.className = "check-card-message";
  message.textContent = check.message || "暂无详细说明";

  header.append(name, status);
  card.append(header, message);

  return card;
}

function showPlaceholder(action, moduleName) {
  const now = new Date().toLocaleString("zh-CN");
  const message = "已点击：" + action + "。" + moduleDescriptions[moduleName];

  showLoading([
    "[" + now + "] " + message,
    "",
    "说明：当前按钮仍是占位交互。",
    "本次点击没有执行 shell 命令，没有调用 core，也没有修改任何文件。"
  ].join("\n"));
}

function showLoading(message) {
  outputLog.classList.add("is-loading");
  outputLog.textContent = message;
}

function showError(title, error) {
  outputLog.classList.add("is-loading");
  outputLog.textContent = [
    title,
    "",
    String(error && error.message ? error.message : error)
  ].join("\n");
}

function setButtonsDisabled(disabled) {
  for (const button of buttons) {
    button.disabled = disabled;
  }
}

function formatDuration(durationMs) {
  return (durationMs / 1000).toFixed(1) + "s";
}
