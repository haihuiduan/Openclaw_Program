"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { resolveCommand, runCommand } = require("../../utils/shell");
const { getManagedNpmBinDirectory, getManagedNpmPrefix } = require("../../utils/shell/env");

const APP_BUNDLE_ID = "com.haihuiduan.openclawtoolbox";
const APP_NAME = "OpenClaw 工具箱";
const TEMP_DIRECTORY_PREFIX = "openclaw-installer-";
const DEFAULT_GATEWAY_PORT = 18789;

function createEnvironmentResetService(options = {}) {
  const settings = resolveSettings(options);
  let running = false;
  return {
    async reset(input = {}) {
      if (running) {
        return makeResult(false, "busy", [], false, "重置正在进行中，请勿重复操作。");
      }
      running = true;
      try {
        return await executeReset(settings, input.onProgress);
      } finally {
        running = false;
      }
    }
  };
}

async function executeReset(settings, onProgress) {
  progress(onProgress, "prepare", "正在检查可安全清理的当前用户数据");
  await resolveCanonicalRoots(settings);
  if (settings.diagnosticLogger && typeof settings.diagnosticLogger.event === "function") {
    settings.diagnosticLogger.event("environment_reset_start", { mode: "full", backup: false });
  }
  const targets = await createResetTargets(settings);
  const external = await detectExternalOpenClaw(settings);
  const categories = [await stopGateway(settings, targets.gateway[0], onProgress)];
  for (const group of [
    ["managed-openclaw", "OpenClaw CLI", targets.managedOpenClaw],
    ["openclaw-state", "OpenClaw 用户数据", targets.openClawState],
    ["toolbox-data", "工具箱本地数据", targets.toolboxData],
    ["temporary-data", "工具箱临时文件", targets.temporaryData]
  ]) {
    categories.push(await removeCategory(settings, ...group, onProgress));
  }
  const ok = !categories.some((item) => item.status === "failed") && !external;
  progress(onProgress, "complete", ok ? "环境清理完成" : "环境清理部分完成");
  const message = ok
    ? "环境已恢复到首次安装状态。"
    : external
      ? "用户数据已尽量清理，但检测到工具箱管理范围外的 OpenClaw，未将其删除。"
      : "部分数据未能清理，请重试或检查当前用户的文件权限。";
  return makeResult(ok, ok ? "success" : "partial", categories, external, message);
}

async function resolveCanonicalRoots(settings) {
  settings.homeRealPath = await requiredRealpath(settings.fs, settings.homeDir);
  settings.tempRealPath = await requiredRealpath(settings.fs, settings.tempDir);
  const fallback = path.join(
    settings.homeRealPath,
    path.relative(settings.homeDir, settings.managedPrefix)
  );
  try {
    settings.managedRealPath = path.resolve(
      await settings.fs.realpath(settings.managedPrefix)
    );
  } catch (error) {
    settings.managedRealPath = path.resolve(fallback);
  }
}

