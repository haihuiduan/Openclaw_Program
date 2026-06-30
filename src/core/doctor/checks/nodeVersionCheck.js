// Node.js 版本检查：确保当前运行环境满足项目要求的最低版本。

/**
 * 检查当前 Node.js 版本是否达到最低要求。
 * 输入：最低版本号，例如 "18.17.0"。
 * 输出：标准检查结果对象，供 doctor 汇总。
 */
function checkNodeVersion(minVersion) {
  const current = process.versions.node;
  const ok = compareSemver(current, minVersion) >= 0;

  return {
    name: "Node.js 版本",
    ok,
    level: ok ? "pass" : "fail",
    category: "runtime",
    code: ok ? "NODE_VERSION_OK" : "NODE_VERSION_TOO_LOW",
    message: ok
      ? `当前版本 ${current}，满足要求：>= ${minVersion}`
      : `当前版本 ${current}，需要 >= ${minVersion}。`,
    suggestion: ok ? "" : `请升级 Node.js 到 ${minVersion} 或更高版本。`,
    repairable: false,
    repairAction: null
  };
}

/**
 * 比较两个语义化版本号。
 * 输入：left 和 right，例如 "20.1.0" 与 "18.17.0"。
 * 输出：正数表示 left 更新，0 表示相等，负数表示 left 更旧。
 */
function compareSemver(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);

  for (let index = 0; index < 3; index += 1) {
    // 按主版本、次版本、补丁版本逐段比较，遇到差异就能得出结论。
    const diff = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

module.exports = {
  checkNodeVersion
};
