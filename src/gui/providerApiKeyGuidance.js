(function exposeProviderApiKeyGuidance(root, factory) {
  const guidance = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = guidance;
  }

  if (root) {
    root.openClawProviderApiKeyGuidance = guidance;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createProviderApiKeyGuidance() {
  "use strict";

  const providers = Object.freeze({
    openrouter: Object.freeze({
      label: "OpenRouter",
      url: "https://openrouter.ai/settings/keys",
      hint: "登录后进入 Keys 页面创建 API Key；部分模型可能需要账户额度。"
    }),
    deepseek: Object.freeze({
      label: "DeepSeek",
      url: "https://platform.deepseek.com/api_keys",
      hint: "完整密钥通常只在创建时显示，请立即复制；API 服务可能需要单独充值。"
    }),
    openai: Object.freeze({
      label: "OpenAI",
      url: "https://platform.openai.com/api-keys",
      hint: "ChatGPT Plus 不包含 API 调用额度，API 需要独立开通和计费。OpenAI API 仅在官方支持的国家和地区提供，部分网络环境可能无法访问。"
    }),
    gemini: Object.freeze({
      label: "Gemini",
      url: "https://aistudio.google.com/app/apikey",
      hint: "通过 Google AI Studio 创建 API Key，密钥与 Google Cloud 项目关联。"
    }),
    qwen: Object.freeze({
      label: "Qwen / 通义千问",
      url: "https://help.aliyun.com/zh/model-studio/get-api-key",
      hint: "请按照阿里云百炼官方中文教程创建 API Key，可能需要开通服务并完成实名认证。"
    })
  });

  function getProviderApiKeyGuidance(providerId) {
    if (typeof providerId !== "string") {
      return null;
    }

    return providers[providerId.toLowerCase()] || null;
  }

  return Object.freeze({
    providers,
    getProviderApiKeyGuidance
  });
});
