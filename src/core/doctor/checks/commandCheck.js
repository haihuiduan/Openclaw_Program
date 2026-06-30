// 单个系统命令检查：判断 node、npm、git 这类命令是否存在于 PATH 中。
const { commandExists } = require("../../../utils/shell");

const commandMeta = {
  node: {
    name: "系统命令：node",
    category: "runtime",
    missingCode: "NODE_NOT_FOUND",
    suggestion: "请安装 Node.js，后续版本可通过 openclaw repair 自动修复。",
    repairAction: "install_node"
  },
  npm: {
    name: "系统命令：npm",
    category: "dependency",
    missingCode: "NPM_NOT_FOUND",
    suggestion: "请安装 Node.js/npm，后续版本可通过 openclaw repair 自动修复。",
    repairAction: "install_node"
  },
  git: {
    name: "系统命令：git",
    category: "dependency",
    missingCode: "GIT_NOT_FOUND",
    suggestion: "请安装 Git，后续版本可通过 openclaw repair 自动修复。",
    repairAction: "install_git"
  }
};

/**
 * 检查一个命令是否可用。
 * 输入：命令名，例如 "git"。
 * 输出：标准检查结果对象，供 doctor 汇总。
 */
async function checkCommand(command) {
  const exists = await commandExists(command);
  const meta = commandMeta[command] || {
    name: `系统命令：${command}`,
    category: "dependency",
    missingCode: `${command.toUpperCase()}_NOT_FOUND`,
    suggestion: "请先安装该工具，或确认它已经加入系统 PATH。",
    repairAction: null
  };

  return {
    name: meta.name,
    ok: exists,
    level: exists ? "pass" : "fail",
    category: meta.category,
    code: exists ? `${command.toUpperCase()}_FOUND` : meta.missingCode,
    message: exists ? "已找到" : `未找到 ${command}，安装或运行 OpenClaw 可能需要该工具。`,
    suggestion: exists ? "" : meta.suggestion,
    repairable: !exists && Boolean(meta.repairAction),
    repairAction: exists ? null : meta.repairAction
  };
}

module.exports = {
  checkCommand
};
