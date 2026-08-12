"use strict";

const fs = require("node:fs/promises");
const fsConstants = require("node:fs").constants;
const os = require("node:os");
const path = require("node:path");

const { resolveCommand, runCommand } = require("../../utils/shell");
const {
  getCommandEnv,
  getManagedNpmBinDirectory,
  getManagedNpmPrefix
} = require("../../utils/shell/env");

const INSTALL_ENVIRONMENT_VERSION = 1;

async function ensureWritableNpmPrefix(ctx, dependencies = {}) {
  const fsApi = dependencies.fs || fs;
  const commandRunner = dependencies.runCommand || runCommand;
  const commandResolver = dependencies.resolveCommand || resolveCommand;
  const homeDir = dependencies.homeDir || os.homedir();
  const baseEnv = {
    ...(dependencies.baseEnv || ctx.commandEnv || process.env),
    HOME: homeDir
  };
  const rawCommandEnv = getCommandEnv(baseEnv, {
    homeDir,
    includeManagedNpm: false
  });
  const managedPrefix = getManagedNpmPrefix(baseEnv, homeDir);
  const managedBinDirectory = getManagedNpmBinDirectory(
    baseEnv,
    homeDir,
    managedPrefix
  );

  logDiagnostic(ctx, "npm_bootstrap_start", {
    environmentVersion: INSTALL_ENVIRONMENT_VERSION
  });

  const npmResolution = await commandResolver("npm", {
    diagnosticLogger: ctx.diagnosticLogger,
    env: rawCommandEnv,
    commandEnvOptions: {
      includeManagedNpm: false,
      homeDir
    }
  });
  logDiagnostic(ctx, "npm_command_resolved", {
    command: "npm",
    found: Boolean(npmResolution && npmResolution.found),
    resolvedPath: npmResolution && npmResolution.resolvedPath || null,
    exitCode: npmResolution && npmResolution.exitCode,
    timedOut: Boolean(npmResolution && npmResolution.timedOut)
  });

  if (!npmResolution || !npmResolution.found || !npmResolution.resolvedPath) {
    return {
      success: false,
      errorCode: "OPENCLAW_NPM_COMMAND_NOT_FOUND",
      message: "无法找到用于安装 OpenClaw 的 npm。"
    };
  }

  const prefixResult = await commandRunner(
    npmResolution.resolvedPath,
    ["config", "get", "prefix"],
    {
      allowFailure: true,
      timeoutMs: 5000,
      diagnosticLogger: ctx.diagnosticLogger,
      env: rawCommandEnv,
      commandEnvOptions: {
        includeManagedNpm: false,
        homeDir
      }
    }
  );
  const currentPrefix = normalizePrefix(prefixResult.stdout, homeDir);

  if (getExitCode(prefixResult) !== 0 || !currentPrefix) {
    logDiagnostic(ctx, "npm_prefix_check_failed", {
      exitCode: getExitCode(prefixResult),
      timedOut: Boolean(prefixResult.timedOut),
      spawnError: prefixResult.spawnError
    });
    return {
      success: false,
      errorCode: "OPENCLAW_NPM_PREFIX_CHECK_FAILED",
      message: "无法读取 npm 全局安装目录。"
    };
  }

  logDiagnostic(ctx, "npm_prefix_detected", {
    npmCommand: npmResolution.resolvedPath,
    originalPrefix: currentPrefix
  });
  const currentPrefixWritable = await isDirectoryWritable(
    fsApi,
    currentPrefix
  );
  logDiagnostic(ctx, "npm_prefix_writable", {
    originalPrefix: currentPrefix,
    writable: currentPrefixWritable
  });

  const managedDirectory = await prepareManagedPrefix(
    fsApi,
    managedPrefix,
    managedBinDirectory,
    dependencies.getUid
  );

  if (!managedDirectory.success) {
    logDiagnostic(ctx, "npm_prefix_directory_failed", {
      managedPrefix,
      errorCode: managedDirectory.errorCode
    });
    return {
      success: false,
      errorCode: "OPENCLAW_NPM_PREFIX_DIRECTORY_FAILED",
      message: "无法准备用户级 npm 安装目录。"
    };
  }

  logDiagnostic(ctx, "npm_managed_prefix_selected", {
    originalPrefix: currentPrefix,
    originalPrefixWritable: currentPrefixWritable,
    managedPrefix,
    binDirectory: managedBinDirectory
  });

  const environment = getCommandEnv(baseEnv, {
    homeDir,
    managedPrefix
  });
  const prefixBinInPath = environment.PATH
    .split(path.delimiter)
    .includes(managedBinDirectory);

  logDiagnostic(ctx, "npm_install_env_ready", {
    environmentVersion: INSTALL_ENVIRONMENT_VERSION,
    effectivePrefix: environment.NPM_CONFIG_PREFIX,
    binDirectory: managedBinDirectory,
    prefixBinInPath,
    npmConfigPrefixSet: environment.NPM_CONFIG_PREFIX === managedPrefix
  });

  return {
    success: true,
    changed: !pathsEqual(currentPrefix, managedPrefix),
    currentPrefix,
    currentPrefixWritable,
    effectivePrefix: managedPrefix,
    binDirectory: managedBinDirectory,
    npmCommand: npmResolution.resolvedPath,
    environmentVersion: INSTALL_ENVIRONMENT_VERSION,
    environment
  };
}

