// Bob proxy tests — enabled forwarding path against a local stub Bob (decision D2).
// No credentials are required; the stub verifies forwarding, mapping and the 503 fallbacks.
// Test-only: config values are mutated in-process and restored afterwards.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { config } from "../src/common/config.js";
import { setupTestDb, seedTestDatabase } from "../src/test-support/helpers.js";
import { startTestServer, api } from "../src/test-support/api.js";

const TEST_KEY = "stub-secret-key";
const ORIGINAL = { enabled: config.bobEnabled, url: config.bobApiUrl, key: config.bobApiKey };
const DEFAULT_STUB_RESPONSE = {
  status: 200,
  body: {
    answer: "stub answer",
    evidence: [{ tool: "get_active_disruptions", output: { count: 3 } }],
    tool_calls: 1,
  },
};

let pool;
let server;
let baseUrl;
let stub;
let stubRequests = [];
let stubResponse = DEFAULT_STUB_RESPONSE;

before(async () => {
  stub = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      stubRequests.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization ?? null,
        body: JSON.parse(raw || "{}"),
      });
      res.writeHead(stubResponse.status, { "content-type": "application/json" });
      res.end(JSON.stringify(stubResponse.body));
    });
  });
  await new Promise((resolve) => stub.listen(0, "127.0.0.1", resolve));

  pool = await setupTestDb();
  await seedTestDatabase(pool);
  server = await startTestServer(pool);
  baseUrl = server.baseUrl;

  config.bobEnabled = true;
  config.bobApiUrl = `http://127.0.0.1:${stub.address().port}`;
  config.bobApiKey = TEST_KEY;
});

after(async () => {
  config.bobEnabled = ORIGINAL.enabled;
  config.bobApiUrl = ORIGINAL.url;
  config.bobApiKey = ORIGINAL.key;
  await server.close();
  await pool.end();
  await new Promise((resolve) => stub.close(resolve));
});

const query = (prompt) => api(baseUrl, "/api/bob/query", { method: "POST", body: { prompt } });

test("enabled proxy forwards the prompt, grounding rules and bearer auth", async () => {
  stubRequests = [];
  const { status } = await query("Which shipments are affected by the port strike?");
  assert.equal(status, 200);
  assert.equal(stubRequests.length, 1);

  const forwarded = stubRequests[0];
  assert.equal(forwarded.method, "POST");
  assert.equal(forwarded.url, "/query");
  assert.equal(forwarded.authorization, `Bearer ${TEST_KEY}`);
  assert.equal(forwarded.body.prompt, "Which shipments are affected by the port strike?");
  assert.match(forwarded.body.system, /Answer only from the structured JSON/);
  assert.match(forwarded.body.system, /Never change state/);
  // The key travels only in the Authorization header, never in the payload.
  assert.ok(!JSON.stringify(forwarded.body).includes(TEST_KEY));
});

test("proxy maps the Bob response to answer + evidence + tool_calls", async () => {
  const { status, body } = await query("Which disruptions are active?");
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body).sort(), ["answer", "evidence", "tool_calls"]);
  assert.equal(body.answer, "stub answer");
  assert.equal(body.tool_calls, 1);
  assert.equal(body.evidence[0].tool, "get_active_disruptions");
  assert.ok(!JSON.stringify(body).includes(TEST_KEY));
});

test("proxy returns 503 when Bob responds with an error status", async () => {
  stubResponse = { status: 500, body: { error: "boom" } };
  try {
    const { status, body } = await query("hello");
    assert.equal(status, 503);
    assert.equal(body.error.code, "BOB_UNAVAILABLE");
    assert.equal(body.error.details.reason, "bob_unreachable");
  } finally {
    stubResponse = DEFAULT_STUB_RESPONSE;
  }
});

test("proxy returns 503 when Bob is unreachable", async () => {
  const previous = config.bobApiUrl;
  config.bobApiUrl = "http://127.0.0.1:1";
  try {
    const { status, body } = await query("hello");
    assert.equal(status, 503);
    assert.equal(body.error.code, "BOB_UNAVAILABLE");
    assert.equal(body.error.details.reason, "bob_unreachable");
  } finally {
    config.bobApiUrl = previous;
  }
});

test("disabled mode keeps the documented 503 fallback (BOB_ENABLED=false)", async () => {
  const previous = config.bobEnabled;
  config.bobEnabled = false;
  try {
    const { status, body } = await query("hello");
    assert.equal(status, 503);
    assert.equal(body.error.code, "BOB_UNAVAILABLE");
    assert.equal(body.error.details.reason, "bob_disabled");
  } finally {
    config.bobEnabled = previous;
  }
});

test("proxy validates the prompt", async () => {
  assert.equal((await query("")).status, 400);
});
