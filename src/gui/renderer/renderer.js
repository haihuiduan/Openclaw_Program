// Renderer：一页式安装向导。只通过 preload 暴露的安全 API 调用主进程能力。
const lastAction = document.querySelector("#lastAction");
const compactStatusBar = document.querySelector(".compact-status-bar");
const recentStatusButton = document.querySelector("#recentStatusButton");
const recentStatusMenu = document.querySelector("#recentStatusMenu");
const environmentStatus = document.querySelector("#environmentStatus");
const openClawStatus = document.querySelector("#openClawStatus");
const configStatus = document.querySelector("#configStatus");
const versionStatus = document.querySelector("#versionStatus");
let consoleStatus = null;
const appStage = document.querySelector("#appStage");
const wizardTitle = document.querySelector("#wizardTitle");
const wizardDescription = wizardTitle && wizardTitle.nextElementSibling;
const aboutMenu = document.querySelector("#aboutMenu");
const sidebarMiniStatus = document.querySelector(".sidebar-mini-status span");
const sidebarMiniVersion = document.querySelector(".sidebar-mini-status strong");
const appearanceButton = document.querySelector("#appearanceButton");
const appearanceMenu = document.querySelector("#appearanceMenu");
const appearanceModeLabel = document.querySelector("#appearanceModeLabel");
const homeButton = document.querySelector("#homeButton");
const sidebarButtons = [...document.querySelectorAll("[data-page]")];
const wizardProgress = document.querySelector("#wizardProgress");
const wizardCard = document.querySelector("#wizardCard");
const wizardActions = document.querySelector("#wizardActions");
const wizardUtilities = document.querySelector("#wizardUtilities");

const steps = [
  { id: "prepare", label: "准备 OpenClaw" },
  { id: "configure", label: "配置 API Key" },
  { id: "verify", label: "检查配置" },
  { id: "dashboard", label: "打开控制台" }
];

const wizardState = {
  currentPage: "home",
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
  updateNoticeDismissed: false,
  updateCheckStatus: "idle",
  toolboxNotice: null,
  toolboxDoctorReport: null,
  appearanceMode: "system"
};

setupCompactStatusBar();
applyAppearanceMode();

if (window.openClawInstaller) {
  appStage.textContent = window.openClawInstaller.stage;
}

if (appStage) {
  appStage.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleAboutMenu();
  });
}

if (aboutMenu) {
  aboutMenu.addEventListener("click", (event) => {
    event.stopPropagation();
  });
}

if (appearanceButton) {
  appearanceButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleAppearanceMenu();
  });
}

if (appearanceMenu) {
  for (const option of appearanceMenu.querySelectorAll("[data-theme-option]")) {
    option.addEventListener("click", () => setAppearanceMode(option.dataset.themeOption));
  }
}

for (const button of sidebarButtons) {
  button.addEventListener("click", () => {
    closeAppearanceMenu();
    navigateToPage(button.dataset.page);
  });
}

if (recentStatusButton) {
  recentStatusButton.addEventListener("click", toggleRecentStatusMenu);
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeAppearanceMenu();
    closeAboutMenu();
  }
});

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

  if (appearanceMenu && appearanceButton && !appearanceMenu.hidden) {
    if (!appearanceMenu.contains(event.target) && !appearanceButton.contains(event.target)) {
      closeAppearanceMenu();
    }
  }
});

renderWizard();
probeStartupState();

function renderWizard() {
  syncConsoleStatus();
  syncHomeChromeState();
  updateWizardHeading();
  renderProgress();
  renderCurrentStep();
  renderUtilities();
  updateSidebarState();
  updateHomeButtonState();
}

function syncHomeChromeState() {
  document.body.classList.toggle("is-home-dashboard", wizardState.currentPage === "home" && wizardState.currentStep === 0);
}

function toggleAppearanceMenu() {
  if (!appearanceMenu || !appearanceButton) {
    return;
  }

  const shouldOpen = appearanceMenu.hidden;
  appearanceMenu.hidden = !shouldOpen;
  appearanceButton.setAttribute("aria-expanded", shouldOpen ? "true" : "false");

  if (shouldOpen) {
    closeAboutMenu();
    syncAppearanceMenu();
  }
}

function closeAppearanceMenu() {
  if (!appearanceMenu || !appearanceButton) {
    return;
  }

  appearanceMenu.hidden = true;
  appearanceButton.setAttribute("aria-expanded", "false");
}

function setAppearanceMode(mode) {
  wizardState.appearanceMode = ["system", "light", "dark"].includes(mode) ? mode : "system";
  applyAppearanceMode();
  closeAppearanceMenu();
}

function applyAppearanceMode() {
  document.body.dataset.theme = wizardState.appearanceMode;

  if (appearanceModeLabel) {
    appearanceModeLabel.textContent = getAppearanceModeLabel(wizardState.appearanceMode);
  }

  syncAppearanceMenu();
}

function syncAppearanceMenu() {
  if (!appearanceMenu) {
    return;
  }

  for (const option of appearanceMenu.querySelectorAll("[data-theme-option]")) {
    const isActive = option.dataset.themeOption === wizardState.appearanceMode;
    option.classList.toggle("active", isActive);
    option.textContent = (isActive ? "✓ " : "") + getAppearanceOptionText(option.dataset.themeOption);
  }
}

function getAppearanceModeLabel(mode) {
  if (mode === "light") {
    return "浅色";
  }

  if (mode === "dark") {
    return "深色";
  }

  return "跟随系统";
}

function getAppearanceOptionText(mode) {
  if (mode === "light") {
    return "浅色模式";
  }

  if (mode === "dark") {
    return "深色模式";
  }

  return "跟随系统";
}

function setupCompactStatusBar() {
  const configLabel = configStatus && configStatus.previousElementSibling;

  if (configLabel) {
    configLabel.textContent = "API Key";
  }

  const recentLabel = recentStatusButton && recentStatusButton.querySelector(".status-label");

  if (recentLabel) {
    recentLabel.textContent = "最近操作";
  }

  hideStatusItem(environmentStatus, "after");
  hideStatusItem(versionStatus, "after");
  ensureConsoleStatusItem();
}

function hideStatusItem(valueElement, separatorDirection) {
  const item = valueElement && valueElement.closest(".status-item");

  if (!item) {
    return;
  }

  item.classList.add("is-hidden-status");
  const separator = separatorDirection === "before" ? item.previousElementSibling : item.nextElementSibling;

  if (separator && separator.classList.contains("status-separator")) {
    separator.classList.add("is-hidden-status");
  }
}

function ensureConsoleStatusItem() {
  if (!compactStatusBar || consoleStatus) {
    return;
  }

  const recentItem = recentStatusButton && recentStatusButton.closest(".status-item");

  if (!recentItem) {
    return;
  }

  const separator = document.createElement("span");
  separator.className = "status-separator console-status-separator";
  separator.textContent = "·";

  const item = document.createElement("span");
  item.className = "status-item status-neutral console-status-item";

  const label = document.createElement("span");
  label.className = "status-label";
  label.textContent = "控制台";

  consoleStatus = document.createElement("strong");
  consoleStatus.id = "consoleStatus";
  consoleStatus.textContent = "未运行";

  item.append(label, consoleStatus);
  compactStatusBar.insertBefore(separator, recentItem);
  compactStatusBar.insertBefore(item, recentItem);
}

function syncConsoleStatus() {
  if (!consoleStatus) {
    return;
  }

  if (wizardState.dashboardStatus === "opened") {
    updateStatusCard(consoleStatus, "运行中", "pass");
    return;
  }

  if (wizardState.dashboardStatus === "starting") {
    updateStatusCard(consoleStatus, "启动中", "running");
    return;
  }

  if (wizardState.dashboardStatus === "stopping") {
    updateStatusCard(consoleStatus, "停止中", "running");
    return;
  }

  if (wizardState.dashboardStatus === "failed") {
    updateStatusCard(consoleStatus, "未运行", "warning");
    return;
  }

  updateStatusCard(consoleStatus, "未运行", "neutral");
}

