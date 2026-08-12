"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  clearProjectModules,
  mockModule,
  projectPath
} = require("./helpers");

function loadInstallerService({ resolution, results = [] } = {}) {
  clearProjectModules();
  const calls = [];
  const commandResults = [...results];

  mockModule("src/utils/shell/index.js", {
    commandExists: async () => true,
    resolveCommand: async (command, options) => {
      calls.push({ type: "resolve", command, options });
      return resolution || {
        command,
        found: false,
        resolvedPath: null,
        exitCode: 1,
        signal: null,
        spawnError: null,
        timedOut: false
      };
    },
    runCommand: async (command, args, options) => {
      calls.push({ type: "run", command, args, options });
      return commandResults.shift() || successfulCommand("");
    }
  });

  return {
    calls,
    service: require(projectPath("src/gui/services/installerService.js"))
  };
}

test("GUI 找不到真实 OpenClaw executable 时不显示已安装", async () => {
  const { calls, service } = loadInstallerService();
  const result = await service.checkOpenClawVersion();

  assert.equal(result.installed, false);
  assert.equal(result.currentVersion, null);
  assert.match(result.message, /未检测到 OpenClaw/);
  assert.equal(calls.filter((call) => call.type === "run").length, 0);
});

test("只解析到命令文件但 --version 失败时不显示已安装", async () => {
  const { calls, service } = loadInstallerService({
    resolution: resolvedManagedOpenClaw(),
    results: [{
      ...successfulCommand(""),
      code: 1,
      exitCode: 1,
      stderr: "cannot execute"
    }]
  });
  const result = await service.checkOpenClawVersion();
  const runCalls = calls.filter((call) => call.type === "run");

  assert.equal(result.installed, false);
  assert.equal(result.currentVersion, null);
  assert.match(result.message, /无法正常执行/);
  assert.equal(runCalls.length, 1);
  assert.equal(runCalls[0].command, "/Users/test/.npm-global/bin/openclaw");
  assert.deepEqual(runCalls[0].args, ["--version"]);
});

test("Electron 受管 PATH 找到的 binary 必须实际执行成功才显示已安装", async () => {
  const { calls, service } = loadInstallerService({
    resolution: resolvedManagedOpenClaw(),
    results: [
      successfulCommand("OpenClaw 2026.7.1-2\n"),
      successfulCommand("2026.7.1-2\n")
    ]
  });
  const result = await service.checkOpenClawVersion();
  const runCalls = calls.filter((call) => call.type === "run");

  assert.equal(result.installed, true);
  assert.equal(result.currentVersion, "OpenClaw 2026.7.1-2");
  assert.equal(runCalls[0].command, "/Users/test/.npm-global/bin/openclaw");
  assert.deepEqual(runCalls[0].args, ["--version"]);
  assert.equal(runCalls[1].command, "npm");
});

test("OpenClaw binary 超时或 spawn 失败时不查询版本更新", async () => {
  const { calls, service } = loadInstallerService({
    resolution: resolvedManagedOpenClaw(),
    results: [{
      ...successfulCommand("OpenClaw 2026.7.1-2\n"),
      timedOut: true,
      spawnError: {
        code: "EACCES"
      }
    }]
  });
  const result = await service.checkOpenClawVersion();

  assert.equal(result.installed, false);
  assert.equal(calls.filter((call) => call.type === "run").length, 1);
});

test("Doctor 对找到但不可执行的 OpenClaw 不再报告已安装", async () => {
  clearProjectModules();
  mockModule("src/utils/shell/index.js", {
    resolveCommand: async () => resolvedManagedOpenClaw(),
    runCommand: async () => ({
      ...successfulCommand(""),
      code: 1,
      exitCode: 1,
      stderr: "cannot execute"
    })
  });

  const { checkOpenClawStatus } = require(projectPath(
    "src/core/doctor/checks/openClawStatusCheck.js"
  ));
  const result = await checkOpenClawStatus();

  assert.equal(result.code, "OPENCLAW_COMMAND_UNUSABLE");
  assert.equal(result.level, "info");
  assert.doesNotMatch(result.message, /已安装/);
  assert.equal(result.repairAction, "install_openclaw");
  clearProjectModules();
});

test("全新 HOME 只有受管 prefix 生成 executable 后 GUI 才显示已安装", async (t) => {
  clearProjectModules();
  const root = fs.mkdtempSync(path.join(
    os.tmpdir(),
    "openclaw-gui-version-"
  ));
  const managedBin = path.join(root, ".npm-global", "bin");
  const openClawPath = path.join(managedBin, "openclaw");
  const npmPath = path.join(managedBin, "npm");
  const commandEnv = {
    HOME: root,
    PATH: "/usr/bin:/bin"
  };

  t.after(() => {
    clearProjectModules();
    fs.rmSync(root, {
      recursive: true,
      force: true
    });
  });

  fs.mkdirSync(managedBin, {
    recursive: true,
    mode: 0o700
  });

  const service = require(projectPath(
    "src/gui/services/installerService.js"
  ));
  const before = await service.checkOpenClawVersion({
    commandEnv,
    commandEnvOptions: {
      platform: "linux"
    }
  });

  assert.equal(before.installed, false);

  fs.writeFileSync(
    openClawPath,
    "#!/bin/sh\nprintf 'OpenClaw 2026.7.1-2\\n'\n",
    {
      encoding: "utf8",
      mode: 0o700
    }
  );
  fs.writeFileSync(
    npmPath,
    "#!/bin/sh\nprintf '2026.7.1-2\\n'\n",
    {
      encoding: "utf8",
      mode: 0o700
    }
  );

  const after = await service.checkOpenClawVersion({
    commandEnv,
    commandEnvOptions: {
      platform: "linux"
    }
  });
  const { resolveCommand: resolveRealCommand } = require(projectPath(
    "src/utils/shell/index.js"
  ));
  const terminalLikeResolution = await resolveRealCommand("openclaw", {
    env: commandEnv,
    commandEnvOptions: {
      includeManagedNpm: false,
      platform: "linux"
    }
  });

  assert.equal(after.installed, true);
  assert.equal(after.currentVersion, "OpenClaw 2026.7.1-2");
  assert.equal(terminalLikeResolution.found, false);
});

function resolvedManagedOpenClaw() {
  return {
    command: "openclaw",
    found: true,
    resolvedPath: "/Users/test/.npm-global/bin/openclaw",
    exitCode: 0,
    signal: null,
    spawnError: null,
    timedOut: false
  };
}

function successfulCommand(stdout) {
  return {
    code: 0,
    exitCode: 0,
    stdout,
    stderr: "",
    timedOut: false,
    spawnError: null,
    signal: null
  };
}
