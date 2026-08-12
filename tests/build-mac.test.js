"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  clearExtendedAttributes,
  executeBuildPipeline,
} = require("../scripts/buildMac");

test("macOS 构建按临时清理验签、DMG 验证、发布和最终复验顺序执行", async () => {
  const calls = [];

  const result = await executeBuildPipeline({
    buildDmg: true,
    temporaryAppPath: "/temporary/OpenClaw.app",
    finalAppPath: "/dist/OpenClaw.app",
    runBuilder: async () => {
      calls.push("builder");
    },
    resolveDmgPaths: async () => {
      calls.push("resolve-dmg");
      return {
        temporaryDmgPath: "/temporary/OpenClaw.dmg",
        finalDmgPath: "/dist/OpenClaw.dmg",
      };
    },
    clearAttributes: async (appPath) => {
      calls.push(`xattr:${appPath}`);
    },
    appVerifier: async (appPath) => {
      calls.push(`codesign:${appPath}`);
    },
    dmgVerifier: async (dmgPath) => {
      calls.push(`hdiutil:${dmgPath}`);
    },
    promoteOutput: async () => {
      calls.push("promote");
    },
  });

  assert.deepEqual(calls, [
    "builder",
    "resolve-dmg",
    "xattr:/temporary/OpenClaw.app",
    "codesign:/temporary/OpenClaw.app",
    "hdiutil:/temporary/OpenClaw.dmg",
    "promote",
    "xattr:/dist/OpenClaw.app",
    "codesign:/dist/OpenClaw.app",
    "hdiutil:/dist/OpenClaw.dmg",
  ]);
  assert.deepEqual(result, {
    temporaryDmgPath: "/temporary/OpenClaw.dmg",
    finalDmgPath: "/dist/OpenClaw.dmg",
  });
});

test("xattr 清理失败时立即停止且不验签、不发布产物", async () => {
  const calls = [];
  const expectedError = new Error("xattr cleanup failed");

  await assert.rejects(
    executeBuildPipeline({
      buildDmg: true,
      temporaryAppPath: "/temporary/OpenClaw.app",
      finalAppPath: "/dist/OpenClaw.app",
      runBuilder: async () => {
        calls.push("builder");
      },
      resolveDmgPaths: async () => {
        calls.push("resolve-dmg");
        return {
          temporaryDmgPath: "/temporary/OpenClaw.dmg",
          finalDmgPath: "/dist/OpenClaw.dmg",
        };
      },
      clearAttributes: async (appPath) => {
        calls.push(`xattr:${appPath}`);
        throw expectedError;
      },
      appVerifier: async () => {
        calls.push("codesign");
      },
      dmgVerifier: async () => {
        calls.push("hdiutil");
      },
      promoteOutput: async () => {
        calls.push("promote");
      },
    }),
    expectedError
  );

  assert.deepEqual(calls, [
    "builder",
    "resolve-dmg",
    "xattr:/temporary/OpenClaw.app",
  ]);
});

test("最终 App 验签失败发生在已验证 DMG 发布之后", async () => {
  const calls = [];
  const expectedError = new Error("published app verification failed");

  await assert.rejects(
    executeBuildPipeline({
      buildDmg: true,
      temporaryAppPath: "/temporary/OpenClaw.app",
      finalAppPath: "/dist/OpenClaw.app",
      runBuilder: async () => {
        calls.push("builder");
      },
      resolveDmgPaths: async () => ({
        temporaryDmgPath: "/temporary/OpenClaw.dmg",
        finalDmgPath: "/dist/OpenClaw.dmg",
      }),
      clearAttributes: async (appPath) => {
        calls.push(`xattr:${appPath}`);
      },
      appVerifier: async (appPath) => {
        calls.push(`codesign:${appPath}`);
        if (appPath.startsWith("/dist/")) {
          throw expectedError;
        }
      },
      dmgVerifier: async (dmgPath) => {
        calls.push(`hdiutil:${dmgPath}`);
      },
      promoteOutput: async () => {
        calls.push("promote");
      },
    }),
    expectedError
  );

  assert.deepEqual(calls, [
    "builder",
    "xattr:/temporary/OpenClaw.app",
    "codesign:/temporary/OpenClaw.app",
    "hdiutil:/temporary/OpenClaw.dmg",
    "promote",
    "xattr:/dist/OpenClaw.app",
    "codesign:/dist/OpenClaw.app",
  ]);
});

test("扩展属性清理使用 xattr -cr 且不经过 shell", async () => {
  const calls = [];

  await clearExtendedAttributes("/tmp/OpenClaw.app", async (...args) => {
    calls.push(args);
  });

  assert.deepEqual(calls, [
    ["/usr/bin/xattr", ["-cr", "/tmp/OpenClaw.app"]],
  ]);
});
