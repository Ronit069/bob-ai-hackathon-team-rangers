// AI Incident Commander — command evidence assembly (Feature 2).
// Evidence is assembled from the frozen MCP tool results plus the existing read-only
// recommendation repository. No business logic is duplicated here: every value is
// passed through from the deterministic backend.

import * as recommendationRepo from "../audit/recommendation.repository.js";

export const COMMAND_EVIDENCE_LIMITS = {
  affected: 10,
  disruptions: 5,
  risk: 8,
  assets: 8,
  recommendations: 5,
  description: 200,
};

export const COUNTED_OPERATIONS = [
  "GET_ACTIVE_DISRUPTIONS",
  "GET_AFFECTED_SHIPMENTS",
  "GET_RISK_OVERVIEW",
  "GET_COMBINED_RISK",
  "GET_TEMPERATURE_EXCURSIONS",
  "GET_IDLE_ASSETS",
  "GET_REDEPLOYMENT_CANDIDATES",
];

const round3 = (value) => (value == null ? null : Math.round(Number(value) * 1000) / 1000);

const truncate = (value, max) => {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

export function normalizeDisruptions(rows, limit = COMMAND_EVIDENCE_LIMITS.disruptions) {
  return (rows ?? [])
    .slice(0, limit)
    .map((row) => ({
      disruption_id: row.id,
      type: row.type ?? null,
      region_code: row.region_code ?? null,
      severity: row.severity == null ? null : Number(row.severity),
      status: row.status ?? null,
      description: truncate(row.description, COMMAND_EVIDENCE_LIMITS.description),
    }))
    .filter((row) => row.disruption_id);
}

export function normalizeAffected(rows, limit = COMMAND_EVIDENCE_LIMITS.affected) {
  return (rows ?? [])
    .slice(0, limit)
    .map((row) => {
      const shipment = row.shipment ?? {};
      return {
        id: shipment.id,
        cargo_type: shipment.cargo_type ?? null,
        is_cold_chain: Boolean(shipment.is_cold_chain),
        status: shipment.status ?? null,
        impact_status: row.impact_status ?? "unknown_review",
        impact_score: round3(row.impact_score),
        match_reason: row.match_reason ?? null,
        matched_disruptions: (row.matched_disruptions ?? [])
          .map((entry) => entry.disruption_id)
          .filter(Boolean),
      };
    })
    .filter((row) => row.id);
}

export function normalizeAssets(rows, limit = COMMAND_EVIDENCE_LIMITS.assets) {
  return (rows ?? [])
    .slice(0, limit)
    .map((item) => {
      const asset = item.asset ?? item;
      return {
        asset_id: asset.id,
        type: asset.type ?? null,
        refrigerated: Boolean(asset.refrigerated),
        region_code: asset.current_region_code ?? null,
        idle_minutes: item.idle_minutes ?? asset.idle_minutes ?? null,
      };
    })
    .filter((row) => row.asset_id);
}

export function normalizeRiskOverview(rows, limit = COMMAND_EVIDENCE_LIMITS.risk) {
  return (rows ?? [])
    .slice(0, limit)
    .map((row) => ({
      shipment_id: row.shipment_id ?? row.shipment?.id ?? null,
      cargo_type: row.shipment?.cargo_type ?? null,
      is_cold_chain: Boolean(row.shipment?.is_cold_chain),
      combined_score: round3(row.combined_score),
      disruption_risk: round3(row.disruption_risk),
      coldchain_risk: round3(row.coldchain_risk),
    }))
    .filter((row) => row.shipment_id);
}

function worstExcursion(rows, severity) {
  const open = (rows ?? []).filter((row) => row.status !== "closed");
  const match = open.find((row) => row.severity === severity) ?? open[0] ?? null;
  if (!match) return null;
  return {
    id: match.id ?? null,
    severity: match.severity ?? null,
    status: match.status ?? null,
    peak_deviation_c: match.peak_deviation_c == null ? null : Number(match.peak_deviation_c),
    duration_min: match.duration_min == null ? null : Number(match.duration_min),
    data_quality: match.data_quality ?? null,
  };
}

function shapeRecommendation(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    target_id: row.route_id ?? row.carrier_id ?? row.asset_id ?? null,
    status: row.status,
    score: round3(row.score),
  };
}

