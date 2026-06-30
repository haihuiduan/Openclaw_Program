// doctor 模块：集中做安装前环境检测，例如 Node 版本、系统状态、网络和安装目录。
// 安装器和 CLI 都只调用 runDoctor，不需要知道每个检查项的细节。
const { checkArchitecture } = require("./checks/archCheck");
const { checkCommand } = require("./checks/commandCheck");
const { checkNodeVersion } = require("./checks/nodeVersionCheck");
const { checkNpmRegistry } = require("./checks/npmRegistryCheck");
const { checkOpenClawStatus } = require("./checks/openClawStatusCheck");
const { checkPlatform } = require("./checks/platformCheck");
const { checkTargetDirectory } = require("./checks/targetDirectoryCheck");

/**
 * 运行全部环境检查。
 * 输入：配置对象，里面包含最低 Node 版本、必需命令列表和安装目录。
 * 输出：{ ok, checks }，ok 只在存在失败项时为 false。
 */
async function runDoctor(config) {
  const checks = [
    checkNodeVersion(config.minNodeVersion),
    ...(await Promise.all(config.requiredCommands.map(checkCommand))),
    checkPlatform(),
    checkArchitecture(),
    await checkOpenClawStatus(),
    await checkNpmRegistry(),
    await checkTargetDirectory(config)
  ];

  return {
    // warning 和 info 只提示风险，不阻止安装；只有 fail 会让整体检测不通过。
    ok: !checks.some((check) => check.level === "fail"),
    checks
  };
}

module.exports = {
  runDoctor
};
