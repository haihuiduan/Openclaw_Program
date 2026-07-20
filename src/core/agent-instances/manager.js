const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createInstanceId, assertInstanceId } = require("./id");
const { createOpenClawAdapter } = require("./openClawAdapter");
const {
  getInstanceState,
  listInstanceStates,
  readInstanceState,
  updateInstanceState
} = require("./state");
const {
  DEFAULT_MAIN_WORKSPACE,
  DEFAULT_ROLE_STATE_PATH
} = require("../roles/installer");
const { getRoleState, readRoleState } = require("../roles/state");
const { ROLE_ID_PATTERN } = require("../roles/validator");

const DEFAULT_INSTANCE_DATA_DIRECTORY = path.join(
  os.homedir(),
  ".openclaw-installer",
  "agent-instances"
);
const DEFAULT_INSTANCE_STATE_PATH = path.join(DEFAULT_INSTANCE_DATA_DIRECTORY, "state.json");
const DEFAULT_AGENT_DIR_ROOT = path.join(DEFAULT_INSTANCE_DATA_DIRECTORY, "agent-dirs");
const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const instanceLocks = new Map();

async function listInstances(options = {}) {
  const settings = resolveSettings(options);
  const state = await settings.instanceStateStore.readInstanceState(settings.instanceStatePath);
  return listInstanceStates(state);
}

async function inspectInstance(instanceId, options = {}) {
  assertInstanceId(instanceId);
  const settings = resolveSettings(options);
  const state = await settings.instanceStateStore.readInstanceState(settings.instanceStatePath);
  const record = getInstanceState(state, instanceId);
  if (!record) {
    throw new Error("未找到 Agent Instance：" + instanceId);
  }
  return record;
}

