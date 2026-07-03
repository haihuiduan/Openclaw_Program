// Renderer：通过 preload 暴露的安全 API 调用核心能力，并负责把结果渲染成用户可读的界面。
const outputLog = document.querySelector("#outputLog");
const lastAction = document.querySelector("#lastAction");
const environmentStatus = document.querySelector("#environmentStatus");
const openClawStatus = document.querySelector("#openClawStatus");
const configStatus = document.querySelector("#configStatus");
const appStage = document.querySelector("#appStage");
const buttons = document.querySelectorAll("button[data-action]");

const currentStatus = {
  environment: environmentStatus ? environmentStatus.textContent : "未检测",
  openclaw: openClawStatus ? openClawStatus.textContent : "未知",
  config: configStatus ? configStatus.textContent : "待配置",
  lastAction: lastAction ? lastAction.textContent : "尚未操作"
};

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
  setup: "setup 仍保留在底层和 CLI 中，GUI 主流程改为直接打开控制台。",
  dashboard: "将打开 OpenClaw Dashboard 浏览器控制台。",
  configure: "将显示配置引导，并在用户确认后打开 OpenClaw 官方配置向导。",
  verify: "将验证 OpenClaw 命令、版本和配置文件路径。",
  logs: "将打开安装记录文件夹，方便排查安装问题。"
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
      await handleInstall(button);
      return;
    }

    if (moduleName === "setup") {
      await handleSetup(button);
      return;
    }

    if (moduleName === "dashboard") {
      await handleOpenDashboard(button);
      return;
    }

    if (moduleName === "configure") {
      await handleConfigure();
      return;
    }

    if (moduleName === "verify") {
      await handleVerify(button);
      return;
    }

    if (moduleName === "logs") {
      await handleOpenLogs();
      return;
    }

    showPlaceholder(action, moduleName);
  });
}

async function runDoctorFromGui(button) {
  setButtonsDisabled(true);
  setButtonBusy(button, "检测中...");
  updateLastAction("正在检测");
  updateStatusCard(environmentStatus, "检测中", "running");
  renderSimpleProgress({
    title: "正在检测运行环境...",
    description: "正在检查 macOS、CPU 架构、Node.js、npm、Git 和 OpenClaw 安装状态。",
    steps: [
      "检查 macOS 系统",
      "检查 CPU 架构",
      "检查 Node.js",
      "检查 npm",
      "检查 Git",
      "检查 OpenClaw 安装状态"
    ]
  });

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
    restoreButtonText(button);
    setButtonsDisabled(false);
  }
}

async function handleInstall(button) {
  updateLastAction("正在安装");
  markEnvironmentCheckingIfUnknown();
  markOpenClawCheckingIfUnknown();
  await runWorkflowFromGui({
    title: "正在安装 OpenClaw...",
    description: "一键安装会先自动检测环境，通过后继续安装 OpenClaw。请保持网络连接，不要关闭本窗口。",
    errorTitle: "install 执行失败。",
    run: () => window.openClawInstaller.runInstall(),
    subscribe: (callback) => window.openClawInstaller.onInstallProgress(callback),
    stepNames: installStepNames,
    button,
    busyText: "安装中..."
  });
}

async function handleSetup(button) {
  await runWorkflowFromGui({
    title: "正在执行 OpenClaw 一键准备流程...",
    errorTitle: "setup 执行失败。",
    run: () => window.openClawInstaller.runSetup(),
    subscribe: (callback) => window.openClawInstaller.onSetupProgress(callback),
    stepNames: setupStepNames,
    button,
    busyText: "准备中..."
  });
}

async function handleConfigure() {
  updateLastAction("配置引导");
  renderConfigureGuide();
}

async function openOfficialConfigureGuide(button) {
  setButtonsDisabled(true);
  setButtonBusy(button, "正在打开...");
  updateLastAction("正在打开配置向导");
  markConfigWaitingIfNotConfigured();
  updateConfigureGuideStatus(
    isConfigConfirmed()
      ? "正在打开系统终端。如果你重新修改了配置，完成后建议再次验证。"
      : "正在打开系统终端，请稍候..."
  );

  try {
    const result = await window.openClawInstaller.runConfigure();
    renderConfigureResult(result);
  } catch (error) {
    markConfigErrorIfNotConfigured();
    updateConfigureGuideStatus("配置向导打开失败，请确认 OpenClaw 已安装后重试。", "fail");
  } finally {
    restoreButtonText(button);
    setButtonsDisabled(false);
  }
}

