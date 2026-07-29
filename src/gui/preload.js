// Electron preload：通过 contextBridge 暴露安全 API，renderer 不直接使用 Node.js API。
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("openClawInstaller", {
  appName: "OpenClaw 工具箱",
  stage: "关于本工具",
  runDoctor() {
    return ipcRenderer.invoke("doctor:run");
  },
  runInstall() {
    return ipcRenderer.invoke("install:run");
  },
  runUpdate() {
    return ipcRenderer.invoke("update:run");
  },
  checkOpenClawVersion() {
    return ipcRenderer.invoke("version:check");
  },
  runSetup() {
    return ipcRenderer.invoke("setup:run");
  },
  runConfigure() {
    return ipcRenderer.invoke("configure:run");
  },
  runQuickConfigure(options) {
    return ipcRenderer.invoke("quick-configure:run", options);
  },
  readConfigState() {
    return ipcRenderer.invoke("config-state:read");
  },
  saveConfigState(state) {
    return ipcRenderer.invoke("config-state:save", state);
  },
  runVerify() {
    return ipcRenderer.invoke("verify:run");
  },
  checkConfigureDone() {
    return ipcRenderer.invoke("configure:done-check");
  },
  openDashboard() {
    return ipcRenderer.invoke("dashboard:open");
  },
  stopDashboard() {
    return ipcRenderer.invoke("dashboard:stop");
  },
  listMarketplaceRoles() {
    return ipcRenderer.invoke("role-marketplace:list");
  },
  listMyRoles() {
    return ipcRenderer.invoke("my-roles:list");
  },
  installMarketplaceRole(roleId) {
    return ipcRenderer.invoke("role-marketplace:install", roleId);
  },
  enableMarketplaceRole(roleId) {
    return ipcRenderer.invoke("role-marketplace:enable", roleId);
  },
  listChatConversations() {
    return ipcRenderer.invoke("chat-center:list");
  },
  createNewAgentChat(instanceId, title) {
    return ipcRenderer.invoke("agent-chat:create", instanceId, title);
  },
  openExistingAgentChat(conversationId) {
    return ipcRenderer.invoke("agent-chat:open-existing", conversationId);
  },
  listAgentChatMessages(instanceId, conversationId, pagination) {
    return ipcRenderer.invoke(
      "agent-chat:messages",
      instanceId,
      conversationId,
      pagination
    );
  },
  sendAgentChatMessage(instanceId, conversationId, content) {
    return ipcRenderer.invoke(
      "agent-chat:send",
      instanceId,
      conversationId,
      content
    );
  },
  reconcileAgentChat(instanceId, conversationId) {
    return ipcRenderer.invoke(
      "agent-chat:reconcile",
      instanceId,
      conversationId
    );
  },
  openLogsDirectory() {
    return ipcRenderer.invoke("logs:open");
  },
  openExternal(url) {
    return ipcRenderer.invoke("external:open", url);
  },
  openProviderApiKeyPage(providerId) {
    return ipcRenderer.invoke("provider-api-key:open", providerId);
  },
  onInstallProgress(callback) {
    return subscribeToProgress("install:progress", callback);
  },
  onSetupProgress(callback) {
    return subscribeToProgress("setup:progress", callback);
  }
});


function subscribeToProgress(channel, callback) {
  const listener = (event, stepUpdate) => callback(stepUpdate);
  ipcRenderer.on(channel, listener);

  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}