// Assembles the single evidence object that powers the grounded explanation.
// `priorityShipment` is a normalized affected row selected by the deterministic
// priority rule (or the explicit shipment in the command).
export async function buildCommandEvidence({
  db,
  command,
  intent,
  incident,
  priorityShipment = null,
  results = {},
  activity = [],
  missing = [],
  proposal = null,
  now = new Date(),
}) {
  const affected = normalizeAffected(results.GET_AFFECTED_SHIPMENTS?.data);
  const knownIncidents = normalizeDisruptions(results.GET_ACTIVE_DISRUPTIONS?.data);
  const assets = normalizeAssets(results.GET_IDLE_ASSETS?.data);
  const riskOverview = normalizeRiskOverview(results.GET_RISK_OVERVIEW?.data);
  const risk = results.GET_COMBINED_RISK;
  const priorityId = priorityShipment?.id ?? intent.shipment_id ?? null;

  let recommendations = [];
  const relevantIds = new Set([...affected.map((row) => row.id), priorityId].filter(Boolean));
  if (relevantIds.size > 0) {
    const rows = await recommendationRepo.listRecommendations(db, { limit: 200 });
    recommendations = rows.filter((row) => relevantIds.has(row.shipment_id));
    activity.push({
      operation: "GET_RECOMMENDATIONS",
      tool: null,
      input: { shipment_ids: [...relevantIds] },
      ok: true,
      source: "service",
      message: "Existing recommendations retrieved",
    });
  }

  const priorityRisk =
    risk && (risk.shipment_id ?? priorityId) === priorityId && risk.shipment_id
      ? risk
      : riskOverview.find((row) => row.shipment_id === priorityId) ?? null;

  const coldchainFactors = priorityRisk?.factors?.coldchain ?? null;
  const severity = coldchainFactors?.severity ?? null;
  const coldchain =
    priorityShipment && (severity || coldchainFactors)
      ? {
          severity,
          recommended_action: coldchainFactors?.recommended_action ?? null,
          human_review_required: Boolean(coldchainFactors?.human_review_required),
          worst_excursion: worstExcursion(results.GET_TEMPERATURE_EXCURSIONS?.data, severity),
        }
      : null;

  const priority = priorityShipment
    ? {
        shipment_id: priorityShipment.id,
        cargo_type: priorityShipment.cargo_type ?? null,
        is_cold_chain: Boolean(priorityShipment.is_cold_chain),
        status: priorityShipment.status ?? null,
        impact_status: priorityShipment.impact_status ?? null,
        impact_score: round3(priorityShipment.impact_score),
        combined_score: round3(priorityRisk?.combined_score),
        disruption_risk: round3(priorityRisk?.disruption_risk),
        coldchain_risk: round3(priorityRisk?.coldchain_risk),
        source: "chain_sentinel_risk_engine",
      }
    : null;

  const recommendation = shapeRecommendation(
    recommendations.find((row) => row.status === "pending") ?? recommendations[0] ?? null,
  );

  return {
    command,
    workflow: "AI Incident Commander",
    intent: {
      intent: intent.intent,
      priority: intent.priority ?? null,
      incident_id: incident?.id ?? intent.incident_id ?? null,
      shipment_id: intent.shipment_id ?? null,
    },
    incident: incident
      ? {
          disruption_id: incident.id,
          type: incident.type ?? null,
          region_code: incident.region_code ?? null,
          severity: incident.severity == null ? null : Number(incident.severity),
          status: incident.status ?? null,
          description: truncate(incident.description, COMMAND_EVIDENCE_LIMITS.description),
        }
      : null,
    known_incidents: knownIncidents,
    incident_summary: {
      affected_count: affected.length,
      critical_count: affected.filter((row) => row.impact_status === "critical").length,
      cold_chain_count: affected.filter((row) => row.is_cold_chain).length,
      available_assets_count: assets.length,
      refrigerated_assets_count: assets.filter((row) => row.refrigerated).length,
    },
    affected_shipments: affected,
    priority_shipment: priority,
    coldchain,
    risk_overview: riskOverview,
    assets,
    recommendations: recommendations
      .slice(0, COMMAND_EVIDENCE_LIMITS.recommendations)
      .map((row) => shapeRecommendation(row)),
    recommendation,
    proposal: proposal?.id ? { id: proposal.id, type: proposal.type ?? null, target_id: proposal.target_id ?? null, status: proposal.status ?? "pending" } : null,
    tool_activity: activity,
    missing_tools: [...missing],
    partial: missing.length > 0,
    generated_at: now.toISOString(),
  };
}
