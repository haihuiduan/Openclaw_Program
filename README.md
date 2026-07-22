# OpenClaw 工具箱

## 项目简介

OpenClaw 工具箱是一个面向 macOS 用户的 OpenClaw 安装、配置与控制台管理工具。

项目目标是降低普通用户使用 OpenClaw 的门槛，把原本需要命令行完成的环境检测、OpenClaw 安装、API Key 配置、配置检查、控制台启动和问题排查，整理成一个更清晰的桌面工具。

当前项目已经包含：

- Electron GUI 桌面界面
- OpenClaw 安装与环境检测流程
- GUI 内 API Key 基础配置
- OpenClaw 配置状态确认
- OpenClaw Dashboard 启动与停止
- 版本检测与更新入口
- 问题排查和安装日志
- CLI 底层命令能力

本项目不会保存、展示或记录用户的 API Key。

## 当前版本状态

项目阶段：GUI MVP 工具箱版

npm 包版本：0.1.0

当前主流程：

```text
未安装 OpenClaw：
欢迎 → 准备 OpenClaw → 配置 API Key → 检查配置 → 打开控制台

已安装但未配置 API Key：
配置 API Key → 检查配置 → 打开控制台

已安装且已配置：
OpenClaw 工具箱首页 → 启动控制台 / 停止控制台 / 更换 API Key
```

测试数量会随功能演进变化，请运行 `npm test` 查看当前完整结果。

## 功能列表

### Electron GUI 桌面工具

当前 GUI 是项目的主要使用入口，适合普通用户使用。

GUI 主要能力包括：

- 检测当前 Mac 是否满足运行 OpenClaw 的基础条件。
- 安装或确认 OpenClaw。
- 在界面内选择 AI 服务商并输入 API Key。
- 检查 OpenClaw 配置状态。
- 启动 OpenClaw Dashboard。
- 停止 OpenClaw 后台控制台服务。
- 更换 API Key。
- 检查 OpenClaw 当前版本和最新版本。
- 打开官方高级配置向导。
- 打开问题排查日志目录。
- 查看最近操作状态。

### 准备 OpenClaw

“准备 OpenClaw”会自动完成：

1. 检查 macOS、CPU 架构、Node.js、npm、Git、npm 网络访问和目标目录。
2. 检查是否已经安装 OpenClaw。
3. 未安装时下载并执行 OpenClaw 官方安装脚本。
4. 安装完成后通过 `openclaw --version` 验证 OpenClaw 命令可用。

如果已经安装 OpenClaw，则不会重复安装。

### GUI 内配置 API Key

GUI 支持在界面内完成基础 API Key 配置。

当前支持的 AI 服务商包括：

- OpenRouter
- DeepSeek
- OpenAI
- Gemini
- Qwen

配置时，用户只需要：

1. 选择 AI 服务商。
2. 输入 API Key。
3. 选择模型，默认可使用“自动推荐，适合首次使用”。
4. 点击开始配置。

本项目会调用 OpenClaw 官方 non-interactive onboarding 能力完成配置，不会自己写 OpenClaw 官方配置文件。

本项目不会：

- 保存 API Key。
- 展示 API Key。
- 记录 API Key。
- 把 API Key 写入日志。
- 保存完整 onboarding 命令。

### 配置状态确认

为了避免误判，项目不会只因为存在配置文件就认为 API Key 已配置。

当前判断逻辑：

- `openclaw` 命令存在，不等于 API Key 已配置。
- `openclaw config file` 可用，不等于 API Key 已配置。
- Dashboard 能打开，不等于模型一定可调用。

只有当用户通过 GUI 快速配置成功，并且随后检查通过，才会在 GUI 中显示：

```text
配置 已配置
```

项目会在安装器自己的目录中保存一个非敏感状态文件：

```text
~/.openclaw-installer/config-state.json
```

该文件只记录：

- 是否曾通过 GUI 配置成功
- 配置时间
- 服务商
- 模型选择
- OpenClaw 版本

该文件不会保存 API Key 或任何可还原 API Key 的内容。

### 启动和停止控制台

GUI 支持启动 OpenClaw Dashboard。

启动控制台时，当前使用：

