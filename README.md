# OpenClaw Installer

## 项目简介

OpenClaw Installer 是一个面向 macOS 用户的 OpenClaw 安装、配置引导与验证助手。它的目标是降低普通用户使用命令行安装 OpenClaw 的门槛，把环境检测、安装、官方配置向导和安装后验证整理成一套清晰的 CLI 流程。

当前版本是 CLI 核心版，不是完整 GUI 产品。后续可以把这些核心能力复用到 Electron GUI 中，作为“一键安装”和“配置引导”的底层能力。

## 当前版本状态

当前版本：v0.5 CLI 一键准备版

已完成主流程：

- doctor：环境和依赖检测。
- install：通过 OpenClaw 官方 `install.sh` 安装 OpenClaw。
- configure：启动 OpenClaw 官方配置向导。
- verify：安装和配置后的基础验收。
- setup：串联 doctor + install，并提示后续 configure + verify。

自动化测试当前覆盖 CLI 分发、doctor、install、configure、verify、setup、dry-run、失败分支和安装日志，当前共 52 个测试通过。

## 功能列表

### 环境检测 doctor

`doctor` 用于检测当前电脑是否具备安装和运行 OpenClaw 的基础条件，包括 Node.js、node、npm、git、操作系统、CPU 架构、OpenClaw 状态、npm 网络访问和目标安装目录。

doctor 只做检测，不安装、不下载、不写配置文件。

### 一键安装 install

`install` 会先运行环境检测，再检查系统中是否已经存在 `openclaw` 命令。如果已经安装，会跳过重复安装。

如果未安装，当前版本会使用 OpenClaw 官方安装脚本：

```text
https://openclaw.ai/install.sh
```

本项目不会直接执行 `curl | bash` 管道，而是先下载官方脚本到临时目录，再使用 bash 执行本地脚本，并通过 `openclaw --version` 验证安装结果。

### 安装预演 dry-run

`install --dry-run` 用于预览安装流程。它只展示计划和只读检查，不下载脚本、不执行 bash、不创建目录、不修改系统。

### 官方配置向导 configure

`configure` 用于启动 OpenClaw 官方配置流程，默认执行：

```bash
openclaw onboard --install-daemon
```

`configure --reconfigure` 用于重新进入 OpenClaw 官方配置流程，执行：

```bash
openclaw configure
```

### 安装后验证 verify

`verify` 用于检查 OpenClaw 是否已经安装并基本可用。当前会检查：

- 系统中是否存在 `openclaw` 命令。
- `openclaw --version` 是否可用。
- `openclaw config file` 是否可以读取官方配置文件路径。

如果 `openclaw config file` 暂时不可用，会作为警告提示，不会直接判定 OpenClaw 不可用。

### 一键准备 setup

`setup` 是完整流程入口，适合未来 GUI 的“一键开始”按钮复用。当前默认流程是：

1. 运行 doctor。
2. doctor 通过后运行 install。
3. install 成功或检测到已安装后，提示用户继续运行 configure 和 verify。

第一版 setup 默认不会自动执行 configure，因为官方配置向导可能需要用户输入 API Key。

### 安装日志

正式 `install` 会写入安装日志，方便安装失败时排查问题。dry-run 不写日志。

日志目录：

```text
~/.openclaw-installer/logs/
```

### 自动化测试

项目使用 Node.js 原生 test runner，当前测试覆盖核心命令、dry-run、失败分支、安装日志和流程编排。

## 安装方式

开发阶段先安装依赖：

```bash
npm install
```

如果需要在本机开发时使用 `openclaw` 命令，可以执行：

```bash
npm link
openclaw doctor
openclaw setup
```

`npm link` 是开发阶段的本地链接方式，不代表已经发布到 npm。

## 使用方式

常用开发命令：

```bash
npm run doctor
npm test
```

直接通过 Node.js 运行：

```bash
node bin/cli.js doctor
node bin/cli.js install
node bin/cli.js install --dry-run
node bin/cli.js configure
node bin/cli.js configure --dry-run
node bin/cli.js configure --reconfigure
node bin/cli.js verify
node bin/cli.js verify --dry-run
node bin/cli.js setup
node bin/cli.js setup --dry-run
node bin/cli.js help
node bin/cli.js version
```

如果已经执行过 `npm link`，也可以使用：

```bash
openclaw doctor
openclaw setup
```

