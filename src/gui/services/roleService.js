// 角色市场 GUI 服务：只通过公共 API 读取角色包和安装状态，并返回安全 UI 数据。
const publicApi = require("../../index");

const SAFE_ERROR_MESSAGE = "角色列表暂时无法加载，请稍后重试。";
const SAFE_MY_ROLES_ERROR_MESSAGE = "我的角色暂时无法加载，请稍后重试。";
const SAFE_INSTALL_ERROR_MESSAGE = "角色安装未完成，请稍后重试。";
const SAFE_ENABLE_ERROR_MESSAGE = "角色启用未完成，请稍后重试。";
const ROLE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ROLE_ID_LENGTH = 128;

function createRoleService(api = publicApi, options = {}) {
  const lifecycleOptions = normalizeLifecycleOptions(options.lifecycleOptions);
  const instanceOptions = normalizeLifecycleOptions(options.instanceOptions);
  const service = {
    async listMarketplaceRoles() {
      try {
        const [registry, installedRoles, instanceRecords] = await Promise.all([
          api.scanRoleRegistry(lifecycleOptions),
          api.listInstalledRoles(lifecycleOptions),
          api.listInstances(instanceOptions)
        ]);
        const installedById = new Map(
          (Array.isArray(installedRoles) ? installedRoles : [])
            .map((role) => [role.id, role])
        );
        const instances = Array.isArray(instanceRecords) ? instanceRecords : [];
        const roles = (Array.isArray(registry && registry.roles) ? registry.roles : [])
          .map((role) => toMarketplaceRole(
            role,
            installedById.get(role.id),
            instances.filter((instance) => instance.roleId === role.id)
          ))
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

    async listMyRoles() {
      try {
        const marketplace = await service.listMarketplaceRoles();
        if (!marketplace || marketplace.ok !== true) {
          return {
            ok: false,
            roles: [],
            message: SAFE_MY_ROLES_ERROR_MESSAGE
          };
        }

        return {
          ok: true,
          roles: marketplace.roles
            .filter((role) => role.installed === true)
            .map(toMyRole)
            .sort((left, right) => left.roleId.localeCompare(right.roleId)),
          message: ""
        };
      } catch (error) {
        return {
          ok: false,
          roles: [],
          message: SAFE_MY_ROLES_ERROR_MESSAGE
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
    },

    async enableMarketplaceRole(roleId) {
      const normalizedRoleId = normalizeRoleId(roleId);
      if (!normalizedRoleId) {
        return createEnableResponse({
          message: "角色标识无效，无法启用。",
          marketplace: await service.listMarketplaceRoles()
        });
      }

      let marketplace = await service.listMarketplaceRoles();
      let role = findMarketplaceRole(marketplace, normalizedRoleId);
      if (!role) {
        return createEnableResponse({
          roleId: normalizedRoleId,
          message: "未找到该角色，请刷新角色列表后重试。",
          marketplace
        });
      }
      if (!role.installed) {
        return createEnableResponse({
          roleId: normalizedRoleId,
          message: "角色尚未安装，请先安装后再启用。",
          marketplace
        });
      }

      const results = [];
      try {
        await api.reconcileInstances(instanceOptions);
        marketplace = await service.listMarketplaceRoles();
        role = findMarketplaceRole(marketplace, normalizedRoleId);

        if (!role || role.enablementStatus === "needs-repair") {
          return createEnableResponse({
            roleId: normalizedRoleId,
            installed: true,
            instances: role ? role.instances : [],
            instanceCount: role ? role.instanceCount : 0,
            message: "已有 Agent Instance 缺失或配置漂移，请先修复后重试。",
            marketplace
          });
        }

        for (const agent of role.agents) {
          results.push(await api.registerInstance(
            normalizedRoleId,
            agent.id,
            instanceOptions
          ));
        }

        marketplace = await service.listMarketplaceRoles();
        const enabledRole = findMarketplaceRole(marketplace, normalizedRoleId);
        if (!enabledRole || !enabledRole.enabled) {
          return createEnableResponse({
            roleId: normalizedRoleId,
            installed: true,
            instances: enabledRole ? enabledRole.instances : [],
            instanceCount: enabledRole ? enabledRole.instanceCount : 0,
            message: "角色只完成部分启用，请核对 Agent Instance 状态后重试。",
            marketplace
          });
        }

        return createEnableResponse({
          ok: true,
          roleId: normalizedRoleId,
          installed: true,
          enabled: true,
          alreadyEnabled: results.every((result) => (
            result && result.alreadyRegistered === true
          )),
          instanceCount: enabledRole.instanceCount,
          instances: enabledRole.instances,
          message: results.every((result) => result && result.alreadyRegistered === true)
            ? "该角色已经启用，无需重复注册。"
            : "角色启用成功。",
          marketplace
        });
      } catch (error) {
        await api.reconcileInstances(instanceOptions).catch(() => {});
        marketplace = await service.listMarketplaceRoles();
        const currentRole = findMarketplaceRole(marketplace, normalizedRoleId);
        const partial = Boolean(
          currentRole &&
          !currentRole.enabled &&
          currentRole.instanceCount > 0
        );

        return createEnableResponse({
          roleId: normalizedRoleId,
          installed: true,
          enabled: Boolean(currentRole && currentRole.enabled),
          instanceCount: currentRole ? currentRole.instanceCount : 0,
          instances: currentRole ? currentRole.instances : [],
          message: partial
            ? "角色只完成部分启用，请核对 Agent Instance 状态后重试。"
            : classifyEnableError(error),
          marketplace
        });
      }
    }
  };

  return service;
}

function toMyRole(role) {
  const agentDescriptions = new Map(
    (Array.isArray(role.agents) ? role.agents : [])
      .map((agent) => [agent.id, safeText(agent.description)])
  );
  const instances = (Array.isArray(role.instances) ? role.instances : [])
    .map((instance) => {
      const status = normalizeInstanceStatus(instance.status);
      return {
        instanceId: safeText(instance.instanceId),
        roleAgentId: safeText(instance.roleAgentId),
        name: safeText(instance.name),
        description: agentDescriptions.get(instance.roleAgentId) || "",
        status,
        available: role.enabled === true && status === "registered"
      };
    })
    .sort((left, right) => left.instanceId.localeCompare(right.instanceId));

  return {
    roleId: safeText(role.id),
    name: safeText(role.name),
    version: safeText(role.installedVersion || role.version),
    description: safeText(role.description),
    enabled: role.enabled === true,
    status: safeMyRoleStatus(role.enablementStatus),
    instanceCount: instances.filter((instance) => instance.status === "registered").length,
    instances
  };
}

function safeMyRoleStatus(value) {
  return ["enabled", "not-enabled", "partial", "needs-repair"].includes(value)
    ? value
    : "not-enabled";
}

function toMarketplaceRole(role, installedRole, instanceRecords) {
  const installed = Boolean(installedRole);
  const agentNames = new Map(
    (Array.isArray(role.agents) ? role.agents : [])
      .map((agent) => [agent.id, safeText(agent.name)])
  );
  const instances = (Array.isArray(instanceRecords) ? instanceRecords : [])
    .filter((instance) => agentNames.has(instance.roleAgentId))
    .map((instance) => ({
      instanceId: safeText(instance.instanceId),
      roleAgentId: safeText(instance.roleAgentId),
      name: agentNames.get(instance.roleAgentId) || safeText(instance.roleAgentId),
      status: normalizeInstanceStatus(instance.status)
    }))
    .sort((left, right) => left.instanceId.localeCompare(right.instanceId));
  const registeredAgentIds = new Set(
    instances
      .filter((instance) => instance.status === "registered")
      .map((instance) => instance.roleAgentId)
  );
  const registeredInstanceCount = registeredAgentIds.size;
  const expectedAgentIds = [...agentNames.keys()];
  const hasUnhealthyInstance = instances.some((instance) => (
    instance.status !== "registered"
  ));
  const enabled = Boolean(
    installed &&
    expectedAgentIds.length > 0 &&
    expectedAgentIds.every((agentId) => registeredAgentIds.has(agentId))
  );

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
    status: installed ? safeText(installedRole.status || "installed") : "not-installed",
    enabled,
    enablementStatus: getEnablementStatus({
      installed,
      enabled,
      hasUnhealthyInstance,
      registeredInstanceCount
    }),
    instanceCount: registeredInstanceCount,
    instances
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

function normalizeInstanceStatus(value) {
  return ["registered", "missing", "drifted"].includes(value) ? value : "unknown";
}

function getEnablementStatus(input) {
  if (!input.installed) {
    return "not-installed";
  }
  if (input.hasUnhealthyInstance) {
    return "needs-repair";
  }
  if (input.enabled) {
    return "enabled";
  }
  if (input.registeredInstanceCount > 0) {
    return "partial";
  }
  return "not-enabled";
}

function findMarketplaceRole(marketplace, roleId) {
  if (!marketplace || marketplace.ok !== true || !Array.isArray(marketplace.roles)) {
    return null;
  }
  return marketplace.roles.find((role) => role.id === roleId) || null;
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

function classifyEnableError(error) {
  const message = typeof (error && error.message) === "string" ? error.message : "";

  if (/当前为 missing|当前为 drifted|配置漂移|注册结果缺失/.test(message)) {
    return "已有 Agent Instance 缺失或配置漂移，请先修复后重试。";
  }
  if (/已存在同名 Agent|已由 OpenClaw Agent 使用|已归属于其他|映射不一致|并发冲突/.test(message)) {
    return "检测到 Agent Instance 名称、映射或目录冲突，为保护现有配置已停止启用。";
  }
  if (/角色尚未安装/.test(message)) {
    return "角色尚未安装，请先安装后再启用。";
  }
  if (/add 命令已成功|已注册，但本地 Instance State 写入失败/.test(message)) {
    return "OpenClaw 注册结果需要人工核对，请先运行 Instance reconcile。";
  }
  if (/OpenClaw Agent 注册失败|读取 OpenClaw Agent 列表失败/.test(message)) {
    return "暂时无法完成 OpenClaw Agent 注册，请确认 OpenClaw 可用后重试。";
  }

  return SAFE_ENABLE_ERROR_MESSAGE;
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

function createEnableResponse(overrides) {
  return {
    ok: false,
    roleId: null,
    installed: false,
    enabled: false,
    alreadyEnabled: false,
    instanceCount: 0,
    instances: [],
    message: SAFE_ENABLE_ERROR_MESSAGE,
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
  enableMarketplaceRole: roleService.enableMarketplaceRole,
  installMarketplaceRole: roleService.installMarketplaceRole,
  listMyRoles: roleService.listMyRoles,
  listMarketplaceRoles: roleService.listMarketplaceRoles
};
