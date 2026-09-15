// API contract tests — shared endpoints 18–23 (risk, recommendations, audit, Bob proxy).
// Ground truth (data/seed/ground_truth.json) is the oracle for risk values.

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
// 18/19 — combined risk
// ---------------------------------------------------------------------------
test("GET /api/shipments/S039/risk matches the ground-truth combined score", async () => {
  const expected = groundTruth.risk.S039;
  const { status, body } = await api(baseUrl, "/api/shipments/S039/risk");
  assert.equal(status, 200);
  assert.equal(body.shipment_id, "S039");
  assert.equal(body.disruption_risk, expected.disruption_risk);
  assert.equal(body.coldchain_risk, expected.coldchain_risk);
  assert.equal(body.combined_score, expected.combined_score);

  // RC-3 nested factors
  assert.equal(body.factors.disruption.impact_score, expected.disruption_risk);
  assert.ok(body.factors.disruption.affected_disruption_ids.includes("D01"));
  assert.equal(body.factors.coldchain.severity, "major");
  assert.ok(body.factors.coldchain.worst_excursion_id.startsWith("EX-"));
  assert.equal(body.factors.weights.alpha, 0.5);
  assert.equal(body.factors.weights.beta, 0.5);
  assert.ok(body.computed_at);
});

test("GET /api/shipments/:id/risk returns the stored snapshot when refresh=false", async () => {
  const fresh = await api(baseUrl, "/api/shipments/S039/risk");
  const stored = await api(baseUrl, "/api/shipments/S039/risk?refresh=false");
  assert.equal(stored.status, 200);
  assert.equal(stored.body.combined_score, fresh.body.combined_score);
  assert.equal(stored.body.factors.coldchain.worst_excursion_id, fresh.body.factors.coldchain.worst_excursion_id);

  assert.equal((await api(baseUrl, "/api/shipments/S999/risk")).status, 404);
  assert.equal((await api(baseUrl, "/api/shipments/S001/risk?refresh=nonsense")).status, 400);
});

test("GET /api/shipments/:id/risk: non-cold shipment has zero cold-chain risk", async () => {
  const s001 = groundTruth.matching.find((row) => row.shipment_id === "S001");
  const { body } = await api(baseUrl, "/api/shipments/S001/risk");
  assert.equal(body.disruption_risk, s001.impact_score);
  assert.equal(body.coldchain_risk, 0);
  assert.equal(body.factors.coldchain.severity, "normal");
});

test("GET /api/risk/overview ranks actionable shipments and excludes zeros by default", async () => {
  const { status, body } = await api(baseUrl, "/api/risk/overview");
  assert.equal(status, 200);
  assert.equal(body.data.length, body.count);
  assert.ok(body.data.length > 0);

  const scores = body.data.map((row) => row.combined_score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));

  const s039 = body.data.find((row) => row.shipment.id === "S039");
  assert.ok(s039);
  assert.equal(s039.combined_score, groundTruth.risk.S039.combined_score);
  assert.equal(s039.shipment.is_cold_chain, true);

  const withZero = await api(baseUrl, "/api/risk/overview?include_zero=true");
  assert.ok(withZero.body.data.length >= body.data.length);

  const limited = await api(baseUrl, "/api/risk/overview?limit=3");
  assert.equal(limited.body.data.length, 3);
});

// ---------------------------------------------------------------------------
// Phase 6 / F5 — snapshot write-throttle
// ---------------------------------------------------------------------------
test("GET /api/risk/overview throttles unchanged snapshots but still returns fresh values", async () => {
  const snapshotCount = async () =>
    (await pool.query("SELECT count(*)::int AS n FROM risk_assessment")).rows[0].n;

  await api(baseUrl, "/api/risk/overview"); // warm-up: persist current values
  const before = await snapshotCount();

  const repeat = await api(baseUrl, "/api/risk/overview");
  assert.equal(repeat.status, 200);
  assert.equal(await snapshotCount(), before, "unchanged assessments must not insert new snapshot rows");

  const s039 = repeat.body.data.find((row) => row.shipment.id === "S039");
  assert.equal(s039.combined_score, groundTruth.risk.S039.combined_score);
  assert.equal(s039.factors.weights.alpha, 0.5);
});

