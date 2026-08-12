"use strict";

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

test("GUI installerService.runInstall 调用真实 GUI workflow 入口", async () => {
  clearProjectModules();
  const calls = [];
  mockModule("src/core/workflow/engine.js", {
    runWorkflow: async (workflow, context, onProgress) => {
      calls.push({ workflow, context, onProgress });
      return { success: true, ok: true, steps: [] };
    }
  });
  const service = require(projectPath("src/gui/services/installerService.js"));
  const progress = () => {};
  const config = {
    targetDir: "/tmp/openclaw",
    diagnosticLogPath: "/tmp/userData/logs/openclaw-install-debug.log"
  };

  const result = await service.runInstall(config, progress);

  assert.equal(result.success, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].workflow, "install");
  assert.equal(calls[0].context.config, config);
  assert.equal(calls[0].onProgress, progress);
});

test("GUI workflow 失败结果保留失败步骤、错误码和命令摘要", async () => {
  clearProjectModules();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-gui-workflow-"));
  const diagnosticLogPath = path.join(tempDir, "userData", "logs", "openclaw-install-debug.log");

  mockModule("src/utils/shell/index.js", {
    getCommandEnv: () => ({ PATH: "/usr/bin:/bin" }),
    resolveCommand: async (command) => ({
      command,
      found: command !== "openclaw",
      resolvedPath: command === "openclaw" ? null : "/usr/bin/" + command,
      exitCode: command === "openclaw" ? 1 : 0,
      signal: null,
      spawnError: null,
      timedOut: false
    })
  });
  const failingStep = createFailingStep();
  mockModule("src/core/workflow/steps/environment_check.js", failingStep);
  mockModule("src/core/workflow/steps/check_existing_install.js", createSuccessStep("check_existing_install"));
  mockModule("src/core/workflow/steps/prepare_directory.js", createSuccessStep("prepare_directory"));
  mockModule("src/core/workflow/steps/download_script.js", createSuccessStep("download_script"));
  mockModule("src/core/workflow/steps/execute_script.js", createSuccessStep("execute_script"));
  mockModule("src/core/workflow/steps/verify_installation.js", createSuccessStep("verify_installation"));

  const { runWorkflow } = require(projectPath("src/core/workflow/engine.js"));
  const result = await runWorkflow("install", {
    config: {
      targetDir: path.join(tempDir, ".openclaw"),
      runtimeStatePath: path.join(tempDir, "workflow-state.json"),
      diagnosticLogPath,
      logDir: path.join(tempDir, "legacy-logs")
    }
  });

  assert.equal(result.success, false);
  assert.equal(result.failedStepId, "environment_check");
  assert.equal(result.failedStepName, "环境检查");
  assert.equal(result.errorCode, "OPENCLAW_INSTALL_COMMAND_NOT_FOUND");
  assert.equal(result.userMessage, "缺少测试命令");
  assert.equal(result.commandResult.exitCode, -2);
  assert.equal(result.commandResult.spawnError.code, "ENOENT");
  assert.equal(result.diagnosticLogPath, diagnosticLogPath);
  assert.ok(fs.existsSync(diagnosticLogPath));

  failingStep.run = async () => ({
    success: false,
    message: "安装命令退出非零",
    userMessage: "安装命令执行失败",
    technicalMessage: "exitCode=1",
    errorCode: "OPENCLAW_INSTALL_SCRIPT_FAILED",
    commandResult: {
      command: "bash",
      exitCode: 1,
      signal: null,
      timedOut: false,
      spawnError: null,
      durationMs: 5
    }
  });
  const nonzeroResult = await runWorkflow("install", {
    config: {
      targetDir: path.join(tempDir, ".openclaw-2"),
      runtimeStatePath: path.join(tempDir, "workflow-state-2.json"),
      diagnosticLogPath,
      logDir: path.join(tempDir, "legacy-logs-2")
    }
  });

  assert.equal(nonzeroResult.failedStepId, "environment_check");
  assert.equal(nonzeroResult.errorCode, "OPENCLAW_INSTALL_SCRIPT_FAILED");
  assert.equal(nonzeroResult.commandResult.exitCode, 1);
  assert.equal(nonzeroResult.userMessage, "安装命令执行失败");

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test("下载错误分类覆盖 DNS、TLS、HTTP、timeout 和写入失败", () => {
  clearProjectModules();
  const {
    classifyDownloadError
  } = require(projectPath("src/core/workflow/steps/download_script.js"));

  assert.equal(classifyDownloadError({ code: "ENOTFOUND" }).errorCode, "OPENCLAW_DOWNLOAD_DNS_FAILED");
  assert.equal(classifyDownloadError({ code: "ERR_TLS_CERT_ALTNAME_INVALID" }).errorCode, "OPENCLAW_DOWNLOAD_TLS_FAILED");
  assert.equal(classifyDownloadError({ kind: "http", httpStatus: 404 }).errorCode, "OPENCLAW_DOWNLOAD_HTTP_FAILED");
  assert.equal(classifyDownloadError({ kind: "timeout", code: "ETIMEDOUT" }).errorCode, "OPENCLAW_DOWNLOAD_TIMEOUT");
  assert.equal(classifyDownloadError({ kind: "write", code: "EACCES" }).errorCode, "OPENCLAW_DOWNLOAD_WRITE_FAILED");
});

function createFailingStep() {
  return {
    id: "environment_check",
    label: "环境检查",
    onFail: "stop",
    async run() {
      return {
        success: false,
        message: "测试步骤失败",
        userMessage: "缺少测试命令",
        technicalMessage: "spawn failed",
        commandResult: {
          command: "missing-command",
          exitCode: -2,
          signal: null,
          timedOut: false,
          spawnError: {
            code: "ENOENT",
            message: "command not found"
          },
          durationMs: 1
        }
      };
    }
  };
}

function createSuccessStep(id) {
  return {
    id,
    label: id,
    onFail: "stop",
    async run() {
      return {
        success: true,
        message: "ok"
      };
    }
  };
}
