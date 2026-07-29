const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  createRoleService
} = require("../src/gui/services/roleService");
const { projectPath } = require("./helpers");

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
    ...overrides
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
    status: "not-installed"
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

test("真实公共 API 可在临时目录完成安装、重开读取和幂等复验", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-role-service-install-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const lifecycleOptions = {
    rolesDirectory: projectPath("roles"),
    installRoot: path.join(root, "installed"),
    statePath: path.join(root, "state", "roles.json"),
    mainWorkspace: path.join(root, "main-workspace")
  };
  const service = createRoleService(undefined, { lifecycleOptions });

  const before = await service.listMarketplaceRoles();
  assert.equal(before.roles.find((role) => role.id === "cross-border-team").installed, false);

  const first = await service.installMarketplaceRole("cross-border-team");
  assert.equal(first.ok, true);
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

  const reopenedService = createRoleService(undefined, { lifecycleOptions });
  const reopened = await reopenedService.listMarketplaceRoles();
  assert.equal(reopened.roles.find((role) => role.id === "cross-border-team").installed, true);

  const second = await reopenedService.installMarketplaceRole("cross-border-team");
  assert.equal(second.ok, true);
  assert.equal(second.alreadyInstalled, true);
  assert.doesNotMatch(JSON.stringify(second), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
