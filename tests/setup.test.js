const assert = require("node:assert/strict");
const test = require("node:test");

const {
  clearProjectModules,
  mockModule,
  projectPath
} = require("./helpers");

function loadSetupWithMocks({ doctorOk = true, installOk = true } = {}) {
  clearProjectModules();

  const calls = {
    doctor: 0,
    install: 0,
    configure: 0,
    verify: 0
  };

  mockModule("src/core/doctor/index.js", {
    runDoctor: async () => {
      calls.doctor += 1;
      return {
        ok: doctorOk,
        checks: []
      };
    }
  });
  mockModule("src/core/installer/index.js", {
    installOpenClaw: async () => {
      calls.install += 1;
      return {
        ok: installOk,
        message: installOk ? "安装成功" : "安装失败"
      };
    }
  });
  mockModule("src/core/configure/index.js", {
    runConfigure: async () => {
      calls.configure += 1;
      return { ok: true };
    }
  });
  mockModule("src/core/verify/index.js", {
    runVerify: async () => {
      calls.verify += 1;
      return { ok: true };
    }
  });

  return {
    ...require(projectPath("src/core/setup/index.js")),
    calls
  };
}

test("setup --dry-run 不调用 doctor/install/configure/verify", async () => {
  const { runSetup, calls } = loadSetupWithMocks();

  const result = await runSetup({ dryRun: true });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.deepEqual(calls, { doctor: 0, install: 0, configure: 0, verify: 0 });
});

test("setup 默认流程会先调用 runDoctor", async () => {
  const { runSetup, calls } = loadSetupWithMocks();

  await runSetup({});

  assert.equal(calls.doctor, 1);
});

test("doctor 失败时不继续调用 install", async () => {
  const { runSetup, calls } = loadSetupWithMocks({ doctorOk: false });

  const result = await runSetup({});

  assert.equal(result.ok, false);
  assert.equal(result.stage, "doctor");
  assert.equal(calls.install, 0);
});

test("install 失败时不继续调用 configure/verify", async () => {
  const { runSetup, calls } = loadSetupWithMocks({ doctorOk: true, installOk: false });

  const result = await runSetup({});

  assert.equal(result.ok, false);
  assert.equal(result.stage, "install");
  assert.equal(calls.configure, 0);
  assert.equal(calls.verify, 0);
});

test("doctor 和 install 成功时 setup 返回 ok:true", async () => {
  const { runSetup } = loadSetupWithMocks({ doctorOk: true, installOk: true });

  const result = await runSetup({});

  assert.equal(result.ok, true);
  assert.equal(result.stage, "ready");
});

test("默认 setup 不自动调用 configure 或 verify", async () => {
  const { runSetup, calls } = loadSetupWithMocks({ doctorOk: true, installOk: true });

  await runSetup({});

  assert.equal(calls.configure, 0);
  assert.equal(calls.verify, 0);
});

test("setup 输出不包含敏感信息", () => {
  clearProjectModules();
  const { formatSetupResult } = require(projectPath("src/cli/presenters/setupPresenter.js"));

  const output = formatSetupResult({
    ok: true,
    message: "api_key=sk-secret"
  });

  assert.doesNotMatch(output, /sk-secret/);
});

test("setup presenter 输出 dry-run 预览", () => {
  clearProjectModules();
  const { formatSetupResult } = require(projectPath("src/cli/presenters/setupPresenter.js"));

  const output = formatSetupResult({ ok: true, dryRun: true });

  assert.match(output, /OpenClaw 一键准备流程预览/);
  assert.match(output, /dry-run 已完成/);
});
