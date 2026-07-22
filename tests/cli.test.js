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

  if (mocks.instances) {
    mockModule("src/core/agent-instances/manager.js", mocks.instances);
  }

  if (mocks.teams) {
    mockModule("src/core/teams/manager.js", mocks.teams);
  }

  if (mocks.projects) {
    mockModule("src/core/projects/manager.js", mocks.projects);
  }

  if (mocks.tasks) {
    mockModule("src/core/tasks/manager.js", mocks.tasks);
  }

  if (mocks.executions) {
    mockModule("src/core/executions/manager.js", mocks.executions);
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

test("help 输出包含 Phase 3 Agent Instance 命令且不宣称支持 disable", async () => {
  const { runCli } = loadCliWithMocks();
  const { output } = await captureConsole(() => runCli(["help"]));

  assert.match(output, /openclaw-installer instances list/);
  assert.match(output, /openclaw-installer instances inspect <id>/);
  assert.match(output, /openclaw-installer instances register <role-id> <agent-id>/);
  assert.match(output, /openclaw-installer instances reconcile/);
  assert.doesNotMatch(output, /instances disable|instances delete|instances bind/);
});

test("instances list 和 inspect 分发到 Agent Instance Manager", async () => {
  const calls = [];
  const record = {
    instanceId: "test-role-worker",
    roleId: "test-role",
    roleVersion: "1.0.0",
    roleAgentId: "worker",
    status: "registered",
    workspacePath: "/tmp/workspace",
    agentDir: "/tmp/agent-dir",
    registeredAt: "2026-07-20T00:00:00.000Z",
    lastReconciledAt: "2026-07-20T00:00:00.000Z",
    drift: []
  };
  const { runCli } = loadCliWithMocks({
    instances: {
      listInstances: async () => {
        calls.push(["list"]);
        return [record];
      },
      inspectInstance: async (instanceId) => {
        calls.push(["inspect", instanceId]);
        return record;
      },
      reconcileInstances: async () => {},
      registerInstance: async () => {}
    }
  });

  const listed = await captureConsole(() => runCli(["instances", "list"]));
  const inspected = await captureConsole(() => runCli(["instances", "inspect", record.instanceId]));
  assert.deepEqual(calls, [["list"], ["inspect", "test-role-worker"]]);
  assert.match(listed.output, /test-role-worker.*test-role\/worker.*已注册/);
  assert.match(inspected.output, /Instance ID：test-role-worker/);
  assert.match(inspected.output, /漂移：无/);
});

test("instances register 接收 role id 与 role agent id", async () => {
  const calls = [];
  const { runCli } = loadCliWithMocks({
    instances: {
      listInstances: async () => [],
      inspectInstance: async () => {},
      reconcileInstances: async () => {},
      registerInstance: async (roleId, roleAgentId) => {
        calls.push([roleId, roleAgentId]);
        return {
          alreadyRegistered: false,
          instance: {
            instanceId: "test-role-worker",
            roleId,
            roleAgentId
          }
        };
      }
    }
  });

  const { output } = await captureConsole(() => (
    runCli(["instances", "register", "test-role", "worker"])
  ));
  assert.deepEqual(calls, [["test-role", "worker"]]);
  assert.match(output, /Agent Instance 注册完成：test-role-worker/);
});

test("instances reconcile 输出正常、缺失、漂移及未知 Agent 数量", async () => {
  const { runCli } = loadCliWithMocks({
    instances: {
      listInstances: async () => [],
      inspectInstance: async () => {},
      registerInstance: async () => {},
      reconcileInstances: async () => ({
        reconciledAt: "2026-07-20T00:00:00.000Z",
        instances: [
          { status: "registered" },
          { status: "missing" },
          { status: "drifted" }
        ],
        unmanagedAgents: [{ id: "main" }]
      })
    }
  });

  const { output } = await captureConsole(() => runCli(["instances", "reconcile"]));
  assert.match(output, /正常：1/);
  assert.match(output, /缺失：1/);
  assert.match(output, /漂移：1/);
  assert.match(output, /未由 ToolBox 管理的 OpenClaw Agent：1（未作修改）/);
});

test("instances 缺少参数和未知子命令时明确拒绝", async () => {
  const { runCli } = loadCliWithMocks();
  await assert.rejects(() => runCli(["instances", "inspect"]), /需要提供 instance id/);
  await assert.rejects(() => runCli(["instances", "register", "test-role"]), /需要提供 role id 和 role agent id/);
  await assert.rejects(() => runCli(["instances", "delete", "test-role-worker"]), /未知 instances 子命令：delete/);
});

function createTeamCliRecord(overrides = {}) {
  return {
    teamId: "test-team",
    name: "测试团队",
    description: "",
    managerInstanceId: "test-role-manager",
    memberInstanceIds: ["test-role-manager", "test-role-worker"],
    executionMode: "confirm",
    maxConcurrency: 2,
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z",
    health: { status: "ready", issues: [] },
    resolvedManager: null,
    resolvedMembers: [],
    ...overrides
  };
}

function createTeamCliMocks(calls) {
  const record = createTeamCliRecord();
  return {
    listTeams: async () => {
      calls.push(["list"]);
      return [record];
    },
    inspectTeam: async (teamId) => {
      calls.push(["inspect", teamId]);
      return record;
    },
    createTeam: async (teamId, input) => {
      calls.push(["create", teamId, input]);
      return record;
    },
    updateTeam: async (teamId, patch) => {
      calls.push(["update", teamId, patch]);
      return record;
    },
    addTeamMember: async (teamId, instanceId) => {
      calls.push(["add-member", teamId, instanceId]);
      return record;
    },
    removeTeamMember: async (teamId, instanceId) => {
      calls.push(["remove-member", teamId, instanceId]);
      return record;
    },
    setTeamManager: async (teamId, instanceId) => {
      calls.push(["set-manager", teamId, instanceId]);
      return record;
    },
    deleteTeam: async (teamId) => {
      calls.push(["delete", teamId]);
      return { teamId, deleted: true };
    }
  };
}

test("help 输出包含完整 Team Builder 首版命令", async () => {
  const { runCli } = loadCliWithMocks();
  const { output } = await captureConsole(() => runCli(["help"]));
  for (const command of [
    "teams list",
    "teams inspect <id>",
    "teams create <id>",
    "teams update <id>",
    "teams add-member <id>",
    "teams remove-member <id>",
    "teams set-manager <id>",
    "teams delete <id> --confirm"
  ]) {
    assert.match(output, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.doesNotMatch(output, /teams execute|teams run|teams project|teams task/);
});

test("teams list 和 inspect 分发并输出动态健康状态", async () => {
  const calls = [];
  const { runCli } = loadCliWithMocks({ teams: createTeamCliMocks(calls) });
  const listed = await captureConsole(() => runCli(["teams", "list"]));
  const inspected = await captureConsole(() => runCli(["teams", "inspect", "test-team"]));
  assert.deepEqual(calls, [["list"], ["inspect", "test-team"]]);
  assert.match(listed.output, /test-team.*测试团队.*ready/);
  assert.match(inspected.output, /Team ID：test-team/);
  assert.match(inspected.output, /健康状态：ready/);
});

test("teams create 解析重复 member 及全部 Team 配置", async () => {
  const calls = [];
  const { runCli } = loadCliWithMocks({ teams: createTeamCliMocks(calls) });
  const { output } = await captureConsole(() => runCli([
    "teams", "create", "test-team",
    "--name", "测试团队",
    "--description", "团队描述",
    "--manager", "test-role-manager",
    "--member", "test-role-worker",
    "--member", "test-role-manager",
    "--execution-mode", "auto",
    "--max-concurrency", "4"
  ]));
  assert.deepEqual(calls, [["create", "test-team", {
    name: "测试团队",
    description: "团队描述",
    managerInstanceId: "test-role-manager",
    memberInstanceIds: ["test-role-worker", "test-role-manager"],
    executionMode: "auto",
    maxConcurrency: 4
  }]]);
  assert.match(output, /Team 创建完成：test-team/);
});

test("teams update 与成员管理命令分发到独立 Manager API", async () => {
  const calls = [];
  const { runCli } = loadCliWithMocks({ teams: createTeamCliMocks(calls) });
  await captureConsole(() => runCli([
    "teams", "update", "test-team", "--name", "新名称",
    "--execution-mode", "auto", "--max-concurrency", "8"
  ]));
  await captureConsole(() => runCli(["teams", "add-member", "test-team", "test-role-creator"]));
  await captureConsole(() => runCli(["teams", "remove-member", "test-team", "test-role-worker"]));
  await captureConsole(() => runCli(["teams", "set-manager", "test-team", "test-role-creator"]));
  assert.deepEqual(calls, [
    ["update", "test-team", { name: "新名称", executionMode: "auto", maxConcurrency: 8 }],
    ["add-member", "test-team", "test-role-creator"],
    ["remove-member", "test-team", "test-role-worker"],
    ["set-manager", "test-team", "test-role-creator"]
  ]);
});

test("teams delete 强制显式 confirm 且只调用 deleteTeam", async () => {
  const calls = [];
  const { runCli } = loadCliWithMocks({ teams: createTeamCliMocks(calls) });
  await assert.rejects(
    () => runCli(["teams", "delete", "test-team"]),
    /必须提供 --confirm/
  );
  const { output } = await captureConsole(() => (
    runCli(["teams", "delete", "test-team", "--confirm"])
  ));
  assert.deepEqual(calls, [["delete", "test-team"]]);
  assert.match(output, /只删除 Team State|未修改任何 Agent Instance/);
});

test("teams 参数缺失、未知选项和未知子命令返回中文错误", async () => {
  const { runCli } = loadCliWithMocks();
  await assert.rejects(() => runCli(["teams", "inspect"]), /需要 1 个参数/);
  await assert.rejects(
    () => runCli(["teams", "create", "test-team", "--name", "测试"]),
    /需要提供 --manager/
  );
  await assert.rejects(
    () => runCli([
      "teams", "create", "test-team", "--name", "测试",
      "--manager", "test-role-manager", "--member", "test-role-worker"
    ]),
    /--manager 必须同时通过 --member/
  );
  await assert.rejects(
    () => runCli(["teams", "update", "test-team", "--member", "test-role-worker"]),
    /未知或不支持的 teams 选项/
  );
  await assert.rejects(() => runCli(["teams", "execute", "test-team"]), /未知 teams 子命令/);
});

function projectCliRecord() {
  return {
    projectId: "test-project", name: "测试项目", description: "", teamId: "test-team",
    status: "draft", archivedAt: null, executionMode: "confirm", maxConcurrency: 2,
    teamSyncStatus: "in-sync", teamSnapshotHealth: { status: "ready", issues: [] },
    taskSummary: { total: 0 }, teamSnapshot: {}, currentTeam: null
  };
}
function projectCliMocks(calls) {
  const record = projectCliRecord();
  return {
    listProjects: async () => { calls.push(["list"]); return [record]; },
    inspectProject: async (id) => { calls.push(["inspect", id]); return record; },
    createProject: async (input) => { calls.push(["create", input]); return record; },
    updateProject: async (id, patch) => { calls.push(["update", id, patch]); return record; },
    activateProject: async (id) => { calls.push(["activate", id]); return record; },
    completeProject: async (id) => { calls.push(["complete", id]); return record; },
    archiveProject: async (id) => { calls.push(["archive", id]); return record; },
    unarchiveProject: async (id) => { calls.push(["unarchive", id]); return record; },
    previewProjectTeamSync: async (id) => { calls.push(["preview", id]); return { projectId: id, teamSyncStatus: "out-of-sync", differences: [{}] }; },
    syncProjectTeam: async (id, input) => { calls.push(["sync", id, input]); return record; }
  };
}

test("projects CLI 解析创建、生命周期与显式 Team 同步", async () => {
  const calls = [];
  const { runCli } = loadCliWithMocks({ projects: projectCliMocks(calls) });
  await captureConsole(() => runCli(["projects", "create", "test-project", "--name", "测试", "--team", "test-team", "--execution-mode", "auto", "--max-concurrency", "4"]));
  await captureConsole(() => runCli(["projects", "activate", "test-project"]));
  await captureConsole(() => runCli(["projects", "sync-preview", "test-project"]));
  await captureConsole(() => runCli(["projects", "sync-team", "test-project", "--confirm", "--expected-team-updated-at", "2026-07-21T00:00:00.000Z", "--sync-execution-settings"]));
  assert.deepEqual(calls, [
    ["create", { projectId: "test-project", name: "测试", teamId: "test-team", executionMode: "auto", maxConcurrency: 4 }],
    ["activate", "test-project"], ["preview", "test-project"],
    ["sync", "test-project", { confirm: true, expectedSourceTeamUpdatedAt: "2026-07-21T00:00:00.000Z", syncExecutionSettings: true }]
  ]);
});

test("projects CLI 拒绝缺失、未知参数及未确认同步", async () => {
  const { runCli } = loadCliWithMocks();
  await assert.rejects(() => runCli(["projects", "create", "test-project", "--name", "测试"]), /--team/);
  await assert.rejects(() => runCli(["projects", "update", "test-project"]), /至少需要/);
  await assert.rejects(() => runCli(["projects", "create", "test-project", "--name", "测试", "--team", "test-team", "--unknown", "x"]), /未知或不支持/);
  await assert.rejects(() => runCli(["projects", "sync-team", "test-project", "--expected-team-updated-at", "x"]), /--confirm/);
});

function taskCliRecord() {
  return { taskId: "test-task", projectId: "test-project", title: "任务", status: "pending",
    computedStatus: "pending", priority: "medium", critical: false, source: "user",
    assignedInstanceId: null, dependencies: [], dependencyIssues: [] };
}
function taskCliMocks(calls) {
  const record = taskCliRecord();
  const call = (name) => async (...args) => { calls.push([name, ...args]); return record; };
  return {
    listTasks: async (...args) => { calls.push(["list", ...args]); return [record]; },
    inspectTask: call("inspect"), createTask: call("create"), updateTask: call("update"),
    assignTask: call("assign"), setTaskCritical: call("critical"),
    addTaskDependency: call("add-dependency"), removeTaskDependency: call("remove-dependency"),
    completeTask: call("complete"), cancelTask: call("cancel")
  };
}

test("tasks CLI 支持重复依赖、有限状态与语义化操作", async () => {
  const calls = [];
  const { runCli } = loadCliWithMocks({ tasks: taskCliMocks(calls) });
  await captureConsole(() => runCli(["tasks", "create", "test-task", "--project", "test-project", "--title", "任务", "--dependency", "a-task", "--dependency", "b-task", "--critical", "--critical-reason", "关键", "--critical-source", "user", "--max-retries", "2"]));
  await captureConsole(() => runCli(["tasks", "unassign", "test-task"]));
  await captureConsole(() => runCli(["tasks", "set-critical", "test-task", "--critical", "false"]));
  await captureConsole(() => runCli(["tasks", "complete", "test-task"]));
  assert.deepEqual(calls[0], ["create", {
    taskId: "test-task", projectId: "test-project", title: "任务", dependencies: ["a-task", "b-task"],
    critical: true, criticalReason: "关键", criticalSource: "user", retryPolicy: { maxRetries: 2 }
  }]);
  assert.deepEqual(calls.slice(1), [
    ["assign", "test-task", null], ["critical", "test-task", { critical: false }], ["complete", "test-task"]
  ]);
});

test("tasks list 通过 Manager options 按 Project 查询", async () => {
  const calls = [];
  const { runCli } = loadCliWithMocks({ tasks: taskCliMocks(calls) });
  const { output } = await captureConsole(() => runCli(["tasks", "list", "--project", "test-project"]));
  assert.deepEqual(calls, [["list", { projectId: "test-project" }]]);
  assert.match(output, /test-task.*pending/);
});

test("tasks CLI 拒绝缺失参数、未知选项和未支持 delete", async () => {
  const { runCli } = loadCliWithMocks();
  await assert.rejects(() => runCli(["tasks", "list"]), /--project/);
  await assert.rejects(() => runCli(["tasks", "create", "test-task", "--project", "test-project"]), /--title/);
  await assert.rejects(() => runCli(["tasks", "create", "test-task", "--project", "test-project", "--title", "任务", "--critical"]), /--critical-reason 和 --critical-source/);
  await assert.rejects(() => runCli(["tasks", "update", "test-task"]), /至少需要/);
  await assert.rejects(() => runCli(["tasks", "set-critical", "test-task", "--critical", "true"]), /--reason 和 --source/);
  await assert.rejects(() => runCli(["tasks", "delete", "test-task"]), /未知 tasks 子命令/);
});

test("help 包含 Project Task Core 且不暗示 auto 会执行", async () => {
  const { runCli } = loadCliWithMocks();
  const { output } = await captureConsole(() => runCli(["help"]));
  assert.match(output, /projects create/);
  assert.match(output, /projects sync-team/);
  assert.match(output, /tasks create/);
  assert.match(output, /tasks complete.*不会执行 Agent/);
  assert.doesNotMatch(output, /tasks delete|tasks run|tasks execute/);
});

function executionCliRecord() {
  return {
    runId: "run-00000000-0000-4000-8000-000000000001",
    taskId: "test-task",
    projectId: "test-project",
    assignedInstanceId: "test-role-worker",
    status: "completed",
    attempt: 1,
    trigger: "user",
    taskSyncStatus: "applied",
    outputSummary: "完成",
    errorSummary: null
  };
}

function executionCliMocks(calls) {
  const run = executionCliRecord();
  return {
    listExecutions: async (filters) => { calls.push(["list", filters]); return [run]; },
    inspectExecution: async (runId) => { calls.push(["inspect", runId]); return run; },
    runTask: async (taskId, input) => {
      calls.push(["run-task", taskId, input]);
      return { run, executionMode: "auto", autoSchedulingEnabled: false, retryOfRunId: null };
    },
    retryExecution: async (runId, input) => {
      calls.push(["retry", runId, input]);
      return { run: { ...run, attempt: 2, trigger: "retry" }, executionMode: "confirm", autoSchedulingEnabled: false, retryOfRunId: runId };
    },
    reconcileExecutions: async () => {
      calls.push(["reconcile"]);
      return {
        reconciledAt: "2026-07-21T00:00:00.000Z",
        interruptedRuns: [],
        taskSyncResults: [],
        staleLeaseRemoved: false
      };
    }
  };
}

test("executions CLI 分发 list、inspect、run-task、retry 和 reconcile", async () => {
  const calls = [];
  const { runCli } = loadCliWithMocks({ executions: executionCliMocks(calls) });
  const listed = await captureConsole(() => runCli([
    "executions", "list", "--task", "test-task", "--project", "test-project", "--status", "completed"
  ]));
  const inspected = await captureConsole(() => runCli([
    "executions", "inspect", "run-00000000-0000-4000-8000-000000000001"
  ]));
  const executed = await captureConsole(() => runCli([
    "executions", "run-task", "test-task", "--confirm", "--confirm-critical",
    "--instructions", "仅生成摘要", "--timeout", "7"
  ]));
  await captureConsole(() => runCli([
    "executions", "retry", "run-00000000-0000-4000-8000-000000000001", "--confirm"
  ]));
  await captureConsole(() => runCli(["executions", "reconcile"]));

  assert.deepEqual(calls, [
    ["list", { taskId: "test-task", projectId: "test-project", status: "completed" }],
    ["inspect", "run-00000000-0000-4000-8000-000000000001"],
    ["run-task", "test-task", {
      confirm: true, confirmCritical: true, instructions: "仅生成摘要", timeoutMs: 7000
    }],
    ["retry", "run-00000000-0000-4000-8000-000000000001", {
      confirm: true, confirmCritical: false
    }],
    ["reconcile"]
  ]);
  assert.match(listed.output, /Execution Runs.*test-task/s);
  assert.match(inspected.output, /Run ID：run-/);
  assert.match(executed.output, /auto 策略已保存，但自动调度尚未开放/);
});

test("executions CLI 强制确认、限制 timeout，并明确拒绝危险或未支持命令", async () => {
  const { runCli } = loadCliWithMocks();
  await assert.rejects(() => runCli(["executions", "run-task", "test-task"]), /必须提供 --confirm/);
  await assert.rejects(() => runCli(["executions", "retry", "run-id"]), /必须提供 --confirm/);
  await assert.rejects(() => runCli([
    "executions", "run-task", "test-task", "--confirm", "--timeout", "0"
  ]), /1 到 3600/);
  await assert.rejects(() => runCli([
    "executions", "list", "--unknown", "x"
  ]), /未知 executions list 选项/);
  for (const subcommand of ["cancel", "pause", "follow", "background"]) {
    await assert.rejects(() => runCli(["executions", subcommand]), /当前不支持 cancel、pause、follow 或后台执行/);
  }
});

test("executions CLI 参数错误通过统一入口返回非零退出码且不会执行 Agent", () => {
  const result = spawnSync(process.execPath, [
    projectPath("bin/cli.js"), "executions", "run-task", "test-task"
  ], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /必须提供 --confirm/);
  assert.doesNotMatch(result.stderr, /openclaw agent/);
});

test("help 明确列出 Execution 首版命令和安全边界", async () => {
  const { runCli } = loadCliWithMocks();
  const { output } = await captureConsole(() => runCli(["help"]));
  for (const command of [
    "executions list", "executions inspect", "executions run-task",
    "executions retry", "executions reconcile"
  ]) assert.match(output, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(output, /不支持安全远端 cancel、pause、后台调度或 checkpoint 恢复/);
  assert.doesNotMatch(output, /executions cancel|executions pause|executions follow/);
});
