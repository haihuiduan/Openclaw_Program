// Renderer：一页式安装向导。只通过 preload 暴露的安全 API 调用主进程能力。
const lastAction = document.querySelector("#lastAction");
const environmentStatus = document.querySelector("#environmentStatus");
const openClawStatus = document.querySelector("#openClawStatus");
const configStatus = document.querySelector("#configStatus");
const appStage = document.querySelector("#appStage");
const homeButton = document.querySelector("#homeButton");
const wizardProgress = document.querySelector("#wizardProgress");
const wizardCard = document.querySelector("#wizardCard");
const wizardActions = document.querySelector("#wizardActions");
const wizardUtilities = document.querySelector("#wizardUtilities");

const steps = [
  { id: "welcome", label: "欢迎" },
  { id: "doctor", label: "环境检测" },
  { id: "install", label: "安装" },
  { id: "configure", label: "配置 API" },
  { id: "verify", label: "验证" },
  { id: "dashboard", label: "打开控制台" }
];

const wizardState = {
  currentStep: 0,
  environmentStatus: "未检测",
  installStatus: "未安装",
  configStatus: "待配置",
  verifyStatus: "未验证",
  openClawVersion: "",
  versionInfo: null,
  configureMode: "first",
  startupProbeDone: false,
  isProbingStartup: false,
  lastDoctorReport: null,
  lastVerifyReport: null,
  isBusy: false
};

if (window.openClawInstaller) {
  appStage.textContent = window.openClawInstaller.stage;
}

if (homeButton) {
  homeButton.addEventListener("click", handleGoHome);
}

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

  if (stepId === "doctor") {
    renderDoctorStep();
    return;
  }

  if (stepId === "install") {
    renderInstallStep();
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
    const card = createCard("OpenClaw 已准备好", "你可以直接打开 Dashboard 使用 OpenClaw，或重新配置 API Key。");
    card.appendChild(createNotice("已检测到 OpenClaw 安装和配置状态。", "pass"));
    appendVersionInfo(card);
    wizardCard.appendChild(card);
    addAction("打开控制台", openDashboard, "primary");
    addAction("更换 API Key", () => goToConfigure("reconfigure"), "secondary");
    addUpdateActionIfNeeded();
    return;
  }

  if (wizardState.installStatus === "已安装") {
    const card = createCard("还差一步：配置 API Key", "OpenClaw 已安装。请配置 AI 服务商后开始使用。");
    card.appendChild(createNotice("配置完成后，本软件会帮你验证 OpenClaw 是否可以使用。", "info"));
    appendVersionInfo(card);
    wizardCard.appendChild(card);
    addAction("配置 API Key", () => goToConfigure("first"), "primary");
    addAction("打开官方高级配置", openAdvancedConfigure, "secondary");
    addUpdateActionIfNeeded();
    return;
  }

  const card = createCard("OpenClaw 安装助手", "本工具将帮助你完成以下步骤：");
  card.appendChild(createList([
    "检查电脑环境",
    "安装 OpenClaw",
    "配置 AI 服务商 API Key",
    "验证配置",
    "打开 OpenClaw 控制台"
  ]));
  wizardCard.appendChild(card);

  addAction("开始", () => goToStep(1), "primary");
}

function renderDoctorStep() {
  const card = createCard("环境检测", "检查 macOS、CPU 架构、Node.js、npm、Git 和 OpenClaw 安装状态。");

  if (wizardState.environmentStatus === "通过") {
    card.appendChild(createNotice("环境检测通过，可以继续安装。", "pass"));
  } else if (wizardState.environmentStatus === "有问题") {
    card.appendChild(createNotice("环境检测未通过，请先根据检测结果修复问题。", "fail"));
  } else {
    card.appendChild(createNotice("建议先完成环境检测，再继续安装。", "info"));
  }

  wizardCard.appendChild(card);
  addBackAction();
  addAction("开始检测", runDoctorStep, "primary");

  if (wizardState.environmentStatus === "通过") {
    addAction("下一步：安装 OpenClaw", () => goToStep(2), "primary");
  }
}

function renderInstallStep() {
  const card = createCard("安装 OpenClaw", "");

  if (wizardState.openClawVersion) {
    card.appendChild(createNotice("检测到 OpenClaw 已安装，版本：" + wizardState.openClawVersion + "。", "pass"));
  } else if (wizardState.installStatus === "已安装") {
    card.appendChild(createNotice("检测到 OpenClaw 已安装。", "pass"));
  } else if (wizardState.installStatus === "安装异常") {
    card.appendChild(createNotice("安装未完成，请查看错误信息或打开问题排查。", "fail"));
  } else {
    card.appendChild(createNotice("准备安装 OpenClaw，首次安装可能需要几分钟。", "info"));
  }

  wizardCard.appendChild(card);
  addBackAction();

  if (wizardState.installStatus === "已安装") {
    addAction("下一步：配置 API", () => goToConfigure("first"), "primary");
  } else {
    addAction("开始安装", runInstallStep, "primary");
  }
}

