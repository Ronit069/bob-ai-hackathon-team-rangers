import test from "node:test";
import assert from "node:assert/strict";
import { matchShipments, plannedWindow } from "../src/logistics/matching.service.js";
import { routeAlternatives, carrierAlternatives } from "../src/logistics/alternatives.service.js";
import { idleAssets, redeploymentCandidates, haversineKm } from "../src/logistics/fleet.service.js";
import { detectExcursions, classifySeverity } from "../src/coldchain/excursion.service.js";
import { coldchainRisk, combinedScore } from "../src/risk/risk.service.js";

const NOW = new Date("2026-09-14T09:00:00Z");

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const segment = (over = {}) => ({
  id: "SEG-012",
  route_id: "R045",
  seq: 2,
  name: "SEA-1 Mumbai–Jebel Ali",
  region_code: "IN-WEST-COAST",
  mode: "sea",
  origin_node: "INMUM",
  destination_node: "AEJEA",
  distance_km: 1930,
  planned_duration_hours: 96,
  capacity_units: 220,
  cost_usd: 14000,
  dest_lat: 25.0128,
  dest_lon: 55.0614,
  ...over,
});

const routeSegmentsR045 = [
  segment({ id: "SEG-011", seq: 1, region_code: "SG-SINGAPORE", planned_duration_hours: 120 }),
  segment(),
  segment({ id: "SEG-013", seq: 3, region_code: "AE-JEBEL-ALI", planned_duration_hours: 72 }),
];

const shipment = (over = {}) => ({
  id: "S102",
  route_id: "R045",
  cargo_type: "vaccine",
  is_cold_chain: true,
  cargo_value_usd: 520000,
  volume_units: 12,
  deadline: "2026-09-18T10:00:00Z",
  status: "in_transit",
  current_segment_id: "SEG-012",
  planned_departure: "2026-09-05T12:00:00Z",
  planned_arrival: "2026-09-17T06:00:00Z",
  ...over,
});

const disruption = (over = {}) => ({
  id: "D01",
  type: "port_strike",
  region_code: "IN-WEST-COAST",
  start_time: "2026-09-14T06:00:00Z",
  end_time: "2026-09-17T06:00:00Z",
  severity: 4,
  status: "active",
  description: "strike",
  created_by: "op",
  ...over,
});

const routes = [{ id: "R045", origin_node: "INMUM", destination_node: "NLRTM", carrier_id: "C07", status: "active" }];
const segmentsByRoute = new Map([["R045", routeSegmentsR045]]);

// ---------------------------------------------------------------------------
// Matching (R1)
// ---------------------------------------------------------------------------
test("matching: planned window converts hour durations correctly (regression)", () => {
  const segments = [
    segment({ id: "SEG-011", seq: 1, region_code: "SG-SINGAPORE", planned_duration_hours: 120 }),
    segment({ id: "SEG-012", seq: 2, planned_duration_hours: 96 }),
  ];
  const window = plannedWindow(shipment({ planned_departure: "2026-09-05T12:00:00Z" }), segments, segments[1]);
  assert.equal(window.start.toISOString(), "2026-09-10T12:00:00.000Z");
  assert.equal(window.end.toISOString(), "2026-09-14T12:00:00.000Z");
});

test("matching: ON segment with severity 4 → critical", () => {
  const rows = matchShipments({
    shipments: [shipment()],
    routes,
    segmentsByRoute,
    disruptions: [disruption()],
    now: NOW,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].impact_status, "critical");
  assert.match(rows[0].match_reason, /SEG-012/);
  assert.deepEqual(rows[0].matched_segment_ids, ["SEG-012"]);
});

test("matching: ON segment with severity 3 → blocked", () => {
  const rows = matchShipments({
    shipments: [shipment()],
    routes,
    segmentsByRoute,
    disruptions: [disruption({ severity: 3 })],
    now: NOW,
  });
  assert.equal(rows[0].impact_status, "blocked");
});

