// ChainSentinel local Bob engine — no external API required.
// Intent detection → tool dispatch (via callTool) → grounded answer synthesis.
// Returns { answer: string, evidence: object[], tool_calls: number }.

import { callTool } from "../../../mcp-server/src/tools.js";

// ---------------------------------------------------------------------------
// Intent definitions — ordered by specificity (most specific first)
// ---------------------------------------------------------------------------
const INTENTS = [
  // Shipment-specific risk
  {
    name: "combined_risk",
    patterns: [
      /why.*(s\d{3}).*(critical|major|warning|risk)/i,
      /(risk|score|priority).*\b(s\d{3})\b/i,
      /\b(s\d{3})\b.*(risk|score|priority|critical|major|warning)/i,
    ],
    extract: (prompt) => ({ shipment_id: extractShipmentId(prompt) }),
    tools: ["get_combined_risk"],
    answer: answerCombinedRisk,
  },
  // Route alternatives
  {
    name: "route_alternatives",
    patterns: [/route.*alt/i, /alt.*route/i, /reroute/i, /alternative.*route/i],
    extract: (prompt) => ({ shipment_id: extractShipmentId(prompt) }),
    tools: ["get_route_alternatives"],
    answer: answerRouteAlternatives,
  },
  // Carrier alternatives
  {
    name: "carrier_alternatives",
    patterns: [/carrier.*alt/i, /alt.*carrier/i, /switch.*carrier/i, /change.*carrier/i],
    extract: (prompt) => ({ shipment_id: extractShipmentId(prompt) }),
    tools: ["get_carrier_alternatives"],
    answer: answerCarrierAlternatives,
  },
  // Sensor / readings (before redeployment so "missing readings" doesn't fall through)
  {
    name: "sensor_status",
    patterns: [
      /sensor/i,
      /reading/i,
      /temperature.*hist/i,
      /hist.*temperature/i,
      /missing.*read/i,
      /read.*missing/i,
      /data.*gap/i,
      /gap.*data/i,
    ],
    extract: (prompt) => ({ shipment_id: extractShipmentId(prompt) }),
    tools: ["get_sensor_status"],
    answer: answerSensorStatus,
  },
  // Idle assets — must come before redeployment so "idle trucks" wins
  {
    name: "idle_assets",
    patterns: [
      /idle/i,
      /available.*truck/i,
      /truck.*available/i,
      /fleet.*available/i,
      /available.*asset/i,
      /asset.*available/i,
      /which.*truck/i,
    ],
    extract: () => ({}),
    tools: ["get_idle_assets"],
    answer: answerIdleAssets,
  },
  // Redeployment candidates for a specific shipment
  {
    name: "redeployment_candidates",
    patterns: [/redeploy/i, /redeployment/i],
    extract: (prompt) => ({ shipment_id: extractShipmentId(prompt) }),
    tools: ["get_redeployment_candidates"],
    answer: answerRedeploymentCandidates,
  },
  // Affected shipments
  {
    name: "affected_shipments",
    patterns: [
      /affected.*shipment/i,
      /shipment.*affected/i,
      /which.*shipment.*disruption/i,
      /disruption.*affect/i,
      /strike.*shipment/i,
      /shipment.*strike/i,
      /port.*strike/i,
      /weather.*shipment/i,
    ],
    extract: (prompt) => ({ disruption_id: extractDisruptionId(prompt) }),
    tools: ["get_active_disruptions", "get_affected_shipments"],
    answer: answerAffectedShipments,
  },
  // Cold-chain excursions
  {
    name: "excursion_detail",
    patterns: [/excursion/i, /cold.?chain.*issue/i, /temperature.*breach/i, /breach/i, /temp.*alert/i],
    extract: (prompt) => ({
      shipment_id: extractShipmentId(prompt),
      severity: extractSeverity(prompt),
    }),
    tools: ["get_temperature_excursions"],
    answer: answerExcursions,
  },
  // Risk overview / action plan
  {
    name: "risk_overview",
    patterns: [
      /risk.*overview/i,
      /overview.*risk/i,
      /ranked.*worklist/i,
      /worklist/i,
      /action.*plan/i,
      /six.?hour/i,
      /top.*risk/i,
      /highest.*risk/i,
      /most.*critical/i,
      /consolidated/i,
    ],
    extract: () => ({}),
    tools: ["get_risk_overview"],
    answer: answerRiskOverview,
  },
  // Active disruptions
  {
    name: "active_disruptions",
    patterns: [
      /disruption/i,
      /strike/i,
      /weather.*event/i,
      /geopolit/i,
      /customs.*delay/i,
      /infrastructure.*issue/i,
      /active.*event/i,
    ],
    extract: () => ({}),
    tools: ["get_active_disruptions"],
    answer: answerActiveDisruptions,
  },
  // Audit log
  {
    name: "audit",
    patterns: [/audit/i, /decision.*trail/i, /trail/i, /history.*decision/i, /approval/i, /who.*approved/i],
    extract: () => ({}),
    tools: ["get_audit_log"],
    answer: answerAuditLog,
  },
];

