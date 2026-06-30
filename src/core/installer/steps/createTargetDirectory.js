// 安装步骤：创建 OpenClaw 的目标安装目录。
// 具体命令通过 utils/shell 执行，保持“所有系统命令集中封装”的原则。
const { runCommand } = require("../../../utils/shell");

/**
 * 创建安装目录。
 * 输入：配置对象，读取 targetDir 和 dryRun。
 * 输出：步骤执行记录，installer 会把它放进 steps 数组。
 */
async function createTargetDirectory(config) {
  if (config.dryRun) {
    // dry-run 模式只返回计划，不执行 mkdir。
    return {
      name: "创建安装目录",
      skipped: true,
      detail: config.targetDir
    };
  }

  // -p 表示目录已存在也不报错，适合重复执行安装初始化。
  await runCommand("mkdir", ["-p", config.targetDir]);

  return {
    name: "创建安装目录",
    skipped: false,
    detail: config.targetDir
  };
}

module.exports = {
  createTargetDirectory
};
