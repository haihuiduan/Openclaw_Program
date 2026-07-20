const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  DEFAULT_ROLES_DIRECTORY,
  findRolePackage: findRegistryRolePackage
} = require("./registry");
const {
  getRoleState,
  listRoleStates,
  readRoleState,
  updateRoleState
} = require("./state");
const { REQUIRED_AGENT_FILES, ROLE_ID_PATTERN } = require("./validator");
const {
  listInstanceStates,
  readInstanceState
} = require("../agent-instances/state");

const DEFAULT_ROLE_DATA_DIRECTORY = path.join(os.homedir(), ".openclaw-installer", "roles");
const DEFAULT_ROLE_INSTALL_ROOT = path.join(DEFAULT_ROLE_DATA_DIRECTORY, "installed");
const DEFAULT_ROLE_STATE_PATH = path.join(DEFAULT_ROLE_DATA_DIRECTORY, "state.json");
const DEFAULT_MAIN_WORKSPACE = path.join(os.homedir(), ".openclaw", "workspace");
const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const roleLocks = new Map();

async function inspectRole(roleId, options = {}) {
  const settings = resolveSettings(options);
  const role = await findRolePackage(roleId, settings);
  const state = await settings.stateStore.readRoleState(settings.statePath);
  const installed = getRoleState(state, role.id);

  return {
    ...role,
    installed: Boolean(installed),
    installedVersion: installed ? installed.roleVersion : null,
    installedAt: installed ? installed.installedAt : null,
    status: installed ? installed.status : "not-installed"
  };
}

async function listInstalledRoles(options = {}) {
  const settings = resolveSettings(options);
  const state = await settings.stateStore.readRoleState(settings.statePath);

  return listRoleStates(state).map((record) => ({
    id: record.roleId,
    name: record.roleName,
    version: record.roleVersion,
    installedAt: record.installedAt,
    status: record.status,
    agentCount: record.agents.length,
    workspacePath: record.workspacePath
  }));
}

async function installRole(roleId, options = {}) {
  assertValidRoleId(roleId);
  return withRoleLock(roleId, async () => {
    const settings = resolveSettings(options);
    const role = await findRolePackage(roleId, settings);
    const initialState = await settings.stateStore.readRoleState(settings.statePath);
    const existing = getRoleState(initialState, role.id);

    if (existing) {
      if (existing.roleVersion !== role.version) {
        throw new Error(
          `角色 ${role.id} 已安装版本 ${existing.roleVersion}，当前角色包版本为 ${role.version}；本阶段尚不支持直接升级。`
        );
      }
      const realInstallRoot = await requireInstallRoot(settings);
      const expectedTarget = path.join(realInstallRoot, role.id);
      if (path.resolve(existing.workspacePath) !== expectedTarget) {
        throw new Error("角色状态指向非本角色 workspace，拒绝按已安装处理：" + existing.workspacePath);
      }
      await assertManagedExistingDirectory(expectedTarget, realInstallRoot, settings);
      await verifyInstalledWorkspaces(existing, expectedTarget, realInstallRoot, settings);
      return createInstallResult(role, existing.workspacePath, true);
    }

    const realInstallRoot = await prepareInstallRoot(settings);
    const targetDirectory = path.join(realInstallRoot, role.id);
    assertLifecyclePaths(settings, targetDirectory, realInstallRoot);

    if (await pathExists(targetDirectory, settings.fileSystem)) {
      throw new Error("角色安装目录已存在，拒绝覆盖用户已有 workspace：" + targetDirectory);
    }

    const stagingDirectory = await settings.fileSystem.mkdtemp(
      path.join(realInstallRoot, `.${role.id}-install-`)
    );
    let published = false;

    try {
      await settings.fileSystem.copyFile(role.manifestPath, path.join(stagingDirectory, "manifest.json"));
      const workspacesDirectory = path.join(stagingDirectory, "workspaces");
      await settings.fileSystem.mkdir(workspacesDirectory, { recursive: true });

      const stagedAgents = [];
      for (const agent of role.agents) {
        assertValidAgentId(agent.id);
        const workspace = path.join(workspacesDirectory, agent.id);
        await settings.fileSystem.mkdir(workspace, { recursive: false });
        const sourceDigest = await calculateStandardFilesDigest(agent.directory, settings.fileSystem);

        for (const fileName of REQUIRED_AGENT_FILES) {
          await settings.fileSystem.copyFile(
            path.join(agent.directory, fileName),
            path.join(workspace, fileName)
          );
        }

        stagedAgents.push({
          agentId: agent.id,
          stagingWorkspace: workspace,
          sourceDigest,
          contentDigest: await calculateDirectoryDigest(workspace, settings.fileSystem)
        });
      }

      await validateStagedWorkspaces(stagingDirectory, role, stagedAgents, settings.fileSystem);
      await settings.fileSystem.rename(stagingDirectory, targetDirectory);
      published = true;

      const installedAt = settings.now().toISOString();
      const record = {
        roleId: role.id,
        roleName: role.name,
        roleVersion: role.version,
        status: "installed",
        installedAt,
        updatedAt: installedAt,
        enabled: false,
        workspacePath: targetDirectory,
        sourceRolePath: role.directory,
        agents: stagedAgents.map((agent) => ({
          agentId: agent.agentId,
          workspacePath: path.join(targetDirectory, "workspaces", agent.agentId),
          contentDigest: agent.contentDigest
        }))
      };

      await settings.stateStore.updateRoleState(settings.statePath, (state) => {
        const concurrentRecord = state.roles[role.id];
        if (concurrentRecord) {
          throw new Error("角色安装状态发生并发冲突：" + role.id);
        }
        state.roles[role.id] = record;
        return state;
      });

      return createInstallResult(role, targetDirectory, false);
    } catch (error) {
      const cleanupTarget = published ? targetDirectory : stagingDirectory;
      try {
        await removeManagedPath(cleanupTarget, realInstallRoot, settings);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `角色安装失败且未能完整清理 staging/workspace：${role.id}`
        );
      }
      throw error;
    }
  });
}

