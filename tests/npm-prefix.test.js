"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  clearProjectModules,
  mockModule,
  projectPath
} = require("./helpers");

const {
  ensureWritableNpmPrefix
} = require(projectPath("src/core/workflow/npmPrefix.js"));

test("/usr/local 不可写时使用工具箱管理的用户级 npm prefix", async () => {
  const scenario = await runBootstrapScenario({
    originalPrefix: "/usr/local",
    writableDirectories: []
  });

  assertManagedBootstrap(scenario);
  assert.equal(scenario.result.currentPrefix, "/usr/local");
  assert.equal(scenario.result.currentPrefixWritable, false);
  assert.equal(scenario.result.changed, true);
});

test("/opt/homebrew 不可写时同样使用工具箱管理的用户级 npm prefix", async () => {
  const scenario = await runBootstrapScenario({
    originalPrefix: "/opt/homebrew",
    writableDirectories: []
  });

  assertManagedBootstrap(scenario);
  assert.equal(scenario.result.currentPrefix, "/opt/homebrew");
  assert.equal(scenario.result.currentPrefixWritable, false);
});

test("GUI 解析到的 npm 与终端 prefix 不同时以实际 npm 检测并构造进程环境", async () => {
  const scenario = await runBootstrapScenario({
    npmPath: "/opt/homebrew/bin/npm",
    originalPrefix: "/usr/local",
    writableDirectories: []
  });

  assert.equal(scenario.commands.length, 1);
  assert.equal(scenario.commands[0].command, "/opt/homebrew/bin/npm");
  assert.deepEqual(
    scenario.commands[0].args,
    ["config", "get", "prefix"]
  );
  assert.equal(
    Object.hasOwn(scenario.commands[0].options.env, "NPM_CONFIG_PREFIX"),
    false
  );
  assert.equal(
    scenario.result.environment.NPM_CONFIG_PREFIX,
    scenario.userPrefix
  );
  assert.equal(
    scenario.result.environment.PATH.split(path.delimiter)[0],
    scenario.userBin
  );
});

test("已使用工具箱 prefix 时 Bootstrap 幂等且不执行 npm config set", async () => {
  const homeDir = path.join(path.sep, "Users", "test-user");
  const userPrefix = path.join(homeDir, ".npm-global");
  const userBin = path.join(userPrefix, "bin");
  const scenario = await runBootstrapScenario({
    homeDir,
    originalPrefix: userPrefix,
    writableDirectories: [userPrefix, userBin],
    basePath: [userBin, "/usr/bin", "/bin"].join(path.delimiter)
  });

  assert.equal(scenario.result.success, true);
  assert.equal(scenario.result.changed, false);
  assert.equal(scenario.commands.length, 1);
  assert.deepEqual(
    scenario.result.environment.PATH
      .split(path.delimiter)
      .filter((entry) => entry === userBin),
    [userBin]
  );
  assert.equal(
    scenario.commands.some((call) => call.args.includes("set")),
    false
  );
});

test("Bootstrap 创建目录、校验当前用户所有权并固定为 0700", async () => {
  const scenario = await runBootstrapScenario({
    originalPrefix: "/usr/local",
    writableDirectories: []
  });

  assert.deepEqual(
    scenario.fsApi.mkdirCalls.map((call) => call.directory),
    [scenario.userPrefix, scenario.userBin]
  );
  assert.deepEqual(
    scenario.fsApi.chmodCalls,
    [
      { directory: scenario.userPrefix, mode: 0o700 },
      { directory: scenario.userBin, mode: 0o700 }
    ]
  );
  assert.equal(scenario.result.success, true);
});

test("Bootstrap 记录完整且安全的 npm 环境诊断事件", async () => {
  const scenario = await runBootstrapScenario({
    originalPrefix: "/usr/local",
    writableDirectories: []
  });
  const eventNames = scenario.events.map((entry) => entry.event);

  assert.deepEqual(eventNames, [
    "npm_bootstrap_start",
    "npm_command_resolved",
    "npm_prefix_detected",
    "npm_prefix_writable",
    "npm_managed_prefix_selected",
    "npm_install_env_ready"
  ]);
  const ready = scenario.events.find(
    (entry) => entry.event === "npm_install_env_ready"
  );
  assert.equal(ready.details.effectivePrefix, scenario.userPrefix);
  assert.equal(ready.details.prefixBinInPath, true);
  assert.equal(ready.details.npmConfigPrefixSet, true);
});

