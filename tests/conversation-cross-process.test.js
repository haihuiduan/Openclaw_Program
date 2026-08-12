const assert = require("node:assert/strict");
const fs = require("node:fs");
const fsPromises = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const test = require("node:test");
const { projectPath } = require("./helpers");
const {
  clearStaleConversationOperationLock,
  acquireConversationOperationLock,
  readConversationOperationLock,
  releaseConversationOperationLock
} = require(projectPath("src/core/conversations/locks.js"));
const {
  readConversationState
} = require(projectPath("src/core/conversations/state.js"));
const {
  listMessageStates,
  readMessageState,
  resolveMessageStatePath
} = require(projectPath("src/core/conversations/messageState.js"));
const {
  writeInstanceState
} = require(projectPath("src/core/agent-instances/state.js"));
const {
  FILE_LEASE_MUTATION_GUARD_BUSY_CODE,
  resolveFileLeaseMutationGuardPath,
  withFileLeaseMutationGuard
} = require(projectPath("src/core/conversations/fileLease.js"));
const {
  clearStaleAgentCallLease
} = require(projectPath("src/core/openclaw-agent/agentCallLease.js"));

const CHILD = projectPath("tests/fixtures/conversation-child-process.js");
const NOW = "2026-07-24T00:00:00.000Z";

test("独立进程并发创建不同或相同 Conversation 不覆盖 State", async (t) => {
  const f = await fixture(t);
  const different = await Promise.all([
    runChild(f, { action: "create", conversationId: "alpha-chat" }),
    runChild(f, { action: "create", conversationId: "beta-chat" })
  ]);
  assert.equal(
    different.every((item) => item.ok),
    true,
    JSON.stringify(different)
  );
  assert.deepEqual(
    Object.keys(
      (await readConversationState(f.conversationStatePath)).conversations
    ),
    ["alpha-chat", "beta-chat"]
  );

  const same = await Promise.all([
    runChild(f, { action: "create", conversationId: "same-chat" }),
    runChild(f, { action: "create", conversationId: "same-chat" })
  ]);
  assert.equal(same.filter((item) => item.ok).length, 1);
  assert.equal(
    same.filter((item) => !item.ok && /已存在/.test(item.error)).length,
    1
  );
  const final = await readConversationState(f.conversationStatePath);
  assert.deepEqual(Object.keys(final.conversations), [
    "alpha-chat",
    "beta-chat",
    "same-chat"
  ]);
});

test("独立进程更新同一 Message State 不丢失 Turn 或重复 sequence", async (t) => {
  const f = await fixture(t);
  const results = await Promise.all([
    runChild(f, {
      action: "append-turn",
      conversationId: "message-chat",
      messageIds: messageIds(1),
      turnIds: [turnId(1)]
    }),
    runChild(f, {
      action: "append-turn",
      conversationId: "message-chat",
      messageIds: messageIds(3),
      turnIds: [turnId(2)]
    })
  ]);
  assert.equal(results.every((item) => item.ok), true, JSON.stringify(results));
  const state = await readMessageState(
    resolveMessageStatePath(f.messageStateDirectory, "message-chat"),
    "message-chat"
  );
  assert.deepEqual(
    listMessageStates(state).map((item) => item.sequence),
    [1, 2, 3, 4]
  );
  assert.equal(new Set(listMessageStates(state).map((item) => item.sequence)).size, 4);
});

