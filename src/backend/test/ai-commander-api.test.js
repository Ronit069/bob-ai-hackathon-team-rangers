// AI Incident Commander — API tests (Feature 2).
// Exercises the route, feature flag, validation and clarification paths against the
// real test server; tool results come from the real frozen MCP layer (time-drift
// dependent values are never asserted here).
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/common/config.js";
import { setupTestDb, seedTestDatabase } from "../src/test-support/helpers.js";
import { startTestServer, api } from "../src/test-support/api.js";
import { COMMAND_STATUS } from "../src/ai/commander.service.js";
import { READ_ONLY_TOOLS } from "../src/ai/commander.tools.js";
import { ProviderError } from "../src/ai/provider.js";

const stub = {
  name: "stub",
  available: true,
  calls: 0,
  responder: null,
  async generate(args) {
    stub.calls += 1;
    return stub.responder(args);
  },
};

let pool;
let server;
let baseUrl;

before(async () => {
  pool = await setupTestDb();
  await seedTestDatabase(pool);
  server = await startTestServer(pool, { aiProvider: stub });
  baseUrl = server.baseUrl;
});

after(async () => {
  await server.close();
  await pool.end();
});

const command = (body) => api(baseUrl, "/api/ai/incident-command", { method: "POST", body });

const withEnabled = async (value, fn) => {
  const previous = config.aiIncidentCommanderEnabled;
  config.aiIncidentCommanderEnabled = value;
  try {
    return await fn();
  } finally {
    config.aiIncidentCommanderEnabled = previous;
  }
};

test("incident command route validates the request body", async () => {
  assert.equal((await command({})).status, 400);
  assert.equal((await command({ command: "ab" })).status, 400);
  assert.equal((await command({ command: "Investigate Mumbai", extra: true })).status, 400);
  assert.equal((await api(baseUrl, "/api/ai/incident-command", { method: "POST", rawBody: "{" })).status, 400);
});

test("disabled feature performs no AI request and no tool orchestration", async () => {
  stub.calls = 0;
  stub.responder = () => {
    throw new Error("provider must not be called when the commander is disabled");
  };
  const { status, body } = await withEnabled(false, () => command({ command: "Investigate the Mumbai port disruption." }));

  assert.equal(status, 200);
  assert.equal(body.status, COMMAND_STATUS.FEATURE_DISABLED);
  assert.equal(body.fallback_reason, "feature_disabled");
  assert.equal(stub.calls, 0);
  assert.deepEqual(body.tool_activity, []);
  assert.equal(body.explanation, null);
});

test("ambiguous command asks for clarification instead of guessing", async () => {
  stub.calls = 0;
  stub.responder = () => ({ text: "not a valid intent" });
  const { status, body } = await withEnabled(true, () => command({ command: "Fix the problem." }));

  assert.equal(status, 200);
  assert.equal(body.status, COMMAND_STATUS.CLARIFICATION_REQUIRED);
  assert.equal(body.clarification.reason, "ambiguous_command");
  assert.equal(body.tool_activity.length, 0);
});

test("unknown incident is reported with the recorded incidents, never fabricated", async () => {
  stub.calls = 0;
  stub.responder = () => ({ text: "not a valid intent" });
  const { status, body } = await withEnabled(true, () => command({ command: "Investigate Atlantis port." }));

  assert.equal(status, 200);
  assert.equal(body.status, COMMAND_STATUS.CLARIFICATION_REQUIRED);
  assert.equal(body.clarification.reason, "incident_not_found");
  assert.ok(body.clarification.message.includes("Atlantis"));
  assert.ok(body.clarification.options.some((option) => option.disruption_id === "D01"));
});

test("an invalid AI intent is rejected and falls back to the deterministic parser", async () => {
  stub.calls = 0;
  stub.responder = () => ({
    text: JSON.stringify({ intent: "HACK_THE_PLANET", requested_operations: ["DELETE_ALL"] }),
  });
  const { status, body } = await withEnabled(true, () => command({ command: "Investigate the Mumbai port disruption." }));

  assert.equal(status, 200);
  assert.equal(body.intent_source, "deterministic");
  assert.equal(body.fallback_reason, "invalid_ai_intent");
  assert.equal(body.status, COMMAND_STATUS.INVALID_AI_OUTPUT);
  assert.equal(JSON.stringify(body).includes("DELETE_ALL"), false);
  for (const entry of body.tool_activity) {
    if (entry.source === "mcp") assert.ok(READ_ONLY_TOOLS.includes(entry.tool));
  }
});

test("provider failure degrades to the deterministic response without crashing", async () => {
  stub.calls = 0;
  stub.responder = () => {
    throw new ProviderError("provider_timeout", "AI provider timed out");
  };
  const { status, body } = await withEnabled(true, () => command({ command: "Investigate the Mumbai port disruption." }));

  assert.equal(status, 200);
  assert.equal(body.status, COMMAND_STATUS.PROVIDER_UNAVAILABLE);
  assert.equal(body.fallback_reason, "provider_timeout");
  assert.equal(body.intent_source, "deterministic");
  assert.ok(body.explanation && body.explanation.summary.length > 0);
  assert.equal(body.proposal, null);
});

test("a validated AI intent with a grounded explanation returns VALIDATED_AI", async () => {
  stub.calls = 0;
  stub.responder = () => {
    if (stub.calls === 1) {
      return {
        text: JSON.stringify({
          intent: "GET_AVAILABLE_ASSETS",
          incident_id: null,
          incident_text: null,
          shipment_id: null,
          priority: null,
          requested_operations: ["GET_IDLE_ASSETS"],
        }),
      };
    }
    return {
      text: JSON.stringify({
        final: {
          summary: "Available fleet assets were retrieved from the fleet service.",
          whyItMatters: "Only deterministic tool output is reported.",
          evidenceUsed: ["command evidence"],
          recommendedNextStep: "No action has been taken.",
          limitations: ["No operational action has been executed."],
        },
      }),
    };
  };

  const { status, body } = await withEnabled(true, () => command({ command: "What refrigerated assets are available?" }));

  assert.equal(status, 200);
  assert.equal(body.intent_source, "ai");
  assert.equal(body.status, COMMAND_STATUS.VALIDATED_AI);
  assert.equal(body.grounding.ok, true);
  assert.equal(stub.calls, 2);
  assert.ok(body.tool_activity.some((entry) => entry.tool === "get_idle_assets"));
});

test("feature 1 remains available while the commander is disabled", async () => {
  stub.calls = 0;
  stub.responder = () => ({ text: "not json" });
  const previousBrief = config.aiIncidentBriefEnabled;
  config.aiIncidentBriefEnabled = false;
  try {
    const brief = await api(baseUrl, "/api/ai/incident-brief", { method: "POST", body: { shipment_id: "S039" } });
    assert.equal(brief.status, 200);
    assert.equal(brief.body.status, "DETERMINISTIC_FALLBACK");
    assert.equal(brief.body.brief_source, "deterministic");
  } finally {
    config.aiIncidentBriefEnabled = previousBrief;
  }
});
