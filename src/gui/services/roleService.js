// 角色市场 GUI 服务：只通过公共 API 读取角色包和安装状态，并返回安全 UI 数据。
const publicApi = require("../../index");

const SAFE_ERROR_MESSAGE = "角色列表暂时无法加载，请稍后重试。";

function createRoleService(api = publicApi) {
  return {
    async listMarketplaceRoles() {
      try {
        const [registry, installedRoles] = await Promise.all([
          api.scanRoleRegistry(),
          api.listInstalledRoles()
        ]);
        const installedById = new Map(
          (Array.isArray(installedRoles) ? installedRoles : [])
            .map((role) => [role.id, role])
        );
        const roles = (Array.isArray(registry && registry.roles) ? registry.roles : [])
          .map((role) => toMarketplaceRole(role, installedById.get(role.id)))
          .sort((left, right) => left.id.localeCompare(right.id));

        return {
          ok: true,
          roles,
          invalidRoleCount: Array.isArray(registry && registry.invalidRoles)
            ? registry.invalidRoles.length
            : 0,
          message: ""
        };
      } catch (error) {
        return {
          ok: false,
          roles: [],
          invalidRoleCount: 0,
          message: SAFE_ERROR_MESSAGE
        };
      }
    }
  };
}

function toMarketplaceRole(role, installedRole) {
  const installed = Boolean(installedRole);

  return {
    id: safeText(role.id),
    name: safeText(role.name),
    version: safeText(role.version),
    description: safeText(role.description),
    agentCount: Number.isInteger(role.agentCount) && role.agentCount >= 0
      ? role.agentCount
      : 0,
    agents: (Array.isArray(role.agents) ? role.agents : []).map((agent) => ({
      id: safeText(agent.id),
      name: safeText(agent.name),
      description: safeText(agent.description)
    })),
    installed,
    installedVersion: installed ? safeText(installedRole.version) : null,
    installedAt: installed ? safeNullableText(installedRole.installedAt) : null,
    status: installed ? safeText(installedRole.status || "installed") : "not-installed"
  };
}

function safeText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/(^|[\s([{=])\/(?:[^/\s]+\/)*[^/\s,;:)\]}]+/g, "$1[路径已隐藏]")
    .replace(/\b[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s,;:)\]}]+/g, "[路径已隐藏]")
    .trim();
}

function safeNullableText(value) {
  const normalized = safeText(value);
  return normalized || null;
}

const roleService = createRoleService();

module.exports = {
  createRoleService,
  listMarketplaceRoles: roleService.listMarketplaceRoles
};
