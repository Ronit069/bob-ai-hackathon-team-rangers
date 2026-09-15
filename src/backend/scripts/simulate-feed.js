// Demo freshness simulator (Phase 6 / finding F2) — posts current, in-policy sensor
// readings for one cold-chain shipment through the existing ingestion endpoint (12).
//
// Why: seeded sensor feeds end at the fixture anchor +6 h. After that the frozen
// staleness rule (no reading for >= 4 x interval) marks every cold shipment as
// sensor-failed, which buries the reporting scenarios in the demo UI. This script
// appends fresh readings to the running database so live screens show "reporting".
//
// Guarantees:
//   - Fixtures (data/seed/*) and ground truth are never regenerated or modified.
//   - No new endpoint, no server change: it only uses POST /api/sensor-readings.
//   - Temperatures stay inside the shipment's policy band, so no excursion is
//     created or changed by the simulated feed.
//
// Usage:
//   node scripts/simulate-feed.js [--shipment=S030] [--minutes=90] [--interval=15] [--base-url=http://localhost:3001]
//
// After the demo, run `npm run seed` to restore the exact fixture baseline.

const DEFAULTS = {
  shipment: "S030",
  minutes: 90,
  intervalMin: 15,
  baseUrl: "http://localhost:3001",
};

// Bounded HTTP: every request fails fast instead of hanging a demo session.
const REQUEST_TIMEOUT_MS = 10_000;

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  for (const arg of argv) {
    if (arg.startsWith("--shipment=")) args.shipment = arg.slice("--shipment=".length).toUpperCase();
    else if (arg.startsWith("--minutes=")) args.minutes = Number(arg.slice("--minutes=".length));
    else if (arg.startsWith("--interval=")) args.intervalMin = Number(arg.slice("--interval=".length));
    else if (arg.startsWith("--base-url=")) args.baseUrl = arg.slice("--base-url=".length);
    else throw new Error(`Unknown argument ${arg} (supported: --shipment, --minutes, --interval, --base-url)`);
  }
  if (!/^S\d{3}$/.test(args.shipment)) throw new Error("--shipment must match S###");
  if (!Number.isFinite(args.minutes) || args.minutes <= 0) throw new Error("--minutes must be > 0");
  if (!Number.isFinite(args.intervalMin) || args.intervalMin <= 0) throw new Error("--interval must be > 0 minutes");
  return args;
}

async function getJson(baseUrl, path) {
  const response = await fetch(new URL(path, baseUrl), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`GET ${path} -> HTTP ${response.status}${body?.error?.code ? ` (${body.error.code})` : ""}`);
  }
  return body;
}

const sensorFailureAlerts = (alerts, shipmentId) =>
  (alerts.data ?? []).filter((row) => row.type === "sensor_failure" && row.shipment_id === shipmentId).length;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { baseUrl, shipment: shipmentId } = args;

  await getJson(baseUrl, "/api/health"); // fail fast when the backend is not running
  const shipment = await getJson(baseUrl, `/api/shipments/${shipmentId}`);
  if (!shipment.is_cold_chain) throw new Error(`Shipment ${shipmentId} is not cold-chain — nothing to simulate`);

  const readings = await getJson(baseUrl, `/api/shipments/${shipmentId}/sensor-readings?order=desc`);
  if (!readings.policy) throw new Error(`Shipment ${shipmentId} has no temperature policy — cannot keep readings in band`);

  const sensorId = readings.sensor?.sensor_id ?? `SEN-${shipmentId.slice(1)}`;
  const lastAt = readings.sensor?.last_reading_at ? new Date(readings.sensor.last_reading_at).getTime() : null;
  const policy = { min: Number(readings.policy.min_c), max: Number(readings.policy.max_c) };

  const now = Date.now();
  const intervalMs = args.intervalMin * 60_000;
  const wanted = Math.max(1, Math.round((args.minutes * 60_000) / intervalMs));
  let start = now - (wanted - 1) * intervalMs;
  if (lastAt !== null && lastAt + intervalMs > start) start = lastAt + intervalMs;
  if (start > now) {
    const ageMin = lastAt === null ? "none" : Math.round((now - lastAt) / 60_000);
    throw new Error(`Feed for ${shipmentId} is already current (last reading: ${ageMin} min ago) — nothing to simulate`);
  }

  const count = Math.floor((now - start) / intervalMs) + 1;
  const mid = (policy.min + policy.max) / 2;
  const amplitude = Math.min(1, (policy.max - policy.min) / 4);
  const batch = [];
  for (let index = 0; index < count; index += 1) {
    batch.push({
      shipment_id: shipmentId,
      sensor_id: sensorId,
      timestamp: new Date(start + index * intervalMs).toISOString(),
      temperature_c: Math.round((mid + amplitude * Math.sin(index * 0.6)) * 10) / 10,
      humidity_pct: Math.round((45 + 5 * Math.cos(index * 0.4)) * 10) / 10,
      source: "simulated",
    });
  }

  const alertsBefore = sensorFailureAlerts(await getJson(baseUrl, "/api/alerts/coldchain"), shipmentId);

  const response = await fetch(new URL("/api/sensor-readings", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ readings: batch }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const ingested = await response.json().catch(() => null);
  if (response.status !== 201) {
    throw new Error(`POST /api/sensor-readings -> HTTP ${response.status}${ingested?.error?.code ? ` (${ingested.error.code})` : ""}`);
  }

  const after = await getJson(baseUrl, `/api/shipments/${shipmentId}/sensor-readings?order=desc`);
  const alertsAfter = sensorFailureAlerts(await getJson(baseUrl, "/api/alerts/coldchain"), shipmentId);

  console.log(`simulate-feed: ${shipmentId} via ${baseUrl}`);
  console.log(`  sensor:        ${sensorId}`);
  console.log(`  policy band:   ${policy.min}..${policy.max} C (readings stay in band — no excursions created)`);
  console.log(`  posted:        ${ingested.ingested} readings from ${batch[0].timestamp} to ${batch.at(-1).timestamp}`);
  console.log(`  rejected:      ${ingested.rejected.length}`);
  console.log(`  sensor status: ${readings.sensor?.status ?? "unknown"} -> ${after.sensor?.status ?? "unknown"}`);
  console.log(`  failure alerts for ${shipmentId}: ${alertsBefore} -> ${alertsAfter}`);
  console.log("  fixtures:      untouched (data/seed/* unchanged) — run `npm run seed` to restore the baseline");
}

main().catch((error) => {
  console.error(`simulate-feed: ${error.message}`);
  process.exit(1);
});
