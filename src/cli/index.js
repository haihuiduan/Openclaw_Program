// CLI 控制层：负责理解用户输入的命令，再调用 core 层完成实际工作。
// 注意：这里不直接执行系统命令，也不写安装细节，避免 CLI 和业务逻辑混在一起。
const { loadConfig } = require("../config");
const { runDoctor } = require("../core/doctor");
const { installOpenClaw } = require("../core/installer");
const { runConfigure } = require("../core/configure");
const { runVerify } = require("../core/verify");
const { runSetup } = require("../core/setup");
const { formatDoctorReport } = require("./presenters/doctorPresenter");
const { printHelp } = require("./presenters/helpPresenter");
const { formatConfigureResult } = require("./presenters/configurePresenter");
const { formatVerifyReport } = require("./presenters/verifyPresenter");
const { formatSetupResult } = require("./presenters/setupPresenter");

/**
 * 运行 CLI 命令。
 * 输入：用户在终端里传入的参数数组，例如 ["install", "--dry-run"]。
 * 输出：命令执行结果；help/version 这类展示命令返回 null。
 * 流程：解析命令 -> 合并配置 -> 分发到 doctor/install/help/version。
 */
async function runCli(args) {
  // 第一个参数是命令名，其余参数交给 parseOptions 解析为配置覆盖项。
  const [command = "help", ...rest] = args;
  const config = loadConfig(parseOptions(rest));

  switch (command) {
    case "doctor": {
      const report = await runDoctor(config);
      console.log(formatDoctorReport(report));
      if (!report.ok) {
        // doctor 发现问题时，终端退出码标记为失败，方便脚本或 CI 判断。
        process.exitCode = 1;
      }
      return report;
    }
    case "install": {
      const result = await installOpenClaw(config);
      console.log(result.message);
      if (!result.ok) {
        process.exitCode = 1;
      }
      return result;
    }
    case "configure": {
      const result = await runConfigure(config);
      console.log(formatConfigureResult(result));
      if (!result.ok) {
        process.exitCode = 1;
      }
      return result;
    }
    case "verify": {
      const report = await runVerify(config);
      console.log(formatVerifyReport(report));
      if (!report.ok) {
        process.exitCode = 1;
      }
      return report;
    }
    case "setup": {
      const result = await runSetup(config);
      console.log(formatSetupResult(result));
      if (!result.ok) {
        process.exitCode = 1;
      }
      return result;
    }
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return null;
    case "version":
    case "--version":
    case "-v":
      console.log(require("../../package.json").version);
      return null;
    default:
      // 未知命令直接抛错，由 bin/cli.js 的统一错误处理负责打印。
      throw new Error(`未知命令：${command}\n请运行 "openclaw-installer help" 查看用法说明。`);
  }
}

/**
 * 解析 CLI 选项。
 * 输入：命令名后面的参数数组，例如 ["--target-dir", "/tmp/app", "--dry-run"]。
 * 输出：配置覆盖对象，例如 { targetDir: "/tmp/app", dryRun: true }。
 */
function parseOptions(args) {
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--target-dir") {
      // --target-dir 后面紧跟目录值，所以读取下一个参数，并跳过它。
      const targetDir = args[index + 1];

      if (!targetDir || targetDir.startsWith("--")) {
        throw new Error("--target-dir 需要提供路径，例如：openclaw-installer install --target-dir ~/.openclaw");
      }

      options.targetDir = targetDir;
      index += 1;
    }

    if (arg === "--dry-run") {
      // dry-run 只预演流程，不真正改动系统。
      options.dryRun = true;
    }

    if (arg === "--onboard") {
      options.onboard = true;
      options.reconfigure = false;
    }

    if (arg === "--reconfigure") {
      options.reconfigure = true;
    }
  }

  return options;
}

module.exports = {
  runCli
};
