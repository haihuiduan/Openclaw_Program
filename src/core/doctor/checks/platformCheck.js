// 操作系统检测：第一版主要面向 macOS，其他系统先提示风险但不阻止。

function checkPlatform() {
  const isMac = process.platform === "darwin";

  return {
    name: "操作系统",
    ok: true,
    level: isMac ? "pass" : "warning",
    category: "system",
    code: isMac ? "PLATFORM_SUPPORTED" : "UNSUPPORTED_PLATFORM",
    message: isMac ? "macOS，当前版本支持" : "当前版本主要面向 macOS，当前系统可能暂不支持",
    suggestion: isMac ? "" : "如遇到安装或运行问题，建议先在 macOS 环境中使用。",
    repairable: false,
    repairAction: null
  };
}

module.exports = {
  checkPlatform
};