test("matching: planned arrival during known disruption → delayed", () => {
  const rows = matchShipments({
    shipments: [shipment({ current_segment_id: "SEG-011", planned_departure: "2026-09-11T12:00:00Z" })],
    routes,
    segmentsByRoute,
    disruptions: [disruption()],
    now: NOW,
  });
  assert.equal(rows[0].impact_status, "delayed");
});

test("matching: open-ended disruption ahead → at_risk", () => {
  const routesR066 = [{ id: "R066", origin_node: "A", destination_node: "B", carrier_id: "C01", status: "active" }];
  const segmentsR066 = new Map([
    [
      "R066",
      [
        segment({ id: "SEG-060", route_id: "R066", seq: 1, region_code: "IN-WEST-COAST", planned_duration_hours: 48 }),
        segment({ id: "SEG-061", route_id: "R066", seq: 2, region_code: "SG-SINGAPORE", planned_duration_hours: 96 }),
      ],
    ],
  ]);
  const rows = matchShipments({
    shipments: [shipment({ id: "S177", route_id: "R066", current_segment_id: "SEG-060", planned_departure: "2026-09-12T00:00:00Z" })],
    routes: routesR066,
    segmentsByRoute: segmentsR066,
    disruptions: [disruption({ id: "D02", region_code: "SG-SINGAPORE", end_time: null, severity: 3 })],
    now: NOW,
  });
  assert.equal(rows[0].impact_status, "at_risk");
});

test("matching: segment passed before disruption start → unaffected and excluded (A-1)", () => {
  const rows = matchShipments({
    shipments: [shipment({ id: "S088", current_segment_id: "SEG-013", planned_departure: "2026-09-01T12:00:00Z" })],
    routes,
    segmentsByRoute,
    disruptions: [disruption()],
    now: NOW,
  });
  assert.equal(rows.length, 0);
});

test("matching: arrival after known disruption end → unaffected and excluded (A-1)", () => {
  const routesR052 = [{ id: "R052", origin_node: "A", destination_node: "B", carrier_id: "C01", status: "active" }];
  const segmentsR052 = new Map([
    [
      "R052",
      [
        segment({ id: "SEG-039", route_id: "R052", seq: 1, region_code: "US-EAST-COAST", planned_duration_hours: 168 }),
        segment({ id: "SEG-040", route_id: "R052", seq: 2, region_code: "EU-ROTTERDAM" }),
      ],
    ],
  ]);
  const rows = matchShipments({
    shipments: [shipment({ id: "S140", route_id: "R052", current_segment_id: "SEG-039", planned_departure: "2026-09-12T00:00:00Z" })],
    routes: routesR052,
    segmentsByRoute: segmentsR052,
    disruptions: [disruption({ id: "D03", region_code: "EU-ROTTERDAM", start_time: "2026-09-14T00:00:00Z", end_time: "2026-09-15T00:00:00Z", severity: 2 })],
    now: NOW,
  });
  assert.equal(rows.length, 0);
});

test("matching: missing route data → unknown_review, never dropped", () => {
  const rows = matchShipments({
    shipments: [shipment({ id: "S201", route_id: "R071" })],
    routes,
    segmentsByRoute,
    disruptions: [disruption()],
    now: NOW,
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].impact_status, "unknown_review");
  assert.equal(rows[0].match_reason, "route_data_missing");
});

test("matching: multiple disruptions → worst status wins and both are listed", () => {
  const rows = matchShipments({
    shipments: [shipment()],
    routes,
    segmentsByRoute,
    disruptions: [
      disruption(),
      disruption({ id: "D05", region_code: "AE-JEBEL-ALI", severity: 2, end_time: "2026-09-16T06:00:00Z" }),
    ],
    now: NOW,
  });
  assert.equal(rows[0].impact_status, "critical");
  assert.equal(rows[0].matched_disruptions.length, 2);
});

