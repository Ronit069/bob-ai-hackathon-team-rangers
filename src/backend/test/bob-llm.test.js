// Bob Chat LLM path tests: the model chooses read-only MCP tools through the grounded
// tool agent; answers are grounding-checked and fall back safely. No network: the
// provider is an injected stub and tools run against the real test server.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/common/config.js";
import { setupTestDb, seedTestDatabase } from "../src/test-support/helpers.js";
import { startTestServer, api } from "../src/test-support/api.js";
import { ProviderError } from "../src/ai/providerError.js";

const stub = {
  name: "stub",
  available: true,
  calls: 0,
  responder: null,
  async generate(args) {
    stub.calls += 1;
    return stub.responder(stub.calls, args);
  },
};

let pool;
let server;
let baseUrl;

before(async () => {
  pool = await setupTestDb();
  await seedTestDatabase(pool);
  server = await startTestServer(pool, { aiProvider: stub });
  baseUrl = server.baseUrl;
});

after(async () => {
  await server.close();
  await pool.end();
});

const withBob = async (fn) => {
  const previous = { enabled: config.bobEnabled, apiUrl: config.bobApiUrl, port: config.port };
  config.bobEnabled = true;
  config.bobApiUrl = "";
  config.port = Number(new URL(baseUrl).port);
  try {
    return await fn();
  } finally {
    config.bobEnabled = previous.enabled;
    config.bobApiUrl = previous.apiUrl;
    config.port = previous.port;
  }
};

const query = (prompt) => api(baseUrl, "/api/bob/query", { method: "POST", body: { prompt } });

test("Bob returns the LLM-generated answer from the model's own tool calls", async () => {
  stub.calls = 0;
  stub.responder = (call) => {
    if (call === 1) return { text: JSON.stringify({ tool: "get_active_disruptions", input: {} }) };
    return { text: JSON.stringify({ final: "The active disruption list includes D01." }) };
  };

  const { status, body } = await withBob(() => query("Which disruptions are active?"));

  assert.equal(status, 200);
  assert.equal(body.status, "VALIDATED_AI");
  assert.equal(body.source, "llm");
  assert.equal(body.provider_name, "stub");
  assert.equal(body.answer, "The active disruption list includes D01.");
  assert.equal(body.grounding.ok, true);
  assert.equal(body.evidence.length, 1);
  assert.equal(body.evidence[0].tool, "get_active_disruptions");
  assert.equal(body.tool_calls, 1);
  assert.equal(stub.calls, 2);
});

test("an ungrounded LLM answer is discarded in favour of the deterministic engine", async () => {
  stub.calls = 0;
  stub.responder = (call) => {
    if (call === 1) return { text: JSON.stringify({ tool: "get_active_disruptions", input: {} }) };
    return { text: JSON.stringify({ final: "Shipment S999 is critical and has been reassigned." }) };
  };

  const { status, body } = await withBob(() => query("Which disruptions are active?"));

  assert.equal(status, 200);
  assert.equal(body.status, "GROUNDING_FAILED");
  assert.equal(body.source, "deterministic");
  assert.equal(body.fallback_reason, "grounding_violations");
  assert.equal(body.grounding.ok, false);
  assert.ok(body.grounding.violations.some((entry) => entry.startsWith("unknown_id:S999")));
  assert.notEqual(body.answer, "Shipment S999 is critical and has been reassigned.");
  assert.ok(body.answer.length > 0);
});

test("a provider failure falls back to the deterministic engine with a controlled status", async () => {
  stub.calls = 0;
  stub.responder = () => {
    throw new ProviderError("provider_timeout", "AI provider timed out");
  };

  const { status, body } = await withBob(() => query("Which disruptions are active?"));

  assert.equal(status, 200);
  assert.equal(body.status, "PROVIDER_UNAVAILABLE");
  assert.equal(body.source, "deterministic");
  assert.equal(body.fallback_reason, "provider_timeout");
  assert.ok(body.answer.length > 0);
});

test("LLM tool names and inputs are validated server-side", async () => {
  stub.calls = 0;
  stub.responder = (call) => {
    if (call === 1) return { text: JSON.stringify({ tool: "delete_everything", input: {} }) };
    if (call === 2) return { text: JSON.stringify({ tool: "get_combined_risk", input: { shipment_id: "S39" } }) };
    return { text: JSON.stringify({ final: "No valid tool call was possible." }) };
  };

  const { status, body } = await withBob(() => query("Do something dangerous"));

  assert.equal(status, 200);
  assert.equal(body.status, "VALIDATED_AI");
  assert.equal(body.tool_calls, 0);
  assert.deepEqual(body.evidence, []);
  assert.equal(body.answer, "No valid tool call was possible.");
});

test("a failed agent protocol recovers with a single-shot grounded synthesis", async () => {
  stub.calls = 0;
  stub.responder = (call, args) => {
    if (args?.prompt?.includes('"question"')) {
      return { text: "The active disruption list includes D01." };
    }
    if (call === 1) return { text: JSON.stringify({ tool: "get_active_disruptions", input: {} }) };
    return { text: "not a valid step" };
  };

  const { status, body } = await withBob(() => query("Which disruptions are active?"));

  assert.equal(status, 200);
  assert.equal(body.status, "VALIDATED_AI");
  assert.equal(body.source, "llm");
  assert.equal(body.answer, "The active disruption list includes D01.");
  assert.equal(body.evidence.length, 1);
  assert.equal(body.evidence[0].tool, "get_active_disruptions");
  assert.equal(body.fallback_reason, "agent_step_limit");
});
