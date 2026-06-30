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

function makeTempLogDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-installer-test-logs-"));
}

function listLogFiles(logDir) {
  if (!fs.existsSync(logDir)) {
    return [];
  }

  return fs.readdirSync(logDir).filter((name) => name.endsWith(".log"));
}

function readOnlyLogFile(logDir) {
  const files = listLogFiles(logDir);
  assert.equal(files.length, 1);
  return fs.readFileSync(path.join(logDir, files[0]), "utf8");
}

function loadInstallerWithMocks({ doctorOk = true, openclawInstalled = false } = {}) {
  clearProjectModules();

  const calls = {
    createTargetDirectory: 0,
    runCommand: []
  };

  mockModule("src/core/doctor/index.js", {
    runDoctor: async () => ({
      ok: doctorOk,
      checks: []
    })
  });
  mockModule("src/core/installer/steps/createTargetDirectory.js", {
    createTargetDirectory: async (config) => {
      calls.createTargetDirectory += 1;
      return {
        name: "创建安装目录",
        skipped: false,
        detail: config.targetDir
      };
    }
  });
  mockModule("src/utils/shell/index.js", {
    commandExists: async (command) => command === "openclaw" && openclawInstalled,
    runCommand: async (command, args = []) => {
      calls.runCommand.push({ command, args });

      if (command === "openclaw") {
        return {
          code: 0,
          stdout: "OpenClaw 1.0.0\n",
          stderr: "",
          timedOut: false
        };
      }

      if (command === "bash") {
        throw new Error("测试不应该执行 bash 安装脚本");
      }

      return {
        code: 0,
        stdout: "",
        stderr: "",
        timedOut: false
      };
    }
  });

  const installer = require(projectPath("src/core/installer/index.js"));

  return {
    ...installer,
    calls
  };
}

test("buildInstallPlan 返回 6 个核心步骤和必要字段", () => {
  clearProjectModules();
  const { buildInstallPlan } = require(projectPath("src/core/installer/index.js"));
  const plan = buildInstallPlan({
    targetDir: "/tmp/openclaw"
  });

  assert.equal(plan.steps.length, 6);

  for (const step of plan.steps) {
    assert.equal(typeof step.name, "string");
    assert.equal(typeof step.description, "string");
    assert.equal(typeof step.action, "string");
    assert.equal(typeof step.status, "string");
  }
});

test("安装计划包含官方安装脚本地址", () => {
  clearProjectModules();
  const { buildInstallPlan } = require(projectPath("src/core/installer/index.js"));
  const plan = buildInstallPlan({
    targetDir: "/tmp/openclaw"
  });

  const downloadStep = plan.steps.find((step) => step.action === "download_install_script");

  assert.ok(downloadStep);
  assert.match(downloadStep.description, /https:\/\/openclaw\.ai\/install\.sh/);
  assert.equal(plan.installScriptUrl, "https://openclaw.ai/install.sh");
});

test("安装计划包含预期步骤名称", () => {
  clearProjectModules();
  const { buildInstallPlan } = require(projectPath("src/core/installer/index.js"));
  const plan = buildInstallPlan({
    targetDir: "/tmp/openclaw"
  });
  const names = plan.steps.map((step) => step.name);

  assert.deepEqual(names, [
    "环境检测",
    "检查 OpenClaw 是否已安装",
    "准备目标安装目录",
    "获取 OpenClaw 安装资源",
    "执行官方安装脚本",
    "验证 openclaw 命令"
  ]);
});

test("install --dry-run 返回模拟安装报告", async () => {
  const { installOpenClaw } = loadInstallerWithMocks({
    doctorOk: true,
    openclawInstalled: false
  });

  const result = await installOpenClaw({
    dryRun: true,
    targetDir: "/tmp/openclaw"
  });

  assert.equal(result.ok, true);
  assert.match(result.message, /OpenClaw 模拟安装报告/);
  assert.match(result.message, /dry-run 已完成，没有修改任何文件/);
});

test("dry-run 会运行只读检查，但不会创建目录或执行 bash", async () => {
  const { installOpenClaw, calls } = loadInstallerWithMocks({
    doctorOk: true,
    openclawInstalled: true
  });

  const result = await installOpenClaw({
    dryRun: true,
    targetDir: "/tmp/openclaw"
  });

  assert.equal(result.ok, true);
  assert.equal(calls.createTargetDirectory, 0);
  assert.equal(calls.runCommand.some((call) => call.command === "bash"), false);
  assert.equal(calls.runCommand.some((call) => call.command === "openclaw"), true);
  assert.equal(result.steps.find((step) => step.action === "download_install_script").status, "skipped");
  assert.equal(result.steps.find((step) => step.action === "run_install_script").status, "skipped");
});

