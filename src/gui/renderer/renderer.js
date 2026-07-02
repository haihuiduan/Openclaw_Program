// Renderer：通过 preload 暴露的安全 API 调用 doctor/install；其他按钮仍是占位逻辑。
const outputLog = document.querySelector("#outputLog");
const lastAction = document.querySelector("#lastAction");
const environmentStatus = document.querySelector("#environmentStatus");
const openClawStatus = document.querySelector("#openClawStatus");
const configStatus = document.querySelector("#configStatus");
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
let configurePollTimer = null;

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

    if (moduleName === "configure") {
      await handleConfigure();
      return;
    }

    if (moduleName === "verify") {
      await handleVerify();
      return;
    }

    if (moduleName === "logs") {
      await handleOpenLogs();
      return;
    }

    showPlaceholder(action, moduleName);
  });
}

async function runDoctorFromGui() {
  setButtonsDisabled(true);
  updateLastAction("开始检测");
  updateStatusCard(environmentStatus, "检测中", "running");
  showLoading("正在检测环境，请稍候...");

  try {
    const report = await window.openClawInstaller.runDoctor();
    syncDoctorStatusOverview(report);
    renderDoctorReport(report);
    updateLastAction("检测完成");
  } catch (error) {
    updateLastAction("检测失败");
    updateStatusCard(environmentStatus, "有问题", "fail");
    showError("doctor 执行失败。", error);
  } finally {
    setButtonsDisabled(false);
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

async function handleConfigure() {
  const confirmed = window.confirm([
    "将打开系统终端运行 OpenClaw 官方配置向导。",
    "",
    "配置过程由 OpenClaw 官方命令完成，本工具不会保存 API Key。",
    "",
    "你可能会遇到：",
    "1. 安全确认：个人使用一般选择 Yes",
    "2. Setup mode：第一次使用选择 QuickStart",
    "3. Model provider：选择你的 API 来源，例如 OpenRouter / DeepSeek / OpenAI",
    "4. API Key：粘贴你的 Key",
    "5. Default model：不懂就保持默认",
    "6. Channel：第一次体验建议选择 ClickClack",
    "7. Web search / Skills / Hooks：不懂可以先 Skip for now",
    "8. Gateway service：保持默认安装即可",
    "9. 配置完成后回到本软件点击“立即验证”"
  ].join("\n"));

  if (!confirmed) {
    updateLastAction("配置已取消");
    showLoading("已取消配置 API。");
    return;
  }

  setButtonsDisabled(true);
  updateLastAction("配置 API");
  showLoading("正在打开系统终端...");

  try {
    const result = await window.openClawInstaller.runConfigure();
    renderConfigureResult(result);
  } catch (error) {
    showError("configure 执行失败。", error);
  } finally {
    setButtonsDisabled(false);
  }
}

async function handleVerify() {
  setButtonsDisabled(true);
  updateLastAction("验证可用");
  showLoading("正在验证 OpenClaw...");

  try {
    const report = await window.openClawInstaller.runVerify();
    renderVerifyReport(report);
    syncVerifyStatusOverview(report);
    updateLastAction("验证完成");
  } catch (error) {
    updateLastAction("验证失败");
    showError("verify 执行失败。", error);
  } finally {
    setButtonsDisabled(false);
  }
}

async function handleOpenLogs() {
  setButtonsDisabled(true);
  updateLastAction("查看日志");
  showLoading("正在打开安装日志目录...");

  try {
    const result = await window.openClawInstaller.openLogsDirectory();
    renderLogsResult(result);
  } catch (error) {
    updateLastAction("日志打开失败");
    showError("查看日志失败。", error);
  } finally {
    setButtonsDisabled(false);
  }
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

function renderLogsResult(result) {
  outputLog.classList.remove("is-loading");
  outputLog.replaceChildren();

  const success = Boolean(result.success || result.ok);
  const panel = document.createElement("div");
  panel.className = "install-result " + (success ? "pass" : "fail");

  const title = document.createElement("div");
  title.className = "install-result-title";
  title.textContent = success ? "✔ 已打开安装日志目录" : "✖ 暂无安装日志";

  const message = document.createElement("div");
  message.className = "install-result-message";
  message.textContent = result.message || "还没有安装日志。请先执行一键安装。";

  panel.append(title, message);

  if (result.logPath) {
    const summary = document.createElement("div");
    summary.className = "install-result-summary";
    summary.appendChild(createSummaryItem("日志目录", result.logPath));
    panel.appendChild(summary);
  }

  outputLog.appendChild(panel);
  updateLastAction(success ? "日志目录已打开" : "暂无安装日志");
}

function renderVerifyReport(report) {
  outputLog.classList.remove("is-loading");
  outputLog.replaceChildren();

  const checks = Array.isArray(report.checks) ? report.checks : [];
  const hasWarning = checks.some((check) => check.level === "warning");
  const summary = document.createElement("div");
  summary.className = "doctor-summary " + (report.ok ? (hasWarning ? "warning" : "pass") : "fail");
  summary.textContent = getVerifyConclusion(report, checks);
  outputLog.appendChild(summary);

  const details = document.createElement("div");
  details.className = "install-result-summary";

  const versionCheck = findCheck(checks, "OpenClaw 版本");
  const configCheck = findCheck(checks, "配置文件");

  if (versionCheck && versionCheck.ok) {
    details.appendChild(createSummaryItem("版本", versionCheck.message));
  }

  if (configCheck && configCheck.ok && configCheck.level !== "warning") {
    details.appendChild(createSummaryItem("配置文件", configCheck.message.replace("已检测到配置文件路径：", "")));
  }

  if (details.children.length > 0) {
    outputLog.appendChild(details);
  }

  for (const check of checks) {
    outputLog.appendChild(createCheckCard(check));
  }
}

function getVerifyConclusion(report, checks) {
  if (!report.ok) {
    const commandCheck = findCheck(checks, "OpenClaw 命令");

    if (commandCheck && commandCheck.level === "fail") {
      return "未检测到 OpenClaw，请先执行一键安装。";
    }

    return "OpenClaw 基础验证未通过，请先处理失败项。";
  }

  if (checks.some((check) => check.level === "warning")) {
    return "OpenClaw 已安装并可以基本使用，但存在需要留意的提示。";
  }

  return "OpenClaw 已安装并可以基本使用。";
}

function syncVerifyStatusOverview(report) {
  const checks = Array.isArray(report.checks) ? report.checks : [];
  const commandCheck = findCheck(checks, "OpenClaw 命令");
  const versionCheck = findCheck(checks, "OpenClaw 版本");
  const configCheck = findCheck(checks, "配置文件");

  if (commandCheck && commandCheck.level === "fail") {
    updateStatusCard(openClawStatus, "未安装", "fail");
  } else if (versionCheck && versionCheck.ok) {
    updateStatusCard(openClawStatus, "已安装", "pass");
  } else if (!report.ok) {
    updateStatusCard(openClawStatus, "有问题", "fail");
  }

  if (!report.ok) {
    updateStatusCard(configStatus, configCheck && configCheck.level === "warning" ? "待配置" : "配置异常", "warning");
    return;
  }

  if (configCheck && configCheck.ok && configCheck.level !== "warning") {
    updateStatusCard(configStatus, "已配置", "pass");
  } else {
    updateStatusCard(configStatus, "待配置", "warning");
  }
}

function createVerifyNowButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "inline-action-button";
  button.textContent = "我已完成配置，立即验证";
  button.addEventListener("click", async () => {
    stopConfigureDonePolling();
    await handleVerify();
  });

  return button;
}

function startConfigureDonePolling() {
  stopConfigureDonePolling();
  configurePollTimer = setInterval(async () => {
    try {
      const result = await window.openClawInstaller.checkConfigureDone();

      if (result && result.done) {
        stopConfigureDonePolling();
        showConfigureDonePrompt(result.message);
      }
    } catch (error) {
      stopConfigureDonePolling();
    }
  }, 4000);
}

function stopConfigureDonePolling() {
  if (configurePollTimer) {
    clearInterval(configurePollTimer);
    configurePollTimer = null;
  }
}

function showConfigureDonePrompt(message) {
  const prompt = document.createElement("div");
  prompt.className = "configure-done-prompt";

  const text = document.createElement("div");
  text.textContent = message || "检测到配置向导已结束，请点击‘立即验证’确认配置是否可用。";

  prompt.append(text, createVerifyNowButton());
  outputLog.appendChild(prompt);
}

function findCheck(checks, name) {
  return checks.find((check) => String(check.name || "").includes(name));
}

function renderConfigureResult(result) {
  outputLog.classList.remove("is-loading");
  outputLog.replaceChildren();

  const success = Boolean(result.success || result.ok);
  const panel = document.createElement("div");
  panel.className = "install-result " + (success ? "pass" : "fail");

  const title = document.createElement("div");
  title.className = "install-result-title";
  title.textContent = success ? "✔ 配置向导已打开" : "✖ 无法启动配置向导";

  const message = document.createElement("div");
  message.className = "install-result-message";
  message.textContent = success
    ? "配置向导已打开。请在终端完成配置，完成后回到本软件点击‘我已完成配置，立即验证’。"
    : (result.message || "未返回详细信息。");

  panel.append(title, message);

  if (success) {
    panel.appendChild(createVerifyNowButton());
  }

  outputLog.appendChild(panel);

  if (success) {
    updateLastAction("配置向导已打开");
    updateStatusCard(configStatus, "等待验证", "running");
    startConfigureDonePolling();
  } else {
    updateLastAction("配置未完成");
  }
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

function syncDoctorStatusOverview(report) {
  const checks = Array.isArray(report.checks) ? report.checks : [];
  const hasWarning = checks.some((check) => check.level === "warning");

  if (!report.ok) {
    updateStatusCard(environmentStatus, "有问题", "fail");
  } else if (hasWarning) {
    updateStatusCard(environmentStatus, "有警告", "warning");
  } else {
    updateStatusCard(environmentStatus, "通过", "pass");
  }

  updateOpenClawStatus(checks);
  updateConfigStatus(checks);
}

function updateOpenClawStatus(checks) {
  const openClawCheck = checks.find((check) => {
    return String(check.name || "").toLowerCase().includes("openclaw");
  });

  if (!openClawCheck) {
    updateStatusCard(openClawStatus, "未知", "neutral");
    return;
  }

  const message = String(openClawCheck.message || "");

  if (openClawCheck.level !== "fail" && message.includes("已安装")) {
    updateStatusCard(openClawStatus, "已安装", openClawCheck.level === "warning" ? "warning" : "pass");
    return;
  }

  if (openClawCheck.level === "fail" || message.includes("未安装") || message.includes("未检测到")) {
    updateStatusCard(openClawStatus, "未安装", "fail");
    return;
  }

  updateStatusCard(openClawStatus, "未知", "neutral");
}

function updateConfigStatus(checks) {
  const configCheck = checks.find((check) => {
    const name = String(check.name || "").toLowerCase();
    return name.includes("配置文件") || name.includes("config file");
  });

  if (!configCheck) {
    updateStatusCard(configStatus, "未检测", "neutral");
    return;
  }

  updateStatusCard(configStatus, configCheck.level === "fail" ? "待配置" : "已配置", configCheck.level === "fail" ? "warning" : "pass");
}

function updateLastAction(value) {
  if (lastAction) {
    lastAction.textContent = value;
  }
}

function updateStatusCard(element, value, state) {
  if (!element) {
    return;
  }

  element.textContent = value;
  const card = element.closest(".status-item");

  if (!card) {
    return;
  }

  card.classList.remove("status-pass", "status-warning", "status-fail", "status-running", "status-neutral");
  card.classList.add("status-" + state);
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
