// Renderer：一页式安装向导。只通过 preload 暴露的安全 API 调用主进程能力。
const lastAction = document.querySelector("#lastAction");
const recentStatusButton = document.querySelector("#recentStatusButton");
const recentStatusMenu = document.querySelector("#recentStatusMenu");
const environmentStatus = document.querySelector("#environmentStatus");
const openClawStatus = document.querySelector("#openClawStatus");
const configStatus = document.querySelector("#configStatus");
const versionStatus = document.querySelector("#versionStatus");
const appStage = document.querySelector("#appStage");
const aboutMenu = document.querySelector("#aboutMenu");
const homeButton = document.querySelector("#homeButton");
const wizardProgress = document.querySelector("#wizardProgress");
const wizardCard = document.querySelector("#wizardCard");
const wizardActions = document.querySelector("#wizardActions");
const wizardUtilities = document.querySelector("#wizardUtilities");

const steps = [
  { id: "welcome", label: "欢迎" },
  { id: "prepare", label: "准备 OpenClaw" },
  { id: "configure", label: "配置 API Key" },
  { id: "verify", label: "检查配置" },
  { id: "dashboard", label: "打开控制台" }
];

const wizardState = {
  currentStep: 0,
  environmentStatus: "未检测",
  installStatus: "未安装",
  configStatus: "待配置",
  verifyStatus: "未检查",
  openClawVersion: "",
  versionInfo: null,
  configureMode: "first",
  startupProbeDone: false,
  isProbingStartup: false,
  lastDoctorReport: null,
  lastVerifyReport: null,
  pendingQuickConfigVerification: false,
  pendingQuickConfigDetails: null,
  guiConfigState: null,
  dashboardStatus: "idle",
  dashboardMessage: "",
  isBusy: false,
  recentActions: [],
  updateNoticeDismissed: false
};

if (window.openClawInstaller) {
  appStage.textContent = window.openClawInstaller.stage;
}

if (appStage) {
  appStage.addEventListener("click", toggleAboutMenu);
}

if (homeButton) {
  homeButton.addEventListener("click", handleGoHome);
}

if (recentStatusButton) {
  recentStatusButton.addEventListener("click", toggleRecentStatusMenu);
}

document.addEventListener("click", (event) => {
  if (recentStatusMenu && recentStatusButton && !recentStatusMenu.hidden) {
    if (!recentStatusMenu.contains(event.target) && !recentStatusButton.contains(event.target)) {
      closeRecentStatusMenu();
    }
  }

  if (aboutMenu && appStage && !aboutMenu.hidden) {
    if (!aboutMenu.contains(event.target) && !appStage.contains(event.target)) {
      closeAboutMenu();
    }
  }
});

renderWizard();
probeStartupState();

function renderWizard() {
  renderProgress();
  renderCurrentStep();
  renderUtilities();
  updateHomeButtonState();
}

function renderProgress() {
  wizardProgress.replaceChildren();

  if (isToolboxHome()) {
    wizardProgress.hidden = true;
    return;
  }

  wizardProgress.hidden = false;

  for (const [index, step] of steps.entries()) {
    const item = document.createElement("div");
    item.className = "wizard-step";

    if (index < wizardState.currentStep) {
      item.classList.add("completed");
    }

    if (index === wizardState.currentStep) {
      item.classList.add("active");
    }

    const dot = document.createElement("span");
    dot.className = "wizard-step-dot";
    dot.textContent = index < wizardState.currentStep ? "✓" : String(index + 1);

    const label = document.createElement("span");
    label.textContent = step.label;

    item.append(dot, label);
    wizardProgress.appendChild(item);
  }
}

function renderCurrentStep() {
  wizardCard.replaceChildren();
  wizardActions.replaceChildren();

  const stepId = steps[wizardState.currentStep].id;

  if (stepId === "welcome") {
    renderWelcomeStep();
    return;
  }

  if (stepId === "prepare") {
    renderPrepareStep();
    return;
  }

  if (stepId === "configure") {
    renderConfigureStep();
    return;
  }

  if (stepId === "verify") {
    renderVerifyStep();
    return;
  }

  renderDashboardStep();
}

function renderWelcomeStep() {
  if (wizardState.isProbingStartup) {
    renderProgressCard("正在识别当前状态...", "正在检查 OpenClaw 是否已安装、配置是否可用。", [
      "检查 OpenClaw 命令",
      "读取 OpenClaw 版本",
      "检查配置文件"
    ]);
    return;
  }

  if (isReadyToUse()) {
    const card = createCard("OpenClaw 已准备好", "你可以直接打开控制台开始使用，或更换 API Key。");
    card.appendChild(createNotice("OpenClaw 已安装，API Key 配置已确认。", "pass"));
    appendUpdateNotice(card);
    appendDashboardNotice(card);
    appendVersionInfo(card);
    wizardCard.appendChild(card);
    addConsoleActions();
    addAction("更换 API Key", () => goToConfigure("reconfigure"), "secondary");
    addUpdateActionIfNeeded();
    return;
  }

  if (wizardState.installStatus === "已安装" && wizardState.configStatus === "待确认") {
    const card = createCard("需要确认配置", "检测到这台电脑上可能已有 OpenClaw 配置，但本工具还不能确认 API Key 是否可用。你可以检查现有配置，或重新配置 API Key。");
    appendUpdateNotice(card);
    appendVersionInfo(card);
    wizardCard.appendChild(card);
    addAction("检查现有配置", () => runVerifyStep({ confirmConfig: false }), "primary");
    addAction("重新配置 API Key", () => goToConfigure("reconfigure"), "secondary");
    addAction("官方配置向导", openAdvancedConfigure, "secondary");
    addUpdateActionIfNeeded();
    return;
  }

  if (wizardState.installStatus === "已安装") {
    const card = createCard("还差一步：配置 API Key", "已检测到 OpenClaw 已安装。请配置 AI 服务商 API Key 后开始使用。");
    card.appendChild(createNotice("如果你以前配置过，也可以检查现有配置。", "info"));
    appendUpdateNotice(card);
    appendVersionInfo(card);
    wizardCard.appendChild(card);
    addAction("配置 API Key", () => goToConfigure("first"), "primary");
    addAction("我已有配置，检查一下", () => runVerifyStep({ confirmConfig: false }), "secondary");
    addAction("官方配置向导", openAdvancedConfigure, "secondary");
    addUpdateActionIfNeeded();
    return;
  }

  const card = createCard("欢迎使用 OpenClaw 工具箱", "本工具会帮你在这台 Mac 上准备 OpenClaw，并完成基础 API Key 配置。");
  card.appendChild(createList([
    "准备 OpenClaw",
    "配置 AI 服务商 API Key",
    "检查配置是否可用",
    "打开控制台开始使用"
  ]));
  wizardCard.appendChild(card);

  addAction("开始", () => goToStep(1), "primary");
}

