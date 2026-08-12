const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");

const { projectPath } = require("./helpers");

function readRenderer() {
  return fs.readFileSync(projectPath("src/gui/renderer/renderer.js"), "utf8");
}

function readFile(relativePath) {
  return fs.readFileSync(projectPath(relativePath), "utf8");
}

function getFunctionBlock(source, functionName) {
  const start = source.indexOf(`function ${functionName}`);
  assert.notEqual(start, -1, `${functionName} should exist`);

  const signatureEnd = source.indexOf(")", start);
  const bodyStart = source.indexOf("{", signatureEnd);
  assert.notEqual(bodyStart, -1, `${functionName} body should exist`);

  let depth = 0;

  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  throw new Error(`${functionName} block not found`);
}

function loadApiKeyValidator() {
  const source = readRenderer();
  const snippet = [
    getFunctionBlock(source, "validateApiKey"),
    getFunctionBlock(source, "getMinimumApiKeyLength"),
    "validateApiKey"
  ].join("\n");

  return vm.runInNewContext(snippet);
}

test("问题排查页运行诊断不会绑定安装流程入口", () => {
  const source = readRenderer();
  const commonActions = source.slice(
    source.indexOf("function createTroubleshootCommonActionsCard"),
    source.indexOf("function createTroubleshootUpdateButton")
  );
  const diagnostics = getFunctionBlock(source, "runTroubleshootDiagnostics");

  assert.match(commonActions, /运行诊断/);
  assert.match(commonActions, /runTroubleshootDiagnostics/);
  assert.doesNotMatch(commonActions, /rerunEnvironmentCheck/);
  assert.doesNotMatch(commonActions, /runDoctorStep/);
  assert.doesNotMatch(commonActions, /runInstall/);
  assert.doesNotMatch(diagnostics, /runInstall|runInstallStep|goToStep\\(1\\)/);
});

test("运行诊断后仍停留在问题排查页面并只调用 doctor 路径", () => {
  const source = readRenderer();
  const diagnostics = getFunctionBlock(source, "runTroubleshootDiagnostics");
  const toolboxDoctor = getFunctionBlock(source, "runToolboxDoctorCheck");

  assert.ok(diagnostics.includes('wizardState.currentPage = "troubleshoot"'));
  assert.ok(diagnostics.includes('wizardState.currentStep = 0'));
  assert.match(diagnostics, /runToolboxDoctorCheck/);
  assert.ok(source.includes('window.openClawInstaller.runDoctor'));
  assert.doesNotMatch(toolboxDoctor, /runInstall|runInstallStep|goToStep\\(1\\)/);
});

test("问题排查页不再渲染检查配置按钮和基础组件诊断说明卡片", () => {
  const source = readRenderer();
  const commonActions = source.slice(
    source.indexOf("function createTroubleshootCommonActionsCard"),
    source.indexOf("function createTroubleshootUpdateButton")
  );
  const troubleshootPage = source.slice(
    source.indexOf("function renderTroubleshootPage"),
    source.indexOf("function createInfoPanel")
  );

  assert.doesNotMatch(commonActions, /检查配置/);
  assert.doesNotMatch(troubleshootPage, /基础组件诊断说明/);
});

test("AI 配置卡片仍保留检查配置入口", () => {
  const source = readRenderer();
  const aiCard = getFunctionBlock(source, "createAiConfigurationCard");

  assert.match(aiCard, /检查配置/);
  assert.match(aiCard, /runStatusCheck/);
});

test("API Key 本地校验阻止空值、空格、纯数字、换行和明显过短内容", () => {
  const validateApiKey = loadApiKeyValidator();

  assert.equal(validateApiKey("", "openrouter").ok, false);
  assert.equal(validateApiKey("   ", "openrouter").ok, false);
  assert.equal(validateApiKey("12345678901234567890", "openrouter").ok, false);
  assert.equal(validateApiKey("sk-valid\\nvalue", "openrouter").ok, false);
  assert.equal(validateApiKey("short", "openrouter").ok, false);
});

test("API Key 合理格式可以进入配置调用", () => {
  const validateApiKey = loadApiKeyValidator();

  const result = validateApiKey("sk-valid-key-1234567890", "openai");
  assert.equal(result.ok, true);
  assert.equal(result.message, "");
});

test("自定义模型为空仍在调用配置前被阻止", () => {
  const source = readRenderer();
  const runQuickConfigure = getFunctionBlock(source, "runQuickConfigure");
  const customCheckIndex = runQuickConfigure.indexOf("if (defaultModel === null)");
  const configureCallIndex = runQuickConfigure.indexOf("window.openClawInstaller.runQuickConfigure");

  assert.ok(customCheckIndex > -1);
  assert.ok(configureCallIndex > -1);
  assert.ok(customCheckIndex < configureCallIndex);
  assert.ok(runQuickConfigure.includes('showCustomModelError(form)'));
});

test("输入内容修改后会清除对应表单错误", () => {
  const source = readRenderer();
  const createForm = getFunctionBlock(source, "createQuickConfigureForm");

  assert.ok(createForm.includes('apiKeyInput.addEventListener("input", () => clearApiKeyError(form))'));
  assert.ok(createForm.includes('customModelInput.addEventListener("input", () => clearCustomModelError(form))'));
});

test("五个服务商映射到正确的官方 API Key 地址", () => {
  const { getProviderApiKeyGuidance } = require(projectPath("src/gui/providerApiKeyGuidance.js"));
  const expected = {
    openrouter: "https://openrouter.ai/settings/keys",
    deepseek: "https://platform.deepseek.com/api_keys",
    openai: "https://platform.openai.com/api-keys",
    gemini: "https://aistudio.google.com/app/apikey",
    qwen: "https://help.aliyun.com/zh/model-studio/get-api-key"
  };

  for (const [providerId, url] of Object.entries(expected)) {
    assert.equal(getProviderApiKeyGuidance(providerId).url, url);
  }
});

