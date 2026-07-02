# 手动测试记录

## 项目名称

OpenClaw Installer

## 测试目的

本文档用于记录 OpenClaw Installer CLI 核心版在真实 macOS 终端环境中的手动验证结果。

自动化测试主要用于验证代码逻辑、命令分发、dry-run、错误分支和 mock 场景。手动测试用于确认这些命令在真实终端环境中运行时，是否符合预期。

## 测试环境

| 项目 | 内容 |
|---|---|
| 测试日期 | 2026-07-01 |
| macOS 版本 | 26.4.1 |
| CPU 架构 | Apple Silicon arm64 |
| Node.js 版本 | 26.4.0 |
| npm 版本 | 11.17.0 |
| Git 版本 | git version 2.39.5 (Apple Git-154) |
| 测试前是否已安装 OpenClaw | 是 |
| OpenClaw 版本 | OpenClaw 2026.6.10 (aa69b12) |
| 测试命令来源 | openclaw-installer |

## 测试说明

本次测试重点确认以下内容：

- 安装器命令名已经改为 `openclaw-installer`
- 官方 OpenClaw 命令仍然保留为 `openclaw`
- dry-run 不会修改系统
- configure dry-run 不会启动真实交互式配置向导
- verify 只做基础可用性验证
- CLI 输出和 README 描述基本一致

---

## 1. 帮助命令测试

### 命令

```bash
openclaw-installer help
```

### 预期结果

- 能正常显示帮助信息。
- 能看到 `doctor / install / configure / verify / setup / help / version` 等命令。
- 安装器命令名显示为 `openclaw-installer`。
- 不再把 `openclaw` 当成本项目安装器命令。

### 实际结果

命令正常执行，成功显示 OpenClaw 安装助手帮助信息。

帮助信息中包含以下命令：

- `doctor`
- `install`
- `configure`
- `verify`
- `setup`
- `help`
- `version`

所有安装器命令均使用 `openclaw-installer`，没有继续把 `openclaw` 当成本项目安装器命令。

### 测试状态

通过

### 备注

命令名修改生效，help 输出符合 README 中的当前设计。

---

## 2. 版本命令测试

### 命令

```bash
openclaw-installer version
```

### 预期结果

- 能正常输出当前 npm 包版本。
- 当前预期版本为 `0.1.0`。

### 实际结果

命令正常执行，输出版本号：

```text
0.1.0
```

### 测试状态

通过

### 备注

输出版本号与 `package.json` 中的 npm 包版本一致。

---

## 3. 环境检测测试

### 命令

```bash
openclaw-installer doctor
```

### 预期结果

- 能检测 Node.js。
- 能检测 npm。
- 能检测 Git。
- 能检测 macOS 系统。
- 能检测 CPU 架构。
- 能检测官方 `openclaw` 命令是否存在。
- 能尝试读取 OpenClaw 版本。
- 能检测 npm 网络访问。
- 能检测目标安装目录状态。
- warning 不应直接导致整体失败。
- 只有 fail 级别问题才会导致整体失败。

### 实际结果

命令正常执行，环境检测报告显示：

- Node.js 版本检测通过，当前版本为 26.4.0
- node 命令已找到
- npm 命令已找到
- git 命令已找到
- macOS 系统检测通过
- CPU 架构为 Apple Silicon arm64，检测通过
- OpenClaw 已安装，版本为 OpenClaw 2026.6.10 (aa69b12)
- npm registry 可以访问
- 目标目录存在且可写

最终结论为：

当前环境满足基本要求，可以继续安装或使用 OpenClaw。

### 测试状态

通过

### 备注

doctor 在真实终端环境下通过，说明当前机器满足安装器的基础检测要求。

---

## 4. 安装预演测试

### 命令

```bash
openclaw-installer install --dry-run
```

### 预期结果

- 不下载官方安装脚本。
- 不执行 bash 安装。
- 不创建安装日志。
- 不修改系统。
- 只展示正式安装时将会执行的步骤。
- 如果 doctor 发现阻塞问题，应提示正式安装会停止。
- 如果官方 OpenClaw 已安装，应提示正式安装时不会重复安装。

### 实际结果

命令正常执行，显示 OpenClaw 模拟安装报告。

当前处于 dry-run 模式，没有修改任何文件。

检查结果显示：

- 环境检测通过
- OpenClaw 已安装，当前版本为 OpenClaw 2026.6.10 (aa69b12)
- 真实安装时不会重复安装

安装流程预览包含以下步骤：

1. 环境检测
2. 检查 OpenClaw 是否已安装
3. 准备目标安装目录
4. 下载 OpenClaw 官方安装脚本：https://openclaw.ai/install.sh
5. 执行官方安装脚本
6. 验证 openclaw 命令

最终结论为：

dry-run 已完成，没有修改任何文件。

### 测试状态

通过

### 备注

dry-run 行为符合预期：没有真实下载安装脚本，没有执行 bash，也没有进行重复安装。

---

## 5. 配置预演测试

### 命令

```bash
openclaw-installer configure --dry-run
```

### 预期结果

