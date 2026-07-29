const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createRoleService
} = require("../src/gui/services/roleService");
const { projectPath } = require("./helpers");
const publicApi = require("../src");

function createApi(overrides = {}) {
  return {
    async scanRoleRegistry() {
      return {
        roles: [{
          schemaVersion: 1,
          id: "cross-border-team",
          name: "跨境电商运营团队",
          version: "1.0.0",
          description: "三个 Agent 组成的本地角色包。",
          agentCount: 3,
          directory: "/private/source/roles/cross-border-team",
          manifestPath: "/private/source/roles/cross-border-team/manifest.json",
          agents: [{
            id: "manager",
            name: "跨境运营协调助手",
            description: "协调团队任务。",
            directory: "/private/source/roles/cross-border-team/agents/manager",
            files: ["AGENTS.md"]
          }, {
            id: "researcher",
            name: "跨境选品分析助手",
            description: "分析产品机会。",
            directory: "/private/source/roles/cross-border-team/agents/researcher",
            files: ["AGENTS.md"]
          }, {
            id: "creator",
            name: "跨境商品文案助手",
            description: "生成可审核文案。",
            directory: "/private/source/roles/cross-border-team/agents/creator",
            files: ["AGENTS.md"]
          }]
        }],
        invalidRoles: []
      };
    },
    async listInstalledRoles() {
      return [];
    },
    async listInstances() {
      return [];
    },
    async reconcileInstances() {
      return {
        instances: [],
        unmanagedAgents: []
      };
    },
    ...overrides
  };
}

function createInstalledRoleRecord() {
  return {
    id: "cross-border-team",
    name: "跨境电商运营团队",
    version: "1.0.0",
    installedAt: "2026-07-29T12:00:00.000Z",
    status: "installed",
    agentCount: 3,
    workspacePath: "/private/install/cross-border-team"
  };
}

function createSafeInstance(roleAgentId, status = "registered") {
  return {
    instanceId: `cross-border-team-${roleAgentId}`,
    roleId: "cross-border-team",
    roleVersion: "1.0.0",
    roleAgentId,
    workspacePath: `/private/workspaces/${roleAgentId}`,
    agentDir: `/private/agent-dirs/cross-border-team-${roleAgentId}`,
    status,
    drift: status === "missing" ? ["missing"] : status === "drifted" ? ["workspace"] : []
  };
}

test("角色服务将合法角色转换为安全的未安装 UI DTO", async () => {
  const service = createRoleService(createApi());
  const result = await service.listMarketplaceRoles();

  assert.equal(result.ok, true);
  assert.equal(result.invalidRoleCount, 0);
  assert.equal(result.roles.length, 1);
  assert.deepEqual(result.roles[0], {
    id: "cross-border-team",
    name: "跨境电商运营团队",
    version: "1.0.0",
    description: "三个 Agent 组成的本地角色包。",
    agentCount: 3,
    agents: [{
      id: "manager",
      name: "跨境运营协调助手",
      description: "协调团队任务。"
    }, {
      id: "researcher",
      name: "跨境选品分析助手",
      description: "分析产品机会。"
    }, {
      id: "creator",
      name: "跨境商品文案助手",
      description: "生成可审核文案。"
    }],
    installed: false,
    installedVersion: null,
    installedAt: null,
    status: "not-installed",
    enabled: false,
    enablementStatus: "not-installed",
    instanceCount: 0,
    instances: []
  });
});

test("角色服务按 roleId 合并已安装状态且不返回 workspace 路径", async () => {
  const service = createRoleService(createApi({
    async listInstalledRoles() {
      return [{
        id: "cross-border-team",
        name: "跨境电商运营团队",
        version: "1.0.0",
        installedAt: "2026-07-29T10:00:00.000Z",
        status: "installed",
        agentCount: 3,
        workspacePath: "/Users/example/.openclaw-installer/roles/installed/cross-border-team"
      }];
    }
  }));

  const result = await service.listMarketplaceRoles();
  const role = result.roles[0];

  assert.equal(role.installed, true);
  assert.equal(role.installedVersion, "1.0.0");
  assert.equal(role.installedAt, "2026-07-29T10:00:00.000Z");
  assert.equal(role.status, "installed");
  assert.equal(role.enabled, false);
  assert.equal(role.enablementStatus, "not-enabled");
  assert.equal("workspacePath" in role, false);
  assert.equal("installDirectory" in role, false);
});