function renderPrepareStep() {
  const card = createCard("准备 OpenClaw", "本步骤会检查这台 Mac 是否满足运行条件，并安装或确认 OpenClaw。");
  card.appendChild(createParagraph("本工具会自动安装 OpenClaw 本体，但不会在未经确认的情况下修改你的系统环境。如果缺少基础环境，请先按提示处理。"));

  if (wizardState.openClawVersion) {
    card.appendChild(createNotice("检测到 OpenClaw 已安装，版本：" + wizardState.openClawVersion + "。", "pass"));
  } else if (wizardState.installStatus === "已安装") {
    card.appendChild(createNotice("检测到 OpenClaw 已安装。", "pass"));
  } else if (wizardState.installStatus === "安装异常") {
    card.appendChild(createNotice("准备未完成，请查看错误信息或打开问题排查。", "fail"));
  } else {
    card.appendChild(createNotice("首次安装通常需要 2-10 分钟，取决于网络速度。请保持网络连接，不要关闭本窗口。", "info"));
  }

  wizardCard.appendChild(card);
  addBackAction();

  if (wizardState.installStatus === "已安装") {
    addAction("下一步：配置 API Key", () => goToConfigure("first"), "primary");
  } else {
    addAction("开始准备", runInstallStep, "primary");
  }
}

function renderConfigureStep() {
  const isReconfigure = wizardState.configureMode === "reconfigure";
  const card = createCard(
    isReconfigure ? "重新配置 API Key" : "配置 AI 服务商",
    isReconfigure
      ? "你可以选择新的 AI 服务商并输入新的 API Key。配置完成后，本软件会重新检查 OpenClaw。"
      : "选择你的 AI 服务商并粘贴 API Key。本工具不会保存、展示或记录你的 API Key。"
  );
  card.appendChild(createQuickConfigureForm());
  wizardCard.appendChild(card);

  addBackAction();

  if (wizardState.configStatus === "已配置") {
    addAction("下一步：检查配置", () => goToStep(3), "primary");
  }
}

function renderVerifyStep() {
  const card = createCard("检查 OpenClaw 配置", "本工具会检查 OpenClaw 是否可以正常读取配置，并确认基础状态。");

  if (wizardState.verifyStatus === "通过") {
    card.appendChild(createNotice("配置已确认，可以打开控制台。", "pass"));
  } else if (wizardState.verifyStatus === "失败") {
    card.appendChild(createNotice("配置可能未完成，请检查 API Key 或重新配置。", "fail"));
  } else {
    card.appendChild(createNotice("完成配置后，请检查 OpenClaw 是否可以基本使用。", "info"));
  }

  wizardCard.appendChild(card);
  addBackAction();
  addAction("开始检查", runVerifyStep, "primary");

  if (wizardState.verifyStatus === "通过") {
    addAction("下一步：打开控制台", () => goToStep(4), "primary");
  }

  if (wizardState.verifyStatus === "失败") {
    addAction("返回配置", () => goToConfigure("first"), "secondary");
    addAction("问题排查", openLogs, "secondary");
  }
}

function renderDashboardStep() {
  const card = createCard("打开 OpenClaw 控制台", "控制台会在浏览器中打开，你可以在那里开始使用 OpenClaw。");
  appendDashboardNotice(card);
  card.appendChild(createUsageCard());
  wizardCard.appendChild(card);

  addBackAction();
  addConsoleActions();

  if (wizardState.dashboardStatus === "failed") {
    addAction("问题排查", openLogs, "secondary");
  }
}

async function runDoctorStep() {
  setBusy(true);
  updateLastAction("正在检测");
  updateStatusCard(environmentStatus, "检测中", "running");
  renderProgressCard("正在检查运行环境...", "正在检查这台 Mac 的基础环境和 OpenClaw 安装状态。", [
    "检查基础环境",
    "检查 OpenClaw 安装状态",
    "汇总检查结果"
  ]);

  try {
    const report = await window.openClawInstaller.runDoctor();
    wizardState.lastDoctorReport = report;
    syncDoctorStatus(report);

    if (report.ok) {
      wizardState.environmentStatus = "正常";
      updateStatusCard(environmentStatus, "正常", "pass");
      updateLastAction("检测完成");
      await refreshVersionInfo({ renderHome: false });
      renderResultCard("环境正常", "这台 Mac 可以继续准备 OpenClaw。", "pass");
      addAction("开始准备 OpenClaw", () => goToStep(1), "primary");
    } else {
      wizardState.environmentStatus = "需要处理";
      updateStatusCard(environmentStatus, "需要处理", "fail");
      updateLastAction("需要处理");
      renderCheckReport("环境需要处理", report);
    }
  } catch (error) {
    wizardState.environmentStatus = "需要处理";
    updateStatusCard(environmentStatus, "需要处理", "fail");
    renderResultCard("检查失败", getErrorMessage(error), "fail");
  } finally {
    setBusy(false);
  }
}

async function runInstallStep() {
  setBusy(true);
  updateLastAction("正在安装");
  renderProgressCard("正在准备 OpenClaw...", "正在自动检测环境、检查安装状态并准备 OpenClaw。本步骤不处理 API Key。", [
    "检查基础环境",
    "检查是否已安装 OpenClaw",
    "安装 OpenClaw",
    "确认命令可用"
  ]);

  try {
    const result = await window.openClawInstaller.runInstall();
    syncInstallStatus(result);

    if (result.success) {
      updateLastAction("OpenClaw 已安装");
      renderResultCard("OpenClaw 已准备好", "OpenClaw 已安装完成，下一步请配置 API。", "pass");
      await refreshVersionInfo({ renderHome: false });
      addAction("下一步：配置 API Key", () => goToConfigure("first"), "primary");
    } else {
      updateLastAction("准备失败");
      await renderPrepareFailure(result);
      addAction("问题排查", openLogs, "secondary");
    }
  } catch (error) {
    if (wizardState.installStatus !== "已安装") {
      wizardState.installStatus = "安装异常";
      updateStatusCard(openClawStatus, "安装异常", "fail");
    }
    await renderPrepareFailure({ error: getErrorMessage(error) });
  } finally {
    setBusy(false);
  }
}

