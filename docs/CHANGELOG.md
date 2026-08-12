# OpenClaw ToolBox 阶段变更记录

本文记录功能阶段、架构变化、重要问题定位、测试基线和打包能力变化。小型样式调整和逐行实现细节不在此记录。

## 2026-08-10

### 未发布：Gateway / Dashboard 真实验收与提交前收口

- 真实多用户 macOS 回归确认 `openclawtest2` 在 18789 被另一用户占用时自动选择 18790；
- config、LaunchAgent、Gateway、RPC probe 和 Dashboard 全链路使用同一端口；
- Dashboard 通过剪贴板 authenticated URL 直接打开并自动认证，Agent Chat 连续对话正常；
- 其他用户 Gateway 未被 kill、stop 或修改，当前 Gateway / Dashboard 阻塞问题关闭；
- 快速配置错误摘要改为统一诊断脱敏后再截断；
- 删除 token mismatch 的 `gateway install --force` / restart 自动修复，认证失败改为安全
  诊断和明确失败；
- onboarding 后的 LaunchAgent 端口验证改为 fail closed，service 不存在或不可解析不再
  被当作成功；完整测试为 549 通过、0 失败、0 跳过。

### 未发布：多用户 Gateway 端口隔离

- 真实多用户验收确认 18789 listener 属于另一用户，token mismatch 是连接到错误
  Gateway 的二级症状；
- Dashboard 在 RPC 和认证修复前核对当前用户 LaunchAgent PID 与 listener PID；
- listener 归属冲突时不执行 start、restart 或 token repair，也不操作其他用户进程；
- 首次快速配置使用 OpenClaw 官方 `--gateway-port`，在受控范围 `18789–18809` 中选择
  可用端口并保持 config/service/probe/dashboard 一致；
- 环境重置按当前用户 managed PID 验证清理结果，保留其他用户 listener 不再误报失败。
- 真实复验发现普通用户 `lsof` 无法看到跨用户 listener；端口可用性改由 Node 临时 bind
  判定，`EADDRINUSE` 跳过候选，UNKNOWN fail closed；onboarding 后复核 config/service
  端口，全部候选不可用时不执行 onboarding。

### 未发布：Dashboard 剪贴板认证 URL

- 真实验证确认 OpenClaw `2026.7.1-2` 的 `dashboard --no-open` 只把基础 URL 写入
  stdout，完整 token-authenticated URL 写入剪贴板；
- Dashboard Service 改为暂存并恢复用户剪贴板，只打开经过 loopback、配置端口和认证
  参数校验的剪贴板 URL，不再把 stdout 基础 URL 当作最终地址；
- 认证 URL 不可用时返回 `DASHBOARD_AUTH_URL_UNAVAILABLE`，URL/token 不进入日志、
  Renderer、argv、env 或临时文件；完整测试提升到 548 通过。

### 未发布：运行中 Gateway token mismatch 诊断边界

- 真实日志确认 Gateway service 已运行且 health 正常，但 RPC 因 token mismatch 失败；
- Dashboard 状态机开始解析 runtime/service/health/RPC，不再把所有非零状态当作未运行；
- 运行中认证失败不会再次 start；最终收口后也不再自动强制安装、restart 或修改 token；
- OpenClaw 子进程不再继承 Electron 中可能过期的 Gateway token 环境覆盖；
- 增加贯穿安装、快速配置、Gateway 和 Dashboard 的诊断运行 ID 与 T0–T9 Auth
  Snapshot；使用单次随机盐 HMAC 短指纹比较 token，不保存 secret 或 salt；
- 命令层记录最终 spawn 环境存在性，根因摘要区分 token 时间线、配置路径、SecretRef、
  service metadata 和 listener；
- 静态确认 `2026.7.1-2` 的 runtime/CLI credential precedence 不同，且 service token
  缺失可为正常状态；完整测试提升到 518 通过。

## 2026-07-31

### 未发布：Gateway 显式启动与重置幂等判定

- 真实日志确认 `dashboard --yes --no-open` 退出 0 后 Gateway RPC 仍未 ready；
- Dashboard 链路改为显式 `gateway start`，仅在 service 明确未安装时
  `gateway install` 后重试，RPC ready 后才解析 URL 和打开浏览器；
- Gateway lifecycle、readiness 和 Dashboard resolver 统一 executable 与命令环境；
- 增加脱敏启动输出、耗时、readiness 失败分类和浏览器打开结果诊断；
- Reset 改为复核 launchd service、精确 plist 和 18789 listener 的最终状态，服务
  原本不存在时不再因中间命令非零误报；
- Dashboard、Reset 与 Renderer 定向测试 90 通过，完整测试提升到 510 通过。

### 未发布：恢复首次安装状态

- 设置页新增 GUI 专用完全重置入口，并要求两次明确确认。
- 新增精确删除 allowlist、HOME/临时目录边界、realpath/lstat 与符号链接保护。
- 只删除当前用户 OpenClaw、ToolBox 数据和受管 npm 中的 OpenClaw；保留 App、
  prefix 根目录、其他 npm 包和外部安装。
