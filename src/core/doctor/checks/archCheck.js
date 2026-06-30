// CPU 架构检测：确认当前电脑架构是否属于第一版支持范围。

function checkArchitecture() {
  const archMessages = {
    arm64: "Apple Silicon arm64，支持",
    x64: "Intel x64，支持"
  };
  const supported = Boolean(archMessages[process.arch]);

  return {
    name: "CPU 架构",
    ok: true,
    level: supported ? "pass" : "warning",
    category: "system",
    code: supported ? "ARCH_SUPPORTED" : "UNSUPPORTED_ARCH",
    message: supported ? archMessages[process.arch] : "当前架构可能暂不支持",
    suggestion: supported ? "" : "如遇到安装或运行问题，请换用 arm64 或 x64 架构环境。",
    repairable: false,
    repairAction: null
  };
}

module.exports = {
  checkArchitecture
};
