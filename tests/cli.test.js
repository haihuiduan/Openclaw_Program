const assert = require("node:assert/strict");
const test = require("node:test");

const {
  captureConsole,
  clearProjectModules,
  mockModule,
  projectPath
} = require("./helpers");

function loadCliWithMocks(mocks = {}) {
  clearProjectModules();

  if (mocks.config) {
    mockModule("src/config/index.js", mocks.config);
  }

  if (mocks.doctor) {
    mockModule("src/core/doctor/index.js", mocks.doctor);
  }

  if (mocks.installer) {
    mockModule("src/core/installer/index.js", mocks.installer);
  }

  if (mocks.configure) {
    mockModule("src/core/configure/index.js", mocks.configure);
  }

  if (mocks.verify) {
    mockModule("src/core/verify/index.js", mocks.verify);
  }

  if (mocks.setup) {
    mockModule("src/core/setup/index.js", mocks.setup);
  }

  return require(projectPath("src/cli/index.js"));
}

test("help 命令能正常执行", async () => {
  const { runCli } = loadCliWithMocks();
  const { output } = await captureConsole(() => runCli(["help"]));

  assert.match(output, /OpenClaw 安装助手/);
  assert.match(output, /openclaw doctor/);
});

test("version 命令输出 package.json 里的版本号", async () => {
  const { version } = require(projectPath("package.json"));
  const { runCli } = loadCliWithMocks();
  const { output } = await captureConsole(() => runCli(["version"]));

  assert.equal(output.trim(), version);
});

test("未知命令会抛出中文错误", async () => {
  const { runCli } = loadCliWithMocks();

  await assert.rejects(
    () => runCli(["unknown-command"]),
    /未知命令：unknown-command/
  );
});

test("install 返回 ok:false 时设置 process.exitCode = 1", async () => {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;

  const { runCli } = loadCliWithMocks({
    installer: {
      installOpenClaw: async () => ({
        ok: false,
        message: "安装失败"
      })
    }
  });

  await captureConsole(() => runCli(["install"]));

  assert.equal(process.exitCode, 1);
  process.exitCode = previousExitCode;
});

test("--dry-run 能正确解析为 dryRun: true", async () => {
  let receivedOverrides = null;
  const { runCli } = loadCliWithMocks({
    config: {
      loadConfig: (overrides) => {
        receivedOverrides = overrides;
        return overrides;
      }
    },
    installer: {
      installOpenClaw: async () => ({
        ok: true,
        message: "ok"
      })
    }
  });

  await captureConsole(() => runCli(["install", "--dry-run"]));

  assert.equal(receivedOverrides.dryRun, true);
});

test("--target-dir 能正确解析为 targetDir", async () => {
  let receivedOverrides = null;
  const { runCli } = loadCliWithMocks({
    config: {
      loadConfig: (overrides) => {
        receivedOverrides = overrides;
        return overrides;
      }
    },
    installer: {
      installOpenClaw: async () => ({
        ok: true,
        message: "ok"
      })
    }
  });

  await captureConsole(() => runCli(["install", "--target-dir", "/tmp/openclaw-test"]));

  assert.equal(receivedOverrides.targetDir, "/tmp/openclaw-test");
});

test("--target-dir 缺少路径时抛出中文错误", async () => {
  const { runCli } = loadCliWithMocks();

  await assert.rejects(
    () => runCli(["install", "--target-dir"]),
    /--target-dir 需要提供路径/
  );
});


test("help 输出包含 configure 命令", async () => {
  const { runCli } = loadCliWithMocks();
  const { output } = await captureConsole(() => runCli(["help"]));

  assert.match(output, /openclaw configure/);
  assert.match(output, /启动 OpenClaw 官方配置向导/);
});

test("configure 命令会调用 core configure 并输出中文结果", async () => {
  let receivedConfig = null;
  const { runCli } = loadCliWithMocks({
    configure: {
      runConfigure: async (config) => {
        receivedConfig = config;
        return {
          ok: true,
          message: "OpenClaw 官方配置流程已完成。"
        };
      }
    }
  });

  const { output } = await captureConsole(() => runCli(["configure", "--dry-run"]));

  assert.equal(receivedConfig.dryRun, true);
  assert.match(output, /官方配置流程已完成/);
});


test("help 输出包含 verify 命令", async () => {
  const { runCli } = loadCliWithMocks();
  const { output } = await captureConsole(() => runCli(["help"]));

  assert.match(output, /openclaw verify/);
  assert.match(output, /验证 OpenClaw 是否已安装并基本可用/);
});

test("CLI 分发 verify 命令正常", async () => {
  let receivedConfig = null;
  const { runCli } = loadCliWithMocks({
    verify: {
      runVerify: async (config) => {
        receivedConfig = config;
        return {
          ok: true,
          dryRun: true,
          checks: []
        };
      }
    }
  });

  const { output } = await captureConsole(() => runCli(["verify", "--dry-run"]));

  assert.equal(receivedConfig.dryRun, true);
  assert.match(output, /OpenClaw 验证预览/);
});


test("help 输出包含 setup 命令", async () => {
  const { runCli } = loadCliWithMocks();
  const { output } = await captureConsole(() => runCli(["help"]));

  assert.match(output, /openclaw setup/);
  assert.match(output, /一键准备流程/);
});

test("CLI 分发 setup 命令正常", async () => {
  let receivedConfig = null;
  const { runCli } = loadCliWithMocks({
    setup: {
      runSetup: async (config) => {
        receivedConfig = config;
        return {
          ok: true,
          dryRun: true
        };
      }
    }
  });

  const { output } = await captureConsole(() => runCli(["setup", "--dry-run"]));

  assert.equal(receivedConfig.dryRun, true);
  assert.match(output, /OpenClaw 一键准备流程预览/);
});
