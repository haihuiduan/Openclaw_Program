const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createRoleService
} = require("../src/gui/services/roleService");

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