async function runQuickConfigure(form) {
  const apiKey = String(form.elements.apiKey.value || "").trim();
  const provider = String(form.elements.provider.value || "openrouter");
  const modelChoice = String(form.elements.modelChoice.value || "auto");
  const defaultModel = resolveSelectedModel(form);

  if (defaultModel === null) {
    showCustomModelError(form);
    return;
  }

  clearCustomModelError(form);

  if (!apiKey) {
    renderResultCard("需要 API Key", "请先输入 API Key。", "fail");
    return;
  }

  setBusy(true);
  updateLastAction("正在配置");
  updateStatusCard(configStatus, "检查中", "running");
  renderProgressCard("正在快速配置 OpenClaw...", "正在调用 OpenClaw 官方非交互配置命令。API Key 不会显示在界面或日志中。", [
    "检查 OpenClaw 命令",
    "提交 AI 服务商配置",
    "安装或重启本地服务",
    "检查配置结果"
  ]);

  try {
    const result = await window.openClawInstaller.runQuickConfigure({
      provider,
      apiKey,
      defaultModel
    });
    form.elements.apiKey.value = "";

    if (!result.ok) {
      wizardState.configStatus = "配置异常";
      updateStatusCard(configStatus, "配置异常", "fail");
      updateLastAction("配置失败");
      renderResultCard("快速配置失败", result.message || "OpenClaw 官方配置命令执行失败。", "fail");
      addAction("返回配置", () => goToConfigure("first"), "secondary");
      return;
    }

    wizardState.pendingQuickConfigVerification = true;
    wizardState.pendingQuickConfigDetails = {
      provider: getProviderLabel(provider),
      modelMode: getModelMode(modelChoice),
      model: defaultModel || ""
    };
    wizardState.configStatus = "待确认";
    updateStatusCard(configStatus, "待确认", "warning");
    updateLastAction("配置完成");
    renderResultCard("配置已提交", "配置已完成，正在检查基础状态。", "pass");
    await runVerifyStep({ autoAdvance: true, confirmConfig: true });
  } catch (error) {
    form.elements.apiKey.value = "";
    wizardState.configStatus = "配置异常";
    updateStatusCard(configStatus, "配置异常", "fail");
    updateLastAction("配置失败");
    renderResultCard("快速配置失败", getErrorMessage(error), "fail");
  } finally {
    setBusy(false);
  }
}

async function runVerifyStep(options = {}) {
  setBusy(true);
  wizardState.currentStep = 3;
  renderProgress();
  updateLastAction("正在检查");
  updateStatusCard(configStatus, "检查中", "running");
  renderProgressCard("正在检查 OpenClaw 配置...", "正在检查 OpenClaw 命令、版本和配置文件，请稍候。", [
    "检查 OpenClaw 命令",
    "读取 OpenClaw 版本",
    "检查配置文件",
    "汇总检查结果"
  ]);

  try {
    await loadGuiConfigState();
    const report = await window.openClawInstaller.runVerify();
    wizardState.lastVerifyReport = report;
    const verifySummary = syncVerifyStatus(report, {
      confirmConfig: options.confirmConfig === true || wizardState.pendingQuickConfigVerification === true || hasGuiConfigState()
    });

    if (report.ok && verifySummary.confirmedConfigured) {
      if (wizardState.pendingQuickConfigVerification) {
        await persistGuiConfigState();
      }
      wizardState.pendingQuickConfigVerification = false;
      wizardState.pendingQuickConfigDetails = null;
      wizardState.verifyStatus = "通过";
      updateStatusCard(configStatus, "已配置", "pass");
      updateLastAction("检查配置通过");
      renderResultCard("配置已确认", "配置已确认，可以打开控制台。", "pass");
      await refreshVersionInfo({ renderHome: false });
      addAction("下一步：打开控制台", () => goToStep(4), "primary");
    } else if (report.ok) {
      wizardState.pendingQuickConfigVerification = false;
      wizardState.pendingQuickConfigDetails = null;
      wizardState.verifyStatus = "未确认";
      updateLastAction(verifySummary.hasConfigPath ? "待确认" : "待配置");
      renderCheckReport(
        verifySummary.hasConfigPath
          ? "检测到可能已有配置，但还不能确认 API Key 是否可用。建议重新配置 API Key，或进入官方配置向导检查。"
          : "尚未检测到完整配置，请先配置 API Key。",
        report
      );
      addAction("重新配置 API Key", () => goToConfigure("first"), "primary");
      addAction("官方配置向导", openAdvancedConfigure, "secondary");
      addAction("问题排查", openLogs, "secondary");
    } else {
      wizardState.verifyStatus = "失败";
      wizardState.configStatus = "配置异常";
      updateStatusCard(configStatus, "配置异常", "fail");
      updateLastAction("检查失败");
      renderCheckReport("配置可能未完成，请检查 API Key 或重新配置。", report);
      addAction("返回配置", () => goToConfigure("first"), "secondary");
      addAction("问题排查", openLogs, "secondary");
    }
  } catch (error) {
    wizardState.verifyStatus = "失败";
    updateStatusCard(configStatus, "配置异常", "fail");
    renderResultCard("检查失败", getErrorMessage(error), "fail");
  } finally {
    setBusy(false);
  }
}

async function runUpdateStep() {
  setBusy(true);
  updateLastAction("正在更新");
  renderProgressCard("正在更新 OpenClaw...", "将复用 OpenClaw 官方安装流程检查并安装新版本，不会删除你的配置文件。", [
    "环境检测",
    "下载官方安装脚本",
    "执行官方安装脚本",
    "确认命令可用",
    "刷新版本状态"
  ]);

  try {
    const result = await window.openClawInstaller.runUpdate();
    syncInstallStatus(result);

    if (!result.success) {
      updateLastAction("更新失败");
      renderResultCard("OpenClaw 更新失败", result.finalMessage || result.error || "请稍后重试，或打开问题排查查看日志。", "fail");
      addAction("重试更新", runUpdateStep, "primary");
      addAction("问题排查", openLogs, "secondary");
      return;
    }

    await refreshVersionInfo({ renderHome: false });
    const report = await window.openClawInstaller.runVerify();
    wizardState.lastVerifyReport = report;
    await loadGuiConfigState();
    const verifySummary = syncVerifyStatus(report, { confirmConfig: hasGuiConfigState() });

    if (report.ok && verifySummary.confirmedConfigured) {
      updateLastAction("OpenClaw 已更新");
      renderResultCard("OpenClaw 已更新完成", "OpenClaw 已更新完成。你可以继续打开控制台使用。", "pass");
      addConsoleActions();
      addAction("回到首页", handleGoHome, "secondary");
    } else if (report.ok) {
      updateLastAction("更新完成，待确认配置");
      renderResultCard("OpenClaw 已更新完成", "OpenClaw 已更新完成，但当前尚未确认 API 配置可用。建议先配置或检查 API Key。", "warning");
      addAction("重新配置 API Key", () => goToConfigure("first"), "primary");
      addAction("回到首页", handleGoHome, "secondary");
    } else {
      updateLastAction("更新后检查失败");
      renderCheckReport("更新已执行，但检查未通过。", report);
      addAction("问题排查", openLogs, "secondary");
    }
  } catch (error) {
    updateLastAction("更新失败");
    renderResultCard("OpenClaw 更新失败", getErrorMessage(error), "fail");
    addAction("问题排查", openLogs, "secondary");
  } finally {
    setBusy(false);
  }
}

async function openDashboard(button) {
  setBusy(true);
  updateLastAction("正在打开控制台");

  try {
    const result = await window.openClawInstaller.openDashboard();

    if (result.ok) {
      wizardState.dashboardStatus = "opened";
      wizardState.dashboardMessage = result.message || "已尝试启动 OpenClaw 控制台，请在浏览器中继续使用。";
      updateLastAction("启动控制台");
    } else {
      wizardState.dashboardStatus = "failed";
      wizardState.dashboardMessage = result.message || "控制台打开失败，请稍后重试，或进入问题排查看安装记录。";
      updateLastAction("控制台打开失败");
    }

    renderDashboardFeedback();
  } catch (error) {
    wizardState.dashboardStatus = "failed";
    wizardState.dashboardMessage = getErrorMessage(error) || "控制台打开失败，请稍后重试，或进入问题排查看安装记录。";
    updateLastAction("控制台打开失败");
    renderDashboardFeedback();
  } finally {
    setBusy(false);
  }
}