async function prepareManagedPrefix(
  fsApi,
  managedPrefix,
  managedBinDirectory,
  getUid
) {
  const expectedUid = typeof getUid === "function"
    ? getUid()
    : typeof process.getuid === "function"
      ? process.getuid()
      : null;

  try {
    await fsApi.mkdir(managedPrefix, {
      recursive: true,
      mode: 0o700
    });
    await fsApi.mkdir(managedBinDirectory, {
      recursive: true,
      mode: 0o700
    });

    for (const directory of [managedPrefix, managedBinDirectory]) {
      if (typeof fsApi.lstat === "function") {
        const stat = await fsApi.lstat(directory);

        if (!stat.isDirectory() || stat.isSymbolicLink()) {
          return {
            success: false,
            errorCode: "INVALID_MANAGED_NPM_DIRECTORY"
          };
        }

        if (
          Number.isInteger(expectedUid)
          && Number.isInteger(stat.uid)
          && stat.uid !== expectedUid
        ) {
          return {
            success: false,
            errorCode: "MANAGED_NPM_DIRECTORY_OWNER_MISMATCH"
          };
        }
      }

      if (typeof fsApi.chmod === "function") {
        await fsApi.chmod(directory, 0o700);
      }
      await fsApi.access(directory, fsConstants.W_OK);
    }

    return {
      success: true
    };
  } catch (error) {
    return {
      success: false,
      errorCode: error && error.code ? String(error.code) : "UNKNOWN"
    };
  }
}

async function isDirectoryWritable(fsApi, directory) {
  try {
    await fsApi.access(directory, fsConstants.W_OK);
    return true;
  } catch (error) {
    return false;
  }
}

function normalizePrefix(value, homeDir) {
  const prefix = String(value || "").trim().split(/\r?\n/)[0];

  if (!prefix) {
    return null;
  }

  if (prefix === "~") {
    return path.resolve(homeDir);
  }

  if (prefix.startsWith("~" + path.sep)) {
    return path.resolve(homeDir, prefix.slice(2));
  }

  if (!path.isAbsolute(prefix)) {
    return null;
  }

  return path.resolve(prefix);
}

function pathsEqual(left, right) {
  return path.resolve(left) === path.resolve(right);
}

function getExitCode(result) {
  if (Number.isInteger(result && result.exitCode)) {
    return result.exitCode;
  }

  return Number.isInteger(result && result.code) ? result.code : null;
}

function logDiagnostic(ctx, event, details) {
  if (ctx.diagnosticLogger && typeof ctx.diagnosticLogger.event === "function") {
    ctx.diagnosticLogger.event(event, details);
  }
}

module.exports = {
  ensureWritableNpmPrefix,
  INSTALL_ENVIRONMENT_VERSION,
  prepareManagedPrefix
};
