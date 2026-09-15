// Affected-shipment detection (R1) — frozen rules from scope-freeze.md §1.2 + Phase 1A A-1/A-2.
// Pure functions: no database access; all inputs are injected for deterministic tests.

export const STATUS_RANK = {
  critical: 5,
  blocked: 4,
  delayed: 3,
  unknown_review: 2,
  at_risk: 1,
  unaffected: 0,
};

export const ACTIVE_SHIPMENT_STATUSES = ["planned", "in_transit", "delayed"];

export function isDisruptionActive(disruption, now = new Date()) {
  const start = new Date(disruption.start_time);
  const end = disruption.end_time ? new Date(disruption.end_time) : null;
  return (
    disruption.status === "active" &&
    start <= now &&
    (end === null || end >= now)
  );
}

// Segment planned window from the shipment's planned departure + cumulative durations (A-1/A-3).
export function plannedWindow(shipment, routeSegments, segment) {
  if (!shipment.planned_departure) return null;
  const departure = new Date(shipment.planned_departure);
  let offsetMinutes = 0;
  for (const s of routeSegments) {
    if (s.seq < segment.seq) offsetMinutes += Number(s.planned_duration_hours) * 60;
  }
  const start = new Date(departure.getTime() + offsetMinutes * 60_000);
  const end = new Date(start.getTime() + Number(segment.planned_duration_hours) * 3_600_000);
  return { start, end };
}

// ON | BEFORE | PAST | UNKNOWN — derived from current_segment_id sequence.
export function relativePosition(shipment, routeSegments, segment) {
  if (shipment.current_segment_id === segment.id) return "ON";
  if (!shipment.current_segment_id) return "UNKNOWN";
  const current = routeSegments.find((s) => s.id === shipment.current_segment_id);
  if (!current) return "UNKNOWN";
  if (current.seq > segment.seq) return "PAST";
  if (current.seq < segment.seq) return "BEFORE";
  return "UNKNOWN";
}

export function classifyMatch({ shipment, routeSegments, segment, disruption, now = new Date() }) {
  const window = plannedWindow(shipment, routeSegments, segment);
  let position = relativePosition(shipment, routeSegments, segment);
  if (position === "UNKNOWN" && window) {
    position = now < window.start ? "BEFORE" : now <= window.end ? "ON" : "PAST";
  }

  const dStart = new Date(disruption.start_time);
  const dEnd = disruption.end_time ? new Date(disruption.end_time) : null;
  const severity = Number(disruption.severity);
  const base = {
    segment_id: segment.id,
    disruption_id: disruption.id,
    severity,
    timing_basis: window ? "planned" : "unknown",
  };

  if (position === "ON") {
    return { ...base, status: severity >= 4 ? "critical" : "blocked", reason: "currently_in_affected_segment" };
  }
  if (position === "PAST") {
    if (window && window.end < dStart) {
      return { ...base, status: "unaffected", reason: "segment_passed_before_disruption" };
    }
    return { ...base, status: "delayed", reason: "traversed_during_disruption" };
  }
  if (position === "BEFORE") {
    if (!window) return { ...base, status: "at_risk", reason: "timing_unknown" };
    if (dEnd && window.start > dEnd) {
      return { ...base, status: "unaffected", reason: "arrival_after_disruption_end" };
    }
    if (dEnd && window.start <= dEnd) {
      return { ...base, status: "delayed", reason: "planned_arrival_during_disruption" };
    }
    return { ...base, status: "at_risk", reason: "disruption_end_unknown" };
  }
  return { ...base, status: "unknown_review", reason: "position_unknown" };
}

function worstMatch(matches) {
  return matches.reduce((worst, current) =>
    STATUS_RANK[current.status] > STATUS_RANK[worst.status] ? current : worst,
  );
}

function buildReason(match, routeId, segment) {
  return `route ${routeId} segment ${segment.id} (${segment.region_code}) matches disruption ${match.disruption_id}; ${match.reason}`;
}

function confidenceFor(status, timingBasis) {
  if (status === "unknown_review" || timingBasis === "unknown") return "low";
  if (status === "critical" || status === "blocked" || status === "delayed") return "high";
  return "medium";
}

