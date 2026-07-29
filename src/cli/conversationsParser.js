function parseConversationsCommand(args) {
  const [subcommand = "list", ...rest] = args;

  if (subcommand === "list" || subcommand === "reconcile") {
    requireCount(`conversations ${subcommand}`, rest, 0);
    return { subcommand };
  }
  if (subcommand === "inspect") {
    requireCount("conversations inspect", rest, 1);
    return { subcommand, conversationId: rest[0] };
  }
  if (subcommand === "create") {
    const conversationId = requireId(
      "conversations create",
      rest,
      "conversation id"
    );
    return {
      subcommand,
      conversationId,
      input: parseCreateOptions(rest.slice(1))
    };
  }
  if (subcommand === "send") {
    const conversationId = requireId(
      "conversations send",
      rest,
      "conversation id"
    );
    return {
      subcommand,
      conversationId,
      input: parseSendOptions(rest.slice(1))
    };
  }
  if (subcommand === "messages") {
    const conversationId = requireId(
      "conversations messages",
      rest,
      "conversation id"
    );
    return {
      subcommand,
      conversationId,
      filters: parseMessageFilters(rest.slice(1))
    };
  }
  if (subcommand === "archive") {
    const conversationId = requireId(
      "conversations archive",
      rest,
      "conversation id"
    );
    const options = rest.slice(1);
    if (options.length !== 1 || options[0] !== "--confirm") {
      throw new Error("conversations archive 必须提供 --confirm，且不接受其他参数。");
    }
    return {
      subcommand,
      conversationId,
      input: { confirm: true }
    };
  }

  throw new Error(
    `未知 conversations 子命令：${subcommand}\n` +
    "当前不支持 retry、delete、rename、unarchive、--json 或 --message-file。"
  );
}

function parseCreateOptions(args) {
  const input = {};
  const fields = new Map([
    ["--instance", "instanceId"],
    ["--title", "title"],
    ["--project", "projectId"]
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    const field = fields.get(option);
    if (!field) {
      throw new Error("未知或不支持的 conversations create 选项：" + option);
    }
    if (Object.hasOwn(input, field)) {
      throw new Error(`conversations create 的 ${option} 不能重复。`);
    }
    input[field] = requireValue(option, args[index + 1]);
    index += 1;
  }
  if (!input.instanceId) {
    throw new Error("conversations create 需要提供 --instance。");
  }
  return input;
}

function parseSendOptions(args) {
  let message;
  let stdin = false;
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    if (option === "--message") {
      if (message !== undefined) {
        throw new Error("conversations send 的 --message 不能重复。");
      }
      message = requireValue(option, args[index + 1]);
      index += 1;
      continue;
    }
    if (option === "--stdin") {
      if (stdin) {
        throw new Error("conversations send 的 --stdin 不能重复。");
      }
      stdin = true;
      continue;
    }
    if (option === "--message-file") {
      throw new Error("conversations send 不支持 --message-file。");
    }
    throw new Error("未知或不支持的 conversations send 选项：" + option);
  }
  if ((message === undefined && !stdin) || (message !== undefined && stdin)) {
    throw new Error(
      "conversations send 必须且只能提供 --message 或 --stdin 其中一个。"
    );
  }
  return stdin ? { stdin: true } : { message };
}

function parseMessageFilters(args) {
  const filters = {};
  const fields = new Map([
    ["--limit", "limit"],
    ["--before-sequence", "beforeSequence"]
  ]);
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    const field = fields.get(option);
    if (!field) {
      throw new Error("未知 conversations messages 选项：" + option);
    }
    if (Object.hasOwn(filters, field)) {
      throw new Error(`conversations messages 的 ${option} 不能重复。`);
    }
    const value = Number(requireValue(option, args[index + 1]));
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(option + " 必须是正整数。");
    }
    if (field === "limit" && value > 100) {
      throw new Error("--limit 必须是 1 到 100 之间的整数。");
    }
    filters[field] = value;
    index += 1;
  }
  return filters;
}

function requireId(command, args, label) {
  const value = args[0];
  if (!value || value.startsWith("--")) {
    throw new Error(`${command} 需要提供 ${label}。`);
  }
  return value;
}

function requireCount(command, args, count) {
  if (args.length !== count) {
    throw new Error(
      `${command} ${count ? `需要 ${count} 个参数` : "不接受额外参数"}。`
    );
  }
}

function requireValue(option, value) {
  if (value === undefined || value.startsWith("--")) {
    throw new Error(option + " 需要提供值。");
  }
  return value;
}

module.exports = {
  parseConversationsCommand
};
