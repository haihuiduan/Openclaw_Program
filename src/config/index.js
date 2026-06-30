// 配置入口：负责把默认配置和运行时传入的覆盖项合并成最终配置。
// 目前配置来自 CLI 参数，未来也可以扩展为读取配置文件或 GUI 表单。
const { defaultConfig } = require("./defaults");

/**
 * 加载最终配置。
 * 输入：覆盖项，例如 { dryRun: true, targetDir: "/tmp/openclaw" }。
 * 输出：完整配置对象。
 */
function loadConfig(overrides = {}) {
  return {
    ...defaultConfig,
    ...removeEmptyValues(overrides)
  };
}

/**
 * 去掉空值，避免空字符串或 undefined 覆盖掉默认配置。
 * 例如用户没有提供 --target-dir 时，应继续使用默认安装目录。
 */
function removeEmptyValues(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== "")
  );
}

module.exports = {
  loadConfig
};
