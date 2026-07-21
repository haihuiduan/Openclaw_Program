const CREATE_OPTIONS = new Map([
  ["--project", "projectId"], ["--title", "title"], ["--description", "description"],
  ["--source", "source"], ["--priority", "priority"], ["--assign", "assignedInstanceId"],
  ["--critical-reason", "criticalReason"], ["--critical-source", "criticalSource"],
  ["--failure-policy", "failurePolicy"], ["--max-retries", "maxRetries"],
  ["--retry-delay-ms", "retryDelayMs"]
]);
const UPDATE_OPTIONS = new Map([
  ["--title", "title"], ["--description", "description"], ["--priority", "priority"],
  ["--failure-policy", "failurePolicy"], ["--max-retries", "maxRetries"],
  ["--retry-delay-ms", "retryDelayMs"]
]);

function parseTasksCommand(args) {
  const [subcommand = "list", ...rest] = args;
  if (subcommand === "list") {
    if (rest.length !== 2 || rest[0] !== "--project") throw new Error("tasks list 需要提供 --project <project-id>。");
    return { subcommand, projectId: requireValue("--project", rest[1]) };
  }
  if (subcommand === "inspect") {
    requireCount("tasks inspect", rest, 1);
    return { subcommand, taskId: rest[0] };
  }
  if (subcommand === "create") {
    const taskId = requireId("tasks create", rest);
    const parsed = parseValues(rest.slice(1), CREATE_OPTIONS, true, true);
    if (!parsed.projectId) throw new Error("tasks create 需要提供 --project。");
    if (parsed.title === undefined) throw new Error("tasks create 需要提供 --title。");
    if (parsed.critical && (!parsed.criticalReason || !parsed.criticalSource)) {
      throw new Error("tasks create 设置 --critical 时必须提供 --critical-reason 和 --critical-source。");
    }
    if (!parsed.critical && (parsed.criticalReason || parsed.criticalSource)) {
      throw new Error("--critical-reason 和 --critical-source 只能与 --critical 一起使用。");
    }
    const input = { taskId, ...parsed };
    if (Object.hasOwn(input, "maxRetries") || Object.hasOwn(input, "retryDelayMs")) {
      input.retryPolicy = {
        ...(Object.hasOwn(input, "maxRetries") ? { maxRetries: input.maxRetries } : {}),
        ...(Object.hasOwn(input, "retryDelayMs") ? { retryDelayMs: input.retryDelayMs } : {})
      };
      delete input.maxRetries;
      delete input.retryDelayMs;
    }
    return { subcommand, input };
  }
  if (subcommand === "update") {
    const taskId = requireId("tasks update", rest);
    const parsed = parseValues(rest.slice(1), UPDATE_OPTIONS, false, false);
    if (!Object.keys(parsed).length) throw new Error("tasks update 至少需要一个更新选项。");
    const patch = { ...parsed };
    if (Object.hasOwn(patch, "maxRetries") || Object.hasOwn(patch, "retryDelayMs")) {
      patch.retryPolicy = {
        ...(Object.hasOwn(patch, "maxRetries") ? { maxRetries: patch.maxRetries } : {}),
        ...(Object.hasOwn(patch, "retryDelayMs") ? { retryDelayMs: patch.retryDelayMs } : {})
      };
      delete patch.maxRetries;
      delete patch.retryDelayMs;
    }
    return { subcommand, taskId, patch };
  }
  if (subcommand === "assign") {
    requireCount("tasks assign", rest, 2);
    return { subcommand, taskId: rest[0], instanceId: rest[1] };
  }
  if (subcommand === "unassign") {
    requireCount("tasks unassign", rest, 1);
    return { subcommand, taskId: rest[0] };
  }
  if (["add-dependency", "remove-dependency"].includes(subcommand)) {
    requireCount(`tasks ${subcommand}`, rest, 2);
    return { subcommand, taskId: rest[0], dependencyTaskId: rest[1] };
  }
  if (["complete", "cancel"].includes(subcommand)) {
    requireCount(`tasks ${subcommand}`, rest, 1);
    return { subcommand, taskId: rest[0] };
  }
  if (subcommand === "set-critical") {
    const taskId = requireId("tasks set-critical", rest);
    const options = rest.slice(1);
    const input = {};
    for (let index = 0; index < options.length; index += 1) {
      const option = options[index];
      const field = option === "--critical" ? "critical" : option === "--reason" ? "reason" : option === "--source" ? "source" : null;
      if (!field) throw new Error("未知或不支持的 tasks set-critical 选项：" + option);
      if (Object.hasOwn(input, field)) throw new Error("tasks set-critical 选项不能重复：" + option);
      const value = requireValue(option, options[index + 1]);
      input[field] = field === "critical" ? parseBoolean(value) : value;
      index += 1;
    }
    if (!Object.hasOwn(input, "critical")) throw new Error("tasks set-critical 需要提供 --critical true|false。");
    if (input.critical && (!input.reason || !input.source)) {
      throw new Error("设置关键 Task 时必须提供 --reason 和 --source。");
    }
    if (!input.critical && (input.reason || input.source)) {
      throw new Error("取消关键标记时不能提供 --reason 或 --source。");
    }
    return { subcommand, taskId, input };
  }
  throw new Error(`未知 tasks 子命令：${subcommand}\n请运行 openclaw-installer help 查看可用命令。`);
}

function parseValues(args, optionMap, allowDependencies, allowCritical) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (allowDependencies && option === "--dependency") {
      result.dependencies = result.dependencies || [];
      result.dependencies.push(requireValue(option, args[index + 1]));
      index += 1;
      continue;
    }
    if (allowCritical && option === "--critical") {
      if (result.critical) throw new Error("tasks create 的 --critical 不能重复。");
      result.critical = true;
      continue;
    }
    const field = optionMap.get(option);
    if (!field) throw new Error("未知或不支持的 tasks 选项：" + option);
    if (Object.hasOwn(result, field)) throw new Error("tasks 选项不能重复：" + option);
    const value = requireValue(option, args[index + 1]);
    result[field] = ["maxRetries", "retryDelayMs"].includes(field) ? Number(value) : value;
    index += 1;
  }
  return result;
}
function parseBoolean(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("--critical 只能是 true 或 false。");
}
function requireId(command, rest) {
  if (!rest[0] || rest[0].startsWith("--")) throw new Error(command + " 需要提供 task id。");
  return rest[0];
}
function requireCount(command, args, count) {
  if (args.length !== count) throw new Error(`${command} 需要 ${count} 个参数。`);
}
function requireValue(option, value) {
  if (value === undefined || value.startsWith("--")) throw new Error(option + " 需要提供值。");
  return value;
}

module.exports = { parseTasksCommand };