async function stopDashboard() {
  setBusy(true);
  updateLastAction("正在停止控制台");

  try {
    const result = await window.openClawInstaller.stopDashboard();

    if (result.ok) {
      wizardState.dashboardStatus = "stopped";
      wizardState.dashboardMessage = result.message || "已停止 OpenClaw 控制台。";
      updateLastAction("已停止控制台");
    } else {
      wizardState.dashboardStatus = "failed";
      wizardState.dashboardMessage = result.message || "控制台停止失败，请稍后重试，或进入问题排查看日志。";
      updateLastAction("控制台停止失败");
    }

    renderDashboardFeedback();
  } catch (error) {
    wizardState.dashboardStatus = "failed";
    wizardState.dashboardMessage = getErrorMessage(error) || "控制台停止失败，请稍后重试，或进入问题排查看日志。";
    updateLastAction("控制台停止失败");
    renderDashboardFeedback();
  } finally {
    setBusy(false);
  }
}

async function openAdvancedConfigure() {
  setBusy(true);
  updateLastAction("正在打开高级配置");

  try {
    const result = await window.openClawInstaller.runConfigure();
    renderResultCard(
      result.ok ? "官方配置向导已打开" : "无法打开官方配置向导",
      result.message || "请在打开的 Terminal 中继续完成配置。",
      result.ok ? "pass" : "fail"
    );
  } catch (error) {
    renderResultCard("无法打开官方配置向导", getErrorMessage(error), "fail");
  } finally {
    setBusy(false);
  }
}

async function openLogs() {
  setBusy(true);
  updateLastAction("问题排查");

  try {
    const result = await window.openClawInstaller.openLogsDirectory();
    renderResultCard(
      result.ok ? "已打开安装记录文件夹" : "暂时没有安装记录",
      result.ok
        ? "如果安装或配置失败，请把最新的 install-xxxx.log 文件发给开发者排查。"
        : "请先执行一键安装。",
      result.ok ? "pass" : "warning"
    );
  } catch (error) {
    renderResultCard("快速配置失败", getErrorMessage(error), "fail");
  } finally {
    setBusy(false);
  }
}

function createQuickConfigureForm() {
  const form = document.createElement("form");
  form.className = "quick-config-form";

  form.append(
    createSelectField("AI 服务商", "provider", [
      ["openrouter", "OpenRouter"],
      ["deepseek", "DeepSeek"],
      ["openai", "OpenAI"],
      ["gemini", "Gemini"],
      ["qwen", "Qwen"]
    ]),
    createInputField("API Key", "apiKey", "password", getProviderPlaceholder("openrouter")),
    createModelSelectField("默认模型", "modelChoice", "openrouter"),
    createInputField("自定义模型名称", "customModel", "text", "例如 provider/model-name"),
    createParagraph("选择你的 AI 服务商并粘贴 API Key。本工具不会保存、展示或记录你的 API Key。首次使用建议选择自动推荐模型。"),
  );

  const formNotice = document.createElement("div");
  formNotice.className = "form-inline-error";
  formNotice.hidden = true;
  form.appendChild(formNotice);

  const providerSelect = form.elements.provider;
  const modelSelect = form.elements.modelChoice;
  const apiKeyInput = form.elements.apiKey;
  const customModelInput = form.elements.customModel;
  updateCustomModelVisibility(form);
  providerSelect.addEventListener("change", () => {
    apiKeyInput.placeholder = getProviderPlaceholder(providerSelect.value);
    populateModelOptions(modelSelect, providerSelect.value);
    modelSelect.value = "auto";
    customModelInput.value = "";
    clearCustomModelError(form);
    updateCustomModelVisibility(form);
  });
  modelSelect.addEventListener("change", () => {
    if (modelSelect.value !== "custom") {
      customModelInput.value = "";
      clearCustomModelError(form);
    }
    updateCustomModelVisibility(form);
  });
  customModelInput.addEventListener("input", () => clearCustomModelError(form));

  const actions = document.createElement("div");
  actions.className = "configure-guide-actions";

  const submit = createButton(wizardState.configureMode === "reconfigure" ? "开始重新配置" : "开始配置", () => {}, "primary");
  submit.type = "submit";
  actions.appendChild(submit);
  form.appendChild(actions);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await runQuickConfigure(form);
  });

  return form;
}

function resolveSelectedModel(form) {
  const modelChoice = String(form.elements.modelChoice.value || "auto");

  if (modelChoice === "auto") {
    return "";
  }

  if (modelChoice === "custom") {
    const customModel = String(form.elements.customModel.value || "").trim();
    return customModel || null;
  }

  return modelChoice;
}

function getProviderPlaceholder(provider) {
  const placeholders = {
    openrouter: "请粘贴 OpenRouter API Key",
    deepseek: "请粘贴 DeepSeek API Key",
    openai: "请粘贴 OpenAI API Key",
    gemini: "请粘贴 Gemini API Key",
    qwen: "请粘贴 Qwen API Key"
  };

  return placeholders[provider] || "请粘贴服务商 API Key";
}

function getProviderLabel(provider) {
  const labels = {
    openrouter: "OpenRouter",
    deepseek: "DeepSeek",
    openai: "OpenAI",
    gemini: "Gemini",
    qwen: "Qwen"
  };

  return labels[provider] || provider;
}

function getModelMode(modelChoice) {
  if (modelChoice === "auto") {
    return "auto";
  }

  if (modelChoice === "custom") {
    return "custom";
  }

  return "selected";
}

const providerModels = {
  openrouter: [
    ["auto", "自动推荐，适合首次使用"],
    ["openrouter/auto", "openrouter/auto"],
    ["custom", "自定义模型名称"]
  ],
  deepseek: [
    ["auto", "自动推荐，适合首次使用"],
    ["deepseek-chat", "deepseek-chat"],
    ["deepseek-reasoner", "deepseek-reasoner"],
    ["custom", "自定义模型名称"]
  ],
  openai: [
    ["auto", "自动推荐，适合首次使用"],
    ["gpt-4o-mini", "gpt-4o-mini"],
    ["gpt-4o", "gpt-4o"],
    ["custom", "自定义模型名称"]
  ],
  gemini: [
    ["auto", "自动推荐，适合首次使用"],
    ["gemini-1.5-flash", "gemini-1.5-flash"],
    ["gemini-1.5-pro", "gemini-1.5-pro"],
    ["custom", "自定义模型名称"]
  ],
  qwen: [
    ["auto", "自动推荐，适合首次使用"],
    ["qwen-plus", "qwen-plus"],
    ["qwen-turbo", "qwen-turbo"],
    ["custom", "自定义模型名称"]
  ]
};

function createModelSelectField(labelText, name, provider) {
  const field = createSelectField(labelText, name, []);
  populateModelOptions(field.querySelector("select"), provider);
  return field;
}

