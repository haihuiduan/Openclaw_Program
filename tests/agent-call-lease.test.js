const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { projectPath } = require("./helpers");
const {
  acquireAgentCallLease,
  clearStaleAgentCallLease,
  readAgentCallLease,
  releaseAgentCallLease
} = require(projectPath("src/core/openclaw-agent/agentCallLease.js"));
const {
  FILE_LEASE_MUTATION_GUARD_BUSY_CODE,
  resolveFileLeaseMutationGuardPath,
  withFileLeaseMutationGuard
} = require(projectPath("src/core/conversations/fileLease.js"));

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-agent-call-lease-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    root,
    leasePath: path.join(root, "state", "active.lock"),
    lease: {
      operationId: "msg-00000000-0000-4000-8000-000000000001",
      operationType: "conversation",
      instanceId: "test-role-worker",
      pid: 12345,
      createdAt: "2026-07-23T00:00:00.000Z"
    }
  };
}

test("共享 Agent-call lease 使用 O_EXCL、0600 和严格字段白名单", async (t) => {
  const f = fixture(t);
  await assert.rejects(
    () => acquireAgentCallLease(f.leasePath, {
      ...f.lease,
      prompt: "不能保存",
      sessionKey: "不能保存"
    }),
    /未知字段/
  );
  assert.equal(fs.existsSync(f.leasePath), false);
  const acquired = await acquireAgentCallLease(f.leasePath, f.lease);
  assert.equal(acquired.leasePath, path.resolve(f.leasePath));
  assert.deepEqual(await readAgentCallLease(f.leasePath), f.lease);
  assert.deepEqual(
    Object.keys(JSON.parse(fs.readFileSync(f.leasePath, "utf8"))).sort(),
    ["createdAt", "instanceId", "operationId", "operationType", "pid"].sort()
  );
  assert.equal(fs.statSync(f.leasePath).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(f.leasePath)).mode & 0o777, 0o700);
  await assert.rejects(
    () => acquireAgentCallLease(f.leasePath, {
      ...f.lease,
      operationId: "run-00000000-0000-4000-8000-000000000001",
      operationType: "execution"
    }),
    /全局串行/
  );
});

test("共享 Agent-call lease 只有持有者能释放", async (t) => {
  const f = fixture(t);
  await acquireAgentCallLease(f.leasePath, f.lease);
  assert.equal(
    await releaseAgentCallLease(f.leasePath, {
      ...f.lease,
      pid: f.lease.pid + 1
    }),
    false
  );
  assert.equal(fs.existsSync(f.leasePath), true);
  assert.equal(await releaseAgentCallLease(f.leasePath, f.lease), true);
  assert.equal(fs.existsSync(f.leasePath), false);
});

test("共享 Agent-call lease 只清理明确死亡 PID，maxAge 不覆盖活跃保护", async (t) => {
  const f = fixture(t);
  await acquireAgentCallLease(f.leasePath, f.lease);
  const active = await clearStaleAgentCallLease(f.leasePath, {
    now: () => new Date("2026-07-23T01:00:00.000Z"),
    maxAgeMs: 2 * 60 * 60 * 1000,
    isProcessAlive: () => true
  });
  assert.equal(active.active, true);
  assert.equal(active.removed, false);

  const overAgeButAlive = await clearStaleAgentCallLease(f.leasePath, {
    now: () => new Date("2026-07-23T02:00:00.000Z"),
    maxAgeMs: 2 * 60 * 60 * 1000,
    isProcessAlive: () => true
  });
  assert.equal(overAgeButAlive.active, true);
  assert.equal(overAgeButAlive.removed, false);
  assert.equal(fs.existsSync(f.leasePath), true);

  const dead = await clearStaleAgentCallLease(f.leasePath, {
    now: () => new Date("2026-07-23T00:01:00.000Z"),
    isProcessAlive: () => false
  });
  assert.equal(dead.removed, true);

  await acquireAgentCallLease(f.leasePath, f.lease);
  const deadAndOverAge = await clearStaleAgentCallLease(f.leasePath, {
    now: () => new Date("2026-07-23T03:00:00.000Z"),
    maxAgeMs: 2 * 60 * 60 * 1000,
    isProcessAlive: () => false
  });
  assert.equal(deadAndOverAge.removed, true);
});

