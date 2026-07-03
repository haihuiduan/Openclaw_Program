# OpenClaw 官方 Onboarding 流程分析

## 1. 真实测试发现

真实测试发现，OpenClaw 官方 `install.sh` 在安装 OpenClaw 本体后，可能继续进入交互式 setup / onboarding。

在 GUI 后台执行时，这会带来两个问题：

- OpenClaw 本体可能已经安装成功，但安装脚本没有正常退出。
- 进程中可能出现 `openclaw-onboard`、`openclaw gateway`、`openclaw` 等子进程，导致 GUI 看起来像卡住。

因此产品上必须拆清楚职责：

- 准备 OpenClaw：只负责环境检测、安装本体、验证 `openclaw --version`。
- 配置 API：只负责基础模型服务商和 API Key 配置。
- 高级设置：处理 Skills、Hooks、Web search、Channel、ClickClack / Slack / QQ Bot / 飞书等扩展能力。

安装是否成功优先以 `openclaw --version` 是否可用为准，而不是以官方 onboarding 是否结束为准。

## 2. 当前 GUI 主流程

当前 GUI 主流程调整为：

1. 欢迎
2. 准备 OpenClaw
3. 配置 API
4. 验证配置
5. 打开控制台

环境检测已经合并到“准备 OpenClaw”中，因为 install workflow 本身已经包含 environment_check 和 check_existing_install。普通用户不需要重复点击“开始检测”。

## 3. 基础配置策略

普通用户主流程只做基础模型配置。GUI 内表单包含：

- AI 服务商：OpenRouter、DeepSeek、OpenAI、Gemini、Qwen
- API Key
- 默认模型，可留空

后台调用 OpenClaw 官方非交互 onboarding：

```text
openclaw onboard --non-interactive --accept-risk --flow quickstart --auth-choice <authChoice> <keyArg> <apiKey> --install-daemon --skip-search --skip-skills --skip-hooks --skip-channels --skip-ui --json
```

Provider 映射：

- OpenRouter：`openrouter-api-key` / `--openrouter-api-key`
- DeepSeek：`deepseek-api-key` / `--deepseek-api-key`
- OpenAI：`openai-api-key` / `--openai-api-key`
- Gemini：`gemini-api-key` / `--gemini-api-key`
- Qwen：`qwen-api-key` / `--qwen-api-key`

本工具不保存、不读取、不展示、不记录 API Key，也不自己写 `~/.openclaw/openclaw.json`。

## 4. 高级设置边界

以下能力不放在普通用户主流程中：

- Skills
- Hooks
- Web search
- Channel
- ClickClack / Slack / QQ Bot / 飞书
- 官方完整 onboarding

这些能力放到“高级设置：官方完整配置向导”。点击后继续调用现有 `runConfigure()`，在系统 Terminal 中运行 OpenClaw 官方向导。

这样做的原因是：高级功能选项多、依赖多、解释成本高，不适合作为普通用户首次使用的必经流程。

## 5. 已配置用户体验

如果 OpenClaw 已安装且配置已完成，首页显示：

- OpenClaw 已准备好
- 打开控制台
- 更换 API Key
- 当前版本 / 最新版本 / 更新状态

用户不需要再次走完整安装向导。

如果发现新版本，首页显示“立即更新”。更新入口复用现有 install workflow，并传入 `forceInstall: true`，不会删除 `~/.openclaw` 或用户配置。

## 6. 当前 verify 边界

当前 verify 是基础验收：

- OpenClaw 命令是否存在
- OpenClaw 版本是否可读取
- OpenClaw 配置文件路径是否可读取

它暂时不验证 API Key 是否真实有效，不验证模型调用是否成功，也不验证 Gateway / daemon 的完整运行状态。这些可以作为后续版本增强能力。
