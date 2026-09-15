import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { setupTestDb, resetTables, expectPgError } from "../src/test-support/helpers.js";
import * as logistics from "../src/logistics/repository.js";
import * as coldchain from "../src/coldchain/repository.js";
import * as risk from "../src/risk/repository.js";
import * as audit from "../src/audit/repository.js";

let pool;

before(async () => {
  pool = await setupTestDb();
});

beforeEach(async () => {
  await resetTables(pool);
});

after(async () => {
  await pool.end();
});

const carrier = {
  id: "C01",
  name: "Test Carrier",
  service_regions: ["IN-WEST-COAST", "AE-JEBEL-ALI"],
  modes: ["sea"],
  capacity_units: 500,
  cost_index: 1.0,
  reliability_score: 0.9,
  status: "active",
};

const route = {
  id: "R001",
  origin_node: "INMUM",
  destination_node: "AEJEA",
  carrier_id: "C01",
  status: "active",
  total_distance_km: 1930,
  planned_duration_hours: 96,
  planned_cost_usd: 14000,
};

const segment1 = {
  id: "SEG-001",
  route_id: "R001",
  seq: 1,
  name: "Mumbai–Jebel Ali",
  region_code: "IN-WEST-COAST",
  mode: "sea",
  origin_node: "INMUM",
  destination_node: "AEJEA",
  distance_km: 1930,
  planned_duration_hours: 96,
  capacity_units: 220,
  cost_usd: 14000,
  dest_lat: 25.0128,
  dest_lon: 55.0614,
};

const segment2 = {
  ...segment1,
  id: "SEG-002",
  seq: 2,
  name: "Jebel Ali–Rotterdam",
  region_code: "AE-JEBEL-ALI",
};

const shipment = {
  id: "S001",
  route_id: "R001",
  cargo_type: "vaccine",
  is_cold_chain: true,
  cargo_value_usd: 520000,
  volume_units: 12,
  deadline: "2026-09-18T10:00:00Z",
  status: "in_transit",
  current_segment_id: "SEG-001",
  planned_departure: "2026-09-05T12:00:00Z",
  planned_arrival: "2026-09-17T06:00:00Z",
  actual_departure: "2026-09-05T12:40:00Z",
  created_at: "2026-09-01T08:00:00Z",
};

async function seedBaseline() {
  await logistics.insertCarrier(pool, carrier);
  await logistics.insertRoute(pool, route);
  await logistics.insertRouteSegment(pool, segment1);
  await logistics.insertRouteSegment(pool, segment2);
  await logistics.insertShipment(pool, shipment);
}

// ---------------------------------------------------------------------------
// Valid inserts via repositories
// ---------------------------------------------------------------------------
test("valid inserts: logistics round-trip through repositories", async () => {
  await seedBaseline();

  const storedCarrier = await logistics.getCarrier(pool, "C01");
  assert.equal(storedCarrier.name, "Test Carrier");
  assert.deepEqual(storedCarrier.service_regions, ["IN-WEST-COAST", "AE-JEBEL-ALI"]);

  const storedShipment = await logistics.getShipment(pool, "S001");
  assert.equal(storedShipment.is_cold_chain, true);
  assert.equal(storedShipment.current_segment_id, "SEG-001");
  assert.equal(new Date(storedShipment.planned_departure).toISOString(), "2026-09-05T12:00:00.000Z");

  const segments = await logistics.listSegmentsByRoute(pool, "R001");
  assert.equal(segments.length, 2);
  assert.deepEqual(segments.map((s) => s.seq), [1, 2]);
});

test("valid inserts: fleet asset and assignment round-trip", async () => {
  await seedBaseline();
  await logistics.insertFleetAsset(pool, {
    id: "A001",
    type: "truck",
    capacity_units: 16,
    refrigerated: true,
    current_lat: 19.076,
    current_lon: 72.8777,
    current_region_code: "IN-WEST-COAST",
    status: "available",
    available_since: "2026-09-14T03:20:00Z",
  });
  await logistics.insertAssetAssignment(pool, {
    id: "AA-0001",
    asset_id: "A001",
    shipment_id: "S001",
    start_time: "2026-09-15T08:00:00Z",
    end_time: "2026-09-15T20:00:00Z",
    reserved: true,
    status: "planned",
  });

  const assignments = await logistics.listAssignmentsByAsset(pool, "A001");
  assert.equal(assignments.length, 1);
  assert.equal(assignments[0].reserved, true);
});

