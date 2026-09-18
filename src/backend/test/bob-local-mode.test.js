// Bob compatibility-layer tests: the decision-D2 contract (503 when disabled / gateway
// when configured) and the preserved credential-free local engine mode.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/common/config.js";
import { setupTestDb, seedTestDatabase } from "../src/test-support/helpers.js";
import { startTestServer, api } from "../src/test-support/api.js";

let pool;
let server;
let baseUrl;

const ORIGINAL = {
  enabled: config.bobEnabled,
  apiUrl: config.bobApiUrl,
  apiKey: config.bobApiKey,
  port: config.port,
};

before(async () => {
  pool = await setupTestDb();
  await seedTestDatabase(pool);
  server = await startTestServer(pool);
  baseUrl = server.baseUrl;
});

after(async () => {
  config.bobEnabled = ORIGINAL.enabled;
  config.bobApiUrl = ORIGINAL.apiUrl;
  config.bobApiKey = ORIGINAL.apiKey;
  config.port = ORIGINAL.port;
  await server.close();
  await pool.end();
});

const query = (prompt) => api(baseUrl, "/api/bob/query", { method: "POST", body: { prompt } });

test("BOB_ENABLED=false returns the frozen 503 BOB_UNAVAILABLE envelope", async () => {
  config.bobEnabled = false;
  config.bobApiUrl = "";
  const { status, body } = await query("Which disruptions are active?");
  assert.equal(status, 503);
  assert.equal(body.error.code, "BOB_UNAVAILABLE");
  assert.equal(body.error.details.reason, "bob_disabled");
});

test("BOB_ENABLED=true without BOB_API_URL preserves the local grounded engine", async () => {
  config.bobEnabled = true;
  config.bobApiUrl = "";
  config.port = Number(new URL(baseUrl).port);

  const { status, body } = await query("Which disruptions are active?");
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body).sort(), ["answer", "evidence", "tool_calls"]);
  assert.equal(typeof body.answer, "string");
  assert.ok(body.answer.length > 0);
  assert.ok(body.tool_calls >= 1);
  assert.equal(body.evidence[0].tool, "get_active_disruptions");
  assert.equal(typeof body.evidence[0].input, "object");
  assert.equal(typeof body.evidence[0].output, "object");
});

test("local engine mode never exposes provider credentials", async () => {
  config.bobEnabled = true;
  config.bobApiUrl = "";
  config.bobApiKey = "unit-fake-bob-key";
  config.port = Number(new URL(baseUrl).port);
  try {
    const { status, body } = await query("Which disruptions are active?");
    assert.equal(status, 200);
    assert.ok(!JSON.stringify(body).includes("unit-fake-bob-key"));
  } finally {
    config.bobApiKey = ORIGINAL.apiKey;
  }
});
