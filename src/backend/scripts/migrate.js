import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createPool } from "../src/common/db.js";
import { config } from "../src/common/config.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "..", "migrations");

export function listMigrationFiles() {
  return fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
}

export async function runMigrations(pool, { log = () => {} } = {}) {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename   text PRIMARY KEY,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );

  const { rows } = await pool.query("SELECT filename FROM schema_migrations");
  const applied = new Set(rows.map((row) => row.filename));
  const newlyApplied = [];

  for (const file of listMigrationFiles()) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
      await client.query("COMMIT");
      newlyApplied.push(file);
      log(`applied ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${error.message}`);
    } finally {
      client.release();
    }
  }

  return newlyApplied;
}

async function main() {
  const args = process.argv.slice(2);
  const useTest = args.includes("--test");
  const urlArg = args.find((arg) => arg.startsWith("--url="));
  const url = urlArg ? urlArg.slice("--url=".length) : useTest ? config.testDatabaseUrl : config.databaseUrl;

  const pool = createPool(url);
  try {
    const applied = await runMigrations(pool, { log: (message) => console.log(message) });
    console.log(applied.length ? `Applied ${applied.length} migration(s).` : "No pending migrations.");
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
