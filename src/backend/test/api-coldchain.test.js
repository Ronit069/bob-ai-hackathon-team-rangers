// API contract tests — cold-chain endpoints 12–17 and 28.
// Ground truth (data/seed/ground_truth.json) is the oracle for detection output.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, seedTestDatabase, loadSeedJson } from "../src/test-support/helpers.js";
import { startTestServer, api } from "../src/test-support/api.js";

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

// ---------------------------------------------------------------------------
// 14 — excursions (runs first: oracle before any mutation)
// ---------------------------------------------------------------------------
test("GET /api/excursions persists exactly the ground-truth excursions", async () => {
  const { status, body } = await api(baseUrl, "/api/excursions");
  assert.equal(status, 200);
  const tuples = (rows) =>
    rows
      .map((row) => `${row.shipment_id}|${row.severity}|${row.data_quality}|${row.duration_min}|${row.peak_deviation_c}`)
      .sort();
  assert.deepEqual(tuples(body.data), tuples(groundTruth.excursions));
});

test("GET /api/excursions returns B-5 additions and filters by shipment/severity", async () => {
  const s026 = await api(baseUrl, "/api/excursions?shipment_id=S026");
  assert.equal(s026.status, 200);
  assert.equal(s026.body.count, 1);
  assert.equal(s026.body.data[0].severity, "major");
  assert.equal(s026.body.data[0].recommended_action, "Review and consider intervention");
  assert.ok("time_to_delivery_hours" in s026.body.data[0]);
  assert.ok(s026.body.data[0].severity_rationale.length > 0);

  const critical = await api(baseUrl, "/api/excursions?severity=critical");
  assert.ok(critical.body.data.every((row) => row.severity === "critical"));
  assert.ok(critical.body.data.some((row) => row.shipment_id === "S038"));
});

test("GET /api/excursions validates ids and enums", async () => {
  assert.equal((await api(baseUrl, "/api/excursions?shipment_id=S999")).status, 404);
  assert.equal((await api(baseUrl, "/api/excursions?severity=catastrophic")).status, 400);
});

// ---------------------------------------------------------------------------
// 15 — alerts
// ---------------------------------------------------------------------------
test("GET /api/alerts/coldchain combines excursion and sensor-failure alerts", async () => {
  const s038 = await api(baseUrl, "/api/excursions?shipment_id=S038");
  const criticalId = s038.body.data[0].id;

  const { status, body } = await api(baseUrl, "/api/alerts/coldchain");
  assert.equal(status, 200);
  assert.ok(body.count > 0);

  const excursionAlerts = body.data.filter((row) => row.type === "excursion");
  const failureAlerts = body.data.filter((row) => row.type === "sensor_failure");
  assert.ok(excursionAlerts.some((row) => row.excursion_id === criticalId));
  assert.ok(failureAlerts.length > 0);
  for (const row of body.data) {
    assert.ok(["excursion", "sensor_failure"].includes(row.type));
    assert.ok(typeof row.summary === "string" && row.summary.length > 0);
    assert.ok(row.shipment_id.startsWith("S"));
  }
  const criticalAlert = excursionAlerts.find((row) => row.excursion_id === criticalId);
  assert.equal(criticalAlert.human_review_required, true);
});

// ---------------------------------------------------------------------------
// 13 — readings + quality + sensor health
// ---------------------------------------------------------------------------
test("GET /api/shipments/:id/sensor-readings returns readings, quality, sensor and policy", async () => {
  const { status, body } = await api(baseUrl, "/api/shipments/S026/sensor-readings");
  assert.equal(status, 200);
  assert.equal(body.count, 97);
  assert.ok(body.data[0].timestamp < body.data[body.count - 1].timestamp);
  assert.ok(["reporting", "delayed", "failed", "unknown"].includes(body.quality.sensor_status));
  assert.ok(Number.isInteger(body.quality.gaps));
  assert.equal(body.sensor.expected_interval_min, 15);
  assert.equal(body.policy.id, "TP-VACCINE");
  assert.equal(Number(body.policy.max_c), 8);
});

