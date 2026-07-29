// 角色市场 GUI 服务：只通过公共 API 读取角色包和安装状态，并返回安全 UI 数据。
const publicApi = require("../../index");

const SAFE_ERROR_MESSAGE = "角色列表暂时无法加载，请稍后重试。";
const SAFE_INSTALL_ERROR_MESSAGE = "角色安装未完成，请稍后重试。";
const ROLE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ROLE_ID_LENGTH = 128;

function createRoleService(api = publicApi, options = {}) {
  const lifecycleOptions = normalizeLifecycleOptions(options.lifecycleOptions);
  const service = {
    async listMarketplaceRoles() {
      try {
        const [registry, installedRoles] = await Promise.all([
          api.scanRoleRegistry(lifecycleOptions),
          api.listInstalledRoles(lifecycleOptions)
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
    },

    async installMarketplaceRole(roleId) {
      const normalizedRoleId = normalizeRoleId(roleId);
      if (!normalizedRoleId) {
        return createInstallResponse({
          ok: false,
          message: "角色标识无效，无法安装。",
          marketplace: await service.listMarketplaceRoles()
        });
      }

      try {
        const installResult = await api.installRole(normalizedRoleId, lifecycleOptions);
        const marketplace = await service.listMarketplaceRoles();

        return createInstallResponse({
          ok: true,
          roleId: normalizedRoleId,
          installed: true,
          alreadyInstalled: installResult && installResult.alreadyInstalled === true,
          message: installResult && installResult.alreadyInstalled === true
            ? "该角色已经安装，无需重复安装。"
            : "角色安装成功。",
          marketplace
        });
      } catch (error) {
        const marketplace = await service.listMarketplaceRoles();
        const currentRole = marketplace.ok
          ? marketplace.roles.find((role) => role.id === normalizedRoleId)
          : null;

        return createInstallResponse({
          ok: false,
          roleId: normalizedRoleId,
          installed: Boolean(currentRole && currentRole.installed),
          message: classifyInstallError(error),
          marketplace
        });
      }
    }
  };

  return service;
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

function normalizeLifecycleOptions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return { ...value };
}

function normalizeRoleId(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > MAX_ROLE_ID_LENGTH ||
    normalized === "main" ||
    !ROLE_ID_PATTERN.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

function classifyInstallError(error) {
  const message = typeof (error && error.message) === "string" ? error.message : "";

  if (/已安装版本.*当前角色包版本.*不支持直接升级/.test(message)) {
    return "本机已安装其他版本，当前预览版暂不支持直接升级。";
  }
  if (/未找到角色/.test(message)) {
    return "未找到该角色，请刷新角色列表后重试。";
  }
  if (/角色包.*无效|角色包.*校验|manifest|符号链接/.test(message)) {
    return "角色包校验未通过，无法安装。";
  }
  if (/安装目录已存在|拒绝覆盖用户已有 workspace/.test(message)) {
    return "检测到同名安装目录，为保护现有数据已停止安装。";
  }
  if (/角色状态文件不是有效 JSON|角色状态文件结构无效/.test(message)) {
    return "本机角色安装状态无法读取，请先检查状态文件。";
  }
  if (/并发冲突/.test(message)) {
    return "角色安装状态发生变化，请刷新后重试。";
  }

  return SAFE_INSTALL_ERROR_MESSAGE;
}

function createInstallResponse(overrides) {
  return {
    ok: false,
    roleId: null,
    installed: false,
    alreadyInstalled: false,
    message: SAFE_INSTALL_ERROR_MESSAGE,
    marketplace: {
      ok: false,
      roles: [],
      invalidRoleCount: 0,
      message: SAFE_ERROR_MESSAGE
    },
    ...overrides
  };
}

const roleService = createRoleService();

module.exports = {
  createRoleService,
  installMarketplaceRole: roleService.installMarketplaceRole,
  listMarketplaceRoles: roleService.listMarketplaceRoles
};