test("独立进程 send 与 archive/reconcile/send 正确互斥且共享全局租约", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await runChild(f, { action: "create", conversationId: "first-chat" })).ok,
    true
  );
  assert.equal(
    (await runChild(f, { action: "create", conversationId: "second-chat" })).ok,
    true
  );

  const adapterEnteredPath = path.join(f.root, "barriers", "adapter-entered");
  const adapterReleasePath = path.join(f.root, "barriers", "adapter-release");
  const adapterCallsPath = path.join(f.root, "barriers", "adapter-calls");
  fs.mkdirSync(path.dirname(adapterEnteredPath), { recursive: true });
  const activeSend = startChild(f, {
    action: "send",
    conversationId: "first-chat",
    messageIds: messageIds(1),
    turnIds: [turnId(1)],
    adapterEnteredPath,
    adapterReleasePath,
    adapterCallsPath
  });
  t.after(() => activeSend.kill());
  await waitForFile(adapterEnteredPath, 5000);

  const [archive, reconcile, sameSend] = await Promise.all([
    runChild(f, { action: "archive", conversationId: "first-chat" }),
    runChild(f, { action: "reconcile" }),
    runChild(f, {
      action: "send",
      conversationId: "first-chat",
      messageIds: messageIds(3),
      turnIds: [turnId(2)],
      adapterCallsPath
    })
  ]);
  const otherSend = await runChild(f, {
    action: "send",
    conversationId: "second-chat",
    messageIds: messageIds(5),
    turnIds: [turnId(3)],
    adapterCallsPath
  });

  fs.writeFileSync(adapterReleasePath, "release\n", "utf8");
  const completed = await activeSend.result;
  assert.equal(archive.ok, false);
  assert.match(archive.error, /正在执行其他操作/);
  assert.equal(reconcile.ok, true);
  assert.deepEqual(reconcile.result.skippedConversationIds, ["first-chat"]);
  assert.equal(sameSend.ok, false);
  assert.match(sameSend.error, /正在执行其他操作/);
  assert.equal(otherSend.ok, false);
  assert.match(otherSend.error, /全局串行调用/);

  assert.equal(completed.ok, true);
  const conversations = await readConversationState(f.conversationStatePath);
  assert.equal(conversations.conversations["first-chat"].status, "active");
  const firstMessages = await readMessageState(
    resolveMessageStatePath(f.messageStateDirectory, "first-chat"),
    "first-chat"
  );
  assert.deepEqual(
    listMessageStates(firstMessages).map((item) => item.status),
    ["completed", "completed"]
  );
  const secondMessages = await readMessageState(
    resolveMessageStatePath(f.messageStateDirectory, "second-chat"),
    "second-chat"
  );
  assert.equal(listMessageStates(secondMessages).length, 0);
  assert.equal(
    fs.readFileSync(adapterCallsPath, "utf8").trim().split("\n").length,
    1
  );
  assert.equal(fs.existsSync(f.agentCallLeasePath), false);
});

