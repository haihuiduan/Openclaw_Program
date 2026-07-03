# OpenClaw Installer 用户使用说明

## 1. 软件用途

OpenClaw Installer 是一个面向 macOS 普通用户的 OpenClaw 安装、配置和验证助手。

它把原本需要手动输入命令的流程整理成一个图形化向导：

- 准备 OpenClaw：自动检测环境，并安装或跳过已安装的 OpenClaw
- 在 GUI 内配置 AI 服务商 API Key
- 验证 OpenClaw 是否可以基本使用
- 打开 OpenClaw Dashboard 浏览器控制台
- 在遇到问题时查看安装记录

本工具不会保存、读取或上传 API Key，也不会自己写 OpenClaw 的官方配置文件。配置会通过 OpenClaw 官方命令完成。

## 2. 推荐使用流程

普通用户建议按向导顺序操作：

1. 点击“开始”，进入一页式向导。
2. 在“准备 OpenClaw”步骤点击“开始准备”。本步骤会自动检测 macOS、CPU 架构、Node.js、npm、Git，并安装或跳过已安装的 OpenClaw。
3. 在“配置 API”步骤选择 AI 服务商，输入 API Key，可选填写默认模型。
4. 点击“开始配置”。本工具会调用 OpenClaw 官方非交互配置命令，不会打开 Terminal。
5. 配置完成后会自动进入验证步骤。
6. 验证通过后，点击“打开 OpenClaw 控制台”。
7. 如果安装或配置遇到问题，点击“问题排查”查看安装记录。

如果你已经安装并配置过 OpenClaw，再次打开软件时首页会直接显示“打开控制台”和“更换 API Key”。不需要重新走完整安装流程。

## 3. 准备 OpenClaw

“准备 OpenClaw”已经合并了环境检测和安装流程。

它会自动完成：

1. 检查 macOS、CPU 架构、Node.js、npm、Git。
2. 检查是否已经安装 OpenClaw。
3. 未安装时自动下载并执行 OpenClaw 官方安装脚本。
4. 安装完成后验证 `openclaw` 命令是否可用。

首次安装通常需要 2-10 分钟，取决于网络速度。请保持网络连接，不要关闭本窗口。

如果 OpenClaw 已经安装，本工具会跳过重复安装。首页也会显示当前版本、最新版本和更新状态。发现新版本时，可以点击“立即更新”。

## 4. 配置 API

配置 API 默认在 GUI 内完成，不需要打开 Terminal。

当前支持选择：

- OpenRouter
- DeepSeek
- OpenAI
- Gemini
- Qwen

你需要输入对应服务商的 API Key。默认模型可以留空，表示使用 OpenClaw 官方默认值。

本工具不会保存、展示或记录 API Key。API Key 只会作为参数传给 OpenClaw 官方命令：

```text
openclaw onboard --non-interactive ... --json
```

配置命令会跳过 Skills、Hooks、Web search、Channel 等高级功能，让普通用户先完成基础模型配置。

## 5. 高级设置

如果你需要配置聊天渠道、Web search、Skills、Hooks、Gateway 等扩展功能，可以点击“高级设置：官方完整配置向导”。

高级配置会打开系统 Terminal，并运行 OpenClaw 官方完整 onboarding。它适合需要进一步设置 ClickClack、Slack、QQ Bot、飞书、搜索、技能和自动化钩子的用户。

普通用户第一次使用时，可以先完成 GUI 内的基础 API 配置，后续需要扩展能力时再进入高级设置。

## 6. Dashboard

验证通过后，建议点击“打开 OpenClaw 控制台”。Dashboard 会在浏览器中打开，更适合普通用户继续使用 OpenClaw。

也可以在 Terminal 中手动运行：

```text
openclaw dashboard
```

OpenClaw 可以帮助你：

- 和 AI agent 对话
- 总结资料
- 整理任务
- 辅助写作
- 后续连接更多工具和聊天渠道

## 7. 问题排查

点击“问题排查”会打开安装记录目录：

```text
~/.openclaw-installer/logs/
```

如果安装或配置失败，请把最新的 `install-xxxx.log` 文件发给开发者排查。普通用户不需要自行理解日志内容。

## 8. 常见问题

### 为什么主流程不再单独显示“开始检测”？

因为“准备 OpenClaw”已经包含环境检测。普通用户不需要先检测一次，再安装时又检测一次。

### API Key 会不会被本工具保存？

不会。本工具不保存、不读取、不上传 API Key，也不会把 API Key 写入本工具日志。

### 为什么还有官方高级配置向导？

GUI 内配置只做基础模型配置。Skills、Hooks、Web search、Channel、ClickClack、Slack、QQ Bot、飞书等扩展功能仍由 OpenClaw 官方完整 onboarding 处理。

### 配置完成后为什么还要验证？

验证用于确认 OpenClaw 命令、版本和配置文件路径可以读取。它暂时不验证 API Key 是否真实有效，也不发送真实模型请求。

### 配置状态是什么意思？

- 待配置：还没有检测到可用配置。
- 已配置：验证时检测到 OpenClaw 基本可用，并且配置文件路径可读取。
- 配置异常：验证失败，或配置状态不完整，需要重新配置或排查。
