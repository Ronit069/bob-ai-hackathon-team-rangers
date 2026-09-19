// Contract-shaped test fixtures (hand-written from api-contract.md examples).
// These are test doubles only — the running application never uses mock data.

export const disruptionsList = {
  data: [
    {
      id: "D01",
      type: "port_strike",
      region_code: "IN-WEST-COAST",
      start_time: "2026-09-14T06:00:00Z",
      end_time: "2026-09-17T06:00:00Z",
      severity: 4,
      status: "active",
      description: "Dock workers strike at Mumbai port.",
      created_by: "operator-1",
      created_at: "2026-09-14T06:05:00Z",
      is_currently_active: true,
    },
  ],
  count: 1,
};

export const affectedList = {
  data: [
    {
      shipment: {
        id: "S001",
        cargo_type: "electronics",
        is_cold_chain: false,
        cargo_value_usd: 310000,
        deadline: "2026-09-18T09:00:00Z",
        status: "in_transit",
      },
      impact_status: "critical",
      match_reason: "route R001 segment SEG-001 matches disruption D01; currently_in_affected_segment",
      matched_segment_ids: ["SEG-001", "SEG-002"],
      matched_disruptions: [
        { disruption_id: "D01", severity: 4, status: "critical", reason: "currently_in_affected_segment" },
      ],
      timing_basis: "planned",
      confidence: "high",
      impact_score: 0.477,
      impact_factors: { cargo_value_norm: 1, deadline_urgency_norm: 0.5, is_cold_chain: false },
    },
  ],
  count: 1,
  disruption_id: "D01",
  computed_at: "2026-09-15T08:00:00Z",
};

export const shipmentsList = {
  data: [
    {
      id: "S026",
      cargo_type: "vaccine",
      is_cold_chain: true,
      status: "in_transit",
      deadline: "2026-09-18T09:00:00Z",
    },
  ],
  count: 1,
};

export const shipmentDetail = {
  id: "S001",
  route_id: "R001",
  cargo_type: "electronics",
  is_cold_chain: false,
  cargo_value_usd: 310000,
  volume_units: 20,
  deadline: "2026-09-18T09:00:00Z",
  status: "in_transit",
  current_segment_id: "SEG-001",
  planned_departure: "2026-09-11T09:00:00Z",
  planned_arrival: "2026-09-17T09:00:00Z",
  actual_departure: "2026-09-11T09:30:00Z",
  actual_arrival: null,
  route: { id: "R001", origin_node: "INMUM", destination_node: "AEJEA", planned_cost_usd: 84000, planned_duration_hours: 144 },
  carrier: { id: "C01", name: "BlueWave Shipping", status: "active", reliability_score: 0.94 },
  segments: [
    { id: "SEG-001", route_id: "R001", seq: 1, region_code: "IN-WEST-COAST", mode: "sea", planned_duration_hours: 96, capacity_units: 220, cost_usd: 14000 },
    { id: "SEG-002", route_id: "R001", seq: 2, region_code: "AE-JEBEL-ALI", mode: "sea", planned_duration_hours: 48, capacity_units: 220, cost_usd: 9000 },
  ],
  current_segment: { id: "SEG-001", seq: 1, region_code: "IN-WEST-COAST" },
  next_segment: { id: "SEG-002", seq: 2, region_code: "AE-JEBEL-ALI" },
  route_capacity: 220,
};

export const routeAlternatives = {
  data: [
    {
      route: { id: "R006", origin_node: "SGSIN", destination_node: "NLRTM", carrier_id: "C04" },
      carrier: { id: "C04", name: "HarborLink Freight", status: "active", reliability_score: 0.83 },
      score: 0.4,
      factors: {
        cost_delta_pct: -8,
        eta_delta_h: 10,
        capacity_margin: 0.25,
        residual_risk: 0,
        estimated_cost_usd: 88000,
        carrier_reliability: 0.83,
        confidence_level: "medium",
        confidence_drivers: ["single_feasible_candidate"],
      },
      constraints_checked: ["route_active", "carrier_active", "capacity_ok"],
      reasons: ["-8% cost vs the current route", "+10 h transit vs the current route", "capacity margin 25%"],
    },
  ],
  rejected: [{ route_id: "R002", rejected_reason: "disrupted_region_overlap" }],
  count: 1,
  not_actionable: false,
};