test("PID 状态无法确认时保守保留 Agent-call lease", async (t) => {
  for (const isProcessAlive of [
    () => undefined,
    () => {
      throw new Error("fixture-process-status-unknown");
    }
  ]) {
    const f = fixture(t);
    await acquireAgentCallLease(f.leasePath, f.lease);
    const result = await clearStaleAgentCallLease(f.leasePath, {
      now: () => new Date("2026-07-24T00:00:00.000Z"),
      maxAgeMs: 1000,
      isProcessAlive
    });
    assert.equal(result.active, true);
    assert.equal(result.removed, false);
    assert.equal(fs.existsSync(f.leasePath), true);
    assert.equal(await releaseAgentCallLease(f.leasePath, f.lease), true);
  }
});

test("损坏、未知字段和未来时间租约明确拒绝且不覆盖", async (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.dirname(f.leasePath), { recursive: true });
  fs.writeFileSync(f.leasePath, "{broken", "utf8");
  const before = fs.readFileSync(f.leasePath);
  await assert.rejects(() => readAgentCallLease(f.leasePath), /不是有效 JSON/);
  await assert.rejects(
    () => clearStaleAgentCallLease(f.leasePath),
    /不是有效 JSON/
  );
  assert.deepEqual(fs.readFileSync(f.leasePath), before);

  fs.writeFileSync(f.leasePath, JSON.stringify({ ...f.lease, prompt: "bad" }));
  await assert.rejects(() => readAgentCallLease(f.leasePath), /未知字段/);

  fs.writeFileSync(f.leasePath, JSON.stringify(f.lease));
  await assert.rejects(
    () => clearStaleAgentCallLease(f.leasePath, {
      now: () => new Date("2026-07-22T23:59:59.000Z")
    }),
    /不能位于未来/
  );
  assert.equal(fs.existsSync(f.leasePath), true);
});

test("Agent-call lease 在 write、sync 或 chmod 失败时只清理本次文件", async (t) => {
  for (const failure of ["write", "sync", "chmod"]) {
    const f = fixture(t);
    const fileSystem = createFailingFileSystem(f.leasePath, failure);
    await assert.rejects(
      () => acquireAgentCallLease(f.leasePath, f.lease, { fileSystem }),
      (error) => {
        assert.match(error.message, /Agent 调用租约创建失败/);
        assert.doesNotMatch(
          error.message,
          new RegExp(`fixture-${failure}-failure`)
        );
        assert.equal(Object.hasOwn(error, "cause"), false);
        return true;
      }
    );
    assert.equal(fs.existsSync(f.leasePath), false);
    await acquireAgentCallLease(f.leasePath, f.lease);
    assert.equal(await releaseAgentCallLease(f.leasePath, f.lease), true);
  }
});

test("旧持有者 release 等待期间租约被替换时不删除新租约", async (t) => {
  const f = fixture(t);
  const oldHolder = f.lease;
  const newHolder = {
    ...f.lease,
    operationId: "msg-00000000-0000-4000-8000-000000000002",
    pid: f.lease.pid + 1,
    createdAt: "2026-07-23T00:01:00.000Z"
  };
  await acquireAgentCallLease(f.leasePath, oldHolder);

  const guardPath = resolveFileLeaseMutationGuardPath(f.leasePath);
  const guardHandle = await holdMutationGuard(guardPath);
  const attempted = deferred();
  const release = releaseAgentCallLease(f.leasePath, oldHolder, {
    fileSystem: observeGuardAttempt(guardPath, attempted.resolve)
  });
  await attempted.promise;

  fs.rmSync(f.leasePath);
  fs.writeFileSync(f.leasePath, JSON.stringify(newHolder) + "\n", {
    encoding: "utf8",
    mode: 0o600
  });
  await guardHandle.close();
  fs.rmSync(guardPath);

  assert.equal(await release, false);
  assert.deepEqual(await readAgentCallLease(f.leasePath), newHolder);
  assert.equal(await releaseAgentCallLease(f.leasePath, oldHolder), false);
  assert.deepEqual(await readAgentCallLease(f.leasePath), newHolder);
  assert.equal(await releaseAgentCallLease(f.leasePath, newHolder), true);
  assert.equal(fs.existsSync(guardPath), false);
});

