import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/common/config.js";
import { setupTestDb, seedTestDatabase } from "../src/test-support/helpers.js";
import { startTestServer, api } from "../src/test-support/api.js";
import { buildIncidentEvidence } from "../src/ai/evidence.js";
import { buildDeterministicBrief } from "../src/ai/fallback.js";
import { validateBriefGrounding } from "../src/ai/grounding.js";
import { aiBriefSchema } from "../src/ai/brief.schema.js";
import { BRIEF_STATUS, generateIncidentBrief } from "../src/ai/service.js";
import { ProviderError } from "../src/ai/provider.js";

const ANCHOR = new Date("2026-09-14T09:00:00Z");

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

const groundedText = (evidence) =>
  JSON.stringify({
    summary: `Shipment ${evidence.incident_id} has a combined risk score of ${evidence.risk.combined_score} with impact status ${evidence.disruption.impact_status}.`,
    whyItMatters: `Cold-chain severity is ${evidence.coldchain.severity} and the recommended action is ${evidence.coldchain.recommended_action}.`,
    evidenceUsed: [
      `combined_score=${evidence.risk.combined_score}`,
      `impact_status=${evidence.disruption.impact_status}`,
    ],
    recommendedNextStep: evidence.coldchain.recommended_action,
    limitations: ["Grounded in stored evidence."],
  });

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

const brief = (body) => api(baseUrl, "/api/ai/incident-brief", { method: "POST", body });

test("evidence builder is deterministic, bounded and matches the frozen oracle", async () => {
  const first = await buildIncidentEvidence(pool, "S039", { now: ANCHOR });
  const second = await buildIncidentEvidence(pool, "S039", { now: ANCHOR });
  assert.deepEqual(first, second);
  assert.deepEqual(
    Object.keys(first).sort(),
    [
      "coldchain",
      "disruption",
      "generated_at",
      "incident_id",
      "incident_type",
      "recommendation",
      "risk",
      "risk_factors",
      "shipment",
      "triggering_signals",
    ].sort(),
  );
  assert.equal(first.risk.disruption_risk, 0.856);
  assert.equal(first.risk.coldchain_risk, 0.6);
  assert.equal(first.risk.combined_score, 0.728);
  assert.equal(first.disruption.impact_status, "critical");
  assert.equal(first.coldchain.severity, "major");
  assert.equal(first.coldchain.worst_excursion.peak_deviation_c, 2.4);
  assert.equal(first.coldchain.worst_excursion.duration_min, 45);
  assert.ok(JSON.stringify(first).length < 6000);

  const secrets = [process.env.BOB_API_KEY, process.env.DATABASE_URL, process.env.TEST_DATABASE_URL].filter(Boolean);
  for (const secret of secrets) {
    assert.ok(!JSON.stringify(first).includes(secret));
  }
});

test("evidence builder returns null for an unknown shipment", async () => {
  assert.equal(await buildIncidentEvidence(pool, "S999", { now: ANCHOR }), null);
});

test("deterministic fallback for the real fixture passes schema and grounding", async () => {
  const evidence = await buildIncidentEvidence(pool, "S039", { now: ANCHOR });
  const fallback = buildDeterministicBrief(evidence);
  assert.equal(aiBriefSchema.safeParse(fallback).success, true);
  assert.equal(validateBriefGrounding(fallback, evidence).ok, true);
});

test("disabled feature returns the deterministic fallback and never calls the provider", async () => {
  stub.calls = 0;
  stub.responder = () => {
    throw new Error("provider must not be called when the feature is disabled");
  };
  const { status, body } = await brief({ shipment_id: "S039" });
  assert.equal(status, 200);
  assert.equal(body.status, BRIEF_STATUS.DETERMINISTIC_FALLBACK);
  assert.equal(body.brief_source, "deterministic");
  assert.equal(body.fallback_reason, "feature_disabled");
  assert.equal(body.provider_name, null);
  assert.equal(stub.calls, 0);
  assert.equal(validateBriefGrounding(body.brief, body.evidence).ok, true);
});

test("enabled feature with a grounded provider response returns validated AI output", async () => {
  stub.calls = 0;
  stub.responder = ({ prompt }) => ({ text: groundedText(JSON.parse(prompt)) });
  const previous = config.aiIncidentBriefEnabled;
  config.aiIncidentBriefEnabled = true;
  try {
    const { status, body } = await brief({ shipment_id: "S039" });
    assert.equal(status, 200);
    assert.equal(body.status, BRIEF_STATUS.VALIDATED_AI);
    assert.equal(body.brief_source, "ai");
    assert.equal(body.fallback_reason, null);
    assert.equal(body.provider_name, "stub");
    assert.equal(body.grounding.ok, true);
    assert.equal(stub.calls, 1);
    assert.equal(body.brief.recommendedNextStep, body.evidence.coldchain.recommended_action);
  } finally {
    config.aiIncidentBriefEnabled = previous;
  }
});