export const carrierAlternatives = {
  data: [],
  rejected: [
    { carrier_id: "C09", rejected_reason: "carrier_inactive" },
    { carrier_id: "C02", rejected_reason: "no_feasible_route" },
  ],
  count: 0,
  not_actionable: false,
};

export const fleetList = {
  data: [
    {
      asset: { id: "A007", type: "container", refrigerated: true, capacity_units: 12, current_region_code: "SG-SINGAPORE" },
      operational_state: "available",
      idle_minutes: null,
      next_assignment: null,
      anomalies: ["missing_availability_timestamp"],
    },
    {
      asset: { id: "A008", type: "truck", refrigerated: false, capacity_units: 10, current_region_code: "IN-WEST-COAST" },
      operational_state: "maintenance",
      idle_minutes: null,
      next_assignment: null,
      anomalies: [],
    },
  ],
  count: 2,
  computed_at: "2026-09-15T08:00:00Z",
};

export const idleList = {
  data: [
    {
      asset: { id: "A001", type: "truck", refrigerated: false, capacity_units: 16, current_region_code: "SG-SINGAPORE" },
      idle_minutes: 975,
      idle_since: "2026-09-14T03:20:00Z",
    },
  ],
  excluded: [{ asset_id: "A002", reason: "reserved", until: "2026-09-16T21:00:00Z" }],
  count: 1,
};

export const redeploymentCandidates = {
  data: [
    {
      asset: { id: "A021", type: "truck", refrigerated: true, capacity_units: 15, current_region_code: "AE-JEBEL-ALI" },
      score: 0.77,
      factors: { distance_km: 1.2, idle_minutes: 900, capacity_fit: 1, contention_count: 2, target_approximate: false, confidence_level: "high", confidence_drivers: [] },
      constraints_checked: ["asset_available", "not_reserved", "capacity_ok", "refrigeration_ok", "within_radius"],
      reasons: ["1.2 km from the shipment's next node", "idle for 15 h", "capacity fit 100%", "also a top candidate for 1 other shipment(s) — allocate manually"],
    },
  ],
  rejected: [{ asset_id: "A004", rejected_reason: "outside_radius", details: { distance_km: 240 } }],
  excluded: [{ asset_id: "A002", reason: "reserved", until: "2026-09-16T21:00:00Z" }],
  count: 1,
};

export const alertsList = {
  data: [
    { type: "excursion", severity: "critical", shipment_id: "S038", excursion_id: "EX-0001", summary: "Peak deviation 1.2°C, 75 min", human_review_required: true },
    { type: "sensor_failure", shipment_id: "S031", sensor_id: "SEN-031", summary: "No readings for 600 minutes", human_review_required: true },
  ],
  count: 2,
};

export const excursionsList = {
  data: [
    {
      id: "EX-0001",
      shipment_id: "S026",
      policy_id: "TP-VACCINE",
      start_time: "2026-09-14T04:00:00Z",
      end_time: "2026-09-14T04:45:00Z",
      duration_min: 45,
      peak_deviation_c: 2.4,
      severity: "major",
      severity_rationale: "duration>tolerance;magnitude<=major",
      data_quality: "complete",
      status: "open",
      post_delivery: false,
      time_to_delivery_hours: 25,
      recommended_action: "Review and consider intervention",
    },
  ],
  count: 1,
};

export const readings = {
  data: [
    { id: "SR-000001", timestamp: "2026-09-14T04:00:00Z", temperature_c: 4.5 },
    { id: "SR-000002", timestamp: "2026-09-14T04:15:00Z", temperature_c: 4.8 },
    { id: "SR-000003", timestamp: "2026-09-14T04:30:00Z", temperature_c: 8.8 },
  ],
  count: 3,
  quality: { gaps: 0, duplicates: 0, out_of_order: 0, implausible: 0, sensor_status: "reporting" },
  sensor: {
    sensor_id: "SEN-026",
    status: "reporting",
    expected_interval_min: 15,
    last_reading_at: "2026-09-14T04:30:00Z",
    minutes_since_last: 12,
    readings_count: 97,
    gap_count: 0,
    failure_since: null,
  },
  policy: { id: "TP-VACCINE", min_c: 2, max_c: 8 },
};

