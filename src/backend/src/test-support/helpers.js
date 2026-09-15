import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config } from "../common/config.js";
import { createPool } from "../common/db.js";
import { runMigrations } from "../../scripts/migrate.js";
import { resetAndLoad } from "../../scripts/seed.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.resolve(here, "../../../../data/seed");

export const TEST_URL = process.env.TEST_DATABASE_URL ?? config.testDatabaseUrl;

// Create the dedicated test database if it does not exist (admin connection = dev DB).
export async function ensureTestDatabase() {
  const testDbName = new URL(TEST_URL).pathname.slice(1);
  const adminPool = new pg.Pool({ connectionString: config.databaseUrl });
  try {
    const { rows } = await adminPool.query("SELECT 1 FROM pg_database WHERE datname = $1", [testDbName]);
    if (rows.length === 0) {
      await adminPool.query(`CREATE DATABASE "${testDbName}"`);
    }
  } finally {
    await adminPool.end();
  }
}

export async function setupTestDb() {
  await ensureTestDatabase();
  const pool = createPool(TEST_URL);
  await runMigrations(pool);
  return pool;
}

export async function resetTables(pool) {
  await pool.query(`TRUNCATE TABLE
      audit_record, risk_assessment, recommendation,
      temperature_excursion, sensor_reading, temperature_policy, cargo_profile,
      asset_assignment, fleet_asset, disruption, shipment, route_segment, route, carrier, id_sequence
    RESTART IDENTITY CASCADE`);
}

// Load the generated fixtures + ground truth from data/seed.
export function loadSeedJson() {
  const read = (name) => JSON.parse(fs.readFileSync(path.join(seedDir, name), "utf8"));
  return {
    logistics: read("logistics.json"),
    coldchain: read("coldchain.json"),
    groundTruth: read("ground_truth.json"),
  };
}

// Reset and load the full fixture set into the test database (transactional).
export async function seedTestDatabase(pool) {
  const { logistics, coldchain } = loadSeedJson();
  await resetAndLoad(pool, logistics, coldchain);
}

export async function expectPgError(promise, code, constraint = null) {
  try {
    await promise;
  } catch (error) {
    if (error.code !== code) {
      throw new Error(`Expected pg error ${code}, got ${error.code ?? error.message}`);
    }
    if (constraint && error.constraint !== constraint) {
      throw new Error(`Expected constraint ${constraint}, got ${error.constraint}`);
    }
    return error;
  }
  throw new Error(`Expected pg error ${code}, but the query succeeded`);
}