async function createResetTargets(settings) {
  const home = settings.homeDir;
  const library = path.join(home, "Library");
  const appPaths = [
    ["Application Support", APP_NAME], ["Application Support", APP_BUNDLE_ID],
    ["Application Support", "openclaw-installer"], ["Caches", APP_NAME],
    ["Caches", APP_BUNDLE_ID], ["Logs", APP_NAME], ["Logs", APP_BUNDLE_ID],
    ["Preferences", `${APP_BUNDLE_ID}.plist`],
    ["Saved Application State", `${APP_BUNDLE_ID}.savedState`]
  ].map((parts) => path.join(library, ...parts));
  const allowedAppPaths = new Set(appPaths.map((item) => path.resolve(item)));
  let tempEntries = [];
  try {
    tempEntries = await settings.fs.readdir(settings.tempDir, { withFileTypes: true });
  } catch (error) {
    if (!error || error.code !== "ENOENT") {
      throw safeError("TEMP_SCAN_FAILED");
    }
  }
  const groups = {
    gateway: [target(path.join(
      library, "LaunchAgents", "ai.openclaw.gateway.plist"
    ))],
    managedOpenClaw: [
      target(path.join(settings.managedBin, "openclaw")),
      target(path.join(
        settings.managedPrefix, "lib", "node_modules", "openclaw"
      ))
    ],
    openClawState: [target(path.join(home, ".openclaw"))],
    toolboxData: [
      target(path.join(home, ".openclaw-installer")),
      ...[...allowedAppPaths].map((item) => target(item))
    ],
    temporaryData: tempEntries
      .filter((entry) => entry.name.startsWith(TEMP_DIRECTORY_PREFIX))
      .map((entry) => target(path.join(settings.tempDir, entry.name), "temp"))
  };
  const seen = new Set();
  for (const group of Object.values(groups)) {
    for (let index = group.length - 1; index >= 0; index -= 1) {
      validateTarget(group[index], settings);
      if (seen.has(group[index].path)) {
        group.splice(index, 1);
      } else {
        seen.add(group[index].path);
      }
    }
  }
  return groups;
}

async function detectExternalOpenClaw(settings) {
  const managedCli = path.join(settings.managedBin, "openclaw");
  if (await exists(settings.fs, managedCli)
    && !(await isManagedExecutable(settings, managedCli))) {
    return true;
  }
  const env = {
    ...settings.baseEnv,
    HOME: settings.homeDir,
    PATH: String(settings.baseEnv.PATH || "")
      .split(path.delimiter)
      .filter((item) => path.resolve(item || ".") !== settings.managedBin)
      .join(path.delimiter)
  };
  try {
    const found = await settings.resolveCommand("openclaw", {
      env,
      commandEnvOptions: { homeDir: settings.homeDir, includeManagedNpm: false }
    });
    return Boolean(found && found.found && found.resolvedPath);
  } catch (error) {
    return true;
  }
}

async function stopGateway(settings, launchAgent, onProgress) {
  progress(onProgress, "gateway", "正在停止当前用户 Gateway");
  const managedGateway = await inspectManagedGateway(settings);
  const managedCli = path.join(settings.managedBin, "openclaw");
  if (await exists(settings.fs, managedCli)
    && await isManagedExecutable(settings, managedCli)) {
    for (const args of [["gateway", "stop"], ["gateway", "uninstall"]]) {
      await safeRun(settings, managedCli, args);
    }
  }
  if (await exists(settings.fs, launchAgent.path)) {
    const uid = settings.getUid();
    if (Number.isInteger(uid) && uid >= 0) {
      await safeRun(
        settings, "/bin/launchctl", ["bootout", `gui/${uid}`, launchAgent.path]
      );
    }
    await removeOne(settings, launchAgent);
  }
  const verification = await verifyGatewayStopped(
    settings,
    launchAgent.path,
    managedGateway
  );
  const issues = verification.clean
    ? []
    : ["Gateway 服务未能完全清理"];
  if (settings.diagnosticLogger
    && typeof settings.diagnosticLogger.event === "function") {
    settings.diagnosticLogger.event("environment_reset_gateway_verified", {
      serviceAbsent: verification.serviceAbsent,
      launchAgentAbsent: verification.launchAgentAbsent,
      portAvailable: verification.portAvailable,
      managedListenerAbsent: verification.managedListenerAbsent,
      clean: verification.clean
    });
  }
  return makeCategory("gateway", "Gateway 服务", issues, issues.length ? 0 : 1);
}

async function inspectManagedGateway(settings) {
  const uid = settings.getUid();
  const port = await readGatewayPort(settings);
  if (!Number.isInteger(uid) || uid < 0) {
    return { port, serviceKnown: false, pid: null };
  }
  const service = await safeRun(
    settings,
    "/bin/launchctl",
    ["print", `gui/${uid}/ai.openclaw.gateway`]
  );
  return {
    port,
    serviceKnown: service.exitCode === 0 || launchctlServiceAbsent(service),
    pid: parseLaunchctlPid(service)
  };
}

