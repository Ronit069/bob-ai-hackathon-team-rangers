// API contract tests — endpoints 2–11, 26, 27 (logistics + fleet).
// Success, validation errors, empty results, invalid ids, unknown-path 404, and
// ground-truth comparisons for alternatives and redeployment.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, seedTestDatabase, loadSeedJson } from "../src/test-support/helpers.js";
import { startTestServer, api } from "../src/test-support/api.js";

let pool;
let server;
let baseUrl;
let groundTruth;

before(async () => {
  pool = await setupTestDb();
  await seedTestDatabase(pool);
  ({ groundTruth } = loadSeedJson());
  server = await startTestServer(pool);
  baseUrl = server.baseUrl;
});

after(async () => {
  await server.close();
  await pool.end();
});

// ---------------------------------------------------------------------------
// Disruptions (2/3/4)
// ---------------------------------------------------------------------------
test("GET /api/disruptions returns all disruptions with a computed active flag", async () => {
  const { status, body } = await api(baseUrl, "/api/disruptions");
  assert.equal(status, 200);
  assert.equal(body.count, 5);
  const byId = Object.fromEntries(body.data.map((row) => [row.id, row]));
  assert.equal(byId.D01.is_currently_active, true);
  assert.equal(byId.D03.is_currently_active, false);
  assert.equal(byId.D05.is_currently_active, false);
});

test("GET /api/disruptions filters by status and rejects invalid values", async () => {
  const { status, body } = await api(baseUrl, "/api/disruptions?status=active");
  assert.equal(status, 200);
  assert.deepEqual(body.data.map((row) => row.id).sort(), ["D01", "D02", "D04"]);

  const invalid = await api(baseUrl, "/api/disruptions?status=nonsense");
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, "VALIDATION_ERROR");
});

test("POST /api/disruptions creates an active disruption with generated id and audit", async () => {
  const payload = {
    type: "weather",
    region_code: "IN-NORTH-ICD",
    start_time: "2026-09-14T08:00:00Z",
    end_time: "2026-09-20T08:00:00Z",
    severity: 2,
    status: "active",
    description: "API test disruption in a region without routes",
    created_by: "operator-1",
  };
  const { status, body } = await api(baseUrl, "/api/disruptions", { method: "POST", body: payload });
  assert.equal(status, 201);
  assert.equal(body.id, "D06");
  assert.equal(body.status, "active");

  const audit = await pool.query("SELECT * FROM audit_record WHERE entity_type = 'disruption' AND entity_id = 'D06'");
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0].action, "activated");
});

test("POST /api/disruptions rejects duplicate active disruptions (409)", async () => {
  const payload = {
    type: "weather",
    region_code: "IN-NORTH-ICD",
    start_time: "2026-09-15T00:00:00Z",
    end_time: "2026-09-18T00:00:00Z",
    severity: 1,
    status: "active",
    description: "Overlapping duplicate",
    created_by: "operator-1",
  };
  const { status, body } = await api(baseUrl, "/api/disruptions", { method: "POST", body: payload });
  assert.equal(status, 409);
  assert.equal(body.error.code, "CONFLICT");
});

test("POST /api/disruptions validates the payload (400)", async () => {
  const { status, body } = await api(baseUrl, "/api/disruptions", {
    method: "POST",
    body: { type: "weather", region_code: "ATLANTIS" },
  });
  assert.equal(status, 400);
  assert.ok(Array.isArray(body.error.details.issues));
});

test("PATCH /api/disruptions/:id resolves and blocks invalid transitions", async () => {
  const resolved = await api(baseUrl, "/api/disruptions/D06", { method: "PATCH", body: { status: "resolved" } });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.status, "resolved");

  const again = await api(baseUrl, "/api/disruptions/D06", { method: "PATCH", body: { status: "resolved" } });
  assert.equal(again.status, 409);

  const missing = await api(baseUrl, "/api/disruptions/D99", { method: "PATCH", body: { status: "resolved" } });
  assert.equal(missing.status, 404);

  const emptyPatch = await api(baseUrl, "/api/disruptions/D01", { method: "PATCH", body: {} });
  assert.equal(emptyPatch.status, 400);
});