export const policies = {
  data: [
    {
      id: "TP-VACCINE",
      cargo_type: "vaccine",
      min_c: 2,
      max_c: 8,
      max_excursion_minutes: 15,
      minor_deviation_c: 1,
      major_deviation_c: 3,
      critical_duration_minutes: 60,
      version: 1,
      effective_from: "2026-08-01T00:00:00Z",
      updated_by: "operator-1",
    },
    {
      id: "TP-VACCINE_LOT_X",
      cargo_type: "vaccine_lot_x",
      min_c: 2,
      max_c: 8,
      max_excursion_minutes: 15,
      minor_deviation_c: 1,
      major_deviation_c: 3,
      critical_duration_minutes: 60,
      version: 1,
      effective_from: "2026-08-01T00:00:00Z",
      updated_by: "operator-1",
    },
    {
      id: "TP-PERISHABLE_EXOTIC",
      cargo_type: "perishable_exotic",
      min_c: 0,
      max_c: 4,
      max_excursion_minutes: 20,
      minor_deviation_c: 1,
      major_deviation_c: 3,
      critical_duration_minutes: 90,
      version: 1,
      effective_from: "2026-08-01T00:00:00Z",
      updated_by: "operator-1",
    },
  ],
  count: 3,
};

export const risk = {
  shipment_id: "S039",
  disruption_risk: 0.856,
  coldchain_risk: 0.6,
  combined_score: 0.728,
  factors: {
    disruption: { impact_score: 0.856, affected_disruption_ids: ["D01"], impact_status: "critical" },
    coldchain: {
      worst_excursion_id: "EX-0002",
      severity: "major",
      peak_deviation_c: 2.4,
      duration_min: 45,
      time_to_delivery_hours: 25,
      data_quality: "complete",
      cargo_sensitivity: 0.9,
      excursion_count: 1,
      confidence_level: "high",
      confidence_drivers: [],
      recommended_action: "Review and consider intervention",
      human_review_required: true,
    },
    weights: { alpha: 0.5, beta: 0.5 },
  },
  computed_at: "2026-09-15T08:00:00Z",
};

export const riskOverview = {
  data: [
    {
      shipment: { id: "S039", cargo_type: "vaccine", is_cold_chain: true, status: "in_transit", deadline: "2026-09-18T09:00:00Z" },
      ...risk,
    },
  ],
  count: 1,
  computed_at: "2026-09-15T08:00:00Z",
};

export const recommendationsList = {
  data: [
    {
      id: "REC-0001",
      type: "reroute",
      shipment_id: "S040",
      route_id: "R006",
      carrier_id: null,
      asset_id: null,
      score: 0.4,
      factors: { estimated_cost_usd: 88000 },
      constraints_checked: ["capacity_ok"],
      rejected_alternatives: [],
      status: "pending",
      created_at: "2026-09-15T08:00:00Z",
      decided_at: null,
      decided_by: null,
      notes: null,
    },
  ],
  count: 1,
};

export const auditList = {
  data: [
    {
      id: "AUD-000001",
      entity_type: "recommendation",
      entity_id: "REC-0001",
      action: "decided_accepted",
      actor: "operator-1",
      timestamp: "2026-09-15T08:05:00Z",
      details: { decision: "accepted", notes: "Approved after capacity check" },
    },
  ],
  count: 1,
};

export const bobAnswer = {
  answer: "3 shipments are affected: S102, S140, S177.",
  evidence: [
    { tool: "get_affected_shipments", input: { disruption_id: "D01" }, output: { data: [{ shipment: { id: "S001" } }], count: 1 } },
  ],
  tool_calls: 1,
};

export const bobUnavailable = {
  error: {
    code: "BOB_UNAVAILABLE",
    message: "Bob is disabled (BOB_ENABLED=false)",
    details: { reason: "bob_disabled" },
  },
};