test("environment_check 先执行 Bootstrap，再用同一环境运行 doctor", async () => {
  clearProjectModules();
  const order = [];
  const installEnvironment = {
    HOME: "/Users/test-user",
    PATH: "/Users/test-user/.npm-global/bin:/usr/bin:/bin",
    NPM_CONFIG_PREFIX: "/Users/test-user/.npm-global"
  };

  mockModule("src/core/workflow/npmPrefix.js", {
    ensureWritableNpmPrefix: async () => {
      order.push("bootstrap");
      return {
        success: true,
        changed: true,
        currentPrefix: "/usr/local",
        effectivePrefix: "/Users/test-user/.npm-global",
        binDirectory: "/Users/test-user/.npm-global/bin",
        environment: installEnvironment
      };
    }
  });
  mockModule("src/core/doctor/index.js", {
    runDoctor: async (config) => {
      order.push("doctor");
      assert.equal(config.commandEnv, installEnvironment);
      return {
        ok: true,
        checks: []
      };
    }
  });

  const environmentCheck = require(projectPath(
    "src/core/workflow/steps/environment_check.js"
  ));
  const result = await environmentCheck.run({
    config: {},
    logger: {
      info() {}
    },
    diagnosticLogger: {
      event() {}
    }
  });

  assert.deepEqual(order, ["bootstrap", "doctor"]);
  assert.equal(result.success, true);
  assert.equal(result.data.installEnvironment, installEnvironment);
  assert.match(result.message, /用户级 npm 安装环境/);
  clearProjectModules();
});

async function runBootstrapScenario(options = {}) {
  const homeDir = options.homeDir
    || path.join(path.sep, "Users", "test-user");
  const userPrefix = path.join(homeDir, ".npm-global");
  const userBin = path.join(userPrefix, "bin");
  const fsApi = createFakeFs({
    writableDirectories: options.writableDirectories || []
  });
  const commands = [];
  const events = [];
  const npmPath = options.npmPath || "/opt/homebrew/bin/npm";
  const basePath = options.basePath || "/usr/bin:/bin:/opt/homebrew/bin";
  const result = await ensureWritableNpmPrefix({
    diagnosticLogger: {
      event(event, details) {
        events.push({ event, details });
      }
    }
  }, {
    fs: fsApi,
    homeDir,
    baseEnv: {
      HOME: homeDir,
      PATH: basePath
    },
    getUid: () => 501,
    async resolveCommand(command, resolverOptions) {
      assert.equal(command, "npm");
      assert.equal(resolverOptions.commandEnvOptions.includeManagedNpm, false);
      return {
        command,
        found: true,
        resolvedPath: npmPath,
        exitCode: 0,
        signal: null,
        spawnError: null,
        timedOut: false
      };
    },
    async runCommand(command, args, commandOptions) {
      commands.push({
        command,
        args,
        options: commandOptions
      });
      return successfulCommand(
        String(options.originalPrefix || "/usr/local") + "\n"
      );
    }
  });

  return {
    result,
    fsApi,
    commands,
    events,
    homeDir,
    userPrefix,
    userBin
  };
}

function assertManagedBootstrap(scenario) {
  assert.equal(scenario.result.success, true);
  assert.equal(scenario.result.effectivePrefix, scenario.userPrefix);
  assert.equal(
    scenario.result.environment.NPM_CONFIG_PREFIX,
    scenario.userPrefix
  );
  assert.equal(
    scenario.result.environment.PATH.split(path.delimiter)[0],
    scenario.userBin
  );
  assert.equal(
    scenario.commands.some((call) => call.args.includes("set")),
    false
  );
}

function successfulCommand(stdout) {
  return {
    exitCode: 0,
    code: 0,
    stdout,
    stderr: "",
    timedOut: false,
    spawnError: null
  };
}

function createFakeFs(options) {
  const writableDirectories = new Set(options.writableDirectories || []);
  const existingDirectories = new Set(options.writableDirectories || []);
  const mkdirCalls = [];
  const chmodCalls = [];

  return {
    mkdirCalls,
    chmodCalls,
    async access(directory) {
      if (!writableDirectories.has(directory)) {
        const error = new Error("permission denied");
        error.code = "EACCES";
        throw error;
      }
    },
    async chmod(directory, mode) {
      chmodCalls.push({ directory, mode });
    },
    async lstat(directory) {
      if (!existingDirectories.has(directory)) {
        const error = new Error("not found");
        error.code = "ENOENT";
        throw error;
      }
      return {
        uid: 501,
        isDirectory: () => true,
        isSymbolicLink: () => false
      };
    },
    async mkdir(directory, mkdirOptions) {
      mkdirCalls.push({
        directory,
        options: mkdirOptions
      });
      existingDirectories.add(directory);
      writableDirectories.add(directory);
    }
  };
}
