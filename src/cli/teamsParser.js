const CREATE_VALUE_OPTIONS = new Map([
  ["--name", "name"],
  ["--description", "description"],
  ["--manager", "managerInstanceId"],
  ["--execution-mode", "executionMode"],
  ["--max-concurrency", "maxConcurrency"]
]);
const UPDATE_VALUE_OPTIONS = new Map([
  ["--name", "name"],
  ["--description", "description"],
  ["--execution-mode", "executionMode"],
  ["--max-concurrency", "maxConcurrency"]
]);

function parseTeamsCommand(args) {
  const [subcommand = "list", ...rest] = args;

  if (subcommand === "list") {
    requireArgumentCount("teams list", rest, 0);
    return { subcommand };
  }
  if (subcommand === "inspect") {
    requireArgumentCount("teams inspect", rest, 1);
    return { subcommand, teamId: rest[0] };
  }
  if (subcommand === "create") {
    if (!rest[0] || rest[0].startsWith("--")) {
      throw new Error("teams create 需要提供 team id。");
    }
    const teamId = rest[0];
    const input = parseValueOptions(rest.slice(1), CREATE_VALUE_OPTIONS, true);
    if (input.name === undefined) {
      throw new Error("teams create 需要提供 --name。");
    }
    if (input.managerInstanceId === undefined) {
      throw new Error("teams create 需要提供 --manager。");
    }
    if (!input.memberInstanceIds || input.memberInstanceIds.length === 0) {
      throw new Error("teams create 至少需要提供一个 --member。");
    }
    if (!input.memberInstanceIds.includes(input.managerInstanceId)) {
      throw new Error("teams create 的 --manager 必须同时通过 --member 显式加入团队。");
    }
    return { subcommand, teamId, input };
  }
  if (subcommand === "update") {
    if (!rest[0] || rest[0].startsWith("--")) {
      throw new Error("teams update 需要提供 team id。");
    }
    const teamId = rest[0];
    const patch = parseValueOptions(rest.slice(1), UPDATE_VALUE_OPTIONS, false);
    if (Object.keys(patch).length === 0) {
      throw new Error("teams update 至少需要提供一个可更新选项。");
    }
    return { subcommand, teamId, patch };
  }
  if (["add-member", "remove-member", "set-manager"].includes(subcommand)) {
    requireArgumentCount(`teams ${subcommand}`, rest, 2);
    return { subcommand, teamId: rest[0], instanceId: rest[1] };
  }
  if (subcommand === "delete") {
    if (!rest[0] || rest[0].startsWith("--")) {
      throw new Error("teams delete 需要提供 team id。");
    }
    const teamId = rest[0];
    const options = rest.slice(1);
    if (options.some((value) => value !== "--confirm")) {
      throw new Error("teams delete 只支持 --confirm 选项。");
    }
    if (options.filter((value) => value === "--confirm").length !== 1) {
      throw new Error("teams delete 必须提供 --confirm，确认只删除 Team State。");
    }
    return { subcommand, teamId, confirm: true };
  }

  throw new Error(
    `未知 teams 子命令：${subcommand}\n` +
    "请运行 openclaw-installer help 查看可用命令。"
  );
}

function parseValueOptions(args, optionMap, allowMembers) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (allowMembers && option === "--member") {
      const member = requireOptionValue(option, args[index + 1]);
      result.memberInstanceIds = result.memberInstanceIds || [];
      result.memberInstanceIds.push(member);
      index += 1;
      continue;
    }

    const field = optionMap.get(option);
    if (!field) {
      throw new Error("未知或不支持的 teams 选项：" + option);
    }
    if (Object.hasOwn(result, field)) {
      throw new Error("teams 选项不能重复：" + option);
    }
    const value = requireOptionValue(option, args[index + 1]);
    result[field] = field === "maxConcurrency" ? Number(value) : value;
    index += 1;
  }
  return result;
}

function requireOptionValue(option, value) {
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${option} 需要提供值。`);
  }
  return value;
}

function requireArgumentCount(command, args, expected) {
  if (args.length !== expected) {
    const suffix = expected === 0 ? "不接受额外参数" : `需要 ${expected} 个参数`;
    throw new Error(`${command} ${suffix}。`);
  }
}

module.exports = {
  parseTeamsCommand
};