async function removeRole(roleId, options = {}) {
  assertValidRoleId(roleId);
  return withRoleLock(roleId, async () => {
    const settings = resolveSettings(options);
    const state = await settings.stateStore.readRoleState(settings.statePath);
    const record = getRoleState(state, roleId);

    if (!record) {
      throw new Error("角色尚未安装：" + roleId);
    }
    const instanceState = await settings.instanceStateStore.readInstanceState(
      settings.instanceStatePath
    );
    const referencingInstances = listInstanceStates(instanceState)
      .filter((instance) => instance.roleId === roleId);
    if (referencingInstances.length) {
      throw new Error(
        `角色仍被 Agent Instance 引用，拒绝删除 workspace：` +
        referencingInstances.map((instance) => instance.instanceId).join(", ")
      );
    }
    if (record.enabled === true) {
      throw new Error("角色仍处于启用状态，请先停用：" + roleId);
    }

    const realInstallRoot = await requireInstallRoot(settings);
    const expectedTarget = path.join(realInstallRoot, roleId);
    const targetDirectory = path.resolve(record.workspacePath);
    assertLifecyclePaths(settings, targetDirectory, realInstallRoot);

    if (targetDirectory !== expectedTarget) {
      throw new Error("角色安装记录指向非本角色 workspace，拒绝删除：" + targetDirectory);
    }
    await assertManagedExistingDirectory(targetDirectory, realInstallRoot, settings);
    await verifyInstalledWorkspaces(record, targetDirectory, realInstallRoot, settings);

    const quarantineDirectory = path.join(
      realInstallRoot,
      `.${roleId}-remove-${process.pid}-${Date.now()}`
    );
    assertManagedCandidate(quarantineDirectory, realInstallRoot, settings);
    await settings.fileSystem.rename(targetDirectory, quarantineDirectory);

    try {
      await settings.stateStore.updateRoleState(settings.statePath, (latestState) => {
        const latestRecord = latestState.roles[roleId];
        if (!latestRecord || JSON.stringify(latestRecord) !== JSON.stringify(record)) {
          throw new Error("角色安装状态发生并发冲突：" + roleId);
        }
        delete latestState.roles[roleId];
        return latestState;
      });
    } catch (error) {
      try {
        await settings.fileSystem.rename(quarantineDirectory, targetDirectory);
      } catch (restoreError) {
        throw new AggregateError([error, restoreError], "角色卸载失败且 workspace 恢复失败：" + roleId);
      }
      throw error;
    }

    try {
      await removeManagedPath(quarantineDirectory, realInstallRoot, settings);
    } catch (error) {
      const restoreErrors = [];
      try {
        await settings.fileSystem.rename(quarantineDirectory, targetDirectory);
      } catch (restoreError) {
        restoreErrors.push(restoreError);
      }
      try {
        await settings.stateStore.updateRoleState(settings.statePath, (latestState) => {
          if (latestState.roles[roleId]) {
            throw new Error("恢复角色状态时发现同名记录：" + roleId);
          }
          latestState.roles[roleId] = record;
          return latestState;
        });
      } catch (restoreError) {
        restoreErrors.push(restoreError);
      }
      if (restoreErrors.length) {
        throw new AggregateError([error, ...restoreErrors], "角色卸载失败且未能完整恢复：" + roleId);
      }
      throw new Error("角色卸载清理失败，已恢复原状态和 workspace：" + error.message);
    }

    return {
      ok: true,
      roleId,
      removed: true
    };
  });
}