```bash
openclaw dashboard --yes
```

这样在 gateway 未运行时，可以自动确认启动 gateway，避免卡在交互提示：

```text
Gateway is not running. Start it now? [Y/n]
```

GUI 也支持停止控制台服务。

停止控制台不会：

- 卸载 OpenClaw。
- 删除 `~/.openclaw`。
- 删除 API 配置。
- 删除 `config-state.json`。

### 版本检测与更新

GUI 会检测：

- 当前 OpenClaw 版本
- 最新 OpenClaw 版本
- 更新状态

如果发现新版本，可以从“关于本工具”中触发更新。

更新不会删除用户的 OpenClaw 配置。

### 高级配置

普通用户通常不需要进入高级配置。

高级入口包括：

- 官方配置向导
- 重新检查环境
- 问题排查

官方配置向导适合需要配置 Skills、Hooks、Web search、Channel、Gateway 等高级功能的用户。

### 问题排查和安装日志

安装和部分运行流程会写入日志，便于排查问题。

日志目录：

```text
~/.openclaw-installer/logs/
```

GUI 中的“问题排查”入口会打开该目录。

日志不会记录 API Key。

## 安装依赖

开发阶段先安装依赖：

```bash
npm install
```

如果 Electron 下载较慢，可以使用国内镜像：

```bash
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
npm install
```

## 启动 GUI

开发阶段启动 Electron GUI：

```bash
npm run gui
```

如果遇到 `ELECTRON_RUN_AS_NODE` 相关问题，可以使用：

```bash
env -u ELECTRON_RUN_AS_NODE npm run gui
```

## CLI 使用方式

除了 GUI，项目仍保留 CLI 底层能力。

直接通过 Node.js 运行：

```bash
node bin/cli.js doctor
node bin/cli.js install
node bin/cli.js install --dry-run
node bin/cli.js configure
node bin/cli.js configure --dry-run
node bin/cli.js configure --reconfigure
node bin/cli.js verify
node bin/cli.js verify --dry-run
node bin/cli.js setup
node bin/cli.js setup --dry-run
node bin/cli.js roles list
node bin/cli.js roles inspect <role-id>
node bin/cli.js roles install <role-id>
node bin/cli.js roles list-installed
node bin/cli.js roles remove <role-id>
node bin/cli.js instances list
node bin/cli.js instances inspect <instance-id>
node bin/cli.js instances register <role-id> <role-agent-id>
node bin/cli.js instances reconcile
node bin/cli.js teams list
node bin/cli.js teams inspect <team-id>
node bin/cli.js teams create <team-id> --name <name> --manager <instance-id> --member <instance-id>
node bin/cli.js teams update <team-id> [--name <name>] [--description <text>] [--execution-mode confirm|auto] [--max-concurrency 1-32]
node bin/cli.js teams add-member <team-id> <instance-id>
node bin/cli.js teams remove-member <team-id> <instance-id>
node bin/cli.js teams set-manager <team-id> <instance-id>
node bin/cli.js teams delete <team-id> --confirm
node bin/cli.js projects list
node bin/cli.js projects inspect <project-id>
node bin/cli.js projects create <project-id> --name <name> --team <team-id>
node bin/cli.js projects update <project-id> [--name <name>] [--description <text>]
node bin/cli.js projects activate <project-id>
node bin/cli.js projects complete <project-id>
node bin/cli.js projects archive <project-id>
node bin/cli.js projects unarchive <project-id>
node bin/cli.js projects sync-preview <project-id>
node bin/cli.js projects sync-team <project-id> --confirm --expected-team-updated-at <timestamp>
node bin/cli.js tasks list --project <project-id>
node bin/cli.js tasks inspect <task-id>
node bin/cli.js tasks create <task-id> --project <project-id> --title <title>
node bin/cli.js tasks update <task-id> [--title <title>] [--priority low|medium|high]
node bin/cli.js tasks assign <task-id> <instance-id>
node bin/cli.js tasks unassign <task-id>
node bin/cli.js tasks set-critical <task-id> --critical true|false [--reason <reason>] [--source user|manager]
node bin/cli.js tasks add-dependency <task-id> <dependency-task-id>
node bin/cli.js tasks remove-dependency <task-id> <dependency-task-id>
node bin/cli.js tasks complete <task-id>
node bin/cli.js tasks cancel <task-id>
node bin/cli.js executions list
node bin/cli.js executions inspect <run-id>
node bin/cli.js executions run-task <task-id> --confirm
node bin/cli.js executions retry <run-id> --confirm
node bin/cli.js executions reconcile
node bin/cli.js help
node bin/cli.js version
```

