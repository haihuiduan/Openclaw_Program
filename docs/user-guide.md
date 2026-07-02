# OpenClaw Installer 用户使用说明

## 1. 软件用途

OpenClaw Installer 是一个面向 macOS 普通用户的 OpenClaw 安装、配置和验证助手。

它的作用是把原本需要手动输入命令的流程，整理成更容易理解的图形界面操作：

- 检查电脑环境是否满足要求
- 安装 OpenClaw 本体
- 打开 OpenClaw 官方配置向导
- 验证 OpenClaw 是否已经可以基本使用
- 引导用户打开 OpenClaw Dashboard 浏览器控制台
- 在遇到问题时查看安装记录

本工具不会自己保存 API Key，也不会自己写 OpenClaw 的官方配置文件。API Key、模型服务商、默认模型等内容由 OpenClaw 官方配置向导处理。

## 2. 推荐使用流程

建议第一次使用时按下面顺序操作：

1. 点击“开始检测”，确认当前电脑环境是否满足安装要求。
2. 点击“一键安装”，安装 OpenClaw 本体。
3. 点击“配置引导”，阅读 GUI 中显示的配置流程说明。
4. 点击“打开官方配置向导”，在打开的 Terminal 中完成 OpenClaw 官方 onboarding。
5. 配置完成后，回到本软件，点击“我已完成配置，立即验证”。
6. 验证通过后，点击“打开 OpenClaw 控制台”，或手动运行 `openclaw dashboard`。
7. 如果安装或配置遇到问题，点击“问题排查”查看安装记录。

GUI 主流程不再推荐普通用户使用“一键准备”。`setup` 能力仍保留在底层和 CLI 中，适合开发、测试或自动化场景；普通用户按上面的按钮顺序操作即可。

如果你不确定某一步该怎么选，优先选择默认项、Keep current、Skip for now 或 No。这样可以先完成基础配置，后续再打开 OpenClaw 自己调整。

## 3. 配置引导中的推荐路线

点击“配置引导”后，系统会显示推荐路线。点击“打开官方配置向导”后，Terminal 会运行 OpenClaw 官方 onboarding。你可能会看到下面这些步骤：

1. 安全确认：个人使用一般选择 Yes。
2. Setup mode：第一次使用选择 QuickStart。
3. Config handling：如果之前配置过，选择 Keep current values；第一次配置按默认继续。
4. Model/auth provider：选择你的 API 来源，例如 OpenRouter、OpenAI、DeepSeek。
5. Auth method：如果使用 OpenRouter，一般选择 OpenRouter API key。
6. API Key：粘贴你自己的 Key，本工具不会保存。
7. Default model：如果不懂，可以保持默认，例如 `openrouter/auto`。
8. Channel：第一次体验建议选择 ClickClack。
9. Web search：如果不清楚用途，可以先选择 Skip for now。
10. Skills / Missing dependencies：如果不清楚用途，可以先选择 Skip for now。
11. Optional API keys：不知道用途就选择 No。
12. Hooks：如果不清楚用途，可以先选择 Skip for now。
13. Gateway service：保持默认；如果已安装可以选择 Restart。
14. Hatch your agent：普通用户建议选择 Hatch in Browser；如果进入 Terminal TUI，也可以之后使用 Dashboard。
15. 完成后：回到 OpenClaw Installer，点击“我已完成配置，立即验证”。

配置向导由 OpenClaw 官方命令完成，本工具只是帮你打开它，并在完成后引导你做验证。

## 4. Terminal TUI 和 Dashboard

配置完成后，OpenClaw 可能会自动进入终端聊天界面。这个界面是官方 Terminal TUI，不是必须使用。

普通用户更推荐使用 Dashboard 浏览器控制台。验证配置通过后，可以点击 GUI 主操作区或验证结果中的“打开 OpenClaw 控制台”，也可以在 Terminal 中运行：

```text
openclaw dashboard
```

Dashboard 会在浏览器中打开，更适合查看状态和继续使用 OpenClaw。

## 5. 常见问题

### 为什么会打开 Terminal？

OpenClaw 官方配置向导是交互式命令行程序，需要用户选择选项并输入 API Key。Electron GUI 后台不适合静默处理这种交互，所以本工具会打开系统 Terminal，让你直接使用官方向导。

### API Key 会不会被本工具保存？

不会。本工具不保存、不读取、不上传你的 API Key。API Key 由 OpenClaw 官方配置流程处理。

### 安装时间较长怎么办？

安装过程需要访问网络并执行 OpenClaw 官方安装脚本。如果等待时间较长，请先不要关闭软件。若安装失败，可以点击“问题排查”查看详细原因。

### 配置完成后为什么还要验证？

Terminal 中的配置完成，只表示官方向导已经结束。是否真的可用，还需要通过“验证配置”确认 OpenClaw 命令、版本和配置文件路径是否正常。

### 日志在哪里？

正式执行“一键安装”后，安装记录会写入：

```text
~/.openclaw-installer/logs/
```

dry-run 或预演模式不会写日志。如果日志目录还不存在，说明你可能还没有执行过正式安装，或者安装尚未产生日志。

### 配置状态分别是什么意思？

- 待配置：还没有完成 OpenClaw 官方配置，或尚未检测到可用配置。
- 等待验证：已经打开配置向导，但还没有通过本软件验证。
- 已配置：验证时检测到 OpenClaw 基本可用，并且配置文件路径可读取。
- 配置异常：验证失败，或配置状态不完整，需要重新检查配置流程。
