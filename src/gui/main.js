// Electron 主进程：负责创建 GUI 窗口和 IPC 路由，业务调用交给 service 层。
const path = require("node:path");
const os = require("node:os");
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { loadConfig } = require("../config");
const { createInstallDiagnosticLogger } = require("../utils/installDiagnosticLogger");
const { getCommandEnv } = require("../utils/shell");
const conversationService = require("./services/conversationService");
const installerService = require("./services/installerService");
const roleService = require("./services/roleService");
const { getProviderApiKeyGuidance } = require("./providerApiKeyGuidance");

let mainWindow = null;
let installDiagnosticLogger = null;

function getInstallLogsDirectory() {
  return path.join(app.getPath("userData"), "logs");
}

function getInstallDiagnosticLogPath() {
  return path.join(getInstallLogsDirectory(), "openclaw-install-debug.log");
}

function loadInstallerConfig() {
  return loadConfig({
    diagnosticLogPath: getInstallDiagnosticLogPath()
  });
}

function initializeInstallDiagnostics() {
  installDiagnosticLogger = createInstallDiagnosticLogger({
    logPath: getInstallDiagnosticLogPath(),
    homeDir: os.homedir()
  });
  installDiagnosticLogger.event("electron_runtime", {
    appIsPackaged: app.isPackaged,
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    execPath: process.execPath,
    resourcesPath: process.resourcesPath,
    cwd: process.cwd(),
    home: process.env.HOME || null,
    shell: process.env.SHELL || null,
    osHomeDir: os.homedir(),
    originalPath: process.env.PATH || "",
    finalCommandPath: getCommandEnv(process.env).PATH
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 860,
    minHeight: 640,
    title: "OpenClaw 工具箱",
    backgroundColor: "#f6f7f9",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

ipcMain.handle("doctor:run", async () => {
  return installerService.runDoctor(loadConfig(), {
    isDevRuntime: !app.isPackaged
  });
});

ipcMain.handle("install:run", async () => {
  return installerService.runInstall(loadInstallerConfig(), (stepUpdate) => {
    sendProgress("install:progress", stepUpdate);
  });
});

ipcMain.handle("update:run", async () => {
  return installerService.runUpdate(loadInstallerConfig(), (stepUpdate) => {
    sendProgress("install:progress", stepUpdate);
  });
});

ipcMain.handle("version:check", async () => {
  return installerService.checkOpenClawVersion();
});

ipcMain.handle("setup:run", async () => {
  return installerService.runSetup(loadInstallerConfig(), (stepUpdate) => {
    sendProgress("setup:progress", stepUpdate);
  });
});

ipcMain.handle("configure:run", async () => {
  return installerService.runConfigure(loadConfig());
});

ipcMain.handle("quick-configure:run", async (event, options) => {
  return installerService.runQuickConfigure(options || {}, {
    diagnosticLogger: installDiagnosticLogger
  });
});

ipcMain.handle("config-state:read", async () => {
  return installerService.readConfigState();
});

ipcMain.handle("config-state:save", async (event, state) => {
  return installerService.saveConfigState(state || {});
});

ipcMain.handle("verify:run", async () => {
  return installerService.runVerify(loadConfig());
});

ipcMain.handle("configure:done-check", async () => {
  return installerService.checkConfigureDoneFlag();
});

ipcMain.handle("dashboard:open", async () => {
  return installerService.openDashboard();
});

ipcMain.handle("dashboard:stop", async () => {
  return installerService.stopDashboard();
});

ipcMain.handle("role-marketplace:list", async () => {
  try {
    return await roleService.listMarketplaceRoles();
  } catch (error) {
    return {
      ok: false,
      roles: [],
      invalidRoleCount: 0,
      message: "角色列表暂时无法加载，请稍后重试。"
    };
  }
});

ipcMain.handle("my-roles:list", async () => {
  try {
    return await roleService.listMyRoles();
  } catch (error) {
    return {
      ok: false,
      roles: [],
      message: "我的角色暂时无法加载，请稍后重试。"
    };
  }
});

ipcMain.handle("role-marketplace:install", async (event, roleId) => {
  if (typeof roleId !== "string" || !roleId.trim()) {
    return {
      ok: false,
      roleId: null,
      installed: false,
      alreadyInstalled: false,
      message: "角色标识无效，无法安装。",
      marketplace: null
    };
  }

  try {
    return await roleService.installMarketplaceRole(roleId.trim());
  } catch (error) {
    return {
      ok: false,
      roleId: null,
      installed: false,
      alreadyInstalled: false,
      message: "角色安装未完成，请稍后重试。",
      marketplace: null
    };
  }
});

ipcMain.handle("role-marketplace:enable", async (event, roleId) => {
  if (typeof roleId !== "string" || !roleId.trim()) {
    return {
      ok: false,
      roleId: null,
      installed: false,
      enabled: false,
      alreadyEnabled: false,
      instanceCount: 0,
      instances: [],
      message: "角色标识无效，无法启用。",
      marketplace: null
    };
  }

  try {
    return await roleService.enableMarketplaceRole(roleId.trim());
  } catch (error) {
    return {
      ok: false,
      roleId: null,
      installed: false,
      enabled: false,
      alreadyEnabled: false,
      instanceCount: 0,
      instances: [],
      message: "角色启用未完成，请稍后重试。",
      marketplace: null
    };
  }
});

ipcMain.handle("chat-center:list", async () => {
  try {
    return await conversationService.listChatConversations();
  } catch (error) {
    return {
      ok: false,
      conversations: [],
      message: "聊天列表暂时无法加载，请稍后重试。"
    };
  }
});

ipcMain.handle("agent-chat:create", async (event, instanceId, title) => {
  if (
    typeof instanceId !== "string" ||
    !instanceId.trim() ||
    (title !== undefined && typeof title !== "string")
  ) {
    return safeAgentChatError("新聊天参数无效。");
  }
  try {
    return await conversationService.createNewAgentConversation(
      instanceId.trim(),
      title
    );
  } catch (error) {
    return safeAgentChatError("新聊天创建未完成，请稍后重试。");
  }
});

ipcMain.handle("agent-chat:open-existing", async (event, conversationId) => {
  if (typeof conversationId !== "string" || !conversationId.trim()) {
    return safeAgentChatError("聊天标识无效。");
  }
  try {
    return await conversationService.openChatConversation(
      conversationId.trim()
    );
  } catch (error) {
    return safeAgentChatError("暂时无法打开这段聊天，请稍后重试。");
  }
});

ipcMain.handle("agent-chat:messages", async (
  event,
  instanceId,
  conversationId,
  pagination
) => {
  if (
    typeof instanceId !== "string" ||
    !instanceId.trim() ||
    typeof conversationId !== "string" ||
    !conversationId.trim()
  ) {
    return safeAgentChatError("Conversation 标识无效。");
  }
  if (
    pagination !== undefined &&
    (!pagination || typeof pagination !== "object" || Array.isArray(pagination))
  ) {
    return safeAgentChatError("消息分页参数无效。");
  }
  try {
    return await conversationService.listConversationMessages(
      instanceId.trim(),
      conversationId.trim(),
      pagination || {}
    );
  } catch (error) {
    return safeAgentChatError("暂时无法读取对话消息，请稍后重试。");
  }
});

ipcMain.handle("agent-chat:send", async (
  event,
  instanceId,
  conversationId,
  content
) => {
  if (
    typeof instanceId !== "string" ||
    !instanceId.trim() ||
    typeof conversationId !== "string" ||
    !conversationId.trim() ||
    typeof content !== "string"
  ) {
    return safeAgentChatError("消息发送参数无效。");
  }
  try {
    return await conversationService.sendConversationMessage(
      instanceId.trim(),
      conversationId.trim(),
      content
    );
  } catch (error) {
    return safeAgentChatError("消息发送未完成，请稍后重试。");
  }
});

ipcMain.handle("agent-chat:reconcile", async (event, instanceId, conversationId) => {
  if (
    typeof instanceId !== "string" ||
    !instanceId.trim() ||
    typeof conversationId !== "string" ||
    !conversationId.trim()
  ) {
    return safeAgentChatError("Conversation 标识无效。");
  }
  try {
    return await conversationService.reconcileAgentConversation(
      instanceId.trim(),
      conversationId.trim()
    );
  } catch (error) {
    return safeAgentChatError("对话状态恢复未完成，请稍后重试。");
  }
});

ipcMain.handle("external:open", async (event, url) => {
  const allowedUrls = new Set([
    "https://nodejs.org/zh-cn/download"
  ]);

  if (!allowedUrls.has(url)) {
    return {
      success: false,
      ok: false,
      message: "不允许打开该链接。"
    };
  }

  await shell.openExternal(url);
  return {
    success: true,
    ok: true,
    message: "已打开外部链接。"
  };
});

ipcMain.handle("provider-api-key:open", async (event, providerId) => {
  const guidance = getProviderApiKeyGuidance(providerId);

  if (!guidance || !guidance.url.startsWith("https://")) {
    return {
      success: false,
      ok: false,
      message: "不支持该 AI 服务商，未打开任何链接。"
    };
  }

  try {
    await shell.openExternal(guidance.url);
    return {
      success: true,
      ok: true,
      message: "已在默认浏览器中打开官方 API Key 页面。"
    };
  } catch (error) {
    return {
      success: false,
      ok: false,
      message: "暂时无法打开官方页面，请稍后重试。"
    };
  }
});

ipcMain.handle("logs:open", async () => {
  const result = await installerService.openLogsDirectory(getInstallLogsDirectory());

  if (!result.ok) {
    return result;
  }

  const openError = await shell.openPath(result.logPath);

  if (openError) {
    return {
      success: false,
      ok: false,
      logPath: result.logPath,
      message: "无法打开安装日志目录：" + openError
    };
  }

  return result;
});

function sendProgress(channel, stepUpdate) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, stepUpdate);
  }
}

function safeAgentChatError(message) {
  return {
    ok: false,
    conversation: null,
    messages: [],
    hasMore: false,
    nextBeforeSequence: null,
    message
  };
}

app.whenReady().then(() => {
  initializeInstallDiagnostics();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
