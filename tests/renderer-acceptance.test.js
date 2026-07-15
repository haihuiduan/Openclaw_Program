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

test("可选顶部与侧栏节点缺失时初始化绑定有空值保护", () => {
  const source = readRenderer();

  assert.ok(source.includes("if (window.openClawInstaller && appStage)"));
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
