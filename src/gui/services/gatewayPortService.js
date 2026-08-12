"use strict";

const fs = require("node:fs/promises");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { runCommand } = require("../../utils/shell");

const DEFAULT_GATEWAY_PORT = 18789;
const TOOLBOX_GATEWAY_PORTS = Array.from({ length: 21 }, (_, index) => 18789 + index);

async function readConfiguredGatewayPort(commandEnv = {}) {
  return (await readConfiguredGatewayPortState(commandEnv)).port;
}

async function readConfiguredGatewayPortState(commandEnv = {}) {
  const home = String(commandEnv.HOME || os.homedir() || "").trim();
  const stateDir = commandEnv.OPENCLAW_STATE_DIR || path.join(home, ".openclaw");
  const configPath = commandEnv.OPENCLAW_CONFIG_PATH || path.join(stateDir, "openclaw.json");
  try {
    const parsed = JSON.parse(await fs.readFile(configPath, "utf8"));
    const port = parsed && parsed.gateway && parsed.gateway.port;
    return validPort(port)
      ? { port, configured: true }
      : { port: DEFAULT_GATEWAY_PORT, configured: false };
  } catch (error) {
    return { port: DEFAULT_GATEWAY_PORT, configured: false };
  }
}

async function inspectGatewayPort(port, options = {}) {
  const commandOptions = {
    allowFailure: true,
    timeoutMs: 3000,
    env: options.commandEnv,
    commandEnvOptions: options.commandEnvOptions
  };
  const uid = typeof options.getUid === "function" ? options.getUid() : process.getuid?.();
  const user = typeof options.getUsername === "function"
    ? options.getUsername()
    : safeUsername();
  const [service, listener, bind] = await Promise.all([
    Number.isInteger(uid)
      ? runCommand("/bin/launchctl", ["print", `gui/${uid}/ai.openclaw.gateway`], commandOptions)
      : Promise.resolve(null),
    runCommand("/usr/sbin/lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-FpcuL"], commandOptions),
    (options.probePortAvailability || probePortAvailability)(port, options)
  ]);
  const launchAgentPid = parseLaunchAgentPid(service);
  const listeners = parseLsofListeners(listener);
  const listenerPid = listeners.length === 1 ? listeners[0].pid : null;
  const listenerUser = listeners.length === 1 ? listeners[0].user : null;
  const listenerPresent = listeners.length > 0 || bind.availability === "occupied";
  const matches = launchAgentPid && listenerPid
    ? launchAgentPid === listenerPid
    : listenerPresent ? false : "unknown";
  const conflict = listenerPresent && matches !== true;
  return {
    port,
    availability: bind.availability,
    available: bind.availability === "free" && listeners.length === 0,
    verified: bind.availability !== "unknown",
    listenerPresent,
    launchAgentPid,
    listenerPid,
    listenerMatchesLaunchAgent: matches,
    conflict,
    conflictKind: conflict && listenerUser && user && listenerUser !== user
      ? "CROSS_USER_GATEWAY_PORT_COLLISION"
      : conflict ? "EXTERNAL_PORT_CONFLICT" : null
  };
}

async function selectGatewayPort(options = {}) {
  const preferred = await readConfiguredGatewayPort(options.commandEnv);
  const candidates = [preferred, ...TOOLBOX_GATEWAY_PORTS.filter((port) => port !== preferred)];
  for (const port of candidates) {
    const state = await inspectGatewayPort(port, options);
    logSelectionCandidate(options.diagnosticLogger, preferred, state);
    if (state.listenerMatchesLaunchAgent === true || (state.available && !state.conflict)) {
      logSelectionCompleted(options.diagnosticLogger, preferred, port, "selected");
      return { ok: true, port, changed: port !== preferred, ownership: state, code: null };
    }
  }
  logSelectionCompleted(options.diagnosticLogger, preferred, null, "no_available_port");
  return {
    ok: false,
    port: null,
    changed: false,
    ownership: null,
    code: "NO_AVAILABLE_GATEWAY_PORT"
  };
}

