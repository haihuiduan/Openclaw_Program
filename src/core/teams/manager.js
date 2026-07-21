const os = require("node:os");
const path = require("node:path");
const { assertInstanceId } = require("../agent-instances/id");
const {
  readInstanceState
} = require("../agent-instances/state");
const { assessTeamHealth: deriveTeamHealth } = require("./health");
const { assertTeamId } = require("./id");
const {
  getTeamState,
  listTeamStates,
  readTeamState,
  updateTeamState
} = require("./state");

const DEFAULT_TEAM_DATA_DIRECTORY = path.join(os.homedir(), ".openclaw-installer", "teams");
const DEFAULT_TEAM_STATE_PATH = path.join(DEFAULT_TEAM_DATA_DIRECTORY, "state.json");
const DEFAULT_INSTANCE_STATE_PATH = path.join(
  os.homedir(),
  ".openclaw-installer",
  "agent-instances",
  "state.json"
);
const TEAM_UPDATE_FIELDS = new Set([
  "name",
  "description",
  "executionMode",
  "maxConcurrency"
]);
const teamLocks = new Map();

async function listTeams(options = {}) {
  const settings = resolveSettings(options);
  const [teamState, instanceState] = await Promise.all([
    settings.teamStateStore.readTeamState(settings.teamStatePath),
    settings.instanceStateStore.readInstanceState(settings.instanceStatePath)
  ]);
  return listTeamStates(teamState).map((team) => enrichTeam(team, instanceState));
}

async function inspectTeam(teamId, options = {}) {
  assertTeamId(teamId);
  const settings = resolveSettings(options);
  const teamState = await settings.teamStateStore.readTeamState(settings.teamStatePath);
  const team = getTeamState(teamState, teamId);
  if (!team) {
    throw new Error("未找到 Team：" + teamId);
  }
  const instanceState = await settings.instanceStateStore.readInstanceState(
    settings.instanceStatePath
  );
  return enrichTeam(team, instanceState);
}

async function createTeam(teamId, input, options = {}) {
  assertTeamId(teamId);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Team 创建参数必须是对象。");
  }

  return withTeamLock(teamId, async () => {
    const settings = resolveSettings(options);
    const instanceState = await settings.instanceStateStore.readInstanceState(
      settings.instanceStatePath
    );
    const memberInstanceIds = normalizeRequestedMembers(input.memberInstanceIds);
    const managerInstanceId = assertInstanceId(input.managerInstanceId);
    if (!memberInstanceIds.includes(managerInstanceId)) {
      throw new Error("managerInstanceId 必须显式包含在 memberInstanceIds 中。");
    }
    assertRegisteredInstances(instanceState, memberInstanceIds);

    const timestamp = settings.now().toISOString();
    const record = {
      teamId,
      name: input.name,
      description: input.description === undefined ? "" : input.description,
      managerInstanceId,
      memberInstanceIds,
      executionMode: input.executionMode === undefined ? "confirm" : input.executionMode,
      maxConcurrency: input.maxConcurrency === undefined ? 2 : input.maxConcurrency,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    const updated = await settings.teamStateStore.updateTeamState(
      settings.teamStatePath,
      (state) => {
        if (state.teams[teamId]) {
          throw new Error("Team 已存在：" + teamId);
        }
        state.teams[teamId] = record;
        return state;
      }
    );
    return enrichCurrentTeam(getTeamState(updated, teamId), settings);
  });
}

async function updateTeam(teamId, patch, options = {}) {
  assertTeamId(teamId);
  const fields = validateUpdatePatch(patch);

  return withTeamLock(teamId, async () => {
    const settings = resolveSettings(options);
    const updated = await settings.teamStateStore.updateTeamState(
      settings.teamStatePath,
      (state) => {
        const team = requireTeam(state, teamId);
        for (const field of fields) {
          team[field] = patch[field];
        }
        team.updatedAt = settings.now().toISOString();
        return state;
      }
    );
    return enrichCurrentTeam(getTeamState(updated, teamId), settings);
  });
}

async function addTeamMember(teamId, instanceId, options = {}) {
  assertTeamId(teamId);
  assertInstanceId(instanceId);

  return withTeamLock(teamId, async () => {
    const settings = resolveSettings(options);
    const instanceState = await settings.instanceStateStore.readInstanceState(
      settings.instanceStatePath
    );
    assertRegisteredInstances(instanceState, [instanceId]);
    const updated = await settings.teamStateStore.updateTeamState(
      settings.teamStatePath,
      (state) => {
        const team = requireTeam(state, teamId);
        if (team.memberInstanceIds.includes(instanceId)) {
          throw new Error(`Agent Instance 已是 Team 成员：${instanceId}`);
        }
        team.memberInstanceIds.push(instanceId);
        team.updatedAt = settings.now().toISOString();
        return state;
      }
    );
    return enrichCurrentTeam(getTeamState(updated, teamId), settings);
  });
}

