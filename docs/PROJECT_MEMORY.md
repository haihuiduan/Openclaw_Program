# OpenClaw ToolBox 项目长期记忆

本文只记录长期稳定的产品、架构和工程边界。当前分支、测试数量、未提交改动和下一步请查看 `CURRENT_STATUS.md`。

## 1. 项目定位

OpenClaw ToolBox 是面向 macOS 普通用户的 OpenClaw 桌面工具和本地管理层。它把原本依赖命令行的环境检测、安装、配置、角色管理、Agent 注册和单 Agent 对话整理为 GUI 与 CLI 能力。

项目不是 OpenClaw 本体，不自行实现模型服务，也不替代 OpenClaw 官方配置格式和 Agent 运行时。

## 2. 产品目标

- 降低普通用户首次安装和配置 OpenClaw 的门槛。
- 通过离线 Role Package 提供可审查、可安装的本地角色模板。
- 把 Role、Agent Instance、Team、Project、Task、Execution 和 Conversation 分成独立生命周期。
- GUI 和 CLI 共用同一套 Core，避免出现两套业务规则。
- 默认保护用户配置、workspace、Agent 状态和敏感信息。
- 所有破坏性或真实执行操作都要求明确边界和可验证结果。

## 3. 技术栈

| 类别 | 当前实现 |
| --- | --- |
| 运行时 | Node.js，`package.json` 要求 `>=18.17` |
| 模块系统 | CommonJS：`require` / `module.exports` |
| 桌面框架 | Electron 43 |
| 前端 | 原生 HTML、CSS、JavaScript，无 React/Vue |
| 打包 | electron-builder 26，`scripts/buildMac.js` |
| 测试 | Node.js 内置 `node:test` 与 `assert` |
| 数据 | 本地 JSON State，无数据库 |
| CLI | `bin/cli.js` 与 `src/cli/` |
| 目标平台 | 第一版以 macOS Apple Silicon arm64 为主 |

## 4. 总体架构

```text
GUI Renderer
  → preload contextBridge
  → Electron ipcMain
  → GUI Service
  → src/index.js 公共 API 或明确的 Core 入口
  → Manager / Workflow
  → State 与 Adapter
  → OpenClaw CLI、文件系统或本地 JSON

CLI
  → Parser / Dispatcher
  → src/index.js 公共 API
  → Manager / State / Adapter
  → Presenter
```

### Renderer

`src/gui/renderer/` 负责页面、导航、局部状态和用户交互。Renderer 通过 `window.openClawInstaller` 调用白名单接口，不直接使用 `fs`、`child_process` 或任意系统路径。

### Preload

`src/gui/preload.js` 使用 `contextBridge` 暴露固定方法。IPC 参数应保持最小化，Renderer 不应传入 State Path、workspacePath、agentDir 或命令参数。

### Electron 主进程

`src/gui/main.js` 创建 `BrowserWindow`，启用 `contextIsolation` 并关闭 Renderer 的 Node 集成。主进程负责 IPC 路由、系统 Shell 能力和 Electron 专属路径，不承载业务规则。

### GUI Service

- `installerService.js`：安装、诊断、配置、验证、Dashboard 和日志入口。
- `roleService.js`：角色市场、安装、Agent Instance 启用和“我的角色”安全 DTO。
- `conversationService.js`：聊天中心、Conversation 创建/读取/发送和安全 DTO。
- `src/core/environment-reset/resetService.js`：GUI 专用的完全重置编排、精确删除
  allowlist、符号链接保护和部分失败结果；不作为额外 CLI 命令导出。

Service 负责输入白名单和 UI DTO，不应复制 Core 生命周期逻辑。

### Core

`src/core/` 按领域拆分 Manager、State、Adapter、ID 和校验逻辑。`src/index.js` 是 CLI、测试和 GUI 优先使用的公共 API 聚合入口。

### Adapter

Adapter 是真实 OpenClaw 命令边界：

- `agent-instances/openClawAdapter.js`
- `executions/openClawExecutionAdapter.js`
- `conversations/openClawConversationAdapter.js`

Adapter 使用参数数组和 `shell:false`，只返回安全白名单字段，不向上层暴露完整 stdout、stderr、原始 JSON 或内部路径。

### State

各领域使用独立 `schemaVersion: 1` JSON State。写入通常采用：

1. 规范化和字段白名单；
2. 临时文件；
3. 原子 rename；
4. 0600 文件权限；
5. 必要的进程内或跨进程写锁；
6. 返回深拷贝。

默认状态根目录主要位于 `~/.openclaw-installer/`。测试通过显式 State Path、Store、临时 HOME 和 Mock Adapter 隔离真实用户状态。