// ---------------------------------------------------------------------------
// Extractors
// ---------------------------------------------------------------------------
function extractShipmentId(prompt) {
  const m = prompt.match(/\b(S\d{3})\b/i);
  return m ? m[1].toUpperCase() : null;
}

function extractDisruptionId(prompt) {
  const m = prompt.match(/\b(D\d{2})\b/i);
  return m ? m[1].toUpperCase() : null;
}

function extractSeverity(prompt) {
  if (/critical/i.test(prompt)) return "critical";
  if (/major/i.test(prompt)) return "major";
  if (/warning/i.test(prompt)) return "warning";
  return undefined;
}

// ---------------------------------------------------------------------------
// Main engine entry point
// ---------------------------------------------------------------------------
export async function runLocalEngine(baseUrl, prompt, _context = {}) {
  const intent = detectIntent(prompt);

  if (!intent) {
    return { answer: unsupportedAnswer(prompt), evidence: [], tool_calls: 0 };
  }

  const input = intent.extract(prompt);
  const evidence = [];
  let tool_calls = 0;
  const results = {};

  for (const toolName of intent.tools) {
    const toolInput = buildToolInput(toolName, input);
    const result = await callTool(baseUrl, toolName, toolInput);
    // Shape evidence entries to match what EvidencePanel expects: { tool, input, output }
    const { tool, ok, ...outputBody } = result;
    evidence.push({ tool: tool ?? toolName, input: toolInput, output: outputBody });
    tool_calls++;
    results[toolName] = result;
  }

  const answer = intent.answer(input, results);
  return { answer, evidence, tool_calls };
}

// ---------------------------------------------------------------------------
// Intent detection
// ---------------------------------------------------------------------------
function detectIntent(prompt) {
  for (const intent of INTENTS) {
    for (const pattern of intent.patterns) {
      if (pattern.test(prompt)) return intent;
    }
  }
  return null;
}

function buildToolInput(toolName, extracted) {
  const { shipment_id, disruption_id, severity } = extracted;
  switch (toolName) {
    case "get_combined_risk":
    case "get_route_alternatives":
    case "get_carrier_alternatives":
    case "get_sensor_status":
    case "get_redeployment_candidates":
      return shipment_id ? { shipment_id } : {};
    case "get_affected_shipments":
      return disruption_id ? { disruption_id } : {};
    case "get_temperature_excursions":
      return {
        ...(shipment_id ? { shipment_id } : {}),
        ...(severity ? { severity } : {}),
      };
    default:
      return {};
  }
}

// ---------------------------------------------------------------------------
// Answer synthesizers — shaped to the actual REST response envelopes
// ---------------------------------------------------------------------------

function answerCombinedRisk(input, results) {
  const r = results["get_combined_risk"];
  if (!r?.ok) return toolError("get_combined_risk", r);
  const id = r.shipment_id ?? input.shipment_id ?? "unknown";
  const score = r.combined_score ?? "N/A";
  const disruption = r.disruption_risk ?? "N/A";
  const coldchain = r.coldchain_risk ?? "N/A";
  const df = r.factors?.disruption ?? {};
  const cf = r.factors?.coldchain ?? {};

  const lines = [
    `Shipment ${id} has a combined risk score of ${score}.`,
    `  • Disruption risk: ${disruption} (status: ${df.impact_status ?? "N/A"})`,
    `  • Cold-chain risk: ${coldchain}`,
  ];
  if (df.affected_disruption_ids?.length) {
    lines.push(`  • Affected by disruptions: ${df.affected_disruption_ids.join(", ")}`);
  }
  if (cf.severity) lines.push(`  • Worst excursion severity: ${cf.severity}`);
  if (cf.peak_deviation_c != null) lines.push(`  • Peak temp deviation: ${cf.peak_deviation_c}°C`);
  if (cf.duration_min != null) lines.push(`  • Excursion duration: ${cf.duration_min} min`);
  if (cf.recommended_action) lines.push(`  • Recommended action: ${cf.recommended_action}`);
  if (cf.human_review_required) lines.push(`  ⚠ Human review required.`);
  lines.push(`\nSource: get_combined_risk tool (live data).`);
  return lines.join("\n");
}

