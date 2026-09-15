// Route and carrier alternatives (R2) — frozen filters/scoring (scope-freeze.md §1.2 + A-4/A-8).
// Pure functions: inputs are injected; no database access.

export const DEFAULT_WEIGHTS = { w1: 0.35, w2: 0.35, w3: 0.20, w4: 0.10 };

export const round3 = (value) => Math.round(value * 1000) / 1000;
const clamp01 = (value) => Math.min(1, Math.max(0, value));

export function normalize(value, values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return 0.5;
  return (value - min) / (max - min);
}

export function routeCapacity(segments) {
  return Math.min(...segments.map((segment) => Number(segment.capacity_units)));
}

// Residual risk = severity-weighted share of route duration passing through OTHER active disruptions (A-8).
export function residualRisk(route, segments, otherDisruptions) {
  if (!otherDisruptions || otherDisruptions.length === 0) return 0;
  const totalHours = Number(route.planned_duration_hours);
  let riskHours = 0;
  for (const segment of segments) {
    for (const disruption of otherDisruptions) {
      if (segment.region_code === disruption.region_code) {
        riskHours += (Number(disruption.severity) / 5) * Number(segment.planned_duration_hours);
      }
    }
  }
  return clamp01(riskHours / totalHours);
}

function firstFailedRouteConstraint({ route, segments, carrier, shipment, currentRouteId, triggeringRegions }) {
  if (route.status !== "active") return "route_inactive";
  if (!carrier || carrier.status !== "active") return "carrier_inactive";
  if (route.id === currentRouteId) return "same_as_current";
  if (segments.length === 0) return "missing_segments";
  if (segments.some((segment) => triggeringRegions.includes(segment.region_code))) return "disrupted_region_overlap";
  if (segments.some((segment) => !segment.capacity_units || Number(segment.capacity_units) <= 0)) {
    return "missing_capacity_data";
  }
  if (routeCapacity(segments) < Number(shipment.volume_units)) return "insufficient_capacity";
  return null;
}

function servesRegions(carrier, segments) {
  if (!carrier) return false;
  const originRegion = segments[0]?.region_code;
  const destinationRegion = segments[segments.length - 1]?.region_code;
  return carrier.service_regions.includes(originRegion) && carrier.service_regions.includes(destinationRegion);
}

function modeCompatible(carrier, segments) {
  if (!carrier) return false;
  const routeModes = new Set(segments.map((segment) => segment.mode));
  return carrier.modes.some((mode) => routeModes.has(mode));
}

function confidenceFor(feasibleCount, shipment) {
  const drivers = [];
  if (feasibleCount === 1) drivers.push("single_feasible_candidate");
  if (!shipment.planned_departure) drivers.push("planned_times_missing");
  const level = drivers.length === 0 ? "high" : feasibleCount === 0 ? "low" : "medium";
  return { level, drivers };
}