async function removeTeamMember(teamId, instanceId, options = {}) {
  assertTeamId(teamId);
  assertInstanceId(instanceId);

  return withTeamLock(teamId, async () => {
    const settings = resolveSettings(options);
    const updated = await settings.teamStateStore.updateTeamState(
      settings.teamStatePath,
      (state) => {
        const team = requireTeam(state, teamId);
        if (!team.memberInstanceIds.includes(instanceId)) {
          throw new Error(`Agent Instance 不是 Team 成员：${instanceId}`);
        }
        if (team.managerInstanceId === instanceId) {
          throw new Error("不能移除当前 Team Manager；请先使用 set-manager 指定其他成员。");
        }
        team.memberInstanceIds = team.memberInstanceIds.filter((id) => id !== instanceId);
        team.updatedAt = settings.now().toISOString();
        return state;
      }
    );
    return enrichCurrentTeam(getTeamState(updated, teamId), settings);
  });
}

async function setTeamManager(teamId, instanceId, options = {}) {
  assertTeamId(teamId);
  assertInstanceId(instanceId);

  return withTeamLock(teamId, async () => {
    const settings = resolveSettings(options);
    const instanceState = await settings.instanceStateStore.readInstanceState(
      settings.instanceStatePath
    );
    assertRegisteredInstances(instanceState, [instanceId]);
    const updated = await settings.teamStateStore.updateTeamState(
      settings.teamStatePath,
      (state) => {
        const team = requireTeam(state, teamId);
        if (!team.memberInstanceIds.includes(instanceId)) {
          throw new Error("新的 Team Manager 必须已经是 Team 成员：" + instanceId);
        }
        team.managerInstanceId = instanceId;
        team.updatedAt = settings.now().toISOString();
        return state;
      }
    );
    return enrichCurrentTeam(getTeamState(updated, teamId), settings);
  });
}

async function deleteTeam(teamId, options = {}) {
  assertTeamId(teamId);

  return withTeamLock(teamId, async () => {
    const settings = resolveSettings(options);
    await settings.teamStateStore.updateTeamState(settings.teamStatePath, (state) => {
      requireTeam(state, teamId);
      delete state.teams[teamId];
      return state;
    });
    return { teamId, deleted: true };
  });
}

async function assessTeamHealth(teamId, options = {}) {
  return inspectTeam(teamId, options);
}

function enrichTeam(team, instanceState) {
  const assessment = deriveTeamHealth(team, instanceState);
  return {
    ...team,
    ...assessment
  };
}

async function enrichCurrentTeam(team, settings) {
  const instanceState = await settings.instanceStateStore.readInstanceState(
    settings.instanceStatePath
  );
  return enrichTeam(team, instanceState);
}

function assertRegisteredInstances(instanceState, instanceIds) {
  for (const instanceId of instanceIds) {
    const instance = instanceState.instances[instanceId];
    if (!instance) {
      throw new Error("Agent Instance 不存在：" + instanceId);
    }
    if (instance.status !== "registered") {
      throw new Error(
        `Agent Instance 必须处于 registered 状态：${instanceId}（当前 ${instance.status}）`
      );
    }
  }
}

function normalizeRequestedMembers(memberInstanceIds) {
  if (!Array.isArray(memberInstanceIds) || memberInstanceIds.length === 0) {
    throw new Error("创建 Team 至少需要一个 --member。");
  }
  const normalized = memberInstanceIds.map(assertInstanceId);
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Team 成员不能包含重复的 Instance ID。");
  }
  return normalized.sort((left, right) => left.localeCompare(right));
}

function validateUpdatePatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("Team 更新参数必须是对象。");
  }
  const fields = Object.keys(patch);
  if (fields.length === 0) {
    throw new Error("teams update 至少需要提供一个可更新字段。");
  }
  for (const field of fields) {
    if (!TEAM_UPDATE_FIELDS.has(field)) {
      throw new Error("Team 不支持更新字段：" + field);
    }
  }
  return fields;
}

function requireTeam(state, teamId) {
  const team = state.teams[teamId];
  if (!team) {
    throw new Error("未找到 Team：" + teamId);
  }
  return team;
}

function resolveSettings(options) {
  const dataDirectory = path.resolve(options.dataDirectory || DEFAULT_TEAM_DATA_DIRECTORY);
  return {
    teamStatePath: path.resolve(options.teamStatePath || path.join(dataDirectory, "state.json")),
    instanceStatePath: path.resolve(options.instanceStatePath || DEFAULT_INSTANCE_STATE_PATH),
    now: options.now || (() => new Date()),
    teamStateStore: options.teamStateStore || {
      readTeamState,
      updateTeamState
    },
    instanceStateStore: options.instanceStateStore || {
      readInstanceState
    }
  };
}

function withTeamLock(teamId, operation) {
  const previous = teamLocks.get(teamId) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  const tail = current.catch(() => {});
  teamLocks.set(teamId, tail);

  return current.finally(() => {
    if (teamLocks.get(teamId) === tail) {
      teamLocks.delete(teamId);
    }
  });
}

module.exports = {
  DEFAULT_TEAM_DATA_DIRECTORY,
  DEFAULT_TEAM_STATE_PATH,
  addTeamMember,
  assessTeamHealth,
  createTeam,
  deleteTeam,
  inspectTeam,
  listTeams,
  removeTeamMember,
  setTeamManager,
  updateTeam
};