function answerRouteAlternatives(input, results) {
  const r = results["get_route_alternatives"];
  if (!r?.ok) return toolError("get_route_alternatives", r);
  const id = input.shipment_id ?? "unknown";
  const alts = r.data ?? [];
  const rejected = r.rejected ?? [];

  const lines = [`Route alternatives for shipment ${id}:`];
  if (!alts.length) {
    lines.push(`  No feasible route alternatives found.`);
  } else {
    for (const [i, a] of alts.entries()) {
      lines.push(`  ${i + 1}. ${a.route_id ?? a.name ?? "Route"} — score: ${a.score ?? "N/A"}`);
      if (a.factors) lines.push(`     Factors: ${JSON.stringify(a.factors)}`);
    }
  }
  if (rejected.length) {
    lines.push(`\nRejected alternatives (${rejected.length}):`);
    for (const a of rejected) {
      lines.push(`  ✗ ${a.route_id ?? a.id ?? "?"} — ${a.rejected_reason ?? a.reason ?? "unspecified"}`);
    }
  }
  lines.push(`\nSource: get_route_alternatives tool (live data).`);
  return lines.join("\n");
}

function answerCarrierAlternatives(input, results) {
  const r = results["get_carrier_alternatives"];
  if (!r?.ok) return toolError("get_carrier_alternatives", r);
  const id = input.shipment_id ?? "unknown";
  const alts = r.data ?? r.alternatives ?? [];
  const rejected = r.rejected ?? [];

  const lines = [`Carrier alternatives for shipment ${id}:`];
  if (!alts.length) {
    lines.push(`  No feasible carrier alternatives found.`);
  } else {
    for (const [i, a] of alts.entries()) {
      lines.push(`  ${i + 1}. ${a.carrier_id ?? a.name ?? "Carrier"} — score: ${a.score ?? "N/A"}`);
    }
  }
  if (rejected.length) {
    lines.push(`\nRejected alternatives (${rejected.length}):`);
    for (const a of rejected) {
      lines.push(`  ✗ ${a.carrier_id ?? a.id ?? "?"} — ${a.rejected_reason ?? a.reason ?? "unspecified"}`);
    }
  }
  lines.push(`\nSource: get_carrier_alternatives tool (live data).`);
  return lines.join("\n");
}

function answerSensorStatus(input, results) {
  const r = results["get_sensor_status"];
  if (!r?.ok) {
    if (!input.shipment_id) {
      return (
        `Sensor status queries require a specific shipment ID (e.g. "Are there missing sensor readings for S039?").\n\n` +
        `To check for data gaps across all cold-chain shipments, ask about "temperature excursions" instead.`
      );
    }
    return toolError("get_sensor_status", r);
  }
  const id = input.shipment_id ?? "unknown";
  const readings = r.data ?? r.readings ?? [];
  const health = r.sensor_health ?? r.health ?? {};
  const flags = r.quality_flags ?? r.flags ?? [];

  const lines = [`Sensor status for shipment ${id}:`];
  if (health.status) lines.push(`  • Sensor health: ${health.status}`);
  if (health.last_reading_at) lines.push(`  • Last reading: ${health.last_reading_at}`);
  lines.push(`  • Total readings: ${readings.length}`);

  if (flags.length) {
    lines.push(`\nData quality flags (${flags.length}):`);
    for (const f of flags.slice(0, 10)) {
      lines.push(`  – ${f.flag_type ?? f.type ?? JSON.stringify(f)}`);
    }
    if (flags.length > 10) lines.push(`  … and ${flags.length - 10} more.`);
  } else {
    lines.push(`  • No data quality flags detected.`);
  }
  lines.push(`\nSource: get_sensor_status tool (live data).`);
  return lines.join("\n");
}

