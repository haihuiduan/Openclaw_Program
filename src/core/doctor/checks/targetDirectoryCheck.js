// 安装目录检测：doctor 只检查目录状态，不创建目录。
const fs = require("node:fs/promises");

async function checkTargetDirectory(config) {
  try {
    const stats = await fs.stat(config.targetDir);

    if (!stats.isDirectory()) {
      return {
        name: "目标目录",
        ok: false,
        level: "fail",
        category: "directory",
        code: "TARGET_DIR_NOT_WRITABLE",
        message: "目标路径已存在，但不是文件夹，请更换安装目录。",
        suggestion: "请更换安装目录，或检查当前路径是否正确。",
        repairable: false,
        repairAction: null
      };
    }

    await fs.access(config.targetDir, fs.constants.W_OK);

    return {
      name: "目标目录",
      ok: true,
      level: "pass",
      category: "directory",
      code: "TARGET_DIR_OK",
      message: "目录存在且可写",
      suggestion: "",
      repairable: false,
      repairAction: null
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        name: "目标目录",
        ok: true,
        level: "info",
        category: "directory",
        code: "TARGET_DIR_NOT_EXISTS",
        message: "目录不存在，安装时将尝试创建",
        suggestion: "安装时将尝试创建该目录。",
        repairable: true,
        repairAction: "create_target_dir"
      };
    }

    return {
      name: "目标目录",
      ok: false,
      level: "fail",
      category: "directory",
      code: "TARGET_DIR_NOT_WRITABLE",
      message: "目标目录不可写，请更换目录或检查权限",
      suggestion: "请更换安装目录，或检查当前用户是否有写入权限。",
      repairable: false,
      repairAction: null
    };
  }
}

module.exports = {
  checkTargetDirectory
};
