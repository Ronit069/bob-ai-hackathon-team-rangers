// End-to-end flow test — the demo-critical path across logistics, cold-chain,
// shared risk, human decision, audit, and the Bob/MCP tool layer.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, seedTestDatabase, loadSeedJson } from "../src/test-support/helpers.js";
import { startTestServer, api } from "../src/test-support/api.js";
import { callTool } from "../../mcp-server/src/tools.js";

let pool;
let server;
let baseUrl;
let groundTruth;

const iso = (date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");
const minutesAgo = (minutes) => iso(new Date(Date.now() - minutes * 60_000));

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

test("E2E: disruption -> affected -> risk -> redeployment -> recommendation -> decision -> audit", async () => {
  // 1. Active disruption
  const disruptions = await api(baseUrl, "/api/disruptions?status=active");
  assert.ok(disruptions.body.data.some((row) => row.id === "D01"));

  // 2. Affected shipments
  const affected = await api(baseUrl, "/api/disruptions/D01/affected-shipments");
  const s039 = affected.body.data.find((row) => row.shipment.id === "S039");
  assert.ok(s039);
  assert.equal(s039.impact_status, "critical");

  // 3. Combined risk (ground-truth oracle)
  const risk = await api(baseUrl, "/api/shipments/S039/risk");
  assert.equal(risk.body.combined_score, groundTruth.risk.S039.combined_score);
  assert.equal(risk.body.factors.coldchain.severity, "major");

  // 4. Redeployment candidates (asset re-validated server-side at creation)
  const candidates = await api(baseUrl, "/api/shipments/S039/redeployment-candidates");
  const best = candidates.body.data[0];
  assert.ok(best, "expected at least one compatible asset near Jebel Ali");
  assert.equal(best.asset.id, "A021");

  // 5. Create the pending recommendation
  const created = await api(baseUrl, "/api/fleet/redeployments/recommend", {
    method: "POST",
    body: { shipment_id: "S039", asset_id: best.asset.id },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.status, "pending");
  const recommendationId = created.body.id;

  // 6. Human decision
  const decided = await api(baseUrl, `/api/recommendations/${recommendationId}/decision`, {
    method: "POST",
    body: { decision: "accepted", notes: "Approved during demo rehearsal" },
  });
  assert.equal(decided.status, 200);
  assert.equal(decided.body.status, "accepted");
  assert.ok(decided.body.audit_record_id.startsWith("AUD-"));

  // 7. Audit trail is complete and ordered
  const audit = await api(baseUrl, `/api/audit?entity_id=${recommendationId}&order=asc`);
  assert.deepEqual(
    audit.body.data.map((row) => row.action),
    ["created", "decided_accepted"],
  );
});

test("E2E: ingestion -> excursion -> alerts -> risk reflects the new excursion", async () => {
  const before = await api(baseUrl, "/api/excursions?shipment_id=S039");

  const ingested = await api(baseUrl, "/api/sensor-readings", {
    method: "POST",
    body: {
      readings: [
        { shipment_id: "S039", sensor_id: "SEN-039", timestamp: minutesAgo(30), temperature_c: 10.4, source: "simulated" },
        { shipment_id: "S039", sensor_id: "SEN-039", timestamp: minutesAgo(15), temperature_c: 10.4, source: "simulated" },
      ],
    },
  });
  assert.equal(ingested.status, 201);
  assert.equal(ingested.body.ingested, 2);

  const after = await api(baseUrl, "/api/excursions?shipment_id=S039");
  assert.equal(after.body.count, before.body.count + 1);
  assert.ok(after.body.data[0].recommended_action.length > 0);

  const alerts = await api(baseUrl, "/api/alerts/coldchain");
  assert.ok(alerts.body.data.some((row) => row.type === "excursion" && row.shipment_id === "S039"));
});

test("E2E: Bob/MCP layer returns the same structured facts as the REST API", async () => {
  const restRisk = await api(baseUrl, "/api/shipments/S039/risk");
  const toolRisk = await callTool(baseUrl, "get_combined_risk", { shipment_id: "S039" });
  assert.equal(toolRisk.combined_score, restRisk.body.combined_score);
  assert.deepEqual(toolRisk.factors, restRisk.body.factors);

  const restAffected = await api(baseUrl, "/api/disruptions/D01/affected-shipments");
  const toolAffected = await callTool(baseUrl, "get_affected_shipments", { disruption_id: "D01" });
  assert.deepEqual(
    toolAffected.data.map((row) => `${row.shipment.id}:${row.impact_status}`),
    restAffected.body.data.map((row) => `${row.shipment.id}:${row.impact_status}`),
  );

  const restExcursions = await api(baseUrl, "/api/excursions?shipment_id=S039");
  const toolExcursions = await callTool(baseUrl, "get_temperature_excursions", { shipment_id: "S039" });
  assert.deepEqual(
    toolExcursions.data.map((row) => `${row.id}:${row.severity}:${row.data_quality}`),
    restExcursions.body.data.map((row) => `${row.id}:${row.severity}:${row.data_quality}`),
  );
});

test("E2E: Bob proxy degrades safely while disabled", async () => {
  const { status, body } = await api(baseUrl, "/api/bob/query", {
    method: "POST",
    body: { prompt: "Give me a six-hour action plan" },
  });
  assert.equal(status, 503);
  assert.equal(body.error.code, "BOB_UNAVAILABLE");
  // The dashboard path remains fully functional without Bob.
  const overview = await api(baseUrl, "/api/risk/overview?limit=5");
  assert.equal(overview.status, 200);
});