- 不启动真实交互式配置向导。
- 不要求输入 API Key。
- 不写 OpenClaw 配置文件。
- 能提示正式配置时将调用官方命令：`openclaw onboard --install-daemon`

### 实际结果

命令正常执行，显示将启动 OpenClaw 官方配置向导：

```bash
openclaw onboard --install-daemon
```

未进入真实交互式配置流程，也没有要求输入 API Key。

### 测试状态

通过

### 备注

configure dry-run 行为符合预期，只预览官方配置命令，不实际执行交互式向导。

---

## 6. 安装验证测试

### 命令

```bash
openclaw-installer verify
```

### 预期结果

- 能检测官方 `openclaw` 命令是否存在。
- 能执行 `openclaw --version`。
- 能尝试执行 `openclaw config file`。
- 如果配置文件路径读取失败，可以显示 warning。
- 当前 verify 暂不验证 API Key。
- 当前 verify 暂不验证模型调用。
- 当前 verify 暂不验证 Gateway。
- 当前 verify 暂不验证 daemon。
- 当前 verify 暂不验证真实 prompt 请求。

### 实际结果

命令正常执行，验证报告显示：

- OpenClaw 命令已找到
- OpenClaw 版本读取成功：OpenClaw 2026.6.10 (aa69b12)
- 配置文件路径已检测到：~/.openclaw/openclaw.json

最终结论为：

OpenClaw 已安装并可以基本使用。

### 测试状态

通过

### 备注

verify 当前只验证基础可用性。本次测试没有验证 API Key、模型调用、Gateway、daemon 或真实 prompt 请求。

---

## 7. 一键准备预演测试

### 命令

```bash
openclaw-installer setup --dry-run
```

### 预期结果

- 能展示一键准备流程。
- 不执行真实安装。
- 不启动配置向导。
- 不修改系统。
- 能说明正式 setup 会先运行 doctor，再运行 install。
- 能提示后续需要执行 configure 和 verify。

### 实际结果

命令正常执行，显示 OpenClaw 一键准备流程预览。

预览流程包括：

1. 检测环境和依赖
2. 安装 OpenClaw，已安装则跳过
3. 启动 OpenClaw 官方配置向导
4. 验证 OpenClaw 是否可用

输出说明默认 setup 不会自动填写 API Key，配置阶段会调用 OpenClaw 官方配置向导。

最终结论为：

dry-run 已完成，没有修改任何文件。

### 测试状态

通过

### 备注

setup dry-run 行为符合预期，没有执行真实安装，没有启动配置向导，也没有修改系统。

---

## 8. 命令名验证测试

### 命令

```bash
which openclaw-installer
which openclaw
```

### 预期结果

- `openclaw-installer` 指向本项目安装器。
- `openclaw` 指向官方 OpenClaw 本体。
- 两个命令不应指向同一个可执行文件。
- 本项目不再占用官方 `openclaw` 命令名。

### 实际结果

命令输出：

```text
/opt/homebrew/bin/openclaw-installer
/opt/homebrew/bin/openclaw
```

`openclaw-installer` 和 `openclaw` 都存在，并且命令名已经区分。

### 测试状态

通过

### 备注

本项目安装器命令为 `openclaw-installer`，官方 OpenClaw 命令为 `openclaw`。当前项目不再占用官方 `openclaw` 命令名。

---

## 9. 自动化测试确认

### 命令

```bash
npm test
```

### 预期结果

```text
tests 53
pass 53
fail 0
```

### 实际结果

`npm test` 正常通过，结果为：

```text
tests 53
pass 53
fail 0
cancelled 0
skipped 0
todo 0
```

### 测试状态

通过

### 备注

自动化测试结果与 README 当前描述一致。

---

## 总结

### 测试结果汇总

| 项目 | 数量 / 结果 |
|---|---|
| 手动测试项总数 | 8 |
| 通过数量 | 8 |
| 失败数量 | 0 |
| warning 数量 | 0 |
| 自动化测试结果 | tests 53，pass 53，fail 0 |

### 当前结论

本次手动测试在真实 macOS 终端环境中完成。`openclaw-installer` 命令可以正常运行，help、version、doctor、install dry-run、configure dry-run、verify、setup dry-run 和命令名验证均符合预期。

当前 CLI 核心版已经完成基础可用性验证。安装器命令已与官方 OpenClaw 命令区分：本项目使用 `openclaw-installer`，官方 OpenClaw 本体继续使用 `openclaw`。

需要注意的是，本次测试环境中 OpenClaw 已经提前安装，因此还没有验证“干净 macOS 机器从未安装 OpenClaw 到安装成功”的完整真实流程。

### 后续待验证内容

- 干净 macOS 机器从未安装 OpenClaw 到安装成功的完整流程。
- 真实执行 `openclaw-installer install`。
- 真实执行 `openclaw-installer configure` 并进入官方交互式配置向导。
- API Key 是否有效。
- 模型是否可以成功调用。
- Gateway 是否正常运行。
- daemon 是否正常运行。
- 一次真实 prompt 请求是否成功。