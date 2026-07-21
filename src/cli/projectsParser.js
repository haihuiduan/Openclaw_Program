const CREATE_OPTIONS = new Map([
  ["--name", "name"], ["--team", "teamId"], ["--description", "description"],
  ["--execution-mode", "executionMode"], ["--max-concurrency", "maxConcurrency"]
]);
const UPDATE_OPTIONS = new Map([
  ["--name", "name"], ["--description", "description"],
  ["--execution-mode", "executionMode"], ["--max-concurrency", "maxConcurrency"]
]);

function parseProjectsCommand(args) {
  const [subcommand = "list", ...rest] = args;
  if (subcommand === "list") return exact(subcommand, rest, 0);
  if (["inspect", "activate", "complete", "archive", "unarchive", "sync-preview"].includes(subcommand)) {
    requireCount(`projects ${subcommand}`, rest, 1);
    return { subcommand, projectId: rest[0] };
  }
  if (subcommand === "create") {
    const projectId = requireId("projects create", rest);
    const input = parseValues(rest.slice(1), CREATE_OPTIONS);
    if (input.name === undefined) throw new Error("projects create 需要提供 --name。");
    if (input.teamId === undefined) throw new Error("projects create 需要提供 --team。");
    return { subcommand, input: { projectId, ...input } };
  }
  if (subcommand === "update") {
    const projectId = requireId("projects update", rest);
    const patch = parseValues(rest.slice(1), UPDATE_OPTIONS);
    if (!Object.keys(patch).length) throw new Error("projects update 至少需要一个更新选项。");
    return { subcommand, projectId, patch };
  }
  if (subcommand === "sync-team") {
    const projectId = requireId("projects sync-team", rest);
    const options = rest.slice(1);
    let confirm = false;
    let expectedSourceTeamUpdatedAt;
    let syncExecutionSettings = false;
    for (let index = 0; index < options.length; index += 1) {
      const option = options[index];
      if (option === "--confirm") {
        if (confirm) throw new Error("projects sync-team 的 --confirm 不能重复。");
        confirm = true;
      } else if (option === "--sync-execution-settings") {
        if (syncExecutionSettings) throw new Error("--sync-execution-settings 不能重复。");
        syncExecutionSettings = true;
      } else if (option === "--expected-team-updated-at") {
        if (expectedSourceTeamUpdatedAt !== undefined) throw new Error("--expected-team-updated-at 不能重复。");
        expectedSourceTeamUpdatedAt = requireValue(option, options[index + 1]);
        index += 1;
      } else {
        throw new Error("未知或不支持的 projects 选项：" + option);
      }
    }
    if (!confirm) throw new Error("projects sync-team 必须提供 --confirm。");
    if (!expectedSourceTeamUpdatedAt) throw new Error("projects sync-team 需要提供 --expected-team-updated-at。");
    return { subcommand, projectId, input: { confirm, expectedSourceTeamUpdatedAt, syncExecutionSettings } };
  }
  throw new Error(`未知 projects 子命令：${subcommand}\n请运行 openclaw-installer help 查看可用命令。`);
}

function parseValues(args, optionMap) {
  const result = {};
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    const field = optionMap.get(option);
    if (!field) throw new Error("未知或不支持的 projects 选项：" + option);
    if (Object.hasOwn(result, field)) throw new Error("projects 选项不能重复：" + option);
    const value = requireValue(option, args[index + 1]);
    result[field] = field === "maxConcurrency" ? Number(value) : value;
    index += 1;
  }
  return result;
}
function requireId(command, rest) {
  if (!rest[0] || rest[0].startsWith("--")) throw new Error(command + " 需要提供 project id。");
  return rest[0];
}
function exact(subcommand, rest, count) {
  requireCount(`projects ${subcommand}`, rest, count);
  return { subcommand };
}
function requireCount(command, args, count) {
  if (args.length !== count) throw new Error(`${command} ${count ? `需要 ${count} 个参数` : "不接受额外参数"}。`);
}
function requireValue(option, value) {
  if (value === undefined || value.startsWith("--")) throw new Error(option + " 需要提供值。");
  return value;
}

module.exports = { parseProjectsCommand };