function renderConfigureStep() {
  const isReconfigure = wizardState.configureMode === "reconfigure";
  const card = createCard(
    isReconfigure ? "重新配置 API Key" : "配置 AI 服务商",
    isReconfigure
      ? "你可以选择新的 AI 服务商并输入新的 API Key。配置完成后，本软件会重新验证 OpenClaw。"
      : "请选择你的 AI 服务商并输入 API Key。"
  );
  card.appendChild(createQuickConfigureForm());
  wizardCard.appendChild(card);

  addBackAction();

  if (wizardState.configStatus === "已配置") {
    addAction("下一步：验证配置", () => goToStep(4), "primary");
  }
}

function renderVerifyStep() {
  const card = createCard("验证配置", "检查 OpenClaw 命令、版本和配置文件是否可用。");

  if (wizardState.verifyStatus === "通过") {
    card.appendChild(createNotice("配置完成，可以打开控制台。", "pass"));
  } else if (wizardState.verifyStatus === "失败") {
    card.appendChild(createNotice("配置可能未完成，请检查 API Key 或重新配置。", "fail"));
  } else {
    card.appendChild(createNotice("完成配置后，请验证 OpenClaw 是否可以基本使用。", "info"));
  }

  wizardCard.appendChild(card);
  addBackAction();
  addAction("开始验证", runVerifyStep, "primary");

  if (wizardState.verifyStatus === "通过") {
    addAction("下一步：打开控制台", () => goToStep(5), "primary");
  }

  if (wizardState.verifyStatus === "失败") {
    addAction("返回配置", () => goToConfigure("first"), "secondary");
    addAction("问题排查", openLogs, "secondary");
  }
}

function renderDashboardStep() {
  const card = createCard("OpenClaw 已准备好使用", "点击按钮打开浏览器控制台。");
  card.appendChild(createUsageCard());
  wizardCard.appendChild(card);

  addBackAction();
  addAction("打开 OpenClaw 控制台", openDashboard, "primary");
}

async function runDoctorStep() {
  setBusy(true);
  updateLastAction("正在检测");
  updateStatusCard(environmentStatus, "检测中", "running");
  renderProgressCard("正在检测运行环境...", "正在检查 macOS、CPU 架构、Node.js、npm、Git 和 OpenClaw 安装状态。", [
    "检查 macOS 系统",
    "检查 CPU 架构",
    "检查 Node.js",
    "检查 npm",
    "检查 Git",
    "检查 OpenClaw 安装状态"
  ]);

  try {
    const report = await window.openClawInstaller.runDoctor();
    wizardState.lastDoctorReport = report;
    syncDoctorStatus(report);

    if (report.ok) {
      wizardState.environmentStatus = "通过";
      updateStatusCard(environmentStatus, "通过", "pass");
      updateLastAction("检测完成");
      await refreshVersionInfo({ renderHome: false });
      renderResultCard("环境检测通过", "环境检测通过，可以继续安装。", "pass");
      addAction("下一步：安装 OpenClaw", () => goToStep(2), "primary");
    } else {
      wizardState.environmentStatus = "有问题";
      updateStatusCard(environmentStatus, "有问题", "fail");
      updateLastAction("检测失败");
      renderCheckReport("环境检测未通过", report);
    }
  } catch (error) {
    wizardState.environmentStatus = "有问题";
    updateStatusCard(environmentStatus, "有问题", "fail");
    renderResultCard("检测失败", getErrorMessage(error), "fail");
  } finally {
    setBusy(false);
  }
}

async function runInstallStep() {
  setBusy(true);
  updateLastAction("正在安装");
  renderProgressCard("正在安装 OpenClaw...", "一键安装会先自动检测环境，通过后继续安装 OpenClaw。请保持网络连接，不要关闭本窗口。", [
    "环境检测",
    "检查是否已安装",
    "下载官方安装脚本",
    "执行安装",
    "验证 openclaw 命令"
  ]);

  try {
    const result = await window.openClawInstaller.runInstall();
    syncInstallStatus(result);

    if (result.success) {
      updateLastAction("安装完成");
      renderResultCard("OpenClaw 已安装", getInstallMessage(result), "pass");
      await refreshVersionInfo({ renderHome: false });
      addAction("下一步：配置 API", () => goToConfigure("first"), "primary");
    } else {
      updateLastAction("安装失败");
      renderResultCard("安装未完成", result.finalMessage || result.error || "请查看安装结果或打开问题排查。", "fail");
      addAction("重试安装", runInstallStep, "primary");
      addAction("问题排查", openLogs, "secondary");
    }
  } catch (error) {
    if (wizardState.installStatus !== "已安装") {
      wizardState.installStatus = "安装异常";
      updateStatusCard(openClawStatus, "安装异常", "fail");
    }
    renderResultCard("安装失败", getErrorMessage(error), "fail");
  } finally {
    setBusy(false);
  }
}

