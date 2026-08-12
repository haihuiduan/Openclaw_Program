# OpenClaw ToolBox 当前状态

更新时间：2026-08-10（Australia/Sydney）

## Git 状态

```text
worktree: /Users/duanhaihui/Desktop/Openclaw_RoleChat_Integration
branch: feature/role-chat-integration
HEAD: b0c7059a6ca0a22e9045e8f20fcc3ac0d68fab38
upstream: origin/feature/role-chat-integration
暂存区: 空
工作区: 有未提交修改
```

HEAD 与远程分支当前指向同一提交；下面的安装诊断、强制 npm Bootstrap 和 checkpoint 修复尚未提交，因此不能把 HEAD 描述为包含这些改动。

## 测试状态

最近一次完整执行：

```text
命令: npm test
通过: 487
失败: 0
跳过: 0
日期: 2026-07-30
```

最新一次完整执行：

```text
命令: npm test
通过: 549
失败: 0
跳过: 0
日期: 2026-08-10
```

同次检查还包括：

- `src/`、`tests/`、`bin/` 全部 JavaScript 文件 `node --check` 通过；
- `git diff --check` 通过；
- `git diff --cached --check` 通过；
- 测试使用 Mock 和临时目录，没有执行真实 OpenClaw 安装。

最新真实验证确认 OpenClaw `2026.7.1-2` 的 `dashboard --no-open` 仅在 stdout
输出基础 loopback URL，带 Gateway token 的认证 URL 写入系统剪贴板。当前未提交修复在
执行命令前暂存剪贴板、命令后只从剪贴板读取并校验认证 URL，交给 Main 进程打开后
尽力恢复用户原剪贴板；stdout 只用于 host/port 一致性校验。认证 URL 不可用时返回
`DASHBOARD_AUTH_URL_UNAVAILABLE`，不会打开已知缺少认证信息的基础页面。

最新真实多用户 macOS 回归已通过：`openclawtest2` 在另一用户占用 18789 时自动选择
18790，config、LaunchAgent、Gateway、RPC probe 与 Dashboard 使用同一端口；Dashboard
可直接打开并自动认证，Agent Chat 可连续发送和接收回复，其他用户 Gateway 未被停止或
修改。当前 Gateway / Dashboard 阻塞问题已关闭。

## 最新诊断测试包

2026-07-30 使用当前未提交工作区重新生成 macOS arm64 诊断测试版：

```text
命令: npm run dist:mac -- --arm64
App: dist/mac-arm64/OpenClaw 工具箱.app
DMG: dist/OpenClaw 工具箱-0.1.0-arm64.dmg
DMG 大小: 118746769 bytes
DMG SHA-256: 881be8061909509052e8faaf4936c08f38ede790b06b7426e56e75a7e786a8c3
DMG 修改时间: 2026-07-30 05:05:10 +0800
```

验证结果：

- electron-builder 在系统临时目录成功生成 arm64 App 和 DMG；
- 临时 App 在清除扩展属性后通过严格 codesign；
- 临时和最终 DMG 均通过 `hdiutil verify`；
- 最终 DMG 已保留在 `dist`；
- 主可执行文件为 Mach-O arm64；
- 未启动 Electron，未执行真实 OpenClaw 安装。

`scripts/buildMac.js` 现在按“临时 App 清理/验签 → 临时 DMG 验证 → 发布 →
最终 App 清理/验签 → 最终 DMG 验证”执行，并且最终解包 App 验签失败时不会删除
已经验证并发布的 DMG。

当前仓库位于 Desktop 文件提供程序管理目录。该服务会在脚本退出后再次给解包 App
及嵌套 Helper/Framework 附加 `com.apple.FinderInfo` 和
`com.apple.fileprovider.fpfs#P`，因此脱离脚本稍后检查解包副本前仍需由构建流程重新
清除扩展属性。DMG 内 App 不受此后续重附加影响，分发判断以验证通过的 DMG 为准。

## 上一版诊断测试包

2026-07-30 从当前未提交工作区重新生成 macOS arm64 诊断测试版：

```text
命令: npm run dist:mac -- --arm64
App: dist/mac-arm64/OpenClaw 工具箱.app
DMG: dist/OpenClaw 工具箱-0.1.0-arm64.dmg
DMG 大小: 118745826 bytes
DMG SHA-256: d48593c702fea6ba68538b01bcf7591f48977d24812e6f42c8b7b821ef878d75
DMG 修改时间: 2026-07-30 04:31:13 +0800
```

