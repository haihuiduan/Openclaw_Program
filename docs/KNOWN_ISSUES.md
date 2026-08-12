# OpenClaw ToolBox 已知问题

只记录具有代码、测试、Git 或真实环境证据的问题。推测性风险应标记为“待确认”，不能写成已确认根因。

## ISSUE-001：普通用户首次安装 OpenClaw 失败

- 状态：修复已实现但未提交；最新真实 DMG 已确认安装成功，仍需验证 App 重启检测
- 优先级：P0 / 当前最高
- 首次确认日期：2026-07-30

### 现象

新建 macOS 普通用户从 GUI 执行“准备 OpenClaw”时，环境检查、bash 和官方脚本下载正常，但安装在 `execute_script` 阶段失败。

### 测试环境

普通用户：

```text
npm config get prefix
→ /usr/local
```

权限：

```text
/usr/local
→ root:wheel
普通用户无写权限
```

开发用户：

```text
node: /opt/homebrew/bin/node
npm prefix: /opt/homebrew
/opt/homebrew 属于当前开发用户
```

### 调用链

```text
Electron GUI
→ installerService.runInstall()
→ workflow engine
→ environment_check
→ download_script
→ execute_script
→ OpenClaw 官方 install.sh
→ npm install -g openclaw@latest
```

### 原始错误

```text
EACCES permission denied
目标: /usr/local/lib/node_modules/openclaw
```

官方脚本曾输出临时 `Installer log:` 路径，但该文件在 ToolBox 读取时已经消失并返回 ENOENT。当前未提交诊断增强会同步捕获输出、扫描 `~/.npm/_logs`，并在日志不可读时记录 npm/node/prefix/registry 环境。

### 已排除原因

根据本次真实运行证据，以下项目不是当前失败根因：

- Electron 能否启动；
- Electron 启动时 PATH 是否完全为空；
- bash 不存在；
- 官方脚本下载失败；
- npm registry 不可访问；
- Node.js 版本不满足；
- `npm install -g` 命令未被执行。

### 确认根因

普通用户的 npm global prefix 指向系统目录 `/usr/local`，该用户无权写入目标 `/usr/local/lib/node_modules/openclaw`，因此官方脚本中的全局 npm 安装返回 EACCES。

最新一次真实 DMG 复验还确认了上一版候选修复没有可靠进入安装链路：

- Electron 最终 PATH 能解析到 `/opt/homebrew/bin/node` 和 `/opt/homebrew/bin/npm`；
- 日志中没有 npm Bootstrap、原始 prefix、受管 prefix 或有效安装环境事件；
- workflow 可以从旧 checkpoint 恢复到 `execute_script`，并跳过已标记完成的 `environment_check`；
- 上一版 prefix 工具主要修改 `process.env.PATH`，`execute_script` 启动官方脚本时没有显式传入包含 `NPM_CONFIG_PREFIX` 的同一环境。

因此真实失败由两个层面共同造成：底层权限根因是系统级 npm prefix 不可写；工具箱链路缺陷是环境准备可被 checkpoint 跳过且没有可靠传入安装子进程。

### 当前修复

当前工作区未提交实现：

1. 每次安装和重试都强制运行 npm Bootstrap，旧 checkpoint 不能跳过；
2. 使用实际解析到的 npm 读取原始 prefix，记录 `/usr/local`、`/opt/homebrew` 等真实来源；
3. 统一创建当前用户拥有、权限为 `0700` 的 `~/.npm-global` 及其 `bin`；
4. 不再依赖 `npm config set prefix` 作为本次安装生效条件；
5. 构造包含 `NPM_CONFIG_PREFIX=~/.npm-global` 和受管 `bin` 优先 PATH 的显式进程环境；
6. 将同一环境传给 doctor、官方 `install.sh`、安装后验证、现有安装检查和公共 Shell 调用；
7. checkpoint 增加 schema/environment version，且不保存或复用 PATH；
8. 增加 Bootstrap、prefix、脚本有效环境和最终 OpenClaw 路径的脱敏诊断事件。

