const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..", "..");
const {
  acquireExecutionLease
} = require(path.join(projectRoot, "src/core/executions/locks.js"));
const {
  acquireAgentCallLease,
  releaseAgentCallLease
} = require(path.join(
  projectRoot,
  "src/core/openclaw-agent/agentCallLease.js"
));

const config = JSON.parse(
  Buffer.from(process.argv[2] || "", "base64url").toString("utf8")
);

async function main() {
  const holder = {
    operationId: config.runId,
    operationType: "execution",
    instanceId: config.instanceId,
    pid: process.pid,
    createdAt: config.createdAt
  };
  await acquireAgentCallLease(config.agentCallLeasePath, holder);

  if (config.action === "acquire-and-crash") {
    await acquireExecutionLease(config.executionLeasePath, {
      runId: config.runId,
      pid: process.pid,
      createdAt: config.createdAt
    });
    writeResultAndExit({ acquired: true, pid: process.pid }, 73);
    return;
  }

  if (config.action === "acquire-agent-and-release") {
    const released = await releaseAgentCallLease(
      config.agentCallLeasePath,
      holder
    );
    writeResultAndExit({ acquired: true, released }, 0);
    return;
  }

  throw new Error("未知 Execution lease 子进程动作");
}

function writeResultAndExit(result, code) {
  process.stdout.write(JSON.stringify(result) + "\n", () => {
    process.exit(code);
  });
}

main().catch((error) => {
  process.stderr.write(String(error && error.stack || error) + "\n", () => {
    process.exit(1);
  });
});