- 外部安装或任一步失败返回部分完成且不重启；全部成功才 relaunch。
- 新增临时 HOME 隔离测试，完整自动化测试提升到 506 通过。

## 2026-07-30

### 未发布：项目记忆体系

- 新增根目录 `AGENTS.md`，规定任务开始检查、代码事实核验和任务结束文档同步。
- 新增长期架构、当前状态、决策、已知问题、阶段变更和新会话交接文档。
- 明确 `CURRENT_STATUS.md` 是当前状态快照，`PROJECT_HANDOFF.md` 是新会话入口。
- 为旧 GUI 方案和手动清单增加历史/使用范围提示。
- 本组文档当前等待用户审查，尚未提交。

### 未发布：首次安装诊断与可靠 npm Bootstrap

- 增强 GUI 安装 workflow 的结构化进度、失败步骤和错误码。
- 新增脱敏安装诊断日志 `openclaw-install-debug.log`。
- 增强官方安装脚本失败后的 stdout/stderr、npm installer/debug log 和环境诊断。
- 真实定位普通用户首次安装失败根因：npm global prefix 为不可写 `/usr/local`，`npm install -g openclaw@latest` 返回 EACCES。
- 最新真实 DMG 验证发现旧 checkpoint 可跳过环境检查，且上一版 prefix/PATH 没有作为显式环境传给官方安装脚本。
- 每次安装和重试现在都会强制运行 npm Bootstrap，统一使用 `~/.npm-global`，并通过 `NPM_CONFIG_PREFIX` 和 PATH 将同一环境传给安装、验证与后续命令。
- checkpoint 增加 schema/environment version，不保存或复用过期 PATH。
- 完整自动化测试基线提升到 451 通过、0 失败、0 跳过。
- 从当前未提交工作区重新生成 arm64 诊断 DMG；DMG 完整性、DMG 内 App 严格签名、
  arm64 架构和 `app.asar` 中的 npm prefix 修复内容均已验证。
- 上述 DMG 早于最新 Bootstrap/checkpoint 修复，不能用于证明修复有效；新实现仍在工作区，尚未提交、重新打包或完成真实普通用户复验。

### 未发布：DeepSeek 无 TTY 快速配置兼容

- 最新真实 DMG 已成功安装 OpenClaw `2026.7.1-2`，首次安装权限问题不再是本轮失败点。
- 确认 DeepSeek 快速配置由 GUI Service 直接调用，不属于安装 workflow。
- 将 onboarding 参数收敛为官方 non-interactive/headless 契约，移除不兼容的
  `--skip-hooks` 和 `--default-model`。
- 明确模型选择改用官方 `openclaw models set <model>`。
- DeepSeek 模型选项更新到 V4 Pro 和 V4 Flash。
- 新增快速配置 Service 和 Renderer 回归测试，完整测试提升到 461 通过。
- 尚未执行真实 OpenClaw 配置，仍需重新打包和普通用户复验。

### 未发布：Dashboard 打开与 Agent JSON 兼容

- 修复 Dashboard 仅启动分离 CLI、Electron Main 未显式打开浏览器的问题；
- 先准备 Gateway，再从 `dashboard --json` 读取并校验本机 loopback URL，最后交给
  `shell.openExternal`；
- Execution Adapter 同时兼容当前顶层 `payloads` / `meta.agentMeta` 和旧嵌套
  `result.payloads` / `result.meta.agentMeta`；
- 新增 Agent 命令、退出状态和 JSON 结构的安全诊断，不记录 Prompt、Session Key、
  API Key 或原始 stdout/stderr；
- Dashboard、Adapter、Conversation、Renderer 定向测试 121 通过，完整测试提升到
  468 通过；
- 真实日志确认 `dashboard --json` 退出码为 1，但原 Dashboard 事件没有保存已捕获的
  stderr；新增脱敏 stderr 摘要、stdout/JSON 状态和固定长度截断，命令与业务流程
  保持不变；
- 真实 stderr 进一步确认 OpenClaw `2026.7.1-2` 不支持 `dashboard --json`；
- Dashboard resolver 新增 `dashboard --help` capability detection：支持时保留
  JSON 解析，不支持时从官方 `--no-open` 文本输出提取并校验 loopback URL；
- 完整测试提升到 473 通过；
- 尚未重新打包或在普通用户中复验，未执行真实 OpenClaw 命令。

### 未发布：首次 Gateway local mode 初始化

- 修复新用户配置缺少 `gateway.mode` 时 Dashboard 启动被 OpenClaw 阻止的问题；
- Dashboard 打开前增加 `gateway status --json --require-rpc` 只读检查；
- 仅在 `gateway.mode` 明确缺失时执行单键 `config set gateway.mode local`，不重跑
  onboard，不覆盖 API Key、workspace、Agent 或 remote 配置；
- Gateway 启动后轮询 RPC readiness，ready 前不把 Dashboard URL 交给浏览器；
- 新增缺 mode、已有 local、已运行、remote 和未 ready 场景测试；
- 完整测试提升到 494 通过，尚未重新打包或真实复验。

### 未发布：OpenClaw executable 严格状态检测

