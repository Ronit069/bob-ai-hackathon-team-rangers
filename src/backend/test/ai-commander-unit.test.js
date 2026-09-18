// AI Incident Commander — unit tests (Feature 2): schemas, deterministic intent,
// incident matching, priority selection, allowlist and deterministic explanation grounding.
import test from "node:test";
import assert from "node:assert/strict";
import { parseCommandIntent, commandIntentSchema } from "../src/ai/commander.schema.js";
import {
  extractDisruptionId,
  extractPriority,
  extractShipmentId,
  matchDisruptionsByText,
  parseDeterministicIntent,
  selectPriorityShipment,
} from "../src/ai/commander.intent.js";
import {
  OPERATION_TOOL,
  READ_ONLY_TOOLS,
  buildToolInput,
  isAllowedOperation,
  planForIntent,
  runOperation,
} from "../src/ai/commander.tools.js";
import { buildDeterministicCommandExplanation } from "../src/ai/commander.explanation.js";
import { validateBriefGrounding } from "../src/ai/grounding.js";

const DISRUPTIONS = [
  { id: "D01", type: "port_strike", region_code: "IN-WEST-COAST", severity: 4, status: "active", description: "Dock workers strike at Mumbai port; berth operations suspended." },
  { id: "D02", type: "weather", region_code: "US-WEST-COAST", severity: 3, status: "active", description: "Storm system disrupting Los Angeles port approaches; expected duration unknown." },
];

const EVIDENCE = {
  command: "Investigate the Mumbai port disruption and prioritize cold-chain shipments.",
  workflow: "AI Incident Commander",
  intent: { intent: "INVESTIGATE_INCIDENT", priority: "COLD_CHAIN", incident_id: "D01", shipment_id: null },
  incident: { disruption_id: "D01", type: "port_strike", region_code: "IN-WEST-COAST", severity: 4, status: "active", description: "Dock workers strike at Mumbai port; berth operations suspended." },
  known_incidents: [{ disruption_id: "D01", type: "port_strike", region_code: "IN-WEST-COAST", severity: 4, status: "active", description: "Dock workers strike at Mumbai port; berth operations suspended." }],
  incident_summary: { affected_count: 3, critical_count: 1, cold_chain_count: 1, available_assets_count: 3, refrigerated_assets_count: 3 },
  affected_shipments: [
    { id: "S039", cargo_type: "vaccine", is_cold_chain: true, status: "in_transit", impact_status: "critical", impact_score: 0.856, match_reason: "route R001 segment SEG-001 matches disruption D01", matched_disruptions: ["D01"] },
  ],
  priority_shipment: { shipment_id: "S039", cargo_type: "vaccine", is_cold_chain: true, status: "in_transit", impact_status: "critical", impact_score: 0.856, combined_score: 0.728, disruption_risk: 0.856, coldchain_risk: 0.6, source: "chain_sentinel_risk_engine" },
  coldchain: {
    severity: "major",
    recommended_action: "Review and consider intervention",
    human_review_required: true,
    worst_excursion: { id: "EX-0002", severity: "major", status: "open", peak_deviation_c: 2.4, duration_min: 45, data_quality: "complete" },
  },
  risk_overview: [],
  assets: [],
  recommendations: [],
  recommendation: null,
  proposal: null,
  tool_activity: [],
  missing_tools: [],
  partial: false,
  generated_at: "2026-09-14T09:00:00Z",
};

// ---------------------------------------------------------------------------
// Intent schema
// ---------------------------------------------------------------------------
test("command intent schema accepts a valid structured intent", () => {
  const parsed = commandIntentSchema.safeParse({
    intent: "INVESTIGATE_INCIDENT",
    incident_id: "D01",
    incident_text: null,
    shipment_id: null,
    priority: "COLD_CHAIN",
    requested_operations: ["GET_ACTIVE_DISRUPTIONS", "GET_AFFECTED_SHIPMENTS"],
  });
  assert.equal(parsed.success, true);
});

test("command intent parser rejects unknown intents, operations and extra fields", () => {
  assert.equal(parseCommandIntent('{"intent":"EXECUTE_PLAN","requested_operations":["GET_ACTIVE_DISRUPTIONS"]}').ok, false);
  assert.equal(parseCommandIntent('{"intent":"INVESTIGATE_INCIDENT","requested_operations":["DELETE_DATABASE"]}').ok, false);
  assert.equal(parseCommandIntent('{"intent":"INVESTIGATE_INCIDENT","requested_operations":["GET_ACTIVE_DISRUPTIONS"],"tool":"delete_all"}').ok, false);
  assert.equal(parseCommandIntent("not json").reason, "no_json_object");
});