function updateWizardHeading() {
  if (!wizardTitle || !wizardDescription) {
    return;
  }

  if (wizardState.currentPage === "home" && wizardState.currentStep === 0) {
    const homeState = getHomeState();

    if (homeState === "ready") {
      wizardTitle.textContent = "OpenClaw 已准备好";
      wizardDescription.textContent = "适用于 macOS 的 OpenClaw 安装、配置与控制台管理工具。";
      return;
    }

    if (homeState === "installed-unconfigured") {
      wizardTitle.textContent = "OpenClaw 已安装，还需要配置 API Key";
      wizardDescription.textContent = "你的电脑已经安装了 OpenClaw。下一步需要配置 AI 服务商和 API Key，配置完成后即可启动控制台。";
      return;
    }
  }

  if (wizardState.currentPage === "configure") {
    wizardTitle.textContent = "配置 API Key";
    wizardDescription.textContent = "用于新配置或更换 API Key。配置完成后，工具箱会重新检查 OpenClaw 是否可用。";
    return;
  }

  if (wizardState.currentPage === "troubleshoot") {
    wizardTitle.textContent = "问题排查";
    wizardDescription.textContent = "这里收纳诊断、日志、官方配置向导和更新检查等高级操作。";
    return;
  }

  if (wizardState.currentPage === "settings") {
    wizardTitle.textContent = "设置";
    wizardDescription.textContent = "更多偏好设置将在后续版本中提供。";
    return;
  }

  wizardTitle.textContent = "开始使用 OpenClaw";
  wizardDescription.textContent = "按提示完成 OpenClaw 准备、API Key 配置和控制台启动。首次使用通常只需要几分钟。";
}

function renderProgress() {
  wizardProgress.replaceChildren();

  if (wizardState.currentPage !== "home" || wizardState.currentStep === 0) {
    wizardProgress.hidden = true;
    return;
  }

  wizardProgress.hidden = false;

  const activeIndex = wizardState.currentStep - 1;

  for (const [index, step] of steps.entries()) {
    const item = document.createElement("div");
    item.className = "wizard-step";

    if (index < activeIndex) {
      item.classList.add("completed");
    }

    if (index === activeIndex) {
      item.classList.add("active");
    }

    const dot = document.createElement("span");
    dot.className = "wizard-step-dot";
    dot.textContent = index < activeIndex ? "✓" : String(index + 1);

    const label = document.createElement("span");
    label.textContent = step.label;

    item.append(dot, label);
    wizardProgress.appendChild(item);
  }
}

function renderCurrentStep() {
  wizardCard.replaceChildren();
  wizardActions.replaceChildren();

  if (wizardState.currentPage !== "home") {
    renderPage();
    return;
  }

  if (wizardState.currentStep === 0) {
    renderWelcomeStep();
    return;
  }

  const stepId = steps[wizardState.currentStep - 1].id;

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

function renderPage() {
  if (wizardState.currentPage === "configure") {
    renderStandaloneConfigurePage();
    return;
  }

  if (wizardState.currentPage === "troubleshoot") {
    renderTroubleshootPage();
    return;
  }

  if (wizardState.currentPage === "settings") {
    renderSettingsPage();
    return;
  }

  renderWelcomeStep();
}

function renderStandaloneConfigurePage() {
  wizardState.configureMode = wizardState.configureMode || "first";

  if (wizardState.installStatus !== "已安装") {
    renderOpenClawRequiredPage({ includeRecheck: true });
    return;
  }

  const card = createCard(wizardState.configureMode === "reconfigure" ? "重新配置 API Key" : "配置 API Key", "选择服务商、填写 API Key，并选择模型。");
  card.classList.add("toolbox-page-card", "configure-page-card");
  card.appendChild(createQuickConfigureForm());
  wizardCard.appendChild(card);

}

function renderOpenClawRequiredPage(options = {}) {
  const card = createCard("需要先准备 OpenClaw", "当前未检测到 OpenClaw。请先完成 OpenClaw 准备步骤，然后再配置 API Key。工具箱会调用 OpenClaw 官方安装器完成准备。大多数情况下，你不需要手动安装 Node.js、npm 或 Git。");
  card.classList.add("toolbox-page-card");
  wizardCard.appendChild(card);

  addAction("去准备 OpenClaw", () => goToStep(1), "primary");

  if (options.includeRecheck) {
    addAction("重新检查", probeStartupState, "secondary");
  } else {
    addAction("返回首页", handleGoHome, "secondary");
  }

  addAction("打开问题排查", () => navigateToPage("troubleshoot"), "secondary");
}

function isOpenClawMissingMessage(message) {
  return /未检测到 OpenClaw|openclaw not found|command not found|请先执行一键安装|请先运行 install|OpenClaw 命令/.test(String(message || ""));
}

function renderStatusPage() {
  const page = document.createElement("div");
  page.className = "toolbox-page-grid";

  page.appendChild(createInfoCard("当前状态", [
    ["OpenClaw", wizardState.installStatus],
    ["控制台", getConsoleStatusLabel()],
    ["配置状态", wizardState.configStatus],
    ["当前模型", getConfiguredModelLabel()]
  ]));

  page.appendChild(createActionCard("控制台管理", "启动、停止控制台，或重新检查当前状态。", [
    ["启动控制台", openDashboard, "primary"],
    ["停止控制台", stopDashboard, "secondary"],
    ["重新检查状态", runStatusCheck, "secondary"]
  ], appendDashboardNotice));

  page.appendChild(createInfoCard("最近状态", [
    ["最近一次检查", wizardState.lastVerifyReport ? "已检查" : "尚未检查"],
    ["最近一次配置", getConfiguredAtLabel()],
    ["当前服务商", formatProviderLabel(getConfiguredProviderLabel())],
    ["当前版本", wizardState.openClawVersion || "未知"]
  ]));

  wizardCard.appendChild(page);
}

function renderTroubleshootPage() {
  const page = document.createElement("div");
  page.className = "toolbox-page-stack";

  const actions = document.createElement("div");
  actions.className = "toolbox-page-grid";
  actions.appendChild(createTroubleshootCommonActionsCard());
  actions.appendChild(createActionCard("控制台维护", "控制 OpenClaw 控制台的启动和停止。", [
    ["启动控制台", openDashboard, "primary"],
    ["停止控制台", stopDashboard, "secondary"]
  ], appendDashboardNotice));
  actions.appendChild(createActionCard("高级操作", "需要手动排查时使用。", [
    ["官方配置向导", openAdvancedConfigure, "secondary"],
    ["查看最近日志", openLogs, "secondary"]
  ]));
  page.appendChild(actions);

  page.appendChild(createInfoCard("检测结果", [
    ["Node.js", getDoctorCheckLabel("Node.js")],
    ["npm", getDoctorCheckLabel("npm")],
    ["Git", getDoctorCheckLabel("git")],
    ["OpenClaw", wizardState.installStatus === "已安装" ? "正常" : "未安装"],
    ["OpenClaw 配置", getTroubleshootConfigLabel()],
    ["GUI 配置确认", hasGuiConfigState() ? "正常" : "待确认"],
    ["控制台状态", getConsoleStatusLabel()]
  ]));

  page.appendChild(createInfoCard("基础组件诊断说明", [
    ["Node.js", "官方安装器通常会自动处理；若安装失败，可在这里查看状态。"],
    ["npm", "通常随 Node.js 一起安装；若安装失败，可在这里查看状态。"],
    ["Git", "安装过程可能会用到 Git 或相关开发者工具；若安装失败，可尝试安装 Command Line Tools。"]
  ]));

  const technical = document.createElement("details");
  technical.className = "toolbox-technical-card";
  const summary = document.createElement("summary");
  summary.textContent = "技术信息";
  const body = createKeyValueList([
    ["OpenClaw 版本", wizardState.openClawVersion || "未知"],
    ["日志目录", "~/.openclaw-installer/logs/"],
    ["配置状态文件", "~/.openclaw-installer/config-state.json"],
    ["安装助手命令", "openclaw-installer"],
    ["OpenClaw 命令", "openclaw"],
    ["最近一次错误", getRecentErrorSummary()]
  ]);
  technical.append(summary, body);
  page.appendChild(technical);

  wizardCard.appendChild(page);
}

function createInfoPanel(titleText, items) {
  const card = createCard(titleText, "");
  card.classList.add("toolbox-page-card", "toolbox-info-panel");
  card.appendChild(createList(items, "toolbox-info-list"));
  return card;
}

function createInfoCard(titleText, rows) {
  const card = createCard(titleText, "");
  card.classList.add("toolbox-page-card");
  card.appendChild(createKeyValueList(rows));
  return card;
}

function createActionCard(titleText, descriptionText, actions, appendExtra) {
  const card = createCard(titleText, descriptionText);
  card.classList.add("toolbox-page-card", "toolbox-action-card");

  if (appendExtra) {
    appendExtra(card);
  }

  const actionRow = document.createElement("div");
  actionRow.className = "toolbox-card-actions";

  for (const [label, handler, kind] of actions) {
    actionRow.appendChild(createButton(label, handler, kind || "secondary"));
  }

  card.appendChild(actionRow);
  return card;
}

function createTroubleshootCommonActionsCard() {
  const card = createCard("常用修复操作", "重新检查基础环境、配置和更新状态。");
  card.classList.add("toolbox-page-card", "toolbox-action-card");

  const actionRow = document.createElement("div");
  actionRow.className = "toolbox-card-actions";
  actionRow.appendChild(createButton("重新检查环境", rerunEnvironmentCheck, "primary"));
  actionRow.appendChild(createButton("检查配置", runStatusCheck, "secondary"));
  actionRow.appendChild(createTroubleshootUpdateButton());
  card.appendChild(actionRow);

  const feedback = createUpdateCheckFeedback(wizardState.versionInfo || {});
  if (feedback) {
    feedback.classList.add("toolbox-update-feedback");
    card.appendChild(feedback);
  }

  return card;
}

function createTroubleshootUpdateButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "secondary-action-button toolbox-update-button";
  button.disabled = wizardState.updateCheckStatus === "checking";
  button.textContent = wizardState.updateCheckStatus === "checking" ? "检查中..." : "检查更新";

  if (wizardState.updateCheckStatus === "checking") {
    const spinner = document.createElement("span");
    spinner.className = "about-update-spinner";
    spinner.setAttribute("aria-hidden", "true");
    button.prepend(spinner);
  }

  button.addEventListener("click", checkUpdateFromTroubleshoot);
  return button;
}