test("角色服务只保留 Agent 安全字段并清理展示文本中的绝对路径", async () => {
  const api = createApi();
  const originalScan = api.scanRoleRegistry;
  api.scanRoleRegistry = async () => {
    const registry = await originalScan();
    registry.roles[0].description = "内部来源位于 /Users/example/private/role.json";
    registry.roles[0].agents[0].description = "不要显示 C:\\Users\\example\\agent";
    return registry;
  };

  const result = await createRoleService(api).listMarketplaceRoles();
  const serialized = JSON.stringify(result);

  assert.doesNotMatch(serialized, /directory|manifestPath|workspacePath|installDirectory/);
  assert.doesNotMatch(serialized, /\/Users\/example|C:\\\\Users\\\\example|\/private\/source/);
  assert.match(result.roles[0].description, /\[路径已隐藏\]/);
  assert.match(result.roles[0].agents[0].description, /\[路径已隐藏\]/);
});

test("部分无效角色不阻止合法角色展示且只返回计数", async () => {
  const api = createApi();
  const originalScan = api.scanRoleRegistry;
  api.scanRoleRegistry = async () => {
    const registry = await originalScan();
    registry.invalidRoles = [{
      directory: "/private/secret/invalid-role",
      message: "manifest 损坏：/private/secret/invalid-role/manifest.json"
    }];
    return registry;
  };

  const result = await createRoleService(api).listMarketplaceRoles();
  const serialized = JSON.stringify(result);

  assert.equal(result.ok, true);
  assert.equal(result.roles.length, 1);
  assert.equal(result.invalidRoleCount, 1);
  assert.equal("invalidRoles" in result, false);
  assert.doesNotMatch(serialized, /invalid-role|\/private\/secret|manifest 损坏/);
});

test("角色 API 失败时返回固定安全摘要，不泄露错误、路径或堆栈", async () => {
  const service = createRoleService(createApi({
    async scanRoleRegistry() {
      const error = new Error("读取失败：/Users/example/private/roles");
      error.stack = "secret stack /private/internal/source.js";
      throw error;
    }
  }));

  const result = await service.listMarketplaceRoles();
  const serialized = JSON.stringify(result);

  assert.deepEqual(result, {
    ok: false,
    roles: [],
    invalidRoleCount: 0,
    message: "角色列表暂时无法加载，请稍后重试。"
  });
  assert.doesNotMatch(serialized, /Users|private|secret stack|读取失败/);
});

test("角色服务安装成功后返回安全结果并立即刷新安装状态", async () => {
  let installedRoles = [];
  const calls = [];
  const api = createApi({
    async installRole(roleId, options) {
      calls.push({ roleId, options });
      installedRoles = [{
        id: roleId,
        name: "跨境电商运营团队",
        version: "1.0.0",
        installedAt: "2026-07-29T12:00:00.000Z",
        status: "installed",
        agentCount: 3,
        workspacePath: "/private/install/cross-border-team"
      }];
      return {
        ok: true,
        roleId,
        installed: true,
        alreadyInstalled: false,
        installDirectory: "/private/install/cross-border-team"
      };
    },
    async listInstalledRoles() {
      return installedRoles;
    }
  });

  const result = await createRoleService(api).installMarketplaceRole("cross-border-team");
  const serialized = JSON.stringify(result);

  assert.equal(result.ok, true);
  assert.equal(result.roleId, "cross-border-team");
  assert.equal(result.installed, true);
  assert.equal(result.alreadyInstalled, false);
  assert.equal(result.marketplace.roles[0].installed, true);
  assert.deepEqual(calls, [{ roleId: "cross-border-team", options: {} }]);
  assert.doesNotMatch(serialized, /installDirectory|workspacePath|\/private\/install/);
});

