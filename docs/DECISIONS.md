# OpenClaw ToolBox 架构与产品决策

状态说明：

- **已采纳**：当前代码和产品边界正在遵循。
- **待决策**：已有问题或候选实现，但尚未形成正式长期方案。
- **废弃**：不再使用的历史方案。

## DEC-001：桌面技术栈采用 Electron + Node.js

- 日期：2026-07-01
- 状态：已采纳
- 背景：项目已有 Node.js CLI 和 Core，需要为 macOS 普通用户提供桌面入口。
- 决定：使用 Electron 主进程、Preload 和原生 HTML/CSS/JavaScript Renderer。
- 原因：可直接复用 Node.js Core 和系统命令能力，避免再维护另一套语言和业务实现。
- 影响：Renderer 必须通过 contextBridge 和 IPC 访问系统能力；项目暂不引入 React、Vue 或独立 Web 后端。

## DEC-002：第一版正式目标平台为 macOS arm64

- 日期：2026-07-14
- 状态：已采纳
- 背景：当前开发、打包和真实用户测试集中在 Apple Silicon Mac。
- 决定：优先维护 macOS arm64 `.app` 和 DMG 构建。
- 原因：缩小首版兼容范围，优先解决真实安装和分发问题。
- 影响：Windows、Linux 和 Intel macOS 均不是当前发布验收范围。

## DEC-003：CLI、GUI Service 与 Core 分层

- 日期：2026-06-30
- 状态：已采纳
- 背景：相同业务能力需要同时被 CLI、GUI 和测试使用。
- 决定：业务规则进入 Core；`src/index.js` 聚合公共 API；CLI 负责解析和 Presenter；GUI 使用 Renderer、Preload、IPC、Service 分层。
- 原因：避免 GUI 和 CLI 各维护一套生命周期逻辑。
- 影响：Renderer 不得直接读 State、调用 Node.js 或拼接 OpenClaw 命令；Service 只做安全输入和 DTO。

## DEC-004：Role Marketplace 第一版为离线内置市场

- 日期：2026-07-20
- 状态：已采纳
- 背景：需要先验证角色包格式、安装安全和 GUI 体验，不宜立即引入远程供应链。
- 决定：从仓库和打包资源中的 `roles/` 扫描 Role Package。
- 原因：角色包可审查、可测试、可随 App 打包，不依赖在线市场服务。
- 影响：当前只有内置角色；没有远程搜索、下载、签名验证、发布者账号或在线更新。

## DEC-005：Role Package 与 Agent Instance 分离

- 日期：2026-07-20
- 状态：已采纳
- 背景：角色模板、已安装 workspace 和 OpenClaw 注册实体具有不同生命周期。
- 决定：Role State 记录角色安装；Instance State 记录每个 Role Agent 的独立注册实例。
- 原因：避免把模板、文件安装和 OpenClaw Agent 配置混成一个不可恢复状态。
- 影响：多 Agent Role 逐个注册 Instance；每个 Instance 使用独立 workspace 和 agentDir；Role 卸载受 Instance 引用保护。

## DEC-006：不提供伪造的 Agent Instance disable

- 日期：2026-07-20
- 状态：已采纳
- 背景：OpenClaw 没有确认安全的原生 enable/disable，`agents delete` 可能影响 workspace、Session 和 Agent 状态。
- 决定：首版 disable 返回“不支持安全无损停用”，不使用 delete、unbind 或直接编辑 `openclaw.json`。
- 原因：保护用户数据优先于提供表面完整的按钮。
- 影响：已启用 Instance 当前只能查询和 reconcile，不能从 ToolBox 安全停用或删除。

## DEC-007：Project 保存 Team 安全快照

- 日期：2026-07-21
- 状态：已采纳
- 背景：进行中的 Project 不应因 Team 后续成员变化而静默改变执行配置。
- 决定：Project 保存 teamId 和创建时的 Manager、成员、executionMode、maxConcurrency 快照。
- 原因：保证长期 Project 的可解释性和稳定性。
- 影响：Team 更新不会自动改写 Project；同步必须预览差异并显式确认。

## DEC-008：Execution 与 Conversation 共用全局 Agent-call lease

- 日期：2026-07-23，2026-07-29 完善
- 状态：已采纳
- 背景：Task Execution 和 Conversation 都会调用真实 OpenClaw Agent，并发可能造成 Session、状态和资源竞争。
- 决定：两者通过 `src/core/openclaw-agent/agentCallLease.js` 共用全局文件 Lease。
- 原因：在没有可靠并行调度与隔离模型前，前台全局串行最安全。
- 影响：同一时间只允许一个真实 Agent 调用；崩溃后由 reconcile 安全恢复明确 stale 的 Lease。

## DEC-009：单 Agent Chat 优先于 Team 群聊和 Team Builder GUI

