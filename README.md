# OpenClaw Installer

## 项目简介

OpenClaw Installer 是一个基于 Node.js 的一键安装与环境检测工具，用于帮助国内非技术用户准备 OpenClaw CLI 运行环境。

当前阶段重点完善 CLI 骨架、doctor 安装前环境体检，以及 installer 的安装计划框架。doctor 检测电脑环境、OpenClaw 安装状态、网络访问和安装目录，不判断 AI 配置是否完整。

## 开发阶段测试

```bash
npm install
npm run doctor
node bin/cli.js doctor
node bin/cli.js help
node bin/cli.js install --dry-run
node bin/cli.js install
```

## 正式用户使用

```bash
npm install -g openclaw-installer
openclaw doctor
openclaw install --dry-run
openclaw install
openclaw help
```

## CLI 命令说明

`openclaw doctor`

检测电脑环境、OpenClaw 状态、网络和安装目录。doctor 只负责安装前环境检测，不安装、不下载、不修改配置。

`openclaw install --dry-run`

预览安装流程，运行只读检查，不创建目录、不下载文件、不安装依赖、不写配置、不修改系统。

`openclaw install`

执行当前安装流程。当前版本已具备环境检测、防重复安装和目标目录初始化能力。

请注意：下载 OpenClaw 安装资源、安装依赖、最终验证 openclaw 命令仍在后续版本实现，当前不要把它理解为完整安装器。

`openclaw help`

显示可用命令和选项说明。

`openclaw version`

显示当前安装助手版本。

## doctor 当前检测项

- Node.js 版本是否满足最低要求。
- `node`、`npm`、`git` 命令是否可用。
- 当前操作系统是否为第一版主要支持的 macOS。
- CPU 架构是否为 arm64 或 x64。
- 系统中是否已经存在 `openclaw` 命令，并尝试读取版本。
- npm registry 是否可以访问。
- 目标安装目录是否存在、是否可写。

## installer 当前状态

installer 现在基于统一的安装计划运行：

1. 环境检测。
2. 检查 OpenClaw 是否已安装。
3. 准备目标安装目录。
4. 获取 OpenClaw 安装资源（后续实现）。
5. 安装依赖（后续实现）。
6. 验证 openclaw 命令（后续实现）。

dry-run 会展示完整安装计划，并只运行只读检查。正式 install 当前只真实执行到目标目录初始化。

## AI 服务配置

AI 服务商、API Key、Base URL、默认模型配置属于安装后的配置流程，后续会由独立的 `config` 模块处理。

doctor 当前只负责安装前环境检测，不再判断 AI 配置是否完整，也不会读取或展示 API Key 状态。

## 项目架构

`bin/cli.js`

CLI 入口文件，负责接收用户命令并分发到内部模块。

`src/index.js`

程序公共入口，同时支持 CLI 调用、测试和未来 GUI 使用。

`src/cli`

命令解析层，负责解析用户输入并格式化终端输出。

`src/core/doctor`

环境检测模块，用于判断系统依赖、网络、OpenClaw 状态和安装目录是否满足要求。

`src/core/installer`

安装计划与安装流程控制模块，负责生成安装计划、执行 dry-run 和当前已实现的安装初始化步骤。

`src/config`

配置管理模块，用于管理默认配置与用户运行时配置。

`src/utils/shell`

系统命令执行封装模块，用于统一执行系统命令和设置超时。

## 后续计划

- 完成 OpenClaw 安装资源获取。
- 完成依赖安装与安装结果验证。
- 新增 `openclaw config`，用于配置 AI 服务商、API Key、Base URL 和默认模型。
- 新增 `openclaw repair`，用于自动修复部分环境问题。
- 新增 `openclaw update`，用于更新 OpenClaw。
- 增加 Electron GUI。
- 增加更完整的安装、回滚和日志能力。

## License

MIT