## 5. Installer

### 两条安装路径

- `src/core/installer/`：较早的安装计划与 CLI Core。
- `src/core/workflow/`：GUI 使用的结构化安装 workflow。

GUI 安装调用链：

```text
Renderer
  → preload
  → install:run
  → installerService.runInstall()
  → workflow/engine.js
  → workflow/registry.js
  → environment_check
  → check_existing_install
  → prepare_directory
  → download_script
  → execute_script
  → verify_installation
```

当前真实安装仍下载并执行 OpenClaw 官方 `install.sh`。Shell 命令由 `src/utils/shell/` 统一执行并使用增强后的 macOS PATH。

安装诊断使用结构化错误码、步骤进度和脱敏日志。诊断日志由 `src/utils/installDiagnosticLogger.js` 写入 Electron `userData/logs/openclaw-install-debug.log`。

## 6. Role Marketplace

角色市场第一版是仓库内置的离线市场：

- 角色源目录：`roles/`
- 当前内置角色：`cross-border-team`
- Agent：`manager`、`researcher`、`creator`

Role Package 由 manifest 和标准 Agent 文件组成。`roles/registry.js` 扫描，`roles/validator.js` 校验，`roles/installer.js` 执行安全安装和卸载。

角色安装会把每个 Role Agent 复制到独立受管 workspace，并记录 Role State。安装具有重复安装幂等、版本冲突保护、符号链接越界保护、用户修改检测和失败回滚。

GUI 已有角色列表、安装状态、安装操作、启用入口和已安装角色展示。它不是在线市场，不从远程下载第三方角色包。

## 7. Role 与 Agent Instance

Role Package 是可复用模板；Agent Instance 是已安装 Role Agent 在 OpenClaw 中的注册实例。两者不能混为同一 State。

一个多 Agent Role 会为每个 Role Agent 分别注册 Agent Instance。Instance 保存 Role 映射、独立 workspacePath、独立 agentDir 和注册状态。

Agent Instance 支持：

- list / inspect
- register
- reconcile
- registered / missing / drifted 状态

当前不提供安全无损 disable 或 delete。不得使用 `agents delete`、unbind 或直接修改 `openclaw.json` 冒充停用。

## 8. Team、Project、Task 与 Execution

### Team

Team 保存 Manager 和成员 Instance ID、executionMode 与 maxConcurrency。健康状态根据当前 Instance State 动态计算为 ready、degraded 或 invalid。

### Project

Project 绑定一个 Team，并保存创建时的安全 Team 快照。Team 后续变化不会自动改写 Project；同步必须先预览差异再显式确认。

### Task

Task 属于一个 Project，支持依赖、分配、关键任务和有限生命周期。持久状态目前是 pending、completed、cancelled；blocked 等信息动态计算。

### Execution

Task Execution 采用显式确认和前台串行执行。Run State 只保存安全摘要。当前不支持后台调度、远端 cancel、pause、checkpoint resume、并行 Agent 调用或 Agent-to-Agent 调度。

## 9. Conversation Core

Conversation Core 支持用户与单个 registered Agent Instance 的前台串行多轮对话：

- Conversation State 与 Message State 分离；
- 一个 Conversation 固定复用一个 Session Key；
- 每轮 OpenClaw Run ID 独立；
- User/Assistant Message 成对并保持 sequence；
- 支持 list、inspect、create、send、messages、archive、reconcile；
- 支持跨进程锁、崩溃恢复和分页读取；
- 消息落盘前经过长度限制、结构 ID 校验和敏感信息清理。

当前不支持 Team 群聊、流式输出、附件、编辑、撤回、删除、Memory 或 RAG。

## 10. Chat GUI

整合分支中的聊天中心通过 `conversationService` 调用真实 Conversation Core，而不是用 Execution 模拟聊天。

GUI 支持：

- 列出现有 active Conversation；
- 为可用 Agent Instance 新建聊天；
- 打开历史 Conversation；
- 单 Agent 消息发送；
- Renderer 内存中的乐观 User 气泡和“正在输入”状态；
- 成功后以真实 Message State 历史替换临时消息；
- 失败后重新读取真实历史，不生成假 Assistant 回复。

临时 UI 消息不写入 State，也不伪造 messageId、sequence、Session ID 或 Run ID。

## 11. 锁、Lease 与并发

- Conversation State 和 Message State 使用 read-latest 写锁，避免 lost update。
- send、archive、reconcile 对同一 Conversation 使用统一 operation lock。
- Conversation 与 Execution 共用全局 Agent-call lease：

  ```text
  ~/.openclaw-installer/openclaw-agent/active.lock
  ```

