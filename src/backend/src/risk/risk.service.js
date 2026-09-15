// Combined risk (P2) — frozen baseline (scope-freeze.md §1.2 + member-2-combined-risk.md).
// Pure functions: inputs are injected; no database access.

export const SEVERITY_WEIGHTS = {
  normal: 0.0,
  warning: 0.3,
  major: 0.6,
  critical: 1.0,
  unknown_review: 0.5,
};

const SEVERITY_RANK = { critical: 4, major: 3, warning: 2, unknown_review: 1 };

export const round3 = (value) => Math.round(value * 1000) / 1000;

// Cold-chain risk = severity weight of the worst OPEN excursion; review flags score 0.5.
export function coldchainRisk({ excursions = [], reviewFlags = [] } = {}) {
  const open = excursions.filter((excursion) => excursion.status !== "closed");

  if (open.length > 0) {
    const worst = open.reduce((current, candidate) =>
      SEVERITY_RANK[candidate.severity] > SEVERITY_RANK[current.severity] ? candidate : current,
    );
    return {
      risk_score: round3(SEVERITY_WEIGHTS[worst.severity] ?? 0),
      severity: worst.severity,
      worst_excursion_id: worst.id ?? null,
      excursion_count: open.length,
      review_flags: [],
      confidence_level: worst.data_quality === "complete" ? "high" : "low",
      confidence_drivers: worst.data_quality === "complete" ? [] : [`data_quality:${worst.data_quality}`],
    };
  }

  if (reviewFlags.length > 0) {
    return {
      risk_score: 0.5,
      severity: "unknown_review",
      worst_excursion_id: null,
      excursion_count: 0,
      review_flags: reviewFlags,
      confidence_level: "low",
      confidence_drivers: reviewFlags,
    };
  }

  return {
    risk_score: 0,
    severity: "normal",
    worst_excursion_id: null,
    excursion_count: 0,
    review_flags: [],
    confidence_level: "high",
    confidence_drivers: [],
  };
}

// combined_score = alpha * disruption_risk + beta * coldchain_risk (defaults 0.5/0.5).
export function combinedScore({ disruptionRisk, coldchainRisk: coldRisk, alpha = 0.5, beta = 0.5 }) {
  return round3(alpha * Number(disruptionRisk) + beta * Number(coldRisk));
}