function probePortAvailability(port, options = {}) {
  const createServer = options.createServer || net.createServer;
  return new Promise((resolve) => {
    let settled = false;
    let server;
    const finish = (availability, errorCode = null) => {
      if (settled) return;
      settled = true;
      if (server) server.removeAllListeners();
      resolve({ availability, errorCode });
    };
    try {
      server = createServer();
      server.unref();
      server.once("error", (error) => {
        finish(error && error.code === "EADDRINUSE" ? "occupied" : "unknown", error && error.code || null);
      });
      server.once("listening", () => {
        server.close((error) => finish(error ? "unknown" : "free", error && error.code || null));
      });
      server.listen({ host: "127.0.0.1", port, exclusive: true });
    } catch (error) {
      finish("unknown", error && error.code || null);
    }
  });
}

async function readManagedGatewayServicePortState(options = {}) {
  const uid = typeof options.getUid === "function" ? options.getUid() : process.getuid?.();
  if (!Number.isInteger(uid)) {
    return { status: "unavailable", port: null, reason: "uid_unavailable" };
  }
  const result = await runCommand(
    "/bin/launchctl",
    ["print", `gui/${uid}/ai.openclaw.gateway`],
    {
      allowFailure: true,
      timeoutMs: 3000,
      env: options.commandEnv,
      commandEnvOptions: options.commandEnvOptions
    }
  );
  if (exitCode(result) !== 0) {
    return { status: "unavailable", port: null, reason: "service_unavailable" };
  }
  const match = String(result.stdout || "").match(
    /OPENCLAW_GATEWAY_PORT\s*(?:=>|=)\s*["']?(\d+)["']?/m
  );
  const port = match ? Number(match[1]) : null;
  return validPort(port)
    ? { status: "available", port, reason: null }
    : { status: "unavailable", port: null, reason: "parse_failed" };
}

function logSelectionCandidate(logger, preferredPort, state) {
  if (!logger || typeof logger.event !== "function") return;
  try {
    logger.event("gateway_port_selection_candidate", {
      preferredPort,
      candidate: state.port,
      availability: state.availability,
      ownerPid: state.availability === "occupied"
        ? state.listenerPid || "unknown"
        : null,
      conflictKind: state.conflictKind
    });
  } catch (error) {}
}

function logSelectionCompleted(logger, preferredPort, selectedPort, result) {
  if (!logger || typeof logger.event !== "function") return;
  try {
    logger.event("gateway_port_selection_completed", {
      preferredPort,
      selectedPort,
      result
    });
  } catch (error) {}
}

function parseLaunchAgentPid(result) {
  if (!result || exitCode(result) !== 0) return null;
  const match = String(result.stdout || "").match(/^\s*pid\s*=\s*(\d+)\s*$/m);
  const pid = match ? Number(match[1]) : null;
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function parseLsofListeners(result) {
  if (!result || exitCode(result) !== 0) return [];
  const listeners = [];
  let current = null;
  for (const line of String(result.stdout || "").split("\n")) {
    if (line.startsWith("p")) {
      if (current && current.pid) listeners.push(current);
      current = { pid: Number(line.slice(1)), user: null };
    } else if (current && line.startsWith("L")) current.user = line.slice(1).trim() || null;
  }
  if (current && current.pid) listeners.push(current);
  return listeners.filter((item) => Number.isInteger(item.pid) && item.pid > 0);
}

function validPort(value) {
  return Number.isInteger(value) && value > 0 && value <= 65535;
}

function exitCode(result) {
  return result && Number.isInteger(result.exitCode) ? result.exitCode : result && result.code;
}

function safeUsername() {
  try { return os.userInfo().username; } catch (error) { return null; }
}

module.exports = {
  DEFAULT_GATEWAY_PORT,
  inspectGatewayPort,
  parseLaunchAgentPid,
  parseLsofListeners,
  probePortAvailability,
  readConfiguredGatewayPort,
  readConfiguredGatewayPortState,
  readManagedGatewayServicePortState,
  selectGatewayPort
};