验证结果：

- DMG `hdiutil verify` 通过；
- DMG 内 App `codesign --verify --deep --strict` 通过；
- DMG 内主可执行文件为 arm64；
- `app.asar` 包含 `src/core/workflow/npmPrefix.js`、`.npm-global` 和
  `npm config set prefix` 实现；
- 项目记忆 Markdown 未进入 `app.asar`，符合当前 `electron-builder`
  仅打包 `src/**/*`、`roles/**/*` 和 `package.json` 的配置；
- 未启动 Electron，未执行真实 OpenClaw 安装。

随后在新建普通用户中的真实安装仍然失败。该 DMG 早于当前强制 Bootstrap、
显式 `NPM_CONFIG_PREFIX` 和 checkpoint 修复，不能作为当前代码的有效验收包。

`dist/mac-arm64` 的解包 App 位于桌面文件提供程序管理目录，构建结束后被系统重新附加
`com.apple.FinderInfo`，因此对该解包副本再次执行严格 codesign 会失败；实际 DMG 内
App 不带该异常属性且签名验证通过。正式交付判断应以 DMG 内 App 为准。

## 已完成并进入当前整合分支的能力

| 阶段/模块 | 状态 |
| --- | --- |
| CLI 安装、配置、验证和 setup | 已实现 |
| Electron GUI MVP | 已实现 |
| Phase 1 Role Package | 已完成 |
| Phase 2 Role Lifecycle | 已完成 |
| Phase 3 Agent Instance Manager | 已完成 |
| Phase 4 Team Builder Core | 已完成 |
| Phase 5 Project / Task Core | 已完成 |
| Phase 6 Task Execution Core | 已完成并合入 main 基线 |
| Phase 7 Conversation Core | 已完成并合入当前整合分支 |
| 离线 Role Marketplace GUI | 已完成 |
| Role 安装和 Agent Instance 启用 GUI | 已完成 |
| 聊天中心与单 Agent Chat GUI | 已接入真实 Conversation Core |
| macOS arm64 `.app` / DMG 本地构建 | 已实现构建流水线 |

这里的“完成”指代码、自动化测试和已有验收通过，不代表已经完成正式发布、Apple 公证或大量新用户安装验证。

## 当前最高优先级

停止新增功能，完成当前未提交修改的全量回归、范围审查和 commit 拆分准备。

当前不要继续开发 Team Builder GUI、Team 群聊、Memory、RAG 或在线角色市场。

## 当前安装问题的真实证据

普通用户测试账号：

```text
npm config get prefix
→ /usr/local
```

目录权限：

```text
/usr/local
→ root:wheel
```

官方安装脚本内部执行：

```text
npm install -g openclaw@latest
```

失败：

```text
EACCES permission denied
目标路径: /usr/local/lib/node_modules/openclaw
```

开发用户环境：

```text
node: /opt/homebrew/bin/node
npm prefix: /opt/homebrew
/opt/homebrew 所有者: 当前开发用户
```

已确认调用链：

```text
GUI 准备 OpenClaw
→ workflow environment_check
→ download_script
→ execute_script
→ OpenClaw 官方 install.sh
→ npm install -g openclaw@latest
→ EACCES
```

结论：

> 当前首次安装失败的真实原因是普通用户无法写入 npm global prefix。现有证据不支持把根因归因于 Electron PATH、bash、脚本下载、npm registry 或 Node.js 版本。

最新真实日志进一步确认，Electron 虽能解析
`/opt/homebrew/bin/node` 和 `/opt/homebrew/bin/npm`，但没有出现 Bootstrap 事件；
旧 checkpoint 可以直接恢复到 `execute_script` 并跳过 `environment_check`，上一版
prefix/PATH 也没有作为包含 `NPM_CONFIG_PREFIX` 的显式环境传给官方脚本。

最新真实 DMG 复验已确认 OpenClaw 成功安装为 `2026.7.1-2`，说明强制 npm
Bootstrap 已进入真实安装链路。随后快速配置 DeepSeek 失败；官方安装脚本输出的
`No TTY; run openclaw onboard to finish setup` 是安装完成后的提示，不是 GUI 快速配置
调用了交互式命令。

## 当前未提交改动

当前工作区存在三组相关改动。

### A. 安装诊断增强

涉及：

