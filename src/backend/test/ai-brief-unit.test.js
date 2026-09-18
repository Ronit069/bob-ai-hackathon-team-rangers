import test from "node:test";
import assert from "node:assert/strict";
import { aiBriefSchema, parseAiBrief } from "../src/ai/brief.schema.js";
import { actionFamilies, validateBriefGrounding } from "../src/ai/grounding.js";
import { buildDeterministicBrief } from "../src/ai/fallback.js";
import { createHttpProvider, ProviderError } from "../src/ai/provider.js";

const sampleEvidence = (over = {}) => ({
  incident_id: "S039",
  incident_type: "shipment_risk",
  shipment: {
    id: "S039",
    status: "in_transit",
    cargo_type: "vaccine",
    is_cold_chain: true,
    cargo_value_usd: 520000,
    deadline: "2026-09-18T09:00:00Z",
  },
  risk: { disruption_risk: 0.856, coldchain_risk: 0.6, combined_score: 0.728, weights: { alpha: 0.5, beta: 0.5 } },
  disruption: {
    impact_status: "critical",
    impact_score: 0.856,
    timing_basis: "planned",
    confidence: "high",
    matched_disruptions: [
      { disruption_id: "D01", severity: 4, status: "critical", reason: "currently_in_affected_segment" },
    ],
  },
  coldchain: {
    severity: "major",
    worst_excursion: {
      id: "EX-0002",
      severity: "major",
      status: "open",
      peak_deviation_c: 2.4,
      duration_min: 45,
      data_quality: "complete",
      start_time: "2026-09-14T04:00:00Z",
      end_time: "2026-09-14T04:45:00Z",
    },
    excursion_count: 1,
    data_quality: "complete",
    confidence_level: "high",
    confidence_drivers: [],
    recommended_action: "Review and consider intervention",
    human_review_required: true,
    time_to_delivery_hours: 96,
  },
  recommendation: null,
  risk_factors: ["impact_status=critical", "combined_score=0.728"],
  triggering_signals: ["disruption:D01 severity=4 status=critical"],
  generated_at: "2026-09-14T09:00:00Z",
  ...over,
});

const validBrief = (over = {}) => ({
  summary: "Shipment S039 has a combined risk score of 0.728 with impact status critical.",
  whyItMatters: "Cold-chain severity is major and the recommended action is Review and consider intervention.",
  evidenceUsed: ["combined_score=0.728", "impact_status=critical", "coldchain_severity=major"],
  recommendedNextStep: "Review and consider intervention",
  limitations: ["This brief was generated deterministically from stored evidence."],
  ...over,
});

test("AI output schema accepts a complete grounded brief", () => {
  const parsed = aiBriefSchema.safeParse(validBrief());
  assert.equal(parsed.success, true);
});

test("AI output schema rejects missing fields", () => {
  const { summary, ...missing } = validBrief();
  const parsed = aiBriefSchema.safeParse(missing);
  assert.equal(parsed.success, false);
});

test("AI output schema rejects invalid types", () => {
  const parsed = aiBriefSchema.safeParse(validBrief({ evidenceUsed: "0.728" }));
  assert.equal(parsed.success, false);
});

test("AI output schema rejects oversized text", () => {
  const parsed = aiBriefSchema.safeParse(validBrief({ summary: "x".repeat(601) }));
  assert.equal(parsed.success, false);
});

test("AI output parser rejects oversized raw output", () => {
  const parsed = parseAiBrief(`{"summary":"${"x".repeat(200)}"}`, { maxChars: 100 });
  assert.equal(parsed.ok, false);
  assert.equal(parsed.reason, "response_too_large");
});

test("AI output parser rejects non-JSON output", () => {
  assert.equal(parseAiBrief("not json at all").reason, "no_json_object");
  assert.equal(parseAiBrief('{"summary": }').reason, "invalid_json");
  assert.equal(parseAiBrief("").reason, "empty_response");
});

test("grounding accepts briefs that quote evidence values", () => {
  const result = validateBriefGrounding(validBrief(), sampleEvidence());
  assert.equal(result.ok, true);
});

test("grounding rejects an incorrect risk score", () => {
  const result = validateBriefGrounding(
    validBrief({ summary: "Shipment S039 has a combined risk score of 0.9." }),
    sampleEvidence(),
  );
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((entry) => entry === "unsupported_number:0.9"));
});

test("grounding rejects an incorrect risk category", () => {
  const result = validateBriefGrounding(
    validBrief({ whyItMatters: "The incident is warning and requires monitoring." }),
    sampleEvidence(),
  );
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((entry) => entry.startsWith("category_mismatch:")));
});

test("grounding rejects unknown identifiers", () => {
  const result = validateBriefGrounding(
    validBrief({ summary: "Shipment S999 has a combined risk score of 0.728." }),
    sampleEvidence(),
  );
  assert.equal(result.ok, false);
  assert.ok(result.violations.includes("unknown_id:S999"));
});

