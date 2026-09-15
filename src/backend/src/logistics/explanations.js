// Human-readable explanation strings (A-9 `reasons[]`) rendered from the frozen
// factor values produced by the deterministic services. No score computation here.

const pct = (value) => `${value >= 0 ? "+" : ""}${Math.round(value * 100)}%`;
const hours = (value) => `${value >= 0 ? "+" : ""}${value} h`;

export function routeReasons(option) {
  const f = option.factors;
  const reasons = [
    `${pct(f.cost_delta_pct)} cost vs the current route`,
    `${hours(f.eta_delta_h)} transit vs the current route`,
    `capacity margin ${Math.round(f.capacity_margin * 100)}%`,
  ];
  if (f.residual_risk > 0) {
    reasons.push(`residual risk ${f.residual_risk} from other active disruptions`);
  }
  return reasons;
}

export function carrierReasons(option) {
  const f = option.factors;
  const reasons = routeReasons(option);
  if (typeof f.carrier_reliability === "number") {
    reasons.push(`carrier reliability ${Math.round(f.carrier_reliability * 100)}%`);
  }
  if (f.backing_route_id) {
    reasons.push(`uses route ${f.backing_route_id}`);
  }
  return reasons;
}

export function redeploymentReasons(candidate) {
  const f = candidate.factors;
  const reasons = [
    `${f.distance_km} km from the shipment's next node`,
    `idle for ${Math.round(f.idle_minutes / 6) / 10} h`,
    `capacity fit ${Math.round(f.capacity_fit * 100)}%`,
  ];
  if (f.contention_count > 1) {
    reasons.push(`also a top candidate for ${f.contention_count - 1} other shipment(s) — allocate manually`);
  }
  if (f.target_approximate) {
    reasons.push("target location approximated from the route origin");
  }
  return reasons;
}