test("matching: impact score formula produces exact expected values", () => {
  const shipments = [
    shipment({ id: "S001", cargo_value_usd: 520000, deadline: "2026-09-15T03:00:00Z", is_cold_chain: true }),
    shipment({ id: "S002", cargo_value_usd: 20000, deadline: "2026-09-19T09:00:00Z", is_cold_chain: false }),
  ];
  const rows = matchShipments({
    shipments,
    routes,
    segmentsByRoute,
    disruptions: [disruption({ severity: 3 })],
    now: NOW,
  });
  assert.equal(rows[0].shipment.id, "S001");
  assert.equal(rows[0].impact_score, 1.0);
  assert.equal(rows[1].shipment.id, "S002");
  assert.equal(rows[1].impact_score, 0.0);
});

// ---------------------------------------------------------------------------
// Alternatives (R2)
// ---------------------------------------------------------------------------
const altCurrentRoute = {
  id: "R045",
  origin_node: "INMUM",
  destination_node: "NLRTM",
  carrier_id: "C07",
  status: "active",
  planned_cost_usd: 84000,
  planned_duration_hours: 384,
};
const altCarriers = [
  { id: "C07", status: "active", service_regions: ["IN-WEST-COAST", "SG-SINGAPORE"], modes: ["sea"], reliability_score: 0.8 },
  { id: "C09", status: "active", service_regions: ["SG-SINGAPORE", "EU-ROTTERDAM"], modes: ["sea"], reliability_score: 0.94 },
  { id: "C11", status: "active", service_regions: ["SG-SINGAPORE", "EU-ROTTERDAM"], modes: ["sea"], reliability_score: 0.85 },
  { id: "C03", status: "active", service_regions: ["SG-SINGAPORE", "EU-ROTTERDAM"], modes: ["sea"], reliability_score: 0.9 },
  { id: "C05", status: "active", service_regions: ["SG-SINGAPORE", "EU-ROTTERDAM"], modes: ["sea"], reliability_score: 0.7 },
];
const altRoutes = [
  { id: "R089", origin_node: "INMUM", destination_node: "NLRTM", carrier_id: "C09", status: "active", planned_cost_usd: 73920, planned_duration_hours: 390 },
  { id: "R095", origin_node: "INMUM", destination_node: "NLRTM", carrier_id: "C11", status: "active", planned_cost_usd: 79800, planned_duration_hours: 420 },
  { id: "R091", origin_node: "INMUM", destination_node: "NLRTM", carrier_id: "C03", status: "active", planned_cost_usd: 92400, planned_duration_hours: 360 },
  { id: "R100", origin_node: "INMUM", destination_node: "NLRTM", carrier_id: "C05", status: "active", planned_cost_usd: 68000, planned_duration_hours: 400 },
];
const altSegments = new Map([
  ["R089", [segment({ id: "SEG-088", route_id: "R089", seq: 1, region_code: "SG-SINGAPORE", capacity_units: 220 }), segment({ id: "SEG-089", route_id: "R089", seq: 2, region_code: "EU-ROTTERDAM", capacity_units: 220 })]],
  ["R095", [segment({ id: "SEG-090", route_id: "R095", seq: 1, region_code: "SG-SINGAPORE", capacity_units: 100 }), segment({ id: "SEG-091", route_id: "R095", seq: 2, region_code: "EU-ROTTERDAM", capacity_units: 100 })]],
  ["R091", [segment({ id: "SEG-092", route_id: "R091", seq: 1, region_code: "IN-WEST-COAST", capacity_units: 60 }), segment({ id: "SEG-093", route_id: "R091", seq: 2, region_code: "EU-ROTTERDAM", capacity_units: 60 })]],
  ["R100", [segment({ id: "SEG-094", route_id: "R100", seq: 1, region_code: "SG-SINGAPORE", capacity_units: 10 }), segment({ id: "SEG-095", route_id: "R100", seq: 2, region_code: "EU-ROTTERDAM", capacity_units: 10 })]],
]);

