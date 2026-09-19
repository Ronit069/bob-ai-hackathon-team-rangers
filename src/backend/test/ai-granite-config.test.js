// AI provider configuration, registry and safety tests (Feature 2 runtime).
// No network: provider HTTP behavior is covered in ai-providers.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/common/config.js";
import {
  ProviderError,
  createDisabledProvider,
  graniteRuntimeStatus,
  resolveDefaultProvider,
} from "../src/ai/provider.js";

const FAKE_KEY = "unit-fake-watsonx-key-not-a-real-secret";

test("centralized config exposes the watsonx boundary with safe defaults", () => {
  const watsonx = config.watsonx;
  assert.equal(typeof watsonx, "object");
  for (const key of ["apiKey", "projectId", "url", "modelId"]) {
    assert.equal(typeof watsonx[key], "string", `${key} must be a string`);
  }
  assert.equal(watsonx.modelId.length > 0, true);
  assert.equal(typeof watsonx.configured, "boolean");
  assert.equal(Array.isArray(watsonx.missing), true);
  assert.equal(watsonx.configured, watsonx.missing.length === 0);
  for (const name of watsonx.missing) {
    assert.ok(["WATSONX_API_KEY", "WATSONX_PROJECT_ID", "WATSONX_URL"].includes(name));
  }
  for (const value of [watsonx.apiKey, watsonx.projectId, watsonx.url]) {
    assert.ok(!value.includes("YOUR_"), "placeholders must be treated as absent");
  }
  assert.equal(typeof config.aiProvider, "string");
  assert.equal(typeof config.gemini.apiKey, "string");
  assert.equal(typeof config.groq.apiKey, "string");
  assert.equal(typeof config.aiAgentMaxToolCalls, "number");
});

test("granite runtime status reflects configuration without secrets", () => {
  const missing = graniteRuntimeStatus({
    watsonx: { configured: false, modelId: "ibm/granite-4-h-small", missing: ["WATSONX_API_KEY"] },
  });
  assert.equal(missing.configured, false);
  assert.equal(missing.available, false);
  assert.equal(missing.reason, "provider_not_configured");
  assert.deepEqual(missing.missing, ["WATSONX_API_KEY"]);

  const configured = graniteRuntimeStatus({
    watsonx: { configured: true, modelId: "ibm/granite-4-h-small", missing: [] },
  });
  assert.equal(configured.configured, true);
  assert.equal(configured.available, true);
  assert.equal(configured.reason, null);

  const leaky = graniteRuntimeStatus({ watsonx: { configured: true, apiKey: FAKE_KEY, missing: [] } });
  assert.ok(!JSON.stringify(leaky).includes(FAKE_KEY), "status must never include the API key");
});

test("missing/placeholder credentials resolve to a controlled disabled provider", async () => {
  const provider = resolveDefaultProvider({
    apiUrl: "",
    selection: "auto",
    watsonx: { configured: false, missing: ["WATSONX_API_KEY"] },
    gemini: { apiKey: "" },
    groq: { apiKey: "" },
  });
  assert.equal(provider.name, "none");
  assert.equal(provider.available, false);
  assert.equal(provider.reason, "provider_not_configured");
  await assert.rejects(
    () => provider.generate({ system: "s", prompt: "p" }),
    (error) => error instanceof ProviderError && error.reason === "provider_not_configured",
  );
});

test("AI_PROVIDER forces the selected provider and reports missing credentials safely", () => {
  const watsonx = resolveDefaultProvider({
    selection: "watsonx",
    apiUrl: "",
    watsonx: { configured: true, apiKey: "k", projectId: "p", url: "https://example.invalid", modelId: "m" },
  });
  assert.equal(watsonx.name, "granite_watsonx");
  assert.equal(watsonx.available, true);

  const gemini = resolveDefaultProvider({
    selection: "gemini",
    apiUrl: "",
    gemini: { apiKey: "k", modelId: "gemini-2.0-flash" },
    watsonx: { configured: false },
  });
  assert.equal(gemini.name, "gemini");
  assert.equal(gemini.available, true);

  const groq = resolveDefaultProvider({
    selection: "groq",
    apiUrl: "",
    groq: { apiKey: "k", modelId: "llama-3.3-70b-versatile" },
    watsonx: { configured: false },
  });
  assert.equal(groq.name, "groq");
  assert.equal(groq.available, true);

  const none = resolveDefaultProvider({ selection: "none" });
  assert.equal(none.name, "none");
  assert.equal(none.available, false);

  const forcedMissing = resolveDefaultProvider({ selection: "gemini", apiUrl: "", gemini: { apiKey: "" } });
  assert.equal(forcedMissing.available, false);
  assert.equal(forcedMissing.reason, "provider_not_configured");
});

test("auto selection prefers the Bob gateway, then watsonx, then gemini, then groq", () => {
  const gateway = resolveDefaultProvider({
    selection: "auto",
    apiUrl: "http://gateway.local",
    apiKey: "k",
    watsonx: { configured: true, apiKey: "k", projectId: "p", url: "https://x" },
  });
  assert.equal(gateway.name, "bob_http");

  const watsonx = resolveDefaultProvider({
    selection: "auto",
    apiUrl: "",
    watsonx: { configured: true, apiKey: "k", projectId: "p", url: "https://x", modelId: "m" },
    gemini: { apiKey: "g" },
    groq: { apiKey: "q" },
  });
  assert.equal(watsonx.name, "granite_watsonx");

  const gemini = resolveDefaultProvider({
    selection: "auto",
    apiUrl: "",
    watsonx: { configured: false },
    gemini: { apiKey: "g", modelId: "gemini-2.0-flash" },
    groq: { apiKey: "q" },
  });
  assert.equal(gemini.name, "gemini");

  const groq = resolveDefaultProvider({
    selection: "auto",
    apiUrl: "",
    watsonx: { configured: false },
    gemini: { apiKey: "" },
    groq: { apiKey: "q", modelId: "llama-3.3-70b-versatile" },
  });
  assert.equal(groq.name, "groq");
});

test("disabled provider defaults remain backward compatible", async () => {
  const provider = createDisabledProvider();
  assert.equal(provider.name, "none");
  assert.equal(provider.available, false);
  assert.equal(provider.reason, "provider_not_configured");
  await assert.rejects(
    () => provider.generate({ system: "s", prompt: "p" }),
    (error) => error instanceof ProviderError && error.reason === "provider_not_configured",
  );
});