test("dry-run 不创建日志文件", async () => {
  const logDir = makeTempLogDir();
  const { installOpenClaw } = loadInstallerWithMocks({
    doctorOk: true,
    openclawInstalled: true
  });

  const result = await installOpenClaw({
    dryRun: true,
    targetDir: "/tmp/openclaw",
    logDir
  });

  assert.equal(result.ok, true);
  assert.deepEqual(listLogFiles(logDir), []);
});

test("已安装 OpenClaw 时正式 install 不重复安装", async () => {
  const logDir = makeTempLogDir();
  const { installOpenClaw, calls } = loadInstallerWithMocks({
    doctorOk: true,
    openclawInstalled: true
  });

  const result = await installOpenClaw({
    dryRun: false,
    targetDir: "/tmp/openclaw",
    logDir
  });

  assert.equal(result.ok, true);
  assert.match(result.message, /已经安装/);
  assert.equal(calls.createTargetDirectory, 0);
  assert.equal(calls.runCommand.some((call) => call.command === "bash"), false);
});

function createSuccessfulHttpsGetMock(script = "#!/bin/sh\necho ok\n") {
  return (url, options, callback) => {
    const { Readable } = require("node:stream");
    const response = Readable.from([script]);
    response.statusCode = 200;
    response.headers = {};

    process.nextTick(() => {
      callback(response);
    });

    return {
      on() {},
      destroy() {}
    };
  };
}

function createFailingHttpsGetMock(error = new Error("network failed")) {
  return () => {
    return {
      on(event, handler) {
        if (event === "error") {
          process.nextTick(() => handler(error));
        }
      },
      destroy() {}
    };
  };
}

async function withHttpsGetMock(mockGet, fn) {
  const https = require("node:https");
  const originalGet = https.get;

  https.get = mockGet;

  try {
    return await fn();
  } finally {
    https.get = originalGet;
  }
}

function loadInstallerForFullInstall({ runCommand }) {
  clearProjectModules();

  const calls = {
    createTargetDirectory: 0,
    runCommand: []
  };

  mockModule("src/core/doctor/index.js", {
    runDoctor: async () => ({
      ok: true,
      checks: [
        {
          name: "测试检查",
          level: "pass",
          message: "通过"
        }
      ]
    })
  });
  mockModule("src/core/installer/steps/createTargetDirectory.js", {
    createTargetDirectory: async (config) => {
      calls.createTargetDirectory += 1;
      return {
        name: "创建安装目录",
        skipped: false,
        detail: config.targetDir
      };
    }
  });
  mockModule("src/utils/shell/index.js", {
    commandExists: async () => false,
    runCommand: async (command, args = []) => {
      calls.runCommand.push({ command, args });
      return runCommand(command, args);
    }
  });

  const installer = require(projectPath("src/core/installer/index.js"));

  return {
    ...installer,
    calls
  };
}

test("官方安装脚本下载失败时返回中文错误且不执行后续步骤", async () => {
  await withHttpsGetMock(createFailingHttpsGetMock(), async () => {
    const logDir = makeTempLogDir();
    const { installOpenClaw, calls } = loadInstallerForFullInstall({
      runCommand: async (command) => {
        throw new Error("不应该执行命令：" + command);
      }
    });

    const result = await installOpenClaw({
      dryRun: false,
      targetDir: "/tmp/openclaw",
      logDir
    });

    assert.equal(result.ok, false);
    assert.match(result.message, /无法下载官方安装脚本|无法下载 OpenClaw 官方安装脚本/);
    assert.match(result.message, /详细日志：/);
    assert.equal(calls.createTargetDirectory, 1);
    assert.equal(calls.runCommand.some((call) => call.command === "bash"), false);
    assert.equal(calls.runCommand.some((call) => call.command === "openclaw"), false);
  });
});

test("bash 安装脚本执行失败时返回中文错误摘要且不验证 openclaw", async () => {
  await withHttpsGetMock(createSuccessfulHttpsGetMock(), async () => {
    const logDir = makeTempLogDir();
    const { installOpenClaw, calls } = loadInstallerForFullInstall({
      runCommand: async (command) => {
        if (command === "bash") {
          return {
            code: 2,
            stdout: "",
            stderr: "line 1: install failed\nstack detail should not appear",
            timedOut: false
          };
        }

        throw new Error("不应该执行命令：" + command);
      }
    });

    const result = await installOpenClaw({
      dryRun: false,
      targetDir: "/tmp/openclaw",
      logDir
    });

    assert.equal(result.ok, false);
    assert.match(result.message, /官方安装脚本执行失败/);
    assert.match(result.message, /错误摘要：line 1: install failed/);
    assert.equal(calls.runCommand.some((call) => call.command === "bash"), true);
    assert.equal(calls.runCommand.some((call) => call.command === "openclaw"), false);
  });
});