async function registerInstance(roleId, roleAgentId, options = {}) {
  assertRoleOrAgentId(roleId, "roleId");
  assertRoleOrAgentId(roleAgentId, "roleAgentId");
  const instanceId = createInstanceId(roleId, roleAgentId);

  return withInstanceLock(instanceId, async () => {
    const settings = resolveSettings(options);
    const roleState = await settings.roleStateStore.readRoleState(settings.roleStatePath);
    const role = getRoleState(roleState, roleId);
    if (!role) {
      throw new Error(`角色尚未安装，不能注册 Agent Instance：${roleId}`);
    }
    const roleAgent = role.agents.find((agent) => agent.agentId === roleAgentId);
    if (!roleAgent) {
      throw new Error(`已安装角色 ${roleId} 不包含 Agent：${roleAgentId}`);
    }

    const workspacePath = await requireSafeRoleWorkspace(role, roleAgent, settings);
    const agentDir = path.join(settings.agentDirRoot, instanceId);
    assertSafeAgentDirCandidate(agentDir, settings);
    if (pathsOverlap(settings.agentDirRoot, role.workspacePath)) {
      throw new Error("Agent Instance agentDir 根目录必须独立于 Phase 2 角色 workspace。");
    }

    const instanceState = await settings.instanceStateStore.readInstanceState(
      settings.instanceStatePath
    );
    const existing = getInstanceState(instanceState, instanceId);
    const openClawAgents = await settings.openClawAdapter.listAgents();
    const remoteById = new Map(openClawAgents.map((agent) => [agent.id, agent]));

    if (existing) {
      assertSameMapping(existing, {
        roleId,
        roleVersion: role.roleVersion,
        roleAgentId,
        workspacePath,
        agentDir
      });
      const observation = assessRegistration(existing, remoteById.get(instanceId));
      if (observation.status !== "registered") {
        throw new Error(
          `Agent Instance ${instanceId} 当前为 ${observation.status}，请先运行 instances reconcile 并处理漂移。`
        );
      }
      const reconciled = await recordObservation(instanceId, observation, settings);
      return {
        ok: true,
        alreadyRegistered: true,
        instance: reconciled
      };
    }

    if (remoteById.has(instanceId)) {
      throw new Error(`OpenClaw 中已存在同名 Agent，拒绝覆盖或接管：${instanceId}`);
    }
    assertMappingAvailable(instanceState, { roleId, roleAgentId, workspacePath, agentDir });
    assertRemoteAgentDirAvailable(openClawAgents, agentDir);

    const realAgentDirRoot = await prepareAgentDirRoot(settings);
    const realAgentDir = path.join(realAgentDirRoot, instanceId);
    if (realAgentDir !== path.resolve(agentDir)) {
      throw new Error("Agent Instance agentDir realpath 发生变化，拒绝注册：" + agentDir);
    }
    if (await pathExists(realAgentDir, settings.fileSystem)) {
      throw new Error("Agent Instance agentDir 已存在，拒绝覆盖或接管：" + realAgentDir);
    }

    try {
      await settings.openClawAdapter.registerAgent({
        instanceId,
        workspacePath,
        agentDir: realAgentDir
      });
    } catch (error) {
      throw new Error(
        `Agent Instance 注册失败：${instanceId}；未执行 agents delete 自动清理。（${error.message}）`
      );
    }

    let postRegistrationAgents;
    try {
      postRegistrationAgents = await settings.openClawAdapter.listAgents();
    } catch (error) {
      throw new Error(
        `OpenClaw Agent ${instanceId} 的 add 命令已成功，但无法核验注册结果；` +
        `未执行 agents delete 自动清理。请运行 instances reconcile 后人工核对。（${error.message}）`
      );
    }
    const registeredAgent = postRegistrationAgents.find((agent) => agent.id === instanceId);
    const observation = assessRegistration({ workspacePath, agentDir: realAgentDir }, registeredAgent);
    if (observation.status !== "registered") {
      throw new Error(
        `OpenClaw Agent ${instanceId} 的 add 命令已成功，但注册结果缺失或发生配置漂移；` +
        "未执行 agents delete 自动清理。请运行 instances reconcile 后人工核对。"
      );
    }

    const now = settings.now().toISOString();
    const record = {
      instanceId,
      roleId,
      roleVersion: role.roleVersion,
      roleAgentId,
      workspacePath,
      agentDir: realAgentDir,
      status: "registered",
      registeredAt: now,
      updatedAt: now,
      lastReconciledAt: now,
      drift: []
    };

    try {
      const updated = await settings.instanceStateStore.updateInstanceState(
        settings.instanceStatePath,
        (latestState) => {
          if (latestState.instances[instanceId]) {
            throw new Error("Agent Instance 状态发生并发冲突：" + instanceId);
          }
          assertMappingAvailable(latestState, record);
          latestState.instances[instanceId] = record;
          return latestState;
        }
      );
      return {
        ok: true,
        alreadyRegistered: false,
        instance: getInstanceState(updated, instanceId)
      };
    } catch (error) {
      throw new Error(
        `OpenClaw Agent ${instanceId} 已注册，但本地 Instance State 写入失败；` +
        `为保护 workspace，未执行 agents delete 自动清理。请运行 instances reconcile 后人工核对。（${error.message}）`
      );
    }
  });
}

async function reconcileInstances(options = {}) {
  const settings = resolveSettings(options);
  await settings.instanceStateStore.readInstanceState(settings.instanceStatePath);
  const openClawAgents = await settings.openClawAdapter.listAgents();
  const remoteById = new Map(openClawAgents.map((agent) => [agent.id, agent]));
  const reconciledAt = settings.now().toISOString();

  const updated = await settings.instanceStateStore.updateInstanceState(
    settings.instanceStatePath,
    (state) => {
      for (const record of Object.values(state.instances)) {
        const observation = assessRegistration(record, remoteById.get(record.instanceId));
        record.status = observation.status;
        record.drift = observation.drift;
        record.lastReconciledAt = reconciledAt;
        record.updatedAt = reconciledAt;
      }
      return state;
    }
  );

  const managedIds = new Set(Object.keys(updated.instances));
  return {
    reconciledAt,
    instances: listInstanceStates(updated),
    unmanagedAgents: openClawAgents.filter((agent) => !managedIds.has(agent.id))
  };
}

async function disableInstance() {
  throw new Error(
    "当前不支持安全无损停用 Agent Instance：OpenClaw 没有原生 enable/disable，" +
    "ToolBox 不会使用 agents delete、unbind 或直接修改 openclaw.json 冒充停用。"
  );
}

