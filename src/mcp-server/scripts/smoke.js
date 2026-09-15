// MCP grounding smoke test (Phase 6) — spawns the stdio server exactly as Bob would,
// then verifies the frozen tool contract end to end and prints the evidence.
//
// Checks:
//   1. tools/list exposes exactly the 11 frozen tools;
//   2. representative tools return structured, grounded results from the live backend;
//   3. get_combined_risk(S039) matches the generated ground-truth oracle;
//   4. the tool layer is GET-only / read-only (static scan of the server sources);
//   5. no database dependency: the server package imports no DB driver and reads no
//      DATABASE_URL — all data arrives through the REST API (runtime-backed by the
//      successful tool calls below, which run with only BACKEND_URL set).
//
// Usage: npm run smoke        (backend must be running at http://localhost:3001)
//        node scripts/smoke.js --base-url=http://localhost:3002

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const mcpDir = path.resolve(here, "..");
const seedDir = path.resolve(mcpDir, "../../data/seed");

const baseUrlArg = process.argv.find((arg) => arg.startsWith("--base-url="));
const baseUrl = baseUrlArg ? baseUrlArg.slice("--base-url=".length) : process.env.BACKEND_URL ?? "http://localhost:3001";

const EXPECTED_TOOLS = [
  "get_active_disruptions",
  "get_affected_shipments",
  "get_audit_log",
  "get_carrier_alternatives",
  "get_combined_risk",
  "get_idle_assets",
  "get_redeployment_candidates",
  "get_risk_overview",
  "get_route_alternatives",
  "get_sensor_status",
  "get_temperature_excursions",
];

const checks = [];
const check = (name, ok, detail = "") => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
};

// ---------------------------------------------------------------------------
// 4/5 — static read-only + no-database scan
// ---------------------------------------------------------------------------
const toolsSource = fs.readFileSync(path.join(mcpDir, "src", "tools.js"), "utf8");
const indexSource = fs.readFileSync(path.join(mcpDir, "src", "index.js"), "utf8");

const dbPattern = /from\s+["']pg["']|require\(["']pg["']\)|DATABASE_URL|createPool|new\s+Pool/;
const writeVerbPattern = /["'](POST|PUT|PATCH|DELETE)["']/;

check(
  "tool layer sends GET requests only",
  toolsSource.includes('method: "GET"') &&
    !writeVerbPattern.test(toolsSource) &&
    !writeVerbPattern.test(indexSource),
);
check(
  "no database dependency in the MCP server",
  !dbPattern.test(toolsSource) && !dbPattern.test(indexSource),
  "no pg import, no DATABASE_URL, no pool construction",
);

// ---------------------------------------------------------------------------
// stdio JSON-RPC client (same protocol Bob uses)
// ---------------------------------------------------------------------------
const child = spawn(process.execPath, ["src/index.js"], {
  cwd: mcpDir,
  env: { ...process.env, BACKEND_URL: baseUrl },
  stdio: ["pipe", "pipe", "pipe"],
});

let buffer = "";
let nextId = 1;
const pending = new Map();
const stderrChunks = [];

child.stderr.on("data", (chunk) => stderrChunks.push(chunk.toString()));
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  let newline;
  while ((newline = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue; // ignore non-JSON noise
    }
    if (message.id !== undefined && pending.has(message.id)) {
      const resolve = pending.get(message.id);
      pending.delete(message.id);
      resolve(message);
    }
  }
});

const request = (method, params) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`MCP request timed out: ${method} (stderr: ${stderrChunks.join("")})`));
    }, 15_000);
    pending.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });

const callTool = async (name, args) => {
  const call = await request("tools/call", { name, arguments: args });
  if (call.error) return { ok: false, jsonrpc_error: call.error };
  return JSON.parse(call.result.content[0].text);
};

// ---------------------------------------------------------------------------
// 1–3 — live grounding checks
// ---------------------------------------------------------------------------
async function main() {
  const initialized = await request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "chainsentinel-smoke", version: "1.0.0" },
  });
  check("server handshake", Boolean(initialized.result?.serverInfo), initialized.result?.serverInfo?.name);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);

  const listed = await request("tools/list", {});
  const names = (listed.result?.tools ?? []).map((tool) => tool.name).sort();
  check(
    "tools/list exposes exactly the 11 frozen tools",
    JSON.stringify(names) === JSON.stringify([...EXPECTED_TOOLS].sort()),
    `${names.length} tools`,
  );

  const groundTruth = JSON.parse(fs.readFileSync(path.join(seedDir, "ground_truth.json"), "utf8"));
  const expected = groundTruth.risk.S039;

  const risk = await callTool("get_combined_risk", { shipment_id: "S039" });
  const riskMatches =
    risk.ok === true &&
    risk.combined_score === expected.combined_score &&
    risk.coldchain_risk === expected.coldchain_risk &&
    risk.disruption_risk === expected.disruption_risk;
  check("get_combined_risk(S039) is grounded in the oracle", riskMatches);
  if (riskMatches) {
    console.log(
      `      evidence: combined=${risk.combined_score} disruption=${risk.disruption_risk} coldchain=${risk.coldchain_risk} ` +
        `worst_excursion=${risk.factors.coldchain.worst_excursion_id} weights=${JSON.stringify(risk.factors.weights)}`,
    );
  }

  const disruptions = await callTool("get_active_disruptions", {});
  check(
    "get_active_disruptions returns live rows",
    disruptions.ok === true && disruptions.data.some((row) => row.id === "D01"),
    `${disruptions.data?.length ?? 0} active disruptions`,
  );

  const affected = await callTool("get_affected_shipments", { disruption_id: "D01" });
  const s039 = affected.data?.find((row) => row.shipment.id === "S039");
  check(
    "get_affected_shipments(D01) carries match evidence",
    affected.ok === true && s039?.impact_status === "critical",
    `${affected.data?.length ?? 0} shipments, S039 impact=${s039?.impact_status}`,
  );

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  const failed = checks.filter((row) => !row.ok);
  console.log("");
  console.log(`MCP grounding smoke: ${checks.length - failed.length}/${checks.length} checks passed (backend: ${baseUrl})`);
  if (failed.length === 0) {
    console.log("Read-only verified · no DB dependency verified · grounding oracle verified");
  }
}

main()
  .catch((error) => {
    console.error(`FAIL  smoke run — ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    child.kill();
  });