function populateModelOptions(select, provider) {
  select.replaceChildren();

  for (const [value, text] of providerModels[provider] || providerModels.openrouter) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    select.appendChild(option);
  }
}

function updateCustomModelVisibility(form) {
  const customField = form.elements.customModel.closest(".quick-config-field");
  const isCustom = form.elements.modelChoice.value === "custom";
  customField.hidden = !isCustom;

  if (isCustom && !customField.querySelector(".field-help")) {
    const help = document.createElement("small");
    help.className = "field-help";
    help.textContent = "仅在你确认模型 ID 正确时使用。模型名称填错可能导致聊天时报错。";
    customField.appendChild(help);
  }
}

function showCustomModelError(form) {
  const notice = form.querySelector(".form-inline-error");
  const customField = form.elements.customModel.closest(".quick-config-field");
  form.elements.modelChoice.value = "custom";
  updateCustomModelVisibility(form);
  form.elements.customModel.focus();
  customField.classList.add("has-error");

  notice.replaceChildren();
  notice.hidden = false;

  const message = document.createElement("span");
  message.textContent = "请输入自定义模型名称，或改用自动推荐。";

  const action = document.createElement("button");
  action.type = "button";
  action.className = "link-button inline-link-action";
  action.textContent = "改用自动推荐";
  action.addEventListener("click", () => useAutoModel(form));

  notice.append(message, action);
}

function clearCustomModelError(form) {
  const notice = form.querySelector(".form-inline-error");
  const customField = form.elements.customModel.closest(".quick-config-field");
  customField.classList.remove("has-error");

  if (notice) {
    notice.hidden = true;
    notice.replaceChildren();
  }
}

function useAutoModel(form) {
  form.elements.modelChoice.value = "auto";
  form.elements.customModel.value = "";
  clearCustomModelError(form);
  updateCustomModelVisibility(form);
}

function createInputField(labelText, name, type, placeholder) {
  const label = document.createElement("label");
  label.className = "quick-config-field";

  const span = document.createElement("span");
  span.textContent = labelText;

  const input = document.createElement("input");
  input.name = name;
  input.type = type;
  input.placeholder = placeholder;
  input.autocomplete = "off";

  label.append(span, input);
  return label;
}

function createSelectField(labelText, name, options) {
  const label = document.createElement("label");
  label.className = "quick-config-field";

  const span = document.createElement("span");
  span.textContent = labelText;

  const select = document.createElement("select");
  select.name = name;

  for (const [value, text] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = text;
    select.appendChild(option);
  }

  label.append(span, select);
  return label;
}

async function renderPrepareFailure(result) {
  const doctorReport = await readDoctorReportSafely();
  const card = createCard("需要先处理基础环境", "你的电脑缺少运行 OpenClaw 所需的基础环境。请先按提示安装后重新检查。本工具不会自动安装系统级依赖，也不会修改 PATH。 ");

  if (doctorReport && Array.isArray(doctorReport.checks)) {
    for (const check of doctorReport.checks.filter((item) => item.level === "fail")) {
      card.appendChild(createCheckCard(check));
    }
    appendDependencyRepairSuggestions(card, doctorReport.checks);
  } else {
    card.appendChild(createNotice(result.finalMessage || result.error || "请查看准备结果或打开问题排查。", "fail"));
  }

  wizardCard.replaceChildren();
  wizardActions.replaceChildren();
  wizardCard.appendChild(card);
  addAction("重新检查", runInstallStep, "primary");
}

async function readDoctorReportSafely() {
  try {
    return await window.openClawInstaller.runDoctor();
  } catch (error) {
    return null;
  }
}

function appendDependencyRepairSuggestions(card, checks) {
  const failedText = checks
    .filter((check) => check.level === "fail")
    .map((check) => String(check.name || "") + " " + String(check.message || ""))
    .join(" ")
    .toLowerCase();

  if (failedText.includes("node") || failedText.includes("npm")) {
    card.appendChild(createNotice("需要先安装 Node.js。OpenClaw 需要 Node.js 和 npm 才能运行。安装 Node.js LTS 版本后，通常会同时安装 npm。", "warning"));
    const actions = document.createElement("div");
    actions.className = "configure-guide-actions";
    actions.appendChild(createButton("打开 Node.js 下载页面", () => openExternalUrl("https://nodejs.org/zh-cn/download"), "secondary"));
    actions.appendChild(createButton("复制安装说明", () => copyText("请访问 https://nodejs.org/zh-cn/download 下载并安装 Node.js LTS"), "secondary"));
    card.appendChild(actions);
  }

  if (failedText.includes("git")) {
    card.appendChild(createNotice("需要先安装 Git。OpenClaw 需要 Git 来完成部分安装或运行步骤。你可以通过 macOS 命令行工具安装 Git。", "warning"));
    const actions = document.createElement("div");
    actions.className = "configure-guide-actions";
    actions.appendChild(createButton("复制命令：xcode-select --install", () => copyText("xcode-select --install"), "secondary"));
    card.appendChild(actions);
  }
}

async function openExternalUrl(url) {
  if (window.openClawInstaller && window.openClawInstaller.openExternal) {
    await window.openClawInstaller.openExternal(url);
  }
}

async function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    updateLastAction("已复制命令");
  }
}

function renderProgressCard(title, description, items) {
  wizardCard.replaceChildren();
  wizardActions.replaceChildren();

  const card = createCard(title, description);
  const track = document.createElement("div");
  track.className = "progress-track indeterminate";
  const fill = document.createElement("div");
  fill.className = "progress-fill";
  track.appendChild(fill);
  card.appendChild(track);
  card.appendChild(createList(items, "simple-progress-list"));
  wizardCard.appendChild(card);
}

function renderResultCard(title, message, state) {
  wizardCard.replaceChildren();
  wizardActions.replaceChildren();

  const card = createCard(title, "");
  card.appendChild(createNotice(message, state));
  wizardCard.appendChild(card);
}

function renderCheckReport(title, report) {
  wizardCard.replaceChildren();
  wizardActions.replaceChildren();

  const card = createCard(title, "");
  const checks = Array.isArray(report.checks) ? report.checks : [];

  for (const check of checks) {
    card.appendChild(createCheckCard(check));
  }

  wizardCard.appendChild(card);
}

function createCard(titleText, descriptionText) {
  const card = document.createElement("div");
  card.className = "configure-guide-card";

  const title = document.createElement("div");
  title.className = "configure-guide-title";
  title.textContent = titleText;
  card.appendChild(title);

  if (descriptionText) {
    card.appendChild(createParagraph(descriptionText));
  }

  return card;
}

function createParagraph(text) {
  const paragraph = document.createElement("p");
  paragraph.className = "configure-guide-intro";
  paragraph.textContent = text;
  return paragraph;
}

function createList(items, className = "configure-guide-steps") {
  const list = document.createElement("ol");
  list.className = className;

  for (const item of items) {
    const row = document.createElement("li");
    row.textContent = item;
    list.appendChild(row);
  }

  return list;
}

function createNotice(message, state) {
  const notice = document.createElement("div");
  notice.className = "configure-guide-status " + (state || "info");
  notice.textContent = message;
  return notice;
}