Mock 测试已覆盖 `/usr/local` 与 `/opt/homebrew` 不可写、GUI/终端解析不同 npm、旧 checkpoint、重试、显式脚本环境、用户级验证路径、App 重启检测、现有系统安装和无 sudo 流程。完整自动化测试为 451 通过、0 失败、0 跳过。

2026-07-30 的最新真实 DMG 已在普通测试用户中成功安装 OpenClaw
`2026.7.1-2`。安装后的快速配置失败作为独立问题记录在 `ISSUE-003`，不再把
`No TTY` 提示误判为 npm 安装失败。

### 待确认风险

- 新 DMG 在新建普通用户中的真实完整安装；
- 工具箱外部终端是否需要独立的持久 PATH 提示；
- nvm、fnm、Volta、Homebrew、官方 Node 安装包等不同 Node 来源；
- 用户目录本身不可写或 npm 配置损坏；
- 官方 `install.sh` 在未来版本是否改变对 `NPM_CONFIG_PREFIX` 或 PATH 的使用。

### 验收条件

- 在新建、非管理员 macOS arm64 用户中通过 Finder 启动最新 DMG；
- 初始 prefix 为不可写系统目录；
- ToolBox 明确检测并切换到用户级 prefix；
- `npm install -g openclaw@latest` 成功；
- `openclaw --version` 在同一次 workflow 中成功；
- App 重启后仍能识别 OpenClaw；
- 不使用 sudo，不修改官方 `install.sh`；
- 诊断日志不包含 API Key、Token、Cookie、私钥或未脱敏用户路径；
- 正式用户 State 和其他 worktree 不被污染。

## ISSUE-002：正式 macOS 分发尚未签名和公证

- 状态：已知发布限制
- 优先级：P1 / 正式发布前阻塞
- 确认日期：2026-07-30

### 现象

当前构建使用 electron-builder 和 ad-hoc 签名，可用于本地结构验证和受控测试，但没有 Apple Developer ID Application 信任链，也没有 notarization。

### 证据

`package.json` 当前配置：

```json
{
  "mac": {
    "identity": "-",
    "hardenedRuntime": false
  }
}
```

`scripts/buildMac.js` 会执行 `codesign --verify --deep --strict`，该检查验证 bundle 签名结构，不等同于 Apple 公证。

### 影响

- 新用户可能看到 Gatekeeper 警告；
- 不能把当前 DMG 描述为正式无障碍分发版本；
- 不应要求普通用户长期依赖右键打开或移除 quarantine。

### 当前状态

本地 arm64 `.app` 和 DMG 构建流水线已存在；正式签名和 notarization 尚未实施。

2026-07-30 的构建修复已确认：

- `scripts/buildMac.js` 使用 `/usr/bin/xattr -cr` 清理临时和最终 App；
- 临时 App 严格验签及临时 DMG 完整性验证在发布前完成；
- 发布后的解包 App 与 DMG再次分别验证；
- 最终解包 App 验签失败不会删除已经验证的 DMG；
- 最新 DMG 已通过 `hdiutil verify`，但仍是 ad-hoc 签名且未公证。

当前仓库位于 Desktop File Provider 管理目录，服务会在构建脚本退出后向解包 App
重新附加 FinderInfo/fileprovider 扩展属性。这是本机解包副本的宿主目录行为，不会
回写已经生成的 DMG；正式分发仍应以 DMG 内 App 和未来的 Developer ID 公证结果为准。

### 验收条件

- 使用有效 Developer ID Application 证书签名；
- 开启与实际权限相匹配的 hardened runtime；
- 完成 Apple notarization 和 staple；
- `codesign --verify`、`spctl --assess` 和新建普通用户 Finder 启动通过；
- 不把凭据写入仓库或日志。

## ISSUE-003：DeepSeek 快速配置与官方无 TTY onboarding 契约不一致

- 状态：最小修复已实现但未提交，等待重新打包和真实复验
- 优先级：P0 / 当前最高
- 确认日期：2026-07-30

### 现象

真实 DMG 已成功安装 OpenClaw `2026.7.1-2`，随后 GUI 快速配置 DeepSeek 失败。
官方安装脚本日志包含：