test("同版本重复安装按成功幂等结果返回 alreadyInstalled", async () => {
  const api = createApi({
    async installRole(roleId) {
      return {
        ok: true,
        roleId,
        installed: true,
        alreadyInstalled: true
      };
    },
    async listInstalledRoles() {
      return [{
        id: "cross-border-team",
        name: "跨境电商运营团队",
        version: "1.0.0",
        installedAt: "2026-07-29T12:00:00.000Z",
        status: "installed",
        agentCount: 3
      }];
    }
  });

  const result = await createRoleService(api).installMarketplaceRole("cross-border-team");

  assert.equal(result.ok, true);
  assert.equal(result.installed, true);
  assert.equal(result.alreadyInstalled, true);
  assert.match(result.message, /已经安装/);
});

test("非法 roleId 在调用核心安装 API 前被拒绝且不回显恶意输入", async () => {
  let installCalls = 0;
  const service = createRoleService(createApi({
    async installRole() {
      installCalls += 1;
    }
  }));

  for (const roleId of [null, "", " ", "../secret", "/private/role", "main", "UPPER"]) {
    const result = await service.installMarketplaceRole(roleId);
    assert.equal(result.ok, false);
    assert.equal(result.roleId, null);
    assert.equal(result.message, "角色标识无效，无法安装。");
    assert.doesNotMatch(JSON.stringify(result), /secret|\/private|UPPER/);
  }
  assert.equal(installCalls, 0);
});

test("renderer 额外传入路径参数不会进入核心安装 options", async () => {
  let receivedOptions;
  const api = createApi({
    async installRole(roleId, options) {
      receivedOptions = options;
      return { ok: true, roleId, installed: true, alreadyInstalled: false };
    },
    async listInstalledRoles() {
      return [{
        id: "cross-border-team",
        name: "跨境电商运营团队",
        version: "1.0.0",
        installedAt: "2026-07-29T12:00:00.000Z",
        status: "installed",
        agentCount: 3
      }];
    }
  });
  const service = createRoleService(api);

  await service.installMarketplaceRole("cross-border-team", {
    installRoot: "/private/renderer-controlled"
  });

  assert.deepEqual(receivedOptions, {});
});

test("安装异常被映射为安全摘要且失败后市场列表仍可使用", async () => {
  const error = new Error("copy failed at /Users/example/private/install");
  error.stack = "secret stack /private/internal/installer.js";
  const service = createRoleService(createApi({
    async installRole() {
      throw error;
    }
  }));

  const result = await service.installMarketplaceRole("cross-border-team");
  const serialized = JSON.stringify(result);

  assert.equal(result.ok, false);
  assert.equal(result.installed, false);
  assert.equal(result.marketplace.ok, true);
  assert.equal(result.marketplace.roles.length, 1);
  assert.equal(result.marketplace.roles[0].installed, false);
  assert.equal(result.message, "角色安装未完成，请稍后重试。");
  assert.doesNotMatch(serialized, /Users|private|secret stack|copy failed|Error/);
});

test("版本冲突返回固定可读摘要而不泄露核心错误详情", async () => {
  const service = createRoleService(createApi({
    async installRole() {
      throw new Error(
        "角色 cross-border-team 已安装版本 0.9.0，当前角色包版本为 1.0.0；本阶段尚不支持直接升级。"
      );
    }
  }));

  const result = await service.installMarketplaceRole("cross-border-team");

  assert.equal(result.ok, false);
  assert.equal(result.message, "本机已安装其他版本，当前预览版暂不支持直接升级。");
  assert.doesNotMatch(result.message, /cross-border-team|0\.9\.0|1\.0\.0/);
});

test("未安装角色不能启用且不会调用 reconcile 或 register", async () => {
  let reconcileCalls = 0;
  let registerCalls = 0;
  const service = createRoleService(createApi({
    async reconcileInstances() {
      reconcileCalls += 1;
    },
    async registerInstance() {
      registerCalls += 1;
    }
  }));

  const result = await service.enableMarketplaceRole("cross-border-team");

  assert.equal(result.ok, false);
  assert.equal(result.enabled, false);
  assert.equal(result.message, "角色尚未安装，请先安装后再启用。");
  assert.equal(reconcileCalls, 0);
  assert.equal(registerCalls, 0);
});

