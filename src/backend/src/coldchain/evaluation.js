// Excursion evaluation orchestration — runs the frozen detection service and
// persists results idempotently (approved design: detection runs on ingestion and
// on read; excursions are stored so alerts/review/risk can reference them).

import * as repo from "./repository.js";
import * as logisticsRepo from "../logistics/repository.js";
import { detectExcursions } from "./excursion.service.js";
import { nextEntityId } from "../common/ids.js";

// Phase 6 F5 write-throttle: process-local memo of the last evaluated input
// fingerprint per shipment. Detection is a pure function of (readings, policy,
// delivery cutoff, now) and only the first three affect persisted excursions, so
// re-running detection for unchanged inputs can never change stored rows — it only
// repeats writes. The key also folds in the persisted-excursion fingerprint so an
// external reset (e.g. `npm run seed` while the server runs) invalidates the memo.
// Skipping changes write frequency, never API responses.
const lastEvaluated = new Map();

export function evaluationFingerprint({ count, lastTimestamp, policy, excursionCount, excursionLastDetected }) {
  const last = lastTimestamp ? new Date(lastTimestamp).toISOString() : "none";
  const policyKey = policy ? `${policy.id}|${policy.version}` : "no-policy";
  const recreated = excursionLastDetected ? new Date(excursionLastDetected).toISOString() : "none";
  return `${count}|${last}|${policyKey}|${excursionCount ?? 0}|${recreated}`;
}

export async function refreshExcursions(db, { shipmentId = null, now = new Date() } = {}) {
  const policies = await repo.listTemperaturePolicies(db);
  const policyByCargo = new Map(policies.map((policy) => [policy.cargo_type, policy]));

  const shipments = shipmentId
    ? [await logisticsRepo.getShipment(db, shipmentId)].filter(Boolean)
    : await logisticsRepo.listShipments(db, { is_cold_chain: true, limit: 500 });

  const [fingerprints, excursionFingerprints] = await Promise.all([
    repo.listReadingFingerprints(db, shipmentId),
    repo.listExcursionFingerprints(db, shipmentId),
  ]);
  const fingerprintByShipment = new Map(fingerprints.map((row) => [row.shipment_id, row]));
  const excursionByShipment = new Map(excursionFingerprints.map((row) => [row.shipment_id, row]));

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const shipment of shipments) {
    if (!shipment.is_cold_chain) continue;
    const policy = policyByCargo.get(shipment.cargo_type) ?? null;
    const fingerprint = fingerprintByShipment.get(shipment.id) ?? { count: 0, last_timestamp: null };
    const excursions = excursionByShipment.get(shipment.id) ?? { count: 0, last_detected: null };
    const key = evaluationFingerprint({
      count: fingerprint.count,
      lastTimestamp: fingerprint.last_timestamp,
      policy,
      excursionCount: excursions.count,
      excursionLastDetected: excursions.last_detected,
    });
    if (lastEvaluated.get(shipment.id) === key) {
      skipped += 1;
      continue;
    }

    const readings = await repo.listReadingsByShipment(db, shipment.id);
    lastEvaluated.set(shipment.id, key);
    if (readings.length === 0) continue;

    const cutoff = shipment.actual_arrival ? new Date(shipment.actual_arrival) : null;
    const result = detectExcursions({ shipment, readings, policy, deliveryCutoff: cutoff, now });
    if (result.excursions.length === 0) continue;

    const existing = await repo.listExcursions(db, { shipment_id: shipment.id, limit: 500 });
    for (const excursion of result.excursions) {
      const match = existing.find(
        (row) => new Date(row.start_time).getTime() === new Date(excursion.start_time).getTime(),
      );
      if (match) {
        if (match.status === "closed") continue; // closed excursions are immutable
        await repo.updateExcursionEvaluation(db, match.id, excursion);
        updated += 1;
      } else {
        const id = await nextEntityId(db, "temperatureExcursion");
        await repo.insertTemperatureExcursion(db, { ...excursion, id, status: "open" });
        created += 1;
      }
    }
  }

  return { created, updated, skipped };
}

export function recommendedAction(severity) {
  switch (severity) {
    case "critical":
      return "Immediate review required";
    case "major":
      return "Review and consider intervention";
    case "unknown_review":
      return "Investigate data or policy gap — do not assume safe";
    case "warning":
      return "Monitor; no intervention required";
    default:
      return "Monitor";
  }
}

export function timeToDeliveryHours(shipment, now = new Date()) {
  if (!shipment?.deadline || shipment.status === "delivered") return null;
  return Math.round(((new Date(shipment.deadline).getTime() - now.getTime()) / 3_600_000) * 10) / 10;
}