```text
No TTY; run openclaw onboard to finish setup
```

GUI 停留在 DeepSeek 配置准备阶段。

### 调用链

```text
Renderer runQuickConfigure()
→ Preload quick-configure:run
→ Electron main
→ installerService.runQuickConfigure()
→ runCommand("openclaw", ["onboard", ...])
```

没有安装 workflow step 调用 DeepSeek 快速配置。`execute_script` 只负责官方安装脚本；
上面的 `No TTY` 是安装脚本在无终端环境下的完成提示。

### 确认的兼容缺口

旧快速配置虽然使用 `runCommand` 和 `--non-interactive`，但同时传入：

- 当前官方 onboarding 自动化契约中不存在的 `--skip-hooks`；
- 当前官方 onboard 命令不提供的 `--default-model`；
- 未明确传入 `--mode local`、`--secret-input-mode plaintext`、
  `--gateway-bind loopback` 和 `--daemon-runtime node`。

这使 GUI 的 headless 配置参数与当前 OpenClaw 官方接口不一致。真实失败的完整
stderr 尚未取得，因此不能把某一个单独参数描述为已由真实日志证明的唯一报错点。

### 当前修复

1. onboarding 固定使用官方无 TTY 参数；
2. 移除 `--skip-hooks` 和 onboard 内的 `--default-model`；
3. 用户选择模型时，在 onboarding 成功后调用
   `openclaw models set <model>`；
4. DeepSeek 模型选项更新为当前 V4 Pro/Flash 正式标识；
5. onboarding 或模型设置失败时不继续后续步骤，并脱敏 API Key。

### 验收条件

- 新建普通 macOS 用户无需打开终端；
- GUI 快速配置 DeepSeek 成功完成；
- OpenClaw 使用配置的 DeepSeek API Key；
- 自动模式采用官方默认 `deepseek/deepseek-v4-pro`；
- 明确选择模型时 `models set` 成功；
- daemon 和后续 GUI 验证成功；
- 错误输出不包含 API Key；
- 全流程不调用交互式 TTY 配置。

## ISSUE-004：Dashboard CLI 版本兼容、认证 URL 与 Agent JSON envelope 不兼容

- 状态：已关闭，真实 DMG 回归通过
- 优先级：P0
- 确认日期：2026-07-30

### 现象

普通用户在真实 DMG 中完成 OpenClaw 安装后：

1. 点击“打开控制台”没有打开浏览器；
2. 单 Agent Chat 返回“OpenClaw Agent 返回的 JSON 结果无效”。

### 确认根因

Dashboard 的 Renderer、Preload 和 IPC 调用正常，但 Service 只启动分离的
`openclaw dashboard --yes`。Electron Main 没有取得 Dashboard URL，也没有显式调用
`shell.openExternal`，因此浏览器行为依赖 CLI 子进程，无法可靠完成。

Conversation GUI Service 通过 Conversation Adapter 复用 Execution Adapter。解析器
仅支持旧的 `result.payloads` 和 `result.meta.agentMeta`，而当前 CLI 可返回顶层
`payloads` 和 `meta.agentMeta`。因此 stdout 本身是合法 JSON，但解析器找不到安全
文本字段并返回“JSON 结果无效”。

### 当前修复

1. Service 显式启动并等待 Gateway RPC ready；
2. 再执行 `openclaw dashboard --help` 探测 `--json` 能力；
3. 支持 `--json` 时保留 JSON 解析，不支持时解析 `--no-open` 文本输出；
4. 只接受 `http`/`https` 的 localhost、IPv4/IPv6 loopback URL；
5. Electron Main 显式调用 `shell.openExternal`，URL 不返回 Renderer；
6. Agent Parser 同时支持顶层和旧嵌套的 payload/meta envelope；
7. 新增安全诊断，只记录脱敏命令形状、退出状态和解析结构，不记录正文、Session
   Key、API Key 或原始输出。

### 自动化验证

- Dashboard Service、Execution Adapter、Conversation Adapter、Renderer 契约及
  Conversation 回归定向测试：121 通过、0 失败；
