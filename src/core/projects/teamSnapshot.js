const { assertInstanceId } = require("../agent-instances/id");
const { assessTeamHealth } = require("../teams/health");

const EXECUTION_MODES = new Set(["confirm", "auto"]);

function captureTeamSnapshot(team, capturedAt) {
  return normalizeTeamSnapshot({
    managerInstanceId: team.managerInstanceId,
    memberInstanceIds: team.memberInstanceIds,
    executionMode: team.executionMode,
    maxConcurrency: team.maxConcurrency,
    capturedAt,
    sourceTeamUpdatedAt: team.updatedAt
  });
}

function normalizeTeamSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("teamSnapshot 必须是 JSON 对象");
  }
  const managerInstanceId = assertInstanceId(requiredText(
    snapshot.managerInstanceId,
    "teamSnapshot.managerInstanceId"
  ));
  if (!Array.isArray(snapshot.memberInstanceIds) || snapshot.memberInstanceIds.length === 0) {
    throw new Error("teamSnapshot.memberInstanceIds 必须至少包含一个 Instance ID");
  }
  const memberInstanceIds = snapshot.memberInstanceIds.map((value) => (
    assertInstanceId(requiredText(value, "teamSnapshot.memberInstanceIds"))
  ));
  if (new Set(memberInstanceIds).size !== memberInstanceIds.length) {
    throw new Error("teamSnapshot.memberInstanceIds 不能重复");
  }
  memberInstanceIds.sort((left, right) => left.localeCompare(right));
  if (!memberInstanceIds.includes(managerInstanceId)) {
    throw new Error("teamSnapshot.managerInstanceId 必须属于成员列表");
  }
  const executionMode = requiredText(snapshot.executionMode, "teamSnapshot.executionMode");
  if (!EXECUTION_MODES.has(executionMode)) {
    throw new Error("teamSnapshot.executionMode 必须是 confirm 或 auto");
  }
  const maxConcurrency = normalizeConcurrency(snapshot.maxConcurrency, "teamSnapshot.maxConcurrency");
  return {
    managerInstanceId,
    memberInstanceIds,
    executionMode,
    maxConcurrency,
    capturedAt: requiredTimestamp(snapshot.capturedAt, "teamSnapshot.capturedAt"),
    sourceTeamUpdatedAt: requiredTimestamp(
      snapshot.sourceTeamUpdatedAt,
      "teamSnapshot.sourceTeamUpdatedAt"
    )
  };
}

function compareTeamSnapshot(snapshot, team) {
  const fields = [];
  if (snapshot.managerInstanceId !== team.managerInstanceId) fields.push("managerInstanceId");
  if (!sameArray(snapshot.memberInstanceIds, [...team.memberInstanceIds].sort())) {
    fields.push("memberInstanceIds");
  }
  if (snapshot.executionMode !== team.executionMode) fields.push("executionMode");
  if (snapshot.maxConcurrency !== team.maxConcurrency) fields.push("maxConcurrency");
  return fields;
}

function assessSnapshotHealth(snapshot, instanceState) {
  const result = assessTeamHealth({
    managerInstanceId: snapshot.managerInstanceId,
    memberInstanceIds: snapshot.memberInstanceIds
  }, instanceState);
  return result.health;
}

function normalizeConcurrency(value, field = "maxConcurrency") {
  if (!Number.isInteger(value) || value < 1 || value > 32) {
    throw new Error(`${field} 必须是 1 到 32 之间的整数`);
  }
  return value;
}

function requiredText(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(field + " 必须是非空字符串");
  }
  return value.trim();
}

function requiredTimestamp(value, field) {
  const normalized = requiredText(value, field);
  if (!Number.isFinite(Date.parse(normalized))) {
    throw new Error(field + " 必须是有效时间");
  }
  return normalized;
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

module.exports = {
  assessSnapshotHealth,
  captureTeamSnapshot,
  compareTeamSnapshot,
  normalizeConcurrency,
  normalizeTeamSnapshot
};
