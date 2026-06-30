// setup 模块：编排完整准备流程，不重复实现 doctor/install/configure/verify 内部逻辑。
const { runDoctor } = require("../doctor");
const { installOpenClaw } = require("../installer");

async function runSetup(config = {}) {
  if (config.dryRun) {
    return {
      ok: true,
      dryRun: true,
      steps: [
        "检测环境和依赖",
        "安装 OpenClaw，已安装则跳过",
        "启动 OpenClaw 官方配置向导",
        "验证 OpenClaw 是否可用"
      ]
    };
  }

  const doctorReport = await runDoctor(config);

  if (!doctorReport.ok) {
    return {
      ok: false,
      stage: "doctor",
      doctorReport,
      reason: "环境检测未通过，请先根据 doctor 报告修复问题。"
    };
  }

  const installResult = await installOpenClaw({
    ...config,
    dryRun: false
  });

  if (!installResult.ok) {
    return {
      ok: false,
      stage: "install",
      doctorReport,
      installResult,
      reason: "OpenClaw 安装失败。"
    };
  }

  return {
    ok: true,
    stage: "ready",
    doctorReport,
    installResult,
    message: "OpenClaw 已完成安装准备。请继续运行 configure 完成 API 配置，然后运行 verify 验证是否可用。"
  };
}

module.exports = {
  runSetup
};
