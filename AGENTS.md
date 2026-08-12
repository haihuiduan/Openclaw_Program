# OpenClaw ToolBox 协作规则

本文件适用于仓库根目录及所有子目录。仓库中的代码、测试和项目文档是项目事实来源，聊天记录不是事实来源。

## 任务开始时的默认读取

每次任务默认只强制完成：

1. 读取本文件。
2. 读取 `docs/PROJECT_HANDOFF.md`。
3. 核对当前 Git 状态：

   ```bash
   git branch --show-current
   git rev-parse HEAD
   git status --short
   ```

4. 读取当前任务直接相关的实现文件和测试文件。

默认不要完整读取全部项目文档，也不要默认读取完整 Git 历史。需要确认暂存区时使用
`git diff --cached --name-only`；需要确认其他 worktree 时再使用 `git worktree list`。

不得只根据旧聊天、文件名、旧方案或记忆猜测当前实现。文档与真实代码或测试冲突时，
以当前代码、测试和 Git 状态为准，并在本次允许写文档时修正文档。

## 按需读取项目知识

根据任务类型读取对应知识库：

- 架构或模块边界任务：读取 `docs/PROJECT_MEMORY.md` 的相关章节。
- 技术、产品或安全决策任务：读取 `docs/DECISIONS.md` 的相关决策。
- Bug 定位、修复或回归：读取 `docs/KNOWN_ISSUES.md` 的相关 Issue。
- 当前状态、测试基线或未提交改动核对：读取 `docs/CURRENT_STATUS.md`。
- 历史阶段或提交背景查询：只搜索 `docs/CHANGELOG.md` 的相关日期或关键词。
- 安装、运行、打包命令：按需读取 `README.md`、`package.json` 和对应脚本。

优先使用关键词搜索和章节范围读取，例如：

```bash
rg -n "关键词" docs/PROJECT_MEMORY.md docs/DECISIONS.md docs/KNOWN_ISSUES.md docs/CHANGELOG.md
sed -n '<起始行>,<结束行>p' <文件>
```

只有任务确实涉及文档全局一致性或无法通过相关章节确认事实时，才全文读取大文件。

## 开发与验证规则

- GUI 应保持 `Renderer → Preload → IPC → GUI Service → 公共 API/Core` 分层。
- Renderer 不得直接使用 Node.js、文件系统或子进程能力。
- GUI 不得复制 Role、Agent Instance、Conversation 或 Execution Core 逻辑。
- OpenClaw 命令必须通过对应 Adapter 或已有命令封装调用。
- State、锁、Lease、脱敏和路径保护不得为方便开发而绕过。
- 不得读取、保存、打印或提交 API Key、Token、Cookie、私钥、完整 Session Key 或原始 OpenClaw JSON。
- 不得把 `dist/`、`.app`、DMG、`node_modules/`、临时 State、lock、lease 或测试产物提交到 Git。
- 未经用户明确授权，不得 commit、merge、push、force push、rebase、reset、stash 或 clean。
- 不得修改与当前任务无关的 worktree。

所有测试、打包、真实安装和 GUI 验收结果必须来自本次或已有可核验记录。不得把 Mock
测试描述成真实 OpenClaw 验收，不得把构建成功描述成新用户安装成功。

## 任务结束前的文档同步

每次允许修改文档的任务结束前：

- 更新 `docs/CURRENT_STATUS.md`：同步当前分支、HEAD、工作区、测试、问题和下一步。
- 更新 `docs/PROJECT_HANDOFF.md`：保持新会话所需的最小当前快照。
- 仅当 Bug 状态、根因或验收结论变化时，更新 `docs/KNOWN_ISSUES.md`。
- 仅当技术、产品、安全决定新增或变化时，更新 `docs/DECISIONS.md`。
- 仅当长期架构、模块职责或系统边界变化时，更新 `docs/PROJECT_MEMORY.md`。
- 仅当功能阶段、重要修复、测试基线或打包能力发生重要变化时，更新 `docs/CHANGELOG.md`。

不要为了“每次都更新”而改写没有变化的长期文档。没有完成应有文档同步的任务不算完成。

如果用户明确要求本轮只读或禁止修改文件，应遵守该限制，在报告中列出待同步内容；
下一次允许写入时优先补齐。

## 文档职责

- `README.md`：面向用户和开发者的使用入口。
- `docs/PROJECT_HANDOFF.md`：新 ChatGPT/Codex 会话的最短当前快照。
- `docs/CURRENT_STATUS.md`：详细的当前状态和未提交改动。
- `docs/PROJECT_MEMORY.md`：长期稳定的产品与架构记忆。
- `docs/DECISIONS.md`：已决定和待决定事项。
- `docs/KNOWN_ISSUES.md`：有证据的问题、根因与验收条件。
- `docs/CHANGELOG.md`：阶段级历史变化。
- `docs/gui-mvp-plan.md`：历史 GUI MVP 方案，不代表当前状态。
- `docs/manual-test-checklist.md`：手动验收参考，执行前应结合当前功能更新。
