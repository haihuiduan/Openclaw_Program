# GUI MVP 设计计划

## 项目背景

OpenClaw Installer 是一个面向 macOS 普通用户的 OpenClaw 一键安装、配置引导与验证助手。

当前阶段是 v0.5 CLI 一键准备版，已经实现并验证了以下基础能力：

- `openclaw-installer doctor`
- `openclaw-installer install`
- `openclaw-installer configure`
- `openclaw-installer verify`
- `openclaw-installer setup`
- dry-run 流程预演
- 正式安装日志
- 53 个自动化测试通过
- 真实终端手动测试记录

需要特别区分：

- 本项目安装器命令是 `openclaw-installer`。
- 官方 OpenClaw 命令仍然是 `openclaw`。
- GUI 第一版只把现有 CLI/core 能力图形化。
- GUI 不重写安装逻辑。
- GUI 不自己保存 API Key。
- `configure` 仍然调用 OpenClaw 官方配置向导。

## 1. GUI MVP 目标

GUI MVP 的目标是降低普通用户使用门槛，把当前已经实现的安装器能力做成可点击、可理解、可追踪的桌面界面。

第一版重点不是增加新能力，而是把以下 CLI 流程图形化：

- 环境检测：`doctor`
- 一键安装：`install`
- 官方配置引导：`configure`
- 安装后验证：`verify`
- 一键准备流程：`setup`

用户不需要记住命令，也不需要理解 Node.js 项目结构，只需要按界面按钮完成检测、安装、配置和验证。

## 2. GUI 第一版定位

GUI 第一版是 CLI 核心能力的可视化外壳，不是完整 OpenClaw 桌面产品。

第一版只做：

- 安装前环境检测。
- OpenClaw 官方脚本安装。
- OpenClaw 官方配置向导入口。
- 基础可用性验证。
- 安装日志查看入口。
- 成功、失败、warning 和下一步建议展示。

第一版不做复杂功能，不做新的业务系统，也不替代 OpenClaw 官方配置流程。

## 3. 页面结构

建议 GUI 首页采用单页结构，减少普通用户理解成本。

### 顶部标题区

展示：

- 产品名：OpenClaw Installer
- 副标题：OpenClaw 安装、配置引导与验证助手
- 当前阶段：CLI 核心能力 GUI MVP

顶部应明确这是安装器，不是 OpenClaw 本体。

### 当前状态概览区

展示当前电脑和 OpenClaw 状态摘要，例如：

- 环境状态：未检测 / 通过 / 有警告 / 失败
- OpenClaw 状态：未安装 / 已安装
- OpenClaw 版本：未知 / 版本号
- 配置状态：未知 / 已检测到配置文件路径 / 未检测到配置文件路径
- 最近一次操作结果：成功 / 警告 / 失败

### 主要操作按钮区

放置用户最常用的按钮：

- 开始检测
- 一键安装
- 一键准备
- 配置 API
- 验证可用
- 查看日志

按钮应有明确状态，例如运行中禁用、防止重复点击。

### 输出日志区

用于显示当前操作过程和结果。

内容包括：

- 正在执行的步骤
- 成功信息
- warning
- 失败原因
- 下一步建议

输出区不应直接暴露复杂堆栈，除非用户主动打开详细日志。

### 底部提示区

展示简短说明：

- 本工具使用 OpenClaw 官方安装脚本。
- API Key 配置由 OpenClaw 官方配置向导处理。
- 本工具不保存 API Key。
- 遇到问题可查看安装日志。

## 4. 按钮设计

第一版建议提供以下按钮：

| 按钮 | 对应能力 | 说明 |
| --- | --- | --- |
| 开始检测 | `doctor` | 检测电脑环境、依赖、网络、OpenClaw 状态和安装目录 |
| 一键安装 | `install` | 执行安装流程，已安装则跳过 |
| 一键准备 | `setup` | 串联 doctor + install，并提示后续配置和验证 |
| 配置 API | `configure` | 启动 OpenClaw 官方配置向导 |
| 验证可用 | `verify` | 检查 OpenClaw 是否基本可用 |
| 查看日志 | 打开日志目录 | 打开 `~/.openclaw-installer/logs/` |

按钮文案应面向普通用户，不直接暴露过多技术细节。

## 5. 每个按钮的行为

### 开始检测

点击后调用现有 `doctor` 能力。

建议实现方式：

- GUI 调用 core 层 `runDoctor(config)`；或
- GUI 调用 CLI：`openclaw-installer doctor`

输出区展示 doctor 报告，包括通过项、warning、失败项和结论。

### 一键安装

点击后调用现有 `install` 能力。

建议实现方式：

- GUI 调用 core 层 `installOpenClaw(config)`；或
- GUI 调用 CLI：`openclaw-installer install`

输出区展示：

- doctor 是否通过
- 是否检测到已安装 OpenClaw
- 是否跳过重复安装
- 下载官方安装脚本结果
- 执行安装脚本结果
- `openclaw --version` 验证结果
- 安装日志路径

### 一键准备

点击后调用现有 `setup` 能力。

建议实现方式：

- GUI 调用 core 层 `runSetup(config)`；或
- GUI 调用 CLI：`openclaw-installer setup`