function appendUpdateNotice(card) {
  if (!wizardState.versionInfo || !wizardState.versionInfo.updateAvailable || wizardState.updateNoticeDismissed) {
    return;
  }

  const notice = document.createElement("div");
  notice.className = "light-update-notice";

  const text = document.createElement("span");
  text.textContent = "发现新版本。";

  const update = document.createElement("button");
  update.type = "button";
  update.className = "link-button inline-link-action";
  update.textContent = "立即更新";
  update.addEventListener("click", runUpdateStep);

  const later = document.createElement("button");
  later.type = "button";
  later.className = "link-button inline-link-action";
  later.textContent = "稍后再说";
  later.addEventListener("click", dismissUpdateNotice);

  notice.append(text, update, later);
  card.appendChild(notice);
}

function dismissUpdateNotice() {
  wizardState.updateNoticeDismissed = true;
  closeAboutMenu();
  renderWizard();
}

function updateAboutIndicator() {
  if (!appStage) {
    return;
  }

  appStage.classList.toggle("has-update", Boolean(wizardState.versionInfo && wizardState.versionInfo.updateAvailable));
}

function toggleAboutMenu() {
  if (!aboutMenu || !appStage) {
    return;
  }

  const shouldOpen = aboutMenu.hidden;
  aboutMenu.hidden = !shouldOpen;
  appStage.setAttribute("aria-expanded", shouldOpen ? "true" : "false");

  if (shouldOpen) {
    renderAboutMenu();
  }
}

function closeAboutMenu() {
  if (!aboutMenu || !appStage) {
    return;
  }

  aboutMenu.hidden = true;
  appStage.setAttribute("aria-expanded", "false");
}

function renderAboutMenu() {
  if (!aboutMenu) {
    return;
  }

  aboutMenu.replaceChildren();

  const version = wizardState.versionInfo || {};
  const latestVersion = version.canCheckLatest ? version.latestVersion : "暂时无法检查";
  const updateState = version.canCheckLatest
    ? (version.updateAvailable ? "发现新版本" : "已是最新")
    : "暂时无法检查";

  const title = document.createElement("div");
  title.className = "about-menu-title";
  title.textContent = "OpenClaw 工具箱";
  aboutMenu.appendChild(title);

  aboutMenu.appendChild(createAboutRow("当前版本", version.currentVersion || wizardState.openClawVersion || "未知"));
  aboutMenu.appendChild(createAboutRow("最新版本", latestVersion || "暂时无法检查"));
  aboutMenu.appendChild(createAboutRow("更新状态", updateState));

  const actions = document.createElement("div");
  actions.className = "about-menu-actions";
  actions.appendChild(createAboutButton("检查更新", checkUpdateFromAbout));

  if (version.updateAvailable) {
    actions.appendChild(createAboutButton("立即更新", () => {
      closeAboutMenu();
      runUpdateStep();
    }));
    actions.appendChild(createAboutButton("稍后再说", dismissUpdateNotice));
  }

  aboutMenu.appendChild(actions);

  const links = document.createElement("div");
  links.className = "about-menu-links";
  links.appendChild(createAboutLink("问题排查", () => {
    closeAboutMenu();
    openLogs();
  }));
  aboutMenu.appendChild(links);

  const technical = document.createElement("details");
  technical.className = "about-technical";
  const summary = document.createElement("summary");
  summary.textContent = "技术信息";
  const commands = document.createElement("div");
  commands.className = "about-technical-body";
  commands.appendChild(createAboutRow("安装助手命令", "openclaw-installer"));
  commands.appendChild(createAboutRow("OpenClaw 命令", "openclaw"));
  technical.append(summary, commands);
  aboutMenu.appendChild(technical);
}

function createAboutRow(labelText, valueText) {
  const row = document.createElement("div");
  row.className = "about-menu-row";

  const label = document.createElement("span");
  label.textContent = labelText;

  const value = document.createElement("strong");
  value.textContent = valueText || "未知";

  row.append(label, value);
  return row;
}

function createAboutButton(label, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "about-menu-button";
  button.textContent = label;
  button.addEventListener("click", handler);
  return button;
}

function createAboutLink(label, handler) {
  const button = createAboutButton(label, handler);
  button.classList.add("about-menu-link");
  return button;
}

async function checkUpdateFromAbout() {
  updateLastAction("正在检查更新");
  await refreshVersionInfo({ renderHome: true });
  renderAboutMenu();
}

function appendVersionInfo(card) {
  if (wizardState.versionInfo) {
    const version = wizardState.versionInfo;
    const latest = version.canCheckLatest ? version.latestVersion : "暂时无法检查";
    const updateState = version.canCheckLatest
      ? (version.updateAvailable ? "有新版本" : "已是最新")
      : "无法检查";

    card.appendChild(createKeyValueList([
      ["当前版本", version.currentVersion || wizardState.openClawVersion || "未知"],
      ["最新版本", latest || "暂时无法检查"],
      ["更新状态", updateState]
    ]));

    if (version.updateAvailable) {
      card.appendChild(createNotice("检测到 OpenClaw 有新版本，建议更新。", "warning"));
    } else if (!version.canCheckLatest) {
      card.appendChild(createNotice("暂时无法检查最新版本，不影响继续使用。", "warning"));
    }
    return;
  }

  if (wizardState.openClawVersion) {
    card.appendChild(createKeyValueList([
      ["当前版本", wizardState.openClawVersion],
      ["最新版本", "暂时无法检查"],
      ["更新状态", "无法检查"]
    ]));
  }
}

function addUpdateActionIfNeeded() {
  if (wizardState.versionInfo && wizardState.versionInfo.updateAvailable) {
    addAction("立即更新", runUpdateStep, "secondary");
  }
}

function createKeyValueList(items) {
  const list = document.createElement("div");
  list.className = "version-info-list";

  for (const [labelText, valueText] of items) {
    const row = document.createElement("div");
    row.className = "version-info-row";

    const label = document.createElement("span");
    label.textContent = labelText;

    const value = document.createElement("strong");
    value.textContent = valueText;

    row.append(label, value);
    list.appendChild(row);
  }

  return list;
}

function createUsageCard() {
  const card = createCard("OpenClaw 可以帮助你：", "");
  card.appendChild(createList([
    "和 AI agent 对话",
    "总结资料",
    "整理任务",
    "辅助写作",
    "后续连接更多工具和聊天渠道"
  ]));
  return card;
}

function appendDashboardNotice(card) {
  if (wizardState.dashboardStatus === "opened") {
    card.appendChild(createNotice(wizardState.dashboardMessage || "已尝试启动 OpenClaw 控制台，请在浏览器中继续使用。", "pass"));
  }

  if (wizardState.dashboardStatus === "failed") {
    card.appendChild(createNotice(wizardState.dashboardMessage || "控制台打开失败，请稍后重试，或进入问题排查看安装记录。", "fail"));
  }
}

function getDashboardButtonLabel() {
  return "启动控制台";
}