## 推荐使用流程

推荐普通用户按这个顺序使用：

1. `node bin/cli.js setup`
2. `node bin/cli.js configure`
3. `node bin/cli.js verify`

如果希望分步执行：

1. `node bin/cli.js doctor`
2. `node bin/cli.js install`
3. `node bin/cli.js configure`
4. `node bin/cli.js verify`

## 命令说明

| 命令 | 作用 |
| --- | --- |
| `openclaw doctor` | 检测电脑环境、OpenClaw 状态、网络和安装目录 |
| `openclaw install` | 通过 OpenClaw 官方安装脚本安装 OpenClaw，已安装则跳过 |
| `openclaw install --dry-run` | 预览安装流程，不下载、不执行、不修改系统 |
| `openclaw configure` | 启动 OpenClaw 官方配置向导 |
| `openclaw configure --dry-run` | 预览配置流程，不执行官方命令 |
| `openclaw configure --reconfigure` | 修改已有 OpenClaw 配置 |
| `openclaw verify` | 验证 OpenClaw 是否已经安装并基本可用 |
| `openclaw verify --dry-run` | 预览验证项目，不执行检查命令 |
| `openclaw setup` | 串联 doctor + install，并提示后续 configure + verify |
| `openclaw setup --dry-run` | 预览完整准备流程，不执行实际步骤 |
| `openclaw help` | 查看帮助信息 |
| `openclaw version` | 查看当前安装助手版本 |

## 安装日志

正式执行 `install` 时，安装日志会写入：

```text
~/.openclaw-installer/logs/
```

日志内容包括安装开始时间、平台信息、Node.js 版本、目标目录、doctor 检测摘要、OpenClaw 已安装检测结果、官方脚本下载结果、bash 执行输出摘要、`openclaw --version` 验证结果，以及最终成功或失败结论。

`install --dry-run` 不写日志文件。

## 配置说明

本项目不直接保存 API Key，不自己写 OpenClaw 的官方配置文件，也不自己维护 Provider、Model、Base URL 等配置。

API Key、模型服务商、模型名称等配置交给 OpenClaw 官方 onboarding/configure 流程处理。本项目的 `configure` 命令只是启动官方流程，方便用户和未来 GUI 调用。

## 测试

运行测试：

```bash
npm test
```

当前测试覆盖：

- CLI 命令分发。
- doctor 环境检测。
- install 安装流程、dry-run、失败分支和安装日志。
- configure 官方配置流程封装。
- verify 安装后基础验收。
- setup 完整流程编排。
- 用户可见中文错误提示。
- 敏感信息不直接输出到终端。

## 项目结构

```text
bin/cli.js                    CLI 可执行入口
src/cli                       命令解析和终端输出层
src/cli/presenters            中文输出格式化
src/core/doctor               环境和依赖检测
src/core/installer            安装计划、安装执行和安装日志接入
src/core/configure            OpenClaw 官方配置向导封装
src/core/verify               安装后基础验收
src/core/setup                doctor + install 的流程编排
src/config                    默认配置和运行时配置合并
src/utils                     通用工具
src/utils/shell               系统命令执行封装
tests                         自动化测试
```

## 当前限制

- 当前是 CLI 核心版，不是 GUI 桌面应用。
- 真实安装依赖 OpenClaw 官方 `install.sh`。
- 尚未在大量干净 macOS 机器上验证。
- 目前没有 repair 自动修复命令。
- 目前没有 update 更新命令。
- 目前没有 GUI 桌面应用。
- 目前没有角色市场、场景模板等增强功能。
- setup 默认不会自动执行 configure，因为配置流程可能需要用户手动输入 API Key。

## 后续计划

1. 增加 `repair` 自动修复能力。
2. 增加 `update` 更新 OpenClaw。
3. 开发 GUI 桌面应用。
4. 在 GUI 中增加查看日志按钮。
5. 增加 OpenClaw 启动、停止、状态管理。
6. 增加面向国内用户的网络提示和排障建议。
7. 增加场景模板和角色管理。

## 开发定位

OpenClaw Installer 当前的核心价值，是把原本需要用户手动输入命令的 OpenClaw 安装、配置和验证过程封装成可复用的 CLI 流程。

这套 CLI 核心既可以直接给开发者和早期用户使用，也可以作为后续 GUI 一键安装器的底层能力。

## License

MIT