test("valid inserts: cold-chain policy, reading, excursion round-trip", async () => {
  await seedBaseline();
  await coldchain.insertCargoProfile(pool, {
    cargo_type: "vaccine",
    display_name: "Vaccines",
    is_cold_chain: true,
    sensitivity_weight: 0.9,
    policy_required: true,
    notes: "illustrative",
  });
  await coldchain.insertTemperaturePolicy(pool, {
    id: "TP-VACCINE",
    cargo_type: "vaccine",
    min_c: 2.0,
    max_c: 8.0,
    max_excursion_minutes: 15,
    minor_deviation_c: 1.0,
    major_deviation_c: 3.0,
    critical_duration_minutes: 60,
    version: 1,
    effective_from: "2026-08-01T00:00:00Z",
    updated_by: "operator-1",
  });
  await coldchain.insertSensorReading(pool, {
    id: "SR-000001",
    shipment_id: "S001",
    sensor_id: "SEN-004",
    timestamp: "2026-09-14T09:00:00Z",
    temperature_c: 9.4,
    humidity_pct: 61.2,
    source: "simulated",
  });
  await coldchain.insertTemperatureExcursion(pool, {
    id: "EX-0001",
    shipment_id: "S001",
    policy_id: "TP-VACCINE",
    start_time: "2026-09-14T08:15:00Z",
    end_time: "2026-09-14T09:00:00Z",
    peak_deviation_c: 2.4,
    duration_min: 45,
    severity: "major",
    severity_rationale: "duration>tolerance;magnitude<=major",
    data_quality: "complete",
    status: "open",
  });

  const readings = await coldchain.listReadingsByShipment(pool, "S001");
  assert.equal(readings.length, 1);
  const excursions = await coldchain.listExcursions(pool, { shipment_id: "S001" });
  assert.equal(excursions.length, 1);
  assert.equal(excursions[0].severity, "major");
  const policy = await coldchain.getLatestPolicyForCargo(pool, "vaccine");
  assert.equal(Number(policy.max_c), 8.0);
});

test("valid inserts: risk assessment and audit record", async () => {
  await seedBaseline();
  const assessment = await risk.insertRiskAssessment(pool, {
    id: "RSK-0001",
    shipment_id: "S001",
    disruption_risk: 0.78,
    coldchain_risk: 0.3,
    combined_score: 0.54,
    factors: {
      disruption: { impact_score: 0.86 },
      coldchain: { severity: "warning" },
      weights: { alpha: 0.5, beta: 0.5 },
    },
  });
  assert.equal(Number(assessment.combined_score), 0.54);

  const record = await audit.appendAuditRecord(pool, {
    entity_type: "recommendation",
    entity_id: "REC-0001",
    action: "decided_accepted",
    actor: "operator-1",
    details: { decision: "accepted" },
  });
  assert.match(record.id, /^AUD-\d{6}$/);
  const auditRows = await audit.listAuditRecords(pool, { entity_type: "recommendation" });
  assert.equal(auditRows.length, 1);
});

// ---------------------------------------------------------------------------
// Invalid inserts and constraint failures
// ---------------------------------------------------------------------------
test("foreign-key failure: route with unknown carrier", async () => {
  await logistics.insertCarrier(pool, carrier);
  await expectPgError(
    pool.query(
      `INSERT INTO route (id, origin_node, destination_node, carrier_id, status, total_distance_km,
                          planned_duration_hours, planned_cost_usd)
       VALUES ('R002','A','B','C99','active',10,10,10)`,
    ),
    "23503",
  );
  await assert.rejects(() => logistics.insertRoute(pool, { ...route, id: "R003", carrier_id: "C99" }), (error) => error.code === "VALIDATION_ERROR");
});

test("foreign-key failure: shipment with unknown route", async () => {
  await expectPgError(
    pool.query(
      `INSERT INTO shipment (id, route_id, cargo_type, is_cold_chain, cargo_value_usd, volume_units,
                             deadline, status, planned_departure, planned_arrival)
       VALUES ('S900','R999','vaccine',true,1,1,'2027-01-01T00:00:00Z','planned','2026-12-01T00:00:00Z','2026-12-05T00:00:00Z')`,
    ),
    "23503",
  );
});

test("foreign-key failure: sensor reading with unknown shipment", async () => {
  await expectPgError(
    pool.query(
      `INSERT INTO sensor_reading (id, shipment_id, sensor_id, timestamp, temperature_c, source)
       VALUES ('SR-999999','S999','SEN-001','2026-09-14T09:00:00Z',5.0,'simulated')`,
    ),
    "23503",
  );
});

