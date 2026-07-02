# OpenClaw 官方 Onboarding 流程分析

## 1. 真实测试发现

在真实终端测试中发现，OpenClaw 官方 `install.sh` 安装完成后，可能会进入交互式 setup / onboarding 流程。

这个行为对 GUI 安装器有明显影响：

- 官方安装脚本安装完成后会进入交互式 setup。
- GUI 后台无法可靠处理用户输入、选项选择和 API Key 粘贴。
- 如果把 install 和 configure 混在同一个后台流程里，`execute_script` 可能会卡住，或者被误判为安装失败。
- 因此产品流程上必须拆成两个阶段：install 负责安装 OpenClaw 本体，configure 负责启动官方交互式配置向导。

这个结论决定了 OpenClaw Installer 的产品边界：安装器不替代 OpenClaw 官方配置流程，只负责更清楚地引导用户进入和完成这个流程。

## 2. OpenClaw 官方 onboarding 流程拆解

OpenClaw 官方 onboarding 可能包含以下环节：

1. Security disclaimer
   用户需要确认安全免责声明。个人使用场景下一般选择 Yes。

2. QuickStart
   第一次使用时，QuickStart 更适合普通用户快速完成基础配置。

3. Model/auth provider
   用户选择模型或认证来源，例如 OpenRouter、DeepSeek、OpenAI 等。

4. API Key
   用户粘贴自己的 API Key。OpenClaw Installer 不读取、不保存这部分内容。

5. Default model
   设置默认模型。不熟悉模型名称的用户可以先保持默认。

6. Channel
   选择使用通道。首次体验可以优先建议 ClickClack。

7. ClickClack plugin
   与 Channel 相关的插件配置，适合首次体验的用户按默认建议继续。

8. Web search
   Web 搜索能力。普通用户如果不确定用途，可以先跳过。

9. Skills
   技能扩展能力。第一版安装助手不主动配置，用户可以先跳过。

10. Hooks
    自动化钩子能力。普通用户如果不清楚用途，可以先跳过。

11. Gateway service
    网关服务安装。首次使用建议保持默认安装。

12. Dashboard
    官方流程可能生成 Dashboard URL，用于后续查看或管理。

13. Terminal chat
    配置完成后，官方命令可能引导用户在终端中开始使用 OpenClaw。

## 3. 普通用户痛点

从普通用户视角看，官方 onboarding 的信息量比较大，主要痛点包括：

- 不知道 Terminal 在做什么，容易误以为软件卡住。
- 不知道 Channel 是什么，也不清楚不同选项的影响。
- 不知道 ClickClack 是否应该选择。
- 不知道 Web search、Skills、Hooks 要不要开启。
- 配置完成后不知道需要回到 GUI 做验证。
- “已检测”这类状态文案不够清楚，用户无法判断是否真的配置成功。

这些问题不是 OpenClaw 官方流程本身的错误，而是命令行交互对非技术用户不够直观。GUI 的价值在于把每一步解释清楚，并给用户明确的下一步按钮。

## 4. 产品优化策略

OpenClaw Installer 的 GUI 需要围绕“清楚引导，而不是替代官方配置”来设计：

- 打开 Terminal 前显示简化版流程说明，让用户知道接下来会遇到什么。
- 首次使用推荐 QuickStart + ClickClack，降低选择成本。
- Web search、Skills、Hooks 等增强功能默认建议不懂先跳过。
- 点击“配置 API”后，顶部配置状态显示为“等待验证”。
- 配置说明区域提供“我已完成配置，立即验证”按钮，避免用户不知道下一步该做什么。
- 使用 `configure-done.flag` 判断官方向导是否结束，但不把它当作配置成功的依据。
- 是否配置成功仍然必须以 verify 结果为准。
- 不保存、不读取 API Key，不自己写 OpenClaw 配置文件。

## 5. 当前边界

`configure-done.flag` 只能说明官方配置向导已经结束，不能说明 API Key 一定正确，也不能说明模型一定可调用。

当前 verify 更适合作为基础验收：

- OpenClaw 命令是否存在
- OpenClaw 版本是否可读取
- OpenClaw 配置文件路径是否可读取

它暂时不验证 API Key 是否真实有效，不验证模型调用是否成功，也不验证 Gateway / daemon 的完整运行状态。这些可以作为后续版本的增强能力。