第一版 setup 默认不自动执行 configure，也不自动执行 verify。GUI 应在 setup 成功后提示用户继续点击“配置 API”和“验证可用”。

### 配置 API

点击后调用现有 `configure` 能力。

建议实现方式：

- GUI 调用 CLI：`openclaw-installer configure`
- 或由 Electron 主进程启动官方交互式配置流程

注意：

- `configure` 最终会调用官方 OpenClaw 命令：`openclaw onboard --install-daemon`。
- 重新配置时对应官方命令：`openclaw configure`。
- GUI 不自己保存 API Key。
- GUI 不自己写 OpenClaw 配置文件。

如果官方向导需要终端交互，MVP 阶段可以考虑弹出系统终端执行配置命令，避免在 GUI 内重新实现交互式输入。

### 验证可用

点击后调用现有 `verify` 能力。

建议实现方式：

- GUI 调用 core 层 `runVerify(config)`；或
- GUI 调用 CLI：`openclaw-installer verify`

输出区展示：

- `openclaw` 命令是否存在
- `openclaw --version` 是否成功
- `openclaw config file` 是否能读取配置路径

当前 verify 只是基础可用性验证，不代表模型一定可调用。

### 查看日志

点击后打开日志目录：

```text
~/.openclaw-installer/logs/
```

如果目录不存在，应显示友好提示：

- 尚未生成安装日志。
- 请先执行一次正式安装。

## 6. 状态展示

GUI 应展示以下状态：

- Node.js 状态
- npm 状态
- Git 状态
- macOS 支持状态
- CPU 架构
- OpenClaw 是否安装
- OpenClaw 版本
- 配置文件路径
- 最近一次操作结果

状态建议分为：

- 未检测
- 通过
- 警告
- 失败

状态颜色建议：

- 通过：绿色
- 警告：黄色
- 失败：红色
- 未检测/未知：灰色

颜色不能作为唯一信息来源，应同时显示文字说明。

## 7. 输出区域设计

输出区域应面向普通用户，重点展示“发生了什么”和“下一步做什么”。

建议显示：

- 当前正在执行的命令或步骤
- 每一步结果
- 成功信息
- warning
- 失败原因
- 下一步建议
- 安装日志路径

输出区域不建议直接展示：

- 过长 stdout/stderr
- Node.js 堆栈
- 未脱敏的敏感信息
- API Key、token、secret

失败时建议展示：

1. 简短原因
2. 用户可执行的建议
3. 查看日志入口

## 8. 日志入口

查看日志按钮应打开：

```text
~/.openclaw-installer/logs/
```

日志入口第一版可以只打开系统文件夹，不需要内置日志查看器。

后续版本可以增加：

- 最近一次安装日志
- 日志列表
- 日志搜索
- 一键复制错误摘要
- 脱敏后的错误报告导出

## 9. 第一版明确不做什么

GUI MVP 第一版明确不做：

- 不做 repair。
- 不做 update。
- 不做角色市场。
- 不做场景模板。
- 不做账号系统。
- 不做模型市场。
- 不自己保存 API Key。
- 不验证真实模型调用。
- 不做 Windows/Linux。
- 不做复杂聊天界面。
- 不重写 OpenClaw 官方配置流程。
- 不重写安装脚本逻辑。

这些能力可以进入后续路线图，但不应放进 MVP。

## 10. 技术建议

后续建议使用 Electron 做 GUI MVP。

### 进程职责

Electron 主进程负责：

- 调用 Node.js core 模块。
- 或调用 `openclaw-installer` CLI。
- 打开日志目录。
- 管理系统命令执行。
- 处理权限、路径和平台相关能力。

Electron 渲染进程负责：

- 页面展示。
- 按钮交互。
- 状态展示。
- 输出区域渲染。

渲染进程不应直接写安装逻辑，也不应直接拼系统命令。

### 复用原则

GUI 应保持和 CLI 共用同一套 core 能力：

- `runDoctor`
- `installOpenClaw`
- `runConfigure`
- `runVerify`
- `runSetup`

不要为了 GUI 复制一套安装流程。

### configure 的特殊处理

`configure` 目前依赖官方 OpenClaw 交互式向导。

GUI MVP 有两个可选方案：

1. 点击“配置 API”后打开系统终端执行 `openclaw-installer configure`。
2. 后续再评估把官方配置流程嵌入 GUI 的可行性。

第一版建议优先使用方案 1，风险更低。

## 11. 后续扩展方向

GUI MVP 完成后，可以逐步扩展：

1. 结构化进度事件。
2. 更清晰的错误分类。
3. 内置日志查看器。
4. 打包为 macOS app。
5. 干净机器安装测试。
6. API Key 有效性验证。
7. 模型调用验证。
8. Gateway/daemon 状态检查。
9. OpenClaw 启动、停止、状态管理。
10. 国内网络环境提示和排障建议。

## 结论

GUI MVP 第一版的核心任务不是重新发明安装器，而是把当前已经完成的 CLI/core 流程变得更容易被普通用户使用。

第一版应保持克制：把 doctor、install、configure、verify、setup、日志查看这几个核心能力做好，确认真实 macOS 机器上流程稳定，再进入 repair、update、模型验证和完整 GUI 产品化阶段。
