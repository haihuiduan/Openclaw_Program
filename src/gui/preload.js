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
