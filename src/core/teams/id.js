const TEAM_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_TEAM_ID_LENGTH = 128;

function assertTeamId(teamId) {
  if (teamId === "main") {
    throw new Error("main 是受保护名称，不能作为 Team id 操作。");
  }
  if (typeof teamId !== "string" || !TEAM_ID_PATTERN.test(teamId)) {
    throw new Error(`teamId 无效：${String(teamId || "")}`);
  }
  if (teamId.length > MAX_TEAM_ID_LENGTH) {
    throw new Error(`Team id 不能超过 ${MAX_TEAM_ID_LENGTH} 个字符。`);
  }
  return teamId;
}

module.exports = {
  MAX_TEAM_ID_LENGTH,
  TEAM_ID_PATTERN,
  assertTeamId
};
