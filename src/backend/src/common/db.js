import pg from "pg";
import { config } from "./config.js";

// Data contract uses numeric for scores/temperatures; return JS numbers, not strings.
pg.types.setTypeParser(1700, (value) => (value === null ? null : Number(value)));

export function createPool(connectionString = config.databaseUrl, options = {}) {
  return new pg.Pool({ connectionString, max: 10, ...options });
}

// Shared application pool (lazily created so tests can import this module safely).
let appPool = null;
export function getPool() {
  if (!appPool) appPool = createPool(config.databaseUrl);
  return appPool;
}

export async function query(text, params) {
  return getPool().query(text, params);
}

export async function withTransaction(fn, pool = getPool()) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function ping(pool = getPool()) {
  const { rows } = await pool.query("SELECT 1 AS ok");
  return rows[0].ok === 1;
}

export async function closePool(pool) {
  if (pool) await pool.end();
  if (pool === undefined && appPool) {
    await appPool.end();
    appPool = null;
  }
}
