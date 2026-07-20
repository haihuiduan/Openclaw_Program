const fs = require("node:fs/promises");
const path = require("node:path");

const ROLE_MANIFEST_SCHEMA_VERSION = 1;
const ROLE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REQUIRED_AGENT_FILES = Object.freeze([
  "AGENTS.md",
  "IDENTITY.md",
  "SOUL.md",
  "TOOLS.md"
]);

async function validateRolePackage(roleDirectory, options = {}) {
  const resolvedRoleDirectory = path.resolve(roleDirectory);
  const roleStats = await lstatWithMessage(
    resolvedRoleDirectory,
    "未找到角色包目录：" + resolvedRoleDirectory
  );

  if (roleStats.isSymbolicLink()) {
    throw new Error("角色包目录不能是符号链接：" + resolvedRoleDirectory);
  }
  if (!roleStats.isDirectory()) {
    throw new Error("角色包路径不是目录：" + resolvedRoleDirectory);
  }

  const realRoleDirectory = await fs.realpath(resolvedRoleDirectory);
  if (options.rolesDirectory) {
    const realRolesDirectory = await fs.realpath(path.resolve(options.rolesDirectory));
    assertInside(realRoleDirectory, realRolesDirectory, "角色包目录越出 roles 根目录");
  }

  const manifestPath = path.join(realRoleDirectory, "manifest.json");
  await assertRegularFileInside(manifestPath, realRoleDirectory, "角色包缺少 manifest.json");

  let manifestText;
  try {
    manifestText = await fs.readFile(manifestPath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error("角色包缺少 manifest.json：" + realRoleDirectory);
    }
    throw error;
  }

  let manifest;
  try {
    manifest = JSON.parse(manifestText);
  } catch (error) {
    throw new Error("角色包 manifest.json 不是有效 JSON：" + realRoleDirectory);
  }

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("角色包 manifest.json 必须是 JSON 对象：" + realRoleDirectory);
  }
  if (manifest.schemaVersion !== ROLE_MANIFEST_SCHEMA_VERSION) {
    throw new Error(`角色包 schemaVersion 必须为 ${ROLE_MANIFEST_SCHEMA_VERSION}：${realRoleDirectory}`);
  }

  assertRequiredText(manifest, "id", "角色包 id 必须是非空字符串");
  assertRequiredText(manifest, "name", "角色包 name 必须是非空字符串");
  assertRequiredText(manifest, "version", "角色包 version 必须是非空字符串");
  assertOptionalText(manifest, "description", "角色包 description 必须是字符串");

  if (!ROLE_ID_PATTERN.test(manifest.id)) {
    throw new Error("角色包 role id 无效：" + manifest.id);
  }
  if (manifest.id === "main") {
    throw new Error("角色包 role id 不能使用受保护名称 main。");
  }
  if (path.basename(realRoleDirectory) !== manifest.id) {
    throw new Error("角色包目录名必须与 role id 一致：" + manifest.id);
  }
  if (!Array.isArray(manifest.agents) || manifest.agents.length === 0) {
    throw new Error("角色包 agents 必须是非空数组：" + manifest.id);
  }

  const agentsRoot = path.join(realRoleDirectory, "agents");
  const agentsRootStats = await lstatWithMessage(
    agentsRoot,
    "角色包缺少 agents 目录：" + manifest.id
  );
  if (agentsRootStats.isSymbolicLink() || !agentsRootStats.isDirectory()) {
    throw new Error("角色包 agents 路径必须是普通目录：" + manifest.id);
  }
  const realAgentsRoot = await fs.realpath(agentsRoot);
  assertInside(realAgentsRoot, realRoleDirectory, "角色包 agents 目录越界");

  const agentIds = new Set();
  const agents = [];

  for (const entry of manifest.agents) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("角色包 agent 配置必须是 JSON 对象：" + manifest.id);
    }
    assertRequiredText(entry, "id", "角色包 agent id 必须是非空字符串");
    assertRequiredText(entry, "name", "角色包 agent name 必须是非空字符串：" + entry.id);
    assertOptionalText(entry, "description", "角色包 agent description 必须是字符串：" + entry.id);

    if (!ROLE_ID_PATTERN.test(entry.id)) {
      throw new Error("角色包 agent id 无效：" + entry.id);
    }
    if (entry.id === "main") {
      throw new Error("角色包 agent id 不能使用受保护名称 main。");
    }
    if (agentIds.has(entry.id)) {
      throw new Error("角色包包含重复 agent id：" + entry.id);
    }
    agentIds.add(entry.id);

    const agentDirectory = path.join(realAgentsRoot, entry.id);
    const stats = await lstatWithMessage(
      agentDirectory,
      "角色包缺少 agent 目录：agents/" + entry.id
    );
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error("角色包 agent 路径必须是普通目录：agents/" + entry.id);
    }

    const realAgentDirectory = await fs.realpath(agentDirectory);
    assertInside(realAgentDirectory, realAgentsRoot, "角色包 agent 目录越界：" + entry.id);
    await assertNoSymbolicLinks(realAgentDirectory, realRoleDirectory);

    for (const fileName of REQUIRED_AGENT_FILES) {
      await assertRegularFileInside(
        path.join(realAgentDirectory, fileName),
        realAgentDirectory,
        `角色包 agent ${entry.id} 缺少标准文件 ${fileName}`
      );
    }

    agents.push({
      id: entry.id,
      name: entry.name.trim(),
      description: normalizeText(entry.description),
      directory: realAgentDirectory,
      files: [...REQUIRED_AGENT_FILES]
    });
  }

  return {
    schemaVersion: manifest.schemaVersion,
    id: manifest.id,
    name: manifest.name.trim(),
    version: manifest.version.trim(),
    description: normalizeText(manifest.description),
    agentCount: agents.length,
    agents,
    directory: realRoleDirectory,
    manifestPath
  };
}

async function assertNoSymbolicLinks(directory, roleRoot) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error("角色包不允许包含符号链接：" + entryPath);
    }
    if (entry.isDirectory()) {
      const realEntryPath = await fs.realpath(entryPath);
      assertInside(realEntryPath, roleRoot, "角色包目录越界");
      await assertNoSymbolicLinks(realEntryPath, roleRoot);
    }
  }
}

async function assertRegularFileInside(filePath, parentDirectory, missingMessage) {
  const stats = await lstatWithMessage(filePath, missingMessage + "：" + filePath);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error("角色包文件必须是普通文件且不能是符号链接：" + filePath);
  }
  const realFilePath = await fs.realpath(filePath);
  assertInside(realFilePath, parentDirectory, "角色包文件路径越界");
}

async function lstatWithMessage(targetPath, missingMessage) {
  try {
    return await fs.lstat(targetPath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error(missingMessage);
    }
    throw error;
  }
}

function assertInside(candidate, parent, message) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  if (relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))) {
    return;
  }
  throw new Error(message + "：" + candidate);
}

function assertRequiredText(object, key, message) {
  if (typeof object[key] !== "string" || !object[key].trim()) {
    throw new Error(message);
  }
}

function assertOptionalText(object, key, message) {
  if (object[key] !== undefined && typeof object[key] !== "string") {
    throw new Error(message);
  }
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

module.exports = {
  REQUIRED_AGENT_FILES,
  ROLE_ID_PATTERN,
  ROLE_MANIFEST_SCHEMA_VERSION,
  validateRolePackage
};