async function findRolePackage(roleId, options = {}) {
  assertValidRoleId(roleId);
  return findRegistryRolePackage(roleId, {
    rolesDirectory: options.rolesDirectory || DEFAULT_ROLES_DIRECTORY
  });
}

async function prepareInstallRoot(settings) {
  assertSafeConfiguredRoot(settings.installRoot, settings);
  await settings.fileSystem.mkdir(settings.installRoot, { recursive: true });
  return requireInstallRoot(settings);
}

async function requireInstallRoot(settings) {
  let stats;
  try {
    stats = await settings.fileSystem.lstat(settings.installRoot);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error("角色状态存在但 workspace 根目录不存在：" + settings.installRoot);
    }
    throw error;
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error("角色 workspace 根目录必须是普通目录：" + settings.installRoot);
  }
  const realInstallRoot = await settings.fileSystem.realpath(settings.installRoot);
  assertSafeConfiguredRoot(realInstallRoot, settings);
  return realInstallRoot;
}

function assertSafeConfiguredRoot(installRoot, settings) {
  const resolvedRoot = path.resolve(installRoot);
  const filesystemRoot = path.parse(resolvedRoot).root;
  const homeDirectory = path.resolve(os.homedir());

  if (resolvedRoot === filesystemRoot || resolvedRoot === homeDirectory) {
    throw new Error("角色 workspace 根目录不能是文件系统根目录或用户主目录。");
  }
  if (pathsOverlap(resolvedRoot, PROJECT_ROOT)) {
    throw new Error("角色 workspace 根目录不能与项目目录重叠。");
  }
  if (pathsOverlap(resolvedRoot, settings.mainWorkspace)) {
    throw new Error("角色安装目录不能与 main workspace 重叠。");
  }
}

function assertLifecyclePaths(settings, targetDirectory, installRoot) {
  assertManagedCandidate(targetDirectory, installRoot, settings);
  if (isSameOrInside(settings.statePath, targetDirectory)) {
    throw new Error("角色状态文件不能位于待管理 workspace 内部。");
  }
}

function assertManagedCandidate(candidate, installRoot, settings) {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(installRoot);
  if (resolvedCandidate === resolvedRoot || !isSameOrInside(resolvedCandidate, resolvedRoot)) {
    throw new Error("角色 workspace 路径越出允许根目录：" + resolvedCandidate);
  }
  if (pathsOverlap(resolvedCandidate, settings.mainWorkspace)) {
    throw new Error("角色 workspace 不能与 main workspace 重叠。");
  }
  if (resolvedCandidate === path.resolve(os.homedir()) || resolvedCandidate === PROJECT_ROOT) {
    throw new Error("拒绝操作用户主目录或项目目录。");
  }
}

