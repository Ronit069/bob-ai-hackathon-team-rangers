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

// IBM watsonx.ai / Granite boundary. Credentials stay server-side; values that are
// empty or still placeholders (YOUR_*_HERE) are treated as "not configured" and are
// never sent anywhere, returned by APIs, or logged.
const WATSONX_PLACEHOLDER = /^YOUR_[A-Z0-9_]*_HERE$/;
const readWatsonx = (value) => {
  const trimmed = String(value ?? "").trim();
  return trimmed === "" || WATSONX_PLACEHOLDER.test(trimmed) ? "" : trimmed;
};
const watsonxApiKey = readWatsonx(env.WATSONX_API_KEY);
const watsonxProjectId = readWatsonx(env.WATSONX_PROJECT_ID);
const watsonxUrl = readWatsonx(env.WATSONX_URL).replace(/\/+$/, "");
const watsonxModelId = readWatsonx(env.WATSONX_MODEL_ID) || "ibm/granite-3-8b-instruct";
const watsonxMissing = [
  watsonxApiKey ? null : "WATSONX_API_KEY",
  watsonxProjectId ? null : "WATSONX_PROJECT_ID",
  watsonxUrl ? null : "WATSONX_URL",
].filter(Boolean);

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
  aiIncidentBriefEnabled: env.FEATURE_AI_INCIDENT_BRIEF === "true",
  aiBriefProviderTimeoutMs: num(env.AI_BRIEF_PROVIDER_TIMEOUT_MS, 15000),
  aiBriefMaxPromptChars: num(env.AI_BRIEF_MAX_PROMPT_CHARS, 12000),
  aiBriefMaxResponseChars: num(env.AI_BRIEF_MAX_RESPONSE_CHARS, 8000),
  // Feature 2 — AI Incident Commander (disabled by default; no AI/tool orchestration
  // happens while disabled). Reuses the Feature 1 provider and prompt bounds.
  aiIncidentCommanderEnabled: env.FEATURE_AI_INCIDENT_COMMANDER === "true",
  // Centralized Granite configuration (Feature 2 preparation). `configured` is true
  // only when every required value is a real, non-placeholder value.
  watsonx: {
    apiKey: watsonxApiKey,
    projectId: watsonxProjectId,
    url: watsonxUrl,
    modelId: watsonxModelId,
    configured: watsonxMissing.length === 0,
    missing: watsonxMissing,
  },
};
