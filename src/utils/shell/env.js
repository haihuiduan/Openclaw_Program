const os = require("node:os");
const path = require("node:path");

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
const MANAGED_NPM_DIRECTORY_NAME = ".npm-global";

function getCommandEnv(baseEnv = process.env, options = {}) {
  const env = {
    ...baseEnv
  };
  const basePath = typeof baseEnv.PATH === "string" ? baseEnv.PATH : "";
  const platform = options.platform || process.platform;

  env.PATH = buildCommandPath(basePath, platform);

  if (options.includeManagedNpm !== false) {
    const managedPrefix = options.managedPrefix
      || getManagedNpmPrefix(baseEnv, options.homeDir);
    env.NPM_CONFIG_PREFIX = managedPrefix;
    env.PATH = prependCommandPath(
      env.PATH,
      getManagedNpmBinDirectory(baseEnv, options.homeDir, managedPrefix)
    );
  }

  return env;
}

function getManagedNpmPrefix(baseEnv = process.env, homeDir) {
  const resolvedHome = String(
    homeDir || baseEnv.HOME || os.homedir() || ""
  ).trim();

  if (!resolvedHome || !path.isAbsolute(resolvedHome)) {
    throw new Error("无法确定当前用户目录。");
  }

  return path.join(path.resolve(resolvedHome), MANAGED_NPM_DIRECTORY_NAME);
}

function getManagedNpmBinDirectory(
  baseEnv = process.env,
  homeDir,
  managedPrefix
) {
  return path.join(
    managedPrefix || getManagedNpmPrefix(baseEnv, homeDir),
    "bin"
  );
}

function buildCommandPath(basePath = "", platform = process.platform) {
  const paths = splitPath(basePath);

  if (platform === "darwin") {
    paths.push(...MACOS_COMMAND_PATHS);
  }

  return dedupePaths(paths).join(":");
}

function prependCommandPath(basePath = "", directory) {
  return dedupePaths([
    String(directory || "").trim(),
    ...splitPath(basePath)
  ].filter(Boolean)).join(":");
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
  getManagedNpmBinDirectory,
  getManagedNpmPrefix,
  MANAGED_NPM_DIRECTORY_NAME,
  MACOS_COMMAND_PATHS,
  prependCommandPath
};