- `src/utils/installDiagnosticLogger.js`
- `src/utils/shell/index.js`
- doctor 检查
- installer 与 workflow 多个步骤
- `src/gui/main.js`
- `src/gui/services/installerService.js`
- `src/gui/renderer/renderer.js`
- 对应诊断和 Renderer 测试

目标：

- 结构化安装错误码；
- 安装进度事件；
- 记录失败步骤；
- 捕获官方脚本 stdout/stderr；
- 读取 npm installer/debug log；
- installer log 消失时记录 npm/node/prefix/registry 环境；
- 日志脱敏并避免 GUI 展示完整 npm 日志。

### B. 强制 npm Bootstrap 与 checkpoint 修复

涉及：

- `src/core/workflow/npmPrefix.js`
- `src/core/workflow/engine.js`
- `src/core/workflow/runtime.js`
- `src/core/workflow/steps/environment_check.js`
- `src/core/workflow/steps/check_existing_install.js`
- `src/core/workflow/steps/execute_script.js`
- `src/core/workflow/steps/verify_installation.js`
- `src/utils/shell/env.js`
- `src/utils/shell/index.js`
- doctor 的命令环境传递
- `tests/install-bootstrap.test.js`
- `tests/npm-prefix.test.js`
- `tests/shell.test.js`

当前行为：

1. 每次安装和重试都强制运行 Bootstrap，旧 checkpoint 不能跳过；
2. 使用实际解析到的 npm 检测原始 prefix；
3. 幂等创建当前用户拥有、权限为 `0700` 的 `~/.npm-global` 和 `bin`；
4. 构造 `NPM_CONFIG_PREFIX=~/.npm-global`；
5. 把 `~/.npm-global/bin` 放到工具箱 PATH 首位；
6. 将同一显式环境传给 doctor、官方脚本、安装验证和公共 Shell 命令；
7. checkpoint 增加 schema/environment version，不保存或复用 PATH；
8. 不依赖 `npm config set prefix` 让本次 GUI 安装生效。

该修复已有 451 项 Mock/自动化测试，但尚未重新打包，也尚未在全新普通 macOS
用户中完成真实安装复验。

### C. 项目记忆文档

本轮新增：

- `AGENTS.md`
- `docs/PROJECT_MEMORY.md`
- `docs/CURRENT_STATUS.md`
- `docs/DECISIONS.md`
- `docs/KNOWN_ISSUES.md`
- `docs/CHANGELOG.md`
- `docs/PROJECT_HANDOFF.md`

项目记忆读取规则已优化：

- 每次任务默认只读取 `AGENTS.md`、`PROJECT_HANDOFF.md`、Git 状态及任务相关代码和测试；
- 架构、决策、Bug、状态和历史文档改为按任务类型查询相关章节；
- 优先用关键词和章节范围检索，避免无条件全文读取长期文档；
- `PROJECT_HANDOFF.md` 已压缩为最小当前快照；
- 长期文档仅在对应事实发生变化时更新。

### D. 快速配置无 TTY 兼容修复

涉及：

- `src/gui/services/installerService.js`
- `src/gui/renderer/renderer.js`
- `tests/quick-configure.test.js`
- `tests/renderer-acceptance.test.js`

当前行为：

1. DeepSeek 快速配置仍由 `installerService.runQuickConfigure()` 发起，不属于安装
   workflow；
2. `openclaw onboard` 明确使用 `--non-interactive --accept-risk --mode local`；
3. 增加明确的 plaintext secret 输入模式、loopback Gateway、Node daemon 和
   `--skip-health`；
4. 移除当前官方 onboarding 契约外的 `--skip-hooks` 和 `--default-model`；
5. 用户明确选择模型时，在 onboarding 成功后单独调用官方
   `openclaw models set <model>`；
6. DeepSeek 模型列表更新为 `deepseek/deepseek-v4-pro` 和
   `deepseek/deepseek-v4-flash`。

当前完整自动化测试为 481 通过；没有执行真实 OpenClaw 配置，仍需重新打包并在测试
用户中验证。

### E. Dashboard 打开与 Agent JSON 兼容修复

真实普通用户验收确认：

- 点击“打开控制台”没有打开浏览器；
- 单 Agent Chat 返回“OpenClaw Agent 返回的 JSON 结果无效”。

代码核验确认 Dashboard 调用链原来为：

```text
Renderer
→ Preload dashboard:open
→ Electron Main
→ installerService.openDashboard()
→ detached openclaw dashboard --yes
```