function getDoctorCheckLabel(pattern) {
  const report = wizardState.toolboxDoctorReport || wizardState.lastDoctorReport;
  const checks = report && Array.isArray(report.checks) ? report.checks : [];
  const found = checks.find((check) => String(check.name || "").toLowerCase().includes(String(pattern).toLowerCase()));

  if (!found) {
    return "未检测";
  }

  if (found.level === "fail") {
    return "异常";
  }

  if (found.level === "warning") {
    return "待确认";
  }

  return "正常";
}

function getTroubleshootConfigLabel() {
  if (wizardState.configStatus === "已配置") {
    return "正常";
  }

  if (wizardState.configStatus === "待确认") {
    return "待确认";
  }

  if (wizardState.configStatus === "配置异常") {
    return "异常";
  }

  return "待配置";
}

function getRecentErrorSummary() {
  const recentError = wizardState.recentActions.find((item) => /失败|异常|需要处理/.test(item));
  return recentError || "暂无";
}

function renderSettingsPage() {
  const card = createCard("设置", "更多偏好设置将在后续版本中提供。");
  card.appendChild(createNotice("当前版本暂不需要额外设置。", "info"));
  wizardCard.appendChild(card);
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

  const homeState = getHomeState();

  if (homeState === "ready") {
    renderToolboxHome();
    return;
  }

  if (homeState === "installed-unconfigured") {
    renderInstalledUnconfiguredHome();
    return;
  }

  renderNewUserHome();
}

function renderNewUserHome() {
  const dashboard = document.createElement("div");
  dashboard.className = "home-dashboard home-dashboard-new-user first-run-home";

  const intro = document.createElement("section");
  intro.className = "first-run-guide-card";

  const eyebrow = document.createElement("p");
  eyebrow.className = "first-run-eyebrow";
  eyebrow.textContent = "首次准备";

  const title = document.createElement("h2");
  title.className = "home-hero-title";
  title.textContent = "欢迎使用 OpenClaw 工具箱";

  const description = document.createElement("p");
  description.className = "home-hero-description";
  description.textContent = "工具箱会帮助你准备 OpenClaw、配置 API Key，并打开控制台开始使用。";

  const statusRow = document.createElement("div");
  statusRow.className = "first-run-status-row";
  statusRow.append(
    createHomeTag("OpenClaw", "未安装", "neutral"),
    createHomeTag("API Key", "待配置", "warning"),
    createHomeTag("控制台", "未启动", "neutral")
  );

  const actionPanel = document.createElement("div");
  actionPanel.className = "first-run-action-panel";

  const actionTitle = document.createElement("h3");
  actionTitle.textContent = "开始准备 OpenClaw";

  const actionDescription = document.createElement("p");
  actionDescription.textContent = "当前未检测到 OpenClaw。点击下方按钮后，工具箱会调用 OpenClaw 官方安装器完成准备。官方安装器会检查必要的运行环境。";

  const actionRow = document.createElement("div");
  actionRow.className = "first-run-action-row";
  actionRow.append(
    createButton("开始准备 OpenClaw", () => goToStep(1), "primary"),
    createButton("打开问题排查", () => navigateToPage("troubleshoot"), "secondary")
  );

  const helper = document.createElement("p");
  helper.className = "first-run-helper";
  helper.textContent = "大多数情况下，你不需要手动安装 Node.js、npm 或 Git。若安装失败，可以进入问题排查查看基础组件建议。";

  actionPanel.append(actionTitle, actionDescription, actionRow, helper);
  intro.append(eyebrow, title, description, statusRow, actionPanel);

  dashboard.appendChild(intro);
  dashboard.appendChild(createHomeRecentCard());
  wizardCard.appendChild(dashboard);
}

function renderInstalledUnconfiguredHome() {
  renderHomeDashboard({
    state: "installed-unconfigured",
    title: "OpenClaw 已安装，还需要配置 API Key",
    description: "下一步需要配置 AI 服务商和 API Key，配置完成后即可启动控制台。",
    tags: [
      ["OpenClaw", "已安装", "pass"],
      ["API Key", wizardState.configStatus === "待确认" ? "待确认" : "待配置", "warning"],
      ["控制台", "未启动", "neutral"]
    ],
    primaryLabel: "配置 API Key",
    primaryHandler: () => navigateToPage("configure")
  });
}

function renderToolboxHome() {
  renderHomeDashboard({
    state: "ready",
    title: "OpenClaw 已准备好",
    description: "你可以在控制台中使用 OpenClaw，也可以更换 API Key 或查看问题排查。",
    tags: [
      ["OpenClaw", "已安装", "pass"],
      ["API Key", "已配置", "pass"],
      ["控制台", getConsoleStatusLabel(), wizardState.dashboardStatus === "opened" ? "pass" : "neutral"],
      ["当前模型", getConfiguredModelLabel(), "neutral"]
    ]
  });
}

function renderHomeDashboard(options) {
  const dashboard = document.createElement("div");
  dashboard.className = "home-dashboard home-dashboard-" + options.state;

  const hero = document.createElement("div");
  hero.className = "home-hero";

  const content = document.createElement("div");
  content.className = "home-hero-content";

  const title = document.createElement("h2");
  title.className = "home-hero-title";
  title.textContent = options.title;

  const description = document.createElement("p");
  description.className = "home-hero-description";
  description.textContent = options.description;

  const tags = document.createElement("div");
  tags.className = "home-tag-row";
  for (const [label, value, state] of options.tags) {
    tags.appendChild(createHomeTag(label, value, state));
  }

  content.append(title, description, tags);

  if (options.primaryLabel) {
    const actions = document.createElement("div");
    actions.className = "home-hero-actions";
    actions.appendChild(createButton(options.primaryLabel, options.primaryHandler, "primary"));

    for (const [label, handler] of options.heroActions || []) {
      actions.appendChild(createButton(label, handler, "secondary"));
    }

    hero.append(content, actions);
  } else {
    hero.appendChild(content);
  }

  dashboard.appendChild(hero);
  dashboard.appendChild(createHomeCardGrid(options.state));
  dashboard.appendChild(createHomeRecentCard());
  wizardCard.appendChild(dashboard);
}

