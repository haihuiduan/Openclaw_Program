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

test("execute_script 将统一 NPM_CONFIG_PREFIX 和 PATH 传给官方脚本", async () => {
  clearProjectModules();
  const fakeHome = "/Users/test-user";
  const managedPrefix = path.join(fakeHome, ".npm-global");
  const managedBin = path.join(managedPrefix, "bin");
  const installEnvironment = {
    HOME: fakeHome,
    PATH: [managedBin, "/usr/bin", "/bin"].join(path.delimiter),
    NPM_CONFIG_PREFIX: managedPrefix
  };
  const events = [];
  let commandCall = null;

  mockModule("src/utils/shell/index.js", {
    resolveCommand: async (command, options) => {
      assert.equal(command, "bash");
      assert.equal(options.env.NPM_CONFIG_PREFIX, managedPrefix);
      return {
        command,
        found: true,
        resolvedPath: "/bin/bash",
        exitCode: 0
      };
    },
    runCommand: async (command, args, options) => {
      commandCall = { command, args, options };
      return successfulCommand("");
    }
  });

  const step = require(projectPath(
    "src/core/workflow/steps/execute_script.js"
  ));
  const result = await step.run(createStepContext({
    installEnvironment,
    diagnosticEvents: events
  }));

  assert.equal(result.success, true);
  assert.equal(commandCall.command, "bash");
  assert.deepEqual(commandCall.args, ["/tmp/openclaw-install.sh"]);
  assert.equal(
    commandCall.options.env.NPM_CONFIG_PREFIX,
    managedPrefix
  );
  assert.equal(
    commandCall.options.env.PATH.split(path.delimiter)[0],
    managedBin
  );
  assert.equal(
    commandCall.command === "sudo"
      || commandCall.args.some((arg) => String(arg).includes("sudo")),
    false
  );
  const effectiveEnv = events.find(
    (entry) => entry.event === "install_script_effective_env"
  );
  assert.ok(effectiveEnv);
  assert.equal(effectiveEnv.details.npmConfigPrefix, managedPrefix);
  assert.equal(effectiveEnv.details.prefixBinInPath, true);
  clearProjectModules();
});