// Route alternatives for a shipment.
export function routeAlternatives({
  shipment,
  currentRoute,
  routes,
  segmentsByRoute,
  carriers,
  triggeringRegions = [],
  otherDisruptions = [],
  weights = DEFAULT_WEIGHTS,
  limit = 5,
}) {
  const carrierIndex = new Map(carriers.map((carrier) => [carrier.id, carrier]));
  const feasible = [];
  const rejected = [];

  const sameOD = routes.filter(
    (route) =>
      route.origin_node === currentRoute.origin_node &&
      route.destination_node === currentRoute.destination_node,
  );

  for (const route of sameOD) {
    const segments = segmentsByRoute.get(route.id) ?? [];
    const carrier = carrierIndex.get(route.carrier_id);
    const reason = firstFailedRouteConstraint({
      route,
      segments,
      carrier,
      shipment,
      currentRouteId: currentRoute.id,
      triggeringRegions,
    });
    if (reason) {
      rejected.push({ route_id: route.id, rejected_reason: reason });
      continue;
    }
    feasible.push({ route, segments, carrier });
  }

  if (feasible.length === 0) {
    return { data: [], rejected, count: 0, no_option_reason: "no_feasible_route" };
  }

  const costs = feasible.map((item) => Number(item.route.planned_cost_usd));
  const durations = feasible.map((item) => Number(item.route.planned_duration_hours));
  const currentCost = Number(currentRoute.planned_cost_usd);
  const currentDuration = Number(currentRoute.planned_duration_hours);

  const scored = feasible.map((item) => {
    const capacity = routeCapacity(item.segments);
    const margin = (capacity - Number(shipment.volume_units)) / capacity;
    const residual = residualRisk(item.route, item.segments, otherDisruptions);
    const score = clamp01(
      weights.w1 * (1 - normalize(Number(item.route.planned_cost_usd), costs)) +
        weights.w2 * (1 - normalize(Number(item.route.planned_duration_hours), durations)) +
        weights.w3 * margin -
        weights.w4 * residual,
    );
    return {
      route: item.route,
      carrier: item.carrier,
      score: round3(score),
      factors: {
        cost_delta_pct: round3(((Number(item.route.planned_cost_usd) - currentCost) / currentCost) * 100),
        eta_delta_h: round3(Number(item.route.planned_duration_hours) - currentDuration),
        capacity_margin: round3(margin),
        residual_risk: round3(residual),
        estimated_cost_usd: Number(item.route.planned_cost_usd),
        estimated_eta: new Date(Date.now() + Number(item.route.planned_duration_hours) * 3_600_000).toISOString(),
        carrier_reliability: item.carrier?.reliability_score ?? null,
        confidence_level: confidenceFor(feasible.length, shipment).level,
        confidence_drivers: confidenceFor(feasible.length, shipment).drivers,
      },
      constraints_checked: [
        "route_active",
        "carrier_active",
        "avoids_triggering_disruption",
        "route_differs_from_current",
        "capacity_ok",
        "capacity_data_complete",
      ],
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.factors.estimated_cost_usd !== b.factors.estimated_cost_usd) {
      return a.factors.estimated_cost_usd - b.factors.estimated_cost_usd;
    }
    return a.route.id.localeCompare(b.route.id);
  });

  return { data: scored.slice(0, limit), rejected, count: scored.length, no_option_reason: null };
}

// Carrier alternatives: best feasible route per carrier.
export function carrierAlternatives({
  shipment,
  currentRoute,
  routes,
  segmentsByRoute,
  carriers,
  triggeringRegions = [],
  otherDisruptions = [],
  weights = DEFAULT_WEIGHTS,
  limit = 5,
}) {
  const byCarrier = new Map();
  for (const carrier of carriers) {
    if (carrier.id === currentRoute.carrier_id) continue;
    const carrierRoutes = routes.filter((route) => route.carrier_id === carrier.id);
    byCarrier.set(carrier.id, { carrier, routes: carrierRoutes });
  }

  const rejected = [];
  const options = [];

  for (const [carrierId, group] of byCarrier) {
    const { carrier, routes: carrierRoutes } = group;
    if (carrier.status !== "active") {
      rejected.push({ carrier_id: carrierId, rejected_reason: "carrier_inactive" });
      continue;
    }

    const result = routeAlternatives({
      shipment,
      currentRoute,
      routes: carrierRoutes,
      segmentsByRoute,
      carriers: [carrier],
      triggeringRegions,
      otherDisruptions,
      weights,
      limit: 1,
    });

    const best = result.data[0];
    if (!best) {
      rejected.push({ carrier_id: carrierId, rejected_reason: "no_feasible_route" });
      continue;
    }

    const segments = segmentsByRoute.get(best.route.id) ?? [];
    if (!servesRegions(carrier, segments)) {
      rejected.push({ carrier_id: carrierId, rejected_reason: "carrier_missing_regions" });
      continue;
    }
    if (!modeCompatible(carrier, segments)) {
      rejected.push({ carrier_id: carrierId, rejected_reason: "mode_incompatible" });
      continue;
    }

    options.push({
      carrier,
      backing_route: best.route,
      score: best.score,
      factors: {
        ...best.factors,
        carrier_reliability: carrier.reliability_score,
        backing_route_id: best.route.id,
      },
      constraints_checked: [...best.constraints_checked, "carrier_serves_regions", "mode_compatible"],
    });
  }

  if (options.length === 0) {
    return { data: [], rejected, count: 0, no_option_reason: "no_feasible_carrier" };
  }

  options.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.factors.estimated_cost_usd !== b.factors.estimated_cost_usd) {
      return a.factors.estimated_cost_usd - b.factors.estimated_cost_usd;
    }
    return a.carrier.id.localeCompare(b.carrier.id);
  });

  return { data: options.slice(0, limit), rejected, count: options.length, no_option_reason: null };
}