test("Conversation 操作锁校验字段、stale 边界、PID 和创建失败清理", async (t) => {
  const f = await fixture(t);
  const directory = f.conversationOperationLockDirectory;
  const holder = operationHolder("lock-chat", process.pid, NOW);
  await acquireConversationOperationLock(directory, holder);
  assert.deepEqual(
    Object.keys(
      JSON.parse(
        fs.readFileSync(path.join(directory, "lock-chat.lock"), "utf8")
      )
    ).sort(),
    ["conversationId", "createdAt", "operationId", "operationType", "pid"].sort()
  );
  assert.equal(
    fs.statSync(path.join(directory, "lock-chat.lock")).mode & 0o777,
    0o600
  );
  assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  assert.equal(
    (await clearStaleConversationOperationLock(directory, "lock-chat", {
      now: () => new Date("2026-07-24T01:59:59.999Z"),
      maxAgeMs: 2 * 60 * 60 * 1000,
      isProcessAlive: () => true
    })).active,
    true
  );
  assert.equal(
    await releaseConversationOperationLock(directory, {
      ...holder,
      pid: holder.pid + 1
    }),
    false
  );
  assert.equal(
    await releaseConversationOperationLock(directory, holder),
    true
  );

  await acquireConversationOperationLock(directory, holder);
  const overAgeButAlive = await clearStaleConversationOperationLock(
    directory,
    "lock-chat",
    {
      now: () => new Date("2026-07-24T02:00:00.000Z"),
      maxAgeMs: 2 * 60 * 60 * 1000,
      isProcessAlive: () => true
    }
  );
  assert.equal(overAgeButAlive.active, true);
  assert.equal(overAgeButAlive.removed, false);
  assert.deepEqual(
    await readConversationOperationLock(directory, "lock-chat"),
    holder
  );
  await releaseConversationOperationLock(directory, holder);

  await acquireConversationOperationLock(directory, holder);
  assert.equal(
    (await clearStaleConversationOperationLock(directory, "lock-chat", {
      now: () => new Date("2026-07-24T00:01:00.000Z"),
      isProcessAlive: () => false
    })).removed,
    true
  );
  await acquireConversationOperationLock(directory, holder);
  await assert.rejects(
    () => clearStaleConversationOperationLock(directory, "lock-chat", {
      now: () => new Date("2026-07-23T23:59:59.000Z")
    }),
    /不能位于未来/
  );
  await releaseConversationOperationLock(directory, holder);

  for (const failure of ["write", "sync", "chmod"]) {
    const id = `${failure}-chat`;
    const lockPath = path.join(directory, `${id}.lock`);
    await assert.rejects(
      () => acquireConversationOperationLock(
        directory,
        operationHolder(id, process.pid, NOW),
        { fileSystem: createFailingFileSystem(lockPath, failure) }
      ),
      (error) => {
        assert.match(error.message, /Conversation 操作锁创建失败/);
        assert.doesNotMatch(
          error.message,
          new RegExp(`fixture-${failure}-failure`)
        );
        return true;
      }
    );
    assert.equal(fs.existsSync(lockPath), false);
    const normalHolder = operationHolder(id, process.pid, NOW);
    await acquireConversationOperationLock(directory, normalHolder);
    await releaseConversationOperationLock(directory, normalHolder);
  }

  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(
    path.join(directory, "broken-chat.lock"),
    JSON.stringify({ ...operationHolder("broken-chat", process.pid, NOW), prompt: "bad" })
  );
  await assert.rejects(
    () => readConversationOperationLock(directory, "broken-chat"),
    /未知字段/
  );
});

test("两个独立进程竞争共享 lease 时不能同时进入临界区且 guard 会释放", async (t) => {
  const f = await fixture(t);
  const startBarrierPath = path.join(f.root, "barriers", "lease-start");
  const criticalMarkerPath = path.join(f.root, "barriers", "lease-critical");
  const criticalEnteredPath = path.join(f.root, "barriers", "lease-entered");
  const criticalBusyPath = path.join(f.root, "barriers", "lease-busy");
  const criticalReleasePath = path.join(f.root, "barriers", "lease-release");
  fs.mkdirSync(path.dirname(startBarrierPath), { recursive: true });

  const children = [
    startChild(f, {
      action: "agent-call-critical",
      operationId: "msg-00000000-0000-4000-8000-000000000011",
      startBarrierPath,
      criticalMarkerPath,
      criticalEnteredPath,
      criticalBusyPath,
      criticalReleasePath
    }),
    startChild(f, {
      action: "agent-call-critical",
      operationId: "msg-00000000-0000-4000-8000-000000000012",
      startBarrierPath,
      criticalMarkerPath,
      criticalEnteredPath,
      criticalBusyPath,
      criticalReleasePath
    })
  ];
  for (const child of children) t.after(() => child.kill());

  fs.writeFileSync(startBarrierPath, "start\n", "utf8");
  await waitForFile(criticalEnteredPath, 5000);
  await waitForFile(criticalBusyPath, 5000);
  fs.writeFileSync(criticalReleasePath, "release\n", "utf8");
  const results = await Promise.all(children.map((child) => child.result));

  assert.equal(results.filter((item) => item.ok && item.result.entered).length, 1);
  assert.equal(
    results.filter((item) => item.ok && item.result.overlap).length,
    0
  );
  assert.equal(
    results.filter(
      (item) => item.ok && !item.result.entered && /全局串行/.test(item.result.error)
    ).length,
    1
  );
  assert.equal(
    fs.readFileSync(criticalEnteredPath, "utf8").trim().split("\n").length,
    1
  );
  assert.equal(fs.existsSync(f.agentCallLeasePath), false);
  assert.equal(
    fs.existsSync(resolveFileLeaseMutationGuardPath(f.agentCallLeasePath)),
    false
  );
});