test("alternatives: ranked order, exact scores, and rejected reasons", () => {
  const result = routeAlternatives({
    shipment: shipment(),
    currentRoute: altCurrentRoute,
    routes: altRoutes,
    segmentsByRoute: altSegments,
    carriers: altCarriers,
    triggeringRegions: ["IN-WEST-COAST"],
  });
  assert.equal(result.data.length, 2);
  assert.equal(result.data[0].route.id, "R089");
  assert.equal(result.data[0].score, 0.889);
  assert.equal(result.data[1].route.id, "R095");
  assert.equal(result.data[1].score, 0.176);

  const rejected = Object.fromEntries(result.rejected.map((item) => [item.route_id, item.rejected_reason]));
  assert.equal(rejected.R091, "disrupted_region_overlap");
  assert.equal(rejected.R100, "insufficient_capacity");
});

test("alternatives: no feasible route returns a graceful no-option result", () => {
  const result = routeAlternatives({
    shipment: shipment(),
    currentRoute: altCurrentRoute,
    routes: [altRoutes[2]],
    segmentsByRoute: altSegments,
    carriers: altCarriers,
    triggeringRegions: ["IN-WEST-COAST"],
  });
  assert.equal(result.data.length, 0);
  assert.equal(result.no_option_reason, "no_feasible_route");
  assert.equal(result.rejected[0].rejected_reason, "disrupted_region_overlap");
});

test("alternatives: carriers ranked, inactive and unusable carriers rejected", () => {
  const carriers = altCarriers.map((carrier) =>
    carrier.id === "C11" ? { ...carrier, status: "inactive" } : carrier,
  );
  const result = carrierAlternatives({
    shipment: shipment(),
    currentRoute: altCurrentRoute,
    routes: altRoutes,
    segmentsByRoute: altSegments,
    carriers,
    triggeringRegions: ["IN-WEST-COAST"],
  });
  assert.equal(result.data[0].carrier.id, "C09");
  const rejected = Object.fromEntries(result.rejected.map((item) => [item.carrier_id, item.rejected_reason]));
  assert.equal(rejected.C11, "carrier_inactive");
  assert.equal(rejected.C03, "no_feasible_route");
});

// ---------------------------------------------------------------------------
// Fleet (R3)
// ---------------------------------------------------------------------------
const fleetNow = new Date("2026-09-14T09:00:00Z");
const asset = (over = {}) => ({
  id: "A114",
  type: "truck",
  capacity_units: 16,
  refrigerated: true,
  current_lat: 25.0128,
  current_lon: 55.0614,
  current_region_code: "IN-WEST-COAST",
  status: "available",
  available_since: "2026-09-14T02:48:00Z",
  ...over,
});

test("fleet: idle duration is derived from available_since", () => {
  const result = idleAssets({ assets: [asset()], assignments: [], now: fleetNow });
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].idle_minutes, 372);
});

test("fleet: reserved, maintenance and missing-timestamp assets are excluded with reasons", () => {
  const assets = [
    asset({ id: "A077" }),
    asset({ id: "A051", status: "maintenance", available_since: null }),
    asset({ id: "A150", available_since: null }),
  ];
  const assignments = [
    { id: "AA-0001", asset_id: "A077", shipment_id: "S102", start_time: "2026-09-15T08:00:00Z", end_time: "2026-09-15T20:00:00Z", reserved: true, status: "planned" },
  ];
  const result = idleAssets({ assets, assignments, now: fleetNow });
  assert.equal(result.data.length, 0);
  const reasons = Object.fromEntries(result.excluded.map((item) => [item.asset_id, item.reason]));
  assert.equal(reasons.A077, "reserved");
  assert.equal(reasons.A051, "maintenance");
  assert.equal(reasons.A150, "missing_availability_timestamp");
});

test("fleet: redeployment ranking with compatibility and radius filters", () => {
  const assets = [
    asset(),
    asset({ id: "A131", capacity_units: 12, available_since: "2026-09-14T08:00:00Z" }),
    asset({ id: "A098", refrigerated: false }),
    asset({ id: "A202", current_lat: 40.0, current_lon: 55.0 }),
  ];
  const idle = idleAssets({ assets, assignments: [], now: fleetNow });
  const result = redeploymentCandidates({
    shipment: shipment(),
    routeSegments: routeSegmentsR045,
    idle,
    now: fleetNow,
  });

  assert.equal(result.data[0].asset.id, "A114");
  assert.equal(result.data[0].score, 0.74);
  assert.equal(result.data[1].asset.id, "A131");

  const rejected = Object.fromEntries(result.rejected.map((item) => [item.asset_id, item.rejected_reason]));
  assert.equal(rejected.A098, "incompatible_non_refrigerated");
  assert.equal(rejected.A202, "outside_radius");
});