async function verifyGatewayStopped(settings, launchAgentPath, managedGateway) {
  const uid = settings.getUid();
  let serviceAbsent = false;
  if (Number.isInteger(uid) && uid >= 0) {
    const service = await safeRun(
      settings,
      "/bin/launchctl",
      ["print", `gui/${uid}/ai.openclaw.gateway`]
    );
    serviceAbsent = launchctlServiceAbsent(service);
  }

  const port = await safeRun(
    settings,
    "/usr/sbin/lsof",
    ["-nP", `-iTCP:${managedGateway.port}`, "-sTCP:LISTEN", "-FpcuL"]
  );
  const portAvailable = lsofReportsNoListener(port);
  const listeners = parseLsofPids(port);
  const listenerStateKnown = portAvailable || (port.exitCode === 0 && listeners.length > 0);
  const managedListenerAbsent = managedGateway.serviceKnown && listenerStateKnown && (
    managedGateway.pid === null || !listeners.includes(managedGateway.pid)
  );
  const launchAgentAbsent = !(await exists(settings.fs, launchAgentPath));

  return {
    serviceAbsent,
    launchAgentAbsent,
    portAvailable,
    managedListenerAbsent,
    clean: serviceAbsent && launchAgentAbsent && managedListenerAbsent
  };
}

async function readGatewayPort(settings) {
  try {
    const configPath = path.join(settings.homeDir, ".openclaw", "openclaw.json");
    const config = JSON.parse(await settings.fs.readFile(configPath, "utf8"));
    const port = config && config.gateway && config.gateway.port;
    return Number.isInteger(port) && port > 0 && port <= 65535
      ? port
      : DEFAULT_GATEWAY_PORT;
  } catch (error) {
    return DEFAULT_GATEWAY_PORT;
  }
}

async function removeCategory(settings, id, label, targets, onProgress) {
  progress(onProgress, id, `正在清理${label}`);
  const issues = [];
  let removedCount = 0;
  for (const item of targets) {
    const removal = await removeOne(settings, item);
    if (!removal.ok) issues.push(`${label}未能完全清理`);
    else if (removal.removed) removedCount += 1;
  }
  return makeCategory(id, label, issues, removedCount);
}

async function removeOne(settings, item) {
  try {
    const stat = await settings.fs.lstat(item.path);
    if (stat.isSymbolicLink()) await settings.fs.unlink(item.path);
    else {
      validateLocation(await settings.fs.realpath(item.path), item.scope, settings);
      if (stat.isDirectory()) {
        await settings.fs.rm(item.path, { recursive: true, force: false });
      } else await settings.fs.unlink(item.path);
    }
    return { ok: !(await exists(settings.fs, item.path)), removed: true };
  } catch (error) {
    return error && error.code === "ENOENT"
      ? { ok: true, removed: false }
      : { ok: false, removed: false };
  }
}

function validateTarget(item, settings) {
  validateLocation(item.path, item.scope, settings);
  const protectedPaths = [
    settings.homeDir, settings.managedPrefix, "Library", "Applications",
    "Desktop", "Documents", "Downloads"
  ].map((value) => path.resolve(value === settings.homeDir
    || value === settings.managedPrefix ? value : path.join(settings.homeDir, value)));
  if (protectedPaths.includes(item.path)) throw safeError("UNSAFE_RESET_TARGET");
}

function validateLocation(value, scope, settings) {
  const resolved = path.resolve(value);
  if (scope === "temp") {
    const validParent = [settings.tempDir, settings.tempRealPath]
      .includes(path.dirname(resolved));
    if (!validParent || !path.basename(resolved).startsWith(TEMP_DIRECTORY_PREFIX)) {
      throw safeError("UNSAFE_RESET_TARGET");
    }
    return;
  }
  const homeRoot = resolved === settings.homeRealPath
    || resolved.startsWith(`${settings.homeRealPath}${path.sep}`)
    ? settings.homeRealPath
    : settings.homeDir;
  const relative = path.relative(homeRoot, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw safeError("UNSAFE_RESET_TARGET");
  }
}

