// Seed loader — loads validated JSON fixtures into PostgreSQL transactionally.
// Usage: node scripts/seed.js [--keep] [--dir=../../data/seed]
// Default behaviour resets demo tables (truncate) then loads everything in one transaction.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPool } from "../src/common/db.js";
import { config } from "../src/common/config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultDir = path.resolve(here, "../../..", "data", "seed");

const TRUNCATE_ORDER = [
  "audit_record",
  "risk_assessment",
  "recommendation",
  "temperature_excursion",
  "sensor_reading",
  "temperature_policy",
  "cargo_profile",
  "asset_assignment",
  "fleet_asset",
  "disruption",
  "shipment",
  "route_segment",
  "route",
  "carrier",
  "id_sequence",
];

function loadJson(directory, name) {
  const file = path.join(directory, name);
  if (!fs.existsSync(file)) {
    throw new Error(`Missing fixture ${file}. Run the Python generator first (python generate.py).`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// Lightweight pre-seed referential check (the full contract validator is Python: validate.py).
export function checkFixtures(logistics, coldchain) {
  const errors = [];
  const carrierIds = new Set(logistics.carriers.map((c) => c.id));
  const routeIds = new Set(logistics.routes.map((r) => r.id));
  const shipmentIds = new Set(logistics.shipments.map((s) => s.id));
  const assetIds = new Set(logistics.fleet_assets.map((a) => a.id));
  const segmentsByRoute = new Map();
  for (const segment of logistics.route_segments) {
    segmentsByRoute.set(segment.route_id, [...(segmentsByRoute.get(segment.route_id) ?? []), segment.id]);
  }

  const unique = (rows, key, label) => {
    const seen = new Set();
    for (const row of rows) {
      if (seen.has(row[key])) errors.push(`${label} duplicate id ${row[key]}`);
      seen.add(row[key]);
    }
  };
  unique(logistics.carriers, "id", "carrier");
  unique(logistics.routes, "id", "route");
  unique(logistics.route_segments, "id", "route_segment");
  unique(logistics.shipments, "id", "shipment");
  unique(logistics.disruptions, "id", "disruption");
  unique(logistics.fleet_assets, "id", "fleet_asset");
  unique(logistics.asset_assignments, "id", "asset_assignment");
  unique(coldchain.temperature_policies, "id", "temperature_policy");
  unique(coldchain.sensor_readings, "id", "sensor_reading");

  for (const route of logistics.routes) {
    if (!carrierIds.has(route.carrier_id)) errors.push(`route ${route.id} references missing carrier ${route.carrier_id}`);
  }
  for (const segment of logistics.route_segments) {
    if (!routeIds.has(segment.route_id)) errors.push(`segment ${segment.id} references missing route ${segment.route_id}`);
  }
  for (const shipment of logistics.shipments) {
    if (!routeIds.has(shipment.route_id)) errors.push(`shipment ${shipment.id} references missing route ${shipment.route_id}`);
    if (shipment.current_segment_id && !(segmentsByRoute.get(shipment.route_id) ?? []).includes(shipment.current_segment_id)) {
      errors.push(`shipment ${shipment.id} current segment ${shipment.current_segment_id} is not on its route`);
    }
  }
  for (const assignment of logistics.asset_assignments) {
    if (!assetIds.has(assignment.asset_id)) errors.push(`assignment ${assignment.id} references missing asset ${assignment.asset_id}`);
    if (!shipmentIds.has(assignment.shipment_id)) errors.push(`assignment ${assignment.id} references missing shipment ${assignment.shipment_id}`);
  }
  for (const reading of coldchain.sensor_readings) {
    if (!shipmentIds.has(reading.shipment_id)) errors.push(`reading ${reading.id} references missing shipment ${reading.shipment_id}`);
  }
  return errors;
}

async function truncateAll(client) {
  await client.query(`TRUNCATE TABLE ${TRUNCATE_ORDER.join(", ")} RESTART IDENTITY CASCADE`);
}

async function insertCarriers(client, rows) {
  for (const row of rows) {
    await client.query(
      `INSERT INTO carrier (id, name, service_regions, modes, capacity_units, cost_index, reliability_score, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [row.id, row.name, row.service_regions, row.modes, row.capacity_units, row.cost_index, row.reliability_score, row.status],
    );
  }
}

async function insertRoutes(client, rows) {
  for (const row of rows) {
    await client.query(
      `INSERT INTO route (id, origin_node, destination_node, carrier_id, status, total_distance_km,
                          planned_duration_hours, planned_cost_usd, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9, now()))`,
      [row.id, row.origin_node, row.destination_node, row.carrier_id, row.status, row.total_distance_km,
        row.planned_duration_hours, row.planned_cost_usd, row.created_at ?? null],
    );
  }
}

async function insertSegments(client, rows) {
  for (const row of rows) {
    await client.query(
      `INSERT INTO route_segment (id, route_id, seq, name, region_code, mode, origin_node, destination_node,
                                  distance_km, planned_duration_hours, capacity_units, cost_usd, dest_lat, dest_lon)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [row.id, row.route_id, row.seq, row.name, row.region_code, row.mode, row.origin_node, row.destination_node,
        row.distance_km, row.planned_duration_hours, row.capacity_units, row.cost_usd, row.dest_lat, row.dest_lon],
    );
  }
}

async function insertShipments(client, rows) {
  for (const row of rows) {
    await client.query(
      `INSERT INTO shipment (id, route_id, cargo_type, is_cold_chain, cargo_value_usd, volume_units, deadline,
                             status, current_segment_id, planned_departure, planned_arrival,
                             actual_departure, actual_arrival, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, COALESCE($14, now()), COALESCE($15, now()))`,
      [row.id, row.route_id, row.cargo_type, row.is_cold_chain, row.cargo_value_usd, row.volume_units, row.deadline,
        row.status, row.current_segment_id ?? null, row.planned_departure, row.planned_arrival,
        row.actual_departure ?? null, row.actual_arrival ?? null, row.created_at ?? null, row.updated_at ?? null],
    );
  }
}

async function insertDisruptions(client, rows) {
  for (const row of rows) {
    await client.query(
      `INSERT INTO disruption (id, type, region_code, start_time, end_time, severity, status,
                               description, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, COALESCE($10, now()))`,
      [row.id, row.type, row.region_code, row.start_time, row.end_time ?? null, row.severity, row.status,
        row.description, row.created_by, row.created_at ?? null],
    );
  }
}

async function insertAssets(client, rows) {
  for (const row of rows) {
    await client.query(
      `INSERT INTO fleet_asset (id, type, capacity_units, refrigerated, current_lat, current_lon,
                                current_region_code, status, available_since, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, COALESCE($10, now()))`,
      [row.id, row.type, row.capacity_units, row.refrigerated, row.current_lat, row.current_lon,
        row.current_region_code, row.status, row.available_since ?? null, row.created_at ?? null],
    );
  }
}

async function insertAssignments(client, rows) {
  for (const row of rows) {
    await client.query(
      `INSERT INTO asset_assignment (id, asset_id, shipment_id, start_time, end_time, reserved, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8, now()))`,
      [row.id, row.asset_id, row.shipment_id, row.start_time, row.end_time, row.reserved, row.status, row.created_at ?? null],
    );
  }
}

async function insertCargoProfiles(client, rows) {
  for (const row of rows) {
    await client.query(
      `INSERT INTO cargo_profile (cargo_type, display_name, is_cold_chain, sensitivity_weight, policy_required, notes)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [row.cargo_type, row.display_name, row.is_cold_chain, row.sensitivity_weight, row.policy_required, row.notes ?? null],
    );
  }
}

async function insertPolicies(client, rows) {
  for (const row of rows) {
    await client.query(
      `INSERT INTO temperature_policy (id, cargo_type, min_c, max_c, max_excursion_minutes,
                                       minor_deviation_c, major_deviation_c, critical_duration_minutes,
                                       version, effective_from, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, COALESCE($12, now()))`,
      [row.id, row.cargo_type, row.min_c, row.max_c, row.max_excursion_minutes, row.minor_deviation_c,
        row.major_deviation_c, row.critical_duration_minutes, row.version, row.effective_from,
        row.updated_by, row.updated_at ?? null],
    );
  }
}

async function insertReadings(client, rows, batchSize = 200) {
  const columnCount = 8;
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize);
    const placeholders = [];
    const params = [];
    batch.forEach((row, index) => {
      const base = index * columnCount;
      placeholders.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},COALESCE($${base + 8}, now()))`);
      params.push(row.id, row.shipment_id, row.sensor_id, row.timestamp, row.temperature_c, row.humidity_pct ?? null, row.source, row.created_at ?? null);
    });
    await client.query(
      `INSERT INTO sensor_reading (id, shipment_id, sensor_id, timestamp, temperature_c, humidity_pct, source, created_at)
       VALUES ${placeholders.join(",")}`,
      params,
    );
  }
}