test("command intent parser extracts a JSON object from model chatter", () => {
  const parsed = parseCommandIntent(
    'Here is the intent:\n{"intent":"GET_RISK","requested_operations":["GET_COMBINED_RISK"],"shipment_id":"S039"}\nDone.',
  );
  assert.equal(parsed.ok, true);
  assert.equal(parsed.data.intent, "GET_RISK");
});

// ---------------------------------------------------------------------------
// Deterministic intent fallback
// ---------------------------------------------------------------------------
test("deterministic parser maps the demo commands", () => {
  const investigate = parseDeterministicIntent("Investigate the Mumbai port disruption and prioritize cold-chain shipments.");
  assert.equal(investigate.intent, "INVESTIGATE_INCIDENT");
  assert.equal(investigate.priority, "COLD_CHAIN");
  assert.equal(investigate.shipment_id, null);

  const risk = parseDeterministicIntent("Find the highest-risk cold-chain shipment affected by Mumbai port.");
  assert.equal(risk.intent, "GET_RISK");
  assert.equal(risk.priority, "COLD_CHAIN");

  const assets = parseDeterministicIntent("What refrigerated assets are available?");
  assert.equal(assets.intent, "GET_AVAILABLE_ASSETS");

  const recommendations = parseDeterministicIntent("What recovery options does the system recommend?");
  assert.equal(recommendations.intent, "GET_RECOMMENDATIONS");

  const proposal = parseDeterministicIntent("Prepare a recovery proposal for S039.");
  assert.equal(proposal.intent, "CREATE_PROPOSAL");
  assert.equal(proposal.shipment_id, "S039");

  assert.equal(parseDeterministicIntent("Fix the problem."), null);
});

test("id and priority extractors are strict about formats", () => {
  assert.equal(extractShipmentId("prepare a proposal for s039 please"), "S039");
  assert.equal(extractShipmentId("no id here"), null);
  assert.equal(extractDisruptionId("investigate d01"), "D01");
  assert.equal(extractDisruptionId("investigate D001"), null);
  assert.equal(extractPriority("cold-chain priority"), "COLD_CHAIN");
  assert.equal(extractPriority("highest risk shipment"), "CRITICAL");
  assert.equal(extractPriority("check the weather"), null);
});

// ---------------------------------------------------------------------------
// Incident matching (pure)
// ---------------------------------------------------------------------------
test("incident text matching resolves Mumbai and never invents Atlantis", () => {
  const mumbai = matchDisruptionsByText(DISRUPTIONS, "Investigate the Mumbai port disruption.");
  assert.equal(mumbai.incident?.id, "D01");
  assert.equal(mumbai.ambiguous, false);

  const atlantis = matchDisruptionsByText(DISRUPTIONS, "Investigate Atlantis port.");
  assert.equal(atlantis.incident, null);
  assert.equal(atlantis.ambiguous, false);

  const empty = matchDisruptionsByText(DISRUPTIONS, "the port");
  assert.equal(empty.incident, null);
});

test("incident text matching reports ambiguity instead of guessing", () => {
  const rows = [
    { id: "D01", description: "Mumbai dock strike", type: "port_strike", region_code: "IN-WEST-COAST" },
    { id: "D02", description: "Mumbai weather event", type: "weather", region_code: "IN-WEST-COAST" },
  ];
  const result = matchDisruptionsByText(rows, "investigate mumbai");
  assert.equal(result.incident, null);
  assert.equal(result.ambiguous, true);
  assert.equal(result.candidates.length, 2);
});

// ---------------------------------------------------------------------------
// Priority selection (pure)
// ---------------------------------------------------------------------------
test("priority selection prefers combined score and honors COLD_CHAIN", () => {
  const affected = [
    { id: "S012", is_cold_chain: false, impact_score: 0.9 },
    { id: "S039", is_cold_chain: true, impact_score: 0.856 },
    { id: "S030", is_cold_chain: true, impact_score: 0.7 },
  ];
  const overview = [
    { shipment_id: "S012", combined_score: 0.9 },
    { shipment_id: "S039", combined_score: 0.728 },
    { shipment_id: "S030", combined_score: 0.5 },
  ];

  assert.equal(selectPriorityShipment({ affected, riskOverview: overview }).id, "S012");
  assert.equal(selectPriorityShipment({ affected, riskOverview: overview, priority: "COLD_CHAIN" }).id, "S039");
  assert.equal(selectPriorityShipment({ affected: [], riskOverview: overview }), null);
});

