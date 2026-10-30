/** Resolve one AI Services binding into buzz-agent's OpenAI-compatible env. */
export function resolveTanzuModelBinding(vcapServices, serviceName, modelName) {
  let services;
  try {
    services = typeof vcapServices === "string" ? JSON.parse(vcapServices) : vcapServices;
  } catch {
    throw new Error("VCAP_SERVICES is not valid JSON");
  }
  if (!services || typeof services !== "object" || Array.isArray(services)) {
    throw new Error("VCAP_SERVICES must be a JSON object");
  }

  const matches = Object.values(services).flat().filter((binding) => {
    const creds = binding?.credentials;
    return creds?.endpoint?.openai_api_base && (creds.endpoint.api_key || creds.api_key || creds.token);
  }).filter((binding) => !serviceName || binding.name === serviceName);

  if (matches.length !== 1) {
    const reason = matches.length === 0 ? "no usable ai-models binding found" : "multiple usable ai-models bindings found";
    throw new Error(`${reason}${serviceName ? ` for ${serviceName}` : "; set BUZZ_TANZU_AI_SERVICE"}`);
  }
  if (typeof modelName !== "string" || !modelName.trim()) {
    throw new Error("a tool-capable model ID is required; set BUZZ_TANZU_AI_MODEL");
  }

  const credentials = matches[0].credentials;
  return {
    BUZZ_AGENT_PROVIDER: "openai",
    BUZZ_AGENT_MODEL: modelName.trim(),
    OPENAI_COMPAT_API: "chat",
    OPENAI_COMPAT_BASE_URL: credentials.endpoint.openai_api_base,
    OPENAI_COMPAT_API_KEY: credentials.endpoint.api_key || credentials.api_key || credentials.token,
  };
}