async function handleVerify(button) {
  setButtonsDisabled(true);
  setButtonBusy(button, "验证中...");
  updateLastAction("正在验证");
  updateStatusCard(configStatus, "验证中", "running");
  renderSimpleProgress({
    title: "正在验证 OpenClaw 配置...",
    description: "正在检查 OpenClaw 命令、版本和配置文件，请稍候。",
    steps: [
      "检查 OpenClaw 命令",
      "读取 OpenClaw 版本",
      "检查配置文件",
      "汇总验证结果"
    ]
  });

  try {
    const report = await window.openClawInstaller.runVerify();
    renderVerifyReport(report);
    syncVerifyStatusOverview(report);
    updateLastAction("验证完成");
  } catch (error) {
    updateLastAction("验证失败");
    updateStatusCard(configStatus, "配置异常", "fail");
    showError("verify 执行失败。", error);
  } finally {
    restoreButtonText(button);
    setButtonsDisabled(false);
  }
}

async function handleOpenLogs() {
  setButtonsDisabled(true);
  updateLastAction("问题排查");
  showLoading("正在打开安装记录文件夹...");

  try {
    const result = await window.openClawInstaller.openLogsDirectory();
    renderLogsResult(result);
  } catch (error) {
    updateLastAction("日志打开失败");
    showError("问题排查失败。", error);
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
  setButtonBusy(options.button, options.busyText);
  renderInstallProgress(currentProgressTitle, options.description);

  try {
    const result = await options.run();
    renderInstallResult(result, Date.now() - startedAt);
  } catch (error) {
    showError(options.errorTitle, error);
  } finally {
    unsubscribe();
    restoreButtonText(options.button);
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

function renderInstallProgress(titleText, descriptionText) {
  outputLog.classList.remove("is-loading");
  outputLog.replaceChildren();

  const panel = document.createElement("div");
  panel.className = "install-progress-panel";

  const title = document.createElement("div");
  title.className = "install-progress-title";
  title.textContent = titleText;

  panel.appendChild(title);

  if (descriptionText) {
    const description = document.createElement("div");
    description.className = "install-progress-description";
    description.textContent = descriptionText;
    panel.appendChild(description);
  }

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

  panel.append(bar, list);
  outputLog.appendChild(panel);
}

function renderSimpleProgress(options) {
  outputLog.classList.remove("is-loading");
  outputLog.replaceChildren();

  const panel = document.createElement("div");
  panel.className = "simple-progress-panel";

  const title = document.createElement("div");
  title.className = "install-progress-title";
  title.textContent = options.title;

  const description = document.createElement("div");
  description.className = "install-progress-description";
  description.textContent = options.description;

  const track = document.createElement("div");
  track.className = "progress-track indeterminate";
  const fill = document.createElement("div");
  fill.className = "progress-fill";
  track.appendChild(fill);

  const list = document.createElement("div");
  list.className = "simple-progress-list";

  for (const step of options.steps || []) {
    const row = document.createElement("div");
    row.className = "simple-progress-row";
    row.textContent = step;
    list.appendChild(row);
  }

  panel.append(title, description, track, list);
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

  syncInstallStatusOverview(result);

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

function syncInstallStatusOverview(result) {
  const steps = Array.isArray(result.steps) ? result.steps : [];
  const environmentStep = steps.find((step) => step.name === "environment_check");

  if (result.success) {
    updateStatusCard(environmentStatus, "通过", "pass");
    updateStatusCard(openClawStatus, "已安装", "pass");
    return;
  }

  if (environmentStep && environmentStep.status === "fail") {
    updateStatusCard(environmentStatus, "有问题", "fail");
  } else if (environmentStep && environmentStep.status === "success") {
    updateStatusCard(environmentStatus, "通过", "pass");
  }

  if (currentStatus.openclaw !== "已安装") {
    updateStatusCard(openClawStatus, "安装异常", "fail");
  }
}

function renderLogsResult(result) {
  outputLog.classList.remove("is-loading");
  outputLog.replaceChildren();

  const success = Boolean(result.success || result.ok);
  const panel = document.createElement("div");
  panel.className = "install-result " + (success ? "pass" : "fail");

  const title = document.createElement("div");
  title.className = "install-result-title";
  title.textContent = success ? "✔ 已打开安装记录文件夹" : "✖ 暂无安装记录";

  const message = document.createElement("div");
  message.className = "install-result-message";
  message.textContent = success
    ? "已打开安装记录文件夹。如果安装或配置失败，请把最新的 install-xxxx.log 文件发给开发者排查。普通用户不需要自行理解日志内容。"
    : "暂时没有安装记录。请先执行一键安装。";

  panel.append(title, message);

  if (result.logPath) {
    const summary = document.createElement("div");
    summary.className = "install-result-summary";
    summary.appendChild(createSummaryItem("安装记录目录", result.logPath));
    panel.appendChild(summary);
  }

  outputLog.appendChild(panel);
  updateLastAction(success ? "问题排查已打开" : "暂无安装记录");
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

  if (report.ok) {
    const actions = document.createElement("div");
    actions.className = "configure-guide-actions verify-actions";
    actions.appendChild(createDashboardButton());
    outputLog.appendChild(actions);
    appendUsageGuideCard();
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

function createDashboardButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "inline-action-button";
  button.textContent = "打开 OpenClaw 控制台";
  button.addEventListener("click", async () => {
    await handleOpenDashboard(button);
  });

  return button;
}

async function handleOpenDashboard(button) {
  setButtonBusy(button, "正在打开...");
  button.disabled = true;

  try {
    const result = await window.openClawInstaller.openDashboard();
    renderInfoCard(
      result.ok ? "OpenClaw 控制台" : "无法打开控制台",
      result.message || (result.ok ? "已尝试打开 OpenClaw Dashboard。请在浏览器中继续使用。" : "未检测到 OpenClaw，请先执行一键安装。"),
      result.ok ? "pass" : "fail"
    );

    if (result.ok) {
      appendUsageGuideCard();
    }

    updateLastAction(result.ok ? "控制台已打开" : "控制台打开失败");
  } catch (error) {
    renderInfoCard("无法打开控制台", String(error && error.message ? error.message : error), "fail");
    updateLastAction("控制台打开失败");
  } finally {
    restoreButtonText(button);
    button.disabled = false;
  }
}

function createQuickConfigureForm() {
  const form = document.createElement("form");
  form.className = "quick-config-form";

  const title = document.createElement("div");
  title.className = "configure-guide-title";
  title.textContent = "快速配置 OpenRouter";

  const description = document.createElement("p");
  description.className = "configure-guide-intro";
  description.textContent = "适合已经准备好 OpenRouter API Key 的用户。配置过程不打开 Terminal，API Key 只会传给 OpenClaw 官方命令。";

  const provider = createFormField("Provider", "select", "OpenRouter");
  provider.input.disabled = true;
  provider.input.innerHTML = '<option value="openrouter">OpenRouter</option>';

  const apiKey = createFormField("API Key", "password", "");
  apiKey.input.name = "apiKey";
  apiKey.input.placeholder = "粘贴 OpenRouter API Key";
  apiKey.input.autocomplete = "off";

  const model = createFormField("默认模型", "text", "openrouter/auto");
  model.input.name = "model";
  model.input.placeholder = "openrouter/auto";

  const note = document.createElement("p");
  note.className = "quick-config-note";
  note.textContent = "本工具不会展示、保存或写日志记录 API Key。默认模型后续也可以在 OpenClaw 中调整。";

  const actions = document.createElement("div");
  actions.className = "configure-guide-actions";

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.className = "inline-action-button";
  submit.textContent = "开始快速配置";

  actions.appendChild(submit);
  form.append(title, description, provider.field, apiKey.field, model.field, note, actions);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await handleQuickConfigure(form, submit);
  });

  return form;
}

function createFormField(labelText, type, value) {
  const field = document.createElement("label");
  field.className = "quick-config-field";

  const label = document.createElement("span");
  label.textContent = labelText;

  const input = document.createElement(type === "select" ? "select" : "input");

  if (type !== "select") {
    input.type = type;
    input.value = value;
  }

  field.append(label, input);
  return { field, input };
}

async function handleQuickConfigure(form, button) {
  const apiKey = String(form.elements.apiKey.value || "").trim();
  const model = String(form.elements.model.value || "openrouter/auto").trim();

  if (!apiKey) {
    renderInfoCard("需要 API Key", "请先输入 OpenRouter API Key。", "fail");
    return;
  }

  setButtonBusy(button, "配置中...");
  button.disabled = true;
  updateLastAction("正在快速配置");
  updateStatusCard(configStatus, "验证中", "running");
  renderSimpleProgress({
    title: "正在快速配置 OpenClaw...",
    description: "正在调用 OpenClaw 官方非交互配置命令。API Key 不会显示在界面或日志中。",
    steps: [
      "检查 OpenClaw 命令",
      "提交 OpenRouter 配置",
      "安装或重启本地服务",
      "验证配置结果"
    ]
  });

  try {
    const result = await window.openClawInstaller.runQuickConfigure({
      provider: "openrouter",
      apiKey,
      model
    });

    form.elements.apiKey.value = "";

    if (!result.ok) {
      renderInfoCard("快速配置失败", result.message || "OpenClaw 官方配置命令执行失败。", "fail");
      updateLastAction("快速配置失败");
      updateStatusCard(configStatus, "配置异常", "fail");
      return;
    }

    const verifyReport = await window.openClawInstaller.runVerify();
    renderVerifyReport(verifyReport);
    syncVerifyStatusOverview(verifyReport);

    if (verifyReport.ok) {
      appendInfoCard("快速配置完成", "配置完成，可以打开控制台。", "pass");
      updateLastAction("快速配置完成");
    } else {
      appendInfoCard("配置已执行，验证未通过", "请查看验证结果，或使用下方备用配置引导重新配置。", "warning");
      updateLastAction("快速配置需检查");
    }
  } catch (error) {
    form.elements.apiKey.value = "";
    renderInfoCard("快速配置失败", String(error && error.message ? error.message : error), "fail");
    updateLastAction("快速配置失败");
    updateStatusCard(configStatus, "配置异常", "fail");
  } finally {
    restoreButtonText(button);
    button.disabled = false;
  }
}

function createVerifyNowButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "inline-action-button";
  button.textContent = "我已完成配置，立即验证";
  button.addEventListener("click", async () => {
    stopConfigureDonePolling();
    await handleVerify(button);
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
  updateConfigureGuideStatus(
    isConfigConfirmed()
      ? "配置向导已结束。如果你修改了配置，建议点击立即验证。"
      : (message || "检测到配置向导已结束，请点击‘立即验证’确认配置是否可用。"),
    "warning"
  );
}

function findCheck(checks, name) {
  return checks.find((check) => String(check.name || "").includes(name));
}

function createTextBlock(titleText, lines) {
  const section = document.createElement("div");
  section.className = "configure-guide-note-section";

  const title = document.createElement("strong");
  title.textContent = titleText;

  section.appendChild(title);

  for (const line of lines) {
    const paragraph = document.createElement("p");
    paragraph.textContent = line;
    section.appendChild(paragraph);
  }

  return section;
}

function renderConfigureGuide() {
  outputLog.classList.remove("is-loading");
  outputLog.replaceChildren();

  outputLog.appendChild(createQuickConfigureForm());

  const panel = document.createElement("div");
  panel.className = "configure-guide-card";

  const title = document.createElement("div");
  title.className = "configure-guide-title";
  title.textContent = "配置引导";

  const status = document.createElement("div");
  status.className = "configure-guide-status info";
  status.dataset.role = "configure-status";
  status.textContent = "请先阅读下面的步骤，再打开官方配置向导。";

  const intro = document.createElement("p");
  intro.className = "configure-guide-intro";
  intro.textContent = "点击下方按钮后，会打开系统 Terminal 并运行 OpenClaw 官方配置向导。本工具不会保存 API Key。";

  const steps = document.createElement("ol");
  steps.className = "configure-guide-steps";

  for (const text of [
    "安全确认：个人使用一般选择 Yes",
    "Setup mode：第一次使用选择 QuickStart",
    "Config handling：如果之前配置过，选择 Keep current values；第一次配置按默认继续",
    "Model/auth provider：选择 OpenRouter / OpenAI / DeepSeek 等",
    "Auth method：如果使用 OpenRouter，一般选择 OpenRouter API key",
    "API Key：粘贴自己的 Key，本工具不会保存",
    "Default model：不懂可以保持默认，例如 openrouter/auto",
    "Channel：第一次体验建议 ClickClack",
    "Web search：不懂可以 Skip for now",
    "Skills / Missing dependencies：不懂可以 Skip for now",
    "Optional API keys：不知道用途就选择 No",
    "Hooks：不懂可以 Skip for now",
    "Gateway service：保持默认；如果已安装可以选择 Restart",
    "Hatch your agent：普通用户建议选择 Hatch in Browser；如果进入 Terminal TUI，也可以之后使用 Dashboard",
    "完成后回到本软件点击“我已完成配置，立即验证”"
  ]) {
    const item = document.createElement("li");
    item.textContent = text;
    steps.appendChild(item);
  }

  const fallback = document.createElement("div");
  fallback.className = "configure-guide-note";
  fallback.append(
    createTextBlock("不懂时怎么选", [
      "优先选择默认高亮项、Keep current、Skip for now 或 No。",
      "这样可以先完成基础配置，后续再打开 OpenClaw 自己调整。"
    ]),
    createTextBlock("配置完成后", [
      "OpenClaw 可能会自动进入终端聊天界面，这是官方 Terminal TUI，不是必须使用。",
      "普通用户更推荐使用 Dashboard 浏览器控制台。配置验证通过后，可以点击“打开 OpenClaw 控制台”，也可以手动运行 openclaw dashboard。"
    ])
  );

  const actions = document.createElement("div");
  actions.className = "configure-guide-actions";

  const openButton = document.createElement("button");
  openButton.type = "button";
  openButton.className = "inline-action-button";
  openButton.textContent = "打开官方配置向导";
  openButton.addEventListener("click", () => openOfficialConfigureGuide(openButton));

  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.className = "secondary-action-button";
  cancelButton.textContent = "取消";
  cancelButton.addEventListener("click", () => {
    updateLastAction("配置引导已取消");
    renderInfoCard("已取消配置引导", "需要时可以再次点击“配置引导”。");
  });

  const dashboardButton = createDashboardButton();
  dashboardButton.textContent = "打开控制台";

  actions.append(openButton, cancelButton, dashboardButton);
  panel.append(title, status, intro, steps, fallback, actions);
  outputLog.appendChild(panel);
}

function renderConfigureResult(result) {
  const success = Boolean(result.success || result.ok);

  if (success) {
    updateConfigureGuideStatus(
      isConfigConfirmed()
        ? "配置向导已打开。如果你重新修改了配置，完成后建议再次验证。"
        : "配置向导已打开，请对照下方步骤在终端中完成配置。",
      "pass"
    );
    ensureConfigureVerifyButton();
    updateLastAction("配置向导已打开");
    markConfigWaitingIfNotConfigured();
    startConfigureDonePolling();
    return;
  }

  updateConfigureGuideStatus(result.message || "无法启动配置向导，请确认 OpenClaw 已安装后重试。", "fail");
  updateLastAction("配置未完成");
  markConfigErrorIfNotConfigured();
}

function updateConfigureGuideStatus(message, level = "info") {
  outputLog.classList.remove("is-loading");
  const status = outputLog.querySelector('[data-role="configure-status"]');

  if (!status) {
    renderConfigureGuide();
    updateConfigureGuideStatus(message, level);
    return;
  }

  status.className = "configure-guide-status " + level;
  status.textContent = message;
}

function ensureConfigureVerifyButton() {
  const actions = outputLog.querySelector(".configure-guide-actions");

  if (!actions || outputLog.querySelector('[data-role="configure-verify"]')) {
    return;
  }

  const verifyButton = createVerifyNowButton();
  verifyButton.dataset.role = "configure-verify";
  actions.appendChild(verifyButton);
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
    if (isConfigConfirmed()) {
      return;
    }

    const openClawCheck = checks.find((check) => {
      return String(check.name || "").toLowerCase().includes("openclaw");
    });
    const message = String(openClawCheck && openClawCheck.message ? openClawCheck.message : "");

    if (openClawCheck && openClawCheck.level !== "fail" && message.includes("已安装")) {
      updateStatusCard(configStatus, "待验证", "warning");
      return;
    }

    updateStatusCard(configStatus, "待配置", "warning");
    return;
  }

  updateStatusCard(configStatus, configCheck.level === "fail" ? "待配置" : "已配置", configCheck.level === "fail" ? "warning" : "pass");
}

function updateLastAction(value) {
  currentStatus.lastAction = value;

  if (lastAction) {
    lastAction.textContent = value;
  }
}

function markEnvironmentCheckingIfUnknown() {
  if (["未检测", "未知", ""].includes(currentStatus.environment)) {
    updateStatusCard(environmentStatus, "检测中", "running");
  }
}

function markOpenClawCheckingIfUnknown() {
  if (["未知", ""].includes(currentStatus.openclaw)) {
    updateStatusCard(openClawStatus, "检查中", "running");
  }
}

function isConfigConfirmed() {
  return currentStatus.config === "已配置";
}

function markConfigWaitingIfNotConfigured() {
  if (!isConfigConfirmed()) {
    updateStatusCard(configStatus, "等待验证", "running");
  }
}

function markConfigErrorIfNotConfigured() {
  if (!isConfigConfirmed()) {
    updateStatusCard(configStatus, "配置异常", "fail");
  }
}

function updateStatusCard(element, value, state) {
  if (!element) {
    return;
  }

  element.textContent = value;
  updateCurrentStatus(element, value);
  const card = element.closest(".status-item");

  if (!card) {
    return;
  }

  card.classList.remove("status-pass", "status-warning", "status-fail", "status-running", "status-neutral");
  card.classList.add("status-" + state);
}

function updateCurrentStatus(element, value) {
  if (element === environmentStatus) {
    currentStatus.environment = value;
    return;
  }

  if (element === openClawStatus) {
    currentStatus.openclaw = value;
    return;
  }

  if (element === configStatus) {
    currentStatus.config = value;
  }
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

function createInfoCard(titleText, messageText, state = "") {
  const panel = document.createElement("div");
  panel.className = "install-result" + (state ? " " + state : "");

  const title = document.createElement("div");
  title.className = "install-result-title";
  title.textContent = titleText;

  const message = document.createElement("div");
  message.className = "install-result-message";
  message.textContent = messageText;

  panel.append(title, message);
  return panel;
}

function appendInfoCard(titleText, messageText, state = "") {
  outputLog.classList.remove("is-loading");
  outputLog.appendChild(createInfoCard(titleText, messageText, state));
}

function createUsageGuideCard() {
  const card = document.createElement("div");
  card.className = "configure-guide-card usage-guide-card";

  const title = document.createElement("div");
  title.className = "configure-guide-title";
  title.textContent = "OpenClaw 可以做什么？";

  const intro = document.createElement("p");
  intro.className = "configure-guide-intro";
  intro.textContent = "OpenClaw 是一个本地运行的 AI agent。配置模型后，你可以通过 Dashboard 或聊天渠道与它交互。";

  const list = document.createElement("ol");
  list.className = "configure-guide-steps";

  for (const text of [
    "总结文件或资料：例如，帮我总结这个文件的重点。",
    "整理任务和计划：例如，根据这些信息帮我列一个待办清单。",
    "辅助写作：例如，帮我润色这段说明，改得更清楚。",
    "项目和工作辅助：例如，帮我整理项目进度、生成日报、梳理问题。",
    "后续开启工具能力：可以根据需要开启搜索、文件处理、聊天渠道和自动化能力。"
  ]) {
    const item = document.createElement("li");
    item.textContent = text;
    list.appendChild(item);
  }

  const next = document.createElement("p");
  next.className = "configure-guide-intro";
  next.textContent = "建议下一步：点击“打开控制台”，在浏览器中进入 OpenClaw Dashboard。";

  card.append(title, intro, list, next);
  return card;
}

function appendUsageGuideCard() {
  if (outputLog.querySelector(".usage-guide-card")) {
    return;
  }

  outputLog.appendChild(createUsageGuideCard());
}

function renderInfoCard(titleText, messageText, state = "") {
  outputLog.classList.remove("is-loading");
  outputLog.replaceChildren();
  outputLog.appendChild(createInfoCard(titleText, messageText, state));
}

function setButtonBusy(button, text) {
  if (!button || !text) {
    return;
  }

  if (!button.dataset.originalText) {
    button.dataset.originalText = button.textContent;
  }

  button.textContent = text;
}

function restoreButtonText(button) {
  if (!button || !button.dataset.originalText) {
    return;
  }

  button.textContent = button.dataset.originalText;
  delete button.dataset.originalText;
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
