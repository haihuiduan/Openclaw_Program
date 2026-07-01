// AI 服务配置检测：只判断配置完整性，绝不打印完整 API Key。

const fallbackApiKeyEnvNames = [
  "DEEPSEEK_API_KEY",
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "GEMINI_API_KEY",
  "ANTHROPIC_API_KEY",
  "QWEN_API_KEY",
  "ZHIPU_API_KEY",
  "MOONSHOT_API_KEY"
];

function checkAiConfig(config) {
  const aiConfig = resolveAiConfig(config);

  if (aiConfig.provider && aiConfig.apiKey && aiConfig.model) {
    return {
      name: "AI 服务配置",
      ok: true,
      level: "pass",
      category: "ai_config",
      code: "AI_CONFIG_OK",
      message: `已配置 AI 服务商：${aiConfig.provider}，默认模型：${aiConfig.model}，API Key：已配置。`,
      suggestion: "",
      repairable: false,
      repairAction: null
    };
  }

  if (aiConfig.apiKey) {
    return {
      name: "AI 服务配置",
      ok: true,
      level: "warning",
      category: "ai_config",
      code: "AI_CONFIG_INCOMPLETE",
      message: "检测到 API Key，但 AI 服务商或默认模型尚未完整配置。",
      suggestion: "请补充 AI 服务商和默认模型配置。后续版本可通过 openclaw-installer repair 协助配置。",
      repairable: true,
      repairAction: "configure_ai_provider"
    };
  }

  return {
    name: "AI 服务配置",
    ok: true,
    level: "info",
    category: "ai_config",
    code: "AI_CONFIG_NOT_FOUND",
    message: "未检测到 AI 服务配置，后续使用模型服务前需要配置。",
    suggestion: "后续使用模型服务前，请配置 AI 服务商、默认模型和 API Key。",
    repairable: true,
    repairAction: "configure_ai_provider"
  };
}

function resolveAiConfig(config) {
  const ai = config.ai || {};

  return {
    provider: ai.provider || process.env.OPENCLAW_AI_PROVIDER || "",
    apiKey: ai.apiKey || process.env.OPENCLAW_API_KEY || findFallbackApiKey(),
    baseUrl: ai.baseUrl || process.env.OPENCLAW_BASE_URL || "",
    model: ai.model || process.env.OPENCLAW_MODEL || ""
  };
}

function findFallbackApiKey() {
  for (const name of fallbackApiKeyEnvNames) {
    if (process.env[name]) {
      return process.env[name];
    }
  }

  return "";
}

module.exports = {
  checkAiConfig
};