test("provider timeout returns PROVIDER_UNAVAILABLE with the deterministic fallback", async () => {
  stub.responder = () => {
    throw new ProviderError("provider_timeout", "AI provider timed out");
  };
  const result = await generateIncidentBrief({
    db: pool,
    shipmentId: "S039",
    now: ANCHOR,
    provider: stub,
    enabled: true,
  });
  assert.equal(result.status, BRIEF_STATUS.PROVIDER_UNAVAILABLE);
  assert.equal(result.fallback_reason, "provider_timeout");
  assert.equal(result.brief_source, "deterministic");
  assert.equal(validateBriefGrounding(result.brief, result.evidence).ok, true);
});

test("missing provider configuration returns PROVIDER_UNAVAILABLE", async () => {
  const result = await generateIncidentBrief({
    db: pool,
    shipmentId: "S039",
    now: ANCHOR,
    provider: null,
    enabled: true,
  });
  assert.equal(result.status, BRIEF_STATUS.PROVIDER_UNAVAILABLE);
  assert.equal(result.fallback_reason, "provider_not_configured");
});

test("invalid AI output returns INVALID_AI_OUTPUT with the deterministic fallback", async () => {
  stub.responder = () => ({ text: "this is not json" });
  const result = await generateIncidentBrief({
    db: pool,
    shipmentId: "S039",
    now: ANCHOR,
    provider: stub,
    enabled: true,
  });
  assert.equal(result.status, BRIEF_STATUS.INVALID_AI_OUTPUT);
  assert.equal(result.fallback_reason, "no_json_object");
  assert.equal(result.brief_source, "deterministic");
});

test("oversized AI output is rejected before grounding", async () => {
  stub.responder = () => ({ text: "x".repeat(200) });
  const result = await generateIncidentBrief({
    db: pool,
    shipmentId: "S039",
    now: ANCHOR,
    provider: stub,
    enabled: true,
    maxResponseChars: 100,
  });
  assert.equal(result.status, BRIEF_STATUS.INVALID_AI_OUTPUT);
  assert.equal(result.fallback_reason, "response_too_large");
});

test("grounding failure rejects the AI output and reports violations", async () => {
  stub.responder = () => ({
    text: JSON.stringify({
      summary: "Shipment S999 has a combined risk score of 0.9.",
      whyItMatters: "Unsupported.",
      evidenceUsed: ["combined_score=0.9"],
      recommendedNextStep: "Immediate review required",
      limitations: [],
    }),
  });
  const result = await generateIncidentBrief({
    db: pool,
    shipmentId: "S039",
    now: ANCHOR,
    provider: stub,
    enabled: true,
  });
  assert.equal(result.status, BRIEF_STATUS.GROUNDING_FAILED);
  assert.equal(result.fallback_reason, "grounding_violations");
  assert.equal(result.grounding.ok, false);
  assert.ok(result.grounding.violations.length > 0);
  assert.equal(result.brief_source, "deterministic");
  assert.equal(result.brief.recommendedNextStep, result.evidence.coldchain.recommended_action);
});

test("brief endpoint validates input and unknown shipments", async () => {
  assert.equal((await brief({})).status, 400);
  assert.equal((await brief({ shipment_id: "S99" })).status, 400);
  assert.equal((await brief({ shipment_id: "D01" })).status, 400);

  const missing = await brief({ shipment_id: "S999" });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, "NOT_FOUND");

  const malformed = await api(baseUrl, "/api/ai/incident-brief", { method: "POST", rawBody: "{" });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error.code, "VALIDATION_ERROR");
});

test("brief endpoint follows existing error conventions and requires no auth header", async () => {
  const { status, body } = await brief({ shipment_id: "S001" });
  assert.equal(status, 200);
  assert.deepEqual(
    Object.keys(body).sort(),
    [
      "brief",
      "brief_source",
      "evidence",
      "fallback_reason",
      "generated_at",
      "grounding",
      "provider_name",
      "shipment_id",
      "status",
    ].sort(),
  );
});

test("brief endpoint never mutates risk, recommendation or audit rows", async () => {
  const count = async (table) => Number((await pool.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count);
  const before = {
    risk: await count("risk_assessment"),
    recommendation: await count("recommendation"),
    audit: await count("audit_record"),
    excursion: await count("temperature_excursion"),
  };
  const { status } = await brief({ shipment_id: "S039" });
  assert.equal(status, 200);
  assert.equal(await count("risk_assessment"), before.risk);
  assert.equal(await count("recommendation"), before.recommendation);
  assert.equal(await count("audit_record"), before.audit);
  assert.equal(await count("temperature_excursion"), before.excursion);
});