test("活跃子进程持有 Agent-call lease 超过 maxAge 后仍阻止并发调用", async (t) => {
  const f = await fixture(t);
  const startBarrierPath = path.join(f.root, "barriers", "over-age-start");
  const criticalMarkerPath = path.join(f.root, "barriers", "over-age-critical");
  const criticalEnteredPath = path.join(f.root, "barriers", "over-age-entered");
  const criticalBusyPath = path.join(f.root, "barriers", "over-age-busy");
  const criticalReleasePath = path.join(f.root, "barriers", "over-age-release");
  fs.mkdirSync(path.dirname(startBarrierPath), { recursive: true });

  const active = startChild(f, {
    action: "agent-call-critical",
    operationId: "msg-00000000-0000-4000-8000-000000000031",
    startBarrierPath,
    criticalMarkerPath,
    criticalEnteredPath,
    criticalBusyPath,
    criticalReleasePath
  });
  t.after(() => active.kill());
  fs.writeFileSync(startBarrierPath, "start\n", "utf8");
  await waitForFile(criticalEnteredPath, 5000);

  const overAge = await clearStaleAgentCallLease(f.agentCallLeasePath, {
    now: () => new Date("2026-07-24T03:00:00.000Z"),
    maxAgeMs: 1000
  });
  assert.equal(overAge.active, true);
  assert.equal(overAge.removed, false);

  const competing = await runChild(f, {
    action: "agent-call-once",
    operationId: "msg-00000000-0000-4000-8000-000000000032"
  });
  assert.equal(competing.ok, false);
  assert.match(competing.error, /全局串行/);
  assert.equal(fs.existsSync(f.agentCallLeasePath), true);

  fs.writeFileSync(criticalReleasePath, "release\n", "utf8");
  const completed = await active.result;
  assert.equal(completed.ok, true, JSON.stringify(completed));
  assert.equal(completed.result.entered, true);
  assert.equal(completed.result.overlap, false);
  assert.equal(fs.existsSync(f.agentCallLeasePath), false);
  assert.equal(
    fs.existsSync(resolveFileLeaseMutationGuardPath(f.agentCallLeasePath)),
    false
  );
});

test("持有 Agent-call lease 的子进程被 SIGKILL 后可立即恢复并重新获取", async (t) => {
  const f = await fixture(t);
  const startBarrierPath = path.join(f.root, "barriers", "crash-start");
  const criticalMarkerPath = path.join(f.root, "barriers", "crash-critical");
  const criticalEnteredPath = path.join(f.root, "barriers", "crash-entered");
  const criticalBusyPath = path.join(f.root, "barriers", "crash-busy");
  const criticalReleasePath = path.join(f.root, "barriers", "crash-release");
  fs.mkdirSync(path.dirname(startBarrierPath), { recursive: true });

  const crashed = startChild(f, {
    action: "agent-call-critical",
    operationId: "msg-00000000-0000-4000-8000-000000000033",
    startBarrierPath,
    criticalMarkerPath,
    criticalEnteredPath,
    criticalBusyPath,
    criticalReleasePath
  });
  t.after(() => crashed.kill());
  fs.writeFileSync(startBarrierPath, "start\n", "utf8");
  await waitForFile(criticalEnteredPath, 5000);
  crashed.child.kill("SIGKILL");
  await assert.rejects(crashed.result, /没有结果/);

  const recovered = await clearStaleAgentCallLease(f.agentCallLeasePath, {
    now: () => new Date("2026-07-24T00:01:00.000Z"),
    maxAgeMs: 2 * 60 * 60 * 1000
  });
  assert.equal(recovered.removed, true);
  assert.equal(fs.existsSync(f.agentCallLeasePath), false);

  const next = await runChild(f, {
    action: "agent-call-once",
    operationId: "msg-00000000-0000-4000-8000-000000000034"
  });
  assert.equal(next.ok, true, JSON.stringify(next));
  assert.deepEqual(next.result, { acquired: true, released: true });
  assert.equal(fs.existsSync(f.agentCallLeasePath), false);
  assert.equal(
    fs.existsSync(resolveFileLeaseMutationGuardPath(f.agentCallLeasePath)),
    false
  );
});