// ---------------------------------------------------------------------------
// Affected shipments (5)
// ---------------------------------------------------------------------------
test("GET /api/disruptions/:id/affected-shipments matches R1 statuses", async () => {
  const { status, body } = await api(baseUrl, "/api/disruptions/D01/affected-shipments");
  assert.equal(status, 200);
  assert.equal(body.disruption_id, "D01");
  const byId = Object.fromEntries(body.data.map((row) => [row.shipment.id, row]));

  assert.equal(byId.S001.impact_status, "critical");
  assert.equal(byId.S003.impact_status, "critical");
  assert.equal(byId.S009.impact_status, "delayed"); // inclusive boundary
  assert.equal(byId.S010.impact_status, "unknown_review"); // defect route
  assert.equal(byId.S002, undefined); // matched only by D04
  assert.equal(byId.S011, undefined); // US-WEST only
  assert.ok(byId.S001.match_reason.includes("D01"));
  assert.ok(byId.S001.impact_score >= 0 && byId.S001.impact_score <= 1);
});

test("GET /api/disruptions/:id/affected-shipments handles unknown ids and route-defect rows", async () => {
  assert.equal((await api(baseUrl, "/api/disruptions/D99/affected-shipments")).status, 404);

  const created = await api(baseUrl, "/api/disruptions", {
    method: "POST",
    body: {
      type: "weather",
      region_code: "IN-NORTH-ICD",
      start_time: "2026-09-14T08:00:00Z",
      end_time: "2026-09-20T08:00:00Z",
      severity: 1,
      status: "active",
      description: "Disruption in a region without routes",
      created_by: "operator-1",
    },
  });
  assert.equal(created.status, 201);

  const result = await api(baseUrl, `/api/disruptions/${created.body.id}/affected-shipments`);
  assert.equal(result.status, 200);
  // A region with no segments cannot match any route; the only surfaced row is S010,
  // whose route data is missing (unknown_review by design — never silently dropped).
  assert.ok(result.body.data.every((row) => row.shipment.id === "S010"));
  assert.ok(result.body.data.every((row) => row.impact_status === "unknown_review"));
  assert.equal(result.body.data.filter((row) => row.impact_status !== "unknown_review").length, 0);
});

// ---------------------------------------------------------------------------
// Shipments (6/7)
// ---------------------------------------------------------------------------
test("GET /api/shipments filters by cold chain, region and disruption", async () => {
  const cold = await api(baseUrl, "/api/shipments?is_cold_chain=true");
  const expectedCold = await pool.query("SELECT count(*)::int AS n FROM shipment WHERE is_cold_chain = true");
  assert.equal(cold.body.count, expectedCold.rows[0].n);
  assert.ok(cold.body.data.every((row) => row.is_cold_chain === true));

  const region = await api(baseUrl, "/api/shipments?region_code=SG-SINGAPORE");
  const expectedRegion = await pool.query(
    `SELECT s.id FROM shipment s JOIN route_segment rs ON rs.id = s.current_segment_id
     WHERE rs.region_code = 'SG-SINGAPORE' ORDER BY s.id`,
  );
  assert.deepEqual(region.body.data.map((row) => row.id).sort(), expectedRegion.rows.map((row) => row.id));

  const affected = await api(baseUrl, "/api/shipments?disruption_id=D01");
  const affectedVia5 = await api(baseUrl, "/api/disruptions/D01/affected-shipments");
  assert.deepEqual(
    affected.body.data.map((row) => row.id).sort(),
    affectedVia5.body.data.map((row) => row.shipment.id).sort(),
  );
  assert.ok(affected.body.data.some((row) => row.id === "S001"));
});