- Dashboard capability、JSON/text resolver、stderr 脱敏和截断测试：8 通过、0 失败；
- 完整测试：473 通过、0 失败、0 跳过；
- 没有启动 GUI，没有执行真实 OpenClaw 命令。

### 最新真实证据

真实日志中 Gateway 准备连续成功，OpenClaw `2026.7.1-2` 明确返回
`OpenClaw does not recognize option '--json'`。根因是 resolver 把 `--json` 当作
所有版本均支持的固定能力。当前未提交兼容修复用 help capability detection 选择
JSON 或文本解析路径，不再向不支持该参数的版本发送 `--json`。

2026-07-31 实机截图显示浏览器 Control UI 已打开，但页面内部 WebSocket 连接
`ws://127.0.0.1:18789` 失败，且 token 输入框为空。当前判断这是 Dashboard 认证 URL
链路问题，不是 `shell.openExternal` 未执行。当前最小修复不新增 WebSocket 客户端、
HTTP 健康探针、Gateway Manager 或自动重启，只保证：

- 文本/JSON resolver 保留合法 loopback URL 的 pathname、query 和 hash；
- `shell.openExternal()` 收到安全校验后的完整 URL；
- 诊断只记录 `queryPresent`、`hashPresent`、`tokenPresent` 等布尔值；
- 不记录完整 URL、token 值或认证参数值；
- UI 不再把“已打开浏览器”写成“控制台运行中”。

2026-08-10 的真实 CLI 验证进一步确认：`openclaw dashboard --no-open` 的 stdout
只输出 `http://127.0.0.1:<port>/` 基础地址，带 gateway token 的认证 URL 只复制到
剪贴板。旧 ToolBox 因此丢失认证参数，根因分类为 `DASHBOARD_AUTH_URL_LOST`。
当前修复在命令前暂存剪贴板，命令成功后读取并校验本次更新的 loopback 认证 URL，
要求端口与配置一致且 query/hash 中存在 token；失败时返回
`DASHBOARD_AUTH_URL_UNAVAILABLE`，绝不回退打开 stdout 基础 URL。URL 和 token 仅在
Main/Service 内存中短暂存在，诊断只记录布尔元数据，最后尽力恢复原剪贴板。

### 验收条件

- 普通用户从最新 DMG 点击“打开控制台”，默认浏览器打开本机 Dashboard；
- Dashboard URL 不暴露给 Renderer 或诊断日志，但认证 query/hash 能传给浏览器；
- Control UI 的 WebSocket 连接不再因为认证参数缺失而失败；
- Gateway 准备失败时显示安全错误；
- 真实单 Agent Chat 可解析当前 `openclaw agent --json` 返回；
- outputSummary、Session ID 和 Run ID 仍只通过安全白名单；
- API Key、Prompt、完整 Session Key、stdout/stderr 和内部元数据不进入日志或 UI。

### 真实验收结论

2026-08-10 的真实 macOS 回归确认 Dashboard 通过剪贴板 authenticated URL 直接打开并
自动认证，Agent Chat 可连续发送和接收回复；URL/token 未进入 Renderer 或诊断日志。

## ISSUE-005：GUI 已安装状态与 OpenClaw executable 验证不严格

- 状态：核心状态检测已关闭；Terminal 裸 `openclaw` PATH 作为独立 TODO
- 优先级：P0
- 确认日期：2026-07-30

### 现象

普通用户的 ToolBox 首页显示 OpenClaw `2026.7.1-2` 已安装，Dashboard 和 Agent Chat
可工作，但同一用户 Terminal 的 `which openclaw` 返回 not found。

### 确认根因

Electron 命令环境会主动将 `~/.npm-global/bin` 放到 PATH 首位，普通 Terminal 不会
自动继承 Electron 的进程环境，所以两边 `which` 结果可以不同。这不代表受管 binary
一定缺失。

代码另有一个真实误判：GUI 版本检查和安装前已有版本检测只要 `which` 成功就报告已
安装，即使随后 `openclaw --version` 超时、spawn 失败、退出非零或没有版本正文。

### 当前修复