// Ordered fixture load (shared with the test suite).
export async function loadFixtures(client, logistics, coldchain) {
  await insertCarriers(client, logistics.carriers);
  await insertRoutes(client, logistics.routes);
  await insertSegments(client, logistics.route_segments);
  await insertShipments(client, logistics.shipments);
  await insertDisruptions(client, logistics.disruptions);
  await insertAssets(client, logistics.fleet_assets);
  await insertAssignments(client, logistics.asset_assignments);
  await insertCargoProfiles(client, coldchain.cargo_profiles);
  await insertPolicies(client, coldchain.temperature_policies);
  await insertReadings(client, coldchain.sensor_readings);
}

// Runtime ID counters must continue after the seeded IDs so endpoints that create
// records (D##, REC-####, EX-####, AUD-######, SR-######) never collide with fixtures.
export async function seedIdSequences(client, logistics, coldchain) {
  const maxima = new Map();
  const consider = (prefix, id) => {
    const value = Number.parseInt(String(id).slice(prefix.length), 10);
    if (Number.isFinite(value)) {
      maxima.set(prefix, Math.max(maxima.get(prefix) ?? 0, value));
    }
  };
  for (const row of logistics.carriers) consider("C", row.id);
  for (const row of logistics.routes) consider("R", row.id);
  for (const row of logistics.route_segments) consider("SEG-", row.id);
  for (const row of logistics.shipments) consider("S", row.id);
  for (const row of logistics.disruptions) consider("D", row.id);
  for (const row of logistics.fleet_assets) consider("A", row.id);
  for (const row of logistics.asset_assignments) consider("AA-", row.id);
  for (const row of coldchain.sensor_readings) consider("SR-", row.id);

  for (const [prefix, last] of maxima) {
    await client.query(
      `INSERT INTO id_sequence (prefix, last_value) VALUES ($1, $2)
       ON CONFLICT (prefix) DO UPDATE SET last_value = GREATEST(id_sequence.last_value, EXCLUDED.last_value)`,
      [prefix, last],
    );
  }
}