function renderDashboardFeedback() {
  const stepId = steps[wizardState.currentStep].id;

  if (stepId !== "welcome") {
    wizardState.currentStep = 4;
  }

  renderWizard();
}

function renderUtilities() {
  wizardUtilities.replaceChildren();

  const intro = document.createElement("span");
  intro.className = "advanced-options-label";
  intro.textContent = "高级选项：普通用户通常不需要使用";
  wizardUtilities.appendChild(intro);

  const advanced = document.createElement("button");
  advanced.type = "button";
  advanced.className = "link-button";
  advanced.textContent = "官方配置向导";
  advanced.addEventListener("click", openAdvancedConfigure);

  const doctor = document.createElement("button");
  doctor.type = "button";
  doctor.className = "link-button";
  doctor.textContent = "重新检查环境";
  doctor.addEventListener("click", runDoctorStep);

  const logs = document.createElement("button");
  logs.type = "button";
  logs.className = "link-button";
  logs.textContent = "问题排查";
  logs.addEventListener("click", openLogs);

  wizardUtilities.append(advanced, doctor, logs);
}

function addConsoleActions() {
  addAction("启动控制台", openDashboard, "primary");
  addAction("停止控制台", stopDashboard, "secondary");
}

function addBackAction() {
  if (wizardState.currentStep > 0) {
    addAction("上一步", () => goToStep(wizardState.currentStep - 1), "secondary");
  }
}

function addAction(label, handler, kind) {
  const button = createButton(label, handler, kind);
  wizardActions.appendChild(button);
}

function createButton(label, handler, kind) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = kind === "primary" ? "inline-action-button" : "secondary-action-button";
  button.textContent = label;
  button.disabled = wizardState.isBusy;
  button.addEventListener("click", handler);
  return button;
}

async function refreshVersionInfo(options = {}) {
  if (!window.openClawInstaller || !window.openClawInstaller.checkOpenClawVersion) {
    return null;
  }

  try {
    const version = await window.openClawInstaller.checkOpenClawVersion();
    wizardState.versionInfo = version;

    if (version.installed) {
      wizardState.installStatus = "已安装";
      updateStatusCard(openClawStatus, "已安装", "pass");

      if (version.currentVersion) {
        wizardState.openClawVersion = version.currentVersion;
        updateStatusCard(versionStatus, version.currentVersion, "pass");
      } else {
        updateStatusCard(versionStatus, "未知", "warning");
      }
    }

    updateAboutIndicator();
    renderAboutMenu();

    if (options.renderHome && wizardState.currentStep === 0) {
      renderWizard();
    }

    return version;
  } catch (error) {
    wizardState.versionInfo = {
      installed: wizardState.installStatus === "已安装",
      currentVersion: wizardState.openClawVersion || null,
      latestVersion: null,
      updateAvailable: false,
      canCheckLatest: false,
      message: "暂时无法检查最新版本。"
    };
    updateStatusCard(versionStatus, wizardState.openClawVersion || "未知", wizardState.openClawVersion ? "warning" : "neutral");
    updateAboutIndicator();
    renderAboutMenu();
    return wizardState.versionInfo;
  }
}

function goToConfigure(mode) {
  wizardState.configureMode = mode || "first";
  goToStep(2);
}

async function loadGuiConfigState() {
  if (!window.openClawInstaller || !window.openClawInstaller.readConfigState) {
    wizardState.guiConfigState = null;
    return null;
  }

  try {
    const result = await window.openClawInstaller.readConfigState();
    wizardState.guiConfigState = result && result.exists && result.state && result.state.configuredByGui === true
      ? result.state
      : null;
    return wizardState.guiConfigState;
  } catch (error) {
    wizardState.guiConfigState = null;
    return null;
  }
}

function hasGuiConfigState() {
  return Boolean(wizardState.guiConfigState && wizardState.guiConfigState.configuredByGui === true);
}

async function persistGuiConfigState() {
  if (!window.openClawInstaller || !window.openClawInstaller.saveConfigState) {
    return null;
  }

  const details = wizardState.pendingQuickConfigDetails || {};

  try {
    const result = await window.openClawInstaller.saveConfigState({
      provider: details.provider || "",
      modelMode: details.modelMode || "auto",
      model: details.model || "",
      openclawVersion: wizardState.openClawVersion || ""
    });
    wizardState.guiConfigState = result && result.state ? result.state : null;
    return wizardState.guiConfigState;
  } catch (error) {
    return null;
  }
}

function handleGoHome() {
  if (wizardState.isBusy || wizardState.isProbingStartup) {
    updateLastAction("当前任务进行中");
    return;
  }

  wizardState.currentStep = 0;
  renderWizard();
}

function goToStep(index) {
  wizardState.currentStep = Math.max(0, Math.min(index, steps.length - 1));
  renderWizard();
}

function setBusy(isBusy) {
  wizardState.isBusy = isBusy;
  for (const button of [...wizardActions.querySelectorAll("button"), ...wizardUtilities.querySelectorAll("button")]) {
    button.disabled = isBusy;
  }
  updateHomeButtonState();
}

function updateHomeButtonState() {
  if (!homeButton) {
    return;
  }

  homeButton.disabled = wizardState.isBusy || wizardState.isProbingStartup;
}

async function probeStartupState() {
  wizardState.isProbingStartup = true;
  updateLastAction("正在识别状态");
  renderWizard();

  try {
    await loadGuiConfigState();
    const report = await window.openClawInstaller.runVerify();
    wizardState.lastVerifyReport = report;
    const checks = Array.isArray(report.checks) ? report.checks : [];
    const commandCheck = checks.find((check) => String(check.name || "").includes("OpenClaw 命令"));

    if (commandCheck && commandCheck.ok) {
      wizardState.installStatus = "已安装";
      updateStatusCard(openClawStatus, "已安装", "pass");
    }

    if (report.ok) {
      await loadGuiConfigState();
      const verifySummary = syncVerifyStatus(report, { confirmConfig: hasGuiConfigState() });
      wizardState.verifyStatus = verifySummary.confirmedConfigured ? "通过" : "未检查";
      updateLastAction(verifySummary.confirmedConfigured ? "已准备好" : verifySummary.hasConfigPath ? "待确认" : "待配置");
    } else if (commandCheck && !commandCheck.ok) {
      wizardState.installStatus = "未安装";
      updateStatusCard(openClawStatus, "未安装", "fail");
      updateStatusCard(configStatus, "待配置", "warning");
      updateLastAction("尚未安装");
    } else {
      syncVerifyStatus(report);
      updateLastAction("需要处理");
    }
  } catch (error) {
    updateLastAction("尚未检测");
  } finally {
    if (wizardState.installStatus === "已安装") {
      await refreshVersionInfo({ renderHome: false });
    }
    wizardState.startupProbeDone = true;
    wizardState.isProbingStartup = false;
    updateHomeButtonState();
    if (wizardState.currentStep === 0) {
      renderWizard();
    }
  }
}

function isReadyToUse() {
  return wizardState.installStatus === "已安装" && wizardState.configStatus === "已配置";
}

function isToolboxHome() {
  return wizardState.currentStep === 0 && isReadyToUse() && !wizardState.isProbingStartup;
}