test("fleet: haversine distance is symmetric and zero at identical points", () => {
  assert.equal(haversineKm(25, 55, 25, 55), 0);
  const d1 = haversineKm(25, 55, 40, 55);
  const d2 = haversineKm(40, 55, 25, 55);
  assert.ok(Math.abs(d1 - d2) < 1e-9);
  assert.ok(d1 > 150);
});

// ---------------------------------------------------------------------------
// Excursion detection and severity (R5/R6)
// ---------------------------------------------------------------------------
const policy = {
  id: "TP-VACCINE",
  cargo_type: "vaccine",
  min_c: 2.0,
  max_c: 8.0,
  max_excursion_minutes: 15,
  minor_deviation_c: 1.0,
  major_deviation_c: 3.0,
  critical_duration_minutes: 60,
};
const reading = (time, temperature) => ({
  id: `SR-${time.replace(/[-:TZ]/g, "").slice(4)}`,
  shipment_id: "S102",
  sensor_id: "SEN-004",
  timestamp: `2026-09-14T${time}:00Z`,
  temperature_c: temperature,
  source: "simulated",
});

test("excursion: boundary readings exactly at min/max are within limits", () => {
  const result = detectExcursions({
    shipment: shipment(),
    readings: [reading("08:00", 2.0), reading("08:15", 8.0), reading("08:30", 5.0)],
    policy,
    now: NOW,
  });
  assert.equal(result.excursions.length, 0);
});

test("excursion: short small deviation → warning", () => {
  const result = detectExcursions({
    shipment: shipment(),
    readings: [reading("08:00", 7.2), reading("08:15", 8.8), reading("08:30", 7.9)],
    policy,
    now: NOW,
  });
  assert.equal(result.excursions.length, 1);
  assert.equal(result.excursions[0].severity, "warning");
  assert.equal(result.excursions[0].duration_min, 0);
});

test("excursion: sustained moderate deviation → major", () => {
  const result = detectExcursions({
    shipment: shipment(),
    readings: [
      reading("08:00", 7.0),
      reading("08:15", 10.4),
      reading("08:30", 10.0),
      reading("09:00", 9.1),
      reading("09:15", 7.8),
    ],
    policy,
    now: NOW,
  });
  assert.equal(result.excursions.length, 1);
  assert.equal(result.excursions[0].severity, "major");
  assert.equal(result.excursions[0].duration_min, 45);
  assert.equal(result.excursions[0].peak_deviation_c, 2.4);
  assert.equal(result.excursions[0].end_time, "2026-09-14T09:00:00Z");
});

test("excursion: long small-magnitude deviation → critical (B-8 duration branch)", () => {
  const result = detectExcursions({
    shipment: shipment(),
    readings: [
      reading("08:00", 9.2),
      reading("08:15", 9.2),
      reading("08:30", 9.2),
      reading("08:45", 9.2),
      reading("09:00", 9.2),
      reading("09:15", 9.2),
      reading("09:30", 7.5),
    ],
    policy,
    now: NOW,
  });
  assert.equal(result.excursions[0].severity, "critical");
  assert.equal(result.excursions[0].severity_rationale, "duration>critical");
  assert.equal(result.excursions[0].duration_min, 75);
});

test("excursion: breaches 30 minutes apart merge; 45 minutes apart split (B-3)", () => {
  const merged = detectExcursions({
    shipment: shipment(),
    readings: [reading("08:00", 9.0), reading("08:15", 7.0), reading("08:30", 9.0), reading("08:45", 7.0)],
    policy,
    now: NOW,
  });
  assert.equal(merged.excursions.length, 1);
  assert.equal(merged.excursions[0].duration_min, 30);

  const split = detectExcursions({
    shipment: shipment(),
    readings: [
      reading("08:00", 9.0),
      reading("08:15", 7.0),
      reading("08:30", 7.0),
      reading("08:45", 9.0),
      reading("09:00", 7.0),
    ],
    policy,
    now: NOW,
  });
  assert.equal(split.excursions.length, 2);
});

