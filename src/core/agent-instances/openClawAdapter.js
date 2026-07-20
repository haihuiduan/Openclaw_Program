const path = require("node:path");
const { runCommand } = require("../../utils/shell");

const DEFAULT_COMMAND_TIMEOUT_MS = 15000;

function createOpenClawAdapter(options = {}) {
  const commandRunner = options.commandRunner || runCommand;
  const command = options.command || "openclaw";
  const timeoutMs = options.timeoutMs || DEFAULT_COMMAND_TIMEOUT_MS;

  return {
    async listAgents() {
      const result = await runSafely(
        commandRunner,
        command,
        ["agents", "list", "--json"],
        timeoutMs,
        "读取 OpenClaw Agent 列表失败"
      );
      const payload = parseJsonOutput(result.stdout, "OpenClaw Agent 列表");
      const entries = Array.isArray(payload) ? payload : payload && payload.agents;
      if (!Array.isArray(entries)) {
        throw new Error("OpenClaw Agent 列表 JSON 结构无效。");
      }

      const ids = new Set();
      return entries.map((entry) => {
        const agent = normalizeAgent(entry);
        if (ids.has(agent.id)) {
          throw new Error("OpenClaw Agent 列表包含重复 id：" + agent.id);
        }
        ids.add(agent.id);
        return agent;
      }).sort((left, right) => left.id.localeCompare(right.id));
    },

    async registerAgent({ instanceId, workspacePath, agentDir }) {
      const args = [
        "agents", "add", instanceId,
        "--workspace", workspacePath,
        "--agent-dir", agentDir,
        "--non-interactive",
        "--json"
      ];
      const result = await runSafely(
        commandRunner,
        command,
        args,
        timeoutMs,
        "OpenClaw Agent 注册失败"
      );
      return parseJsonOutput(result.stdout, "OpenClaw Agent 注册结果");
    }
  };
}

async function runSafely(commandRunner, command, args, timeoutMs, message) {
  try {
    const result = await commandRunner(command, args, { timeoutMs });
    if (!result || result.code !== 0 || result.timedOut) {
      const suffix = result && result.timedOut ? "（命令超时）" : "";
      throw new Error(message + suffix);
    }
    return result;
  } catch (error) {
    if (error && error.message && error.message.startsWith(message)) {
      throw error;
    }
    const code = error && error.result && Number.isInteger(error.result.code)
      ? `（退出码 ${error.result.code}）`
      : "";
    throw new Error(message + code);
  }
}

function parseJsonOutput(stdout, label) {
  if (typeof stdout !== "string" || !stdout.trim()) {
    throw new Error(label + "没有返回 JSON。");
  }
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(label + "不是有效 JSON。");
  }
}

function normalizeAgent(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error("OpenClaw Agent 记录必须是 JSON 对象。");
  }
  if (typeof entry.id !== "string" || !entry.id.trim()) {
    throw new Error("OpenClaw Agent 记录缺少 id。");
  }
  return {
    id: entry.id.trim(),
    workspacePath: optionalAbsolutePath(entry.workspacePath || entry.workspace),
    agentDir: optionalAbsolutePath(entry.agentDir || entry.agentDirectory)
  };
}

function optionalAbsolutePath(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw new Error("OpenClaw Agent 返回了无效的绝对路径。");
  }
  return path.resolve(value);
}

module.exports = {
  DEFAULT_COMMAND_TIMEOUT_MS,
  createOpenClawAdapter
};
