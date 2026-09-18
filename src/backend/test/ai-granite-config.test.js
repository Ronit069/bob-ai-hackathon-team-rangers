// Granite/watsonx configuration boundary tests (Feature 2 preparation).
// Pure unit tests: no database, no network, no credentials.
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
});

test("granite runtime status is a non-secret, controlled view", () => {
  const missing = graniteRuntimeStatus({
    watsonx: { configured: false, modelId: "ibm/granite-3-8b-instruct", missing: ["WATSONX_API_KEY"] },
  });
  assert.equal(missing.configured, false);
  assert.equal(missing.available, false);
  assert.equal(missing.reason, "provider_not_configured");
  assert.deepEqual(missing.missing, ["WATSONX_API_KEY"]);
  assert.equal(missing.model_id, "ibm/granite-3-8b-instruct");

  const pending = graniteRuntimeStatus({
    watsonx: { configured: true, modelId: "ibm/granite-3-8b-instruct", missing: [] },
  });
  assert.equal(pending.configured, true);
  assert.equal(pending.available, false);
  assert.equal(pending.reason, "granite_runtime_pending");

  const leaky = graniteRuntimeStatus({ watsonx: { configured: true, apiKey: FAKE_KEY, missing: [] } });
  assert.ok(!JSON.stringify(leaky).includes(FAKE_KEY), "status must never include the API key");
});

test("missing/placeholder credentials resolve to a controlled disabled provider", async () => {
  const provider = resolveDefaultProvider({
    apiUrl: "",
    watsonx: { configured: false, missing: ["WATSONX_API_KEY"], apiKey: "" },
  });
  assert.equal(provider.name, "none");
  assert.equal(provider.available, false);
  assert.equal(provider.reason, "provider_not_configured");
  await assert.rejects(
    () => provider.generate({ system: "s", prompt: "p" }),
    (error) => error instanceof ProviderError && error.reason === "provider_not_configured",
  );
});

test("configured Granite without a runtime adapter stays disabled and never leaks the key", async () => {
  const provider = resolveDefaultProvider({
    apiUrl: "",
    watsonx: { configured: true, apiKey: FAKE_KEY, projectId: "p", url: "https://example.invalid", missing: [] },
  });
  assert.equal(provider.available, false);
  assert.equal(provider.reason, "granite_runtime_pending");
  try {
    await provider.generate({ system: "s", prompt: "p" });
    assert.fail("generate must not succeed without the runtime adapter");
  } catch (error) {
    assert.equal(error instanceof ProviderError, true);
    assert.equal(error.reason, "granite_runtime_pending");
    assert.ok(!error.message.includes(FAKE_KEY));
    assert.ok(!JSON.stringify(error.details ?? {}).includes(FAKE_KEY));
  }
});

test("explicit Bob gateway configuration keeps Feature 1 backward compatibility", () => {
  const provider = resolveDefaultProvider({
    apiUrl: "http://gateway.local",
    apiKey: "unit-bob-key",
    watsonx: { configured: true, missing: [] },
  });
  assert.equal(provider.name, "bob_http");
  assert.equal(provider.available, true);
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