test("已安装多 Agent 角色逐个注册为稳定独立 Instance", async () => {
  const instances = [];
  const calls = [];
  const api = createApi({
    async listInstalledRoles() {
      return [createInstalledRoleRecord()];
    },
    async listInstances() {
      return instances.map((instance) => ({ ...instance }));
    },
    async reconcileInstances(options) {
      calls.push({ method: "reconcileInstances", options });
      return { instances, unmanagedAgents: [] };
    },
    async registerInstance(roleId, roleAgentId, options) {
      calls.push({ method: "registerInstance", roleId, roleAgentId, options });
      const instance = createSafeInstance(roleAgentId);
      instances.push(instance);
      return {
        ok: true,
        alreadyRegistered: false,
        instance
      };
    }
  });
  const service = createRoleService(api);

  const result = await service.enableMarketplaceRole("cross-border-team");

  assert.equal(result.ok, true);
  assert.equal(result.enabled, true);
  assert.equal(result.alreadyEnabled, false);
  assert.equal(result.instanceCount, 3);
  assert.deepEqual(result.instances.map((instance) => instance.instanceId), [
    "cross-border-team-creator",
    "cross-border-team-manager",
    "cross-border-team-researcher"
  ]);
  assert.deepEqual(
    calls.filter((call) => call.method === "registerInstance")
      .map((call) => [call.roleId, call.roleAgentId]),
    [
      ["cross-border-team", "manager"],
      ["cross-border-team", "researcher"],
      ["cross-border-team", "creator"]
    ]
  );
  assert.doesNotMatch(JSON.stringify(result), /workspacePath|agentDir|\/private\//);
});

test("重复启用复用 Core 幂等注册且不产生新的 Instance", async () => {
  const instances = [];
  let newRegistrations = 0;
  const api = createApi({
    async listInstalledRoles() {
      return [createInstalledRoleRecord()];
    },
    async listInstances() {
      return instances.map((instance) => ({ ...instance }));
    },
    async reconcileInstances() {
      return { instances, unmanagedAgents: [] };
    },
    async registerInstance(roleId, roleAgentId) {
      const existing = instances.find((instance) => instance.roleAgentId === roleAgentId);
      if (existing) {
        return { ok: true, alreadyRegistered: true, instance: existing };
      }
      const instance = createSafeInstance(roleAgentId);
      instances.push(instance);
      newRegistrations += 1;
      return { ok: true, alreadyRegistered: false, instance };
    }
  });
  const service = createRoleService(api);

  const first = await service.enableMarketplaceRole("cross-border-team");
  const second = await service.enableMarketplaceRole("cross-border-team");

  assert.equal(first.alreadyEnabled, false);
  assert.equal(second.ok, true);
  assert.equal(second.alreadyEnabled, true);
  assert.equal(newRegistrations, 3);
  assert.equal(instances.length, 3);
});

test("missing 或 drifted Instance 显示需要修复且阻止继续注册", async () => {
  for (const status of ["missing", "drifted"]) {
    let registerCalls = 0;
    const instances = [createSafeInstance("manager", status)];
    const service = createRoleService(createApi({
      async listInstalledRoles() {
        return [createInstalledRoleRecord()];
      },
      async listInstances() {
        return instances;
      },
      async reconcileInstances() {
        return { instances, unmanagedAgents: [] };
      },
      async registerInstance() {
        registerCalls += 1;
      }
    }));

    const marketplace = await service.listMarketplaceRoles();
    const role = marketplace.roles[0];
    assert.equal(role.enabled, false);
    assert.equal(role.enablementStatus, "needs-repair");
    assert.equal(role.instances[0].status, status);

    const result = await service.enableMarketplaceRole("cross-border-team");
    assert.equal(result.ok, false);
    assert.match(result.message, /缺失或配置漂移/);
    assert.equal(registerCalls, 0);
  }
});

test("部分注册失败不会伪装为全部成功并停止后续 Agent 注册", async () => {
  const instances = [];
  const attempted = [];
  const service = createRoleService(createApi({
    async listInstalledRoles() {
      return [createInstalledRoleRecord()];
    },
    async listInstances() {
      return instances;
    },
    async reconcileInstances() {
      return { instances, unmanagedAgents: [] };
    },
    async registerInstance(roleId, roleAgentId) {
      attempted.push(roleAgentId);
      if (roleAgentId === "researcher") {
        throw new Error(
          "OpenClaw 中已存在同名 Agent，拒绝覆盖或接管：cross-border-team-researcher"
        );
      }
      const instance = createSafeInstance(roleAgentId);
      instances.push(instance);
      return { ok: true, alreadyRegistered: false, instance };
    }
  }));

  const result = await service.enableMarketplaceRole("cross-border-team");

  assert.equal(result.ok, false);
  assert.equal(result.enabled, false);
  assert.equal(result.instanceCount, 1);
  assert.deepEqual(result.instances.map((instance) => instance.roleAgentId), ["manager"]);
  assert.deepEqual(attempted, ["manager", "researcher"]);
  assert.match(result.message, /部分启用/);
  assert.doesNotMatch(JSON.stringify(result), /OpenClaw 中已存在|\/private\//);
});

test("启用冲突和原始异常转换为安全摘要且不泄露路径或堆栈", async () => {
  const rawError = new Error(
    "agentDir 已由 OpenClaw Agent 使用：other-agent /Users/example/private/agent"
  );
  rawError.stack = "secret stack /private/internal/manager.js";
  const service = createRoleService(createApi({
    async listInstalledRoles() {
      return [createInstalledRoleRecord()];
    },
    async reconcileInstances() {
      return { instances: [], unmanagedAgents: [] };
    },
    async registerInstance() {
      throw rawError;
    }
  }));

  const result = await service.enableMarketplaceRole("cross-border-team");
  const serialized = JSON.stringify(result);

  assert.equal(result.ok, false);
  assert.match(result.message, /名称、映射或目录冲突/);
  assert.doesNotMatch(serialized, /Users|private|secret stack|other-agent|agentDir/);
});

test("renderer 不能通过启用接口注入路径、instanceId 或 options", async () => {
  const instances = [];
  const receivedOptions = [];
  const instanceOptions = {
    instanceStatePath: "/safe/internal/instances.json",
    agentDirRoot: "/safe/internal/agent-dirs"
  };
  const service = createRoleService(createApi({
    async listInstalledRoles() {
      return [createInstalledRoleRecord()];
    },
    async listInstances() {
      return instances;
    },
    async reconcileInstances(options) {
      receivedOptions.push(options);
      return { instances, unmanagedAgents: [] };
    },
    async registerInstance(roleId, roleAgentId, options) {
      receivedOptions.push(options);
      const instance = createSafeInstance(roleAgentId);
      instances.push(instance);
      return { ok: true, alreadyRegistered: false, instance };
    }
  }), { instanceOptions });

  await service.enableMarketplaceRole("cross-border-team", {
    instanceId: "attacker-instance",
    workspacePath: "/private/attacker-workspace",
    agentDir: "/private/attacker-agent",
    instanceStatePath: "/private/attacker-state"
  });

  assert.equal(receivedOptions.length, 4);
  for (const options of receivedOptions) {
    assert.deepEqual(options, instanceOptions);
  }
});

test("真实公共 API 可在临时目录完成安装、重开读取和幂等复验", async (t) => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-role-service-install-"))
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const lifecycleOptions = {
    rolesDirectory: projectPath("roles"),
    installRoot: path.join(root, "installed"),
    statePath: path.join(root, "state", "roles.json"),
    mainWorkspace: path.join(root, "main-workspace")
  };
  const instanceOptions = {
    roleStatePath: lifecycleOptions.statePath,
    instanceStatePath: path.join(root, "instance-state", "instances.json"),
    agentDirRoot: path.join(root, "instance-state", "agent-dirs"),
    mainWorkspace: lifecycleOptions.mainWorkspace,
    openClawAdapter: {
      async listAgents() {
        return [];
      },
      async registerAgent() {
        throw new Error("本测试不应注册 Agent Instance");
      }
    }
  };
  const service = createRoleService(undefined, { lifecycleOptions, instanceOptions });

  const before = await service.listMarketplaceRoles();
  assert.equal(before.roles.find((role) => role.id === "cross-border-team").installed, false);

  const first = await service.installMarketplaceRole("cross-border-team");
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.alreadyInstalled, false);
  assert.equal(first.marketplace.roles.find((role) => role.id === "cross-border-team").installed, true);

  for (const agentId of ["manager", "researcher", "creator"]) {
    const workspace = path.join(
      lifecycleOptions.installRoot,
      "cross-border-team",
      "workspaces",
      agentId
    );
    assert.deepEqual(fs.readdirSync(workspace).sort(), [
      "AGENTS.md",
      "IDENTITY.md",
      "SOUL.md",
      "TOOLS.md"
    ]);
  }

  const reopenedService = createRoleService(undefined, { lifecycleOptions, instanceOptions });
  const reopened = await reopenedService.listMarketplaceRoles();
  assert.equal(reopened.roles.find((role) => role.id === "cross-border-team").installed, true);

  const second = await reopenedService.installMarketplaceRole("cross-border-team");
  assert.equal(second.ok, true);
  assert.equal(second.alreadyInstalled, true);
  assert.doesNotMatch(JSON.stringify(second), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("真实公共 API 通过临时 State 和 Mock Adapter 完成三 Instance 启用、重开与 reconcile", async (t) => {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-role-service-enable-"))
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const lifecycleOptions = {
    rolesDirectory: projectPath("roles"),
    installRoot: path.join(root, "installed"),
    statePath: path.join(root, "state", "roles.json"),
    mainWorkspace: path.join(root, "main-workspace")
  };
  const remoteAgents = [];
  const adapterCalls = [];
  const openClawAdapter = {
    async listAgents() {
      adapterCalls.push({ method: "listAgents" });
      return remoteAgents.map((agent) => ({ ...agent }));
    },
    async registerAgent(input) {
      adapterCalls.push({
        method: "registerAgent",
        instanceId: input.instanceId
      });
      remoteAgents.push({
        id: input.instanceId,
        workspacePath: input.workspacePath,
        agentDir: input.agentDir
      });
      return { ok: true };
    }
  };
  const instanceOptions = {
    roleStatePath: lifecycleOptions.statePath,
    instanceStatePath: path.join(root, "instance-state", "instances.json"),
    agentDirRoot: path.join(root, "instance-state", "agent-dirs"),
    mainWorkspace: lifecycleOptions.mainWorkspace,
    openClawAdapter,
    now: () => new Date("2026-07-29T13:00:00.000Z")
  };
  const service = createRoleService(undefined, { lifecycleOptions, instanceOptions });

  const installed = await service.installMarketplaceRole("cross-border-team");
  assert.equal(installed.ok, true);
  assert.equal(installed.marketplace.roles[0].enablementStatus, "not-enabled");

  const first = await service.enableMarketplaceRole("cross-border-team");
  assert.equal(first.ok, true, JSON.stringify(first));
  assert.equal(first.enabled, true);
  assert.equal(first.alreadyEnabled, false);
  assert.equal(first.instanceCount, 3);
  assert.deepEqual(first.instances.map((instance) => instance.instanceId), [
    "cross-border-team-creator",
    "cross-border-team-manager",
    "cross-border-team-researcher"
  ]);
  assert.equal(
    adapterCalls.filter((call) => call.method === "registerAgent").length,
    3
  );
  assert.doesNotMatch(JSON.stringify(first), /workspacePath|agentDir/);
  assert.doesNotMatch(
    JSON.stringify(first),
    new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  );

  const reopenedService = createRoleService(undefined, { lifecycleOptions, instanceOptions });
  const reopened = await reopenedService.listMarketplaceRoles();
  assert.equal(reopened.roles[0].enabled, true);
  assert.equal(reopened.roles[0].instanceCount, 3);

  const second = await reopenedService.enableMarketplaceRole("cross-border-team");
  assert.equal(second.ok, true);
  assert.equal(second.alreadyEnabled, true);
  assert.equal(
    adapterCalls.filter((call) => call.method === "registerAgent").length,
    3
  );

  const reconciled = await publicApi.reconcileInstances(instanceOptions);
  assert.deepEqual(
    reconciled.instances.map((instance) => instance.status),
    ["registered", "registered", "registered"]
  );
  const afterReconcile = await reopenedService.listMarketplaceRoles();
  assert.equal(afterReconcile.roles[0].enabled, true);
  assert.equal(afterReconcile.roles[0].enablementStatus, "enabled");
});

test("我的角色只返回已经安装的角色", async () => {
  const service = createRoleService(createApi());

  const result = await service.listMyRoles();

  assert.deepEqual(result, {
    ok: true,
    roles: [],
    message: ""
  });
});

test("我的角色将已安装但未启用角色转换为安全 DTO", async () => {
  const service = createRoleService(createApi({
    async listInstalledRoles() {
      return [createInstalledRoleRecord()];
    }
  }));

  const result = await service.listMyRoles();

  assert.equal(result.ok, true);
  assert.deepEqual(result.roles, [{
    roleId: "cross-border-team",
    name: "跨境电商运营团队",
    version: "1.0.0",
    description: "三个 Agent 组成的本地角色包。",
    enabled: false,
    status: "not-enabled",
    instanceCount: 0,
    instances: []
  }]);
});

test("我的角色返回真实已启用 Instance 且只保留可聊天安全字段", async () => {
  const instances = [
    createSafeInstance("researcher"),
    createSafeInstance("creator"),
    createSafeInstance("manager")
  ];
  const service = createRoleService(createApi({
    async listInstalledRoles() {
      return [createInstalledRoleRecord()];
    },
    async listInstances() {
      return instances;
    }
  }));

  const result = await service.listMyRoles();
  const role = result.roles[0];
  const serialized = JSON.stringify(result);

  assert.equal(role.enabled, true);
  assert.equal(role.status, "enabled");
  assert.equal(role.instanceCount, 3);
  assert.deepEqual(role.instances.map((instance) => instance.instanceId), [
    "cross-border-team-creator",
    "cross-border-team-manager",
    "cross-border-team-researcher"
  ]);
  assert.deepEqual(role.instances.map((instance) => instance.available), [
    true,
    true,
    true
  ]);
  assert.equal(role.instances[0].description, "生成可审核文案。");
  assert.doesNotMatch(
    serialized,
    /workspacePath|agentDir|statePath|manifestPath|installDirectory|\/private\//
  );
});

test("missing 和 drifted Instance 在我的角色中标记为需要修复且不可聊天", async () => {
  const instances = [
    createSafeInstance("manager", "registered"),
    createSafeInstance("researcher", "missing"),
    createSafeInstance("creator", "drifted")
  ];
  const service = createRoleService(createApi({
    async listInstalledRoles() {
      return [createInstalledRoleRecord()];
    },
    async listInstances() {
      return instances;
    }
  }));

  const result = await service.listMyRoles();
  const role = result.roles[0];

  assert.equal(role.enabled, false);
  assert.equal(role.status, "needs-repair");
  assert.equal(role.instanceCount, 1);
  assert.equal(
    role.instances.find((instance) => instance.status === "registered").available,
    false
  );
  assert.equal(
    role.instances.find((instance) => instance.status === "missing").available,
    false
  );
  assert.equal(
    role.instances.find((instance) => instance.status === "drifted").available,
    false
  );
});

test("未知异常 Instance 在我的角色中同样标记为需要修复且不可聊天", async () => {
  const service = createRoleService(createApi({
    async listInstalledRoles() {
      return [createInstalledRoleRecord()];
    },
    async listInstances() {
      return [createSafeInstance("manager", "unexpected")];
    }
  }));

  const result = await service.listMyRoles();
  const role = result.roles[0];

  assert.equal(role.enabled, false);
  assert.equal(role.status, "needs-repair");
  assert.equal(role.instances[0].status, "unknown");
  assert.equal(role.instances[0].available, false);
});

test("我的角色错误使用固定安全摘要且不泄露原始 Error 或路径", async () => {
  const error = new Error("读取失败：/Users/example/private/instances.json");
  error.stack = "secret stack /private/internal/state.js";
  const service = createRoleService(createApi({
    async scanRoleRegistry() {
      throw error;
    }
  }));

  const result = await service.listMyRoles();
  const serialized = JSON.stringify(result);

  assert.deepEqual(result, {
    ok: false,
    roles: [],
    message: "我的角色暂时无法加载，请稍后重试。"
  });
  assert.doesNotMatch(serialized, /Users|private|secret stack|读取失败|Error/);
});
