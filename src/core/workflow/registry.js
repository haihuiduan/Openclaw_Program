// workflow registry：集中登记所有可执行流程，engine 只从这里读取流程定义。
const runDoctorStep = require("./steps/run_doctor");
const runVerifyStep = require("./steps/run_verify");
const environmentCheck = require("./steps/environment_check");
const checkExistingInstall = require("./steps/check_existing_install");
const prepareDirectory = require("./steps/prepare_directory");
const downloadScript = require("./steps/download_script");
const executeScript = require("./steps/execute_script");
const verifyInstallation = require("./steps/verify_installation");
const { compose } = require("./composer");

const workflows = {
  install: {
    id: "install",
    label: "OpenClaw 安装流程",
    steps: [
      environmentCheck,
      checkExistingInstall,
      prepareDirectory,
      downloadScript,
      executeScript,
      verifyInstallation
    ]
  },
  doctor: {
    id: "doctor",
    label: "OpenClaw 环境检测流程",
    steps: [runDoctorStep]
  },
  verify: {
    id: "verify",
    label: "OpenClaw 验证流程",
    steps: [runVerifyStep]
  }
};

workflows.setup = {
  ...compose(["doctor", "install", "verify"], { workflows }),
  id: "setup",
  label: "OpenClaw 一键准备流程"
};

function getWorkflow(id) {
  return workflows[id] || null;
}

module.exports = {
  getWorkflow,
  workflows
};
