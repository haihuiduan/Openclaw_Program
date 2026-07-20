const fs = require("node:fs/promises");
const path = require("node:path");
const { ROLE_ID_PATTERN, validateRolePackage } = require("./validator");

const DEFAULT_ROLES_DIRECTORY = path.resolve(__dirname, "../../../roles");

async function scanRoleRegistry(options = {}) {
  const rolesDirectory = path.resolve(options.rolesDirectory || DEFAULT_ROLES_DIRECTORY);
  let entries;

  try {
    entries = await fs.readdir(rolesDirectory, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { roles: [], invalidRoles: [] };
    }
    throw error;
  }

  const roles = [];
  const invalidRoles = [];
  const directories = entries
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of directories) {
    const roleDirectory = path.join(rolesDirectory, entry.name);
    try {
      roles.push(await validateRolePackage(roleDirectory, { rolesDirectory }));
    } catch (error) {
      invalidRoles.push({
        directory: roleDirectory,
        message: error.message
      });
    }
  }

  return { roles, invalidRoles };
}

async function listRoles(options = {}) {
  const result = await scanRoleRegistry(options);
  return result.roles;
}

async function findRolePackage(roleId, options = {}) {
  assertValidRoleId(roleId);
  const rolesDirectory = path.resolve(options.rolesDirectory || DEFAULT_ROLES_DIRECTORY);
  const roleDirectory = path.resolve(rolesDirectory, roleId);
  const relative = path.relative(rolesDirectory, roleDirectory);

  if (relative.startsWith(".." + path.sep) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error("角色路径越出 roles 根目录：" + roleId);
  }

  try {
    await fs.lstat(roleDirectory);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error("未找到角色：" + roleId);
    }
    throw error;
  }

  try {
    return await validateRolePackage(roleDirectory, { rolesDirectory });
  } catch (error) {
    throw new Error(`角色包 ${roleId} 无效：${error.message}`);
  }
}

function assertValidRoleId(roleId) {
  if (!ROLE_ID_PATTERN.test(roleId || "")) {
    throw new Error("角色 role id 无效：" + String(roleId || ""));
  }
  if (roleId === "main") {
    throw new Error("角色 role id 不能使用受保护名称 main。");
  }
}

module.exports = {
  DEFAULT_ROLES_DIRECTORY,
  findRolePackage,
  listRoles,
  scanRoleRegistry
};