test("GET /api/shipments validates filters and unknown disruptions", async () => {
  assert.equal((await api(baseUrl, "/api/shipments?disruption_id=D99")).status, 404);
  assert.equal((await api(baseUrl, "/api/shipments?limit=0")).status, 400);
  assert.equal((await api(baseUrl, "/api/shipments?is_cold_chain=maybe")).status, 400);
});

test("GET /api/shipments/:id returns detail with route, carrier, segments and capacity", async () => {
  const { status, body } = await api(baseUrl, "/api/shipments/S001");
  assert.equal(status, 200);
  assert.equal(body.id, "S001");
  assert.equal(body.route.id, "R001");
  assert.equal(body.carrier.id, "C01");
  assert.equal(body.segments.length, 2);
  assert.equal(body.current_segment.id, "SEG-001");
  assert.equal(body.next_segment.id, "SEG-002");
  assert.equal(body.route_capacity, 220);

  assert.equal((await api(baseUrl, "/api/shipments/S999")).status, 404);
});

// ---------------------------------------------------------------------------
// Alternatives (8/9)
// ---------------------------------------------------------------------------
test("route alternatives: no-option result matches ground truth (S004)", async () => {
  const { status, body } = await api(baseUrl, "/api/shipments/S004/route-alternatives");
  assert.equal(status, 200);
  assert.equal(body.count, 0);
  assert.deepEqual(body.data, []);
  const rejected = Object.fromEntries(body.rejected.map((row) => [row.route_id, row.rejected_reason]));
  const expected = Object.fromEntries(
    groundTruth.alternatives.S004.rejected.map((row) => [row.route_id, row.rejected_reason]),
  );
  assert.equal(rejected.R002, expected.R002);
  assert.equal(rejected.R002, "disrupted_region_overlap");
});

test("route alternatives: ranked option matches ground truth (S040)", async () => {
  const { body } = await api(baseUrl, "/api/shipments/S040/route-alternatives");
  const expectedIds = groundTruth.alternatives.S040.data.map((row) => row.route_id);
  assert.deepEqual(body.data.map((row) => row.route.id), expectedIds);
  assert.equal(body.data[0].route.id, "R006");
  assert.ok(Array.isArray(body.data[0].reasons) && body.data[0].reasons.length >= 3);
  assert.ok(body.data[0].factors.estimated_eta);
});

test("route alternatives: delivered shipment is not actionable", async () => {
  const { status, body } = await api(baseUrl, "/api/shipments/S007/route-alternatives");
  assert.equal(status, 200);
  assert.equal(body.not_actionable, true);
  assert.equal(body.not_actionable_reason, "delivered");
  assert.deepEqual(body.data, []);
});

test("carrier alternatives reject the inactive carrier (S006, ground truth)", async () => {
  const { status, body } = await api(baseUrl, "/api/shipments/S006/carrier-alternatives");
  assert.equal(status, 200);
  const rejected = Object.fromEntries(body.rejected.map((row) => [row.carrier_id, row.rejected_reason]));
  const expected = Object.fromEntries(
    groundTruth.alternatives.S006.carrier_alternatives.rejected.map((row) => [row.carrier_id, row.rejected_reason]),
  );
  assert.equal(rejected.C09, expected.C09);
  assert.equal(rejected.C09, "carrier_inactive");
});

test("alternatives reject unknown shipments (404)", async () => {
  assert.equal((await api(baseUrl, "/api/shipments/S999/route-alternatives")).status, 404);
  assert.equal((await api(baseUrl, "/api/shipments/S999/carrier-alternatives")).status, 404);
});

// ---------------------------------------------------------------------------
// Fleet idle + redeployment (10/11) and fleet view (26), carriers (27)
// ---------------------------------------------------------------------------
test("GET /api/fleet/idle returns idle assets and exclusion reasons", async () => {
  const { status, body } = await api(baseUrl, "/api/fleet/idle");
  assert.equal(status, 200);
  const ids = body.data.map((item) => item.asset.id);
  assert.ok(ids.includes("A001"));
  assert.ok(!ids.includes("A002"));

  const excluded = Object.fromEntries(body.excluded.map((item) => [item.asset_id, item.reason]));
  assert.equal(excluded.A002, "reserved");
  assert.equal(excluded.A007, "missing_availability_timestamp");
  assert.equal(excluded.A008, "maintenance");
  assert.equal(excluded.A009, "retired");
});