test("composite foreign-key: current segment must belong to the shipment route", async () => {
  await seedBaseline();
  await logistics.insertRoute(pool, { ...route, id: "R002" });
  await logistics.insertRouteSegment(pool, { ...segment1, id: "SEG-003", route_id: "R002", seq: 1 });
  await expectPgError(
    pool.query(
      `INSERT INTO shipment (id, route_id, cargo_type, is_cold_chain, cargo_value_usd, volume_units,
                             deadline, status, current_segment_id, planned_departure, planned_arrival)
       VALUES ('S901','R001','vaccine',true,1,1,'2027-01-01T00:00:00Z','in_transit','SEG-003',
               '2026-12-01T00:00:00Z','2026-12-05T00:00:00Z')`,
    ),
    "23503",
  );
});

test("unique violation: duplicate route segment sequence", async () => {
  await seedBaseline();
  await assert.rejects(
    () => logistics.insertRouteSegment(pool, { ...segment2, id: "SEG-009", seq: 1 }),
    (error) => error.code === "CONFLICT",
  );
});

test("check violation: invalid shipment status", async () => {
  await seedBaseline();
  await expectPgError(
    pool.query(`UPDATE shipment SET status = 'lost' WHERE id = 'S001'`),
    "23514",
  );
});

test("check violation: negative capacity", async () => {
  await expectPgError(
    pool.query(
      `INSERT INTO carrier (id, name, service_regions, modes, capacity_units, cost_index, reliability_score, status)
       VALUES ('C02','Bad','{IN-WEST-COAST}','{sea}',-5,1.0,0.9,'active')`,
    ),
    "23514",
  );
});

test("required-field validation: null carrier name is rejected", async () => {
  await expectPgError(
    pool.query(
      `INSERT INTO carrier (id, name, service_regions, modes, capacity_units, cost_index, reliability_score, status)
       VALUES ('C03', NULL, '{IN-WEST-COAST}', '{sea}', 10, 1.0, 0.9, 'active')`,
    ),
    "23502",
  );
});

test("check violation: delivered shipment requires actual_arrival", async () => {
  await seedBaseline();
  await expectPgError(
    pool.query(`UPDATE shipment SET status = 'delivered' WHERE id = 'S001'`),
    "23514",
  );
});

test("check violation: assignment end before start", async () => {
  await seedBaseline();
  await logistics.insertFleetAsset(pool, {
    id: "A002",
    type: "truck",
    capacity_units: 10,
    refrigerated: true,
    current_lat: 19.0,
    current_lon: 72.0,
    current_region_code: "IN-WEST-COAST",
    status: "available",
    available_since: "2026-09-14T03:00:00Z",
  });
  await expectPgError(
    pool.query(
      `INSERT INTO asset_assignment (id, asset_id, shipment_id, start_time, end_time, reserved, status)
       VALUES ('AA-0002','A002','S001','2026-09-15T20:00:00Z','2026-09-15T08:00:00Z',false,'planned')`,
    ),
    "23514",
  );
});

test("check violation: recommendation target must match its type", async () => {
  await seedBaseline();
  await logistics.insertFleetAsset(pool, {
    id: "A003",
    type: "truck",
    capacity_units: 10,
    refrigerated: true,
    current_lat: 19.0,
    current_lon: 72.0,
    current_region_code: "IN-WEST-COAST",
    status: "available",
    available_since: "2026-09-14T03:00:00Z",
  });
  await expectPgError(
    pool.query(
      `INSERT INTO recommendation (id, type, shipment_id, asset_id, score, factors, constraints_checked, rejected_alternatives, status)
       VALUES ('REC-0001','reroute','S001','A003',0.8,'{}','["x"]','[]','pending')`,
    ),
    "23514",
  );
});

test("check violation: policy thresholds must be ordered", async () => {
  await expectPgError(
    pool.query(
      `INSERT INTO temperature_policy (id, cargo_type, min_c, max_c, max_excursion_minutes,
                                       minor_deviation_c, major_deviation_c, critical_duration_minutes,
                                       version, effective_from, updated_by)
       VALUES ('TP-BAD','vaccine',8.0,2.0,15,1.0,3.0,60,1,'2026-08-01T00:00:00Z','op')`,
    ),
    "23514",
  );
});

test("check violation: excursion end before start", async () => {
  await seedBaseline();
  await expectPgError(
    pool.query(
      `INSERT INTO temperature_excursion (id, shipment_id, start_time, end_time, peak_deviation_c,
                                          duration_min, severity, severity_rationale, data_quality, status)
       VALUES ('EX-0002','S001','2026-09-14T09:00:00Z','2026-09-14T08:00:00Z',1.0,0,'warning','x','complete','open')`,
    ),
    "23514",
  );
});