test("GET /api/shipments/:id/sensor-readings supports desc order and validates input", async () => {
  const desc = await api(baseUrl, "/api/shipments/S026/sensor-readings?order=desc");
  assert.ok(desc.body.data[0].timestamp > desc.body.data[desc.body.count - 1].timestamp);
  assert.equal((await api(baseUrl, "/api/shipments/S999/sensor-readings")).status, 404);
  assert.equal((await api(baseUrl, "/api/shipments/S026/sensor-readings?from=not-a-date")).status, 400);
});

// ---------------------------------------------------------------------------
// 16/17 — policies
// ---------------------------------------------------------------------------
test("GET /api/temperature-policies lists the latest version per cargo type", async () => {
  const { status, body } = await api(baseUrl, "/api/temperature-policies");
  assert.equal(status, 200);
  assert.equal(body.count, 4);
  const vaccine = body.data.find((row) => row.cargo_type === "vaccine");
  assert.equal(vaccine.version, 1);
  assert.equal(vaccine.id, "TP-VACCINE");
});

test("PUT /api/temperature-policies/:id creates a new version with an audit record", async () => {
  const { status, body } = await api(baseUrl, "/api/temperature-policies/TP-VACCINE", {
    method: "PUT",
    body: {
      min_c: 2.0,
      max_c: 8.0,
      max_excursion_minutes: 15,
      minor_deviation_c: 1.5,
      major_deviation_c: 3.0,
      critical_duration_minutes: 60,
      updated_by: "operator-1",
    },
  });
  assert.equal(status, 200);
  assert.equal(body.version, 2);
  assert.equal(body.id, "TP-VACCINE_V2");

  const audit = await pool.query(
    "SELECT * FROM audit_record WHERE entity_type = 'temperature_policy' AND entity_id = 'TP-VACCINE_V2'",
  );
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0].action, "policy_updated");

  const latest = await api(baseUrl, "/api/temperature-policies");
  const vaccine = latest.body.data.find((row) => row.cargo_type === "vaccine");
  assert.equal(vaccine.version, 2);

  const history = await api(baseUrl, "/api/temperature-policies?include_history=true");
  assert.equal(history.body.count, 5);
});

test("PUT /api/temperature-policies validates ids and thresholds", async () => {
  assert.equal((await api(baseUrl, "/api/temperature-policies/TP-NOPE", { method: "PUT", body: { min_c: 1, max_c: 2, max_excursion_minutes: 5, minor_deviation_c: 1, major_deviation_c: 2, critical_duration_minutes: 10 } })).status, 404);
  assert.equal((await api(baseUrl, "/api/temperature-policies/TP-VACCINE", { method: "PUT", body: { min_c: 9, max_c: 2, max_excursion_minutes: 5, minor_deviation_c: 1, major_deviation_c: 2, critical_duration_minutes: 10 } })).status, 400);
});

// ---------------------------------------------------------------------------
// 28 — excursion review lifecycle
// ---------------------------------------------------------------------------
test("PATCH /api/excursions/:id follows the review lifecycle with audit", async () => {
  const listed = await api(baseUrl, "/api/excursions?shipment_id=S025");
  const excursion = listed.body.data[0];
  assert.equal(excursion.severity, "warning");

  const acknowledged = await api(baseUrl, `/api/excursions/${excursion.id}`, {
    method: "PATCH",
    body: { status: "acknowledged" },
  });
  assert.equal(acknowledged.status, 200);
  assert.equal(acknowledged.body.status, "acknowledged");
  assert.ok(acknowledged.body.audit_record_id.startsWith("AUD-"));

  const closed = await api(baseUrl, `/api/excursions/${excursion.id}`, {
    method: "PATCH",
    body: { status: "closed", note: "Reviewed; no action needed" },
  });
  assert.equal(closed.status, 200);
  assert.equal(closed.body.status, "closed");

  const again = await api(baseUrl, `/api/excursions/${excursion.id}`, {
    method: "PATCH",
    body: { status: "closed" },
  });
  assert.equal(again.status, 409);
});