- 所有安装状态判断先用 `resolveCommand()` 取得实际 executable；
- 使用解析到的绝对路径执行 `--version`，避免查找与执行指向不同 binary；
- 只有版本命令成功且返回非空版本时才认定已安装；
- GUI、doctor、verify、安装跳过判断和安装后验证使用同一严格语义；
- Renderer 不再因命令路径存在提前设置“已安装”，失败检查也不会保留旧状态。

### 自动化验证

- 全新临时 HOME 中，受管 prefix 没有 executable 时 GUI 返回未安装；
- 生成真实可执行测试脚本并成功运行 `--version` 后才返回已安装；
- 覆盖命令缺失、退出非零、timeout、spawn failure 和 Electron/Terminal PATH 差异；
- 完整测试：481 通过、0 失败、0 跳过；
- 没有启动 GUI，没有执行真实 OpenClaw 安装。

### 验收条件

- 全新普通用户安装后，App 重启仍能解析并执行受管 OpenClaw binary；
- binary 缺失、不可执行或版本命令失败时首页不得显示“已安装”；
- 安装 workflow 不得因残留或损坏的命令文件跳过安装；
- Dashboard、Agent Chat 和已有安装流程不回归；
- 是否把受管 bin 写入 Terminal shell profile 作为独立产品决策，不由状态检测暗中修改。

## ISSUE-006：ToolBox State 与 OpenClaw Agent 注册表不一致导致聊天失败

- 状态：已关闭，真实 Agent Chat 连续对话通过
- 优先级：P0
- 确认日期：2026-07-30

### 现象

普通用户环境中，受管 OpenClaw executable 可用：

```text
"$HOME/.npm-global/bin/openclaw" --version
→ OpenClaw 2026.7.1-2
```

OpenClaw 实际 Agent 注册表只有：

```text
main
```

但 ToolBox Chat 调用：

```text
openclaw agent --agent cross-border-team-creator ...
```

结果为：

```text
spawnFailed=false
exitCode=1
stdout 为空
stderr 106 bytes
```

### 确认根因

ToolBox 持久化的 Role、Agent Instance、Team 或 Conversation State 可继续引用
`cross-border-team-creator`、`cross-border-team-manager` 等自定义 Agent；但 OpenClaw
重装、HOME 状态重建或外部清理后，OpenClaw 自己的 Agent 注册表已经丢失这些 Agent。

聊天发送链路此前主要依据 Conversation 绑定的 `instanceId` 和本地 Instance State，
没有在发送前强制确认该 Agent 仍存在于当前 OpenClaw 注册表，也没有基于合法
Instance 配置进行一次性恢复注册。

### 当前修复

1. `registerInstance()` 对已有但远端 missing 的合法 Instance 复用现有
   OpenClaw Adapter 重新注册一次；
2. 重新注册成功后再次读取 OpenClaw Agent 列表，并用现有 `assessRegistration()`
   确认状态回到 `registered`；
3. 聊天发送前 `conversationService` 执行 `reconcileInstances()`，再检查当前
   Conversation 对应的 Instance；
4. Agent 已存在时不重复注册，按原逻辑发送；
5. Agent 缺失但 Instance 记录完整时只尝试一次重新注册，成功后继续本次聊天；
6. Instance 记录缺失、drift、`main` 或同名外部 Agent 冲突时，不执行聊天；
7. `roleService` best-effort 刷新 Instance 状态，使角色市场和聊天中心不继续把
   实际缺失的 Agent 显示为完全正常；
8. Agent 非零退出诊断补充脱敏 stderr 摘要。

2026-07-31 根据实机截图补充修复：

9. 角色市场中 `needs-repair` 状态的“需要修复”按钮改为可点击；
10. 点击后复用现有 `enableMarketplaceRole()` 与 `registerInstance()` 链路，不复制注册逻辑；
11. missing 且配置完整的 Instance 幂等重注册；
12. drift、同名外部 Agent 和 `main` 仍不会被自动接管或覆盖；
13. Conversation 发送前兜底恢复继续保留。

### 安全边界

