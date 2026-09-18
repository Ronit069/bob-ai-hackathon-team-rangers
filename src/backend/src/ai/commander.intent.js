// AI Incident Commander — deterministic intent fallback and pure resolution helpers.
// Used when no provider is configured/available or when model output fails validation.
// It only produces the same validated intent shape; the executed plan stays server-side.

const RULES = [
  { intent: "CREATE_PROPOSAL", pattern: /proposal|prepare\b.*\b(recovery|plan)|recovery plan/i },
  {
    intent: "GET_AVAILABLE_ASSETS",
    pattern:
      /(available|idle|free)\b.*\b(asset|truck|container|vessel|refrigerat|reefer|fleet)|which\b.*\b(truck|asset|vessel)|refrigerated assets/i,
  },
  { intent: "GET_RECOMMENDATIONS", pattern: /recommend|recovery option|what\b.*\boptions|action plan/i },
  { intent: "GET_RISK", pattern: /(highest|top|most|worst)\b.*\b(risk|critical)|why\b.*\b(critical|risk)|risk\b.*\b(highest|affected)/i },
  { intent: "GET_AFFECTED_ENTITIES", pattern: /affected|which shipments/i },
  { intent: "INVESTIGATE_INCIDENT", pattern: /investigate|what happened|disruption|strike|weather|port|prioriti[sz]e|find out/i },
];

const DEFAULT_OPERATIONS = {
  INVESTIGATE_INCIDENT: [
    "GET_ACTIVE_DISRUPTIONS",
    "GET_AFFECTED_SHIPMENTS",
    "GET_RISK_OVERVIEW",
    "GET_COMBINED_RISK",
    "GET_TEMPERATURE_EXCURSIONS",
    "GET_IDLE_ASSETS",
  ],
  GET_AFFECTED_ENTITIES: ["GET_ACTIVE_DISRUPTIONS", "GET_AFFECTED_SHIPMENTS"],
  GET_RISK: ["GET_ACTIVE_DISRUPTIONS", "GET_AFFECTED_SHIPMENTS", "GET_RISK_OVERVIEW", "GET_COMBINED_RISK"],
  GET_AVAILABLE_ASSETS: ["GET_IDLE_ASSETS"],
  GET_RECOMMENDATIONS: ["GET_ACTIVE_DISRUPTIONS", "GET_AFFECTED_SHIPMENTS", "GET_RISK_OVERVIEW"],
  CREATE_PROPOSAL: ["GET_COMBINED_RISK", "GET_REDEPLOYMENT_CANDIDATES"],
};

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "this", "that", "please", "you", "can", "could",
  "investigate", "incident", "disruption", "shipment", "shipments", "affected", "impact",
  "prioritize", "prioritise", "cold", "chain", "highest", "risk", "critical", "show",
  "find", "prepare", "recovery", "proposal", "available", "which", "what", "happened",
  "port", "ports", "current", "currently", "need", "want", "give",
]);

export function extractShipmentId(text) {
  const match = String(text).match(/\bS(\d{3})\b/i);
  return match ? `S${match[1]}` : null;
}

export function extractDisruptionId(text) {
  const match = String(text).match(/\bD(\d{2})\b/i);
  return match ? `D${match[1]}` : null;
}

export function extractPriority(text) {
  const value = String(text);
  if (/cold.?chain|refrigerat|reefer|temperature/i.test(value)) return "COLD_CHAIN";
  if (/critical|highest.?risk|most.?urgent|worst/i.test(value)) return "CRITICAL";
  return null;
}

// Deterministic fallback intent. Returns null when no supported command is recognised.
export function parseDeterministicIntent(command) {
  const text = String(command ?? "");
  const rule = RULES.find((entry) => entry.pattern.test(text));
  if (!rule) return null;

  const shipmentId = extractShipmentId(text);
  const disruptionId = extractDisruptionId(text);
  const requested = [...DEFAULT_OPERATIONS[rule.intent]];
  if (shipmentId && rule.intent === "GET_AVAILABLE_ASSETS") requested.push("GET_REDEPLOYMENT_CANDIDATES");

  return {
    intent: rule.intent,
    incident_id: disruptionId,
    incident_text: disruptionId ? null : text,
    shipment_id: shipmentId,
    priority: extractPriority(text),
    requested_operations: requested,
  };
}

function tokenize(text) {
  return [
    ...new Set(
      String(text ?? "")
        .toLowerCase()
        .split(/[^a-z0-9-]+/)
        .filter((token) => token.length >= 3 && !STOPWORDS.has(token)),
    ),
  ];
}

// Pure text→disruption matching over the supplied disruption rows. Never invents rows:
// a zero-match or tie returns no incident and the caller asks for clarification.
export function matchDisruptionsByText(disruptions, text) {
  const tokens = tokenize(text);
  if (tokens.length === 0) return { incident: null, candidates: [], ambiguous: false };

  const scored = disruptions
    .map((disruption) => {
      const haystack = `${disruption.description ?? ""} ${disruption.type ?? ""} ${disruption.region_code ?? ""}`
        .toLowerCase()
        .replace(/[_-]/g, " ");
      const score = tokens.filter((token) => haystack.includes(token)).length;
      return { disruption, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || String(a.disruption.id).localeCompare(String(b.disruption.id)));

  if (scored.length === 0) return { incident: null, candidates: [], ambiguous: false };
  const best = scored.filter((entry) => entry.score === scored[0].score);
  if (best.length > 1) {
    return { incident: null, candidates: best.map((entry) => entry.disruption), ambiguous: true };
  }
  return { incident: scored[0].disruption, candidates: [scored[0].disruption], ambiguous: false };
}

const scoreOf = (row) => (row.combined_score != null ? row.combined_score : Number(row.impact_score ?? 0));

// Deterministic priority selection over the affected set, using the authoritative
// combined score when the risk engine returned one, else the impact score.
export function selectPriorityShipment({ affected = [], riskOverview = [], priority = null } = {}) {
  const byId = new Map(
    riskOverview.map((row) => [row.shipment_id ?? row.shipment?.id, Number(row.combined_score ?? 0)]),
  );
  let pool = affected.map((row) => ({
    ...row,
    combined_score: byId.has(row.id) ? byId.get(row.id) : null,
  }));

  if (priority === "COLD_CHAIN") {
    const cold = pool.filter((row) => row.is_cold_chain);
    if (cold.length > 0) pool = cold;
  }
  if (pool.length === 0) return null;

  const sorted = [...pool].sort(
    (a, b) => scoreOf(b) - scoreOf(a) || String(a.id).localeCompare(String(b.id)),
  );
  return sorted[0];
}
