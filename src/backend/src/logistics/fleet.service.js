// Fleet utilisation and redeployment (R3) — frozen rules (scope-freeze.md §1.2 + A-7).
// Pure functions: inputs are injected; no database access.

export const DEFAULT_REDEPLOY_RADIUS_KM = 150;
export const IDLE_CAP_MINUTES = 1440; // 24 h cap for the idle score

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const minutesBetween = (a, b) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000);

// Derived operational state (never stored): available | assigned | reserved | maintenance | retired
export function deriveOperationalState(asset, assignments = [], now = new Date()) {
  if (asset.status === "maintenance") return "maintenance";
  if (asset.status === "retired") return "retired";

  const active = assignments.find(
    (a) => a.status === "active" && new Date(a.start_time) <= now && new Date(a.end_time) > now,
  );
  if (active) return "assigned";

  const future = assignments.find((a) => new Date(a.end_time) >= now && a.status !== "cancelled");
  if (future) return "reserved";

  return "available";
}

// Idle detection (A-7): available + no active assignment + no future commitment.
export function idleAssets({ assets, assignments, now = new Date() }) {
  const data = [];
  const excluded = [];
  const byAsset = new Map();
  for (const assignment of assignments) {
    const list = byAsset.get(assignment.asset_id) ?? [];
    list.push(assignment);
    byAsset.set(assignment.asset_id, list);
  }

  for (const asset of assets) {
    const assetAssignments = byAsset.get(asset.id) ?? [];

    if (asset.status === "maintenance") {
      excluded.push({ asset_id: asset.id, reason: "maintenance" });
      continue;
    }
    if (asset.status === "retired") {
      excluded.push({ asset_id: asset.id, reason: "retired" });
      continue;
    }

    const active = assetAssignments.find(
      (a) => a.status === "active" && new Date(a.start_time) <= now && new Date(a.end_time) > now,
    );
    if (active) {
      excluded.push({ asset_id: asset.id, reason: "currently_assigned", until: active.end_time });
      continue;
    }

    const future = assetAssignments.find((a) => new Date(a.end_time) >= now && a.status !== "cancelled");
    if (future) {
      excluded.push({
        asset_id: asset.id,
        reason: future.reserved ? "reserved" : "unprotected_future_assignment",
        until: future.start_time,
      });
      continue;
    }

    if (!asset.available_since) {
      excluded.push({ asset_id: asset.id, reason: "missing_availability_timestamp" });
      continue;
    }

    data.push({
      asset,
      idle_minutes: minutesBetween(asset.available_since, now),
      idle_since: asset.available_since,
    });
  }

  data.sort((a, b) => {
    if (b.idle_minutes !== a.idle_minutes) return b.idle_minutes - a.idle_minutes;
    return a.asset.id.localeCompare(b.asset.id);
  });

  return { data, excluded };
}

// Redeployment ranking (A-7): 0.45*proximity + 0.35*idle + 0.20*capacity_fit.
export function redeploymentCandidates({
  shipment,
  routeSegments = [],
  idle,
  now = new Date(),
  radiusKm = DEFAULT_REDEPLOY_RADIUS_KM,
  contentionCounts = new Map(),
}) {
  const currentSegment = shipment.current_segment_id
    ? routeSegments.find((segment) => segment.id === shipment.current_segment_id)
    : null;
  const targetSegment = currentSegment ?? routeSegments[0] ?? null;
  const targetApproximate = !currentSegment;

  if (!targetSegment) {
    return { data: [], rejected: [], excluded: idle.excluded, count: 0, no_option_reason: "shipment_target_unknown" };
  }

  const target = { lat: Number(targetSegment.dest_lat), lon: Number(targetSegment.dest_lon) };
  const rejected = [];
  const data = [];

  for (const item of idle.data) {
    const { asset } = item;

    if (Number(asset.capacity_units) < Number(shipment.volume_units)) {
      rejected.push({ asset_id: asset.id, rejected_reason: "insufficient_capacity" });
      continue;
    }
    if (shipment.is_cold_chain && !asset.refrigerated) {
      rejected.push({ asset_id: asset.id, rejected_reason: "incompatible_non_refrigerated" });
      continue;
    }

    const distanceKm = haversineKm(Number(asset.current_lat), Number(asset.current_lon), target.lat, target.lon);
    if (distanceKm > radiusKm) {
      rejected.push({ asset_id: asset.id, rejected_reason: "outside_radius", details: { distance_km: Math.round(distanceKm * 10) / 10 } });
      continue;
    }

    const proximity = 1 - Math.min(distanceKm, radiusKm) / radiusKm;
    const idleScore = Math.min(item.idle_minutes, IDLE_CAP_MINUTES) / IDLE_CAP_MINUTES;
    const capacityFit = Math.min(1, Number(asset.capacity_units) / Number(shipment.volume_units));
    const score = 0.45 * proximity + 0.35 * idleScore + 0.2 * capacityFit;

    data.push({
      asset,
      score: Math.round(score * 1000) / 1000,
      factors: {
        distance_km: Math.round(distanceKm * 10) / 10,
        idle_minutes: item.idle_minutes,
        capacity_fit: Math.round(capacityFit * 1000) / 1000,
        proximity_score: Math.round(proximity * 1000) / 1000,
        idle_score: Math.round(idleScore * 1000) / 1000,
        contention_count: contentionCounts.get(asset.id) ?? 1,
        target_approximate: targetApproximate,
        confidence_level: targetApproximate ? "low" : "high",
        confidence_drivers: targetApproximate ? ["target_approximate"] : [],
      },
      constraints_checked: [
        "asset_available",
        "not_reserved",
        "capacity_ok",
        "refrigeration_ok",
        "within_radius",
      ],
    });
  }

  data.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.factors.distance_km !== b.factors.distance_km) return a.factors.distance_km - b.factors.distance_km;
    if (b.factors.idle_minutes !== a.factors.idle_minutes) return b.factors.idle_minutes - a.factors.idle_minutes;
    return a.asset.id.localeCompare(b.asset.id);
  });

  return {
    data,
    rejected,
    excluded: idle.excluded,
    count: data.length,
    no_option_reason: data.length === 0 ? "no_compatible_asset" : null,
  };
}

// Anomaly detection for the fleet utilisation view (endpoint 26 / A-7 rules).
// Flags are surfaced, never auto-resolved.
export function detectAssetAnomalies(asset, assignments = [], now = new Date()) {
  const anomalies = [];

  if (asset.status === "available" && !asset.available_since) {
    anomalies.push("missing_availability_timestamp");
  }

  const stale = assignments.find(
    (assignment) => assignment.status === "active" && new Date(assignment.end_time) < now,
  );
  if (stale) anomalies.push("stale_assignment");

  const active = assignments
    .filter((assignment) => assignment.status !== "cancelled")
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
  for (let i = 1; i < active.length; i += 1) {
    if (new Date(active[i].start_time) < new Date(active[i - 1].end_time)) {
      anomalies.push("conflicting_assignments");
      break;
    }
  }

  return [...new Set(anomalies)];
}

// Contention: how many affected shipments rank the asset in their top 3.
export function computeContention(candidateSets) {
  const counts = new Map();
  for (const candidates of candidateSets) {
    for (const candidate of candidates.slice(0, 3)) {
      counts.set(candidate.asset.id, (counts.get(candidate.asset.id) ?? 0) + 1);
    }
  }
  return counts;
}