Main 没有调用 `shell.openExternal`，把浏览器打开行为错误地依赖在分离的 CLI
子进程上。当前未提交修复改为：

```text
openclaw dashboard --help
→ 探测是否支持 --json
openclaw dashboard --yes --no-open
→ 支持时使用 dashboard --json
→ 不支持时解析 --no-open 文本输出
→ 校验 http/https loopback URL
→ Electron shell.openExternal()
```

Conversation 调用链为：

```text
Conversation GUI Service
→ Conversation Manager
→ OpenClaw Conversation Adapter
→ OpenClaw Execution Adapter
→ openclaw agent --json
```

共享 Execution Adapter 原来只支持旧的嵌套
`result.payloads` / `result.meta.agentMeta`。当前 OpenClaw CLI 可返回顶层
`payloads` / `meta.agentMeta`，导致合法 JSON 被判断为没有安全文本结果。当前修复
同时支持新旧 envelope，并保持安全白名单结果。

新增诊断事件只记录：

- 脱敏后的命令参数结构；
- exit code、signal、timeout 和 spawn 状态；
- stdout/stderr 是否存在、字节数、是否为合法 JSON、已识别顶层字段。

诊断不记录 Prompt、完整 Session Key、API Key、原始 stdout/stderr、Assistant
正文或完整 OpenClaw JSON。本次没有启动 GUI、没有运行真实 OpenClaw，也没有修改
测试用户环境。

最新真实日志确认 `dashboard_gateway_start` 成功，但 OpenClaw `2026.7.1-2`
明确返回“不识别 `--json`”。当前 Dashboard Service 先读取 `dashboard --help`
进行 capability detection：支持 `--json` 时保留原 JSON 解析，不支持时从
`dashboard --no-open` 的文本输出解析 URL。两条路径都只接受 HTTP(S) loopback
地址；Dashboard resolver 不再负责启动 Gateway service。

2026-07-31 实机截图进一步确认浏览器页面已经打开，但 Control UI 内部 WebSocket 连接
失败，且 token 输入框为空。当前未提交最小修复：

1. 保留合法 loopback Dashboard URL 的 pathname、query 和 hash；
2. `shell.openExternal()` 使用安全校验后的完整 URL；
3. 诊断只记录 `dashboardUrlResolved`、`queryPresent`、`hashPresent`、`tokenPresent`
   等布尔或安全字段；
4. 调整诊断脱敏器，允许 `tokenPresent: true/false` 这类无敏感值的存在性字段保留；
5. Renderer 不再把“已打开浏览器”显示为“控制台运行中”，改为“已打开/等待浏览器连接”。

同时为 `README.md`、`docs/gui-mvp-plan.md` 和
`docs/manual-test-checklist.md` 增加当前状态或历史文档入口，避免把旧阶段说明误当成
当前事实。这些文档改动当前同样尚未提交。

### F. GUI 安装状态与真实 executable 一致性

最新普通用户环境中，ToolBox 已能打开 Dashboard 并完成 Agent Chat，但 Terminal 的
`which openclaw` 返回 not found。两者不矛盾：Electron 命令环境会主动把
`~/.npm-global/bin` 放到 PATH 首位，Terminal 不会自动继承 Electron 的进程环境。

代码审查同时发现真实误判：`installerService.checkOpenClawVersion()` 和安装前已有
版本检查此前只要 `which openclaw` 成功便认定已安装，即使后续 `--version` 失败。
当前修复统一为：

```text
resolveCommand("openclaw")
→ 得到实际 executable 绝对路径
→ 使用该绝对路径执行 openclaw --version
→ 只有退出码为 0、未超时、无 spawn error 且版本非空时才认定已安装
```

同一规则已用于 GUI 版本状态、doctor、verify、安装前跳过判断和安装后验证。Renderer
不再因为“命令路径存在”提前显示已安装，也不会在版本检查异常时保留旧的已安装状态。
全新临时 HOME 测试确认：受管 prefix 尚无 executable 时显示未安装；生成可执行文件
后才显示已安装。完整测试为 481 通过，尚未重新打包或进行普通用户真实复验。

### G. ToolBox State 与 OpenClaw Agent 注册表一致性修复

最新普通用户证据：

```text
"$HOME/.npm-global/bin/openclaw" --version
→ OpenClaw 2026.7.1-2

"$HOME/.npm-global/bin/openclaw" agents list
→ 仅 main

ToolBox Chat:
openclaw agent --agent cross-border-team-creator ...
→ exitCode=1
→ stdout 为空
→ stderr 106 bytes
```

