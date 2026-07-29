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
const disallowedExtendedAttributes = [
  "com.apple.FinderInfo",
  "com.apple.ResourceFork",
  "com.apple.fileprovider.fpfs#P",
];

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

async function removeFileProviderAttributes(appPath) {
  for (const attribute of disallowedExtendedAttributes) {
    await execFileAsync("/usr/bin/xattr", [
      "-dr",
      attribute,
      appPath,
    ]);
  }
}

async function verifyApp(appPath) {
  await execFileAsync("/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    "--verbose=2",
    appPath,
  ]);
}

async function main() {
  const requestedArguments = process.argv.slice(2);
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

  try {
    const builderArguments = buildDirectoryOnly
      ? ["--mac", "--dir", ...forwardedArguments]
      : ["--mac", "dmg", ...forwardedArguments];

    builderArguments.push(
      `--config.directories.output=${temporaryOutputDirectory}`
    );

    await runElectronBuilder(builderArguments);
    await verifyApp(temporaryAppPath);

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
      await removeFileProviderAttributes(finalAppPath);
      await verifyApp(finalAppPath);
      await fs.rm(previousOutputDirectory, { recursive: true, force: true });
      previousOutputSaved = false;
    } catch (error) {
      await fs.rm(finalOutputDirectory, { recursive: true, force: true });
      if (previousOutputSaved) {
        await fs.rename(previousOutputDirectory, finalOutputDirectory);
        previousOutputSaved = false;
      }
      throw error;
    }
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
    if (previousOutputSaved) {
      await fs.rm(previousOutputDirectory, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