- 文件 Lease 使用 `open(..., "wx")` 原子创建。
- mutation guard 带唯一 guardId、PID 和 createdAt；死 PID 可恢复，活跃 PID 不因超龄被删除。
- release 与 stale clear 在 guard 内重新读取并核对完整持有者身份，避免旧进程删除新 Lease。
- Execution reconcile 可以独立清理明确 stale 的共享 Agent-call lease，但不能删除活跃 Conversation lease。

## 12. 安全边界

- 不保存或记录 API Key。
- 诊断日志对主目录、凭据、Token、Cookie 和私钥脱敏。
- Conversation 会完整清理 PEM 私钥、多词/多行内部字段、对象和数组载荷。
- 结构 ID 拒绝 POSIX、Windows、UNC、设备路径和路径穿越形式。
- State、Adapter、Manager、Presenter 与 CLI 都有安全错误边界。
- GUI Service 只返回安全 DTO，不返回 workspacePath、agentDir、State Path、stack 或原始 Error。
- OpenClaw Adapter 不暴露完整 Prompt、stdout、stderr、usage、provider、model 或内部 meta。
- 完全重置只接受 Main 进程生成的固定目标，不接受 Renderer 路径；只允许当前 HOME
  或 App 精确临时目录内的目标，保留 App 本体、受管 npm 根目录、其他 npm 包和外部安装。

## 13. macOS 打包

打包入口：

```bash
npm run pack:mac -- --arm64
npm run dist:mac -- --arm64
```

`scripts/buildMac.js` 在临时输出目录运行 electron-builder，校验 `.app` 签名结构，移除会破坏签名的扩展属性，再原子替换 `dist/`。

当前 `package.json` 使用 ad-hoc 签名配置（`identity: "-"`）并关闭 hardened runtime。该配置适合本地测试构建，不等于 Apple Developer ID 签名和公证。

## 14. 主要目录

| 路径 | 职责 |
| --- | --- |
| `bin/cli.js` | CLI 可执行入口 |
| `src/cli/` | Parser、Dispatcher、Presenter |
| `src/core/doctor/` | 环境和 OpenClaw 状态检测 |
| `src/core/workflow/` | GUI 安装 workflow |
| `src/core/roles/` | Role Package 扫描、校验、安装和 State |
| `src/core/agent-instances/` | Agent Instance 注册、核对和 State |
| `src/core/teams/` | Team 管理和动态健康 |
| `src/core/projects/` | Project 与 Team 快照 |
| `src/core/tasks/` | Task、依赖和分配 |
| `src/core/executions/` | Task Execution、Run State 与 Adapter |
| `src/core/conversations/` | Conversation、Message、锁、安全和 Adapter |
| `src/core/openclaw-agent/` | 共享 Agent-call lease |
| `src/gui/` | Electron Main、Preload、Services 和 Renderer |
| `src/utils/shell/` | 安全命令执行和 PATH |
| `roles/` | 内置离线角色包 |
| `tests/` | Node 自动化、隔离和跨进程测试 |
| `scripts/buildMac.js` | macOS 构建流水线 |

## 15. 测试体系

测试使用 `node --test`，主要包括：

- State 初始化、schema、白名单、权限、原子写入和损坏保护；
- Manager 生命周期、幂等、回滚和跨阶段约束；
- Mock OpenClaw Adapter；
- 临时 HOME、临时 State、workspace 和 agentDir；
- 独立 Node 子进程并发与崩溃恢复；
- CLI 参数、退出码和 Presenter；
- GUI Service 安全 DTO；
- Renderer/Preload/Main 静态契约验收；
- 安装 workflow 和诊断日志；
- 少量受控真实 OpenClaw 与打包验收记录，不能用 Mock 结果替代。

当前测试数量请读取 `CURRENT_STATUS.md` 并重新运行 `npm test`。

## 16. 已明确边界

- 不修改或接管 main Agent。
- 不复制 API Key 到 Role、Instance、Team、Project、Task、Execution 或 Conversation State。
- 不自动删除未知 OpenClaw Agent。
- 不使用危险删除模拟 disable。
- 不把 `executionMode=auto` 描述成已实现自动调度。
- 不把打包成功描述成新用户安装成功。
- 不把离线 Role Marketplace 描述成在线市场。

## 17. 尚未完成的能力

- 普通用户首次安装的完整稳定验收；
- Apple Developer ID 签名和 notarization；
- Team 群聊和 Team Builder GUI；
- Memory、RAG 和长期知识库；
- 在线角色市场；
- 安全 Agent Instance disable/delete；
- 后台或并行 Execution 调度；
- Conversation 流式输出、附件、编辑、撤回和删除；
- Windows/Linux 正式支持。
