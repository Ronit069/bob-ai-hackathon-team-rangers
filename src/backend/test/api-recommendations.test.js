// API contract tests — endpoints 24/25 (recommendation creation), error matrix,
// database-failure handling and placeholder behaviour.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, seedTestDatabase } from "../src/test-support/helpers.js";
import { startTestServer, api } from "../src/test-support/api.js";

let pool;
let server;
let baseUrl;

before(async () => {
  pool = await setupTestDb();
  await seedTestDatabase(pool);
  server = await startTestServer(pool);
  baseUrl = server.baseUrl;
});

after(async () => {
  await server.close();
  await pool.end();
});

test("POST /api/recommendations creates a pending reroute with audit (server recompute)", async () => {
  const { status, body } = await api(baseUrl, "/api/recommendations", {
    method: "POST",
    body: { type: "reroute", shipment_id: "S040", route_id: "R006", actor: "operator-1" },
  });
  assert.equal(status, 201);
  assert.equal(body.id, "REC-0001");
  assert.equal(body.type, "reroute");
  assert.equal(body.route_id, "R006");
  assert.equal(body.status, "pending");
  assert.ok(body.audit_record_id.startsWith("AUD-"));

  // Score/factors are recomputed server-side (match the alternatives service output).
  const alternatives = await api(baseUrl, "/api/shipments/S040/route-alternatives");
  assert.equal(Number(body.score), alternatives.body.data[0].score);

  const audit = await pool.query("SELECT * FROM audit_record WHERE entity_id = $1", [body.id]);
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0].action, "created");
  assert.equal(audit.rows[0].actor, "operator-1");
});

test("POST /api/recommendations rejects duplicate pending recommendations (409)", async () => {
  const { status, body } = await api(baseUrl, "/api/recommendations", {
    method: "POST",
    body: { type: "reroute", shipment_id: "S040", route_id: "R006" },
  });
  assert.equal(status, 409);
  assert.equal(body.error.code, "CONFLICT");
});

test("POST /api/recommendations rejects ineligible targets (409) and unknown ids (404)", async () => {
  const ineligible = await api(baseUrl, "/api/recommendations", {
    method: "POST",
    body: { type: "reroute", shipment_id: "S004", route_id: "R002" },
  });
  assert.equal(ineligible.status, 409);
  assert.equal(ineligible.body.error.details.reason, "target_not_eligible");

  const unknownShipment = await api(baseUrl, "/api/recommendations", {
    method: "POST",
    body: { type: "reroute", shipment_id: "S999", route_id: "R006" },
  });
  assert.equal(unknownShipment.status, 404);

  const unknownTarget = await api(baseUrl, "/api/recommendations", {
    method: "POST",
    body: { type: "reroute", shipment_id: "S040", route_id: "R999" },
  });
  assert.equal(unknownTarget.status, 404);

  const mismatchedTarget = await api(baseUrl, "/api/recommendations", {
    method: "POST",
    body: { type: "carrier_change", shipment_id: "S040", route_id: "R006" },
  });
  assert.equal(mismatchedTarget.status, 400);
});

test("POST /api/fleet/redeployments/recommend creates a pending fleet recommendation", async () => {
  const { status, body } = await api(baseUrl, "/api/fleet/redeployments/recommend", {
    method: "POST",
    body: { shipment_id: "S013", asset_id: "A001" },
  });
  assert.equal(status, 201);
  assert.equal(body.type, "fleet_redeployment");
  assert.equal(body.asset_id, "A001");
  assert.equal(body.status, "pending");
  assert.ok(body.audit_record_id.startsWith("AUD-"));

  const duplicate = await api(baseUrl, "/api/fleet/redeployments/recommend", {
    method: "POST",
    body: { shipment_id: "S013", asset_id: "A001" },
  });
  assert.equal(duplicate.status, 409);

  const ineligible = await api(baseUrl, "/api/fleet/redeployments/recommend", {
    method: "POST",
    body: { shipment_id: "S016", asset_id: "A004" },
  });
  assert.equal(ineligible.status, 409);
  assert.equal(ineligible.body.error.details.reason, "asset_not_eligible");

  const unknownAsset = await api(baseUrl, "/api/fleet/redeployments/recommend", {
    method: "POST",
    body: { shipment_id: "S013", asset_id: "A999" },
  });
  assert.equal(unknownAsset.status, 404);
});

test("recommendation creation rejects non-actionable shipments (409)", async () => {
  const { status, body } = await api(baseUrl, "/api/recommendations", {
    method: "POST",
    body: { type: "reroute", shipment_id: "S007", route_id: "R006" },
  });
  assert.equal(status, 409);
  assert.equal(body.error.details.reason, "shipment_not_actionable");
});

test("malformed JSON bodies return 400 with the standard envelope", async () => {
  const { status, body } = await api(baseUrl, "/api/disruptions", {
    method: "POST",
    rawBody: "{ not json",
  });
  assert.equal(status, 400);
  assert.equal(body.error.code, "VALIDATION_ERROR");
});

test("database failures return the standard 500 envelope", async () => {
  const broken = {
    query: async () => {
      throw new Error("connection refused");
    },
  };
  const brokenServer = await startTestServer(broken);
  try {
    const { status, body } = await api(brokenServer.baseUrl, "/api/disruptions");
    assert.equal(status, 500);
    assert.equal(body.error.code, "INTERNAL_ERROR");

    const health = await api(brokenServer.baseUrl, "/api/health");
    assert.equal(health.status, 500);
    assert.equal(health.body.database, "down");
  } finally {
    await brokenServer.close();
  }
});

test("empty query results return 200 with an empty list, not an error", async () => {
  const { status, body } = await api(baseUrl, "/api/carriers?region_code=IN-NORTH-ICD");
  assert.equal(status, 200);
  assert.deepEqual(body.data, []);
  assert.equal(body.count, 0);
});