function resolveSettings(options) {
  const homeDir = path.resolve(options.homeDir || os.homedir());
  const baseEnv = { ...(options.baseEnv || process.env), HOME: homeDir };
  const managedPrefix = path.resolve(
    options.managedPrefix || getManagedNpmPrefix(baseEnv, homeDir)
  );
  return {
    fs: options.fs || fs, homeDir,
    tempDir: path.resolve(options.tempDir || os.tmpdir()),
    baseEnv, managedPrefix,
    managedBin: path.resolve(getManagedNpmBinDirectory(baseEnv, homeDir, managedPrefix)),
    runCommand: options.runCommand || runCommand,
    resolveCommand: options.resolveCommand || resolveCommand,
    getUid: options.getUid || (() => typeof process.getuid === "function"
      ? process.getuid() : null),
    diagnosticLogger: options.diagnosticLogger || null
  };
}

async function safeRun(settings, command, args) {
  try {
    return await settings.runCommand(command, args, {
      allowFailure: true, timeoutMs: 15000,
      env: { ...settings.baseEnv, HOME: settings.homeDir },
      commandEnvOptions: { homeDir: settings.homeDir }
    });
  } catch (error) {
    return { exitCode: null, stdout: "", stderr: "", spawnError: true };
  }
}

function launchctlServiceAbsent(value) {
  if (!value || value.timedOut || value.spawnError || value.exitCode === 0) {
    return false;
  }
  return /could not find service|service not found|no such process/i.test(
    `${value.stdout || ""}\n${value.stderr || ""}`
  );
}

function lsofReportsNoListener(value) {
  return Boolean(
    value &&
    value.exitCode === 1 &&
    !value.timedOut &&
    !value.spawnError
  );
}

function parseLaunchctlPid(value) {
  if (!value || value.exitCode !== 0) return null;
  const match = String(value.stdout || "").match(/^\s*pid\s*=\s*(\d+)\s*$/m);
  const pid = match ? Number(match[1]) : null;
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function parseLsofPids(value) {
  if (!value || value.exitCode !== 0) return [];
  return [...String(value.stdout || "").matchAll(/^p(\d+)$/gm)]
    .map((match) => Number(match[1]))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

async function exists(fsApi, value) {
  try {
    await fsApi.lstat(value);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function isManagedExecutable(settings, value) {
  try {
    const resolved = path.resolve(await settings.fs.realpath(value));
    const relative = path.relative(settings.managedRealPath, resolved);
    return !relative.startsWith("..") && !path.isAbsolute(relative);
  } catch (error) { return false; }
}

async function requiredRealpath(fsApi, value) {
  try { return path.resolve(await fsApi.realpath(value)); }
  catch (error) { throw safeError("RESET_ROOT_UNAVAILABLE"); }
}

function target(value, scope = "home") { return { path: path.resolve(value), scope }; }

function progress(callback, stage, message) {
  if (typeof callback === "function") callback({ stage, message });
}

function makeCategory(id, label, issues, removedCount) {
  return {
    id, label,
    status: issues.length ? "failed" : "completed",
    removedCount,
    issues: [...new Set(issues)]
  };
}

function makeResult(ok, status, categories, externalOpenClawDetected, message) {
  return { ok, status, externalOpenClawDetected, categories, message };
}

function safeError(code) {
  const error = new Error("重置目标不符合安全规则。");
  error.code = code;
  return error;
}

module.exports = {
  APP_BUNDLE_ID, APP_NAME, createEnvironmentResetService,
  TEMP_DIRECTORY_PREFIX
};