function answerIdleAssets(input, results) {
  const r = results["get_idle_assets"];
  if (!r?.ok) return toolError("get_idle_assets", r);
  const items = r.data ?? [];
  if (!items.length) return "No idle assets found. No data returned.";

  const lines = [`Idle fleet assets available for redeployment (${items.length}):\n`];
  for (const item of items) {
    const a = item.asset ?? item;
    lines.push(
      `  • ${a.id ?? "?"} — ${a.type ?? "asset"} — ${a.current_region_code ?? a.region_code ?? "?"} — idle ${item.idle_minutes ?? "?"} min${a.refrigerated ? " (refrigerated)" : ""}`,
    );
  }
  lines.push(`\nSource: get_idle_assets tool (live data).`);
  return lines.join("\n");
}

function answerRedeploymentCandidates(input, results) {
  const r = results["get_redeployment_candidates"];
  if (!r?.ok) return toolError("get_redeployment_candidates", r);
  const id = input.shipment_id ?? "unknown";
  const candidates = r.data ?? r.candidates ?? [];
  if (!candidates.length) return `No redeployment candidates returned for shipment ${id}. No data returned.`;

  const lines = [`Redeployment candidates for shipment ${id} (${candidates.length}):\n`];
  for (const [i, c] of candidates.entries()) {
    const a = c.asset ?? c;
    lines.push(`  ${i + 1}. Asset ${a.id ?? "?"} — ${a.type ?? ""} — score: ${c.score ?? "N/A"}`);
    if (a.current_region_code) lines.push(`     Region: ${a.current_region_code}`);
    if (c.rejection_reason) lines.push(`     ✗ Rejected: ${c.rejection_reason}`);
  }
  lines.push(`\nSource: get_redeployment_candidates tool (live data).`);
  return lines.join("\n");
}

function answerAffectedShipments(input, results) {
  const activeResult = results["get_active_disruptions"];
  const affectedResult = results["get_affected_shipments"];
  const disruptions = activeResult?.data ?? [];

  // If we couldn't fetch affected shipments (e.g. no disruption_id given)
  if (!affectedResult?.ok) {
    if (!activeResult?.ok) return toolError("get_active_disruptions", activeResult);
    if (!disruptions.length) return "No active disruptions found. No data returned.";

    const lines = [`No disruption ID specified. Active disruptions (${disruptions.length}):\n`];
    for (const d of disruptions) {
      lines.push(
        `  • ${d.id} — ${d.type} — region: ${d.region_code ?? "?"} — severity: ${d.severity ?? "?"}`,
      );
      if (d.description) lines.push(`    "${d.description}"`);
    }
    lines.push(`\nPlease specify a disruption ID (e.g. D01) to see affected shipments.`);
    lines.push(`\nSource: get_active_disruptions tool (live data).`);
    return lines.join("\n");
  }

  const shipments = affectedResult.data ?? [];
  const disruptionId = input.disruption_id ?? disruptions[0]?.id ?? "?";
  if (!shipments.length) return `No shipments affected by disruption ${disruptionId}. No data returned.`;

  const lines = [`Shipments affected by disruption ${disruptionId} (${shipments.length}):\n`];
  for (const item of shipments) {
    const s = item.shipment ?? item;
    const risk = item.disruption_risk ?? item.risk_score ?? "N/A";
    const reasons = item.match_reasons ?? [];
    lines.push(`  • ${s.id ?? "?"} — cargo: ${s.cargo_type ?? "?"} — status: ${s.status ?? "?"} — risk: ${risk}`);
    if (reasons.length) lines.push(`    Reasons: ${reasons.join("; ")}`);
  }
  lines.push(`\nSource: get_active_disruptions + get_affected_shipments tools (live data).`);
  return lines.join("\n");
}

function answerExcursions(input, results) {
  const r = results["get_temperature_excursions"];
  if (!r?.ok) return toolError("get_temperature_excursions", r);
  const excursions = r.data ?? [];
  const id = input.shipment_id;

  if (!excursions.length) {
    return id
      ? `No temperature excursions found for shipment ${id}. No data returned.`
      : "No temperature excursions found. No data returned.";
  }

  const lines = [`Temperature excursions${id ? ` for shipment ${id}` : ""} (${excursions.length}):\n`];
  for (const e of excursions.slice(0, 15)) {
    lines.push(
      `  • ${e.id ?? "?"} — shipment: ${e.shipment_id ?? "?"} — severity: ${e.severity} — status: ${e.status}`,
    );
    if (e.peak_deviation_c != null) lines.push(`    Peak deviation: ${e.peak_deviation_c}°C`);
    if (e.duration_min != null) lines.push(`    Duration: ${e.duration_min} min`);
    if (e.recommended_action) lines.push(`    Action: ${e.recommended_action}`);
  }
  if (excursions.length > 15) lines.push(`  … and ${excursions.length - 15} more.`);
  lines.push(`\nSource: get_temperature_excursions tool (live data).`);
  return lines.join("\n");
}

