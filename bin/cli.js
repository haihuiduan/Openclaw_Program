#!/usr/bin/env node

// CLI 可执行入口：npm 全局安装后，用户输入 `openclaw-installer` 会先运行这个文件。
// 这里不写具体业务，只把命令参数交给 src/cli 处理，方便未来复用核心逻辑。
const { runCli } = require("../src/cli");

// process.argv 前两个值分别是 node 路径和当前脚本路径，真正的用户命令从第 3 个开始。
// 如果 CLI 内部抛错，在最外层统一打印错误，并设置失败退出码。
runCli(process.argv.slice(2)).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
