// AI provider adapter tests (watsonx / Gemini / Groq) with injected fetch.
// No real network calls and no real credentials: keys are explicit fakes.
import test from "node:test";
import assert from "node:assert/strict";
import { ProviderError } from "../src/ai/providerError.js";
import { createWatsonxProvider } from "../src/ai/providers/watsonx.js";
import { createGeminiProvider } from "../src/ai/providers/gemini.js";
import { createGroqProvider } from "../src/ai/providers/groq.js";

const FAKE_KEY = "fake-provider-key-not-a-real-secret";
const jsonResponse = (payload, status = 200) => ({ ok: status < 400, status, json: async () => payload });

const withWatsonx = (fetchImpl) =>
  createWatsonxProvider({
    apiKey: FAKE_KEY,
    projectId: "project-1",
    url: "https://us-south.ml.cloud.ibm.com",
    modelId: "ibm/granite-4-h-small",
    version: "2024-10-01",
    fetchImpl,
  });

const tokenThen = (chatPayload) => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("identity/token")) {
      return jsonResponse({ access_token: "iam-token", expires_in: 3600 });
    }
    return jsonResponse(chatPayload);
  };
  return { calls, fetchImpl };
};

// ---------------------------------------------------------------------------
// watsonx / Granite
// ---------------------------------------------------------------------------
test("watsonx provider is available only with complete configuration", async () => {
  const provider = createWatsonxProvider({ apiKey: FAKE_KEY, projectId: "p", url: "", fetchImpl: async () => jsonResponse({}) });
  assert.equal(provider.available, false);
  await assert.rejects(
    () => provider.generate({ system: "s", prompt: "p" }),
    (error) => error instanceof ProviderError && error.reason === "provider_not_configured",
  );
});

test("watsonx exchanges the API key for an IAM token and calls text/chat", async () => {
  const { calls, fetchImpl } = tokenThen({ choices: [{ message: { content: "Granite answer" } }] });
  const provider = withWatsonx(fetchImpl);

  assert.equal(provider.available, true);
  const result = await provider.generate({ system: "sys rules", prompt: "hello" });
  assert.equal(result.text, "Granite answer");
  assert.equal(calls.length, 2);

  assert.equal(calls[0].url, "https://iam.cloud.ibm.com/identity/token");
  assert.match(String(calls[0].options.body), /grant_type=urn%3Aibm%3Aparams%3Aoauth%3Agrant-type%3Aapikey/);
  assert.match(String(calls[0].options.body), /apikey=/);

  assert.match(String(calls[1].url), /^https:\/\/us-south\.ml\.cloud\.ibm\.com\/ml\/v1\/text\/chat\?version=2024-10-01$/);
  assert.equal(calls[1].options.headers.authorization, "Bearer iam-token");
  const body = JSON.parse(calls[1].options.body);
  assert.equal(body.model_id, "ibm/granite-4-h-small");
  assert.equal(body.project_id, "project-1");
  assert.deepEqual(body.messages[0], { role: "system", content: "sys rules" });
  assert.deepEqual(body.messages[1], { role: "user", content: "hello" });
});

test("watsonx caches the IAM token across generate calls", async () => {
  const { calls, fetchImpl } = tokenThen({ choices: [{ message: { content: "ok" } }] });
  const provider = withWatsonx(fetchImpl);

  await provider.generate({ system: "s", prompt: "one" });
  await provider.generate({ system: "s", prompt: "two" });

  const tokenCalls = calls.filter((call) => call.url.includes("identity/token"));
  assert.equal(tokenCalls.length, 1);
  assert.equal(calls.length, 3);
});

test("watsonx classifies provider failures without leaking the key", async () => {
  const unauthorized = withWatsonx(async (url) => {
    if (String(url).includes("identity/token")) return jsonResponse({ access_token: "t", expires_in: 3600 });
    return jsonResponse({ error: { message: "unauthorized" } }, 401);
  });
  await assert.rejects(
    () => unauthorized.generate({ system: "s", prompt: "p" }),
    (error) => {
      assert.equal(error.reason, "provider_error");
      assert.equal(error.details.status, 401);
      assert.ok(!JSON.stringify({ message: error.message, details: error.details }).includes(FAKE_KEY));
      return true;
    },
  );

  const unreachable = withWatsonx(async () => {
    throw new Error("connect ECONNREFUSED");
  });
  await assert.rejects(
    () => unreachable.generate({ system: "s", prompt: "p" }),
    (error) => error.reason === "provider_unreachable",
  );

  const timeout = withWatsonx(async () => {
    const error = new Error("timed out");
    error.name = "TimeoutError";
    throw error;
  });
  await assert.rejects(
    () => timeout.generate({ system: "s", prompt: "p" }),
    (error) => error.reason === "provider_timeout",
  );

  const empty = withWatsonx(async (url) => {
    if (String(url).includes("identity/token")) return jsonResponse({ access_token: "t", expires_in: 3600 });
    return jsonResponse({ choices: [{ message: { content: "  " } }] });
  });
  await assert.rejects(
    () => empty.generate({ system: "s", prompt: "p" }),
    (error) => error.reason === "provider_empty_response",
  );

  const invalid = withWatsonx(async (url) => {
    if (String(url).includes("identity/token")) return jsonResponse({ access_token: "t", expires_in: 3600 });
    return { ok: true, status: 200, json: async () => { throw new Error("not json"); } };
  });
  await assert.rejects(
    () => invalid.generate({ system: "s", prompt: "p" }),
    (error) => error.reason === "provider_invalid_response",
  );
});