function createHomeTag(label, value, state) {
  const tag = document.createElement("span");
  tag.className = "home-tag home-tag-" + (state || "neutral");
  tag.textContent = label + " " + value;
  return tag;
}

function createHomeCardGrid(homeState) {
  const grid = document.createElement("div");
  grid.className = "home-dashboard-grid home-dashboard-grid-" + homeState;

  grid.appendChild(createDashboardCard({
    title: "OpenClaw",
    status: getOpenClawCardStatus(homeState),
    detail: getOpenClawCardDetail(homeState),
    meta: "命令：openclaw",
    state: homeState === "new-user" ? "neutral" : "pass"
  }));

  grid.appendChild(homeState === "ready"
    ? createConsoleDashboardCard()
    : createDashboardCard({
      title: "控制台状态",
      status: getConsoleStatusLabel(),
      detail: getConsoleCardDetail(),
      state: getConsoleCardState()
    }));

  if (homeState === "ready") {
    grid.appendChild(createAiConfigurationCard());
    grid.appendChild(createDashboardCard({
      title: "安全须知",
      status: "本地安全",
      detail: "本工具不会保存、展示或记录你的 API Key。",
      meta: "配置过程调用 OpenClaw 官方命令完成",
      state: "neutral"
    }));
    return grid;
  }

  grid.appendChild(createDashboardCard({
    title: "API Key",
    status: getApiKeyCardStatus(homeState),
    detail: homeState === "ready" ? "AI 服务商已配置" : "需要配置 AI 服务商",
    state: homeState === "ready" ? "pass" : "warning"
  }));

  grid.appendChild(createDashboardCard({
    title: "当前模型",
    status: homeState === "new-user" ? "待配置" : getConfiguredModelLabel(),
    detail: "服务商：" + getHomeProviderLabel(homeState),
    meta: homeState === "ready" ? "模型标签" : "配置后可使用",
    state: homeState === "ready" ? "pass" : "neutral"
  }));

  grid.appendChild(createDashboardCard({
    title: "配置入口",
    status: homeState === "ready" ? "可调整" : "待完成",
    detail: homeState === "ready" ? "可更换 API Key 或检查配置" : "完成准备后配置 API Key",
    state: homeState === "ready" ? "pass" : "warning",
    actions: [
      [homeState === "ready" ? "更换 API Key" : "配置 API Key", () => navigateToPage("configure", { mode: homeState === "ready" ? "reconfigure" : "first" })],
      ["检查配置", runStatusCheck]
    ]
  }));

  grid.appendChild(createDashboardCard({
    title: "安全须知",
    status: "本地安全",
    detail: "本工具不会保存、展示或记录你的 API Key。",
    meta: "配置过程调用 OpenClaw 官方命令完成",
    state: "neutral"
  }));

  return grid;
}

function createConsoleDashboardCard() {
  const pending = wizardState.dashboardStatus === "starting" || wizardState.dashboardStatus === "stopping";
  const isRunning = wizardState.dashboardStatus === "opened";
  let actionLabel = isRunning ? "停止控制台" : "启动控制台";
  let actionHandler = isRunning ? stopDashboard : openDashboard;

  if (wizardState.dashboardStatus === "starting") {
    actionLabel = "启动中...";
    actionHandler = null;
  } else if (wizardState.dashboardStatus === "stopping") {
    actionLabel = "停止中...";
    actionHandler = null;
  }

  return createDashboardCard({
    title: "控制台状态",
    status: getConsoleStatusLabel(),
    detail: getConsoleCardDetail(),
    state: getConsoleCardState(),
    buttons: [
      {
        label: actionLabel,
        handler: actionHandler,
        kind: isRunning || wizardState.dashboardStatus === "stopping" ? "danger" : "primary",
        pending
      },
      {
        label: "刷新状态",
        handler: runStatusCheck,
        kind: "secondary"
      }
    ]
  });
}

function createAiConfigurationCard() {
  return createDashboardCard({
    title: "AI 配置",
    status: "API Key 已配置",
    detail: "服务商：" + getHomeProviderLabel("ready"),
    meta: "当前模型：" + getConfiguredModelLabel(),
    state: "pass",
    actions: [
      ["更换 API Key", () => navigateToPage("configure", { mode: "reconfigure" })],
      ["检查配置", runStatusCheck]
    ]
  });
}

function createDashboardCard(options) {
  const card = document.createElement("section");
  card.className = "dashboard-card dashboard-card-" + (options.state || "neutral");

  const heading = document.createElement("div");
  heading.className = "dashboard-card-heading";
  heading.textContent = options.title;

  const status = document.createElement("strong");
  status.className = "dashboard-card-status";
  status.textContent = options.status;

  const detail = document.createElement("p");
  detail.className = "dashboard-card-detail";
  detail.textContent = options.detail;

  card.append(heading, status, detail);

  if (options.meta) {
    const meta = document.createElement("div");
    meta.className = "dashboard-card-meta";
    meta.textContent = options.meta;
    card.appendChild(meta);
  }

  if (options.actions) {
    const actions = document.createElement("div");
    actions.className = "dashboard-card-actions";
    for (const [label, handler] of options.actions) {
      actions.appendChild(createUtilityLink(label, handler));
    }
    card.appendChild(actions);
  }

  if (options.buttons) {
    const buttons = document.createElement("div");
    buttons.className = "dashboard-card-buttons";

    for (const action of options.buttons) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "dashboard-card-button dashboard-card-button-" + (action.kind || "secondary");
      button.disabled = Boolean(action.pending);

      if (action.pending) {
        const spinner = document.createElement("span");
        spinner.className = "about-update-spinner";
        spinner.setAttribute("aria-hidden", "true");
        button.appendChild(spinner);
      }

      button.appendChild(document.createTextNode(action.label));
      if (action.handler) {
        button.addEventListener("click", action.handler);
      }
      buttons.appendChild(button);
    }

    card.appendChild(buttons);
  }

  return card;
}

function createHomeRecentCard() {
  const card = document.createElement("section");
  card.className = "home-recent-card";

  const header = document.createElement("div");
  header.className = "home-recent-header";

  const title = document.createElement("strong");
  title.textContent = "最近操作";

  header.appendChild(title);
  card.appendChild(header);

  const list = document.createElement("ol");
  list.className = "home-recent-list";

  const recentActions = getEffectiveRecentActions(5);

  if (!recentActions.length) {
    const empty = document.createElement("li");
    empty.className = "home-recent-empty";
    empty.textContent = "暂无最近操作";
    list.appendChild(empty);
  } else {
    for (const action of recentActions) {
      const item = document.createElement("li");
      item.className = "home-recent-item";
      item.textContent = action;
      list.appendChild(item);
    }
  }

  card.appendChild(list);
  return card;
}

function getOpenClawCardStatus(homeState) {
  return homeState === "new-user" ? "未安装" : "已安装";
}

function getOpenClawCardDetail(homeState) {
  if (homeState === "new-user") {
    return "等待准备 OpenClaw";
  }

  return wizardState.openClawVersion ? "版本：" + wizardState.openClawVersion : "版本：未知";
}

function getApiKeyCardStatus(homeState) {
  if (homeState === "ready") {
    return "已配置";
  }

  return homeState === "installed-unconfigured" ? "待配置" : "未配置";
}

function getConsoleCardDetail() {
  if (wizardState.dashboardStatus === "opened") {
    return wizardState.dashboardMessage || "Dashboard 已运行";
  }

  if (wizardState.dashboardStatus === "starting") {
    return wizardState.dashboardMessage || "正在启动 OpenClaw 控制台";
  }

  if (wizardState.dashboardStatus === "stopping") {
    return wizardState.dashboardMessage || "正在停止 OpenClaw 控制台";
  }

  if (wizardState.dashboardStatus === "failed") {
    return wizardState.dashboardMessage || "控制台暂未启动";
  }

  return "Dashboard 尚未启动";
}

function getConsoleCardState() {
  if (wizardState.dashboardStatus === "opened") {
    return "pass";
  }

  if (wizardState.dashboardStatus === "failed") {
    return "fail";
  }

  if (wizardState.dashboardStatus === "starting" || wizardState.dashboardStatus === "stopping") {
    return "warning";
  }

  return "neutral";
}