// Reset + load in one transaction (seed CLI and tests).
export async function resetAndLoad(pool, logistics, coldchain) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await truncateAll(client);
    await loadFixtures(client, logistics, coldchain);
    await seedIdSequences(client, logistics, coldchain);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const keep = args.includes("--keep");
  const dirArg = args.find((arg) => arg.startsWith("--dir="));
  const directory = dirArg ? path.resolve(dirArg.slice("--dir=".length)) : defaultDir;

  const logistics = loadJson(directory, "logistics.json");
  const coldchain = loadJson(directory, "coldchain.json");

  const errors = checkFixtures(logistics, coldchain);
  if (errors.length > 0) {
    console.error("Pre-seed validation failed:");
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }

  const pool = createPool(config.databaseUrl);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!keep) await truncateAll(client);
    await loadFixtures(client, logistics, coldchain);
    await seedIdSequences(client, logistics, coldchain);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  console.log(`seed: ${directory}`);
  console.log(`  carriers=${logistics.carriers.length} routes=${logistics.routes.length} segments=${logistics.route_segments.length}`);
  console.log(`  shipments=${logistics.shipments.length} disruptions=${logistics.disruptions.length}`);
  console.log(`  assets=${logistics.fleet_assets.length} assignments=${logistics.asset_assignments.length}`);
  console.log(`  profiles=${coldchain.cargo_profiles.length} policies=${coldchain.temperature_policies.length} readings=${coldchain.sensor_readings.length}`);
  console.log(keep ? "  mode: keep (no truncate)" : "  mode: reset (tables truncated)");
}

// Only run when executed directly (validate.js imports checkFixtures from this module).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
