const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  clearProjectModules,
  mockModule,
  projectPath
} = require("./helpers");

function check(name, level, category = "runtime") {
  return {
    name,
    ok: level !== "fail",
    level,
    category,
    code: name.toUpperCase(),
    message: name,
    suggestion: "",
    repairable: false,
    repairAction: null
  };
}

function loadDoctorWithChecks({ nodeLevel = "pass", commandLevels = [], extraLevels = [] } = {}) {
  clearProjectModules();

  mockModule("src/core/doctor/checks/nodeVersionCheck.js", {
    checkNodeVersion: () => check("Node.js 版本", nodeLevel)
  });
  mockModule("src/core/doctor/checks/commandCheck.js", {
    checkCommand: async (command) => {
      const level = commandLevels.shift() || "pass";
      return check("系统命令：" + command, level, command === "node" ? "runtime" : "dependency");
    }
  });
  mockModule("src/core/doctor/checks/platformCheck.js", {
    checkPlatform: () => check("操作系统", extraLevels.shift() || "pass", "system")
  });
  mockModule("src/core/doctor/checks/archCheck.js", {
    checkArchitecture: () => check("CPU 架构", extraLevels.shift() || "pass", "system")
  });
  mockModule("src/core/doctor/checks/openClawStatusCheck.js", {
    checkOpenClawStatus: async () => check("OpenClaw", extraLevels.shift() || "info", "openclaw")
  });
  mockModule("src/core/doctor/checks/npmRegistryCheck.js", {
    checkNpmRegistry: async () => check("npm 网络访问", extraLevels.shift() || "warning", "network")
  });
  mockModule("src/core/doctor/checks/targetDirectoryCheck.js", {
    checkTargetDirectory: async () => check("目标目录", extraLevels.shift() || "info", "directory")
  });

  return require(projectPath("src/core/doctor/index.js"));
}

test("report.ok 只受 level=fail 的检测项影响", async () => {
  const { runDoctor } = loadDoctorWithChecks({
    commandLevels: ["pass", "fail", "pass"]
  });

  const report = await runDoctor({
    minNodeVersion: "18.17.0",
    requiredCommands: ["node", "npm", "git"],
    targetDir: "/tmp/openclaw"
  });

  assert.equal(report.ok, false);
});

test("warning 和 info 不会让 report.ok = false", async () => {
  const { runDoctor } = loadDoctorWithChecks({
    extraLevels: ["warning", "warning", "info", "warning", "info"]
  });

  const report = await runDoctor({
    minNodeVersion: "18.17.0",
    requiredCommands: ["node", "npm", "git"],
    targetDir: "/tmp/openclaw"
  });

  assert.equal(report.ok, true);
});

test("doctor 报告中不显示 AI 服务配置分类", () => {
  clearProjectModules();
  const { formatDoctorReport } = require(projectPath("src/cli/presenters/doctorPresenter.js"));

  const output = formatDoctorReport({
    ok: true,
    checks: [
      check("AI 服务配置", "info", "ai_config")
    ]
  });

  assert.doesNotMatch(output, /AI 服务配置：/);
});

test("doctor 只做检测，不创建目标目录", async () => {
  const targetDir = path.join(os.tmpdir(), "openclaw-doctor-test-" + Date.now());
  const { runDoctor } = loadDoctorWithChecks();

  assert.equal(fs.existsSync(targetDir), false);

  await runDoctor({
    minNodeVersion: "18.17.0",
    requiredCommands: ["node", "npm", "git"],
    targetDir
  });

  assert.equal(fs.existsSync(targetDir), false);
});