function getConsoleStatusLabel() {
  if (wizardState.dashboardStatus === "opened") {
    return "运行中";
  }

  if (wizardState.dashboardStatus === "starting") {
    return "启动中";
  }

  if (wizardState.dashboardStatus === "stopping") {
    return "停止中";
  }

  return "未启动";
}

function getHomeProviderLabel(homeState) {
  if (homeState !== "ready") {
    return "待配置";
  }

  return formatProviderLabel(getConfiguredProviderLabel());
}

function formatProviderLabel(provider) {
  const map = {
    openrouter: "OpenRouter",
    openai: "OpenAI",
    deepseek: "DeepSeek",
    gemini: "Gemini",
    qwen: "Qwen / 通义千问"
  };
  const key = String(provider || "").toLowerCase();
  return map[key] || provider || "未知";
}

function renderPrepareStep() {
  const card = createCard("正在准备 OpenClaw", "工具箱正在检查环境并安装 OpenClaw，请稍候。");
  card.appendChild(createParagraph("工具箱会调用 OpenClaw 官方安装器准备 OpenClaw。大多数情况下，你不需要手动处理 Node.js、npm 或 Git；如果准备失败，可以进入问题排查查看建议。"));

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

}

function renderVerifyStep() {
  const card = createCard("检查配置", "工具箱会确认 OpenClaw 是否可以正常调用模型。");

  if (wizardState.verifyStatus === "通过") {
    card.appendChild(createNotice("配置完成。OpenClaw 已经可以使用。你现在可以打开控制台开始使用。", "pass"));
  } else if (wizardState.verifyStatus === "失败") {
    card.appendChild(createNotice("配置未通过。可能是 API Key 填写错误、当前模型不可用、网络连接不稳定，或服务商暂时无法访问。", "fail"));
  } else {
    card.appendChild(createNotice("完成配置后，请检查 OpenClaw 是否可以正常使用。", "info"));
  }

  wizardCard.appendChild(card);
  addBackAction();

  if (wizardState.verifyStatus === "通过") {
    addAction("打开控制台", openDashboardFromConfigResult, "primary");
    addAction("返回首页", handleGoHome, "secondary");
    return;
  }

  if (wizardState.verifyStatus === "失败") {
    addAction("重新配置 API Key", () => goToConfigure("first"), "primary");
    addAction("打开问题排查", openLogs, "secondary");
    return;
  }

  addAction("开始检查", runVerifyStep, "primary");
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
  renderProgressCard("正在准备 OpenClaw", "工具箱正在检查环境并安装 OpenClaw，请稍候。", [
    "环境检测",
    "已安装检查",
    "准备目录",
    "下载官方 install.sh",
    "执行安装脚本",
    "验证安装结果"
  ]);

  try {
    const result = await window.openClawInstaller.runInstall();
    syncInstallStatus(result);

    if (result.success) {
      updateLastAction("OpenClaw 已安装");
      renderResultCard("OpenClaw 已准备好", "OpenClaw 已安装完成，下一步请配置 API Key。", "pass");
      await refreshVersionInfo({ renderHome: false });
      addAction("下一步：配置 API Key", () => goToConfigure("first"), "primary");
    } else {
      updateLastAction("准备失败");
      await renderPrepareFailure(result);
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

  if (!apiKey) {
    showApiKeyError(form);
    return;
  }

  clearApiKeyError(form);

  if (defaultModel === null) {
    showCustomModelError(form);
    return;
  }

  clearCustomModelError(form);

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

      if (isOpenClawMissingMessage(result.message)) {
        renderOpenClawRequiredPage({ includeRecheck: false });
        return;
      }

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

    const message = getErrorMessage(error);
    if (isOpenClawMissingMessage(message)) {
      renderOpenClawRequiredPage({ includeRecheck: false });
    } else {
      renderResultCard("快速配置失败", message, "fail");
    }
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
  renderProgressCard("正在检查配置", "工具箱正在确认 OpenClaw 是否可以正常调用模型。", [
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
      renderResultCard("配置完成", "OpenClaw 已经可以使用。你现在可以打开控制台开始使用。", "pass");
      await refreshVersionInfo({ renderHome: false });
      addAction("打开控制台", openDashboardFromConfigResult, "primary");
      addAction("返回首页", handleGoHome, "secondary");
    } else if (report.ok) {
      wizardState.pendingQuickConfigVerification = false;
      wizardState.pendingQuickConfigDetails = null;
      wizardState.verifyStatus = "失败";
      updateLastAction(verifySummary.hasConfigPath ? "待确认" : "待配置");
      renderVerifyFailureResult();
    } else {
      wizardState.verifyStatus = "失败";
      wizardState.configStatus = "配置异常";
      updateStatusCard(configStatus, "配置异常", "fail");
      updateLastAction("检查失败");
      renderVerifyFailureResult();
    }
  } catch (error) {
    wizardState.verifyStatus = "失败";
    updateStatusCard(configStatus, "配置异常", "fail");
    renderVerifyFailureResult(getErrorMessage(error));
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

async function openDashboardFromConfigResult() {
  if (wizardState.dashboardStatus === "starting") {
    return;
  }

  wizardState.dashboardStatus = "starting";
  wizardState.dashboardMessage = "正在启动 OpenClaw 控制台…";
  updateLastAction("正在启动控制台");
  syncConsoleStatus();
  renderConfigDashboardLaunchResult("正在启动 OpenClaw 控制台，请稍候。", "info");

  try {
    const result = await window.openClawInstaller.openDashboard();

    if (result.ok) {
      wizardState.dashboardStatus = "opened";
      wizardState.dashboardMessage = result.message || "已尝试启动 OpenClaw 控制台，请在浏览器中继续使用。";
      updateLastAction("启动控制台");
      syncConsoleStatus();
      handleGoHome();
      return;
    }

    wizardState.dashboardStatus = "failed";
    wizardState.dashboardMessage = result.message || "控制台打开失败，请稍后重试，或进入问题排查看安装记录。";
    updateLastAction("控制台打开失败");
    syncConsoleStatus();
    renderConfigDashboardLaunchResult(wizardState.dashboardMessage, "fail");
  } catch (error) {
    wizardState.dashboardStatus = "failed";
    wizardState.dashboardMessage = getErrorMessage(error) || "控制台打开失败，请稍后重试，或进入问题排查看安装记录。";
    updateLastAction("控制台打开失败");
    syncConsoleStatus();
    renderConfigDashboardLaunchResult(wizardState.dashboardMessage, "fail");
  }
}

function renderConfigDashboardLaunchResult(message, state) {
  renderResultCard("配置完成", message, state || "pass");
  addAction("打开控制台", openDashboardFromConfigResult, "primary");
  addAction("返回首页", handleGoHome, "secondary");

  if (state === "fail") {
    addAction("问题排查", openLogs, "secondary");
  }
}

async function openDashboard() {
  if (wizardState.dashboardStatus === "starting") {
    return;
  }

  wizardState.dashboardStatus = "starting";
  wizardState.dashboardMessage = "正在启动 OpenClaw 控制台…";
  updateLastAction("正在启动控制台");
  syncConsoleStatus();
  renderDashboardFeedback();

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
  } catch (error) {
    wizardState.dashboardStatus = "failed";
    wizardState.dashboardMessage = getErrorMessage(error) || "控制台打开失败，请稍后重试，或进入问题排查看安装记录。";
    updateLastAction("控制台打开失败");
  } finally {
    syncConsoleStatus();
    renderDashboardFeedback();
  }
}

async function stopDashboard() {
  if (wizardState.dashboardStatus === "stopping") {
    return;
  }

  wizardState.dashboardStatus = "stopping";
  wizardState.dashboardMessage = "正在停止 OpenClaw 控制台…";
  updateLastAction("正在停止控制台");
  syncConsoleStatus();
  renderDashboardFeedback();

  try {
    const result = await window.openClawInstaller.stopDashboard();

    if (result.ok) {
      wizardState.dashboardStatus = "stopped";
      wizardState.dashboardMessage = result.message || "已停止 OpenClaw 控制台。";
      updateLastAction("停止控制台");
    } else {
      wizardState.dashboardStatus = "failed";
      wizardState.dashboardMessage = result.message || "控制台停止失败，请稍后重试，或进入问题排查看日志。";
      updateLastAction("控制台停止失败");
    }
  } catch (error) {
    wizardState.dashboardStatus = "failed";
    wizardState.dashboardMessage = getErrorMessage(error) || "控制台停止失败，请稍后重试，或进入问题排查看日志。";
    updateLastAction("控制台停止失败");
  } finally {
    syncConsoleStatus();
    renderDashboardFeedback();
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
      ["qwen", "Qwen / 通义千问"]
    ]),
    createInputField("API Key", "apiKey", "password", getProviderPlaceholder("openrouter"), "API Key 是必填项。它用于连接你选择的 AI 服务商，本工具不会保存或记录它。"),
    createModelSelectField("模型", "modelChoice", "openrouter"),
    createInputField("自定义模型名称", "customModel", "text", "例如 provider/model-name"),
    createParagraph("首次使用建议选择自动推荐模型。"),
  );

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
  apiKeyInput.addEventListener("input", () => clearApiKeyError(form));
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
    qwen: "请粘贴 Qwen / 通义千问 API Key"
  };

  return placeholders[provider] || "请粘贴服务商 API Key";
}