// Impact scores (frozen formula): 0.4*cargo_value_norm + 0.4*deadline_urgency_norm + 0.2*is_cold_chain.
export function impactScores(rows, now = new Date()) {
  const values = rows.map((row) => Number(row.shipment.cargo_value_usd) || 0);
  const urgencyRaw = rows.map((row) => {
    const hours = (new Date(row.shipment.deadline).getTime() - now.getTime()) / 3_600_000;
    return Math.min(1, Math.max(0, 1 - hours / 168)); // 7-day horizon, clamped
  });
  const minMax = (arr) => {
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    return (value) => (max === min ? 0.5 : (value - min) / (max - min));
  };
  const valueNorm = minMax(values);
  const urgencyNorm = minMax(urgencyRaw);

  const scores = new Map();
  rows.forEach((row, index) => {
    const cargo = valueNorm(values[index]);
    const urgency = urgencyNorm(urgencyRaw[index]);
    const cold = row.shipment.is_cold_chain ? 1 : 0;
    const score = 0.4 * cargo + 0.4 * urgency + 0.2 * cold;
    scores.set(row.shipment.id, {
      impact_score: Math.round(score * 1000) / 1000,
      impact_factors: {
        cargo_value_norm: Math.round(cargo * 1000) / 1000,
        deadline_urgency_norm: Math.round(urgency * 1000) / 1000,
        is_cold_chain: row.shipment.is_cold_chain,
      },
    });
  });
  return scores;
}

// Main matching entry point. segmentsByRoute: Map<route_id, segment[]>
// includeDelivered: additive option for endpoint 3.5 `include_delivered=true`
// (delivered shipments become candidates for inspection; default false keeps the
// frozen rule and all ground-truth comparisons unchanged).
export function matchShipments({
  shipments,
  routes,
  segmentsByRoute,
  disruptions,
  now = new Date(),
  includeDelivered = false,
}) {
  const active = disruptions.filter((d) => isDisruptionActive(d, now));
  const regionIndex = new Map();
  for (const disruption of active) {
    const list = regionIndex.get(disruption.region_code) ?? [];
    list.push(disruption);
    regionIndex.set(disruption.region_code, list);
  }

  const routeIndex = new Map(routes.map((route) => [route.id, route]));
  const rows = [];

  const allowedStatuses = includeDelivered
    ? [...ACTIVE_SHIPMENT_STATUSES, "delivered"]
    : ACTIVE_SHIPMENT_STATUSES;

  for (const shipment of shipments) {
    if (!allowedStatuses.includes(shipment.status)) continue;

    const route = routeIndex.get(shipment.route_id);
    const segments = route ? (segmentsByRoute.get(route.id) ?? []) : [];

    if (!route || segments.length === 0) {
      rows.push({
        shipment,
        impact_status: "unknown_review",
        match_reason: "route_data_missing",
        matched_segment_ids: [],
        matched_disruptions: [],
        timing_basis: "unknown",
        confidence: "low",
      });
      continue;
    }

    const matches = [];
    for (const segment of segments) {
      if (!segment.region_code) {
        matches.push({
          segment_id: segment.id,
          disruption_id: null,
          status: "unknown_review",
          reason: "region_missing",
          timing_basis: "unknown",
        });
        continue;
      }
      for (const disruption of regionIndex.get(segment.region_code) ?? []) {
        matches.push(classifyMatch({ shipment, routeSegments: segments, segment, disruption, now }));
      }
    }

    if (matches.length === 0) continue; // unaffected, not listed

    const worst = worstMatch(matches);
    if (worst.status === "unaffected") continue; // A-1: no temporal exposure, excluded

    const worstSegment = segments.find((s) => s.id === worst.segment_id) ?? segments[0];
    rows.push({
      shipment,
      impact_status: worst.status,
      match_reason: buildReason(worst, shipment.route_id, worstSegment),
      matched_segment_ids: [...new Set(matches.filter((m) => m.status !== "unaffected").map((m) => m.segment_id))],
      matched_disruptions: matches
        .filter((m) => m.status !== "unaffected")
        .map((m) => ({ disruption_id: m.disruption_id, severity: m.severity ?? null, status: m.status, reason: m.reason })),
      timing_basis: worst.timing_basis ?? "unknown",
      confidence: confidenceFor(worst.status, worst.timing_basis ?? "unknown"),
    });
  }

  const scores = impactScores(rows, now);
  for (const row of rows) {
    const scored = scores.get(row.shipment.id);
    row.impact_score = scored?.impact_score ?? 0;
    row.impact_factors = scored?.impact_factors ?? {};
  }

  rows.sort((a, b) => {
    if (b.impact_score !== a.impact_score) return b.impact_score - a.impact_score;
    if (STATUS_RANK[b.impact_status] !== STATUS_RANK[a.impact_status]) {
      return STATUS_RANK[b.impact_status] - STATUS_RANK[a.impact_status];
    }
    const deadlineDiff = new Date(a.shipment.deadline) - new Date(b.shipment.deadline);
    if (deadlineDiff !== 0) return deadlineDiff;
    return a.shipment.id.localeCompare(b.shipment.id);
  });

  return rows;
}