如果需要在本机开发时使用 `openclaw-installer` 命令，可以执行：

```bash
npm link
openclaw-installer doctor
openclaw-installer setup
```

Agent Instance 首版只负责注册、查询和漂移核对。由于 OpenClaw 当前没有安全的原生
enable/disable，本工具不会用 `agents delete`、`unbind` 或直接修改 `openclaw.json`
来模拟停用，也不会自动删除未由 ToolBox 管理的 OpenClaw Agent。

Team Builder 首版只保存 Team 与 Agent Instance ID 的映射，不复制 Role、workspace、
agentDir 或 OpenClaw 配置。Team 的 `ready`、`degraded`、`invalid` 健康状态由当前
Instance State 动态计算；本阶段不执行任务、不调用 OpenClaw，也不包含 Team Builder GUI。

Task Execution 首版采用前台全局串行执行。`executionMode=auto` 只保存未来策略，
仍需显式运行 `executions run-task --confirm`；当前不支持安全远端 cancel、pause、
后台调度、Manager 自动拆分、Agent-to-Agent 调用或 checkpoint 恢复。Execution 默认
只保存安全摘要，不保存完整 Prompt、stdout、stderr、API Key、token、secret、
workspacePath 或 agentDir。

Project / Task Core 首版把 Project 绑定到创建时的 Team 安全快照；Team 后续变化不会自动
改写已有 Project，用户只能在预览差异后显式同步。Task 只支持 pending、completed、
cancelled 三种持久状态，并动态计算依赖阻塞；`auto`、并发与重试字段目前只是未来执行偏好，
不会调用 Agent、OpenClaw、workspace 或 agentDir，也不包含任务执行器与 GUI。

`npm link` 是开发阶段的本地链接方式，不代表已经发布到 npm。

## CLI 命令说明

| 命令 | 作用 |
| --- | --- |
| `openclaw-installer doctor` | 检测电脑环境、OpenClaw 状态、网络和安装目录 |
| `openclaw-installer install` | 通过 OpenClaw 官方安装脚本安装 OpenClaw，已安装则跳过 |
| `openclaw-installer install --dry-run` | 预览安装流程，不下载、不执行、不修改系统 |
| `openclaw-installer configure` | 启动 OpenClaw 官方配置向导 |
| `openclaw-installer configure --dry-run` | 预览配置流程，不执行官方命令 |
| `openclaw-installer configure --reconfigure` | 修改已有 OpenClaw 配置 |
| `openclaw-installer verify` | 验证 OpenClaw 是否已经安装并基本可用 |
| `openclaw-installer verify --dry-run` | 预览验证项目，不执行检查命令 |
| `openclaw-installer setup` | 串联 doctor + install，并提示后续 configure + verify |
| `openclaw-installer setup --dry-run` | 预览完整准备流程，不执行实际步骤 |
| `openclaw-installer roles list` | 列出内置离线角色包 |
| `openclaw-installer roles inspect <role-id>` | 查看角色包及安装状态，不修改文件 |
| `openclaw-installer roles install <role-id>` | 将角色的 Agent 文件安装到独立 workspace |
| `openclaw-installer roles list-installed` | 列出本工具安装并记录的角色 |
| `openclaw-installer roles remove <role-id>` | 安全移除未启用且未被用户修改的角色 workspace |
| `openclaw-installer instances list` | 列出 ToolBox 管理的 Agent Instance |
| `openclaw-installer instances inspect <instance-id>` | 查看本地 Agent Instance 状态 |
| `openclaw-installer instances register <role-id> <role-agent-id>` | 注册已安装 Role Agent |
| `openclaw-installer instances reconcile` | 核对 OpenClaw 注册状态与配置漂移 |
| `openclaw-installer teams list` | 列出 Team 及其动态健康状态 |
| `openclaw-installer teams inspect <team-id>` | 查看 Team、成员、Manager 与健康问题 |
| `openclaw-installer teams create <team-id> ...` | 用 registered Agent Instance 创建 Team |
| `openclaw-installer teams update <team-id> ...` | 更新 Team 名称、描述、执行模式或并发上限 |
| `openclaw-installer teams add-member <team-id> <instance-id>` | 添加 registered Instance 成员 |
| `openclaw-installer teams remove-member <team-id> <instance-id>` | 移除非 Manager 成员 |
| `openclaw-installer teams set-manager <team-id> <instance-id>` | 指定已在 Team 中的 registered 成员为 Manager |
| `openclaw-installer teams delete <team-id> --confirm` | 只删除 Team State，不删除 Instance 或 workspace |
| `openclaw-installer help` | 查看帮助信息 |
| `openclaw-installer version` | 查看当前安装助手版本 |

