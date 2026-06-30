// configure 输出格式化器：只负责把 core/configure 的结果转成中文终端文案。

function formatConfigureResult(result) {
  return result.message;
}

module.exports = {
  formatConfigureResult
};
