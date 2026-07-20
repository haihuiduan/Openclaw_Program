const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { projectPath } = require("./helpers");
const {
  REQUIRED_AGENT_FILES,
  validateRolePackage
} = require(projectPath("src/core/roles/validator.js"));
const {
  findRolePackage,
  listRoles,
  scanRoleRegistry
} = require(projectPath("src/core/roles/registry.js"));

function createTempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-roles-test-"));
}

function writeAgentFiles(agentDirectory) {
  fs.mkdirSync(agentDirectory, { recursive: true });
  for (const fileName of REQUIRED_AGENT_FILES) {
    fs.writeFileSync(path.join(agentDirectory, fileName), `# ${fileName}\n`, "utf8");
  }
}

function createRole(rolesDirectory, id, overrides = {}, options = {}) {
  const manifest = {
    schemaVersion: 1,
    id,
    name: "测试角色",
    version: "1.0.0",
    description: "测试角色包",
    agents: [{ id: "agent-one", name: "测试 Agent" }],
    ...overrides
  };
  const roleDirectory = path.join(rolesDirectory, id);
  fs.mkdirSync(roleDirectory, { recursive: true });
  for (const agent of manifest.agents || []) {
    if (!(options.skipAgentIds || []).includes(agent.id)) {
      writeAgentFiles(path.join(roleDirectory, "agents", agent.id));
    }
  }
  fs.writeFileSync(path.join(roleDirectory, "manifest.json"), JSON.stringify(manifest), "utf8");
  return roleDirectory;
}

test("内置跨境角色包通过校验并包含三个 Agent", async () => {
  const role = await validateRolePackage(projectPath("roles/cross-border-team"));

  assert.equal(role.id, "cross-border-team");
  assert.equal(role.name, "跨境电商运营团队");
  assert.equal(role.version, "1.0.0");
  assert.equal(role.agentCount, 3);
  assert.deepEqual(role.agents.map((agent) => agent.id), ["manager", "researcher", "creator"]);
});

test("validator 拒绝缺少 manifest.json 的角色包", async () => {
  const roleDirectory = path.join(createTempDirectory(), "missing-manifest");
  fs.mkdirSync(roleDirectory);

  await assert.rejects(() => validateRolePackage(roleDirectory), /缺少 manifest\.json/);
});

test("validator 拒绝无效 JSON、role id 和 agents 列表", async () => {
  const rolesDirectory = createTempDirectory();
  const invalidJson = path.join(rolesDirectory, "invalid-json");
  fs.mkdirSync(invalidJson);
  fs.writeFileSync(path.join(invalidJson, "manifest.json"), "{", "utf8");
  await assert.rejects(() => validateRolePackage(invalidJson), /不是有效 JSON/);

  const invalidId = createRole(rolesDirectory, "invalid-id", { id: "../escape" });
  await assert.rejects(() => validateRolePackage(invalidId), /role id 无效/);

  const missingAgents = createRole(rolesDirectory, "missing-agents", { agents: [] });
  await assert.rejects(() => validateRolePackage(missingAgents), /agents 必须是非空数组/);
});

test("validator 校验 schemaVersion 和 manifest 必填字段类型", async () => {
  const rolesDirectory = createTempDirectory();
  const wrongSchema = createRole(rolesDirectory, "wrong-schema", { schemaVersion: 2 });
  await assert.rejects(() => validateRolePackage(wrongSchema), /schemaVersion 必须为 1/);

  const missingName = createRole(rolesDirectory, "missing-name", { name: "" });
  await assert.rejects(() => validateRolePackage(missingName), /name 必须是非空字符串/);

  const wrongDescription = createRole(rolesDirectory, "wrong-description", { description: 42 });
  await assert.rejects(() => validateRolePackage(wrongDescription), /description 必须是字符串/);
});

test("validator 拒绝缺少 Agent 目录或标准文件的角色包", async () => {
  const rolesDirectory = createTempDirectory();
  const missingDirectory = createRole(
    rolesDirectory,
    "missing-agent-dir",
    { agents: [{ id: "not-created", name: "缺失 Agent" }] },
    { skipAgentIds: ["not-created"] }
  );
  fs.mkdirSync(path.join(missingDirectory, "agents"), { recursive: true });
  await assert.rejects(() => validateRolePackage(missingDirectory), /缺少 agent 目录/);

  const missingFile = createRole(rolesDirectory, "missing-agent-file");
  fs.unlinkSync(path.join(missingFile, "agents", "agent-one", "TOOLS.md"));
  await assert.rejects(() => validateRolePackage(missingFile), /缺少标准文件 TOOLS\.md/);
});

test("validator 拒绝 main role、main Agent 和重复 Agent", async () => {
  const rolesDirectory = createTempDirectory();
  const mainRole = createRole(rolesDirectory, "main");
  await assert.rejects(() => validateRolePackage(mainRole), /role id 不能使用受保护名称 main/);

  const mainAgent = createRole(rolesDirectory, "main-agent-role", {
    agents: [{ id: "main", name: "主 Agent" }]
  });
  await assert.rejects(() => validateRolePackage(mainAgent), /agent id 不能使用受保护名称 main/);

  const duplicateAgent = createRole(rolesDirectory, "duplicate-agent", {
    agents: [
      { id: "worker", name: "Worker A" },
      { id: "worker", name: "Worker B" }
    ]
  });
  await assert.rejects(() => validateRolePackage(duplicateAgent), /重复 agent id/);
});

test("validator 拒绝角色包内指向外部的符号链接", async () => {
  const rolesDirectory = createTempDirectory();
  const roleDirectory = createRole(rolesDirectory, "symlink-role");
  const outsideFile = path.join(createTempDirectory(), "outside.md");
  fs.writeFileSync(outsideFile, "outside", "utf8");
  const toolsPath = path.join(roleDirectory, "agents", "agent-one", "TOOLS.md");
  fs.unlinkSync(toolsPath);
  fs.symlinkSync(outsideFile, toolsPath);

  await assert.rejects(() => validateRolePackage(roleDirectory), /不允许包含符号链接/);
});

test("registry 扫描角色目录、过滤非法角色并稳定排序", async () => {
  const rolesDirectory = createTempDirectory();
  createRole(rolesDirectory, "z-role");
  createRole(rolesDirectory, "a-role");
  const invalidRole = path.join(rolesDirectory, "invalid-role");
  fs.mkdirSync(invalidRole);

  const scan = await scanRoleRegistry({ rolesDirectory });
  const roles = await listRoles({ rolesDirectory });

  assert.deepEqual(scan.roles.map((role) => role.id), ["a-role", "z-role"]);
  assert.equal(scan.invalidRoles.length, 1);
  assert.deepEqual(roles.map((role) => role.id), ["a-role", "z-role"]);
});

test("registry 可查找有效角色并拒绝未知或非法角色", async () => {
  const rolesDirectory = createTempDirectory();
  createRole(rolesDirectory, "valid-role");
  createRole(rolesDirectory, "invalid-role", { schemaVersion: 99 });

  assert.equal((await findRolePackage("valid-role", { rolesDirectory })).id, "valid-role");
  await assert.rejects(() => findRolePackage("unknown-role", { rolesDirectory }), /未找到角色/);
  await assert.rejects(() => findRolePackage("invalid-role", { rolesDirectory }), /角色包 invalid-role 无效/);
  await assert.rejects(() => findRolePackage("../escape", { rolesDirectory }), /role id 无效/);
});

test("registry 在角色目录不存在时返回空列表", async () => {
  const rolesDirectory = path.join(createTempDirectory(), "not-created");
  assert.deepEqual(await listRoles({ rolesDirectory }), []);
});
