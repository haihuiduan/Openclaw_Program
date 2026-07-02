// Electron 主进程：负责创建 GUI 窗口和 IPC 路由，业务调用交给 service 层。
const path = require("node:path");
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { loadConfig } = require("../config");
const installerService = require("./services/installerService");

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 860,
    minHeight: 640,
    title: "OpenClaw Installer",
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
  return installerService.runDoctor(loadConfig());
});

ipcMain.handle("install:run", async () => {
  return installerService.runInstall(loadConfig(), (stepUpdate) => {
    sendProgress("install:progress", stepUpdate);
  });
});

ipcMain.handle("setup:run", async () => {
  return installerService.runSetup(loadConfig(), (stepUpdate) => {
    sendProgress("setup:progress", stepUpdate);
  });
});

ipcMain.handle("configure:run", async () => {
  return installerService.runConfigure(loadConfig());
});

ipcMain.handle("verify:run", async () => {
  return installerService.runVerify(loadConfig());
});

ipcMain.handle("configure:done-check", async () => {
  return installerService.checkConfigureDoneFlag();
});

ipcMain.handle("logs:open", async () => {
  const result = await installerService.openLogsDirectory();

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

app.whenReady().then(() => {
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
