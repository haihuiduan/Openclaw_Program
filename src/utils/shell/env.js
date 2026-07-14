const MACOS_COMMAND_PATHS = [
  "/opt/homebrew/bin",
  "/opt/homebrew/sbin",
  "/usr/local/bin",
  "/usr/local/sbin",
  "/usr/bin",
  "/bin",
  "/usr/sbin",
  "/sbin"
];

function getCommandEnv(baseEnv = process.env) {
  const env = {
    ...baseEnv
  };
  const basePath = typeof baseEnv.PATH === "string" ? baseEnv.PATH : "";

  env.PATH = buildCommandPath(basePath, process.platform);
  return env;
}

function buildCommandPath(basePath = "", platform = process.platform) {
  const paths = splitPath(basePath);

  if (platform === "darwin") {
    paths.push(...MACOS_COMMAND_PATHS);
  }

  return dedupePaths(paths).join(":");
}

function splitPath(value) {
  return String(value || "")
    .split(":")
    .map((item) => item.trim())
    .filter(Boolean);
}

function dedupePaths(paths) {
  const seen = new Set();
  const result = [];

  for (const item of paths) {
    if (!seen.has(item)) {
      seen.add(item);
      result.push(item);
    }
  }

  return result;
}

module.exports = {
  buildCommandPath,
  getCommandEnv,
  MACOS_COMMAND_PATHS
};