// ---------------------------------------------------------------------------
// Allowlist and plans
// ---------------------------------------------------------------------------
test("tool allowlist only contains frozen read-only MCP tools plus the proposal operation", () => {
  assert.equal(READ_ONLY_TOOLS.length, 11);
  assert.deepEqual(
    READ_ONLY_TOOLS.slice().sort(),
    [
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
    ].sort(),
  );
  assert.equal(OPERATION_TOOL.CREATE_RECOVERY_PROPOSAL, null);
  assert.equal(isAllowedOperation("CREATE_RECOVERY_PROPOSAL"), true);
  assert.equal(isAllowedOperation("DELETE_EVERYTHING"), false);
});

test("fixed plans only contain allowlisted read operations", () => {
  for (const intent of ["INVESTIGATE_INCIDENT", "GET_AFFECTED_ENTITIES", "GET_RISK", "GET_AVAILABLE_ASSETS", "GET_RECOMMENDATIONS", "CREATE_PROPOSAL"]) {
    const plan = planForIntent(intent, { shipmentId: "S039", disruptionId: "D01" });
    assert.ok(plan.length > 0);
    for (const operation of plan) {
      assert.equal(isAllowedOperation(operation), true, `${intent}: ${operation}`);
      assert.notEqual(OPERATION_TOOL[operation], null, `${intent}: ${operation} must be an MCP tool`);
    }
  }
  assert.deepEqual(planForIntent("GET_RISK", { shipmentId: "S039", disruptionId: null }), ["GET_COMBINED_RISK"]);
  assert.deepEqual(planForIntent("GET_AVAILABLE_ASSETS", { shipmentId: "S039" }), ["GET_IDLE_ASSETS", "GET_REDEPLOYMENT_CANDIDATES"]);
  assert.deepEqual(planForIntent("UNKNOWN_INTENT", {}), []);
});

test("tool inputs require validated ids and never come from user text", () => {
  assert.deepEqual(buildToolInput("GET_AFFECTED_SHIPMENTS", { disruptionId: "D01" }), { disruption_id: "D01" });
  assert.equal(buildToolInput("GET_AFFECTED_SHIPMENTS", {}), null);
  assert.deepEqual(buildToolInput("GET_COMBINED_RISK", { shipmentId: "S039" }), { shipment_id: "S039" });
  assert.equal(buildToolInput("GET_COMBINED_RISK", {}), null);
  assert.deepEqual(buildToolInput("GET_RISK_OVERVIEW", {}), { include_zero: true, limit: 50 });
});

test("runOperation rejects unknown operations and missing context without calling tools", async () => {
  const calls = [];
  const toolCaller = async (...args) => {
    calls.push(args);
    return { ok: true };
  };

  const rejected = await runOperation({ operation: "DROP_TABLE", context: {}, baseUrl: "http://x", toolCaller });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, "OPERATION_NOT_ALLOWED");

  const missing = await runOperation({ operation: "GET_COMBINED_RISK", context: {}, baseUrl: "http://x", toolCaller });
  assert.equal(missing.ok, false);
  assert.equal(missing.skipped, true);

  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// Deterministic explanation + Feature 1 grounding reuse
// ---------------------------------------------------------------------------
test("deterministic explanation is grounded in the command evidence", () => {
  const explanation = buildDeterministicCommandExplanation(EVIDENCE);
  assert.match(explanation.summary, /I investigated incident D01/i);
  assert.match(explanation.summary, /S039/);
  assert.match(explanation.summary, /0\.728/);
  assert.match(explanation.whyItMatters, /major/);
  assert.equal(explanation.recommendedNextStep, "Review and consider intervention");
  assert.ok(explanation.limitations.some((entry) => /no operational action has been executed/i.test(entry)));

  const grounding = validateBriefGrounding(explanation, EVIDENCE, { checkRecommendation: true });
  assert.equal(grounding.ok, true, JSON.stringify(grounding.violations));
});

test("Feature 1 grounding rejects fabricated values in a commander explanation", () => {
  const fabricated = {
    ...buildDeterministicCommandExplanation(EVIDENCE),
    summary: "Shipment S999 has a combined risk score of 0.95 and has been reassigned.",
  };
  const grounding = validateBriefGrounding(fabricated, EVIDENCE, { checkRecommendation: true });
  assert.equal(grounding.ok, false);
  assert.ok(grounding.violations.some((entry) => entry.startsWith("unknown_id:S999")));
  assert.ok(grounding.violations.some((entry) => entry.startsWith("unsupported_number:0.95")));
});

test("recommendation-family check can be disabled when no deterministic action exists", () => {
  const evidence = { ...EVIDENCE, coldchain: null };
  const explanation = buildDeterministicCommandExplanation(evidence);
  assert.equal(validateBriefGrounding(explanation, evidence, { checkRecommendation: false }).ok, true);
});