test("bash 失败时日志里包含 stderr 摘要", async () => {
  await withHttpsGetMock(createSuccessfulHttpsGetMock(), async () => {
    const logDir = makeTempLogDir();
    const { installOpenClaw } = loadInstallerForFullInstall({
      runCommand: async (command) => {
        if (command === "bash") {
          return {
            code: 2,
            stdout: "",
            stderr: "line 1: install failed",
            timedOut: false
          };
        }

        throw new Error("不应该执行命令：" + command);
      }
    });

    const result = await installOpenClaw({
      dryRun: false,
      targetDir: "/tmp/openclaw",
      logDir
    });
    const log = readOnlyLogFile(logDir);

    assert.equal(result.ok, false);
    assert.match(log, /官方安装脚本 stderr/);
    assert.match(log, /line 1: install failed/);
  });
});

test("安装后 openclaw --version 验证失败时返回 PATH 提示", async () => {
  await withHttpsGetMock(createSuccessfulHttpsGetMock(), async () => {
    const logDir = makeTempLogDir();
    const { installOpenClaw, calls } = loadInstallerForFullInstall({
      runCommand: async (command) => {
        if (command === "bash") {
          return {
            code: 0,
            stdout: "installed",
            stderr: "",
            timedOut: false
          };
        }

        if (command === "openclaw") {
          return {
            code: 1,
            stdout: "",
            stderr: "command not found",
            timedOut: false
          };
        }

        throw new Error("不应该执行命令：" + command);
      }
    });

    const result = await installOpenClaw({
      dryRun: false,
      targetDir: "/tmp/openclaw",
      logDir
    });

    assert.equal(result.ok, false);
    assert.match(result.message, /未能验证 openclaw 命令/);
    assert.match(result.message, /请重新打开终端，或检查 PATH/);
    assert.doesNotMatch(result.message, /Error:|at .*\(/);
    assert.equal(calls.runCommand.some((call) => call.command === "bash"), true);
    assert.equal(calls.runCommand.some((call) => call.command === "openclaw"), true);
  });
});

test("未安装场景下完整 install mock 成功后返回版本号并写日志", async () => {
  await withHttpsGetMock(createSuccessfulHttpsGetMock(), async () => {
    const logDir = makeTempLogDir();
    const { installOpenClaw, calls } = loadInstallerForFullInstall({
      runCommand: async (command) => {
        if (command === "bash") {
          return {
            code: 0,
            stdout: "installed stdout",
            stderr: "installed stderr",
            timedOut: false
          };
        }

        if (command === "openclaw") {
          return {
            code: 0,
            stdout: "OpenClaw 9.9.9\n",
            stderr: "",
            timedOut: false
          };
        }

        throw new Error("不应该执行命令：" + command);
      }
    });

    const result = await installOpenClaw({
      dryRun: false,
      targetDir: "/tmp/openclaw",
      logDir
    });
    const log = readOnlyLogFile(logDir);

    assert.equal(result.ok, true);
    assert.match(result.message, /OpenClaw 安装完成/);
    assert.match(result.message, /OpenClaw 9\.9\.9/);
    assert.match(result.message, /详细日志：/);
    assert.match(log, /安装开始时间/);
    assert.match(log, /platform=/);
    assert.match(log, /targetDir：\/tmp\/openclaw/);
    assert.match(log, /doctor 检测结果摘要/);
    assert.match(log, /下载官方安装脚本成功/);
    assert.match(log, /installed stdout/);
    assert.match(log, /installed stderr/);
    assert.match(log, /OpenClaw 9\.9\.9/);
    assert.equal(calls.createTargetDirectory, 1);
    assert.equal(calls.runCommand.some((call) => call.command === "bash"), true);
    assert.equal(calls.runCommand.some((call) => call.command === "openclaw"), true);
    assert.equal(result.steps.find((step) => step.action === "download_install_script").status, "completed");
    assert.equal(result.steps.find((step) => step.action === "run_install_script").status, "completed");
    assert.equal(result.steps.find((step) => step.action === "verify_openclaw_command").status, "completed");
  });
});

test("日志写入失败时不影响主安装流程", async () => {
  await withHttpsGetMock(createSuccessfulHttpsGetMock(), async () => {
    const badLogDir = path.join(os.tmpdir(), "openclaw-installer-log-file-" + Date.now());
    fs.writeFileSync(badLogDir, "not a directory");
    const { installOpenClaw } = loadInstallerForFullInstall({
      runCommand: async (command) => {
        if (command === "bash") {
          return {
            code: 0,
            stdout: "installed",
            stderr: "",
            timedOut: false
          };
        }

        if (command === "openclaw") {
          return {
            code: 0,
            stdout: "OpenClaw 9.9.9\n",
            stderr: "",
            timedOut: false
          };
        }

        throw new Error("不应该执行命令：" + command);
      }
    });

    const result = await installOpenClaw({
      dryRun: false,
      targetDir: "/tmp/openclaw",
      logDir: badLogDir
    });

    assert.equal(result.ok, true);
    assert.match(result.message, /安装日志写入失败，但不影响主安装流程/);
  });
});