test("grounding does not treat identifier digits as numeric claims", () => {
  const result = validateBriefGrounding(
    validBrief({
      summary: "Shipment S039 is affected by D01 with excursion EX-0002 and a combined risk score of 0.728.",
    }),
    sampleEvidence(),
  );
  assert.equal(result.ok, true);
});

test("grounding rejects a contradictory recommended next step", () => {
  const evidence = sampleEvidence({
    coldchain: {
      ...sampleEvidence().coldchain,
      severity: "normal",
      worst_excursion: null,
      excursion_count: 0,
      recommended_action: "Monitor; no intervention required",
      human_review_required: false,
    },
  });
  const result = validateBriefGrounding(
    validBrief({ recommendedNextStep: "Immediate review required" }),
    evidence,
  );
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((entry) => entry === "recommendation_conflict:review"));
});

test("grounding reports at most a bounded number of violations", () => {
  const result = validateBriefGrounding(
    validBrief({ summary: "S901 S902 S903 S904 S905 S906 S907 S908 S909 S910 S911 S912" }),
    sampleEvidence(),
  );
  assert.equal(result.ok, false);
  assert.ok(result.violations.length <= 10);
});

test("action families map deterministic actions", () => {
  assert.deepEqual([...actionFamilies("Immediate review required")], ["review"]);
  assert.deepEqual([...actionFamilies("Monitor; no intervention required")], ["monitor"]);
  assert.deepEqual([...actionFamilies("Review and consider intervention")].sort(), ["intervene", "review"]);
});

test("deterministic fallback passes the schema and grounding", () => {
  const evidence = sampleEvidence();
  const fallback = buildDeterministicBrief(evidence);
  assert.equal(aiBriefSchema.safeParse(fallback).success, true);
  assert.equal(validateBriefGrounding(fallback, evidence).ok, true);
  assert.equal(fallback.recommendedNextStep, evidence.coldchain.recommended_action);
});

test("HTTP provider forwards the prompt with bearer auth and never leaks the key in the body", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    return { ok: true, status: 200, json: async () => ({ answer: '{"summary":"ok"}', tool_calls: 2 }) };
  };
  const provider = createHttpProvider({
    apiUrl: "http://provider.local/",
    apiKey: "unit-secret-key",
    timeoutMs: 1000,
    fetchImpl,
  });

  assert.equal(provider.available, true);
  const result = await provider.generate({ system: "system rules", prompt: "evidence json" });
  assert.equal(result.text, '{"summary":"ok"}');
  assert.equal(result.tool_calls, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://provider.local/query");
  assert.equal(calls[0].options.headers.authorization, "Bearer unit-secret-key");
  assert.ok(!calls[0].options.body.includes("unit-secret-key"));
  assert.equal(JSON.parse(calls[0].options.body).system, "system rules");
});

test("HTTP provider classifies a timeout", async () => {
  const fetchImpl = async () => {
    const error = new Error("timed out");
    error.name = "TimeoutError";
    throw error;
  };
  const provider = createHttpProvider({ apiUrl: "http://provider.local", fetchImpl });
  await assert.rejects(
    () => provider.generate({ system: "s", prompt: "p" }),
    (error) => error instanceof ProviderError && error.reason === "provider_timeout",
  );
});

test("HTTP provider classifies an unreachable endpoint", async () => {
  const fetchImpl = async () => {
    throw new Error("connect ECONNREFUSED 127.0.0.1:1");
  };
  const provider = createHttpProvider({ apiUrl: "http://provider.local", apiKey: "", fetchImpl });
  await assert.rejects(
    () => provider.generate({ system: "s", prompt: "p" }),
    (error) => error instanceof ProviderError && error.reason === "provider_unreachable",
  );
});

test("HTTP provider classifies an authentication/configuration error status", async () => {
  const fetchImpl = async () => ({ ok: false, status: 401, json: async () => ({ error: "unauthorized" }) });
  const provider = createHttpProvider({ apiUrl: "http://provider.local", apiKey: "k", fetchImpl });
  await assert.rejects(
    () => provider.generate({ system: "s", prompt: "p" }),
    (error) => error instanceof ProviderError && error.reason === "provider_error" && error.details.status === 401,
  );
});

test("HTTP provider classifies an invalid response body", async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    json: async () => {
      throw new Error("not json");
    },
  });
  const provider = createHttpProvider({ apiUrl: "http://provider.local", fetchImpl });
  await assert.rejects(
    () => provider.generate({ system: "s", prompt: "p" }),
    (error) => error instanceof ProviderError && error.reason === "provider_invalid_response",
  );
});

test("HTTP provider classifies an empty answer", async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ answer: "   " }) });
  const provider = createHttpProvider({ apiUrl: "http://provider.local", fetchImpl });
  await assert.rejects(
    () => provider.generate({ system: "s", prompt: "p" }),
    (error) => error instanceof ProviderError && error.reason === "provider_empty_response",
  );
});

test("HTTP provider performs exactly one request and never retries", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error("down");
  };
  const provider = createHttpProvider({ apiUrl: "http://provider.local", fetchImpl });
  await assert.rejects(() => provider.generate({ system: "s", prompt: "p" }));
  assert.equal(calls, 1);
});
