// Verify seeded data against the generated ground truth using the real JS services.
// Usage: node scripts/verify-seed.js
// This is the bridge between Phase 2B (Python ground truth) and Phase 2A (JS services).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPool } from "../src/common/db.js";
import { config } from "../src/common/config.js";
import { matchShipments } from "../src/logistics/matching.service.js";
import { detectExcursions } from "../src/coldchain/excursion.service.js";
import * as logisticsRepo from "../src/logistics/repository.js";
import * as coldchainRepo from "../src/coldchain/repository.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.resolve(here, "../../..", "data", "seed");

async function main() {
  const groundTruth = JSON.parse(fs.readFileSync(path.join(seedDir, "ground_truth.json"), "utf8"));
  const now = new Date(groundTruth.meta.now);
  const pool = createPool(config.databaseUrl);

  try {
    const [shipments, routes, disruptions, allSegments, policies] = await Promise.all([
      logisticsRepo.listShipments(pool, { limit: 500 }),
      logisticsRepo.listRoutes(pool, { limit: 500 }),
      logisticsRepo.listDisruptions(pool, { limit: 500 }),
      logisticsRepo.listAllSegments(pool),
      coldchainRepo.listTemperaturePolicies(pool),
    ]);

    const segmentsByRoute = new Map();
    for (const segment of allSegments) {
      segmentsByRoute.set(segment.route_id, [...(segmentsByRoute.get(segment.route_id) ?? []), segment]);
    }

    // --- matching -----------------------------------------------------------
    const matching = matchShipments({ shipments, routes, segmentsByRoute, disruptions, now });
    const actualMatching = matching.map((row) => `${row.shipment.id}:${row.impact_status}`);
    const expectedMatching = groundTruth.matching.map((row) => `${row.shipment_id}:${row.impact_status}`);
    const matchingOk = JSON.stringify(actualMatching) === JSON.stringify(expectedMatching);

    // --- excursions ---------------------------------------------------------
    const policyByCargo = new Map(policies.map((policy) => [policy.cargo_type, policy]));
    const actualExcursions = [];
    for (const shipment of shipments) {
      if (!shipment.is_cold_chain) continue;
      const readings = await coldchainRepo.listReadingsByShipment(pool, shipment.id);
      const policy = policyByCargo.get(shipment.cargo_type) ?? null;
      const cutoff = shipment.actual_arrival ? new Date(shipment.actual_arrival) : null;
      const result = detectExcursions({ shipment, readings, policy, deliveryCutoff: cutoff, now });
      for (const excursion of result.excursions) {
        actualExcursions.push(`${excursion.shipment_id}:${excursion.severity}:${excursion.data_quality}:${excursion.duration_min}`);
      }
    }
    const expectedExcursions = groundTruth.excursions.map(
      (excursion) => `${excursion.shipment_id}:${excursion.severity}:${excursion.data_quality}:${excursion.duration_min}`,
    );
    const excursionsOk = JSON.stringify(actualExcursions.sort()) === JSON.stringify(expectedExcursions.sort());

    console.log(`matching:   ${matchingOk ? "PASS" : "FAIL"} (expected ${expectedMatching.length}, got ${actualMatching.length})`);
    if (!matchingOk) {
      console.log("  expected:", expectedMatching.join(", "));
      console.log("  actual:  ", actualMatching.join(", "));
    }
    console.log(`excursions: ${excursionsOk ? "PASS" : "FAIL"} (expected ${expectedExcursions.length}, got ${actualExcursions.length})`);
    if (!excursionsOk) {
      console.log("  expected:", expectedExcursions.sort().join(", "));
      console.log("  actual:  ", actualExcursions.sort().join(", "));
    }

    process.exitCode = matchingOk && excursionsOk ? 0 : 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