async function runQuickConfigure(form) {
  const apiKey = String(form.elements.apiKey.value || "").trim();
  const provider = String(form.elements.provider.value || "openrouter");
  const defaultModel = String(form.elements.defaultModel.value || "").trim();

  if (!apiKey) {
    renderResultCard("需要 API Key", "请先输入 API Key。", "fail");
    return;
  }

  if (provider !== "openrouter") {
    renderResultCard("当前暂未支持该服务商", "这个最小版本先支持 OpenRouter。DeepSeek、OpenAI、Gemini、Qwen 会在后续版本接入。", "warning");
    return;
  }

  setBusy(true);
  updateLastAction("正在配置");
  updateStatusCard(configStatus, "验证中", "running");
  renderProgressCard("正在快速配置 OpenClaw...", "正在调用 OpenClaw 官方非交互配置命令。API Key 不会显示在界面或日志中。", [
    "检查 OpenClaw 命令",
    "提交 OpenRouter 配置",
    "安装或重启本地服务",
    "验证配置结果"
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

    wizardState.configStatus = "已配置";
    updateLastAction("配置完成");
    renderResultCard("快速配置完成", "配置已执行，正在进入验证步骤。", "pass");
    await runVerifyStep({ autoAdvance: true });
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
  wizardState.currentStep = 4;
  renderProgress();
  updateLastAction("正在验证");
  updateStatusCard(configStatus, "验证中", "running");
  renderProgressCard("正在验证 OpenClaw 配置...", "正在检查 OpenClaw 命令、版本和配置文件，请稍候。", [
    "检查 OpenClaw 命令",
    "读取 OpenClaw 版本",
    "检查配置文件",
    "汇总验证结果"
  ]);

  try {
    const report = await window.openClawInstaller.runVerify();
    wizardState.lastVerifyReport = report;
    syncVerifyStatus(report);

    if (report.ok && wizardState.configStatus === "已配置") {
      wizardState.verifyStatus = "通过";
      updateStatusCard(configStatus, "已配置", "pass");
      updateLastAction("验证完成");
      renderResultCard("配置完成", "配置完成，可以打开控制台。", "pass");
      await refreshVersionInfo({ renderHome: false });
      addAction("下一步：打开控制台", () => goToStep(5), "primary");
    } else if (report.ok) {
      wizardState.verifyStatus = "失败";
      updateLastAction("待配置");
      renderCheckReport("配置可能未完成，请检查 API Key 或重新配置。", report);
      addAction("返回配置", () => goToConfigure("first"), "secondary");
      addAction("问题排查", openLogs, "secondary");
    } else {
      wizardState.verifyStatus = "失败";
      wizardState.configStatus = "配置异常";
      updateStatusCard(configStatus, "配置异常", "fail");
      updateLastAction("验证失败");
      renderCheckReport("配置可能未完成，请检查 API Key 或重新配置。", report);
      addAction("返回配置", () => goToConfigure("first"), "secondary");
      addAction("问题排查", openLogs, "secondary");
    }
  } catch (error) {
    wizardState.verifyStatus = "失败";
    updateStatusCard(configStatus, "配置异常", "fail");
    renderResultCard("验证失败", getErrorMessage(error), "fail");
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
    "验证 openclaw 命令",
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
    syncVerifyStatus(report);

    if (report.ok) {
      updateLastAction("更新完成");
      renderResultCard("OpenClaw 已更新完成", "OpenClaw 已更新完成。你可以继续打开控制台使用。", "pass");
      addAction("打开控制台", openDashboard, "primary");
      addAction("回到首页", handleGoHome, "secondary");
    } else {
      updateLastAction("更新后验证失败");
      renderCheckReport("更新已执行，但验证未通过。", report);
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
    renderResultCard(
      result.ok ? "OpenClaw Dashboard" : "无法打开控制台",
      result.message || (result.ok ? "已尝试打开 OpenClaw Dashboard，请在浏览器中继续使用。" : "未检测到 OpenClaw，请先执行一键安装。"),
      result.ok ? "pass" : "fail"
    );

    if (result.ok) {
      updateLastAction("控制台已打开");
      wizardCard.appendChild(createUsageCard());
    } else {
      updateLastAction("控制台打开失败");
    }
  } catch (error) {
    renderResultCard("无法打开控制台", getErrorMessage(error), "fail");
    updateLastAction("控制台打开失败");
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
    renderResultCard("问题排查失败", getErrorMessage(error), "fail");
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
    createInputField("API Key", "apiKey", "password", "粘贴服务商 API Key"),
    createInputField("默认模型（可选）", "defaultModel", "text", "openrouter/auto"),
    createParagraph("本工具不会保存、展示或记录 API Key，配置通过 OpenClaw 官方命令完成。"),
  );

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

function renderUtilities() {
  wizardUtilities.replaceChildren();

  const advanced = document.createElement("button");
  advanced.type = "button";
  advanced.className = "link-button";
  advanced.textContent = "需要高级配置？打开官方配置向导";
  advanced.addEventListener("click", openAdvancedConfigure);

  const logs = document.createElement("button");
  logs.type = "button";
  logs.className = "link-button";
  logs.textContent = "问题排查";
  logs.addEventListener("click", openLogs);

  wizardUtilities.append(advanced, logs);
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
      }
    }

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
    return wizardState.versionInfo;
  }
}

function goToConfigure(mode) {
  wizardState.configureMode = mode || "first";
  goToStep(3);
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
    const report = await window.openClawInstaller.runVerify();
    wizardState.lastVerifyReport = report;
    const checks = Array.isArray(report.checks) ? report.checks : [];
    const commandCheck = checks.find((check) => String(check.name || "").includes("OpenClaw 命令"));

    if (commandCheck && commandCheck.ok) {
      wizardState.installStatus = "已安装";
      updateStatusCard(openClawStatus, "已安装", "pass");
    }

    if (report.ok) {
      syncVerifyStatus(report);
      wizardState.verifyStatus = wizardState.configStatus === "已配置" ? "通过" : "未验证";
      updateLastAction(wizardState.configStatus === "已配置" ? "已准备好" : "待配置");
    } else if (commandCheck && !commandCheck.ok) {
      wizardState.installStatus = "未安装";
      updateStatusCard(openClawStatus, "未安装", "fail");
      updateStatusCard(configStatus, "待配置", "warning");
      updateLastAction("尚未安装");
    } else {
      syncVerifyStatus(report);
      updateLastAction("待处理");
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

function syncDoctorStatus(report) {
  const checks = Array.isArray(report.checks) ? report.checks : [];
  const openClawCheck = checks.find((check) => String(check.name || "").toLowerCase().includes("openclaw"));

  if (openClawCheck) {
    const message = String(openClawCheck.message || "");

    if (openClawCheck.level !== "fail" && message.includes("已安装")) {
      wizardState.installStatus = "已安装";
      updateStatusCard(openClawStatus, "已安装", "pass");
      wizardState.openClawVersion = extractVersion(message);
    } else if (openClawCheck.level === "fail" || message.includes("未安装") || message.includes("未检测到")) {
      wizardState.installStatus = "未安装";
      updateStatusCard(openClawStatus, "未安装", "fail");
    }
  }
}

function syncInstallStatus(result) {
  if (result.success) {
    wizardState.installStatus = "已安装";
    updateStatusCard(environmentStatus, "通过", "pass");
    updateStatusCard(openClawStatus, "已安装", "pass");

    if (result.version) {
      wizardState.openClawVersion = result.version;
    }
    return;
  }

  const wasInstalled = wizardState.installStatus === "已安装";
  if (!wasInstalled) {
    wizardState.installStatus = "安装异常";
    updateStatusCard(openClawStatus, "安装异常", "fail");
  }
}

function syncVerifyStatus(report) {
  const checks = Array.isArray(report.checks) ? report.checks : [];
  const versionCheck = checks.find((check) => String(check.name || "").includes("OpenClaw 版本"));
  const configCheck = checks.find((check) => String(check.name || "").includes("配置文件"));

  if (versionCheck && versionCheck.ok) {
    updateStatusCard(openClawStatus, "已安装", "pass");
    wizardState.openClawVersion = versionCheck.message;
  }

  if (report.ok && configCheck && configCheck.ok && configCheck.level !== "warning") {
    wizardState.configStatus = "已配置";
    updateStatusCard(configStatus, "已配置", "pass");
  } else if (report.ok) {
    wizardState.configStatus = "待配置";
    updateStatusCard(configStatus, "待配置", "warning");
  } else {
    wizardState.configStatus = "配置异常";
    updateStatusCard(configStatus, "配置异常", "fail");
  }
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
  lastAction.textContent = value;
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
