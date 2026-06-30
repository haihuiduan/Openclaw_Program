// help 输出器：集中维护 CLI 帮助文案，避免散落在命令解析代码里。

/**
 * 打印帮助信息。
 * 输入：无。
 * 输出：直接写到终端，不返回业务数据。
 */
function printHelp() {
  console.log(`OpenClaw 安装助手

用法：
  openclaw doctor              检测电脑环境、OpenClaw 状态、网络和安装目录
  openclaw install             安装 OpenClaw
  openclaw install --dry-run   只模拟安装流程，不实际修改文件
  openclaw help                查看帮助信息
  openclaw version             查看当前安装助手版本

选项：
  --target-dir <路径>           指定 OpenClaw 的安装目录
  --dry-run                    只模拟执行，不实际安装或修改文件`);
}

module.exports = {
  printHelp
};
