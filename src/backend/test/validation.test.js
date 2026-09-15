import test from "node:test";
import assert from "node:assert/strict";
import {
  parse,
  shipmentSchema,
  carrierSchema,
  routeSegmentSchema,
  temperaturePolicySchema,
  sensorReadingInputSchema,
  decisionInputSchema,
  recommendationSchema,
  riskAssessmentSchema,
} from "../src/common/validation.js";

const validShipment = {
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
  actual_departure: "2026-09-05T12:40:00Z",
  actual_arrival: null,
};

test("valid shipment passes validation", () => {
  const parsed = parse(shipmentSchema, validShipment);
  assert.equal(parsed.id, "S102");
});

test("required-field validation: missing shipment id fails", () => {
  const { id, ...withoutId } = validShipment;
  assert.throws(() => parse(shipmentSchema, withoutId), (error) => error.code === "VALIDATION_ERROR");
});

test("invalid enum: unknown shipment status fails", () => {
  assert.throws(
    () => parse(shipmentSchema, { ...validShipment, status: "lost" }),
    (error) => error.code === "VALIDATION_ERROR",
  );
});

test("unknown fields are rejected (strict schemas)", () => {
  assert.throws(
    () => parse(shipmentSchema, { ...validShipment, priority: "high" }),
    (error) => error.code === "VALIDATION_ERROR",
  );
});

test("delivered shipment requires actual_arrival", () => {
  assert.throws(
    () => parse(shipmentSchema, { ...validShipment, status: "delivered" }),
    (error) => error.code === "VALIDATION_ERROR",
  );
  const delivered = { ...validShipment, status: "delivered", actual_arrival: "2026-09-17T05:00:00Z" };
  assert.equal(parse(shipmentSchema, delivered).status, "delivered");
});

test("planned window must be coherent", () => {
  assert.throws(
    () => parse(shipmentSchema, { ...validShipment, planned_arrival: "2026-09-01T00:00:00Z" }),
    (error) => error.code === "VALIDATION_ERROR",
  );
});

test("carrier reliability range is enforced", () => {
  const carrier = {
    id: "C07",
    name: "BlueWave Shipping",
    service_regions: ["IN-WEST-COAST", "EU-ROTTERDAM"],
    modes: ["sea"],
    capacity_units: 900,
    cost_index: 1.05,
    reliability_score: 0.94,
    status: "active",
  };
  assert.equal(parse(carrierSchema, carrier).id, "C07");
  assert.throws(
    () => parse(carrierSchema, { ...carrier, reliability_score: 1.4 }),
    (error) => error.code === "VALIDATION_ERROR",
  );
});

test("segment region must come from the controlled vocabulary", () => {
  const segment = {
    id: "SEG-012",
    route_id: "R045",
    seq: 2,
    name: "SEA-1 Mumbai–Jebel Ali",
    region_code: "IN-WEST-COAST",
    mode: "sea",
    origin_node: "INMUM",
    destination_node: "AEJEA",
    distance_km: 1930.0,
    planned_duration_hours: 96.0,
    capacity_units: 220,
    cost_usd: 14000,
    dest_lat: 25.0128,
    dest_lon: 55.0614,
  };
  assert.equal(parse(routeSegmentSchema, segment).region_code, "IN-WEST-COAST");
  assert.throws(
    () => parse(routeSegmentSchema, { ...segment, region_code: "ATLANTIS" }),
    (error) => error.code === "VALIDATION_ERROR",
  );
});

test("policy thresholds must be ordered", () => {
  const policy = {
    id: "TP-VACCINE",
    cargo_type: "vaccine",
    min_c: 2.0,
    max_c: 8.0,
    max_excursion_minutes: 15,
    minor_deviation_c: 1.0,
    major_deviation_c: 3.0,
    critical_duration_minutes: 60,
    version: 1,
    effective_from: "2026-08-01T00:00:00Z",
    updated_by: "operator-1",
  };
  assert.equal(parse(temperaturePolicySchema, policy).id, "TP-VACCINE");
  assert.throws(
    () => parse(temperaturePolicySchema, { ...policy, max_c: 1.0 }),
    (error) => error.code === "VALIDATION_ERROR",
  );
  assert.throws(
    () => parse(temperaturePolicySchema, { ...policy, critical_duration_minutes: 10 }),
    (error) => error.code === "VALIDATION_ERROR",
  );
});

test("sensor reading rejects future timestamps", () => {
  const future = new Date(Date.now() + 24 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  assert.throws(
    () =>
      parse(sensorReadingInputSchema, {
        shipment_id: "S102",
        sensor_id: "SEN-004",
        timestamp: future,
        temperature_c: 9.4,
        source: "simulated",
      }),
    (error) => error.code === "VALIDATION_ERROR",
  );
});

test("decision 'modified' requires a payload", () => {
  assert.throws(
    () => parse(decisionInputSchema, { decision: "modified", actor: "operator-1" }),
    (error) => error.code === "VALIDATION_ERROR",
  );
  assert.equal(
    parse(decisionInputSchema, { decision: "accepted", actor: "operator-1" }).decision,
    "accepted",
  );
});

test("recommendation target must match its type", () => {
  const base = {
    id: "REC-0009",
    shipment_id: "S102",
    score: 0.81,
    factors: {},
    constraints_checked: ["capacity_ok"],
    rejected_alternatives: [],
    status: "pending",
  };
  assert.throws(
    () => parse(recommendationSchema, { ...base, type: "reroute", carrier_id: "C09" }),
    (error) => error.code === "VALIDATION_ERROR",
  );
  assert.equal(parse(recommendationSchema, { ...base, type: "reroute", route_id: "R089" }).type, "reroute");
});

test("risk assessment requires the nested factor structure (RC-3)", () => {
  const flat = {
    id: "RSK-0012",
    shipment_id: "S102",
    disruption_risk: 0.78,
    coldchain_risk: 0.3,
    combined_score: 0.54,
    factors: { impact_score: 0.86 },
  };
  assert.throws(() => parse(riskAssessmentSchema, flat), (error) => error.code === "VALIDATION_ERROR");

  const nested = {
    ...flat,
    factors: {
      disruption: { impact_score: 0.86 },
      coldchain: { severity: "warning" },
      weights: { alpha: 0.5, beta: 0.5 },
    },
  };
  assert.equal(parse(riskAssessmentSchema, nested).id, "RSK-0012");
});