function answerRiskOverview(input, results) {
  const r = results["get_risk_overview"];
  if (!r?.ok) return toolError("get_risk_overview", r);
  const items = r.data ?? [];
  if (!items.length) return "No risk data returned. No data returned.";

  const lines = [`Combined risk overview — top ${Math.min(items.length, 10)} shipments by priority:\n`];
  for (const item of items.slice(0, 10)) {
    const s = item.shipment ?? {};
    lines.push(
      `  • ${item.shipment_id ?? s.id ?? "?"} — combined: ${item.combined_score ?? "N/A"} — disruption: ${item.disruption_risk ?? "N/A"} — coldchain: ${item.coldchain_risk ?? "N/A"} — ${s.cargo_type ?? ""}`,
    );
  }
  if (items.length > 10) lines.push(`  … and ${items.length - 10} more shipments.`);
  lines.push(`\nSource: get_risk_overview tool (live data).`);
  return lines.join("\n");
}

function answerActiveDisruptions(input, results) {
  const r = results["get_active_disruptions"];
  if (!r?.ok) return toolError("get_active_disruptions", r);
  const disruptions = r.data ?? [];
  if (!disruptions.length) return "No active disruptions found. No data returned.";

  const lines = [`Active disruptions (${disruptions.length}):\n`];
  for (const d of disruptions) {
    lines.push(`  • ${d.id} — ${d.type} — region: ${d.region_code ?? "?"} — severity: ${d.severity ?? "?"}`);
    if (d.description) lines.push(`    "${d.description}"`);
  }
  lines.push(`\nSource: get_active_disruptions tool (live data).`);
  return lines.join("\n");
}

function answerAuditLog(input, results) {
  const r = results["get_audit_log"];
  if (!r?.ok) return toolError("get_audit_log", r);
  const records = r.data ?? r.records ?? [];
  if (!records.length) return "No audit records found. No data returned.";

  const lines = [`Audit trail — ${records.length} record(s):\n`];
  for (const rec of records.slice(0, 10)) {
    lines.push(
      `  • ${rec.created_at ?? rec.timestamp ?? "?"} — ${rec.action ?? "?"} — ${rec.entity_type ?? "?"} ${rec.entity_id ?? ""}`,
    );
    if (rec.actor) lines.push(`    Actor: ${rec.actor}`);
  }
  if (records.length > 10) lines.push(`  … and ${records.length - 10} more.`);
  lines.push(`\nSource: get_audit_log tool (live data).`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function toolError(name, result) {
  const msg = result?.error?.message ?? "unknown error";
  return `Tool ${name} returned a failure: "${msg}". Please check the dashboard for live data.`;
}

function unsupportedAnswer(prompt) {
  return (
    `I could not match your question to a supported capability.\n\n` +
    `Your question: "${prompt}"\n\n` +
    `Available capabilities:\n` +
    `  • Active disruptions — ask about current disruptions or strikes\n` +
    `  • Affected shipments — ask which shipments are hit by a disruption (e.g. "D01")\n` +
    `  • Route alternatives — ask for rerouting options for a shipment (e.g. "S039")\n` +
    `  • Carrier alternatives — ask to switch carriers for a shipment\n` +
    `  • Idle fleet assets — ask which trucks/containers are available\n` +
    `  • Redeployment candidates — ask which assets can cover a shipment\n` +
    `  • Sensor readings — ask about sensor data or data gaps for a shipment\n` +
    `  • Temperature excursions — ask about cold-chain breaches\n` +
    `  • Combined risk — ask why a shipment has a certain risk score\n` +
    `  • Risk overview — ask for the ranked worklist or action plan\n` +
    `  • Audit log — ask about past decisions and approvals\n\n` +
    `Please rephrase with a specific shipment ID (S###), disruption ID (D##), or one of the topics above.`
  );
}
