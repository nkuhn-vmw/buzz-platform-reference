import test from "node:test";
import assert from "node:assert/strict";
import { resolveTanzuModelBinding } from "../bindings.js";

const binding = {
  name: "tanzu-model",
  credentials: { endpoint: { api_base: "https://ai.example", openai_api_base: "https://ai.example/v1", api_key: "secret" } },
};

const liveShapeBinding = {
  name: "tanzu-live-shape",
  credentials: { endpoint: {
    api_base: "https://ai.example",
    api_key: "endpoint-key",
    config_url: "https://ai.example/config",
    name: "Qwen/Qwen3.8-27B-FP8",
    openai_api_base: "https://ai.example/openai",
  } },
};

test("maps documented AI Services fields and an explicit chat model to buzz-agent settings", () => {
  assert.deepEqual(resolveTanzuModelBinding({ "ai-models": [binding] }, undefined, "Qwen/tool-chat"), {
    BUZZ_AGENT_PROVIDER: "openai",
    BUZZ_AGENT_MODEL: "Qwen/tool-chat",
    OPENAI_COMPAT_API: "chat",
    OPENAI_COMPAT_BASE_URL: "https://ai.example/v1",
    OPENAI_COMPAT_API_KEY: "secret",
  });
});

test("selects a binding by service name when several model bindings exist", () => {
  const other = { ...binding, name: "other", credentials: { endpoint: { ...binding.credentials.endpoint, api_key: "other-key" } } };
  assert.equal(resolveTanzuModelBinding({ "ai-models": [binding, other] }, "other", "Qwen/tool-chat").OPENAI_COMPAT_API_KEY, "other-key");
});

test("resolves the observed Tanzu AI Services endpoint credential shape", () => {
  const resolved = resolveTanzuModelBinding({ "ai-models": [liveShapeBinding] }, undefined, "Qwen/Qwen3.8-27B-FP8");
  assert.equal(resolved.OPENAI_COMPAT_BASE_URL, "https://ai.example/openai");
  assert.equal(resolved.OPENAI_COMPAT_API_KEY, "endpoint-key");
});

test("uses token credential fallback and rejects ambiguity or incomplete bindings", () => {
  const tokenBinding = { ...binding, credentials: { endpoint: { openai_api_base: binding.credentials.endpoint.openai_api_base }, token: "token" } };
  assert.equal(resolveTanzuModelBinding({ "ai-models": [tokenBinding] }, undefined, "Qwen/tool-chat").OPENAI_COMPAT_API_KEY, "token");
  assert.throws(() => resolveTanzuModelBinding({ "ai-models": [binding, tokenBinding] }, undefined, "Qwen/tool-chat"), /multiple usable/);
  assert.throws(() => resolveTanzuModelBinding({ "ai-models": [{ name: "bad", credentials: {} }] }, undefined, "Qwen/tool-chat"), /no usable/);
  assert.throws(() => resolveTanzuModelBinding({ "ai-models": [binding] }), /tool-capable model ID/);
});

test("rejects invalid VCAP JSON", () => {
  assert.throws(() => resolveTanzuModelBinding("{", undefined, "Qwen/tool-chat"), /not valid JSON/);
});