async function assertManagedExistingDirectory(candidate, installRoot, settings) {
  assertManagedCandidate(candidate, installRoot, settings);
  const stats = await settings.fileSystem.lstat(candidate);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error("角色 workspace 必须是普通目录且不能是符号链接：" + candidate);
  }
  const realCandidate = await settings.fileSystem.realpath(candidate);
  if (realCandidate !== path.resolve(candidate) || !isSameOrInside(realCandidate, installRoot)) {
    throw new Error("角色 workspace realpath 越界或包含路径替换：" + candidate);
  }
}

async function verifyInstalledWorkspaces(record, targetDirectory, installRoot, settings) {
  if (record.roleId === "main") {
    throw new Error("main Agent 受保护，不能删除。");
  }
  if (!Array.isArray(record.agents) || record.agents.length === 0) {
    throw new Error("角色安装记录缺少 Agent workspace：" + record.roleId);
  }

  for (const agent of record.agents) {
    assertValidAgentId(agent.agentId);
    const expectedWorkspace = path.join(targetDirectory, "workspaces", agent.agentId);
    if (path.resolve(agent.workspacePath) !== expectedWorkspace) {
      throw new Error("Agent 安装记录指向非本角色 workspace，拒绝删除：" + agent.agentId);
    }
    await assertManagedExistingDirectory(expectedWorkspace, installRoot, settings);
    const currentDigest = await calculateDirectoryDigest(expectedWorkspace, settings.fileSystem);
    if (currentDigest !== agent.contentDigest) {
      throw new Error(`Agent workspace 已被用户修改，拒绝删除：${agent.agentId}`);
    }
  }
}