test("GET /api/fleet/idle supports region and idle filters", async () => {
  const region = await api(baseUrl, "/api/fleet/idle?region_code=SG-SINGAPORE");
  assert.ok(region.body.data.length > 0);
  assert.ok(region.body.data.every((item) => item.asset.current_region_code === "SG-SINGAPORE"));

  const longIdle = await api(baseUrl, "/api/fleet/idle?min_idle_minutes=1000");
  assert.ok(longIdle.body.data.every((item) => item.idle_minutes >= 1000));

  assert.equal((await api(baseUrl, "/api/fleet/idle?region_code=ATLANTIS")).status, 400);
});

test("redeployment candidates match ground truth and surface contention", async () => {
  const s015 = await api(baseUrl, "/api/shipments/S015/redeployment-candidates");
  assert.equal(s015.status, 200);
  const rejected = Object.fromEntries(s015.body.rejected.map((row) => [row.asset_id, row.rejected_reason]));
  assert.equal(rejected.A003, "incompatible_non_refrigerated");
  const expectedIds = groundTruth.redeployment.S015.data.map((row) => row.asset_id);
  assert.deepEqual(s015.body.data.map((row) => row.asset.id), expectedIds);
  assert.ok(Array.isArray(s015.body.data[0].reasons) && s015.body.data[0].reasons.length >= 3);

  const s017 = await api(baseUrl, "/api/shipments/S017/redeployment-candidates");
  assert.equal(s017.body.count, 0);
  assert.deepEqual(s017.body.data, []);

  // Contention is computed across affected shipments: S009 and S047 both rank A005
  // in their top 3, so S009's response must surface contention_count >= 2 (SCN-021).
  const s009 = await api(baseUrl, "/api/shipments/S009/redeployment-candidates");
  assert.ok(s009.body.data.some((candidate) => candidate.factors.contention_count >= 2));
});

test("GET /api/fleet returns derived states and anomaly flags", async () => {
  const { status, body } = await api(baseUrl, "/api/fleet");
  assert.equal(status, 200);
  const byId = Object.fromEntries(body.data.map((row) => [row.asset.id, row]));
  assert.equal(byId.A008.operational_state, "maintenance");
  assert.equal(byId.A002.operational_state, "reserved");
  assert.ok(byId.A007.anomalies.includes("missing_availability_timestamp"));
  assert.ok(byId.A006.anomalies.includes("conflicting_assignments"));
  assert.ok(byId.A001.idle_minutes >= 0);
  assert.ok(byId.A001.operational_state === "available");

  const maintenance = await api(baseUrl, "/api/fleet?state=maintenance");
  assert.deepEqual(maintenance.body.data.map((row) => row.asset.id), ["A008"]);

  assert.equal((await api(baseUrl, "/api/fleet?state=nonsense")).status, 400);
});

test("GET /api/carriers lists carriers with filters", async () => {
  const all = await api(baseUrl, "/api/carriers");
  assert.equal(all.status, 200);
  assert.equal(all.body.count, 9);

  const inactive = await api(baseUrl, "/api/carriers?status=inactive");
  assert.deepEqual(inactive.body.data.map((row) => row.id), ["C09"]);

  assert.equal((await api(baseUrl, "/api/carriers?mode=teleport")).status, 400);
});

// ---------------------------------------------------------------------------
// Catch-all behaviour for unknown paths
// ---------------------------------------------------------------------------
test("unknown API paths return the structured NOT_FOUND envelope", async () => {
  const { status, body } = await api(baseUrl, "/api/does-not-exist");
  assert.equal(status, 404);
  assert.equal(body.error.code, "NOT_FOUND");
  assert.equal(body.error.message, "Unknown API endpoint");
});
