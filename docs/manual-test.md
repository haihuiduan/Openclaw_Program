# 手动测试记录

## 项目名称

OpenClaw Installer

## 测试目的

本文档用于记录 OpenClaw Installer CLI 核心版在真实 macOS 终端环境中的手动验证结果。

自动化测试主要通过 mock 验证命令流程、分支逻辑和错误处理。手动测试用于确认这些命令在真实机器上运行时的表现是否符合预期。

## 测试环境

- 测试日期：
- macOS 版本：
- CPU 架构：
- Node.js 版本：
- npm 版本：
- Git 版本：
- 测试前是否已安装 OpenClaw：是 / 否
- OpenClaw 版本：

## 测试命令

### 1. 帮助命令

命令：

```bash
openclaw-installer help