test("stale-clear 等待期间租约被替换时重新判断且保留新租约", async (t) => {
  const f = fixture(t);
  const oldHolder = f.lease;
  const newHolder = {
    ...f.lease,
    operationId: "msg-00000000-0000-4000-8000-000000000003",
    pid: process.pid,
    createdAt: "2026-07-23T02:00:00.000Z"
  };
  await acquireAgentCallLease(f.leasePath, oldHolder);

  const guardPath = resolveFileLeaseMutationGuardPath(f.leasePath);
  const guardHandle = await holdMutationGuard(guardPath);
  const attempted = deferred();
  const clear = clearStaleAgentCallLease(f.leasePath, {
    fileSystem: observeGuardAttempt(guardPath, attempted.resolve),
    now: () => new Date("2026-07-23T02:00:00.000Z"),
    maxAgeMs: 60 * 60 * 1000,
    isProcessAlive: () => true
  });
  await attempted.promise;

  fs.rmSync(f.leasePath);
  fs.writeFileSync(f.leasePath, JSON.stringify(newHolder) + "\n", {
    encoding: "utf8",
    mode: 0o600
  });
  await guardHandle.close();
  fs.rmSync(guardPath);

  const result = await clear;
  assert.equal(result.active, true);
  assert.equal(result.removed, false);
  assert.deepEqual(result.lease, newHolder);
  assert.deepEqual(await readAgentCallLease(f.leasePath), newHolder);
  assert.equal(await releaseAgentCallLease(f.leasePath, newHolder), true);
  assert.equal(fs.existsSync(guardPath), false);
});

test("mutation guard 正常返回和抛异常都会按完整身份释放", async (t) => {
  const f = fixture(t);
  const guardPath = resolveFileLeaseMutationGuardPath(f.leasePath);

  const value = await withFileLeaseMutationGuard(
    f.leasePath,
    async () => {
      const guard = JSON.parse(fs.readFileSync(guardPath, "utf8"));
      assert.deepEqual(
        Object.keys(guard).sort(),
        ["createdAt", "guardId", "pid"].sort()
      );
      assert.match(guard.guardId, /^guard-[0-9a-f-]{36}$/);
      assert.equal(guard.pid, process.pid);
      assert.equal(Number.isFinite(Date.parse(guard.createdAt)), true);
      return "完成";
    }
  );
  assert.equal(value, "完成");
  assert.equal(fs.existsSync(guardPath), false);

  await assert.rejects(
    () => withFileLeaseMutationGuard(f.leasePath, async () => {
      throw new Error("fixture-operation-failure");
    }),
    /fixture-operation-failure/
  );
  assert.equal(fs.existsSync(guardPath), false);
});

test("旧 mutation guard 持有者不会删除已经替换的新 guard", async (t) => {
  const f = fixture(t);
  const guardPath = resolveFileLeaseMutationGuardPath(f.leasePath);
  const replacement = mutationGuard(process.pid);

  await withFileLeaseMutationGuard(f.leasePath, async () => {
    fs.rmSync(guardPath);
    fs.writeFileSync(guardPath, JSON.stringify(replacement) + "\n", {
      encoding: "utf8",
      mode: 0o600
    });
  });

  assert.deepEqual(
    JSON.parse(fs.readFileSync(guardPath, "utf8")),
    replacement
  );
  fs.rmSync(guardPath);
});