test("PATCH /api/excursions/:id requires a note to close a critical excursion", async () => {
  const listed = await api(baseUrl, "/api/excursions?shipment_id=S038");
  const excursion = listed.body.data[0];
  assert.equal(excursion.severity, "critical");

  const withoutNote = await api(baseUrl, `/api/excursions/${excursion.id}`, {
    method: "PATCH",
    body: { status: "closed" },
  });
  assert.equal(withoutNote.status, 400);
  assert.equal(withoutNote.body.error.code, "VALIDATION_ERROR");

  const withNote = await api(baseUrl, `/api/excursions/${excursion.id}`, {
    method: "PATCH",
    body: { status: "closed", note: "Compliance reviewed and documented" },
  });
  assert.equal(withNote.status, 200);
});

test("PATCH /api/excursions/:id rejects unknown ids", async () => {
  const { status, body } = await api(baseUrl, "/api/excursions/EX-9999", {
    method: "PATCH",
    body: { status: "acknowledged" },
  });
  assert.equal(status, 404);
  assert.equal(body.error.code, "NOT_FOUND");
});

// ---------------------------------------------------------------------------
// 12 — ingestion
// ---------------------------------------------------------------------------
test("POST /api/sensor-readings ingests a valid batch with quality flags", async () => {
  const { status, body } = await api(baseUrl, "/api/sensor-readings", {
    method: "POST",
    body: {
      readings: [
        { shipment_id: "S021", sensor_id: "SEN-021", timestamp: minutesAgo(45), temperature_c: 5.2, humidity_pct: 58.0, source: "simulated" },
        { shipment_id: "S021", sensor_id: "SEN-021", timestamp: minutesAgo(30), temperature_c: 5.4, source: "simulated" },
      ],
    },
  });
  assert.equal(status, 201);
  assert.equal(body.ingested, 2);
  assert.deepEqual(body.rejected, []);
  assert.equal(body.quality_flags.length, 2);
  assert.ok(body.quality_flags[0].reading_id.startsWith("SR-"));

  const stored = await pool.query("SELECT count(*)::int AS n FROM sensor_reading WHERE shipment_id = 'S021'");
  assert.equal(stored.rows[0].n, 99);
});

test("POST /api/sensor-readings flags duplicates in the batch", async () => {
  const timestamp = minutesAgo(15);
  const { status, body } = await api(baseUrl, "/api/sensor-readings", {
    method: "POST",
    body: {
      readings: [
        { shipment_id: "S022", sensor_id: "SEN-022", timestamp, temperature_c: 5.0, source: "simulated" },
        { shipment_id: "S022", sensor_id: "SEN-022", timestamp, temperature_c: 5.0, source: "simulated" },
      ],
    },
  });
  assert.equal(status, 201);
  const flags = body.quality_flags.map((row) => row.flags);
  assert.ok(flags[0].length === 0 || !flags[0].includes("duplicate"));
  assert.ok(flags[1].includes("duplicate"));
});

test("POST /api/sensor-readings returns partial success with per-reading rejections", async () => {
  const future = iso(new Date(Date.now() + 24 * 3_600_000));
  const { status, body } = await api(baseUrl, "/api/sensor-readings", {
    method: "POST",
    body: {
      readings: [
        { shipment_id: "S023", sensor_id: "SEN-023", timestamp: minutesAgo(10), temperature_c: 5.1, source: "simulated" },
        { shipment_id: "S023", sensor_id: "SEN-023", timestamp: future, temperature_c: 5.1, source: "simulated" },
      ],
    },
  });
  assert.equal(status, 201);
  assert.equal(body.ingested, 1);
  assert.equal(body.rejected.length, 1);
  assert.equal(body.rejected[0].reason, "invalid_reading");
});

