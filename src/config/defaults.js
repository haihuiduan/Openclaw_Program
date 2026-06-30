// 默认配置：项目在没有额外参数时使用这些值。
// CLI 参数、未来配置文件或 GUI 设置都可以覆盖这里的默认值。
const path = require("node:path");
const os = require("node:os");

const defaultConfig = {
  appName: "OpenClaw",
  minNodeVersion: "18.17.0",
  targetDir: path.join(os.homedir(), ".openclaw"),
  dryRun: false,
  requiredCommands: ["node", "npm", "git"]
};

module.exports = {
  defaultConfig
};