test("stale guard 清理期间 guard 被替换时不删除新持有者", async (t) => {
  const f = fixture(t);
  const guardPath = resolveFileLeaseMutationGuardPath(f.leasePath);
  const stale = mutationGuard(99999991);
  const replacement = mutationGuard(process.pid);
  fs.mkdirSync(path.dirname(guardPath), { recursive: true });
  fs.writeFileSync(guardPath, JSON.stringify(stale) + "\n", {
    encoding: "utf8",
    mode: 0o600
  });

  let reads = 0;
  const fileSystem = {
    ...fsPromises,
    async readFile(target, ...args) {
      if (path.resolve(target) === path.resolve(guardPath)) {
        reads += 1;
        if (reads === 2) {
          fs.rmSync(guardPath);
          fs.writeFileSync(
            guardPath,
            JSON.stringify(replacement) + "\n",
            { encoding: "utf8", mode: 0o600 }
          );
        }
      }
      return fsPromises.readFile(target, ...args);
    }
  };

  await assert.rejects(
    () => withFileLeaseMutationGuard(
      f.leasePath,
      async () => {
        throw new Error("不应进入临界区");
      },
      {
        fileSystem,
        mutationGuardIsProcessAlive: (pid) => pid === process.pid,
        mutationGuardWaitMs: 100,
        mutationGuardRetryMs: 10
      }
    ),
    (error) => error.code === FILE_LEASE_MUTATION_GUARD_BUSY_CODE
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(guardPath, "utf8")),
    replacement
  );
  fs.rmSync(guardPath);
});

test("损坏 mutation guard 保守等待，并在稳定超过宽限期后恢复", async (t) => {
  const f = fixture(t);
  const guardPath = resolveFileLeaseMutationGuardPath(f.leasePath);
  fs.mkdirSync(path.dirname(guardPath), { recursive: true });
  fs.writeFileSync(guardPath, "{broken-guard", {
    encoding: "utf8",
    mode: 0o600
  });
  const before = fs.readFileSync(guardPath);

  await assert.rejects(
    () => withFileLeaseMutationGuard(
      f.leasePath,
      async () => "不应执行",
      {
        mutationGuardCorruptGraceMs: 60 * 1000,
        mutationGuardWaitMs: 30,
        mutationGuardRetryMs: 5
      }
    ),
    (error) => {
      assert.equal(error.code, FILE_LEASE_MUTATION_GUARD_BUSY_CODE);
      assert.doesNotMatch(error.message, new RegExp(escapeRegExp(f.root)));
      assert.doesNotMatch(error.message, /broken-guard/);
      return true;
    }
  );
  assert.deepEqual(fs.readFileSync(guardPath), before);

  const old = new Date(Date.now() - 60 * 1000);
  fs.utimesSync(guardPath, old, old);
  assert.equal(
    await withFileLeaseMutationGuard(
      f.leasePath,
      async () => "已恢复",
      {
        mutationGuardCorruptGraceMs: 10,
        mutationGuardWaitMs: 100,
        mutationGuardRetryMs: 5
      }
    ),
    "已恢复"
  );
  assert.equal(fs.existsSync(guardPath), false);
});

function createFailingFileSystem(leasePath, failure) {
  return {
    ...fsPromises,
    async chmod(target, mode) {
      if (failure === "chmod" && path.resolve(target) === path.resolve(leasePath)) {
        throw new Error("fixture-chmod-failure");
      }
      return fsPromises.chmod(target, mode);
    },
    async open(target, flags, mode) {
      const handle = await fsPromises.open(target, flags, mode);
      const isTargetLease =
        path.resolve(target) === path.resolve(leasePath);
      return {
        stat: (...args) => handle.stat(...args),
        close: (...args) => handle.close(...args),
        async writeFile(...args) {
          if (failure === "write" && isTargetLease) {
            throw new Error("fixture-write-failure");
          }
          return handle.writeFile(...args);
        },
        async sync(...args) {
          if (failure === "sync" && isTargetLease) {
            throw new Error("fixture-sync-failure");
          }
          return handle.sync(...args);
        }
      };
    }
  };
}

async function holdMutationGuard(guardPath) {
  await fsPromises.mkdir(path.dirname(guardPath), {
    recursive: true,
    mode: 0o700
  });
  return fsPromises.open(guardPath, "wx", 0o600);
}

function observeGuardAttempt(guardPath, onAttempt) {
  let observed = false;
  return {
    ...fsPromises,
    async open(target, flags, mode) {
      if (
        !observed &&
        path.resolve(target) === path.resolve(guardPath) &&
        flags === "wx"
      ) {
        observed = true;
        onAttempt();
      }
      return fsPromises.open(target, flags, mode);
    }
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function mutationGuard(pid) {
  return {
    guardId: `guard-${crypto.randomUUID()}`,
    pid,
    createdAt: new Date().toISOString()
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