function assessRegistration(record, openClawAgent) {
  if (!openClawAgent) {
    return { status: "missing", drift: ["missing"] };
  }
  const drift = [];
  if (openClawAgent.workspacePath !== path.resolve(record.workspacePath)) {
    drift.push("workspace");
  }
  if (openClawAgent.agentDir !== path.resolve(record.agentDir)) {
    drift.push("agent-dir");
  }
  return drift.length
    ? { status: "drifted", drift: drift.sort() }
    : { status: "registered", drift: [] };
}

async function recordObservation(instanceId, observation, settings) {
  const observedAt = settings.now().toISOString();
  const updated = await settings.instanceStateStore.updateInstanceState(
    settings.instanceStatePath,
    (state) => {
      const record = state.instances[instanceId];
      if (!record) {
        throw new Error("Agent Instance 状态发生并发冲突：" + instanceId);
      }
      record.status = observation.status;
      record.drift = observation.drift;
      record.lastReconciledAt = observedAt;
      record.updatedAt = observedAt;
      return state;
    }
  );
  return getInstanceState(updated, instanceId);
}

async function requireSafeRoleWorkspace(role, roleAgent, settings) {
  if (role.roleId === "main" || roleAgent.agentId === "main") {
    throw new Error("main Agent 受保护，不能注册为 Agent Instance。");
  }
  const expected = path.join(role.workspacePath, "workspaces", roleAgent.agentId);
  const candidate = path.resolve(roleAgent.workspacePath);
  if (candidate !== path.resolve(expected)) {
    throw new Error("Role Agent workspace 与安装记录不一致：" + roleAgent.agentId);
  }
  if (pathsOverlap(candidate, settings.mainWorkspace)) {
    throw new Error("Role Agent workspace 不能与 main workspace 重叠。");
  }
  const stats = await settings.fileSystem.lstat(candidate);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error("Role Agent workspace 必须是普通目录且不能是符号链接：" + candidate);
  }
  const realWorkspace = await settings.fileSystem.realpath(candidate);
  if (realWorkspace !== candidate) {
    throw new Error("Role Agent workspace realpath 发生变化，拒绝注册：" + candidate);
  }
  return realWorkspace;
}

async function prepareAgentDirRoot(settings) {
  assertSafeAgentDirRoot(settings.agentDirRoot, settings);
  await settings.fileSystem.mkdir(settings.agentDirRoot, { recursive: true });
  const stats = await settings.fileSystem.lstat(settings.agentDirRoot);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error("Agent Instance agentDir 根目录必须是普通目录且不能是符号链接。");
  }
  const realRoot = await settings.fileSystem.realpath(settings.agentDirRoot);
  if (realRoot !== path.resolve(settings.agentDirRoot)) {
    throw new Error("Agent Instance agentDir 根目录 realpath 发生变化。");
  }
  assertSafeAgentDirRoot(realRoot, settings);
  return realRoot;
}

function assertSafeAgentDirRoot(agentDirRoot, settings) {
  const root = path.resolve(agentDirRoot);
  if (root === path.parse(root).root || root === path.resolve(os.homedir())) {
    throw new Error("Agent Instance agentDir 根目录不能是文件系统根目录或用户主目录。");
  }
  if (pathsOverlap(root, PROJECT_ROOT)) {
    throw new Error("Agent Instance agentDir 根目录不能与项目目录重叠。");
  }
  if (pathsOverlap(root, settings.mainWorkspace)) {
    throw new Error("Agent Instance agentDir 根目录不能与 main workspace 重叠。");
  }
}

function assertSafeAgentDirCandidate(agentDir, settings) {
  assertSafeAgentDirRoot(settings.agentDirRoot, settings);
  const candidate = path.resolve(agentDir);
  const root = path.resolve(settings.agentDirRoot);
  if (!isInside(candidate, root)) {
    throw new Error("Agent Instance agentDir 越出 ToolBox 管理目录：" + candidate);
  }
  if (pathsOverlap(candidate, settings.mainWorkspace)) {
    throw new Error("Agent Instance agentDir 不能与 main workspace 重叠。");
  }
  if (pathsOverlap(candidate, settings.instanceStatePath)) {
    throw new Error("Agent Instance agentDir 不能覆盖 Instance State。");
  }
}