## 测试

运行测试：

```bash
npm test
```

当前测试覆盖：

- CLI 命令分发
- doctor 环境检测
- install 安装流程、dry-run、失败分支和安装日志
- configure 官方配置流程封装
- verify 安装后基础验收
- setup 完整流程编排
- workflow runtime
- GUI 服务层部分逻辑
- 中文错误提示
- 敏感信息不直接输出到终端

也可以对关键文件做语法检查：

```bash
node --check src/gui/renderer/renderer.js
node --check src/gui/services/installerService.js
node --check src/gui/main.js
node --check src/gui/preload.js
```

## 项目结构

```text
bin/cli.js                         CLI 可执行入口

src/cli                            命令解析和终端输出层
src/cli/presenters                 中文输出格式化

src/core/doctor                    环境和依赖检测
src/core/installer                 安装计划、安装执行和安装日志接入
src/core/configure                 OpenClaw 官方配置向导封装
src/core/verify                    安装后基础验收
src/core/setup                     doctor + install 的流程编排

src/core/workflow                  安装 workflow 引擎、运行时和步骤
src/core/workflow/steps            环境检测、下载脚本、执行脚本、验证安装等步骤

src/gui/main.js                    Electron 主进程
src/gui/preload.js                 Electron preload 安全桥接
src/gui/services/installerService.js GUI 服务层
src/gui/renderer                   Electron 前端页面、样式和交互逻辑

src/config                         默认配置和运行时配置合并
src/utils                          通用工具
src/utils/shell                    系统命令执行封装

docs                               项目文档
tests                              自动化测试
```

## 当前限制

- 当前仍处于 GUI MVP 阶段，尚未打包成正式 macOS App 或 DMG。
- 真实安装依赖 OpenClaw 官方 `install.sh`。
- 尚未在大量干净 macOS 机器上验证。
- 当前不会自动安装 Node.js、npm、Git 等系统级依赖，只会检测并提示。
- 当前不会自动修改用户 PATH。
- 当前不会自动安装 Homebrew。
- 当前不会保存 API Key。
- 当前配置检查仍以 OpenClaw 基础状态为主，不等同于真实模型请求成功。
- 高级能力如 Skills、Hooks、Web search、Channel 等交给 OpenClaw 官方配置向导处理。

## 后续计划

1. 完成 macOS App 打包。
2. 增加更完整的手动验收测试文档。
3. 增强 OpenClaw 控制台运行状态检测。
4. 增加更友好的网络异常和国内镜像提示。
5. 增加可选的一键修复能力。
6. 增加更新 OpenClaw 的稳定流程和回滚提示。
7. 增加场景模板和角色管理能力。
8. 在更多干净 macOS 环境中测试安装流程。

## 开发定位

OpenClaw 工具箱当前的核心价值，是把 OpenClaw 的安装、配置和控制台启动过程封装成普通用户更容易理解的桌面工具。

CLI 能力作为底层基础，GUI 作为主要用户入口。

项目优先保证：

- 不保存用户 API Key。
- 不擅自修改系统环境。
- 尽量调用 OpenClaw 官方命令完成安装和配置。
- 普通用户只看到必要步骤。
- 高级能力放到高级入口中。

## License

MIT