test("quota exhaustion and rate limiting are classified distinctly", async () => {
  const quota = withWatsonx(async (url) => {
    if (String(url).includes("identity/token")) return jsonResponse({ access_token: "t", expires_in: 3600 });
    return jsonResponse({ errors: [{ message: "Request of 1 token(s) from quota was rejected" }] }, 403);
  });
  await assert.rejects(
    () => quota.generate({ system: "s", prompt: "p" }),
    (error) => error.reason === "provider_quota_exceeded" && error.details.status === 403,
  );

  const rateLimited = createGroqProvider({
    apiKey: FAKE_KEY,
    modelId: "m",
    fetchImpl: async () => jsonResponse({ error: { message: "rate limit reached" } }, 429),
  });
  await assert.rejects(
    () => rateLimited.generate({ system: "s", prompt: "p" }),
    (error) => error.reason === "provider_rate_limited",
  );
});

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

test("Gemini provider sends the documented generateContent request", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return jsonResponse({ candidates: [{ content: { parts: [{ text: "Gemini answer" }] } }] });
  };
  const provider = createGeminiProvider({ apiKey: FAKE_KEY, modelId: "gemini-2.0-flash", fetchImpl });

  assert.equal(provider.available, true);
  const result = await provider.generate({ system: "sys", prompt: "hello" });
  assert.equal(result.text, "Gemini answer");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent");
  assert.equal(calls[0].options.headers["x-goog-api-key"], FAKE_KEY);
  const body = JSON.parse(calls[0].options.body);
  assert.deepEqual(body.system_instruction, { parts: [{ text: "sys" }] });
  assert.deepEqual(body.contents, [{ role: "user", parts: [{ text: "hello" }] }]);
  assert.equal(body.generationConfig.temperature, 0);
});

test("Gemini provider classifies failures without leaking the key", async () => {
  const provider = createGeminiProvider({
    apiKey: FAKE_KEY,
    modelId: "gemini-2.0-flash",
    fetchImpl: async () => jsonResponse({ error: { message: "API key not valid" } }, 400),
  });
  await assert.rejects(
    () => provider.generate({ system: "s", prompt: "p" }),
    (error) => {
      assert.equal(error.reason, "provider_error");
      assert.equal(error.details.status, 400);
      assert.ok(!JSON.stringify({ message: error.message, details: error.details }).includes(FAKE_KEY));
      return true;
    },
  );

  const empty = createGeminiProvider({
    apiKey: FAKE_KEY,
    modelId: "gemini-2.0-flash",
    fetchImpl: async () => jsonResponse({ candidates: [{ content: { parts: [] } }] }),
  });
  await assert.rejects(
    () => empty.generate({ system: "s", prompt: "p" }),
    (error) => error.reason === "provider_empty_response",
  );

  const unavailable = createGeminiProvider({ apiKey: "", fetchImpl: async () => jsonResponse({}) });
  assert.equal(unavailable.available, false);
});

// ---------------------------------------------------------------------------
// Groq
// ---------------------------------------------------------------------------
test("Groq provider sends the OpenAI-compatible chat completion request", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return jsonResponse({ choices: [{ message: { content: "Groq answer" } }] });
  };
  const provider = createGroqProvider({ apiKey: FAKE_KEY, modelId: "llama-3.3-70b-versatile", fetchImpl });

  assert.equal(provider.available, true);
  const result = await provider.generate({ system: "sys", prompt: "hello" });
  assert.equal(result.text, "Groq answer");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.groq.com/openai/v1/chat/completions");
  assert.equal(calls[0].options.headers.authorization, `Bearer ${FAKE_KEY}`);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, "llama-3.3-70b-versatile");
  assert.deepEqual(body.messages, [
    { role: "system", content: "sys" },
    { role: "user", content: "hello" },
  ]);
});

test("Groq provider classifies failures without leaking the key", async () => {
  const provider = createGroqProvider({
    apiKey: FAKE_KEY,
    modelId: "llama-3.3-70b-versatile",
    fetchImpl: async () => jsonResponse({ error: { message: "invalid api key" } }, 401),
  });
  await assert.rejects(
    () => provider.generate({ system: "s", prompt: "p" }),
    (error) => {
      assert.equal(error.reason, "provider_error");
      assert.ok(!JSON.stringify({ message: error.message, details: error.details }).includes(FAKE_KEY));
      return true;
    },
  );

  const unreachable = createGroqProvider({
    apiKey: FAKE_KEY,
    modelId: "m",
    fetchImpl: async () => {
      throw new Error("network down");
    },
  });
  await assert.rejects(
    () => unreachable.generate({ system: "s", prompt: "p" }),
    (error) => error.reason === "provider_unreachable",
  );
});
