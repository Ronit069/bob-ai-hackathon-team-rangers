// Pre-seed fixture validator (fast JSON-level referential checks).
// Full contract validation (enums, ranges, ground-truth consistency) is implemented in Python:
//   src/data-generator/validate.py
// Usage: node scripts/validate.js [--dir=../../data/seed]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkFixtures } from "./seed.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultDir = path.resolve(here, "../../..", "data", "seed");

const args = process.argv.slice(2);
const dirArg = args.find((arg) => arg.startsWith("--dir="));
const directory = dirArg ? path.resolve(dirArg.slice("--dir=".length)) : defaultDir;

try {
  const logistics = JSON.parse(fs.readFileSync(path.join(directory, "logistics.json"), "utf8"));
  const coldchain = JSON.parse(fs.readFileSync(path.join(directory, "coldchain.json"), "utf8"));
  const groundTruth = JSON.parse(fs.readFileSync(path.join(directory, "ground_truth.json"), "utf8"));

  const errors = checkFixtures(logistics, coldchain);
  if (!groundTruth.scenarios || Object.keys(groundTruth.scenarios).length === 0) {
    errors.push("ground_truth.json has no scenarios");
  }
  if (!groundTruth.matching || groundTruth.matching.length === 0) {
    errors.push("ground_truth.json has no matching rows");
  }

  if (errors.length > 0) {
    console.error("Validation failed:");
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(`pre-seed validation: PASS (${directory})`);
  console.log(`  shipments=${logistics.shipments.length} readings=${coldchain.sensor_readings.length} scenarios=${Object.keys(groundTruth.scenarios).length}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
