// End-to-end MCP server test — spawns the stdio server and speaks JSON-RPC to it,
// proving the full Bob -> MCP -> backend service -> structured output path.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setupTestDb, seedTestDatabase, loadSeedJson } from "../src/test-support/helpers.js";
import { startTestServer } from "../src/test-support/api.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const mcpDir = path.resolve(here, "../../mcp-server");

let pool;
let server;
let baseUrl;
let groundTruth;
let client;

function startMcpClient(backendUrl) {
  const child = spawn(process.execPath, ["src/index.js"], {
    cwd: mcpDir,
    env: { ...process.env, BACKEND_URL: backendUrl },
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
      }, 10_000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        resolve(message);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });

  const notify = (method, params) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  };

  return { child, request, notify, stderrChunks };
}

before(async () => {
  pool = await setupTestDb();
  await seedTestDatabase(pool);
  ({ groundTruth } = loadSeedJson());
  server = await startTestServer(pool);
  baseUrl = server.baseUrl;
  client = startMcpClient(baseUrl);
});

after(async () => {
  client.child.kill();
  await server.close();
  await pool.end();
});

test("MCP handshake and tools/list expose exactly 11 frozen tools", async () => {
  const initialized = await client.request("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "chainsentinel-test", version: "1.0.0" },
  });
  assert.ok(initialized.result?.serverInfo);
  client.notify("notifications/initialized", {});

  const listed = await client.request("tools/list", {});
  const names = listed.result.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, [
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
  ]);
});

test("tools/call reaches the backend and returns structured JSON", async () => {
  const call = await client.request("tools/call", {
    name: "get_active_disruptions",
    arguments: {},
  });
  assert.equal(call.result.isError, false);
  const payload = JSON.parse(call.result.content[0].text);
  assert.equal(payload.ok, true);
  assert.equal(payload.tool, "get_active_disruptions");
  assert.ok(payload.data.some((row) => row.id === "D01"));
});

test("tools/call matches the ground-truth oracle end to end", async () => {
  const call = await client.request("tools/call", {
    name: "get_combined_risk",
    arguments: { shipment_id: "S039" },
  });
  const payload = JSON.parse(call.result.content[0].text);
  assert.equal(payload.ok, true);
  assert.equal(payload.combined_score, groundTruth.risk.S039.combined_score);
  assert.equal(payload.coldchain_risk, groundTruth.risk.S039.coldchain_risk);
});

test("tools/call surfaces validation and not-found errors as structured results", async () => {
  // Invalid arguments are rejected at the MCP boundary with a structured JSON-RPC error.
  const invalid = await client.request("tools/call", {
    name: "get_affected_shipments",
    arguments: { disruption_id: "nope" },
  });
  assert.ok(invalid.error, "expected a JSON-RPC error for invalid arguments");
  assert.equal(invalid.error.code, -32602);
  assert.match(invalid.error.message, /Invalid arguments for tool get_affected_shipments/);

  // Backend errors pass through as structured tool results (isError = true).
  const missing = await client.request("tools/call", {
    name: "get_combined_risk",
    arguments: { shipment_id: "S999" },
  });
  const missingPayload = JSON.parse(missing.result.content[0].text);
  assert.equal(missingPayload.ok, false);
  assert.equal(missingPayload.error.code, "NOT_FOUND");
  assert.equal(missing.result.isError, true);
});
