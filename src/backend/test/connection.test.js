import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb } from "../src/test-support/helpers.js";

let pool;

before(async () => {
  pool = await setupTestDb();
});

after(async () => {
  await pool.end();
});

test("database connection responds", async () => {
  const { rows } = await pool.query("SELECT 1 AS ok");
  assert.equal(rows[0].ok, 1);
});

test("migrations are recorded in order", async () => {
  const { rows } = await pool.query("SELECT filename FROM schema_migrations ORDER BY filename");
  assert.deepEqual(
    rows.map((row) => row.filename),
    [
      "001_sequences.sql",
      "002_logistics.sql",
      "003_coldchain.sql",
      "004_shared.sql",
      "005_indexes.sql",
    ],
  );
});

test("all approved tables exist", async () => {
  const expected = [
    "id_sequence",
    "carrier",
    "route",
    "route_segment",
    "shipment",
    "disruption",
    "fleet_asset",
    "asset_assignment",
    "cargo_profile",
    "temperature_policy",
    "sensor_reading",
    "temperature_excursion",
    "recommendation",
    "risk_assessment",
    "audit_record",
  ];
  const { rows } = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
  );
  const names = new Set(rows.map((row) => row.table_name));
  for (const table of expected) {
    assert.ok(names.has(table), `missing table ${table}`);
  }
});

test("approved indexes exist", async () => {
  const { rows } = await pool.query(
    "SELECT indexname FROM pg_indexes WHERE schemaname = 'public'",
  );
  const names = new Set(rows.map((row) => row.indexname));
  for (const index of [
    "sensor_reading_shipment_ts_idx",
    "excursion_shipment_status_idx",
    "asset_assignment_asset_end_idx",
    "recommendation_shipment_status_idx",
  ]) {
    assert.ok(names.has(index), `missing index ${index}`);
  }
});

test("id_sequence supports prefixed sequential ids", async () => {
  const first = await pool.query(
    `INSERT INTO id_sequence (prefix, last_value) VALUES ('SR-', 1)
     ON CONFLICT (prefix) DO UPDATE SET last_value = id_sequence.last_value + 1
     RETURNING last_value`,
  );
  const second = await pool.query(
    `INSERT INTO id_sequence (prefix, last_value) VALUES ('SR-', 1)
     ON CONFLICT (prefix) DO UPDATE SET last_value = id_sequence.last_value + 1
     RETURNING last_value`,
  );
  assert.equal(Number(first.rows[0].last_value) + 1, Number(second.rows[0].last_value));
});
