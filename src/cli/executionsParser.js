function parseExecutionsCommand(args) {
  const [subcommand = "list", ...rest] = args;
  if (subcommand === "list") return { subcommand, filters: parseListFilters(rest) };
  if (subcommand === "inspect") {
    requireCount("executions inspect", rest, 1);
    return { subcommand, runId: rest[0] };
  }
  if (subcommand === "run-task") {
    const taskId = requireId("executions run-task", rest, "task id");
    return { subcommand, taskId, input: parseRunOptions(rest.slice(1), "run-task") };
  }
  if (subcommand === "retry") {
    const runId = requireId("executions retry", rest, "run id");
    return { subcommand, runId, input: parseRunOptions(rest.slice(1), "retry", true) };
  }
  if (subcommand === "reconcile") {
    requireCount("executions reconcile", rest, 0);
    return { subcommand };
  }
  throw new Error(
    `未知 executions 子命令：${subcommand}\n` +
    "当前不支持 cancel、pause、follow 或后台执行。"
  );
}

function parseListFilters(args) {
  const filters = {};
  const fields = new Map([["--task", "taskId"], ["--project", "projectId"], ["--status", "status"]]);
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    const field = fields.get(option);
    if (!field) throw new Error("未知 executions list 选项：" + option);
    if (Object.hasOwn(filters, field)) throw new Error("executions list 选项不能重复：" + option);
    filters[field] = requireValue(option, args[index + 1]);
    index += 1;
  }
  return filters;
}

function parseRunOptions(args, command, retry = false) {
  const input = { confirm: false, confirmCritical: false };
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--confirm" || option === "--confirm-critical") {
      const field = option === "--confirm" ? "confirm" : "confirmCritical";
      if (input[field]) throw new Error(`executions ${command} 的 ${option} 不能重复。`);
      input[field] = true;
      continue;
    }
    if (retry) throw new Error("未知 executions retry 选项：" + option);
    if (option === "--instructions") {
      if (Object.hasOwn(input, "instructions")) throw new Error("--instructions 不能重复。");
      input.instructions = requireValue(option, args[index + 1]);
      index += 1;
      continue;
    }
    if (option === "--timeout") {
      if (Object.hasOwn(input, "timeoutMs")) throw new Error("--timeout 不能重复。");
      const seconds = Number(requireValue(option, args[index + 1]));
      if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) {
        throw new Error("--timeout 必须是 1 到 3600 之间的整数秒。");
      }
      input.timeoutMs = seconds * 1000;
      index += 1;
      continue;
    }
    throw new Error(`未知 executions ${command} 选项：${option}`);
  }
  if (!input.confirm) throw new Error(`executions ${command} 必须提供 --confirm。`);
  return input;
}

function requireId(command, rest, label) {
  if (!rest[0] || rest[0].startsWith("--")) throw new Error(`${command} 需要提供 ${label}。`);
  return rest[0];
}
function requireCount(command, args, count) {
  if (args.length !== count) throw new Error(`${command} ${count ? `需要 ${count} 个参数` : "不接受额外参数"}。`);
}
function requireValue(option, value) {
  if (value === undefined || value.startsWith("--")) throw new Error(option + " 需要提供值。");
  return value;
}

module.exports = { parseExecutionsCommand };
