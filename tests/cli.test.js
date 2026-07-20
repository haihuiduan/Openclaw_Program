const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
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

  if (mocks.roles) {
    mockModule("src/core/roles/registry.js", mocks.roles);
  }

  if (mocks.roleInstaller) {
    mockModule("src/core/roles/installer.js", mocks.roleInstaller);
  }

  return require(projectPath("src/cli/index.js"));
}

test("help 命令能正常执行", async () => {
  const { runCli } = loadCliWithMocks();
  const { output } = await captureConsole(() => runCli(["help"]));

  assert.match(output, /OpenClaw 安装助手/);
  assert.match(output, /openclaw-installer doctor/);
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

  assert.match(output, /openclaw-installer configure/);
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

  assert.match(output, /openclaw-installer verify/);
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

  assert.match(output, /openclaw-installer setup/);
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

test("help 输出包含完整 Role Lifecycle 命令", async () => {
  const { runCli } = loadCliWithMocks();
  const { output } = await captureConsole(() => runCli(["help"]));

  assert.match(output, /openclaw-installer roles list/);
  assert.match(output, /openclaw-installer roles inspect <id>/);
  assert.match(output, /openclaw-installer roles install <id>/);
  assert.match(output, /openclaw-installer roles list-installed/);
  assert.match(output, /openclaw-installer roles remove <id>/);
});

test("roles list 输出角色名称、版本和 Agent 数量", async () => {
  const { runCli } = loadCliWithMocks({
    roles: {
      listRoles: async () => [{
        id: "cross-border-team",
        name: "跨境电商运营团队",
        version: "1.0.0",
        agentCount: 3
      }]
    }
  });
  const { output, result } = await captureConsole(() => runCli(["roles", "list"]));

  assert.equal(result.length, 1);
  assert.match(output, /跨境电商运营团队/);
  assert.match(output, /1\.0\.0/);
  assert.match(output, /3 Agents/);
});

test("未知 roles 子命令会被拒绝", async () => {
  const { runCli } = loadCliWithMocks();

  await assert.rejects(
    () => runCli(["roles", "publish", "test-role"]),
    /未知 roles 子命令：publish/
  );
});

test("roles inspect 输出名称、版本、描述和 Agent 列表", async () => {
  const { runCli } = loadCliWithMocks({
    roleInstaller: {
      inspectRole: async () => ({
        id: "cross-border-team",
        name: "跨境电商运营团队",
        version: "1.0.0",
        description: "离线角色包",
        agentCount: 1,
        installed: true,
        installedVersion: "1.0.0",
        installedAt: "2026-07-20T00:00:00.000Z",
        agents: [{ id: "manager", name: "协调助手", description: "协调团队" }]
      }),
      installRole: async () => {},
      listInstalledRoles: async () => [],
      removeRole: async () => {}
    }
  });
  const { output } = await captureConsole(() => runCli(["roles", "inspect", "cross-border-team"]));

  assert.match(output, /名称：跨境电商运营团队/);
  assert.match(output, /版本：1\.0\.0/);
  assert.match(output, /描述：离线角色包/);
  assert.match(output, /Role ID：cross-border-team/);
  assert.match(output, /Agent 数量：1/);
  assert.match(output, /安装状态：已安装/);
  assert.match(output, /已安装版本：1\.0\.0/);
  assert.match(output, /协调助手 \(manager\)/);
});

test("roles list-installed 输出已安装角色且不要求 role id", async () => {
  const { runCli } = loadCliWithMocks({
    roleInstaller: {
      inspectRole: async () => {},
      installRole: async () => {},
      listInstalledRoles: async () => [{
        id: "cross-border-team",
        name: "跨境电商运营团队",
        version: "1.0.0",
        installedAt: "2026-07-20T00:00:00.000Z",
        status: "installed",
        agentCount: 3
      }],
      removeRole: async () => {}
    }
  });
  const { output, result } = await captureConsole(() => runCli(["roles", "list-installed"]));

  assert.equal(result.length, 1);
  assert.match(output, /cross-border-team/);
  assert.match(output, /跨境电商运营团队/);
  assert.match(output, /installed/);
  assert.match(output, /3 Agents/);
});

test("roles list-installed 无记录时输出清晰提示", async () => {
  const { runCli } = loadCliWithMocks({
    roleInstaller: {
      inspectRole: async () => {},
      installRole: async () => {},
      listInstalledRoles: async () => [],
      removeRole: async () => {}
    }
  });
  const { output } = await captureConsole(() => runCli(["roles", "list-installed"]));
  assert.match(output, /当前没有已安装角色/);
});

test("roles install 和 remove 分发到生命周期模块", async () => {
  const calls = [];
  const { runCli } = loadCliWithMocks({
    roleInstaller: {
      inspectRole: async () => {},
      installRole: async (roleId) => {
        calls.push(["install", roleId]);
        return { name: "测试角色", version: "1.0.0", agentCount: 2 };
      },
      listInstalledRoles: async () => [],
      removeRole: async (roleId) => {
        calls.push(["remove", roleId]);
        return { roleId, removed: true };
      }
    }
  });

  const installOutput = await captureConsole(() => runCli(["roles", "install", "test-role"]));
  const removeOutput = await captureConsole(() => runCli(["roles", "remove", "test-role"]));

  assert.deepEqual(calls, [["install", "test-role"], ["remove", "test-role"]]);
  assert.match(installOutput.output, /角色安装完成/);
  assert.match(removeOutput.output, /角色已删除/);
});

test("roles 生命周期命令缺少 role id 时会被拒绝", async () => {
  const { runCli } = loadCliWithMocks();
  await assert.rejects(() => runCli(["roles", "inspect"]), /需要提供 role id/);
});

test("roles CLI 发生参数错误时进程退出码为 1", () => {
  const result = spawnSync(process.execPath, [projectPath("bin/cli.js"), "roles", "inspect"], {
    encoding: "utf8"
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /需要提供 role id/);
});
