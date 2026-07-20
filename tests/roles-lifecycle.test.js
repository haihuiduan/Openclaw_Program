const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { projectPath } = require("./helpers");
const {
  inspectRole,
  installRole,
  listInstalledRoles,
  removeRole
} = require(projectPath("src/core/roles/installer.js"));
const {
  createEmptyRoleState,
  getRoleState,
  readRoleState,
  updateRoleState,
  writeRoleState
} = require(projectPath("src/core/roles/state.js"));
const { REQUIRED_AGENT_FILES } = require(projectPath("src/core/roles/validator.js"));

function createTempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-role-lifecycle-"));
}

function createRoleFixture(root, id = "test-role", options = {}) {
  const agents = options.agents || [
    { id: "manager", name: "管理者", description: "协调任务" },
    { id: "worker", name: "执行者", description: "执行任务" }
  ];
  const roleDirectory = path.join(root, "roles", id);
  for (const agent of agents) {
    const agentDirectory = path.join(roleDirectory, "agents", agent.id);
    fs.mkdirSync(agentDirectory, { recursive: true });
    for (const fileName of REQUIRED_AGENT_FILES) {
      fs.writeFileSync(path.join(agentDirectory, fileName), `# ${agent.id} ${fileName}\n`, "utf8");
    }
    if (options.includeApiKeyFile) {
      fs.writeFileSync(path.join(agentDirectory, "api-key.txt"), "sk-must-not-copy", "utf8");
    }
  }
  fs.writeFileSync(path.join(roleDirectory, "manifest.json"), JSON.stringify({
    schemaVersion: options.schemaVersion === undefined ? 1 : options.schemaVersion,
    id,
    name: options.name || "测试团队",
    version: options.version || "2.0.0",
    description: "测试角色生命周期",
    agents
  }), "utf8");
  return path.join(root, "roles");
}

function createOptions(root, rolesDirectory) {
  return {
    rolesDirectory,
    installRoot: path.join(root, "role-data", "installed"),
    statePath: path.join(root, "role-data", "state.json"),
    mainWorkspace: path.join(root, "main-workspace")
  };
}

function createRecord(root, roleId, overrides = {}) {
  const now = "2026-07-20T00:00:00.000Z";
  return {
    roleId,
    roleName: roleId + " name",
    roleVersion: "1.0.0",
    status: "installed",
    installedAt: now,
    updatedAt: now,
    enabled: false,
    workspacePath: path.join(root, "installed", roleId),
    sourceRolePath: path.join(root, "roles", roleId),
    agents: [{
      agentId: "worker",
      workspacePath: path.join(root, "installed", roleId, "workspaces", "worker"),
      contentDigest: "a".repeat(64)
    }],
    ...overrides
  };
}

