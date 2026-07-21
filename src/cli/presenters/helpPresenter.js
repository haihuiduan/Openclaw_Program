// help 输出器：集中维护 CLI 帮助文案，避免散落在命令解析代码里。

/**
 * 打印帮助信息。
 * 输入：无。
 * 输出：直接写到终端，不返回业务数据。
 */
function printHelp() {
  console.log(`OpenClaw 安装助手

用法：
  openclaw-installer doctor              检测电脑环境、OpenClaw 状态、网络和安装目录
  openclaw-installer install             安装 OpenClaw
  openclaw-installer install --dry-run   只模拟安装流程，不实际修改文件
  openclaw-installer configure           启动 OpenClaw 官方配置向导
  openclaw-installer configure --dry-run 预览配置流程，不实际执行
  openclaw-installer configure --reconfigure  修改已有 OpenClaw 配置
  openclaw-installer verify              验证 OpenClaw 是否已安装并基本可用
  openclaw-installer verify --dry-run    预览验证项目，不执行检查命令
  openclaw-installer setup               执行 OpenClaw 一键准备流程
  openclaw-installer setup --dry-run     预览一键准备流程，不修改文件
  openclaw-installer roles list         列出内置离线角色
  openclaw-installer roles inspect <id> 查看角色详情
  openclaw-installer roles install <id> 安装角色到独立 workspace
  openclaw-installer roles list-installed 列出已安装角色
  openclaw-installer roles remove <id>  删除已安装但未启用的角色
  openclaw-installer instances list     列出 ToolBox 管理的 Agent Instance
  openclaw-installer instances inspect <id> 查看 Agent Instance 详情
  openclaw-installer instances register <role-id> <agent-id> 注册 Role Agent
  openclaw-installer instances reconcile 核对 OpenClaw 注册状态与配置漂移
  openclaw-installer teams list         列出 ToolBox 管理的 Team
  openclaw-installer teams inspect <id> 查看 Team、成员与健康状态
  openclaw-installer teams create <id> --name <名称> --manager <instance-id> --member <instance-id>
  openclaw-installer teams update <id> [--name <名称>] [--description <描述>] [--execution-mode confirm|auto] [--max-concurrency 1-32]
  openclaw-installer teams add-member <id> <instance-id> 添加成员
  openclaw-installer teams remove-member <id> <instance-id> 移除非 Manager 成员
  openclaw-installer teams set-manager <id> <instance-id> 指定已有成员为 Manager
  openclaw-installer teams delete <id> --confirm 只删除 Team State
  openclaw-installer projects list      列出 Project
  openclaw-installer projects inspect <id> 查看 Project、Team 快照与 Task 摘要
  openclaw-installer projects create <id> --name <名称> --team <team-id>
  openclaw-installer projects update <id> [--name <名称>] [--description <描述>]
  openclaw-installer projects activate <id> 激活 draft Project
  openclaw-installer projects complete <id> 完成没有 pending Task 的 Project
  openclaw-installer projects archive <id> 归档并设为只读
  openclaw-installer projects unarchive <id> 取消归档
  openclaw-installer projects sync-preview <id> 预览 Team 配置差异
  openclaw-installer projects sync-team <id> --confirm --expected-team-updated-at <时间>
  openclaw-installer tasks list --project <project-id> 列出 Project Task
  openclaw-installer tasks inspect <id> 查看 Task 与动态依赖状态
  openclaw-installer tasks create <id> --project <project-id> --title <标题>
  openclaw-installer tasks update <id> [--title <标题>] [--priority low|medium|high]
  openclaw-installer tasks assign <id> <instance-id> 分配快照成员
  openclaw-installer tasks unassign <id> 取消分配
  openclaw-installer tasks set-critical <id> --critical true|false [--reason <原因>] [--source user|manager]
  openclaw-installer tasks add-dependency <id> <dependency-id> 添加同 Project 依赖
  openclaw-installer tasks remove-dependency <id> <dependency-id> 移除依赖
  openclaw-installer tasks complete <id> 标记完成（不会执行 Agent）
  openclaw-installer tasks cancel <id> 标记取消
  openclaw-installer help                查看帮助信息
  openclaw-installer version             查看当前安装助手版本

选项：
  --target-dir <路径>           指定 OpenClaw 的安装目录
  --dry-run                    只模拟执行，不实际安装或修改文件`);
}

module.exports = {
  printHelp
};