// ---------------------------------------------------------------------------
// 20/21 — recommendations list + decision
// ---------------------------------------------------------------------------
test("GET /api/recommendations lists pending recommendations with filters", async () => {
  const created = await api(baseUrl, "/api/recommendations", {
    method: "POST",
    body: { type: "reroute", shipment_id: "S040", route_id: "R006" },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.id, "REC-0001");

  const listed = await api(baseUrl, "/api/recommendations?shipment_id=S040&status=pending");
  assert.equal(listed.status, 200);
  assert.equal(listed.body.count, 1);
  assert.equal(listed.body.data[0].id, "REC-0001");

  const byType = await api(baseUrl, "/api/recommendations?type=reroute");
  assert.ok(byType.body.data.some((row) => row.id === "REC-0001"));
  assert.equal((await api(baseUrl, "/api/recommendations?status=nonsense")).status, 400);
});

test("POST /api/recommendations/:id/decision records the decision and audit", async () => {
  const decided = await api(baseUrl, "/api/recommendations/REC-0001/decision", {
    method: "POST",
    body: { decision: "accepted", notes: "Approved after capacity check" },
  });
  assert.equal(decided.status, 200);
  assert.equal(decided.body.status, "accepted");
  assert.ok(decided.body.audit_record_id.startsWith("AUD-"));

  const audit = await api(baseUrl, `/api/audit?entity_id=REC-0001&order=asc`);
  const actions = audit.body.data.map((row) => row.action);
  assert.deepEqual(actions, ["created", "decided_accepted"]);

  const again = await api(baseUrl, "/api/recommendations/REC-0001/decision", {
    method: "POST",
    body: { decision: "rejected" },
  });
  assert.equal(again.status, 409);

  assert.equal((await api(baseUrl, "/api/recommendations/REC-9999/decision", { method: "POST", body: { decision: "accepted" } })).status, 404);
  assert.equal((await api(baseUrl, "/api/recommendations/REC-0001/decision", { method: "POST", body: { decision: "maybe" } })).status, 400);
});

test("decision 'modified' records the payload in the audit only (D4: no mutation)", async () => {
  const created = await api(baseUrl, "/api/fleet/redeployments/recommend", {
    method: "POST",
    body: { shipment_id: "S013", asset_id: "A001" },
  });
  assert.equal(created.status, 201);

  const decided = await api(baseUrl, `/api/recommendations/${created.body.id}/decision`, {
    method: "POST",
    body: { decision: "modified", modified_payload: { asset_id: "A017" }, notes: "Operator prefers A017" },
  });
  assert.equal(decided.status, 200);
  assert.equal(decided.body.status, "modified");
  // D4: the recommendation target is never mutated
  assert.equal(decided.body.asset_id, "A001");

  const audit = await api(baseUrl, `/api/audit?entity_id=${created.body.id}`);
  const decisionRecord = audit.body.data.find((row) => row.action === "decided_modified");
  assert.equal(decisionRecord.details.modified_payload.asset_id, "A017");
  assert.equal(decisionRecord.details.notes, "Operator prefers A017");
});

// ---------------------------------------------------------------------------
// 22 — audit
// ---------------------------------------------------------------------------
test("GET /api/audit supports entity filters and ordering", async () => {
  const all = await api(baseUrl, "/api/audit");
  assert.equal(all.status, 200);
  assert.ok(all.body.count > 0);

  const recommendations = await api(baseUrl, "/api/audit?entity_type=recommendation");
  assert.ok(recommendations.body.data.every((row) => row.entity_type === "recommendation"));

  const ascending = await api(baseUrl, "/api/audit?order=asc");
  const timestamps = ascending.body.data.map((row) => new Date(row.timestamp).getTime());
  assert.deepEqual(timestamps, [...timestamps].sort((a, b) => a - b));

  assert.equal((await api(baseUrl, "/api/audit?entity_type=nonsense")).status, 400);
});

// ---------------------------------------------------------------------------
// 23 — Bob proxy (503 fallback, decision D2)
// ---------------------------------------------------------------------------
test("POST /api/bob/query returns 503 BOB_UNAVAILABLE while Bob is disabled", async () => {
  const { status, body } = await api(baseUrl, "/api/bob/query", {
    method: "POST",
    body: { prompt: "Which shipments are affected by the port strike?" },
  });
  assert.equal(status, 503);
  assert.equal(body.error.code, "BOB_UNAVAILABLE");
  assert.equal(body.error.details.reason, "bob_disabled");
});

test("POST /api/bob/query validates the prompt", async () => {
  assert.equal((await api(baseUrl, "/api/bob/query", { method: "POST", body: { prompt: "" } })).status, 400);
  assert.equal((await api(baseUrl, "/api/bob/query", { method: "POST", body: {} })).status, 400);
});