function withFileSystemOverrides(overrides) {
  return new Proxy(fsPromises, {
    get(target, property) {
      if (Object.prototype.hasOwnProperty.call(overrides, property)) {
        return overrides[property];
      }
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}

test("state 在文件不存在时返回空状态并可原子写回", async () => {
  const root = createTempDirectory();
  const statePath = path.join(root, "state", "roles.json");
  const empty = await readRoleState(statePath);
  assert.deepEqual(empty, createEmptyRoleState());

  empty.roles.example = createRecord(root, "example");
  await writeRoleState(statePath, empty);
  assert.deepEqual(await readRoleState(statePath), empty);
  assert.deepEqual(fs.readdirSync(path.dirname(statePath)), ["roles.json"]);
});

test("state 拒绝无效 JSON、无效 schema 和无效结构", async () => {
  const root = createTempDirectory();
  const statePath = path.join(root, "state.json");
  fs.writeFileSync(statePath, "{", "utf8");
  await assert.rejects(() => readRoleState(statePath), /不是有效 JSON/);

  fs.writeFileSync(statePath, JSON.stringify({ schemaVersion: 2, roles: {} }), "utf8");
  await assert.rejects(() => readRoleState(statePath), /schemaVersion 必须为 1/);

  fs.writeFileSync(statePath, JSON.stringify({ schemaVersion: 1, roles: [] }), "utf8");
  await assert.rejects(() => readRoleState(statePath), /结构无效/);
});

test("state 只持久化白名单字段且读取结果不共享可变引用", async () => {
  const root = createTempDirectory();
  const statePath = path.join(root, "state.json");
  const record = createRecord(root, "safe-role", { apiKey: "sk-secret" });
  record.agents[0].apiKey = "agent-secret";
  await writeRoleState(statePath, {
    schemaVersion: 1,
    roles: { "safe-role": record },
    apiKey: "top-secret"
  });

  const raw = fs.readFileSync(statePath, "utf8");
  assert.doesNotMatch(raw, /secret|apiKey/);
  const first = await readRoleState(statePath);
  first.roles["safe-role"].roleName = "已修改";
  const second = await readRoleState(statePath);
  assert.equal(second.roles["safe-role"].roleName, "safe-role name");
  const extracted = getRoleState(second, "safe-role");
  extracted.roleName = "再次修改";
  assert.equal(getRoleState(second, "safe-role").roleName, "safe-role name");
});

test("state 并发更新采用串行读改写且不会覆盖不同角色", async () => {
  const root = createTempDirectory();
  const statePath = path.join(root, "state.json");

  await Promise.all(["alpha-role", "beta-role"].map((roleId) =>
    updateRoleState(statePath, async (state) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      state.roles[roleId] = createRecord(root, roleId);
      return state;
    })
  ));

  assert.deepEqual(Object.keys((await readRoleState(statePath)).roles).sort(), ["alpha-role", "beta-role"]);
});

test("inspect 返回角色详情和未安装状态且不创建状态文件", async () => {
  const root = createTempDirectory();
  const rolesDirectory = createRoleFixture(root);
  const options = createOptions(root, rolesDirectory);
  const role = await inspectRole("test-role", options);

  assert.equal(role.id, "test-role");
  assert.equal(role.name, "测试团队");
  assert.equal(role.agentCount, 2);
  assert.equal(role.installed, false);
  assert.equal(role.installedVersion, null);
  assert.equal(role.installedAt, null);
  assert.equal(fs.existsSync(options.statePath), false);
});

test("inspect 拒绝不存在及非法角色包", async () => {
  const root = createTempDirectory();
  const rolesDirectory = createRoleFixture(root);
  createRoleFixture(root, "invalid-role", { schemaVersion: 9 });

  await assert.rejects(() => inspectRole("unknown-role", { rolesDirectory }), /未找到角色/);
  await assert.rejects(() => inspectRole("invalid-role", { rolesDirectory }), /角色包 invalid-role 无效/);
});

test("inspect 正确展示已安装版本、时间和状态", async () => {
  const root = createTempDirectory();
  const rolesDirectory = createRoleFixture(root);
  const options = createOptions(root, rolesDirectory);
  await installRole("test-role", options);

  const role = await inspectRole("test-role", options);
  assert.equal(role.installed, true);
  assert.equal(role.installedVersion, "2.0.0");
  assert.match(role.installedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(role.status, "installed");
});

test("install 将标准 Agent 文件安装到独立 workspace 并记录完整状态", async () => {
  const root = createTempDirectory();
  const rolesDirectory = createRoleFixture(root, "test-role", { includeApiKeyFile: true });
  const options = createOptions(root, rolesDirectory);
  const result = await installRole("test-role", options);
  const state = await readRoleState(options.statePath);
  const record = state.roles["test-role"];

  assert.equal(result.installed, true);
  assert.equal(result.alreadyInstalled, false);
  assert.equal(record.roleId, "test-role");
  assert.equal(record.roleName, "测试团队");
  assert.equal(record.roleVersion, "2.0.0");
  assert.equal(record.status, "installed");
  assert.equal(record.agents.length, 2);
  assert.equal(path.isAbsolute(record.workspacePath), true);
  assert.equal(path.isAbsolute(record.sourceRolePath), true);
  assert.match(record.agents[0].contentDigest, /^[a-f0-9]{64}$/);

  const managerWorkspace = path.join(options.installRoot, "test-role", "workspaces", "manager");
  for (const fileName of REQUIRED_AGENT_FILES) {
    assert.equal(fs.existsSync(path.join(managerWorkspace, fileName)), true);
  }
  assert.equal(fs.existsSync(path.join(managerWorkspace, "api-key.txt")), false);
  assert.doesNotMatch(fs.readFileSync(options.statePath, "utf8"), /sk-must-not-copy|api-key/);
});

test("install 对同版本重复安装保持幂等且不改变安装时间", async () => {
  const root = createTempDirectory();
  const rolesDirectory = createRoleFixture(root);
  const options = createOptions(root, rolesDirectory);
  const first = await installRole("test-role", options);
  const before = await readRoleState(options.statePath);
  const second = await installRole("test-role", options);
  const after = await readRoleState(options.statePath);

  assert.equal(first.alreadyInstalled, false);
  assert.equal(second.alreadyInstalled, true);
  assert.equal(after.roles["test-role"].installedAt, before.roles["test-role"].installedAt);
  assert.equal(fs.readdirSync(options.installRoot).filter((name) => name === "test-role").length, 1);
});

test("install 拒绝覆盖不同版本并说明当前版本和角色包版本", async () => {
  const root = createTempDirectory();
  const rolesDirectory = createRoleFixture(root);
  const options = createOptions(root, rolesDirectory);
  await installRole("test-role", options);

  const manifestPath = path.join(rolesDirectory, "test-role", "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.version = "3.0.0";
  fs.writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

  await assert.rejects(
    () => installRole("test-role", options),
    /已安装版本 2\.0\.0.*当前角色包版本为 3\.0\.0.*不支持直接升级/
  );
  assert.equal((await readRoleState(options.statePath)).roles["test-role"].roleVersion, "2.0.0");
});

test("install 拒绝未知、非法、main 角色和 main Agent", async () => {
  const root = createTempDirectory();
  const rolesDirectory = createRoleFixture(root);
  createRoleFixture(root, "invalid-role", { schemaVersion: 5 });
  createRoleFixture(root, "main-agent-role", {
    agents: [{ id: "main", name: "主 Agent" }]
  });
  const options = createOptions(root, rolesDirectory);

  await assert.rejects(() => installRole("unknown-role", options), /未找到角色/);
  await assert.rejects(() => installRole("invalid-role", options), /角色包 invalid-role 无效/);
  await assert.rejects(() => installRole("main", options), /受保护名称 main/);
  await assert.rejects(() => installRole("main-agent-role", options), /agent id 不能使用受保护名称 main/);
});

test("install 不覆盖已有 workspace 且拒绝 main workspace 或项目目录", async () => {
  const root = createTempDirectory();
  const rolesDirectory = createRoleFixture(root);
  const options = createOptions(root, rolesDirectory);
  const existingTarget = path.join(options.installRoot, "test-role");
  fs.mkdirSync(existingTarget, { recursive: true });
  fs.writeFileSync(path.join(existingTarget, "user-file.txt"), "keep", "utf8");

  await assert.rejects(() => installRole("test-role", options), /拒绝覆盖用户已有 workspace/);
  assert.equal(fs.readFileSync(path.join(existingTarget, "user-file.txt"), "utf8"), "keep");

  const overlapRoot = createTempDirectory();
  const overlapRoles = createRoleFixture(overlapRoot);
  await assert.rejects(() => installRole("test-role", {
    rolesDirectory: overlapRoles,
    installRoot: path.join(overlapRoot, "main-workspace", "roles"),
    statePath: path.join(overlapRoot, "state.json"),
    mainWorkspace: path.join(overlapRoot, "main-workspace")
  }), /不能与 main workspace 重叠/);

  await assert.rejects(() => installRole("test-role", {
    rolesDirectory,
    installRoot: projectPath("role-install-danger"),
    statePath: path.join(root, "other-state.json"),
    mainWorkspace: path.join(root, "other-main")
  }), /不能与项目目录重叠/);
});

test("install staging 复制失败后自动清理且不写状态", async () => {
  const root = createTempDirectory();
  const rolesDirectory = createRoleFixture(root);
  const options = createOptions(root, rolesDirectory);
  options.fileSystem = withFileSystemOverrides({
    copyFile: async (source, destination) => {
      if (source.endsWith("IDENTITY.md")) {
        throw new Error("simulated copy failure");
      }
      return fsPromises.copyFile(source, destination);
    }
  });

  await assert.rejects(() => installRole("test-role", options), /simulated copy failure/);
  assert.equal(fs.existsSync(path.join(options.installRoot, "test-role")), false);
  assert.deepEqual(fs.readdirSync(options.installRoot), []);
  assert.deepEqual(await readRoleState(options.statePath), createEmptyRoleState());
});

test("install 验证 staging 与来源文件一致并清理损坏副本", async () => {
  const root = createTempDirectory();
  const rolesDirectory = createRoleFixture(root);
  const options = createOptions(root, rolesDirectory);
  options.fileSystem = withFileSystemOverrides({
    copyFile: async (source, destination) => {
      if (source.endsWith("SOUL.md")) {
        return fsPromises.writeFile(destination, "corrupted staging content", "utf8");
      }
      return fsPromises.copyFile(source, destination);
    }
  });

  await assert.rejects(() => installRole("test-role", options), /staging 文件与来源角色包不一致/);
  assert.deepEqual(fs.readdirSync(options.installRoot), []);
  assert.deepEqual(await readRoleState(options.statePath), createEmptyRoleState());
});

test("install state 写入失败后回滚已发布 workspace", async () => {
  const root = createTempDirectory();
  const rolesDirectory = createRoleFixture(root);
  const options = createOptions(root, rolesDirectory);
  options.stateStore = {
    readRoleState,
    updateRoleState: async () => {
      throw new Error("simulated state failure");
    }
  };

  await assert.rejects(() => installRole("test-role", options), /simulated state failure/);
  assert.equal(fs.existsSync(path.join(options.installRoot, "test-role")), false);
  assert.deepEqual(await readRoleState(options.statePath), createEmptyRoleState());
});

test("install 拒绝角色包中越界的符号链接", async () => {
  const root = createTempDirectory();
  const rolesDirectory = createRoleFixture(root);
  const agentFile = path.join(rolesDirectory, "test-role", "agents", "worker", "TOOLS.md");
  const outside = path.join(root, "outside.md");
  fs.writeFileSync(outside, "outside", "utf8");
  fs.unlinkSync(agentFile);
  fs.symlinkSync(outside, agentFile);

  await assert.rejects(
    () => installRole("test-role", createOptions(root, rolesDirectory)),
    /不允许包含符号链接/
  );
});

test("同进程并发安装同一角色只发布一次且第二次幂等", async () => {
  const root = createTempDirectory();
  const rolesDirectory = createRoleFixture(root);
  const options = createOptions(root, rolesDirectory);
  const results = await Promise.all([
    installRole("test-role", options),
    installRole("test-role", options)
  ]);

  assert.deepEqual(results.map((result) => result.alreadyInstalled).sort(), [false, true]);
  assert.equal(Object.keys((await readRoleState(options.statePath)).roles).length, 1);
});

test("并发安装不同角色不会互相覆盖 state 记录", async () => {
  const root = createTempDirectory();
  const rolesDirectory = createRoleFixture(root, "z-role");
  createRoleFixture(root, "a-role");
  const options = createOptions(root, rolesDirectory);
  await Promise.all([
    installRole("z-role", options),
    installRole("a-role", options)
  ]);

  assert.deepEqual(Object.keys((await readRoleState(options.statePath)).roles).sort(), ["a-role", "z-role"]);
});

test("list-installed 在状态不存在时返回空列表", async () => {
  const root = createTempDirectory();
  const options = createOptions(root, path.join(root, "roles"));
  assert.deepEqual(await listInstalledRoles(options), []);
  assert.equal(fs.existsSync(options.statePath), false);
});

test("list-installed 返回完整字段并按 roleId 稳定排序", async () => {
  const root = createTempDirectory();
  const rolesDirectory = createRoleFixture(root, "z-role", { name: "Z 角色" });
  createRoleFixture(root, "a-role", { name: "A 角色" });
  const options = createOptions(root, rolesDirectory);
  await installRole("z-role", options);
  await installRole("a-role", options);

  const installed = await listInstalledRoles(options);
  assert.deepEqual(installed.map((role) => role.id), ["a-role", "z-role"]);
  assert.equal(installed[0].name, "A 角色");
  assert.equal(installed[0].version, "2.0.0");
  assert.equal(installed[0].status, "installed");
  assert.equal(installed[0].agentCount, 2);
  assert.match(installed[0].installedAt, /^\d{4}-/);
});

test("remove 只删除本角色 workspace 并清除安装记录", async () => {
  const root = createTempDirectory();
  const rolesDirectory = createRoleFixture(root);
  const options = createOptions(root, rolesDirectory);
  await installRole("test-role", options);

  const result = await removeRole("test-role", options);
  const state = await readRoleState(options.statePath);

  assert.equal(result.removed, true);
  assert.equal(state.roles["test-role"], undefined);
  assert.equal(fs.existsSync(path.join(options.installRoot, "test-role")), false);
  assert.equal(fs.existsSync(options.mainWorkspace), false);
  assert.equal(fs.existsSync(path.join(rolesDirectory, "test-role")), true);
  assert.deepEqual(fs.readdirSync(options.installRoot), []);
});

test("remove 拒绝未安装角色和 main Agent", async () => {
  const root = createTempDirectory();
  const options = createOptions(root, createRoleFixture(root));
  await assert.rejects(() => removeRole("test-role", options), /尚未安装/);
  await assert.rejects(() => removeRole("main", options), /受保护名称 main/);
});

test("remove 不删除状态记录指向的非本角色 workspace", async () => {
  const root = createTempDirectory();
  const rolesDirectory = createRoleFixture(root);
  const options = createOptions(root, rolesDirectory);
  await installRole("test-role", options);
  const otherWorkspace = path.join(fs.realpathSync(options.installRoot), "other-role");
  fs.mkdirSync(otherWorkspace);
  fs.writeFileSync(path.join(otherWorkspace, "keep.txt"), "keep", "utf8");

  await updateRoleState(options.statePath, (state) => {
    state.roles["test-role"].workspacePath = otherWorkspace;
    return state;
  });

  await assert.rejects(() => removeRole("test-role", options), /非本角色 workspace/);
  assert.equal(fs.readFileSync(path.join(otherWorkspace, "keep.txt"), "utf8"), "keep");
  assert.equal(fs.existsSync(path.join(options.installRoot, "test-role")), true);
});

test("remove 检测用户修改后的 workspace 并拒绝静默删除", async () => {
  const root = createTempDirectory();
  const rolesDirectory = createRoleFixture(root);
  const options = createOptions(root, rolesDirectory);
  await installRole("test-role", options);
  const workspace = path.join(options.installRoot, "test-role", "workspaces", "worker");
  fs.writeFileSync(path.join(workspace, "user-note.md"), "do not delete", "utf8");

  await assert.rejects(() => removeRole("test-role", options), /workspace 已被用户修改/);
  assert.equal(fs.existsSync(path.join(workspace, "user-note.md")), true);
  assert.ok((await readRoleState(options.statePath)).roles["test-role"]);
});

test("remove 拒绝被替换为符号链接的 Agent workspace 且不触碰外部目录", async () => {
  const root = createTempDirectory();
  const rolesDirectory = createRoleFixture(root);
  const options = createOptions(root, rolesDirectory);
  await installRole("test-role", options);
  const workspace = path.join(options.installRoot, "test-role", "workspaces", "worker");
  const movedWorkspace = path.join(root, "outside-worker");
  fs.renameSync(workspace, movedWorkspace);
  fs.symlinkSync(movedWorkspace, workspace);

  await assert.rejects(() => removeRole("test-role", options), /不能是符号链接/);
  assert.equal(fs.existsSync(path.join(movedWorkspace, "AGENTS.md")), true);
  assert.ok((await readRoleState(options.statePath)).roles["test-role"]);
});

test("remove 在状态被篡改为 main Agent 时拒绝删除", async () => {
  const root = createTempDirectory();
  const rolesDirectory = createRoleFixture(root);
  const options = createOptions(root, rolesDirectory);
  await installRole("test-role", options);
  const state = JSON.parse(fs.readFileSync(options.statePath, "utf8"));
  state.roles["test-role"].agents[0].agentId = "main";
  fs.writeFileSync(options.statePath, JSON.stringify(state), "utf8");

  await assert.rejects(() => removeRole("test-role", options), /Agent 状态 id 无效：main/);
  assert.equal(fs.existsSync(path.join(options.installRoot, "test-role")), true);
});

test("remove state 更新失败时从 quarantine 恢复 workspace", async () => {
  const root = createTempDirectory();
  const rolesDirectory = createRoleFixture(root);
  const options = createOptions(root, rolesDirectory);
  await installRole("test-role", options);
  options.stateStore = {
    readRoleState,
    updateRoleState: async () => {
      throw new Error("simulated remove state failure");
    }
  };

  await assert.rejects(() => removeRole("test-role", options), /simulated remove state failure/);
  assert.equal(fs.existsSync(path.join(options.installRoot, "test-role")), true);
  assert.ok((await readRoleState(options.statePath)).roles["test-role"]);
  assert.equal(fs.readdirSync(options.installRoot).some((name) => name.includes("-remove-")), false);
});

test("remove quarantine 删除失败时恢复 state 和 workspace", async () => {
  const root = createTempDirectory();
  const rolesDirectory = createRoleFixture(root);
  const options = createOptions(root, rolesDirectory);
  await installRole("test-role", options);
  options.fileSystem = withFileSystemOverrides({
    rm: async (target, removeOptions) => {
      if (target.includes("-remove-")) {
        throw new Error("simulated quarantine delete failure");
      }
      return fsPromises.rm(target, removeOptions);
    }
  });

  await assert.rejects(() => removeRole("test-role", options), /已恢复原状态和 workspace/);
  assert.equal(fs.existsSync(path.join(options.installRoot, "test-role")), true);
  assert.ok((await readRoleState(options.statePath)).roles["test-role"]);
  assert.equal(fs.readdirSync(options.installRoot).some((name) => name.includes("-remove-")), false);
});

test("remove 拒绝仍启用的角色", async () => {
  const root = createTempDirectory();
  const rolesDirectory = createRoleFixture(root);
  const options = createOptions(root, rolesDirectory);
  await installRole("test-role", options);
  await updateRoleState(options.statePath, (state) => {
    state.roles["test-role"].enabled = true;
    return state;
  });

  await assert.rejects(() => removeRole("test-role", options), /请先停用/);
  assert.equal(fs.existsSync(path.join(options.installRoot, "test-role")), true);
});
