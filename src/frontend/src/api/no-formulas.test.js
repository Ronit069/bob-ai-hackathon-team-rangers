// Static safety scan: the frontend must not contain scoring formulas, environment
// access or credentials. All scores, severities and reasons come from the backend.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, "..");

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(full);
    if (entry.name.endsWith(".test.js") || entry.name.endsWith(".test.jsx")) return [];
    return entry.name.endsWith(".js") || entry.name.endsWith(".jsx") ? [full] : [];
  });
}

const FORBIDDEN = [
  { pattern: /SEVERITY_WEIGHTS/, name: "severity-weight table" },
  { pattern: /0\.35|0\.45/, name: "scoring weight constant" },
  { pattern: /impact_score\s*=[^=]/, name: "impact-score assignment" },
  { pattern: /combined_score\s*=[^=]/, name: "combined-score assignment" },
  { pattern: /duration_min\s*=[^=]/, name: "duration computation" },
  { pattern: /process\.env/, name: "environment access (frontend has no env)" },
  { pattern: /API_KEY|SECRET|ACCESS_TOKEN/, name: "credential reference" },
];

const files = walk(srcRoot);

describe("frontend safety scan", () => {
  it("scans the frontend source tree", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const rule of FORBIDDEN) {
    it(`contains no ${rule.name}`, () => {
      const offenders = files.filter((file) => rule.pattern.test(fs.readFileSync(file, "utf8")));
      expect(offenders).toEqual([]);
    });
  }
});