test("未知 provider ID 没有链接且 renderer 不能提交任意 URL", () => {
  const { getProviderApiKeyGuidance } = require(projectPath("src/gui/providerApiKeyGuidance.js"));
  const preload = readFile("src/gui/preload.js");
  const main = readFile("src/gui/main.js");

  assert.equal(getProviderApiKeyGuidance("unknown"), null);
  assert.match(preload, /openProviderApiKeyPage\(providerId\)/);
  assert.match(preload, /invoke\("provider-api-key:open", providerId\)/);
  assert.doesNotMatch(preload, /provider-api-key:open", url/);
  assert.match(main, /getProviderApiKeyGuidance\(providerId\)/);
});

test("服务商切换更新提示和按钮文字", () => {
  const createForm = getFunctionBlock(readRenderer(), "createQuickConfigureForm");
  const updateHelp = getFunctionBlock(readRenderer(), "updateProviderApiKeyHelp");

  assert.match(createForm, /updateProviderApiKeyHelp\(providerHelp, providerSelect\.value\)/);
  assert.match(createForm, /providerSelect\.addEventListener\("change"/);
  assert.match(updateHelp, /guidance\.hint/);
  assert.match(updateHelp, /"打开 " \+ guidance\.label \+ " 获取 API Key"/);
  assert.match(updateHelp, /"请先选择 AI 服务商。"/);
});

test("首次配置和重新配置复用同一个带官方引导的表单", () => {
  const renderer = readRenderer();
  const configurePage = getFunctionBlock(renderer, "renderStandaloneConfigurePage");
  const createForm = getFunctionBlock(renderer, "createQuickConfigureForm");

  assert.match(configurePage, /createQuickConfigureForm\(\)/);
  assert.match(createForm, /createProviderApiKeyHelp\(\)/);
  assert.match(createForm, /wizardState\.configureMode === "reconfigure"/);
});

test("官方页面打开失败时使用表单内反馈且不改变 API Key 校验", () => {
  const renderer = readRenderer();
  const openPage = getFunctionBlock(renderer, "openProviderApiKeyPage");
  const createHelp = getFunctionBlock(renderer, "createProviderApiKeyHelp");
  const validateApiKey = loadApiKeyValidator();

  assert.match(createHelp, /provider-api-key-feedback/);
  assert.match(openPage, /feedback\.textContent/);
  assert.match(openPage, /feedback\.hidden = false/);
  assert.equal(validateApiKey("short", "openai").ok, false);
  assert.equal(validateApiKey("sk-valid-key-1234567890", "openai").ok, true);
});

test("配置命令失败时不能标记为已验证", () => {
  const source = readRenderer();
  const runQuickConfigure = getFunctionBlock(source, "runQuickConfigure");
  const failureIndex = runQuickConfigure.indexOf("if (!result.ok)");
  const pendingIndex = runQuickConfigure.indexOf("wizardState.pendingQuickConfigVerification = true");
  const verifyIndex = runQuickConfigure.indexOf("await runVerifyStep");

  assert.ok(failureIndex > -1);
  assert.ok(pendingIndex > -1);
  assert.ok(verifyIndex > -1);
  assert.ok(failureIndex < pendingIndex);
  assert.ok(failureIndex < verifyIndex);
});

test("打开控制台由 Main 解析安全 URL 后显式调用系统浏览器", () => {
  const main = readFile("src/gui/main.js");
  const service = readFile("src/gui/services/installerService.js");
  const preload = readFile("src/gui/preload.js");
  const renderer = readRenderer();

  assert.match(service, /\["gateway", "start"\]/);
  assert.match(service, /\["gateway", "install"\]/);
  assert.match(service, /\["dashboard", "--no-open"\]/);
  assert.doesNotMatch(service, /\["dashboard", "--yes", "--no-open"\]/);
  assert.doesNotMatch(service, /\["dashboard", "--json"\]/);
  assert.match(service, /readDashboardClipboard/);
  assert.match(service, /writeDashboardClipboard/);
  assert.match(service, /clipboard_authenticated_url/);
  assert.match(service, /DASHBOARD_AUTH_URL_UNAVAILABLE/);
  assert.match(service, /loopbackHosts/);
  assert.match(service, /dashboardUrlResolved/);
  assert.match(service, /queryPresent/);
  assert.match(service, /hashPresent/);
  assert.match(service, /tokenPresent/);
  assert.doesNotMatch(service, /connectionOk/);
  assert.match(main, /shell\.openExternal\(result\.dashboardUrl\)/);
  assert.match(main, /clipboard\.readText\(\)/);
  assert.match(main, /clipboard\.writeText\(value\)/);
  assert.match(main, /dashboard_browser_opened/);
  assert.match(main, /请在浏览器中完成连接/);
  assert.match(preload, /invoke\("dashboard:open"\)/);
  assert.doesNotMatch(main, /dashboardUrl:\s*result\.dashboardUrl/);
  assert.doesNotMatch(service, /runDetachedCommand\("openclaw", \["dashboard"/);
  assert.match(renderer, /控制台已打开/);
  assert.doesNotMatch(renderer, /控制台运行中/);
  const openDashboard = getFunctionBlock(renderer, "openDashboard");
  assert.match(openDashboard, /dashboardStatus = "starting"/);
  assert.match(openDashboard, /dashboardStatus = "failed"/);
  assert.match(
    renderer,
    /async function openDashboard\(\)[\s\S]*?finally\s*\{[\s\S]*?renderDashboardFeedback/
  );
});

test("DeepSeek 快速配置只提供当前正式模型标识", () => {
  const source = readRenderer();
  const modelOptions = source.slice(
    source.indexOf("const providerModels"),
    source.indexOf("function populateModelOptions")
  );

  assert.match(modelOptions, /deepseek\/deepseek-v4-pro/);
  assert.match(modelOptions, /deepseek\/deepseek-v4-flash/);
  assert.doesNotMatch(modelOptions, /\["deepseek-chat"/);
  assert.doesNotMatch(modelOptions, /\["deepseek-reasoner"/);
});


test("启动状态识别不会锁住左侧导航或页面跳转", () => {
  const source = readRenderer();
  const navigateToPage = getFunctionBlock(source, "navigateToPage");
  const updateHomeButtonState = getFunctionBlock(source, "updateHomeButtonState");
  const updateSidebarState = getFunctionBlock(source, "updateSidebarState");

  assert.doesNotMatch(navigateToPage, /isProbingStartup/);
  assert.doesNotMatch(updateHomeButtonState, /isProbingStartup/);
  assert.doesNotMatch(updateSidebarState, /isProbingStartup/);
  assert.match(updateSidebarState, /button.disabled = wizardState.isBusy/);
});

test("首页只有真实版本命令成功时才保持 OpenClaw 已安装状态", () => {
  const source = readRenderer();
  const refresh = getFunctionBlock(source, "refreshVersionInfo");
  const startupProbe = getFunctionBlock(source, "probeStartupState");
  const verifySync = getFunctionBlock(source, "syncVerifyStatus");

  assert.match(
    refresh,
    /if \(version\.installed\)[\s\S]*else\s*{[\s\S]*installStatus = "未安装"/
  );
  assert.match(
    refresh,
    /catch \(error\)[\s\S]*installStatus = "安装异常"/
  );
  assert.doesNotMatch(
    startupProbe,
    /commandCheck && commandCheck\.ok[\s\S]*installStatus = "已安装"/
  );
  assert.match(
    verifySync,
    /versionCheck && !versionCheck\.ok[\s\S]*installStatus = "安装异常"/
  );
});

test("可选顶部与侧栏节点缺失时初始化绑定有空值保护", () => {
  const source = readRenderer();

  assert.match(source, /if \(window\.openClawInstaller && appStage && appStageLabel\)/);
  assert.ok(source.includes("if (appStage)"));
  assert.ok(source.includes("if (aboutMenu)"));
  assert.ok(source.includes("if (appearanceButton)"));
  assert.ok(source.includes("if (appearanceMenu)"));
  assert.ok(source.includes("if (recentStatusButton)"));
});

test("首页 ready 状态仍渲染完整工具箱首页", () => {
  const source = readRenderer();
  const welcome = getFunctionBlock(source, "renderWelcomeStep");
  const toolboxHome = getFunctionBlock(source, "renderToolboxHome");
  const homeDashboard = getFunctionBlock(source, "renderHomeDashboard");
  const homeGrid = getFunctionBlock(source, "createHomeCardGrid");

  assert.match(welcome, /homeState === "ready"/);
  assert.ok(welcome.includes("renderToolboxHome()"));
  assert.match(toolboxHome, /renderHomeDashboard/);
  assert.ok(homeDashboard.includes("createHomeCardGrid(options.state)"));
  assert.ok(homeDashboard.includes("createHomeRecentCard()"));
  assert.match(homeGrid, /title: "OpenClaw"/);
  assert.ok(homeGrid.includes("createConsoleDashboardCard()"));
  assert.ok(homeGrid.includes("createAiConfigurationCard()"));
  assert.match(homeGrid, /title: "安全须知"/);
});


test("运行诊断按钮有局部 loading、spinner 和无障碍状态", () => {
  const source = readRenderer();
  const buttonFactory = getFunctionBlock(source, "createTroubleshootDiagnosticsButton");

  assert.match(buttonFactory, /troubleshootDiagnosticsBusy/);
  assert.match(buttonFactory, /正在诊断…/);
  assert.match(buttonFactory, /about-update-spinner diagnostics-spinner/);
  assert.match(buttonFactory, /aria-busy/);
  assert.match(buttonFactory, /button.disabled = wizardState.troubleshootDiagnosticsBusy/);
});

test("运行诊断使用局部状态，不锁死侧栏且防止重复调用 doctor", () => {
  const source = readRenderer();
  const diagnostics = getFunctionBlock(source, "runTroubleshootDiagnostics");
  const toolboxDoctor = getFunctionBlock(source, "runToolboxDoctorCheck");

  assert.match(diagnostics, /troubleshootDiagnosticsBusy/);
  assert.match(diagnostics, /return null/);
  assert.match(diagnostics, /lockUi: false/);
  assert.match(diagnostics, /preserveDoctorReport: true/);
  assert.match(diagnostics, /diagnosticsMode: true/);
  assert.ok(toolboxDoctor.includes("if (shouldLockUi)"));
  assert.ok(toolboxDoctor.includes("setBusy(true)"));
  assert.match(toolboxDoctor, /diagnosticsMode && wizardState.troubleshootDiagnosticsBusy/);
  assert.ok(toolboxDoctor.includes("window.openClawInstaller.runDoctor()"));
  assert.doesNotMatch(toolboxDoctor, /runInstall|runInstallStep|goToStep\(1\)/);
});

test("运行诊断完成、警告和失败反馈都有明确文案", () => {
  const source = readRenderer();
  const doneMessage = getFunctionBlock(source, "getTroubleshootDiagnosticsDoneMessage");
  const doneStatus = getFunctionBlock(source, "getTroubleshootDiagnosticsDoneStatus");
  const toolboxDoctor = getFunctionBlock(source, "runToolboxDoctorCheck");

  assert.match(doneMessage, /诊断完成，未发现需要处理的问题。/);
  assert.match(doneMessage, /诊断完成，发现需要确认的项目。/);
  assert.match(doneStatus, /warning/);
  assert.match(doneStatus, /success/);
  assert.match(toolboxDoctor, /诊断未完成，请稍后重试。/);
  assert.match(toolboxDoctor, /troubleshootDiagnosticsStatus = "failure"/);
});

test("运行诊断异常后通过 finally 恢复按钮状态并留在问题排查页", () => {
  const source = readRenderer();
  const diagnostics = getFunctionBlock(source, "runTroubleshootDiagnostics");
  const toolboxDoctor = getFunctionBlock(source, "runToolboxDoctorCheck");

  assert.ok(diagnostics.includes('wizardState.currentPage = "troubleshoot"'));
  assert.ok(diagnostics.includes('wizardState.currentStep = 0'));
  assert.match(toolboxDoctor, /finally/);
  assert.match(toolboxDoctor, /wizardState.troubleshootDiagnosticsBusy = false/);
  assert.match(toolboxDoctor, /renderWizard()/);
});

test("运行诊断 loading 样式支持 reduced motion", () => {
  const css = fs.readFileSync(projectPath("src/gui/renderer/style.css"), "utf8");

  assert.match(css, /.troubleshoot-diagnostics-button/);
  assert.match(css, /.diagnostics-spinner/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /animation: none/);
});

test("左侧导航包含角色市场入口并沿用 data-page 页面切换", () => {
  const html = readFile("src/gui/renderer/index.html");
  const renderer = readRenderer();
  const renderPage = getFunctionBlock(renderer, "renderPage");

  assert.match(html, /data-page="role-marketplace"[^>]*>[\s\S]*?sidebar-link-label">角色市场/);
  assert.match(renderPage, /currentPage === "role-marketplace"/);
  assert.match(renderPage, /renderRoleMarketplacePage\(\)/);
});

test("角色市场通过 preload 白名单调用只读 IPC", () => {
  const renderer = readRenderer();
  const preload = readFile("src/gui/preload.js");
  const main = readFile("src/gui/main.js");
  const loadMarketplaceRoles = getFunctionBlock(renderer, "loadMarketplaceRoles");

  assert.match(loadMarketplaceRoles, /window\.openClawInstaller\.listMarketplaceRoles\(\)/);
  assert.match(preload, /listMarketplaceRoles\(\)/);
  assert.match(preload, /invoke\("role-marketplace:list"\)/);
  assert.match(main, /require\("\.\/services\/roleService"\)/);
  assert.match(main, /ipcMain\.handle\("role-marketplace:list"/);
  assert.match(main, /roleService\.listMarketplaceRoles\(\)/);
});

test("角色市场覆盖 idle、loading、error、ready 和空列表状态并支持刷新", () => {
  const renderer = readRenderer();
  const page = getFunctionBlock(renderer, "renderRoleMarketplacePage");
  const loader = getFunctionBlock(renderer, "loadMarketplaceRoles");
  const applyResult = getFunctionBlock(renderer, "applyMarketplaceResult");

  assert.match(renderer, /status: "idle"/);
  assert.match(loader, /marketplace\.status = "loading"/);
  assert.match(applyResult, /marketplace\.status = "ready"/);
  assert.match(loader, /marketplace\.status = "error"/);
  assert.match(page, /marketplace\.roles\.length === 0/);
  assert.match(page, /暂无可用角色/);
  assert.match(page, /"刷新"/);
  assert.match(page, /重新加载/);
});

test("角色市场用普通用户语言串联安装、准备助手和开始聊天", () => {
  const renderer = readRenderer();
  const roleCard = getFunctionBlock(renderer, "createMarketplaceRoleCard");
  const marketplacePage = getFunctionBlock(renderer, "renderRoleMarketplacePage");

  assert.match(roleCard, /role\.agentCount/);
  assert.match(roleCard, /role\.agents/);
  assert.match(roleCard, /安装并启用/);
  assert.match(roleCard, /正在准备助手…/);
  assert.match(roleCard, /准备助手/);
  assert.match(roleCard, /开始聊天/);
  assert.match(roleCard, /prepareMarketplaceRole/);
  assert.match(roleCard, /startChatFromRole/);
  assert.match(roleCard, /role\.instances/);
  assert.match(roleCard, /需要修复/);
  assert.doesNotMatch(roleCard, /instance\.instanceId/);
  assert.doesNotMatch(renderer, /团队群聊/);
  assert.doesNotMatch(renderer, /removeRole|卸载角色/);
  assert.match(marketplacePage, /选择角色并安装/);
  assert.match(marketplacePage, /createRoleMarketplaceTabs/);
});

test("角色安装通过 preload 固定 IPC 契约且 renderer 不能传路径或 options", () => {
  const renderer = readRenderer();
  const preload = readFile("src/gui/preload.js");
  const main = readFile("src/gui/main.js");
  const install = getFunctionBlock(renderer, "installMarketplaceRole");

  assert.match(install, /window\.openClawInstaller\.installMarketplaceRole\(roleId\)/);
  assert.doesNotMatch(install, /installRoot|statePath|rolesDirectory|workspacePath|options/);
  assert.match(preload, /installMarketplaceRole\(roleId\)/);
  assert.match(preload, /invoke\("role-marketplace:install", roleId\)/);
  assert.doesNotMatch(preload, /role-marketplace:install", roleId,/);
  assert.match(main, /ipcMain\.handle\("role-marketplace:install", async \(event, roleId\)/);
  assert.match(main, /roleService\.installMarketplaceRole\(roleId\.trim\(\)\)/);
});

test("角色安装使用每个 roleId 的局部状态并阻止同角色重复提交", () => {
  const renderer = readRenderer();
  const roleCard = getFunctionBlock(renderer, "createMarketplaceRoleCard");
  const install = getFunctionBlock(renderer, "installMarketplaceRole");

  assert.match(roleCard, /installations\[role\.id\]/);
  assert.match(roleCard, /pending: installing/);
  assert.match(roleCard, /disabled: installing/);
  assert.match(install, /current && current\.status === "installing"/);
  assert.match(install, /installations\[roleId\]/);
  assert.doesNotMatch(install, /setBusy\(|wizardState\.isBusy/);
});

test("角色安装成功更新市场状态，失败恢复局部按钮并使用安全提示", () => {
  const renderer = readRenderer();
  const install = getFunctionBlock(renderer, "installMarketplaceRole");
  const applyResult = getFunctionBlock(renderer, "applyMarketplaceResult");
  const safeMessage = getFunctionBlock(renderer, "safeMarketplaceMessage");

  assert.match(install, /result\.marketplace/);
  assert.match(install, /status: "success"/);
  assert.match(install, /status: "error"/);
  assert.match(install, /result\.alreadyInstalled/);
  assert.match(applyResult, /marketplace\.roles = result\.roles/);
  assert.match(safeMessage, /\[路径已隐藏\]/);
  assert.doesNotMatch(install, /error\.message|error\.stack/);
});

test("角色启用通过 preload 固定 IPC 契约且 renderer 不能传路径或实例配置", () => {
  const renderer = readRenderer();
  const preload = readFile("src/gui/preload.js");
  const main = readFile("src/gui/main.js");
  const enable = getFunctionBlock(renderer, "enableMarketplaceRole");

  assert.match(enable, /window\.openClawInstaller\.enableMarketplaceRole\(roleId\)/);
  assert.doesNotMatch(
    enable,
    /workspacePath|agentDir|statePath|instanceId|options/
  );
  assert.match(preload, /enableMarketplaceRole\(roleId\)/);
  assert.match(preload, /invoke\("role-marketplace:enable", roleId\)/);
  assert.doesNotMatch(preload, /role-marketplace:enable", roleId,/);
  assert.match(main, /ipcMain\.handle\("role-marketplace:enable", async \(event, roleId\)/);
  assert.match(main, /roleService\.enableMarketplaceRole\(roleId\.trim\(\)\)/);
});

test("角色启用使用每个 roleId 的局部状态并阻止同角色重复提交", () => {
  const renderer = readRenderer();
  const roleCard = getFunctionBlock(renderer, "createMarketplaceRoleCard");
  const enable = getFunctionBlock(renderer, "enableMarketplaceRole");

  assert.match(roleCard, /enablements\[role\.id\]/);
  assert.match(roleCard, /pending: enabling/);
  assert.match(roleCard, /disabled: enabling/);
  assert.match(roleCard, /label: enabling \? "正在修复…" : "需要修复"/);
  assert.match(roleCard, /handler: \(\) => enableMarketplaceRole\(role\.id\)/);
  assert.match(enable, /current && current\.status === "enabling"/);
  assert.match(enable, /enablements\[roleId\]/);
  assert.doesNotMatch(enable, /role\.enablementStatus === "needs-repair"/);
  assert.doesNotMatch(enable, /setBusy\(|wizardState\.isBusy/);
});

test("角色启用成功展示真实助手数量，失败恢复局部按钮并使用安全提示", () => {
  const renderer = readRenderer();
  const roleCard = getFunctionBlock(renderer, "createMarketplaceRoleCard");
  const statusText = getFunctionBlock(renderer, "getMarketplaceRoleStatusText");
  const enable = getFunctionBlock(renderer, "enableMarketplaceRole");

  assert.match(enable, /result\.marketplace/);
  assert.match(enable, /status: "success"/);
  assert.match(enable, /status: "error"/);
  assert.match(enable, /result\.alreadyEnabled/);
  assert.match(statusText, /\$\{role\.instanceCount\} 个助手已准备好/);
  assert.doesNotMatch(roleCard, /instance\.instanceId/);
  assert.match(roleCard, /getMarketplaceInstanceStatus\(instance\.status\)/);
  assert.doesNotMatch(enable, /error\.message|error\.stack/);
});

test("角色市场 renderer 不直接访问 Node.js、文件系统或子进程", () => {
  const renderer = readRenderer();

  assert.doesNotMatch(renderer, /\brequire\s*\(/);
  assert.doesNotMatch(renderer, /\bnode:fs\b|\bchild_process\b|\bspawn\s*\(/);
  assert.doesNotMatch(renderer, /\bprocess\.(?:env|cwd|platform|arch)\b/);
});

test("左侧导航移除我的角色一级入口并新增独立聊天中心", () => {
  const html = readFile("src/gui/renderer/index.html");
  const renderer = readRenderer();
  const renderPage = getFunctionBlock(renderer, "renderPage");

  assert.doesNotMatch(html, /data-page="my-roles"/);
  assert.match(html, /data-page="chat-center"[^>]*>[\s\S]*?sidebar-link-label">聊天/);
  assert.match(renderPage, /currentPage === "chat-center"/);
  assert.match(renderPage, /renderChatCenterPage\(\)/);
});

test("我的角色通过无参数 preload 白名单调用只读 IPC", () => {
  const renderer = readRenderer();
  const preload = readFile("src/gui/preload.js");
  const main = readFile("src/gui/main.js");
  const loader = getFunctionBlock(renderer, "loadMyRoles");

  assert.match(loader, /window\.openClawInstaller\.listMyRoles\(\)/);
  assert.doesNotMatch(loader, /statePath|workspacePath|agentDir|options/);
  assert.match(preload, /listMyRoles\(\)/);
  assert.match(preload, /invoke\("my-roles:list"\)/);
  assert.doesNotMatch(preload, /my-roles:list",/);
  assert.match(main, /ipcMain\.handle\("my-roles:list", async \(\)/);
  assert.match(main, /roleService\.listMyRoles\(\)/);
});

test("已安装二级页覆盖 loading、error、empty 和 ready 状态", () => {
  const renderer = readRenderer();
  const page = getFunctionBlock(renderer, "appendInstalledRolesContent");
  const loader = getFunctionBlock(renderer, "loadMyRoles");
  const applyResult = getFunctionBlock(renderer, "applyMyRolesResult");

  assert.match(renderer, /myRoles: \{\s*status: "idle"/);
  assert.match(loader, /myRoles\.status = "loading"/);
  assert.match(loader, /myRoles\.status = "error"/);
  assert.match(applyResult, /myRoles\.status = "ready"/);
  assert.match(page, /myRoles\.roles\.length === 0/);
  assert.match(page, /还没有安装角色/);
  assert.match(page, /重新加载/);
  assert.match(page, /查看全部角色/);
  assert.match(page, /助手/);
});

test("已安装角色按助手健康状态控制聊天入口且不展示技术标识", () => {
  const renderer = readRenderer();
  const roleCard = getFunctionBlock(renderer, "createMyRoleCard");
  const instanceRow = getFunctionBlock(renderer, "createMyRoleInstance");
  const openChat = getFunctionBlock(renderer, "openAgentChat");

  assert.match(roleCard, /尚未准备好/);
  assert.match(roleCard, /完成准备/);
  assert.match(roleCard, /需要修复/);
  assert.match(instanceRow, /instance\.available \? "选择聊天"/);
  assert.match(instanceRow, /"需要修复"/);
  assert.match(instanceRow, /chatButton\.disabled = instance\.available !== true/);
  assert.doesNotMatch(instanceRow, /identity\.textContent|instance\.instanceId/);
  assert.match(openChat, /role\.enabled !== true/);
  assert.match(openChat, /instance\.available !== true/);
  assert.match(openChat, /instance\.status !== "registered"/);
});

test("聊天中心包含会话列表、聊天窗口和安全选择字段", () => {
  const renderer = readRenderer();
  const page = getFunctionBlock(renderer, "renderAgentChatPage");
  const openChat = getFunctionBlock(renderer, "openAgentChat");

  const center = getFunctionBlock(renderer, "renderChatCenterPage");
  assert.match(center, /chat-center-sidebar/);
  assert.match(center, /createChatConversationList/);
  assert.match(center, /＋ 新建聊天/);
  assert.match(page, /agent-chat-messages/);
  assert.match(page, /agent-chat-input/);
  assert.match(page, /renderAgentChatMessages/);
  assert.match(page, /canSendAgentChatMessage/);
  assert.match(page, /sendButton\.addEventListener\("click", sendAgentChatMessage\)/);
  assert.match(page, /event\.key === "Enter" && !event\.shiftKey/);
  assert.match(page, /scrollChatToBottom\(\)/);
  assert.match(page, /focusAgentChatInput\(\)/);

  for (const field of [
    "roleId",
    "roleName",
    "instanceId",
    "roleAgentId",
    "name",
    "description",
    "status"
  ]) {
    assert.match(openChat, new RegExp(`${field}:`));
  }
  assert.doesNotMatch(
    openChat,
    /workspacePath|agentDir|sessionKey|openClawSessionId|openClawRunId|statePath/
  );
});

test("角色市场包含全部角色和已安装二级选项", () => {
  const renderer = readRenderer();
  const tabs = getFunctionBlock(renderer, "createRoleMarketplaceTabs");
  const installed = getFunctionBlock(renderer, "appendInstalledRolesContent");

  assert.match(tabs, /\["all", "全部角色"\]/);
  assert.match(tabs, /\["installed", "已安装"\]/);
  assert.match(installed, /已经准备好的助手/);
  assert.match(installed, /createMyRoleCard/);
});

test("聊天列表和新建聊天只通过固定安全 IPC", () => {
  const renderer = readRenderer();
  const preload = readFile("src/gui/preload.js");
  const main = readFile("src/gui/main.js");
  const loader = getFunctionBlock(renderer, "loadChatConversations");
  const picker = getFunctionBlock(renderer, "createChatAssistantPicker");

  assert.match(loader, /window\.openClawInstaller\.listChatConversations\(\)/);
  assert.match(preload, /listChatConversations\(\)/);
  assert.match(preload, /invoke\("chat-center:list"\)/);
  assert.match(main, /ipcMain\.handle\("chat-center:list"/);
  assert.match(main, /conversationService\.listChatConversations\(\)/);
  assert.match(picker, /instance\.available !== true/);
  assert.doesNotMatch(picker, /workspacePath|agentDir|sessionKey|statePath/);
});

test("聊天 renderer 只调用 preload 白名单且不伪造消息或直接调用 Execution", () => {
  const renderer = readRenderer();
  const loader = getFunctionBlock(renderer, "loadAgentChat");
  const sender = getFunctionBlock(renderer, "sendAgentChatMessage");
  const rendererMessage = getFunctionBlock(renderer, "createAgentChatMessage");
  const optimisticMessage = getFunctionBlock(
    renderer,
    "createOptimisticAgentChatMessage"
  );

  assert.match(loader, /window\.openClawInstaller\.createNewAgentChat/);
  assert.match(sender, /window\.openClawInstaller\.sendAgentChatMessage/);
  assert.doesNotMatch(`${loader}\n${sender}`, /runTask|Execution|execution:|openclaw agent/i);
  assert.doesNotMatch(`${loader}\n${sender}`, /messages?\.push|chatHistory|messageHistory/);
  assert.match(rendererMessage, /\.textContent = message\.content/);
  assert.match(optimisticMessage, /body\.textContent = message\.content/);
  assert.match(optimisticMessage, /agent-chat-message-user/);
  assert.doesNotMatch(optimisticMessage, /agent-chat-message-assistant/);
  assert.doesNotMatch(
    `${rendererMessage}\n${optimisticMessage}`,
    /innerHTML|insertAdjacentHTML/
  );
});

test("Agent 聊天 preload 与 main 仅暴露固定安全 IPC 参数", () => {
  const preload = readFile("src/gui/preload.js");
  const main = readFile("src/gui/main.js");

  assert.match(preload, /createNewAgentChat\(instanceId, title\)/);
  assert.match(preload, /invoke\("agent-chat:create", instanceId, title\)/);
  assert.match(preload, /openExistingAgentChat\(conversationId\)/);
  assert.match(preload, /invoke\("agent-chat:open-existing", conversationId\)/);
  assert.match(preload, /listAgentChatMessages\(instanceId, conversationId, pagination\)/);
  assert.match(preload, /invoke\(\s*"agent-chat:messages"/);
  assert.match(preload, /sendAgentChatMessage\(instanceId, conversationId, content\)/);
  assert.match(preload, /"agent-chat:send",\s*instanceId,\s*conversationId,\s*content/);
  assert.match(preload, /reconcileAgentChat\(instanceId, conversationId\)/);
  assert.match(preload, /"agent-chat:reconcile",\s*instanceId,\s*conversationId/);

  assert.match(main, /ipcMain\.handle\("agent-chat:create"/);
  assert.match(main, /conversationService\.createNewAgentConversation/);
  assert.match(main, /ipcMain\.handle\("agent-chat:open-existing"/);
  assert.match(main, /conversationService\.openChatConversation/);
  assert.match(main, /ipcMain\.handle\("agent-chat:messages"/);
  assert.match(main, /ipcMain\.handle\("agent-chat:send"/);
  assert.match(main, /ipcMain\.handle\("agent-chat:reconcile"/);
  const preloadChat = preload.slice(
    preload.indexOf("createNewAgentChat(instanceId, title)"),
    preload.indexOf("openLogsDirectory()")
  );
  for (const field of ["workspacePath", "agentDir", "sessionKey", "statePath"]) {
    assert.doesNotMatch(preloadChat, new RegExp(field));
  }
});

test("聊天页面覆盖 loading、ready、sending、error、空历史和失败消息", () => {
  const renderer = readRenderer();
  const page = getFunctionBlock(renderer, "renderAgentChatPage");
  const messages = getFunctionBlock(renderer, "renderAgentChatMessages");
  const sender = getFunctionBlock(renderer, "sendAgentChatMessage");

  assert.match(renderer, /agentChat: \{\s*status: "idle"/);
  assert.match(messages, /state\.status === "loading"/);
  assert.match(messages, /state\.messages\.length === 0/);
  assert.match(messages, /createAgentChatMessage/);
  assert.match(sender, /state\.status = "sending"/);
  assert.match(
    getFunctionBlock(renderer, "recoverAgentChatAfterSendFailure"),
    /wizardState\.agentChat\.status = "error"/
  );
  assert.match(page, /state\.status === "error"/);
  assert.match(page, /恢复并刷新/);
  assert.match(renderer, /message\.status === "failed" \|\| message\.status === "interrupted"/);
  assert.match(renderer, /createAgentChatReplyStatus/);
  assert.match(renderer, /正在输入/);
});

test("聊天发送立即创建纯前端临时 User 消息并清空输入", () => {
  const renderer = readRenderer();
  const sender = getFunctionBlock(renderer, "sendAgentChatMessage");
  const temporary = getFunctionBlock(
    renderer,
    "createOptimisticAgentChatMessage"
  );

  assert.match(sender, /const temporaryId = `temporary-user-\$\{requestId\}`/);
  assert.match(sender, /state\.draft = ""/);
  assert.match(sender, /state\.status = "sending"/);
  assert.match(sender, /state\.pendingMessage = \{/);
  assert.match(sender, /temporaryId,/);
  assert.match(sender, /role: "user"/);
  assert.match(sender, /content,/);
  assert.match(sender, /status: "sending"/);
  assert.match(sender, /renderAgentChatIfVisible\(\)/);
  assert.match(sender, /scrollChatToBottom\(\)/);
  assert.doesNotMatch(
    sender.slice(sender.indexOf("state.pendingMessage = {"), sender.indexOf("renderAgentChatIfVisible()")),
    /messageId|sessionKey|openClawSessionId|openClawRunId/
  );
  assert.match(temporary, /dataset\.temporaryId = message\.temporaryId/);
  assert.match(temporary, /发送中/);
});

test("聊天发送成功以真实历史替换临时消息，失败先复核历史且不伪造回复", () => {
  const renderer = readRenderer();
  const sender = getFunctionBlock(renderer, "sendAgentChatMessage");
  const recovery = getFunctionBlock(
    renderer,
    "recoverAgentChatAfterSendFailure"
  );
  const persisted = getFunctionBlock(
    renderer,
    "hasPersistedAgentChatMessage"
  );

  assert.match(sender, /applyAgentChatResult\(result, "ready"\)/);
  assert.match(sender, /pendingMessage = null/);
  assert.match(sender, /recoverAgentChatAfterSendFailure/);
  assert.match(
    recovery,
    /window\.openClawInstaller\.listAgentChatMessages/
  );
  assert.match(recovery, /hasPersistedAgentChatMessage/);
  assert.match(recovery, /applyAgentChatResult\(refreshed, "ready"\)/);
  assert.match(recovery, /status: "failed"/);
  assert.match(recovery, /draft = context\.content/);
  assert.match(recovery, /canRetry: historyConfirmed/);
  assert.doesNotMatch(recovery, /role:\s*"assistant"|Assistant|假回复/);
  assert.match(persisted, /message\.role === "user"/);
  assert.match(persisted, /message\.sequence > baselineSequence/);
  assert.match(persisted, /message\.content === content/);
});

test("聊天发送用请求和页面标识隔离旧异步结果并阻止重复提交", () => {
  const renderer = readRenderer();
  const sender = getFunctionBlock(renderer, "sendAgentChatMessage");
  const current = getFunctionBlock(
    renderer,
    "isAgentChatRequestCurrent"
  );
  const canSend = getFunctionBlock(renderer, "canSendAgentChatMessage");

  assert.match(sender, /const viewId = state\.viewId/);
  assert.match(sender, /const requestId = createAgentChatRequestId\(\)/);
  assert.match(sender, /state\.activeRequestId = requestId/);
  assert.match(sender, /isAgentChatRequestCurrent/);
  assert.match(current, /isAgentChatViewCurrent/);
  assert.match(current, /activeRequestId === requestId/);
  assert.match(canSend, /state\.status !== "sending"/);
  assert.match(canSend, /!state\.activeRequestId/);
  assert.match(renderer, /wizardState\.currentPage === "chat-center"/);
});

test("聊天输入支持 Enter 发送、Shift+Enter 换行并在渲染后安全滚动", () => {
  const renderer = readRenderer();
  const page = getFunctionBlock(renderer, "renderAgentChatPage");
  const scroll = getFunctionBlock(renderer, "scrollChatToBottom");

  assert.match(page, /event\.key === "Enter" && !event\.shiftKey/);
  assert.match(page, /event\.preventDefault\(\)/);
  assert.match(scroll, /window\.requestAnimationFrame/);
  assert.match(scroll, /wizardState\.currentPage !== "chat-center"/);
  assert.match(scroll, /querySelector\("\.agent-chat-messages"\)/);
  assert.match(scroll, /messages\.scrollTop = messages\.scrollHeight/);
  assert.doesNotMatch(scroll, /document\.body|document\.documentElement|window\.scroll/);
});

test("工具箱侧边栏可折叠且只持久化布尔 UI 偏好", () => {
  const html = readFile("src/gui/renderer/index.html");
  const renderer = readRenderer();
  const setup = getFunctionBlock(renderer, "setupSidebarCollapse");
  const apply = getFunctionBlock(renderer, "applySidebarCollapsedState");
  const navigate = getFunctionBlock(renderer, "navigateToPage");

  assert.match(html, /id="sidebarToggle"/);
  assert.match(html, /sidebar-brand-compact[^>]*[\s\S]*?>OC</);
  for (const label of [
    "首页",
    "配置 API Key",
    "问题排查",
    "角色市场",
    "聊天",
    "关于本工具",
    "夜间模式",
    "设置"
  ]) {
    assert.match(html, new RegExp(`aria-label="${label}"`));
    assert.match(html, new RegExp(`title="${label}"`));
  }
  assert.match(setup, /localStorage\.setItem/);
  assert.match(setup, /String\(wizardState\.sidebarCollapsed\)/);
  assert.match(apply, /sidebar-collapsed/);
  assert.match(apply, /aria-expanded/);
  assert.match(navigate, /sidebarPreferenceSet !== true/);
  assert.match(navigate, /sidebarAutoCollapsedForChat/);
  assert.equal((renderer.match(/localStorage\.setItem/g) || []).length, 1);
  assert.doesNotMatch(
    setup,
    /roleId|instanceId|conversationId|sessionKey|openClawSessionId/
  );
});

test("角色市场使用单层页面头部且不再套重复大卡片", () => {
  const renderer = readRenderer();
  const page = getFunctionBlock(renderer, "renderRoleMarketplacePage");

  assert.match(page, /role-marketplace-page-header/);
  assert.match(page, /title\.textContent = "角色市场"/);
  assert.match(
    page,
    /选择角色并安装，准备完成后即可在聊天页面与助手对话。/
  );
  assert.match(page, /createButton\("刷新"/);
  assert.match(page, /createRoleMarketplaceTabs/);
  assert.doesNotMatch(page, /createCard\("角色市场"/);
});

test("聊天列表按 Conversation 标题展示并允许同一助手出现多个任务", () => {
  const renderer = readRenderer();
  const list = getFunctionBlock(renderer, "createChatConversationList");

  assert.match(list, /for \(const conversation of state\.conversations\)/);
  assert.match(list, /conversation\.title \|\| conversation\.agentName/);
  assert.match(list, /conversation\.agentName.*conversation\.roleName/);
  assert.match(list, /conversation\.lastMessagePreview/);
  assert.match(list, /conversation\.updatedAt/);
  assert.doesNotMatch(list, /new Set|new Map|findIndex|instanceId.*filter/);
});

test("新建聊天区分单助手与团队入口且团队入口不调用后端", () => {
  const renderer = readRenderer();
  const picker = getFunctionBlock(renderer, "createChatAssistantPicker");
  const teamMode = getFunctionBlock(renderer, "setChatPickerMode");

  assert.match(picker, /选择聊天方式/);
  assert.match(picker, /单助手聊天/);
  assert.match(picker, /团队协作 · 即将开放/);
  assert.match(picker, /任务名称（选填）/);
  assert.match(picker, /titleInput\.maxLength = 100/);
  assert.match(picker, /新建聊天/);
  assert.match(picker, /继续最近聊天/);
  assert.match(picker, /chat-assistant-role-group/);
  assert.doesNotMatch(
    teamMode,
    /window\.openClawInstaller|createConversation|sendMessage|Team|Project|Task/
  );
});

test("新建聊天强制创建新 Conversation，打开历史只按原 ID 读取", () => {
  const renderer = readRenderer();
  const create = getFunctionBlock(renderer, "loadAgentChat");
  const openExisting = getFunctionBlock(renderer, "loadListedChatConversation");
  const createAction = getFunctionBlock(renderer, "createNewChatForAssistant");

  assert.match(createAction, /openAgentChat\(role, instance, title\)/);
  assert.match(create, /window\.openClawInstaller\.createNewAgentChat/);
  assert.match(create, /selected\.instanceId/);
  assert.doesNotMatch(create, /openAgentChat\(|openExistingAgentChat/);
  assert.match(
    openExisting,
    /window\.openClawInstaller\.openExistingAgentChat/
  );
  assert.match(openExisting, /conversation\.conversationId/);
  assert.doesNotMatch(openExisting, /createNewAgentChat|openAgentChat/);
});

test("角色市场开始聊天先选择助手且默认提供新建聊天", () => {
  const renderer = readRenderer();
  const start = getFunctionBlock(renderer, "startChatFromRole");
  const roleCard = getFunctionBlock(renderer, "createMarketplaceRoleCard");
  const picker = getFunctionBlock(renderer, "createChatAssistantPicker");

  assert.match(start, /openChatAssistantPicker\(roleId\)/);
  assert.match(roleCard, /handler: \(\) => startChatFromRole\(role\.id\)/);
  assert.match(picker, /createNewChatForAssistant/);
  assert.match(picker, /findRecentConversationForInstance/);
});

test("角色市场标签和聊天中心样式支持深色模式、窄窗口与消息区滚动", () => {
  const css = readFile("src/gui/renderer/style.css");

  assert.match(css, /\.my-roles-grid/);
  assert.match(css, /\.my-role-instance-list/);
  assert.match(css, /\.role-marketplace-tabs/);
  assert.match(css, /\.chat-center-page/);
  assert.match(css, /grid-template-columns: 270px minmax\(0, 1fr\)/);
  assert.match(css, /\.chat-conversation-list/);
  assert.match(css, /\.chat-assistant-picker/);
  assert.match(css, /\.agent-chat-shell/);
  assert.match(css, /\.agent-chat-messages/);
  assert.match(css, /overflow-y: auto/);
  assert.match(css, /\.agent-chat-composer/);
  assert.match(css, /\.wizard-card-agent-chat/);
  assert.match(css, /width: min\(70%, 720px\)/);
  assert.match(css, /\.agent-chat-typing-dots/);
  assert.match(css, /@keyframes agent-chat-typing/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /body\[data-theme="dark"\].*agent-chat/s);
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /body\.sidebar-collapsed \.app-layout/);
  assert.match(css, /grid-template-columns: 300px minmax\(0, 1fr\)/);
  assert.match(css, /\.chat-picker-mode-tabs/);
  assert.match(css, /\.chat-center-has-selection \.chat-center-sidebar/);
});

test("准备 OpenClaw 订阅真实安装进度并展示当前 workflow 步骤", () => {
  const source = readRenderer();
  const preload = readFile("src/gui/preload.js");
  const main = readFile("src/gui/main.js");

  assert.match(source, /onInstallProgress/);
  assert.match(source, /renderInstallProgress/);
  assert.match(source, /environment_check:\s*"环境检查"/);
  assert.match(source, /download_script:\s*"下载脚本"/);
  assert.match(source, /execute_script:\s*"执行安装"/);
  assert.match(source, /verify_installation:\s*"安装验证"/);
  assert.match(preload, /subscribeToProgress\("install:progress"/);
  assert.match(main, /sendProgress\("install:progress"/);
});

test("准备失败页面展示安全失败步骤、原因、错误码和安装记录入口", () => {
  const source = readRenderer();
  const failure = getFunctionBlock(source, "renderPrepareFailure");

  assert.match(failure, /failedStepName|failedStepId/);
  assert.match(failure, /userMessage/);
  assert.match(failure, /errorCode/);
  assert.match(failure, /打开安装记录/);
  assert.match(failure, /查看安装记录后可以看到 npm 原因/);
  assert.match(failure, /openLogs/);
  assert.doesNotMatch(failure, /npmInstallerLogTail|npmInstallerLogPath/);
  assert.doesNotMatch(failure, /technicalMessage|commandResult|stderr|stdout|stack/);
});

test("Electron Main 将诊断日志固定到 userData logs 且 Core 不直接依赖 Electron", () => {
  const main = readFile("src/gui/main.js");
  const diagnosticLogger = readFile("src/utils/installDiagnosticLogger.js");
  const workflow = readFile("src/core/workflow/engine.js");

  assert.match(main, /app\.getPath\("userData"\)/);
  assert.match(main, /openclaw-install-debug\.log/);
  assert.match(main, /diagnosticLogPath/);
  assert.match(main, /appIsPackaged/);
  assert.match(main, /finalCommandPath/);
  assert.doesNotMatch(diagnosticLogger, /require\("electron"\)/);
  assert.doesNotMatch(workflow, /require\("electron"\)/);
});

test("恢复首次安装状态使用两次明确确认且只有最终确认调用 IPC", () => {
  const source = readRenderer();
  const first = getFunctionBlock(source, "openEnvironmentResetConfirmation");
  const dialog = getFunctionBlock(source, "showEnvironmentResetDialog");
  const run = getFunctionBlock(source, "runEnvironmentReset");

  assert.match(first, /恢复首次安装状态/);
  assert.match(first, /确认永久删除/);
  assert.match(first, /永久删除并重置/);
  assert.match(dialog, /取消/);
  assert.match(dialog, /返回/);
  assert.doesNotMatch(first, /resetFirstInstallState/);
  assert.doesNotMatch(dialog, /resetFirstInstallState/);
  assert.match(run, /resetFirstInstallState\(\)/);
});

test("重置 IPC 不接收 renderer 路径且成功才重启应用", () => {
  const preload = readFile("src/gui/preload.js");
  const main = readFile("src/gui/main.js");
  const handlerStart = main.indexOf('ipcMain.handle("environment-reset:run"');
  const handlerEnd = main.indexOf("function sendProgress", handlerStart);
  const handler = main.slice(handlerStart, handlerEnd);

  assert.match(preload, /resetFirstInstallState\(\)/);
  assert.match(preload, /invoke\("environment-reset:run"\)/);
  assert.doesNotMatch(preload, /environment-reset:run",/);
  assert.match(main, /onEnvironmentResetProgress|environment-reset:progress/);
  assert.match(handler, /if \(result\.ok\)/);
  assert.match(handler, /app\.relaunch\(\)/);
  assert.match(handler, /app\.exit\(0\)/);
});

test("重置进行中禁止重复点击且部分失败不会显示成功", () => {
  const source = readRenderer();
  const settings = getFunctionBlock(source, "renderSettingsPage");
  const run = getFunctionBlock(source, "runEnvironmentReset");

  assert.match(settings, /environmentReset\.status === "running"/);
  assert.match(settings, /entry\.status === "failed"/);
  assert.match(run, /status: result && result\.ok \? "success" : "partial"/);
  assert.doesNotMatch(run, /Assistant|sendAgentChatMessage|Conversation/);
});