async function validateStagedWorkspaces(stagingDirectory, role, stagedAgents, fileSystem) {
  const workspacesRoot = path.join(stagingDirectory, "workspaces");
  const entries = await fileSystem.readdir(workspacesRoot, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort();
  const expected = role.agents.map((agent) => agent.id).sort();
  if (JSON.stringify(names) !== JSON.stringify(expected) || entries.some((entry) => !entry.isDirectory())) {
    throw new Error("staging 中的 Agent workspace 结构无效。");
  }

  for (const agent of stagedAgents) {
    const standardFilesDigest = await calculateStandardFilesDigest(agent.stagingWorkspace, fileSystem);
    if (standardFilesDigest !== agent.sourceDigest) {
      throw new Error("staging 文件与来源角色包不一致：" + agent.agentId);
    }
    const digest = await calculateDirectoryDigest(agent.stagingWorkspace, fileSystem);
    if (digest !== agent.contentDigest) {
      throw new Error("staging 内容验证失败：" + agent.agentId);
    }
  }
}

async function calculateStandardFilesDigest(directory, fileSystem = fs) {
  const hash = crypto.createHash("sha256");
  for (const fileName of [...REQUIRED_AGENT_FILES].sort()) {
    const filePath = path.join(directory, fileName);
    const stats = await fileSystem.lstat(filePath);
    if (stats.isSymbolicLink() || !stats.isFile()) {
      throw new Error("Agent 标准文件必须是普通文件：" + filePath);
    }
    hash.update(`F\0${fileName}\0`);
    hash.update(await fileSystem.readFile(filePath));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function calculateDirectoryDigest(directory, fileSystem = fs) {
  const hash = crypto.createHash("sha256");
  await appendDirectoryDigest(hash, directory, directory, fileSystem);
  return hash.digest("hex");
}

async function appendDirectoryDigest(hash, root, current, fileSystem) {
  const entries = await fileSystem.readdir(current, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const entryPath = path.join(current, entry.name);
    const relative = path.relative(root, entryPath);
    if (entry.isSymbolicLink()) {
      throw new Error("workspace 不允许包含符号链接：" + entryPath);
    }
    if (entry.isDirectory()) {
      hash.update(`D\0${relative}\0`);
      await appendDirectoryDigest(hash, root, entryPath, fileSystem);
    } else if (entry.isFile()) {
      hash.update(`F\0${relative}\0`);
      hash.update(await fileSystem.readFile(entryPath));
      hash.update("\0");
    } else {
      throw new Error("workspace 包含不支持的文件类型：" + entryPath);
    }
  }
}

async function removeManagedPath(targetPath, installRoot, settings) {
  assertManagedCandidate(targetPath, installRoot, settings);
  if (!await pathExists(targetPath, settings.fileSystem)) {
    return;
  }
  await assertManagedExistingDirectory(targetPath, installRoot, settings);
  await settings.fileSystem.rm(targetPath, { recursive: true, force: false });
}

function createInstallResult(role, installDirectory, alreadyInstalled) {
  return {
    ok: true,
    roleId: role.id,
    name: role.name,
    version: role.version,
    installed: true,
    enabled: false,
    alreadyInstalled,
    installDirectory,
    agentCount: role.agentCount
  };
}

function resolveSettings(options) {
  const dataDirectory = path.resolve(options.dataDirectory || DEFAULT_ROLE_DATA_DIRECTORY);
  const statePath = path.resolve(options.statePath || path.join(dataDirectory, "state.json"));
  const instanceStatePath = options.instanceStatePath
    ? path.resolve(options.instanceStatePath)
    : inferInstanceStatePath(options, dataDirectory, statePath);
  return {
    rolesDirectory: path.resolve(options.rolesDirectory || DEFAULT_ROLES_DIRECTORY),
    installRoot: path.resolve(options.installRoot || path.join(dataDirectory, "installed")),
    statePath,
    instanceStatePath,
    mainWorkspace: path.resolve(options.mainWorkspace || DEFAULT_MAIN_WORKSPACE),
    fileSystem: options.fileSystem || fs,
    now: options.now || (() => new Date()),
    stateStore: options.stateStore || { readRoleState, updateRoleState },
    instanceStateStore: options.instanceStateStore || { readInstanceState }
  };
}

function inferInstanceStatePath(options, dataDirectory, statePath) {
  if (options.dataDirectory) {
    return path.join(path.dirname(dataDirectory), "agent-instances", "state.json");
  }
  if (options.statePath) {
    return path.join(path.dirname(statePath), "agent-instances.json");
  }
  return path.join(path.dirname(DEFAULT_ROLE_DATA_DIRECTORY), "agent-instances", "state.json");
}

function assertValidRoleId(roleId) {
  if (!ROLE_ID_PATTERN.test(roleId || "")) {
    throw new Error("角色 role id 无效：" + String(roleId || ""));
  }
  if (roleId === "main") {
    throw new Error("角色 role id 不能使用受保护名称 main。");
  }
}

function assertValidAgentId(agentId) {
  if (!ROLE_ID_PATTERN.test(agentId || "") || agentId === "main") {
    throw new Error("角色 agent id 无效或使用受保护名称 main：" + String(agentId || ""));
  }
}

function pathsOverlap(left, right) {
  const leftPath = path.resolve(left);
  const rightPath = path.resolve(right);
  return isSameOrInside(leftPath, rightPath) || isSameOrInside(rightPath, leftPath);
}

function isSameOrInside(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
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

function withRoleLock(roleId, operation) {
  const previous = roleLocks.get(roleId) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  const tail = current.catch(() => {});
  roleLocks.set(roleId, tail);

  return current.finally(() => {
    if (roleLocks.get(roleId) === tail) {
      roleLocks.delete(roleId);
    }
  });
}

module.exports = {
  DEFAULT_MAIN_WORKSPACE,
  DEFAULT_ROLE_DATA_DIRECTORY,
  DEFAULT_ROLE_INSTALL_ROOT,
  DEFAULT_ROLE_STATE_PATH,
  calculateDirectoryDigest,
  calculateStandardFilesDigest,
  findRolePackage,
  inspectRole,
  installRole,
  listInstalledRoles,
  removeRole
};