结论：

ToolBox 的 Role / Agent Instance / Conversation State 可在 OpenClaw 重装、HOME
状态重建或外部清理后继续引用 `cross-border-team-creator`、`cross-border-team-manager`
等自定义 Agent，但 OpenClaw 实际注册表已经只剩 `main`。聊天失败的直接原因不是
Gateway、Dashboard 或 JSON parser，而是 Conversation 指向的 OpenClaw Agent 不存在。

当前未提交修复：

1. `registerInstance()` 对已有但远端 missing 的合法 Instance 执行一次幂等重新注册；
2. 聊天发送前 `conversationService` 先执行 `reconcileInstances()`，再检查当前
   Conversation 绑定的 Instance；
3. 远端 Agent 已存在时直接发送；
4. 远端缺失但 ToolBox 有完整合法 Instance 配置时，复用 Core 注册能力重新注册一次，
   注册成功后继续本轮聊天；
5. Instance 配置缺失、drift、`main` 或同名外部冲突时不发送消息，并返回安全错误；
6. `roleService` 在角色市场和已安装角色列表中 best-effort 运行 reconcile，避免实际
   缺失的 Agent 继续显示为完全正常；
7. Agent 非零退出诊断增加脱敏 stderr 摘要，不记录 message、Session Key、API Key、
   Token 或完整原始 stderr。

定向测试 138 通过；完整测试 487 通过。尚未重新打包，也未在真实普通用户中复验。

2026-07-31 实机截图确认角色市场已经显示“需要修复”，但按钮禁用，用户无法进入聊天，
因此 Conversation 发送前兜底恢复无法触发。当前未提交最小修复：

1. `needs-repair` 状态下的“需要修复”按钮可点击；
2. 点击后仍复用 `roleService.enableMarketplaceRole()` 和 Core `registerInstance()`；
3. missing 且配置完整的 Instance 会幂等重注册；
4. drift、同名外部 Agent、`main` 仍不会被接管或覆盖；
5. 全部成功后刷新角色市场、我的角色和聊天入口；
6. 部分失败时保留“部分助手尚未准备完成/需要修复”安全提示。

定向测试 138 通过；完整测试 489 通过。尚未重新打包，也未在真实普通用户中复验。

### H. 首次 Gateway local mode 初始化与就绪等待

最新普通用户真实错误：

```text
Gateway start blocked:
existing config is missing gateway.mode.
```

根因是 OpenClaw CLI 和 ToolBox GUI 已可用，但首次配置没有保证
`gateway.mode=local`。原 Dashboard 链路直接运行 `dashboard --yes --no-open`，在配置
缺少该键时会在 Gateway 启动保护处失败，也没有在打开浏览器前验证 WebSocket RPC
ready。

当前未提交最小修复：

1. Dashboard 打开前执行只读
   `openclaw gateway status --json --require-rpc`；
2. Gateway 已 ready 时不读取或改写 mode；
3. 未 ready 时读取 `openclaw config get gateway.mode --json`；
4. 仅当 CLI 明确报告 `gateway.mode` 路径缺失时执行
   `openclaw config set gateway.mode local`；
5. 已有 `local` 不重复写入，已有 `remote` 不覆盖；
6. 真实日志确认旧链路把短生命周期的 `dashboard --yes --no-open` 退出码 0
   错当成 Gateway service 已启动，但随后 20 次 RPC 检查均未 ready；
7. 当前修复改为显式 `gateway start`，仅在 CLI 明确报告 service 未安装时执行一次
   `gateway install` 后重试 `gateway start`；
8. 启动后轮询 `gateway status --json --require-rpc`，RPC ready 前不执行 Dashboard
   URL 解析，也不会调用 `shell.openExternal`；
9. ready 后才用 `dashboard --help` 选择 `dashboard --json` 或
   `dashboard --no-open` URL resolver；
10. Gateway start、readiness 与 Dashboard resolver 使用同一 executable、HOME、
    PATH 和命令环境；
11. 不重跑完整 onboard，不修改 API Key、workspace 或 Agent。

诊断现在记录 Gateway lifecycle 的安全命令形状、退出码、timeout、spawn、耗时及脱敏
stdout/stderr 摘要，并为每次 readiness 失败记录安全失败分类；Main 仅记录浏览器是否
成功打开，不记录完整认证 URL。