test("POST /api/sensor-readings rejects an all-invalid batch (decision D5)", async () => {
  const future = iso(new Date(Date.now() + 24 * 3_600_000));
  const { status, body } = await api(baseUrl, "/api/sensor-readings", {
    method: "POST",
    body: { readings: [{ shipment_id: "S024", sensor_id: "SEN-024", timestamp: future, temperature_c: 5.0, source: "simulated" }] },
  });
  assert.equal(status, 400);
  assert.equal(body.error.code, "VALIDATION_ERROR");
  assert.equal(body.error.details.rejected.length, 1);
});

test("POST /api/sensor-readings rejects readings for unknown shipments", async () => {
  const { status, body } = await api(baseUrl, "/api/sensor-readings", {
    method: "POST",
    body: { readings: [{ shipment_id: "S999", sensor_id: "SEN-999", timestamp: minutesAgo(5), temperature_c: 5.0, source: "simulated" }] },
  });
  assert.equal(status, 400);
  assert.equal(body.error.details.rejected[0].reason, "shipment_not_found");
});

test("POST /api/sensor-readings validates the envelope", async () => {
  assert.equal((await api(baseUrl, "/api/sensor-readings", { method: "POST", body: { readings: [] } })).status, 400);
  assert.equal((await api(baseUrl, "/api/sensor-readings", { method: "POST", body: {} })).status, 400);
});

test("ingestion triggers excursion persistence for the affected shipment", async () => {
  const before = await api(baseUrl, "/api/excursions?shipment_id=S039");
  const { status } = await api(baseUrl, "/api/sensor-readings", {
    method: "POST",
    body: {
      readings: [
        { shipment_id: "S039", sensor_id: "SEN-039", timestamp: minutesAgo(30), temperature_c: 10.4, source: "simulated" },
        { shipment_id: "S039", sensor_id: "SEN-039", timestamp: minutesAgo(15), temperature_c: 10.4, source: "simulated" },
      ],
    },
  });
  assert.equal(status, 201);

  const after = await api(baseUrl, "/api/excursions?shipment_id=S039");
  assert.equal(after.body.count, before.body.count + 1);
  const newest = after.body.data[0];
  assert.equal(newest.shipment_id, "S039");
  assert.ok(newest.id.startsWith("EX-"));
});

// ---------------------------------------------------------------------------
// Phase 6 / F5 — evaluation write-throttle
// ---------------------------------------------------------------------------
test("excursion refresh skips unchanged readings and re-evaluates on new readings", async () => {
  const updates = { n: 0 };
  const countingDb = {
    query: (text, params) => {
      if (typeof text === "string" && text.includes("UPDATE temperature_excursion")) updates.n += 1;
      return pool.query(text, params);
    },
  };
  const throttled = await startTestServer(countingDb);
  try {
    const path = "/api/excursions?shipment_id=S039";

    // A new reading changes the fingerprint, so the next refresh must re-evaluate
    // and update the (open) persisted excursions for S039.
    await pool.query(
      `INSERT INTO sensor_reading (id, shipment_id, sensor_id, timestamp, temperature_c, humidity_pct, source)
       VALUES ('SR-900001', 'S039', 'SEN-039', now(), 5.0, 50, 'manual')`,
    );
    const changed = await api(throttled.baseUrl, path);
    assert.equal(changed.status, 200);
    assert.ok(updates.n > 0, "expected at least one evaluation update after a new reading");
    const afterReevaluation = updates.n;

    // Unchanged readings: a repeated call must not write again (throttled).
    await api(throttled.baseUrl, path);
    assert.equal(updates.n, afterReevaluation);
  } finally {
    await throttled.close();
  }
});

test("external reseed invalidates the evaluation memo (npm run seed while the server runs)", async () => {
  await api(baseUrl, "/api/excursions"); // warm the memo against the current database
  await seedTestDatabase(pool); // external reset, server process keeps its memo

  const after = await api(baseUrl, "/api/excursions");
  assert.equal(after.status, 200);
  assert.equal(after.body.count, groundTruth.excursions.length);
});
