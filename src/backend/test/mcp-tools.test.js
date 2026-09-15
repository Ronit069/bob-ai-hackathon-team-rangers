// MCP tool layer tests — exactly the 11 frozen tools, validation, read-only
// behaviour, structured error passthrough and ground-truth oracle checks.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, seedTestDatabase, loadSeedJson } from "../src/test-support/helpers.js";
import { startTestServer } from "../src/test-support/api.js";
import { TOOL_DEFINITIONS, callTool, validateToolInput, findTool } from "../../mcp-server/src/tools.js";

const FROZEN_TOOLS = [
  "get_active_disruptions",
  "get_affected_shipments",
  "get_route_alternatives",
  "get_carrier_alternatives",
  "get_idle_assets",
  "get_redeployment_candidates",
  "get_sensor_status",
  "get_temperature_excursions",
  "get_combined_risk",
  "get_risk_overview",
  "get_audit_log",
];

const VALID_INPUTS = {
  get_active_disruptions: {},
  get_affected_shipments: { disruption_id: "D01" },
  get_route_alternatives: { shipment_id: "S040" },
  get_carrier_alternatives: { shipment_id: "S006" },
  get_idle_assets: {},
  get_redeployment_candidates: { shipment_id: "S015" },
  get_sensor_status: { shipment_id: "S026" },
  get_temperature_excursions: {},
  get_combined_risk: { shipment_id: "S039" },
  get_risk_overview: { limit: 5 },
  get_audit_log: {},
};

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

test("exactly the 11 frozen tools are defined", () => {
  assert.deepEqual(TOOL_DEFINITIONS.map((tool) => tool.name), FROZEN_TOOLS);
  for (const tool of TOOL_DEFINITIONS) {
    assert.ok(typeof tool.description === "string" && tool.description.length > 0);
    assert.ok(typeof tool.build === "function");
  }
});

test("every tool returns structured output from the backend", async () => {
  for (const name of FROZEN_TOOLS) {
    const result = await callTool(baseUrl, name, VALID_INPUTS[name]);
    assert.equal(result.ok, true, `${name} should succeed`);
    assert.equal(result.tool, name);
    // Beyond { tool, ok }, every tool returns payload fields (data/count or a detail object).
    assert.ok(Object.keys(result).length > 2, `${name} should return payload fields`);
  }
});

test("tool input validation rejects malformed input (strict schemas)", () => {
  const affected = findTool("get_affected_shipments");
  const bad = validateToolInput(affected, { disruption_id: "XX" });
  assert.equal(bad.ok, false);
  assert.ok(bad.issues.some((issue) => issue.path === "disruption_id"));

  const unknownField = validateToolInput(affected, { disruption_id: "D01", bogus: true });
  assert.equal(unknownField.ok, false);
});

test("callTool returns structured errors instead of throwing", async () => {
  const invalid = await callTool(baseUrl, "get_affected_shipments", { disruption_id: "nope" });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "VALIDATION_ERROR");
  assert.ok(Array.isArray(invalid.error.details.issues));

  const unknown = await callTool(baseUrl, "get_everything", {});
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, "UNKNOWN_TOOL");

  const missing = await callTool(baseUrl, "get_combined_risk", { shipment_id: "S999" });
  assert.equal(missing.ok, false);
  assert.equal(missing.http_status, 404);
  assert.equal(missing.error.code, "NOT_FOUND");

  const unreachable = await callTool("http://127.0.0.1:1", "get_active_disruptions", {});
  assert.equal(unreachable.ok, false);
  assert.equal(unreachable.error.code, "BACKEND_UNREACHABLE");
});

test("tool output matches the ground-truth oracle (combined risk)", async () => {
  const result = await callTool(baseUrl, "get_combined_risk", { shipment_id: "S039" });
  assert.equal(result.ok, true);
  assert.equal(result.combined_score, groundTruth.risk.S039.combined_score);
  assert.equal(result.coldchain_risk, groundTruth.risk.S039.coldchain_risk);
});

test("tools are read-only: no recommendation, audit, excursion or reading changes", async () => {
  // Warm-up: evaluation endpoints persist derived rows on first call.
  await callTool(baseUrl, "get_temperature_excursions", {});
  await callTool(baseUrl, "get_risk_overview", { limit: 1 });

  const snapshot = async () => {
    const { rows } = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM recommendation) AS recommendations,
         (SELECT count(*)::int FROM audit_record) AS audits,
         (SELECT count(*)::int FROM temperature_excursion) AS excursions,
         (SELECT count(*)::int FROM sensor_reading) AS readings,
         (SELECT count(*)::int FROM recommendation WHERE status <> 'pending') AS decided`,
    );
    return rows[0];
  };

  const beforeState = await snapshot();
  for (const name of FROZEN_TOOLS) {
    await callTool(baseUrl, name, VALID_INPUTS[name]);
  }
  const afterState = await snapshot();
  assert.deepEqual(afterState, beforeState);
  assert.equal(afterState.decided, 0);
});

test("Bob multi-tool flow: disruption -> affected -> alternatives -> risk -> redeployment", async () => {
  const disruptions = await callTool(baseUrl, "get_active_disruptions", {});
  assert.ok(disruptions.data.some((row) => row.id === "D01"));

  const affected = await callTool(baseUrl, "get_affected_shipments", { disruption_id: "D01" });
  assert.ok(affected.data.some((row) => row.shipment.id === "S039" && row.impact_status === "critical"));

  const alternatives = await callTool(baseUrl, "get_route_alternatives", { shipment_id: "S001" });
  assert.ok(alternatives.rejected.some((row) => row.rejected_reason === "disrupted_region_overlap"));

  const risk = await callTool(baseUrl, "get_combined_risk", { shipment_id: "S039" });
  assert.equal(risk.combined_score, groundTruth.risk.S039.combined_score);
  assert.ok(risk.factors.coldchain.worst_excursion_id.startsWith("EX-"));

  const redeployment = await callTool(baseUrl, "get_redeployment_candidates", { shipment_id: "S039" });
  assert.ok(redeployment.data.length >= 1);
  assert.ok(redeployment.data[0].reasons.length >= 3);
});
