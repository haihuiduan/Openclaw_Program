// npm 网络检测：检查 registry 是否可访问，不自动修改 registry 或代理配置。
const { runCommand } = require("../../../utils/shell");

async function checkNpmRegistry() {
  try {
    const result = await runCommand("npm", ["ping"], {
      allowFailure: true,
      timeoutMs: 7000
    });

    if (!result.timedOut && result.code === 0) {
      return {
        name: "npm 网络访问",
        ok: true,
        level: "pass",
        category: "network",
        code: "NPM_REGISTRY_OK",
        message: "npm registry 可以访问",
        suggestion: "",
        repairable: false,
        repairAction: null
      };
    }

    return createNetworkWarning(result.timedOut);
  } catch (error) {
    return createNetworkWarning(false);
  }
}

function createNetworkWarning(timedOut) {
  return {
    name: "npm 网络访问",
    ok: true,
    level: "warning",
    category: "network",
    code: "NPM_REGISTRY_UNREACHABLE",
    message: timedOut
      ? "访问 npm registry 超时，可能会影响安装依赖。"
      : "当前无法访问 npm registry，可能会影响安装依赖。",
    suggestion: "请检查网络连接、代理/VPN 设置，或切换 npm 镜像源后重试。后续版本可通过 openclaw repair 尝试修复。",
    repairable: true,
    repairAction: "fix_npm_registry"
  };
}

module.exports = {
  checkNpmRegistry
};
