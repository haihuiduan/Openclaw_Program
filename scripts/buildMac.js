"use strict";

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const projectDirectory = path.resolve(__dirname, "..");
const finalOutputDirectory = path.join(projectDirectory, "dist");
const finalAppPath = path.join(
  finalOutputDirectory,
  "mac-arm64",
  "OpenClaw 工具箱.app"
);

function runElectronBuilder(argumentsList) {
  const executable = path.join(
    projectDirectory,
    "node_modules",
    ".bin",
    "electron-builder"
  );

  return new Promise((resolve, reject) => {
    const child = spawn(executable, argumentsList, {
      cwd: projectDirectory,
      env: process.env,
      stdio: "inherit",
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          signal
            ? `electron-builder 被信号 ${signal} 中断`
            : `electron-builder 退出码为 ${code}`
        )
      );
    });
  });
}

async function clearExtendedAttributes(appPath, executeFile = execFileAsync) {
  await executeFile("/usr/bin/xattr", ["-cr", appPath]);
}

async function verifyApp(appPath, executeFile = execFileAsync) {
  await executeFile("/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    appPath,
  ]);
}

async function verifyDmg(dmgPath, executeFile = execFileAsync) {
  await executeFile("/usr/bin/hdiutil", ["verify", dmgPath]);
}

async function findDmg(outputDirectory, fileSystem = fs) {
  const entries = await fileSystem.readdir(outputDirectory);
  const dmgNames = entries.filter((name) => name.endsWith(".dmg")).sort();

  if (dmgNames.length !== 1) {
    throw new Error("macOS DMG 产物数量无效");
  }

  return path.join(outputDirectory, dmgNames[0]);
}

async function executeBuildPipeline(options) {
  const {
    buildDmg,
    runBuilder,
    resolveDmgPaths,
    promoteOutput,
    temporaryAppPath,
    finalAppPath: publishedAppPath,
    clearAttributes = clearExtendedAttributes,
    appVerifier = verifyApp,
    dmgVerifier = verifyDmg,
  } = options;

  await runBuilder();

  const dmgPaths = buildDmg
    ? await resolveDmgPaths()
    : { temporaryDmgPath: null, finalDmgPath: null };

  await clearAttributes(temporaryAppPath);
  await appVerifier(temporaryAppPath);
  if (dmgPaths.temporaryDmgPath) {
    await dmgVerifier(dmgPaths.temporaryDmgPath);
  }

  await promoteOutput();

  await clearAttributes(publishedAppPath);
  await appVerifier(publishedAppPath);
  if (dmgPaths.finalDmgPath) {
    await dmgVerifier(dmgPaths.finalDmgPath);
  }

  return dmgPaths;
}

async function buildMac(requestedArguments = process.argv.slice(2)) {
  const buildDirectoryOnly = requestedArguments[0] === "--dir";
  const buildDmg = requestedArguments[0] === "--dmg";

  if (!buildDirectoryOnly && !buildDmg) {
    throw new Error("缺少 macOS 打包模式");
  }

  const forwardedArguments = requestedArguments.slice(1);
  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "openclaw-mac-build-")
  );
  const temporaryOutputDirectory = path.join(temporaryRoot, "output");
  const temporaryAppPath = path.join(
    temporaryOutputDirectory,
    "mac-arm64",
    "OpenClaw 工具箱.app"
  );
  const previousOutputDirectory = `${finalOutputDirectory}.previous`;
  let previousOutputSaved = false;
  let outputPromoted = false;

  try {
    const builderArguments = buildDirectoryOnly
      ? ["--mac", "--dir", ...forwardedArguments]
      : ["--mac", "dmg", ...forwardedArguments];

    builderArguments.push(
      `--config.directories.output=${temporaryOutputDirectory}`
    );

    await executeBuildPipeline({
      buildDmg,
      temporaryAppPath,
      finalAppPath,
      runBuilder: () => runElectronBuilder(builderArguments),
      resolveDmgPaths: async () => {
        const temporaryDmgPath = await findDmg(temporaryOutputDirectory);
        return {
          temporaryDmgPath,
          finalDmgPath: path.join(
            finalOutputDirectory,
            path.basename(temporaryDmgPath)
          ),
        };
      },
      promoteOutput: async () => {
        await fs.rm(previousOutputDirectory, { recursive: true, force: true });
        try {
          await fs.rename(finalOutputDirectory, previousOutputDirectory);
          previousOutputSaved = true;
        } catch (error) {
          if (error.code !== "ENOENT") {
            throw error;
          }
        }

        try {
          await fs.rename(temporaryOutputDirectory, finalOutputDirectory);
          outputPromoted = true;
        } catch (error) {
          if (previousOutputSaved) {
            await fs.rename(previousOutputDirectory, finalOutputDirectory);
            previousOutputSaved = false;
          }
          throw error;
        }
      },
    });

    await fs.rm(previousOutputDirectory, { recursive: true, force: true });
    previousOutputSaved = false;
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
    if (previousOutputSaved) {
      await fs.rm(previousOutputDirectory, { recursive: true, force: true });
    }
  }

  return {
    finalAppPath,
    finalOutputDirectory,
    outputPromoted,
  };
}

if (require.main === module) {
  buildMac().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildMac,
  clearExtendedAttributes,
  executeBuildPipeline,
  findDmg,
  verifyApp,
  verifyDmg,
};