### I. 恢复首次安装状态

设置页新增唯一的完全重置等级，必须经过两次确认才调用 Main IPC。新增
`src/core/environment-reset/resetService.js`，按当前 HOME、固定 bundleId
`com.haihuiduan.openclawtoolbox`、受管 npm prefix `~/.npm-global` 和固定临时目录
前缀生成精确 allowlist。

当前行为：

1. 尝试停止并卸载当前用户 Gateway，删除精确 LaunchAgent；
2. 只删除受管 prefix 内 OpenClaw bin 和 package，保留 prefix 根目录及其他 npm 包；
3. 删除 `~/.openclaw`、`~/.openclaw-installer` 和精确 ToolBox 应用数据；
4. 符号链接只删除链接，不跟随到外部目标；
5. 检测到外部 OpenClaw 或任一步失败时返回部分完成且不 relaunch；
6. 全部成功后才由 Electron Main 执行 `app.relaunch()` 和 `app.exit(0)`。

Gateway 清理不再以 `stop`、`uninstall` 或 `launchctl bootout` 的单个中间退出码决定
成功。当前会在删除后复核同一用户的 launchd service、精确 plist 和 18789 listener：
三项均不存在时按幂等成功处理；任一真实残留或检查无法确认时仍返回部分失败。

新增测试全部使用临时 HOME 和 Mock 命令执行器，没有删除真实用户文件、启动 GUI 或
执行真实 OpenClaw。Dashboard、Reset 与 Renderer 定向测试 90 通过；当前完整测试为
510 通过、0 失败、0 跳过。

### J. Gateway token mismatch 状态分类与失败边界

最新普通用户证据显示 LaunchAgent 已 loaded、runtime 为 `running`、health 为 healthy，
但 `gateway status --json --require-rpc` 因 `unauthorized: gateway token mismatch`
退出 1。旧代码只看退出码，将其误判为未运行并再次执行 `gateway start`，因此得到端口
18789 已占用。

当前实现：

1. 解析 `service.runtime.status`、`service.loaded`、`health.healthy`、`rpc.ok` 和安全
   RPC 失败分类；
2. running + ready 直接继续，running + 非认证未就绪只等待，均不再次 start；
3. running + unauthorized/token mismatch 不自动 install、restart 或修改 token，记录安全
   分类后明确失败并引导进入问题排查；
4. Dashboard 和首次快速配置不再向 OpenClaw 子进程传递 Electron 继承的旧
   `OPENCLAW_GATEWAY_TOKEN`，避免环境变量覆盖持久配置；
5. 诊断只记录 token 的 present/match 布尔值，不记录 token、认证 URL 或 API Key；
6. 失败不打开 Dashboard，不执行 repair 或 onboard，也不修改模型、Agent、
   Workspace 或其他用户配置。

一次安装/配置/控制台链路共享 `diagnosticRunId`，在 T0–T9 记录 Auth Snapshot；token
仅使用单次运行随机盐的 HMAC-SHA256 12 位指纹比较，salt 与 token 均不落盘。命令封装
只记录最终 spawn 环境中 OpenClaw 变量是否存在；config audit 仅提取安全元数据。

本轮静态核验发现 OpenClaw `config get` 会先调用 `redactConfigObject()`，此前通过
`config get gateway --json` 得到的 token 实际是 `__OPENCLAW_REDACTED__`，旧
`configTokenFingerprint` 因而不是配置 token 的真实指纹。当前诊断改为只读精确的
`openclaw.json`，只在内存对 literal token 做 HMAC；RPC probe 和 Gateway runtime 的
实际 token 无法从外部安全观察时明确记录 `unknown`，不再根据来源名称写入
`runtimeVsCliTokenEqual=true`。Dashboard 真正解析出认证 URL 时只记录 token 指纹，
不记录完整 URL或 token。

`2026.7.1-2` 源码确认：`gateway status --require-rpc` 先用 daemon config 与
daemon/service env 解析凭据，再把结果作为显式 token 传给 `callGateway()`；错误中的
`Source: cli --url` 仅描述 status 内部传入的 probe URL，不描述 token 来源。Dashboard
使用独立的 `resolveGatewayAuthToken()`（config-first，随后才是 env fallback），Gateway
server startup 使用 `ensureGatewayStartupAuth()` / `resolveGatewayAuth()`（config-first）。
当前开发用户的只读对照显示磁盘 config 与 Dashboard 认证 URL 指纹相同、RPC 成功、
LaunchAgent PID 与 18789 listener PID 相同；该环境不是失败的普通测试用户，不能替代
失败现场的 runtime/RPC 指纹。因此失败现场的根因分类仍为 `INSUFFICIENT_EVIDENCE`。

