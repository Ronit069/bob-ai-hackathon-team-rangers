import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "..", ".."); // src/backend
const srcRoot = path.resolve(backendRoot, ".."); // src

// Load .env if present (no dotenv dependency; Node >= 20.12).
for (const envPath of [path.join(backendRoot, ".env"), path.join(srcRoot, ".env")]) {
  if (fs.existsSync(envPath)) {
    try {
      process.loadEnvFile(envPath);
    } catch {
      // ignore malformed .env; defaults below still apply
    }
  }
}

const env = process.env;
const num = (value, fallback) => (value === undefined || value === "" ? fallback : Number(value));

export const config = {
  port: num(env.PORT, 3001),
  nodeEnv: env.NODE_ENV ?? "development",
  // Default host port is 5433 because a local PostgreSQL service already uses 5432.
  databaseUrl: env.DATABASE_URL ?? "postgres://bobathon:bobathon@localhost:5433/chain_sentinel",
  testDatabaseUrl: env.TEST_DATABASE_URL ?? "postgres://bobathon:bobathon@localhost:5433/chain_sentinel_test",
  bobEnabled: env.BOB_ENABLED === "true",
  bobApiUrl: env.BOB_API_URL ?? "",
  bobApiKey: env.BOB_API_KEY ?? "",
  seed: num(env.SEED, 20260914),
  redeployRadiusKm: num(env.REDEPLOY_RADIUS_KM, 150),
  riskAlpha: num(env.RISK_ALPHA, 0.5),
  riskBeta: num(env.RISK_BETA, 0.5),
  sensorIntervalMin: num(env.SENSOR_INTERVAL_MIN, 15),
  excursionGroupGapMinutes: num(env.EXCURSION_GROUP_GAP_MINUTES, 30),
};