function assertSameMapping(existing, expected) {
  for (const field of ["roleId", "roleVersion", "roleAgentId", "workspacePath", "agentDir"]) {
    const left = field.endsWith("Path") || field === "agentDir"
      ? path.resolve(existing[field])
      : existing[field];
    const right = field.endsWith("Path") || field === "agentDir"
      ? path.resolve(expected[field])
      : expected[field];
    if (left !== right) {
      throw new Error(`Agent Instance 已存在但 ${field} 映射不一致：${existing.instanceId}`);
    }
  }
}

function assertMappingAvailable(state, candidate) {
  for (const record of Object.values(state.instances)) {
    if (record.instanceId === candidate.instanceId) {
      continue;
    }
    if (record.roleId === candidate.roleId && record.roleAgentId === candidate.roleAgentId) {
      throw new Error("Role Agent 已映射到其他 Agent Instance：" + record.instanceId);
    }
    if (path.resolve(record.workspacePath) === path.resolve(candidate.workspacePath)) {
      throw new Error("workspace 已归属于其他 Agent Instance：" + record.instanceId);
    }
    if (path.resolve(record.agentDir) === path.resolve(candidate.agentDir)) {
      throw new Error("agentDir 已归属于其他 Agent Instance：" + record.instanceId);
    }
  }
}

function assertRemoteAgentDirAvailable(openClawAgents, agentDir) {
  const collision = openClawAgents.find((agent) => (
    agent.agentDir && path.resolve(agent.agentDir) === path.resolve(agentDir)
  ));
  if (collision) {
    throw new Error("agentDir 已由 OpenClaw Agent 使用：" + collision.id);
  }
}

function resolveSettings(options) {
  const dataDirectory = path.resolve(options.dataDirectory || DEFAULT_INSTANCE_DATA_DIRECTORY);
  const settings = {
    instanceStatePath: path.resolve(
      options.instanceStatePath || path.join(dataDirectory, "state.json")
    ),
    agentDirRoot: path.resolve(options.agentDirRoot || path.join(dataDirectory, "agent-dirs")),
    roleStatePath: path.resolve(options.roleStatePath || DEFAULT_ROLE_STATE_PATH),
    mainWorkspace: path.resolve(options.mainWorkspace || DEFAULT_MAIN_WORKSPACE),
    fileSystem: options.fileSystem || fs,
    now: options.now || (() => new Date()),
    instanceStateStore: options.instanceStateStore || {
      readInstanceState,
      updateInstanceState
    },
    roleStateStore: options.roleStateStore || { readRoleState },
    openClawAdapter: options.openClawAdapter || createOpenClawAdapter({
      commandRunner: options.commandRunner,
      command: options.openClawCommand,
      timeoutMs: options.commandTimeoutMs
    })
  };
  return settings;
}

function assertRoleOrAgentId(value, field) {
  if (typeof value !== "string" || !ROLE_ID_PATTERN.test(value)) {
    throw new Error(`${field} 无效：${String(value || "")}`);
  }
  if (value === "main") {
    throw new Error(`${field} 不能使用受保护名称 main。`);
  }
}

function pathsOverlap(left, right) {
  const leftPath = path.resolve(left);
  const rightPath = path.resolve(right);
  return leftPath === rightPath || isInside(leftPath, rightPath) || isInside(rightPath, leftPath);
}

function isInside(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return Boolean(relative) && !relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative);
}

async function pathExists(targetPath, fileSystem = fs) {
  try {
    await fileSystem.lstat(targetPath);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function withInstanceLock(instanceId, operation) {
  const previous = instanceLocks.get(instanceId) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  const tail = current.catch(() => {});
  instanceLocks.set(instanceId, tail);

  return current.finally(() => {
    if (instanceLocks.get(instanceId) === tail) {
      instanceLocks.delete(instanceId);
    }
  });
}

module.exports = {
  DEFAULT_AGENT_DIR_ROOT,
  DEFAULT_INSTANCE_DATA_DIRECTORY,
  DEFAULT_INSTANCE_STATE_PATH,
  assessRegistration,
  disableInstance,
  inspectInstance,
  listInstances,
  reconcileInstances,
  registerInstance
};