- 不根据 Conversation 中的 agentId 单独创建 Agent；
- 不注册或覆盖 `main`；
- 不接管同名但 workspace/agentDir 不一致的外部 Agent；
- 不删除用户已有 Agent；
- 不依赖 Terminal PATH；
- 不实现 Gateway Manager；
- 不修改 Dashboard 或安装流程；
- 自动重新注册只允许尝试一次。

### 自动化验证

- OpenClaw 只有 `main`，但 ToolBox 中存在合法自定义 Instance：自动重新注册并继续聊天；
- 自定义 Agent 已存在：不重复注册，直接聊天；
- Agent 缺失且 Instance 数据不完整：不注册，不发送；
- drift 或同名外部 Agent 冲突：不接管；
- `main`：不重新注册或覆盖；
- 注册失败：只尝试一次，不继续发送；
- stderr 摘要脱敏；
- 定向测试：138 通过、0 失败；
- 完整测试：487 通过、0 失败、0 跳过。
- 2026-07-31 补充 Dashboard 认证 URL 与角色修复按钮后，完整测试：489 通过、0 失败、0 跳过。

### 验收条件

- 在普通用户最新 DMG 中，OpenClaw `agents list` 初始只有 `main`；
- ToolBox Chat 发送前识别自定义 Agent 缺失；
- 角色市场“需要修复”按钮可点击；
- ToolBox 使用已有合法 Instance 记录自动重新注册缺失 Agent；
- 注册后本轮聊天继续成功；
- 角色市场和聊天中心显示恢复后的 `registered` 状态；
- 配置缺失、drift 或外部同名冲突时显示明确安全错误，不继续发送；
- 诊断日志不包含 API Key、Token、Prompt、完整 Session Key 或完整原始 stderr。

### 真实验收结论

2026-08-10 的真实普通用户回归确认已启用角色的 Agent Chat 可以连续发送消息并正常
回复，安装、Gateway 和 Dashboard 修复没有破坏 Conversation 会话连续性。

## ISSUE-007：首次 Dashboard 启动缺少 gateway.mode

- 状态：已关闭，真实首次安装回归通过
- 优先级：P0
- 确认日期：2026-07-31

### 现象与根因

普通 macOS 用户中 OpenClaw CLI 和 ToolBox GUI 正常，但 Gateway 启动返回：

```text
Gateway start blocked:
existing config is missing gateway.mode.
```

OpenClaw 对存在但缺少 `gateway.mode` 的配置采用失败关闭，不会猜测本地模式。原
Dashboard 链路没有在启动前检查该配置，也没有在打开浏览器前确认 Gateway RPC ready。

### 当前修复

- 先用 `gateway status --json --require-rpc` 做只读 readiness 检查；
- 仅在未 ready 时读取 `config get gateway.mode --json`；
- 仅在该路径明确缺失时执行 `config set gateway.mode local`；
- 已有 local 不重复写入，已有 remote 不覆盖；
- 不重跑 onboard，避免再次验证或改写模型认证、workspace 和 Agent；
- 不再把 `dashboard --yes --no-open` 的退出码当作 Gateway service 已启动；
- 显式调用幂等 `gateway start`，仅在明确未安装 service 时执行
  `gateway install` 后重试；
- 启动后轮询 WebSocket RPC readiness，ready 前不解析或返回 Dashboard URL；
- Gateway lifecycle、readiness 与 URL resolver 复用同一 executable、HOME、PATH
  和命令环境；
- 启动与 readiness 诊断只记录命令形状、退出状态、耗时、脱敏摘要和安全失败分类。

### 自动化验证

- 缺少 mode：只新增 `gateway.mode=local`，启动后等待 ready；
- 已有 local：不重复写配置；
- Gateway 已运行：不读写 mode，也不重复等待；
- 已有 remote：拒绝自动覆盖；
- 启动命令成功但 RPC 未 ready：不返回 Dashboard URL；
- Dashboard 定向测试 16 通过；
- Dashboard、Reset 与 Renderer 定向测试 90 通过；
- 完整测试 510 通过、0 失败、0 跳过；
- 未启动 GUI，未执行真实 OpenClaw 命令。

### 最新真实证据与 Reset 关联修复