test("已有系统级 OpenClaw 时使用统一环境检测且不进入重复安装", async () => {
  clearProjectModules();
  const installEnvironment = createInstallEnvironment("/Users/test-user");
  const calls = [];

  mockModule("src/utils/shell/index.js", {
    resolveCommand: async (command, options) => {
      calls.push({ type: "resolve", command, options });
      return {
        command,
        found: true,
        resolvedPath: "/managed/bin/openclaw",
        exitCode: 0,
        signal: null,
        spawnError: null,
        timedOut: false
      };
    },
    runCommand: async (command, args, options) => {
      calls.push({ type: "run", command, args, options });
      return successfulCommand("openclaw 1.0.0\n");
    }
  });

  const step = require(projectPath(
    "src/core/workflow/steps/check_existing_install.js"
  ));
  const result = await step.run({
    config: {},
    installEnvironment,
    diagnosticLogger: createDiagnosticLogger(),
    logger: {
      info() {}
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.data.skipRemainingInstallSteps, true);
  assert.equal(
    calls.find((call) => call.type === "run").command,
    "/managed/bin/openclaw"
  );
  assert.equal(
    calls.every((call) => call.options.env === installEnvironment),
    true
  );
  clearProjectModules();
});

test("只找到命令文件但版本不可执行时不按已安装跳过安装", async () => {
  clearProjectModules();
  const installEnvironment = createInstallEnvironment("/Users/test-user");

  mockModule("src/utils/shell/index.js", {
    resolveCommand: async (command) => ({
      command,
      found: true,
      resolvedPath: "/managed/bin/openclaw",
      exitCode: 0,
      signal: null,
      spawnError: null,
      timedOut: false
    }),
    runCommand: async () => ({
      ...successfulCommand(""),
      code: 1,
      exitCode: 1,
      stderr: "cannot execute"
    })
  });

  const step = require(projectPath(
    "src/core/workflow/steps/check_existing_install.js"
  ));
  const result = await step.run({
    config: {},
    installEnvironment,
    diagnosticLogger: createDiagnosticLogger(),
    logger: {
      info() {}
    }
  });

  assert.equal(result.success, true);
  assert.equal(result.data.existingOpenClaw.installed, false);
  assert.equal(
    Object.hasOwn(result.data, "skipRemainingInstallSteps"),
    false
  );
  assert.match(result.message, /继续安装/);
  clearProjectModules();
});

test("安装验证从用户级 bin 解析 openclaw 并记录实际路径", async () => {
  clearProjectModules();
  const fakeHome = "/Users/test-user";
  const installEnvironment = createInstallEnvironment(fakeHome);
  const openClawPath = path.join(
    fakeHome,
    ".npm-global",
    "bin",
    "openclaw"
  );
  const events = [];

  mockModule("src/utils/shell/index.js", {
    getCommandEnv: (env) => env,
    resolveCommand: async (command, options) => {
      assert.equal(options.env, installEnvironment);
      return {
        command,
        found: true,
        resolvedPath: openClawPath,
        exitCode: 0,
        signal: null,
        spawnError: null,
        timedOut: false
      };
    },
    runCommand: async (command, args, options) => {
      assert.equal(command, openClawPath);
      assert.equal(options.env, installEnvironment);
      return successfulCommand("openclaw 1.0.0\n");
    }
  });

  const step = require(projectPath(
    "src/core/workflow/steps/verify_installation.js"
  ));
  const result = await step.run({
    installEnvironment,
    diagnosticLogger: createDiagnosticLogger(events),
    logger: {
      info() {}
    }
  });
  const verificationPath = events.find(
    (entry) => entry.event === "openclaw_verification_path"
  );

  assert.equal(result.success, true);
  assert.equal(verificationPath.details.resolvedPath, openClawPath);
  assert.equal(verificationPath.details.prefixBinInPath, true);
  clearProjectModules();
});

test("旧 checkpoint 指向 execute_script 时重试仍强制运行 Bootstrap 和已有安装检查", async (t) => {
  clearProjectModules();
  const tempDir = fs.mkdtempSync(path.join(
    os.tmpdir(),
    "openclaw-bootstrap-resume-"
  ));
  const statePath = path.join(tempDir, "workflow-state.json");
  const diagnosticLogPath = path.join(tempDir, "diagnostic.log");
  const installEnvironment = createInstallEnvironment(
    path.join(tempDir, "home")
  );
  const counts = {
    environment_check: 0,
    check_existing_install: 0,
    prepare_directory: 0,
    download_script: 0,
    execute: 0,
    verify_installation: 0
  };

  t.after(() => {
    clearProjectModules();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  fs.writeFileSync(statePath, JSON.stringify({
    workflow: "install",
    workflowLabel: "OpenClaw 安装流程",
    completedSteps: [
      "environment_check",
      "check_existing_install",
      "prepare_directory",
      "download_script"
    ],
    failedStep: "execute_script",
    tempState: {
      dir: null,
      scriptPath: "/tmp/openclaw-install.sh"
    },
    config: {
      targetDir: path.join(tempDir, "target")
    },
    timestamp: new Date().toISOString()
  }), "utf8");

  mockModule("src/utils/shell/index.js", {
    getCommandEnv: () => installEnvironment,
    resolveCommand: async (command) => ({
      command,
      found: true,
      resolvedPath: "/usr/bin/" + command,
      exitCode: 0,
      signal: null,
      spawnError: null,
      timedOut: false
    })
  });
  mockModule(
    "src/core/workflow/steps/environment_check.js",
    createCountedStep("environment_check", counts, {
      installEnvironment,
      commandEnv: installEnvironment
    })
  );
  mockModule(
    "src/core/workflow/steps/check_existing_install.js",
    createCountedStep("check_existing_install", counts)
  );
  mockModule(
    "src/core/workflow/steps/prepare_directory.js",
    createCountedStep("prepare_directory", counts)
  );
  mockModule(
    "src/core/workflow/steps/download_script.js",
    createCountedStep("download_script", counts)
  );
  mockModule("src/core/workflow/steps/execute_script.js", {
    id: "execute_script",
    label: "execute_script",
    onFail: "stop",
    async run(ctx) {
      counts.execute += 1;
      assert.equal(ctx.installEnvironment, installEnvironment);

      if (counts.execute === 1) {
        return {
          success: false,
          message: "first attempt failed",
          errorCode: "OPENCLAW_INSTALL_SCRIPT_FAILED"
        };
      }

      return {
        success: true,
        message: "ok"
      };
    }
  });
  mockModule(
    "src/core/workflow/steps/verify_installation.js",
    createCountedStep("verify_installation", counts, {
      version: "openclaw 1.0.0"
    })
  );

  const { runWorkflow } = require(projectPath(
    "src/core/workflow/engine.js"
  ));
  const context = {
    config: {
      targetDir: path.join(tempDir, "target"),
      runtimeStatePath: statePath,
      diagnosticLogPath,
      logDir: path.join(tempDir, "logs")
    }
  };

  const first = await runWorkflow("install", context);
  assert.equal(first.success, false);
  assert.equal(counts.environment_check, 1);
  assert.equal(counts.check_existing_install, 1);
  assert.equal(counts.prepare_directory, 0);
  assert.equal(counts.download_script, 0);
  const savedAfterFailure = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.equal(savedAfterFailure.schemaVersion, 2);
  assert.equal(savedAfterFailure.environmentVersion, 1);

  const second = await runWorkflow("install", context);
  assert.equal(second.success, true);
  assert.equal(counts.environment_check, 2);
  assert.equal(counts.check_existing_install, 2);
  assert.equal(counts.execute, 2);
  assert.equal(counts.verify_installation, 1);
  assert.equal(fs.existsSync(statePath), false);
});

function createInstallEnvironment(homeDir) {
  const prefix = path.join(homeDir, ".npm-global");

  return {
    HOME: homeDir,
    NPM_CONFIG_PREFIX: prefix,
    PATH: [
      path.join(prefix, "bin"),
      "/usr/bin",
      "/bin",
      "/opt/homebrew/bin"
    ].join(path.delimiter)
  };
}

function createStepContext(options = {}) {
  return {
    config: {
      installScriptTimeoutMs: 120000
    },
    tempState: {
      scriptPath: "/tmp/openclaw-install.sh"
    },
    installEnvironment: options.installEnvironment,
    diagnosticLogger: createDiagnosticLogger(
      options.diagnosticEvents
    ),
    logger: {
      info() {},
      warn() {}
    }
  };
}

function createDiagnosticLogger(events = []) {
  return {
    event(event, details) {
      events.push({ event, details });
    },
    error(event, details) {
      events.push({ event, details });
    },
    warn(event, details) {
      events.push({ event, details });
    }
  };
}

function createCountedStep(id, counts, data) {
  return {
    id,
    label: id,
    onFail: "stop",
    async run() {
      counts[id] += 1;
      return {
        success: true,
        message: "ok",
        ...(data ? { data } : {})
      };
    }
  };
}

function successfulCommand(stdout) {
  return {
    command: "test",
    args: [],
    code: 0,
    exitCode: 0,
    stdout,
    stderr: "",
    signal: null,
    timedOut: false,
    spawnError: null,
    durationMs: 1
  };
}