test("excursion: gap inside a breach window → unknown_review (missing data is not safe)", () => {
  const result = detectExcursions({
    shipment: shipment(),
    readings: [reading("08:15", 9.4), reading("09:00", 9.1), reading("09:15", 7.5)],
    policy,
    now: NOW,
  });
  assert.equal(result.excursions[0].data_quality, "missing_readings");
  assert.equal(result.excursions[0].severity, "unknown_review");
});

test("excursion: sensor failure status is distinct from a gap", () => {
  const result = detectExcursions({
    shipment: shipment(),
    readings: [reading("08:00", 5.0)],
    policy,
    now: new Date("2026-09-14T09:15:00Z"),
  });
  assert.equal(result.sensorStatus.status, "failed");
});

test("excursion: implausible sole breach → unknown_review, never trusted (B-6)", () => {
  const result = detectExcursions({
    shipment: shipment(),
    readings: [reading("08:00", 65.0), reading("08:15", 5.0)],
    policy,
    now: NOW,
  });
  assert.equal(result.excursions.length, 1);
  assert.equal(result.excursions[0].data_quality, "implausible");
  assert.equal(result.excursions[0].severity, "unknown_review");
});

test("excursion: unknown policy produces a review flag, no fabricated excursion", () => {
  const result = detectExcursions({
    shipment: shipment(),
    readings: [reading("08:00", 9.4)],
    policy: null,
    now: NOW,
  });
  assert.equal(result.excursions.length, 0);
  assert.deepEqual(result.reviewFlags, ["policy_missing"]);
});

test("severity: classifySeverity covers the ladder branches", () => {
  assert.equal(classifySeverity({ durationMin: 0, magnitude: 0.8, policy, dataQuality: "complete" }).severity, "warning");
  assert.equal(classifySeverity({ durationMin: 45, magnitude: 2.4, policy, dataQuality: "complete" }).severity, "major");
  assert.equal(classifySeverity({ durationMin: 15, magnitude: 3.5, policy, dataQuality: "complete" }).severity, "critical");
  assert.equal(classifySeverity({ durationMin: 75, magnitude: 1.2, policy, dataQuality: "complete" }).severity, "critical");
  assert.equal(classifySeverity({ durationMin: 10, magnitude: 0.5, policy, dataQuality: "missing_readings" }).severity, "unknown_review");
});

// ---------------------------------------------------------------------------
// Risk (P2)
// ---------------------------------------------------------------------------
test("risk: cold-chain severity weights and worst-excursion rule", () => {
  assert.equal(coldchainRisk({ excursions: [] }).risk_score, 0);
  assert.equal(coldchainRisk({ excursions: [{ id: "EX-1", severity: "warning", status: "open" }] }).risk_score, 0.3);
  const worst = coldchainRisk({
    excursions: [
      { id: "EX-1", severity: "warning", status: "open" },
      { id: "EX-2", severity: "critical", status: "open" },
    ],
  });
  assert.equal(worst.risk_score, 1.0);
  assert.equal(worst.worst_excursion_id, "EX-2");
  assert.equal(coldchainRisk({ reviewFlags: ["policy_missing"] }).risk_score, 0.5);
  assert.equal(coldchainRisk({ excursions: [{ id: "EX-3", severity: "major", status: "closed" }] }).risk_score, 0);
});

test("risk: combined score arithmetic (alpha=beta=0.5)", () => {
  assert.equal(combinedScore({ disruptionRisk: 0.78, coldchainRisk: 0.3 }), 0.54);
  assert.equal(combinedScore({ disruptionRisk: 0.4, coldchainRisk: 1.0 }), 0.7);
  assert.equal(combinedScore({ disruptionRisk: 0.78, coldchainRisk: 0.3, alpha: 0.6, beta: 0.4 }), 0.588);
});