function getProviderLabel(provider) {
  const labels = {
    openrouter: "OpenRouter",
    deepseek: "DeepSeek",
    openai: "OpenAI",
    gemini: "Gemini",
    qwen: "Qwen / 通义千问"
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

function showApiKeyError(form) {
  const apiKeyField = form.elements.apiKey.closest(".quick-config-field");
  showFieldError(apiKeyField, "请先填写 API Key，否则无法完成配置。");
  form.elements.apiKey.focus();
}

function clearApiKeyError(form) {
  const apiKeyField = form.elements.apiKey.closest(".quick-config-field");
  clearFieldError(apiKeyField);
}

function showCustomModelError(form) {
  const customField = form.elements.customModel.closest(".quick-config-field");
  form.elements.modelChoice.value = "custom";
  updateCustomModelVisibility(form);
  form.elements.customModel.focus();

  const action = document.createElement("button");
  action.type = "button";
  action.className = "link-button inline-link-action";
  action.textContent = "改用自动推荐";
  action.addEventListener("click", () => useAutoModel(form));

  showFieldError(customField, "请输入自定义模型名称，或改用自动推荐。", action);
}

function clearCustomModelError(form) {
  const customField = form.elements.customModel.closest(".quick-config-field");
  clearFieldError(customField);
}

function showFieldError(field, message, action) {
  if (!field) {
    return;
  }

  clearFieldError(field);
  field.classList.add("has-error");

  const error = document.createElement("div");
  error.className = "field-error";

  const text = document.createElement("span");
  text.textContent = message;
  error.appendChild(text);

  if (action) {
    error.appendChild(action);
  }

  field.appendChild(error);
}

function clearFieldError(field) {
  if (!field) {
    return;
  }

  field.classList.remove("has-error");
  for (const error of field.querySelectorAll(".field-error")) {
    error.remove();
  }
}

function useAutoModel(form) {
  form.elements.modelChoice.value = "auto";
  form.elements.customModel.value = "";
  clearCustomModelError(form);
  updateCustomModelVisibility(form);
}

function createInputField(labelText, name, type, placeholder, helpText) {
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

  if (helpText) {
    const help = document.createElement("small");
    help.className = "field-help";
    help.textContent = helpText;
    label.appendChild(help);
  }

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

function renderVerifyFailureResult(extraMessage) {
  const description = extraMessage
    ? "配置未通过。" + extraMessage
    : "可能原因：API Key 填写错误、当前模型不可用、网络连接不稳定，或服务商暂时无法访问。";
  renderResultCard("配置未通过", description, "fail");
  addAction("重新配置 API Key", () => goToConfigure("first"), "primary");
  addAction("打开问题排查", openLogs, "secondary");
}

async function renderPrepareFailure(result) {
  const card = createCard(
    "准备 OpenClaw 失败",
    "OpenClaw 官方安装器没有完成安装。请先检查网络连接，然后重试。如果仍然失败，可以进入问题排查查看详细诊断。"
  );

  if (isNetworkInstallFailure(result)) {
    card.appendChild(createNotice("可能是网络连接或下载失败。请确认网络可用后重试。", "warning"));
  }

  const guidance = document.createElement("div");
  guidance.className = "configure-guide-note";
  guidance.appendChild(createPrepareFailureSection("可能原因", [
    "网络连接不可用，或无法访问 OpenClaw 官方安装源",
    "官方安装器下载失败",
    "系统权限或运行环境异常"
  ]));
  guidance.appendChild(createPrepareFailureSection("建议操作", [
    "确认网络连接正常",
    "重新点击“重试准备 OpenClaw”",
    "如果多次失败，再打开问题排查或查看基础组件建议"
  ]));
  card.appendChild(guidance);

  wizardCard.replaceChildren();
  wizardActions.replaceChildren();
  wizardCard.appendChild(card);
  addAction("重试准备 OpenClaw", runInstallStep, "primary");
  addAction("打开问题排查", () => navigateToPage("troubleshoot"), "secondary");
  addAction("查看基础组件建议", renderDependencyPreparationPage, "secondary");
}

function createPrepareFailureSection(title, items) {
  const section = document.createElement("div");
  section.className = "configure-guide-note-section";

  const heading = document.createElement("strong");
  heading.textContent = title;
  section.appendChild(heading);

  for (const item of items) {
    const row = document.createElement("p");
    row.textContent = "• " + item;
    section.appendChild(row);
  }

  return section;
}

function isNetworkInstallFailure(result) {
  const details = [
    result && result.finalMessage,
    result && result.error,
    ...((result && Array.isArray(result.steps)) ? result.steps.flatMap((step) => [
      step && step.message,
      step && step.error,
      step && step.finalMessage
    ]) : [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return [
    "network",
    "timeout",
    "enotfound",
    "econnreset",
    "econnrefused",
    "fetch failed",
    "curl",
    "could not resolve",
    "unable to download",
    "download failed",
    "install.sh 下载失败",
    "下载官方 install.sh 失败",
    "无法下载官方安装脚本",
    "下载失败"
  ].some((keyword) => details.includes(keyword));
}

function renderDependencyPreparationPage() {
  wizardCard.replaceChildren();
  wizardActions.replaceChildren();

  const card = createCard("基础组件准备", "OpenClaw 官方安装器通常会处理 Node.js、npm、Git。这里仅作为安装失败后的辅助诊断入口，不会静默安装系统组件、修改 PATH 或自动安装 Homebrew。");
  card.appendChild(createNotice("npm 通常随 Node.js 一起安装；Git 可通过 macOS Command Line Tools 准备。", "info"));
  wizardCard.appendChild(card);

  addAction("打开 Node.js 官方下载页", () => openExternalUrl("https://nodejs.org/zh-cn/download"), "secondary");
  addAction("准备 Git / Command Line Tools", () => copyText("xcode-select --install"), "secondary");
  addAction("重新检查环境", runDoctorStep, "secondary");
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
  renderAboutMenu();
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
    closeAppearanceMenu();
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

  const header = document.createElement("div");
  header.className = "about-menu-header";

  const title = document.createElement("div");
  title.className = "about-menu-title";
  title.textContent = "关于 OpenClaw 工具箱";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "about-menu-close";
  closeButton.setAttribute("aria-label", "关闭关于本工具");
  closeButton.textContent = "×";
  closeButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    closeAboutMenu();
  });

  header.append(title, closeButton);
  aboutMenu.appendChild(header);

  aboutMenu.appendChild(createAboutSectionTitle("版本与更新"));
  aboutMenu.appendChild(createAboutRow("OpenClaw 当前版本", version.currentVersion || wizardState.openClawVersion || "未知"));
  aboutMenu.appendChild(createAboutRow("OpenClaw 最新版本", latestVersion || "暂时无法检查"));
  aboutMenu.appendChild(createAboutRow("更新状态", updateState));

  const feedback = createUpdateCheckFeedback(version);
  if (feedback) {
    aboutMenu.appendChild(feedback);
  }

  const updateActions = document.createElement("div");
  updateActions.className = "about-menu-actions";
  const checkButton = createAboutButton(wizardState.updateCheckStatus === "checking" ? "检查中..." : "检查更新", checkUpdateFromAbout);
  checkButton.disabled = wizardState.updateCheckStatus === "checking";

  if (wizardState.updateCheckStatus === "checking") {
    const spinner = document.createElement("span");
    spinner.className = "about-update-spinner";
    spinner.setAttribute("aria-hidden", "true");
    checkButton.prepend(spinner);
  }

  updateActions.appendChild(checkButton);

  if (version.updateAvailable && !wizardState.updateNoticeDismissed) {
    updateActions.appendChild(createAboutButton("现在更新", () => {
      closeAboutMenu();
      runUpdateStep();
    }));
    updateActions.appendChild(createAboutButton("稍后再说", dismissUpdateNotice));
  }

  aboutMenu.appendChild(updateActions);

  aboutMenu.appendChild(createAboutSectionTitle("帮助入口"));
  const helpLinks = document.createElement("div");
  helpLinks.className = "about-menu-links";
  helpLinks.appendChild(createAboutLink("打开问题排查", () => {
    closeAboutMenu();
    navigateToPage("troubleshoot");
  }));
  aboutMenu.appendChild(helpLinks);

  const technical = document.createElement("details");
  technical.className = "about-technical";
  const summary = document.createElement("summary");
  summary.textContent = "技术信息";
  const commands = document.createElement("div");
  commands.className = "about-technical-body";
  commands.appendChild(createAboutRow("安装助手命令", "openclaw-installer"));
  commands.appendChild(createAboutRow("OpenClaw 命令", "openclaw"));
  commands.appendChild(createAboutRow("日志目录", "~/.openclaw-installer/logs/"));
  commands.appendChild(createAboutRow("配置状态文件", "~/.openclaw-installer/config-state.json"));
  technical.append(summary, commands);
  aboutMenu.appendChild(technical);
}

function createAboutSectionTitle(text) {
  const title = document.createElement("div");
  title.className = "about-menu-section-title";
  title.textContent = text;
  return title;
}

function createUpdateCheckFeedback(version) {
  if (wizardState.updateCheckStatus === "checking") {
    return createAboutFeedback("正在检查更新…", "info");
  }

  if (wizardState.updateCheckStatus === "latest") {
    return createAboutFeedback("已检查更新，当前已是最新版本。", "pass");
  }

  if (wizardState.updateCheckStatus === "available") {
    if (wizardState.updateNoticeDismissed) {
      return null;
    }

    const currentVersion = version.currentVersion || wizardState.openClawVersion || "未知";
    const latestVersion = version.latestVersion || "未知";
    return createAboutFeedback("发现新版本：" + currentVersion + " → " + latestVersion + "。可安装新版本。", "warning");
  }

  if (wizardState.updateCheckStatus === "failed") {
    return createAboutFeedback("暂时无法检查更新，不影响当前使用。", "fail");
  }

  return null;
}

function createAboutFeedback(message, state) {
  const feedback = document.createElement("div");
  feedback.className = "about-menu-feedback " + (state || "info");
  feedback.textContent = message;
  return feedback;
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
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    handler(event);
  });
  return button;
}

function createAboutLink(label, handler) {
  const button = createAboutButton(label, handler);
  button.classList.add("about-menu-link");
  return button;
}

async function checkUpdateFromAbout() {
  if (wizardState.updateCheckStatus === "checking") {
    return;
  }

  wizardState.updateCheckStatus = "checking";
  wizardState.updateNoticeDismissed = false;
  updateLastAction("正在检查更新");
  renderAboutMenu();

  try {
    const version = await refreshVersionInfo({ renderHome: false });

    if (!version || !version.canCheckLatest) {
      wizardState.updateCheckStatus = "failed";
      updateLastAction("检查更新失败");
    } else {
      wizardState.updateCheckStatus = version.updateAvailable ? "available" : "latest";
      updateLastAction("检查更新完成");
    }
  } catch (error) {
    wizardState.updateCheckStatus = "failed";
    updateLastAction("检查更新失败");
  }

  renderAboutMenu();
}

async function checkUpdateFromTroubleshoot() {
  if (wizardState.updateCheckStatus === "checking") {
    return;
  }

  wizardState.updateCheckStatus = "checking";
  wizardState.updateNoticeDismissed = false;
  updateLastAction("正在检查更新");
  renderWizard();

  try {
    const version = await refreshVersionInfo({ renderHome: false });

    if (!version || !version.canCheckLatest) {
      wizardState.updateCheckStatus = "failed";
      updateLastAction("检查更新失败");
    } else {
      wizardState.updateCheckStatus = version.updateAvailable ? "available" : "latest";
      updateLastAction("检查更新完成");
    }
  } catch (error) {
    wizardState.updateCheckStatus = "failed";
    updateLastAction("检查更新失败");
  }

  renderAboutMenu();
  if (wizardState.currentPage === "troubleshoot") {
    renderWizard();
  }
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
  if (wizardState.dashboardStatus === "starting") {
    card.appendChild(createNotice(wizardState.dashboardMessage || "正在启动 OpenClaw 控制台…", "info"));
  }

  if (wizardState.dashboardStatus === "opened") {
    card.appendChild(createNotice(wizardState.dashboardMessage || "已尝试启动 OpenClaw 控制台，请在浏览器中继续使用。", "pass"));
  }

  if (wizardState.dashboardStatus === "stopping") {
    card.appendChild(createNotice(wizardState.dashboardMessage || "正在停止 OpenClaw 控制台…", "info"));
  }

  if (wizardState.dashboardStatus === "failed") {
    card.appendChild(createNotice(wizardState.dashboardMessage || "控制台打开失败，请稍后重试，或进入问题排查看安装记录。", "fail"));
  }
}

function getDashboardButtonLabel() {
  return "启动控制台";
}

function renderDashboardFeedback() {
  if (wizardState.currentStep !== 0) {
    wizardState.currentStep = 4;
  }

  renderWizard();
}

function renderUtilities() {
  wizardUtilities.replaceChildren();
}

function createUtilityLink(label, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "link-button";
  button.textContent = label;
  button.disabled = isDashboardActionDisabled(label);
  button.addEventListener("click", handler);
  return button;
}

async function rerunEnvironmentCheck() {
  if (wizardState.currentPage === "home" && isReadyToUse() && wizardState.currentStep === 0) {
    return runToolboxDoctorCheck();
  }

  return runDoctorStep();
}

async function runToolboxDoctorCheck() {
  setBusy(true);
  wizardState.toolboxNotice = { message: "正在重新检查环境…", state: "info" };
  wizardState.toolboxDoctorReport = null;
  updateLastAction("重新检查环境");
  renderWizard();

  try {
    const report = await window.openClawInstaller.runDoctor();
    wizardState.lastDoctorReport = report;
    wizardState.toolboxDoctorReport = report;
    syncDoctorStatus(report);

    if (report.ok) {
      wizardState.environmentStatus = "正常";
      updateStatusCard(environmentStatus, "正常", "pass");
      wizardState.toolboxNotice = { message: "环境正常，这台 Mac 可以继续使用 OpenClaw。", state: "pass" };
      updateLastAction("环境检查正常");
    } else {
      wizardState.environmentStatus = "需要处理";
      updateStatusCard(environmentStatus, "需要处理", "fail");
      wizardState.toolboxNotice = { message: "环境需要处理，请查看下方提示。", state: "fail" };
      updateLastAction("环境需要处理");
    }
  } catch (error) {
    wizardState.toolboxNotice = { message: getErrorMessage(error), state: "fail" };
    updateLastAction("环境检查失败");
  } finally {
    setBusy(false);
    if (wizardState.currentStep === 0) {
      renderWizard();
    }
  }
}

function appendToolboxDiagnostics(card) {
  if (wizardState.toolboxNotice) {
    card.appendChild(createNotice(wizardState.toolboxNotice.message, wizardState.toolboxNotice.state));
  }

  if (!wizardState.toolboxDoctorReport || wizardState.toolboxDoctorReport.ok) {
    return;
  }

  const checks = Array.isArray(wizardState.toolboxDoctorReport.checks) ? wizardState.toolboxDoctorReport.checks : [];
  const visibleChecks = checks.filter((check) => check.level === "fail" || check.level === "warning");

  if (!visibleChecks.length) {
    return;
  }

  const list = document.createElement("div");
  list.className = "toolbox-diagnostics-list";

  for (const check of visibleChecks) {
    list.appendChild(createCheckCard(check));
  }

  card.appendChild(list);
}

async function runStatusCheck() {
  const returnPage = wizardState.currentPage;
  setBusy(true);
  updateLastAction("正在检查状态");
  renderProgressCard("正在检查状态", "工具箱正在检查 OpenClaw 安装、版本和配置状态。", [
    "检查 OpenClaw 命令",
    "读取 OpenClaw 版本",
    "检查配置状态"
  ]);

  try {
    await loadGuiConfigState();
    const report = await window.openClawInstaller.runVerify();
    wizardState.lastVerifyReport = report;
    syncVerifyStatus(report, { confirmConfig: hasGuiConfigState() });
    await refreshVersionInfo({ renderHome: false });
    updateLastAction(report.ok ? "状态检查完成" : "状态需要处理");
    renderResultCard(report.ok ? "状态检查完成" : "状态需要处理", report.ok ? "已完成 OpenClaw 基础状态检查。" : "请根据提示重新配置或进入问题排查。", report.ok ? "pass" : "warning");
    addAction(getStatusCheckReturnLabel(returnPage), () => navigateToPage(getStatusCheckReturnPage(returnPage)), "primary");
  } catch (error) {
    updateLastAction("状态检查失败");
    renderResultCard("状态检查失败", getErrorMessage(error), "fail");
    addAction(getStatusCheckReturnLabel(returnPage), () => navigateToPage(getStatusCheckReturnPage(returnPage)), "primary");
  } finally {
    setBusy(false);
  }
}

function getStatusCheckReturnPage(page) {
  return page === "troubleshoot" ? "troubleshoot" : "home";
}

function getStatusCheckReturnLabel(page) {
  return page === "troubleshoot" ? "返回问题排查" : "返回首页";
}

function getConfiguredAtLabel() {
  if (!wizardState.guiConfigState || !wizardState.guiConfigState.configuredAt) {
    return "尚未记录";
  }

  return wizardState.guiConfigState.configuredAt.slice(0, 10);
}

function getConfiguredProviderLabel() {
  return wizardState.guiConfigState && wizardState.guiConfigState.provider
    ? wizardState.guiConfigState.provider
    : "未知";
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
  button.disabled = wizardState.isBusy || isDashboardActionDisabled(label);
  button.addEventListener("click", handler);
  return button;
}

function isDashboardActionDisabled(label) {
  if (label === "启动控制台" || label === "打开控制台") {
    return wizardState.dashboardStatus === "starting";
  }

  if (label === "停止控制台") {
    return wizardState.dashboardStatus === "stopping";
  }

  return false;
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
  wizardState.currentPage = "home";
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
  navigateToPage("home");
}

function navigateToPage(page, options = {}) {
  if (wizardState.isBusy || wizardState.isProbingStartup) {
    updateLastAction("当前任务进行中");
    return;
  }

  wizardState.currentPage = page || "home";

  if (wizardState.currentPage === "home") {
    wizardState.currentStep = 0;
  }

  if (wizardState.currentPage === "configure") {
    wizardState.currentStep = 0;
    wizardState.configureMode = options.mode || (wizardState.configStatus === "已配置" ? "reconfigure" : "first");
  }

  closeAboutMenu();
  closeAppearanceMenu();
  renderWizard();
}

function goToStep(index) {
  wizardState.currentPage = "home";
  wizardState.currentStep = Math.max(0, Math.min(index, steps.length));
  renderWizard();
}

function setBusy(isBusy) {
  wizardState.isBusy = isBusy;
  for (const button of [...wizardActions.querySelectorAll("button"), ...wizardUtilities.querySelectorAll("button")]) {
    button.disabled = isBusy;
  }
  updateHomeButtonState();
  updateSidebarState();
}

function updateHomeButtonState() {
  if (!homeButton) {
    return;
  }

  homeButton.disabled = wizardState.isBusy || wizardState.isProbingStartup;
}

function updateSidebarState() {
  for (const button of sidebarButtons) {
    button.disabled = wizardState.isBusy || wizardState.isProbingStartup;
    button.classList.toggle("active", button.dataset.page === wizardState.currentPage);
  }

  updateSidebarMiniStatus();
}

function updateSidebarMiniStatus() {
  if (sidebarMiniStatus) {
    sidebarMiniStatus.textContent = getSidebarMiniStatusLabel();
  }

  if (sidebarMiniVersion) {
    sidebarMiniVersion.textContent = "v1.0.0";
  }
}

function getSidebarMiniStatusLabel() {
  if (wizardState.isBusy || wizardState.isProbingStartup) {
    return "检测中";
  }

  if (wizardState.environmentStatus === "需要处理" || wizardState.installStatus === "安装异常" || wizardState.configStatus === "配置异常" || wizardState.dashboardStatus === "failed") {
    return "需要处理";
  }

  if (wizardState.installStatus !== "已安装") {
    return "待准备";
  }

  if (wizardState.configStatus !== "已配置" || wizardState.verifyStatus !== "通过") {
    return "待配置";
  }

  if (wizardState.dashboardStatus === "opened") {
    return "控制台运行中";
  }

  return "工具箱正常";
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

function getHomeState() {
  if (wizardState.installStatus === "已安装" && wizardState.configStatus === "已配置" && wizardState.verifyStatus === "通过" && hasGuiConfigState()) {
    return "ready";
  }

  if (wizardState.installStatus === "已安装") {
    return "installed-unconfigured";
  }

  return "new-user";
}

function isReadyToUse() {
  return getHomeState() === "ready";
}

function isToolboxHome() {
  return wizardState.currentStep === 0 && isReadyToUse() && !wizardState.isProbingStartup;
}

function getConfiguredModelLabel() {
  if (!wizardState.guiConfigState) {
    return "自动推荐";
  }

  if (wizardState.guiConfigState.modelMode === "auto" || !wizardState.guiConfigState.model) {
    return "自动推荐";
  }

  return wizardState.guiConfigState.model;
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

function normalizeRecentAction(value) {
  const action = sanitizeActionSummary(value);
  const aliases = {
    "启动控制台": "控制台启动成功",
    "停止控制台": "控制台已停止",
    "配置完成": "API Key 配置完成",
    "检测完成": "环境检查完成",
    "环境检查正常": "环境检查完成",
    "状态检查完成": "状态检查完成",
    "检查更新完成": "检查更新完成",
    "检查配置通过": "检查配置通过",
    "OpenClaw 已安装": "OpenClaw 已安装",
    "OpenClaw 已更新": "OpenClaw 已更新"
  };

  return aliases[action] || action;
}

function isMeaningfulRecentAction(value) {
  if (!value || value === "尚未操作") {
    return false;
  }

  if (/正在|识别|检测中|识别中|准备中|待确认|待配置|尚未|已准备好|当前任务进行中/.test(value)) {
    return false;
  }

  return /完成|成功|通过|已停止|已启动|已配置|已安装|已更新/.test(value);
}

function getEffectiveRecentActions(limit) {
  return wizardState.recentActions
    .filter(isMeaningfulRecentAction)
    .slice(0, limit || 5);
}

function recordRecentAction(value) {
  const action = normalizeRecentAction(value);

  if (!isMeaningfulRecentAction(action)) {
    renderRecentStatusMenu();
    return;
  }

  if (wizardState.recentActions[0] !== action) {
    wizardState.recentActions.unshift(action);
  }

  wizardState.recentActions = getEffectiveRecentActions(5);
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

  const recentActions = getEffectiveRecentActions(5);

  if (!recentActions.length) {
    const empty = document.createElement("div");
    empty.className = "recent-status-empty";
    empty.textContent = "暂无最近操作";
    recentStatusMenu.appendChild(empty);
    return;
  }

  for (const action of recentActions) {
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