- 确认 Electron 会将 `~/.npm-global/bin` 注入自身 PATH，而 Terminal 不会自动继承，
  因此两边的 `which openclaw` 结果可能不同；
- 修复仅凭 `which` 成功就报告已安装的误判；
- GUI、doctor、verify、安装跳过判断和安装后验证现在都要求解析到实际 binary，并用
  该绝对路径成功执行 `openclaw --version`；
- 新增全新临时 HOME、缺失 executable、不可执行、timeout、spawn failure 和
  Electron/Terminal PATH 差异测试；
- 完整测试提升到 481 通过。

### macOS 打包流水线

- 提交 `2070f43`：修复 unsigned packaging 配置。
- 提交 `b0c7059`：修复 macOS App 签名流水线，增加临时输出、扩展属性处理和 codesign 校验。
- 未提交修复：构建时对临时与最终 App 使用 `xattr -cr`，在发布前后分别验证
  codesign/DMG，并确保最终解包 App 验签失败时不删除已验证 DMG。
- 新增 4 项构建顺序和失败处理测试，完整自动化测试基线提升到 455 通过。
- 最新 arm64 DMG 已生成并通过 `hdiutil verify`，SHA-256 为
  `881be8061909509052e8faaf4936c08f38ede790b06b7426e56e75a7e786a8c3`。
- 当前仍是本地测试用 ad-hoc 签名，不包含 Apple Developer ID 公证。

### 角色市场与聊天整合

- 提交 `4b47c2e`：完成角色市场、聊天中心和单 Agent Chat 预览整合。
- GUI 支持离线角色展示、安装、Agent Instance 启用、聊天列表、新建/打开 Conversation 和真实消息发送。
- Renderer 使用乐观 User 消息，成功后由真实历史替换，不伪造 Assistant 回复。

## 2026-07-29

### Phase 7：Conversation Core

- 提交 `c35a1d5`：完成 Conversation Core。
- 新增 Conversation State、Message State、单 Agent 多轮 Session、Adapter、CLI 和公共 API。
- Conversation 与 Execution 共用全局 Agent-call lease。
- 完成跨进程锁、mutation guard 崩溃恢复、活跃 Lease 保护、安全错误和敏感信息清理。
- 阶段最终自动化测试基线：348 通过、0 失败、0 跳过。

### Role Marketplace GUI

- `11a0ba3`：角色市场预览。
- `442dc39`：真实 Role 安装。
- `53154db`：已安装角色启用并注册 Agent Instance。
- `836ed18`：我的角色和单 Agent Chat 预览页面。
- `eea5ea5`：在整合分支合并 Conversation Core。

## 2026-07-23

### Phase 6：Task Execution Core

- 提交 `4933c31`：实现 Task Execution Core。
- 支持 Run State、显式 run-task、retry、reconcile、Prompt Builder 和 OpenClaw Execution Adapter。
- 修复真实 OpenClaw JSON 解析、安全 outputSummary、Session Key 注入、Lease `createdAt` 和原始输出泄漏边界。
- 阶段最终自动化测试基线：252 通过、0 失败、0 跳过。
- 合并提交 `7c09140` 进入 main。

## 2026-07-21

### Phase 5：Project / Task Core

- 提交 `eed7c90`：实现 Project 与 Task Core。
- Project 保存 Team 安全快照并支持显式同步。
- Task 支持依赖、分配、关键标记和有限状态。
- 修复 Task 分配时对 Instance 当前 registered 状态的校验。
- 阶段最终自动化测试基线：209 通过、0 失败、0 跳过。

### Phase 4：Team Builder Core

- 提交 `def3a44`：实现 Agent Team Builder 基础管理能力。
- 支持 Team、Manager、成员、执行偏好和动态健康状态。
- 阶段最终自动化测试基线：182 通过、0 失败、0 跳过。

## 2026-07-20

### Phase 3：Agent Instance Manager

- 提交 `4cb8a2b`：实现 Agent Instance 注册和状态核对。
- 提交 `3988e93`：完善 Role 卸载被 Instance 引用时的安全提示。
- 支持 list、inspect、register、reconcile 和漂移检测。
- 明确不使用危险 delete/unbind 模拟 disable。
- 阶段最终自动化测试基线：160 通过、0 失败、0 跳过。

### Phase 1–2：Role Package 与 Role Lifecycle

- 提交 `bfaf1e7`：完成本地角色包和生命周期管理。
- 支持角色扫描、校验、安装、幂等、卸载、回滚和状态保护。
- 建立内置 `cross-border-team` 三 Agent 角色包。
- 阶段最终自动化测试基线：129 通过、0 失败、0 跳过。

## 2026-06-30 至 2026-07-15

### Installer、CLI 与 Electron GUI MVP

- 建立 OpenClaw 安装、doctor、configure、verify 和 setup CLI。
- 增加安装日志、dry-run、中文 Presenter 和错误处理。
- 建立 Electron GUI、首次使用向导、API Key 配置入口、Dashboard 控制、版本检查和问题排查。
- 增加 macOS Electron 最小打包能力和 macOS PATH 规范化。
- 明确不保存、展示或记录 API Key。