真实日志显示 `dashboard_gateway_start exitCode=0` 后，20 次
`gateway status --json --require-rpc` 均未 ready。原事件对应的实际命令是
`dashboard --yes --no-open`；退出码只能证明该短生命周期命令结束，不能证明当前
OpenClaw 版本已持续加载 Gateway service。

同一轮真实重置后，LaunchAgent plist 已不存在且 18789 端口已释放，但 GUI 仍报告
“Gateway 服务未能完全清理”。根因是 Reset 把 `stop`、`uninstall` 或
`launchctl bootout` 的中间非零直接累计为失败。当前改为最终复核 launchd service、
精确 plist 和 18789 listener；三项均不存在时按幂等成功，任一残留或无法确认时仍失败。

### 验收条件

- 新用户缺少 `gateway.mode` 时点击一次“打开控制台”即可自动完成 local 初始化；
- API Key、workspace、Agent 和其他配置保持不变；
- Gateway RPC ready 后才打开浏览器；
- 已运行 Gateway 不被重复初始化；
- remote 配置不被改为 local；
- 诊断日志不包含 API Key、Token 或完整认证 URL。

### 真实验收结论

2026-08-10 的全新普通用户流程确认 local Gateway 能完成配置、启动、RPC ready 和
Dashboard 自动认证；跨用户端口冲突由 ISSUE-008 的自动端口选择解决。

## ISSUE-008：多用户 Gateway 固定端口冲突导致连接到错误 listener

- 状态：已关闭，真实多用户 macOS 回归通过
- 优先级：P0
- 确认日期：2026-08-10
- 关闭日期：2026-08-10

### 现象与根因

真实多用户证据确认：测试用户 `openclawtest2` 的 managed LaunchAgent 与 18789 的实际
listener 不属于同一进程；18789 listener 属于另一 macOS 用户。测试用户 CLI 因而使用
自己的 token 连接到其他用户 Gateway，产生 `unauthorized: gateway token mismatch`。
一级根因是 `CROSS_USER_GATEWAY_PORT_COLLISION`，token mismatch 只是二级症状。

第一版端口检测依赖 `lsof`。普通用户无法看到其他用户 listener 时，空结果被错误解释
为端口可用，因此 reset 后首次安装仍选择 18789。

### 最终修复

- 端口是否可用以 Node 临时 bind probe 为准：bind 成功后立即关闭，
  `EADDRINUSE` 为 occupied，其他错误为 unknown 并 fail closed；
- 在受控范围 `18789–18809` 选择首个确认可用端口，并通过官方
  `onboard --gateway-port` 持久化；
- onboarding 后只有磁盘 config port 和 LaunchAgent service port 都等于 selectedPort
  才成功；service 不存在或不可解析时返回
  `GATEWAY_PORT_VERIFICATION_UNAVAILABLE`；
- Dashboard 在 RPC/auth 前核对 listener 与当前用户 managed Gateway；归属冲突时不执行
  start、restart、token repair，也不操作其他用户进程；
- 当前 managed Gateway 如果仍返回 token mismatch，只记录脱敏诊断并明确失败，不自动
  `gateway install --force`、restart 或修改 token；
- Reset 只验证和清理当前用户 managed Gateway；其他用户保留的 listener 不算清理失败；
- Dashboard 只使用经 loopback、配置端口和认证参数校验的剪贴板 authenticated URL，
  stdout 基础 URL 不作为成功地址。

### 真实验收

- `openclawtest2` 在另一用户占用 18789 时自动选择 18790；
- OpenClaw config、LaunchAgent、Gateway、RPC probe 和 Dashboard 均使用 18790；
- Dashboard 可以直接打开并自动认证；
- Agent Chat 可连续发送消息并正常回复；
- 其他用户 Gateway 未被 kill、stop 或修改；
- 当前 Gateway / Dashboard 阻塞问题已关闭。

## 当前未确认其他阻塞问题

截至 2026-08-10，本轮代码和 549 项自动化测试没有提供其他新的确定性阻塞根因。未实现功能和待决策事项见 `PROJECT_MEMORY.md` 与 `DECISIONS.md`，不应作为已修复能力描述。
