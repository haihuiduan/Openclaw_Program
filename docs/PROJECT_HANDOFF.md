# OpenClaw ToolBox 最新交接

更新时间：2026-08-10

## 项目定位

OpenClaw ToolBox 是面向 macOS 普通用户的 Electron 桌面工具，提供 OpenClaw
安装配置、离线角色市场、Agent Instance 管理和单 Agent Conversation 聊天。

## 当前架构摘要

```text
Renderer
→ Preload 白名单
→ Electron IPC
→ GUI Service
→ src/index.js / Core Manager
→ State 或 OpenClaw Adapter
```

技术栈为 Node.js CommonJS、Electron 43、原生 HTML/CSS/JavaScript、JSON State、
`node:test` 和 electron-builder macOS arm64。长期架构见 `docs/PROJECT_MEMORY.md`。

## 当前分支和 HEAD

```text
worktree: /Users/duanhaihui/Desktop/Openclaw_RoleChat_Integration
branch: feature/role-chat-integration
HEAD: b0c7059a6ca0a22e9045e8f20fcc3ac0d68fab38
upstream: origin/feature/role-chat-integration
工作区: 有未提交的 Installer、Gateway、Dashboard、Reset、Agent Chat、测试和文档修改
暂存区: 空
npm test: 549 通过，0 失败，0 跳过
```

不要 reset、stash、clean 或 checkout 当前未提交内容。

## 已完成模块

- Installer、doctor、configure、verify 和 setup；
- Electron GUI MVP；
- Role Package、Role Lifecycle、离线 Role Marketplace 和 Agent Instance；
- Team、Project / Task、Task Execution Core；
- Conversation Core、聊天中心和真实单 Agent Conversation；
- GUI“恢复首次安装状态”，含双重确认、精确删除 allowlist 和部分失败保护；
- macOS arm64 `.app` / DMG 本地构建流水线。

当前没有 Team 群聊、Memory、RAG、在线角色市场或正式 Apple 公证。

## 当前最高优先级

停止新增功能，完成 `feature/role-chat-integration` 收尾：保持全量回归通过，审查未提交
范围并拆分清晰 commit。当前 Gateway / Dashboard 阻塞问题已经通过真实多用户 macOS
环境验收，不再以 token 重装或重启作为自动恢复策略。

## 当前真实结论

- 同机不同 macOS 用户固定使用 18789 会发生 Gateway 端口冲突；
- ToolBox 使用 Node bind probe 在 `18789–18809` 中选择确认可用的端口；
- `openclawtest2` 实机选择 18790，OpenClaw config、LaunchAgent、Gateway、RPC probe 和
  Dashboard 全链路均使用 18790；
- Dashboard 认证 URL 从 `openclaw dashboard --no-open` 写入的剪贴板中取得，只在 Main /
  Service 内存中使用，经 loopback、端口和认证参数校验后交给 `shell.openExternal`；
- Dashboard 实机可以直接打开并自动认证；
- Agent Chat 已在实机连续发送消息并正常回复；
- 其他用户 Gateway 未被 kill、stop 或修改；
- 当前用户 Reset 后，其他用户继续占用 18789 是正常状态，不应判为清理失败。

## 当前安全边界

- listener 不属于当前用户 managed Gateway 时，在 RPC/auth 前返回端口冲突；
- 18789 明确占用或状态未知时不会回退到 18789；
- 当前 managed Gateway 返回 token mismatch 时只记录脱敏诊断并明确失败，不自动
  `gateway install --force`、restart 或修改 token；
- 快速配置只有在 config port 和 LaunchAgent service port 都等于 selectedPort 时成功；
  service 不存在或无法解析时 fail closed；
- Dashboard authenticated URL、token、API Key、stdout/stderr 原文不进入 Renderer、日志、
  临时文件或异常摘要；
- Reset 只操作当前用户精确 allowlist，不停止其他用户或外部进程。

## 下一步

1. 完成本轮 P1 定向测试、全量测试、全仓语法和 Git 检查；
2. 确认无阻塞后按 Installer/Gateway、GUI Chat/Role、Reset、文档与测试等边界拆分 commit；
3. 提交前再次确认没有 `dist`、DMG、`.app`、`node_modules`、凭据或本机临时文件。

## 尚未验证 / 后续 TODO

- 普通 Terminal 裸 `openclaw` 的 PATH 集成；
- `installerService` 职责拆分；
- 非文本剪贴板内容的完整恢复；
- npm diagnostics 的 HOME 解析统一；
- Apple Developer ID 签名、公证和更广泛干净机器验证；
- Team 群聊、Memory、RAG 和在线市场尚未实现，不属于当前收尾范围。

## 重要文件入口

| 入口 | 职责 |
| --- | --- |
| `src/gui/services/installerService.js` | 快速配置、Gateway readiness 与 Dashboard URL |
| `src/gui/services/gatewayPortService.js` | Gateway 端口检测、选择与 service 端口读取 |
| `src/gui/services/conversationService.js` | GUI 单 Agent Conversation 接入 |
| `src/core/conversations/` | Conversation / Message State、锁、Adapter 和 Manager |
| `src/core/environment-reset/` | 当前用户首次安装状态重置 |
| `src/utils/installDiagnosticLogger.js` | 安装与 Gateway 结构化脱敏诊断 |
| `src/gui/main.js` | IPC、浏览器打开与 App relaunch 边界 |
| `tests/quick-configure.test.js` | 快速配置与端口闭环测试 |
| `tests/dashboard-service.test.js` | Gateway / Dashboard 状态机与认证 URL 测试 |
| `tests/environment-reset.test.js` | Reset allowlist 与跨用户安全测试 |
| `docs/CURRENT_STATUS.md` | 详细当前状态 |
| `docs/KNOWN_ISSUES.md` | 有证据的问题记录 |