OpenClaw `2026.7.1-2` 发布包静态核验表明：Gateway service runtime 在
`OPENCLAW_SERVICE_KIND=gateway` 时采用 config-first，而普通本地 CLI credential
resolution 是 env-first；service env 不保存 literal token 可以是正常行为，因此
`serviceTokenPresent=false` 不再被单独判为根因。

旧的 Controlled Auth Probe 与 token 自动 repair 已移除；保留的 token mismatch 信息只作
必要诊断，不能触发 Gateway 重装或重启。

### K. 多用户 Gateway 端口归属与自动选择

最新真实多用户证据确认：`openclawtest2` 的 LaunchAgent PID 为 `36787`，但 18789
listener PID 为开发用户 `duanhaihui` 的 `84342`。一级根因已确定为
`CROSS_USER_GATEWAY_PORT_COLLISION`，`token mismatch` 只是连接到错误 Gateway 的
二级症状。

当前实现与真实验收：

1. Dashboard 在任何 RPC/auth repair 前核对配置端口、当前用户 LaunchAgent PID 和
   listener PID；归属不一致时直接返回端口冲突，不执行 start/restart/token repair；
2. 新用户快速配置在 onboarding 前检查受控候选端口 `18789–18809`，通过官方
   `--gateway-port` 把选定端口同时写入 OpenClaw config 与 managed service；
3. Reset 只判断当前用户原 managed PID 是否仍监听配置端口，其他用户或外部 listener
   会被保留且不再造成“Gateway 未完全清理”误报；
4. 不执行 sudo、kill、pkill，也不操作其他用户的 LaunchAgent。

最新真实 DMG 表明第一版自动选择仍写入 18789。确认原因不是 selectedPort 未进入 argv：
GUI 首次配置确实调用 `runQuickConfigure()`，且该函数确实把选择结果写入
`--gateway-port`。真正缺口是普通用户的 `lsof` 看不到其他用户 listener，旧逻辑把
exit 1/空输出当作 FREE。当前改用 Node 原生临时 bind 判定 FREE/OCCUPIED/UNKNOWN，
UNKNOWN 关闭失败；全部候选不可用时返回 `NO_AVAILABLE_GATEWAY_PORT`，不执行 onboard。
onboarding 后同时诊断并校验 config port 与 service port，防止后续覆盖回 18789。
只有二者都与 selectedPort 一致才成功；service 不存在、不可读取或不可解析时返回
`GATEWAY_PORT_VERIFICATION_UNAVAILABLE`，明确不一致时返回
`GATEWAY_PORT_CONFIGURATION_MISMATCH`。

真实回归确认 `openclawtest2` 自动选择 18790，配置、LaunchAgent、Gateway、RPC probe 和
Dashboard 均使用 18790；Dashboard 通过剪贴板认证 URL 自动认证，Agent Chat 连续对话
正常，其他用户 Gateway 未被 kill、stop 或修改。该阻塞问题已关闭。

### Git 当前文件状态

- 分支：`feature/role-chat-integration`
- HEAD：`b0c7059a6ca0a22e9045e8f20fcc3ac0d68fab38`
- 暂存区：空
- 工作区：38 个 tracked 文件有修改，21 个 untracked 文件，共 59 项
- 修改范围：Installer / Shell / Gateway / Dashboard / Reset / Agent 与 Conversation
  兼容、GUI、构建脚本、测试和项目文档
- 未包含提交、merge 或 push；当前状态不可描述为 clean。

## 下一步

1. 完成本轮 P1 定向测试、全量回归、全仓语法和 Git 检查；
2. 审查未提交范围后按职责拆分 commit；
3. 提交前确认不包含构建产物、凭据或临时文件。

## 尚未验证 / 后续 TODO

- 普通 Terminal 裸 `openclaw` 的 PATH 集成；
- `installerService` 职责拆分；
- 非文本剪贴板内容的完整恢复；
- npm diagnostics 的 HOME 解析统一；
- Apple Developer ID 签名、公证和更广泛干净机器验证；
- Team 群聊、Memory、RAG 和在线市场尚未实现。