test("独立子进程崩溃遗留的 mutation guard 可按死 PID 恢复", async (t) => {
  const f = await fixture(t);
  const guardPath = resolveFileLeaseMutationGuardPath(f.agentCallLeasePath);
  const guardEnteredPath = path.join(f.root, "barriers", "guard-entered");
  const guardReleasePath = path.join(f.root, "barriers", "guard-release");
  fs.mkdirSync(path.dirname(guardEnteredPath), { recursive: true });

  const crashed = startChild(f, {
    action: "mutation-guard-hold",
    guardEnteredPath,
    guardReleasePath
  });
  t.after(() => crashed.kill());
  await waitForFile(guardEnteredPath, 5000);

  const guard = JSON.parse(fs.readFileSync(guardPath, "utf8"));
  assert.deepEqual(
    Object.keys(guard).sort(),
    ["createdAt", "guardId", "pid"].sort()
  );
  assert.match(guard.guardId, /^guard-[0-9a-f-]{36}$/);
  assert.equal(guard.pid, crashed.child.pid);
  assert.equal(Number.isFinite(Date.parse(guard.createdAt)), true);
  assert.equal(fs.statSync(guardPath).mode & 0o777, 0o600);

  crashed.child.kill("SIGKILL");
  await assert.rejects(crashed.result, /没有结果/);
  assert.equal(fs.existsSync(guardPath), true);

  const recovered = await runChild(f, {
    action: "agent-call-once",
    operationId: "msg-00000000-0000-4000-8000-000000000021"
  });
  assert.equal(recovered.ok, true, JSON.stringify(recovered));
  assert.deepEqual(recovered.result, { acquired: true, released: true });
  assert.equal(fs.existsSync(f.agentCallLeasePath), false);
  assert.equal(fs.existsSync(guardPath), false);
});

test("活跃子进程持有的 mutation guard 不会被抢占或删除", async (t) => {
  const f = await fixture(t);
  const guardPath = resolveFileLeaseMutationGuardPath(f.agentCallLeasePath);
  const guardEnteredPath = path.join(f.root, "barriers", "live-guard-entered");
  const guardReleasePath = path.join(f.root, "barriers", "live-guard-release");
  fs.mkdirSync(path.dirname(guardEnteredPath), { recursive: true });

  const active = startChild(f, {
    action: "mutation-guard-hold",
    guardEnteredPath,
    guardReleasePath
  });
  t.after(() => active.kill());
  await waitForFile(guardEnteredPath, 5000);
  const before = fs.readFileSync(guardPath);

  await assert.rejects(
    () => withFileLeaseMutationGuard(
      f.agentCallLeasePath,
      async () => {
        throw new Error("不应进入临界区");
      },
      {
        mutationGuardWaitMs: 100,
        mutationGuardRetryMs: 10
      }
    ),
    (error) => error.code === FILE_LEASE_MUTATION_GUARD_BUSY_CODE
  );
  assert.deepEqual(fs.readFileSync(guardPath), before);

  fs.writeFileSync(guardReleasePath, "release\n", "utf8");
  const completed = await active.result;
  assert.equal(completed.ok, true, JSON.stringify(completed));
  assert.equal(fs.existsSync(guardPath), false);
});