function getHomeDashboardButtonLabel() {
  return "启动控制台";
}

function syncDoctorStatus(report) {
  const checks = Array.isArray(report.checks) ? report.checks : [];
  const openClawCheck = checks.find((check) => String(check.name || "").toLowerCase().includes("openclaw"));

  if (openClawCheck) {
    const message = String(openClawCheck.message || "");

    if (openClawCheck.level !== "fail" && message.includes("已安装")) {
      wizardState.installStatus = "已安装";
      updateStatusCard(openClawStatus, "已安装", "pass");
      wizardState.openClawVersion = extractVersion(message);
      if (wizardState.openClawVersion) {
        updateStatusCard(versionStatus, wizardState.openClawVersion, "pass");
      }
    } else if (openClawCheck.level === "fail" || message.includes("未安装") || message.includes("未检测到")) {
      wizardState.installStatus = "未安装";
      updateStatusCard(openClawStatus, "未安装", "fail");
    }
  }
}

function syncInstallStatus(result) {
  if (result.success) {
    wizardState.installStatus = "已安装";
    updateStatusCard(environmentStatus, "正常", "pass");
    updateStatusCard(openClawStatus, "已安装", "pass");

    if (result.version) {
      wizardState.openClawVersion = result.version;
      updateStatusCard(versionStatus, result.version, "pass");
    }
    return;
  }

  const wasInstalled = wizardState.installStatus === "已安装";
  if (!wasInstalled) {
    wizardState.installStatus = "安装异常";
    updateStatusCard(openClawStatus, "安装异常", "fail");
  }
}

function syncVerifyStatus(report, options = {}) {
  const checks = Array.isArray(report.checks) ? report.checks : [];
  const commandCheck = checks.find((check) => String(check.name || "").includes("OpenClaw 命令"));
  const versionCheck = checks.find((check) => String(check.name || "").includes("OpenClaw 版本"));
  const configCheck = checks.find((check) => String(check.name || "").includes("配置文件"));
  const hasConfigPath = Boolean(report.ok && configCheck && configCheck.ok && configCheck.level !== "warning");
  const canConfirmConfig = Boolean(options.confirmConfig || (wizardState.configStatus === "已配置" && report.ok));

  if (versionCheck && versionCheck.ok) {
    wizardState.installStatus = "已安装";
    updateStatusCard(openClawStatus, "已安装", "pass");
    wizardState.openClawVersion = versionCheck.message;
    updateStatusCard(versionStatus, versionCheck.message, "pass");
  }

  if (hasConfigPath && canConfirmConfig) {
    wizardState.configStatus = "已配置";
    updateStatusCard(configStatus, "已配置", "pass");
    return { confirmedConfigured: true, hasConfigPath };
  }

  if (hasConfigPath) {
    wizardState.configStatus = "待确认";
    updateStatusCard(configStatus, "待确认", "warning");
    return { confirmedConfigured: false, hasConfigPath };
  }

  if (report.ok) {
    wizardState.configStatus = "待配置";
    updateStatusCard(configStatus, "待配置", "warning");
    return { confirmedConfigured: false, hasConfigPath: false };
  }

  if (commandCheck && !commandCheck.ok) {
    wizardState.installStatus = "未安装";
    updateStatusCard(openClawStatus, "未安装", "fail");
    wizardState.configStatus = "待配置";
    updateStatusCard(configStatus, "待配置", "warning");
    return { confirmedConfigured: false, hasConfigPath: false };
  }

  wizardState.configStatus = "配置异常";
  updateStatusCard(configStatus, "配置异常", "fail");
  return { confirmedConfigured: false, hasConfigPath: false };
}

function updateStatusCard(element, value, state) {
  element.textContent = value;
  const card = element.closest(".status-item");

  if (!card) {
    return;
  }

  card.classList.remove("status-pass", "status-warning", "status-fail", "status-running", "status-neutral");
  card.classList.add("status-" + state);
}

function updateLastAction(value) {
  const safeValue = sanitizeActionSummary(value);
  lastAction.textContent = safeValue;
  recordRecentAction(safeValue);
}

function sanitizeActionSummary(value) {
  return String(value || "尚未操作")
    .replace(/[\r\n]/g, " ")
    .replace(/openclaw\s+onboard[^，。]*/gi, "配置流程")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[已隐藏]")
    .trim()
    .slice(0, 40) || "尚未操作";
}

function recordRecentAction(value) {
  if (!value || value === "尚未操作") {
    renderRecentStatusMenu();
    return;
  }

  if (wizardState.recentActions[0] !== value) {
    wizardState.recentActions.unshift(value);
  }

  wizardState.recentActions = wizardState.recentActions.slice(0, 5);
  renderRecentStatusMenu();
}

function toggleRecentStatusMenu() {
  if (!recentStatusMenu || !recentStatusButton) {
    return;
  }

  const shouldOpen = recentStatusMenu.hidden;
  recentStatusMenu.hidden = !shouldOpen;
  recentStatusButton.setAttribute("aria-expanded", shouldOpen ? "true" : "false");

  if (shouldOpen) {
    renderRecentStatusMenu();
  }
}

function closeRecentStatusMenu() {
  if (!recentStatusMenu || !recentStatusButton) {
    return;
  }

  recentStatusMenu.hidden = true;
  recentStatusButton.setAttribute("aria-expanded", "false");
}

function renderRecentStatusMenu() {
  if (!recentStatusMenu) {
    return;
  }

  recentStatusMenu.replaceChildren();

  if (!wizardState.recentActions.length) {
    const empty = document.createElement("div");
    empty.className = "recent-status-empty";
    empty.textContent = "暂无最近操作";
    recentStatusMenu.appendChild(empty);
    return;
  }

  for (const action of wizardState.recentActions.slice(0, 5)) {
    const item = document.createElement("div");
    item.className = "recent-status-menu-item";
    item.textContent = action;
    recentStatusMenu.appendChild(item);
  }
}

function createCheckCard(check) {
  const level = check.level || (check.ok ? "pass" : "info");
  const card = document.createElement("div");
  card.className = "check-card " + level;

  const header = document.createElement("div");
  header.className = "check-card-header";

  const name = document.createElement("div");
  name.className = "check-card-name";
  name.textContent = check.name || "未命名检查项";

  const status = document.createElement("div");
  status.className = "check-card-status";
  status.textContent = level === "fail" ? "✖" : level === "warning" ? "⚠" : "✔";

  const message = document.createElement("div");
  message.className = "check-card-message";
  message.textContent = check.message || "暂无详细说明";

  header.append(name, status);
  card.append(header, message);
  return card;
}

function getInstallMessage(result) {
  if (result.finalMessage) {
    return result.finalMessage;
  }

  if (result.version) {
    return "OpenClaw 安装完成，版本：" + result.version;
  }

  return "OpenClaw 安装完成。";
}

function extractVersion(message) {
  const match = String(message || "").match(/版本[:：]?\s*(.+)$/);
  return match ? match[1] : "";
}

function getErrorMessage(error) {
  return String(error && error.message ? error.message : error);
}