- 日期：2026-07-29
- 状态：已采纳
- 背景：Team Builder Core 已存在，但多 Agent 群聊涉及调度、上下文共享和更复杂的失败恢复。
- 决定：先完成单 Agent Conversation Core 和聊天中心 GUI，再评估 Team 群聊与 Team Builder GUI。
- 原因：单 Agent 对话边界清晰，可先验证 Session 连续性、安全 State 和用户体验。
- 影响：当前 Team Core 保留，但不继续扩展 Team 群聊；聊天中心只允许单 registered Agent Instance。

## DEC-010：敏感信息采用多层防御

- 日期：2026-07-29
- 状态：已采纳
- 背景：OpenClaw 输出、用户消息、错误和诊断日志都可能包含凭据、内部路径或原始运行数据。
- 决定：在输入、State、Adapter、Manager、Presenter、GUI DTO 和诊断日志层分别进行校验、白名单和脱敏。
- 原因：任何单层遗漏都不应直接变成用户可见或持久化泄漏。
- 影响：结构 ID 中的危险载荷直接拒绝；可见文本清理敏感字段；Adapter 不返回完整 stdout/stderr/JSON。

## DEC-011：正式发布需要 Apple Developer 签名与公证

- 日期：2026-07-30
- 状态：已采纳，尚未执行
- 背景：当前 ad-hoc 签名可以验证 App bundle 内部一致性，但不能建立 Apple 信任链。
- 决定：面向普通外部用户的正式版本必须使用 Apple Developer ID Application 签名并完成 notarization。
- 原因：降低 Gatekeeper “已损坏”或“无法验证开发者”提示和用户手动绕过成本。
- 影响：当前本地测试 DMG 不能等同于正式可分发版本；发布流程需要证书、Apple 账号和公证凭据。

## DEC-012：普通用户 npm global prefix 修复策略

- 日期：2026-07-30
- 状态：已决定，真实普通用户安装验收通过
- 背景：普通用户 prefix 为 `/usr/local` 且不可写，官方脚本执行 `npm install -g` 失败；上一版环境检查还可能被旧 checkpoint 跳过，且修改后的 PATH 没有作为同一环境明确传给官方脚本。
- 决定：工具箱统一使用当前用户的 `~/.npm-global` 作为受管 npm prefix。每次安装和重试都强制执行 Bootstrap，创建受管目录，并通过进程级 `NPM_CONFIG_PREFIX` 与以 `~/.npm-global/bin` 开头的 PATH 向安装、验证及后续工具箱命令传递同一环境。旧 checkpoint 不得跳过 Bootstrap，也不得保存或复用 PATH。
- 原因：进程级环境对 Finder 启动的 Electron 立即生效，不依赖终端配置、不同 npm 二进制的用户配置或 `npm config set prefix`；同时不需要 sudo，也不修改系统目录权限。
- 影响：所有通过公共 Shell 工具启动的 OpenClaw 检测和 Adapter 调用都会优先识别受管目录。旧 checkpoint 仍可恢复非环境进度，但会先重新运行环境准备。真实普通用户已完成安装、重启后的 Gateway / Dashboard 和 Agent Chat 验收；Terminal 裸 `openclaw` 的 PATH 集成仍是独立 TODO。

## DEC-013：是否在 App 内置 Node.js/npm

- 日期：2026-07-30
- 状态：待决策
- 背景：当前工具依赖系统可用的 Node.js、npm 和 Git；不同安装来源会产生不同 prefix 与 PATH。
- 决定：尚未决定是否随 App 提供受管 Node.js/npm。
- 原因：内置运行时可提高一致性，但会增加包体、升级、安全维护和许可成本。
- 影响：当前继续检测系统运行时；不得声称工具可以在完全没有 Node/npm 的机器上自动安装。

## DEC-014：是否继续长期依赖官方 install.sh

- 日期：2026-07-30
- 状态：待决策
- 背景：当前安装流程下载并执行 OpenClaw 官方 `install.sh`，实际 npm 命令和临时日志生命周期由官方脚本控制。
- 决定：当前版本继续调用官方脚本；长期是否保留尚未决定。
- 原因：官方脚本减少自建安装逻辑，但也降低对 npm 参数、日志和权限修复时机的控制。
- 影响：当前修复不得静默改写官方脚本；完成诊断与普通用户验证后再评估替代方案。

## DEC-015：首次安装状态恢复采用单一完全重置等级

- 日期：2026-07-31
- 状态：已采纳，真实重置与重新安装链路已验收
- 背景：普通用户和开发测试人员需要无需终端即可回到首次安装状态；该操作涉及凭据、Gateway、Agent、角色和聊天等跨模块数据。
- 决定：设置页只提供一个完全重置等级，必须双重确认。Renderer 不传路径，Main 调用独立 Core 服务按固定 allowlist 清理当前用户数据；全部成功才自动 relaunch，部分失败或外部安装均不重启、不宣称成功。
- 原因：单一、明确且保守的边界比多档不完整清理更容易理解和验证，也能避免误删系统级安装、其他 npm 包或用户项目。
- 影响：不生成备份、不使用 sudo、不新增 CLI 命令；App 本体、`~/.npm-global` 根目录、其他 npm 包和外部 OpenClaw 安装保留。该破坏性功能发布前必须在专用测试用户中完成真实 GUI 验收。