async function fixture(t) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "openclaw-conversation-cross-process-")
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const value = {
    root,
    fakeHome: path.join(root, "fake-home"),
    conversationStatePath: path.join(root, "state", "conversations", "state.json"),
    conversationStateLockPath: path.join(root, "state", "conversations", "locks", "state-write.lock"),
    messageStateDirectory: path.join(root, "state", "conversations", "messages"),
    messageStateLockDirectory: path.join(root, "state", "conversations", "locks", "messages"),
    instanceStatePath: path.join(root, "state", "instances", "state.json"),
    projectStatePath: path.join(root, "state", "projects", "state.json"),
    agentCallLeasePath: path.join(root, "state", "agent-call", "active.lock"),
    conversationOperationLockDirectory: path.join(root, "state", "conversations", "operations"),
    now: NOW,
    timeoutMs: 10000
  };
  fs.mkdirSync(value.fakeHome, { recursive: true });
  await writeInstanceState(value.instanceStatePath, {
    schemaVersion: 1,
    instances: {
      "test-role-worker": instanceRecord(root)
    }
  });
  return value;
}

function runChild(fixtureValue, overrides) {
  return startChild(fixtureValue, overrides).result;
}

function startChild(fixtureValue, overrides) {
  const config = { ...fixtureValue, ...overrides };
  const encoded = Buffer.from(JSON.stringify(config)).toString("base64url");
  const child = spawn(process.execPath, [CHILD, encoded], {
    cwd: projectPath("."),
    env: {
      HOME: fixtureValue.fakeHome,
      PATH: process.env.PATH || "",
      TMPDIR: os.tmpdir()
    },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  const timeout = setTimeout(() => child.kill("SIGKILL"), 15000);
  const result = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      const line = stdout.trim().split("\n").filter(Boolean).at(-1);
      if (!line) {
        reject(
          new Error(
            `Conversation 子进程没有结果（code=${code}, signal=${signal}, stderr=${stderr.trim()}）`
          )
        );
        return;
      }
      try {
        resolve(JSON.parse(line));
      } catch (error) {
        reject(new Error("Conversation 子进程输出不是 JSON：" + line));
      }
    });
  });
  return {
    child,
    result,
    kill() {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }
  };
}

function instanceRecord(root) {
  return {
    instanceId: "test-role-worker",
    roleId: "test-role",
    roleVersion: "1.0.0",
    roleAgentId: "worker",
    workspacePath: path.join(root, "unused-workspace"),
    agentDir: path.join(root, "unused-agent"),
    status: "registered",
    registeredAt: NOW,
    updatedAt: NOW,
    lastReconciledAt: NOW,
    drift: []
  };
}

function messageIds(start) {
  return [messageId(start), messageId(start + 1)];
}

function messageId(number) {
  return `msg-00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

function turnId(number) {
  return `turn-00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

function operationHolder(conversationId, pid, createdAt) {
  return {
    operationId: `send-${conversationId}`,
    conversationId,
    operationType: "send",
    pid,
    createdAt
  };
}

async function waitForFile(filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("等待子进程屏障超时：" + path.basename(filePath));
}

function createFailingFileSystem(lockPath, failure) {
  return {
    ...fsPromises,
    async chmod(target, mode) {
      if (failure === "chmod" && path.resolve(target) === path.resolve(lockPath)) {
        throw new Error("fixture-chmod-failure");
      }
      return fsPromises.chmod(target, mode);
    },
    async open(target, flags, mode) {
      const handle = await fsPromises.open(target, flags, mode);
      const isTargetLock =
        path.resolve(target) === path.resolve(lockPath);
      return {
        stat: (...args) => handle.stat(...args),
        close: (...args) => handle.close(...args),
        async writeFile(...args) {
          if (failure === "write" && isTargetLock) {
            throw new Error("fixture-write-failure");
          }
          return handle.writeFile(...args);
        },
        async sync(...args) {
          if (failure === "sync" && isTargetLock) {
            throw new Error("fixture-sync-failure");
          }
          return handle.sync(...args);
        }
      };
    }
  };
}
