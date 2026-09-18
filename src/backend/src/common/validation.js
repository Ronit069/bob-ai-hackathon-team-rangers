import { z } from "zod";
import { AppError } from "./errors.js";

// ---------------------------------------------------------------------------
// Controlled vocabularies (data-contract.md §1.1/§1.2)
// ---------------------------------------------------------------------------
export const REGION_CODES = [
  "IN-WEST-COAST",
  "AE-JEBEL-ALI",
  "SG-SINGAPORE",
  "CN-EAST-COAST",
  "US-WEST-COAST",
  "EU-ROTTERDAM",
  "US-EAST-COAST",
  "IN-NORTH-ICD",
];
export const MODES = ["sea", "road", "rail", "air"];
export const CARGO_TYPES = [
  "vaccine",
  "insulin",
  "fresh_produce",
  "frozen_food",
  "pharma_generic",
  "electronics",
  "apparel",
  "machinery",
];
export const SHIPMENT_STATUSES = ["planned", "in_transit", "delayed", "delivered", "cancelled"];
export const DISRUPTION_TYPES = ["weather", "port_strike", "geopolitical", "customs", "infrastructure"];
export const DISRUPTION_STATUSES = ["scheduled", "active", "resolved"];
export const ASSET_TYPES = ["truck", "container", "vessel"];
export const ASSET_STATUSES = ["available", "maintenance", "retired"];
export const ASSIGNMENT_STATUSES = ["planned", "active", "completed", "cancelled"];
export const EXCURSION_SEVERITIES = ["warning", "major", "critical", "unknown_review"];
export const EXCURSION_DATA_QUALITY = [
  "complete",
  "missing_readings",
  "sensor_failure",
  "out_of_order",
  "implausible",
];
export const EXCURSION_STATUSES = ["open", "acknowledged", "closed"];
export const RECOMMENDATION_TYPES = ["reroute", "carrier_change", "fleet_redeployment"];
export const RECOMMENDATION_STATUSES = ["pending", "accepted", "rejected", "modified"];
export const AUDIT_ENTITY_TYPES = [
  "shipment",
  "route",
  "carrier",
  "disruption",
  "fleet_asset",
  "sensor_reading",
  "temperature_policy",
  "temperature_excursion",
  "recommendation",
  "risk_assessment",
];
export const AUDIT_ACTIONS = [
  "created",
  "updated",
  "activated",
  "deactivated",
  "ingested",
  "policy_updated",
  "decided_accepted",
  "decided_rejected",
  "decided_modified",
  "acknowledged",
  "closed",
];

// ---------------------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------------------
export const isoUtc = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/, "must be ISO 8601 UTC ending in Z");

const region = z.enum(REGION_CODES);
const mode = z.enum(MODES);
const cargoType = z.enum(CARGO_TYPES);
const nonEmpty = z.string().trim().min(1);

// ---------------------------------------------------------------------------
// Entity schemas (data-contract.md + Phase 1A amendments)
// ---------------------------------------------------------------------------
export const carrierSchema = z
  .object({
    id: z.string().regex(/^C\d{2}$/, "must match C##"),
    name: nonEmpty,
    service_regions: z.array(region).min(1),
    modes: z.array(mode).min(1),
    capacity_units: z.number().int().positive(),
    cost_index: z.number().min(0.5).max(2.0),
    reliability_score: z.number().min(0).max(1),
    status: z.enum(["active", "inactive"]),
  })
  .strict();

export const routeSchema = z
  .object({
    id: z.string().regex(/^R\d{3}$/, "must match R###"),
    origin_node: nonEmpty,
    destination_node: nonEmpty,
    carrier_id: z.string().regex(/^C\d{2}$/, "must match C##"),
    status: z.enum(["active", "inactive"]),
    total_distance_km: z.number().positive(),
    planned_duration_hours: z.number().positive(),
    planned_cost_usd: z.number().int().positive(),
    created_at: isoUtc.optional(),
  })
  .strict()
  .refine((value) => value.origin_node !== value.destination_node, {
    message: "origin_node and destination_node must differ",
    path: ["destination_node"],
  });

export const routeSegmentSchema = z
  .object({
    id: z.string().regex(/^SEG-\d{3}$/, "must match SEG-###"),
    route_id: z.string().regex(/^R\d{3}$/, "must match R###"),
    seq: z.number().int().min(1),
    name: nonEmpty,
    region_code: region,
    mode,
    origin_node: nonEmpty,
    destination_node: nonEmpty,
    distance_km: z.number().positive(),
    planned_duration_hours: z.number().positive(),
    capacity_units: z.number().int().positive(),
    cost_usd: z.number().int().positive(),
    dest_lat: z.number().min(-90).max(90),
    dest_lon: z.number().min(-180).max(180),
  })
  .strict();

export const shipmentSchema = z
  .object({
    id: z.string().regex(/^S\d{3}$/, "must match S###"),
    route_id: z.string().regex(/^R\d{3}$/, "must match R###"),
    cargo_type: cargoType,
    is_cold_chain: z.boolean(),
    cargo_value_usd: z.number().int().min(0),
    volume_units: z.number().int().positive(),
    deadline: isoUtc,
    status: z.enum(SHIPMENT_STATUSES),
    current_segment_id: z
      .string()
      .regex(/^SEG-\d{3}$/, "must match SEG-###")
      .nullable()
      .optional(),
    planned_departure: isoUtc,
    planned_arrival: isoUtc,
    actual_departure: isoUtc.nullable().optional(),
    actual_arrival: isoUtc.nullable().optional(),
    created_at: isoUtc.optional(),
    updated_at: isoUtc.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Date(value.planned_arrival) <= new Date(value.planned_departure)) {
      ctx.addIssue({ code: "custom", message: "planned_arrival must be after planned_departure", path: ["planned_arrival"] });
    }
    if (
      value.actual_departure &&
      value.actual_arrival &&
      new Date(value.actual_arrival) <= new Date(value.actual_departure)
    ) {
      ctx.addIssue({ code: "custom", message: "actual_arrival must be after actual_departure", path: ["actual_arrival"] });
    }
    if (value.status === "delivered" && !value.actual_arrival) {
      ctx.addIssue({ code: "custom", message: "actual_arrival is required when status = delivered", path: ["actual_arrival"] });
    }
  });

export const disruptionSchema = z
  .object({
    id: z.string().regex(/^D\d{2}$/, "must match D##"),
    type: z.enum(DISRUPTION_TYPES),
    region_code: region,
    start_time: isoUtc,
    end_time: isoUtc.nullable().optional(),
    severity: z.number().int().min(1).max(5),
    status: z.enum(DISRUPTION_STATUSES),
    description: nonEmpty,
    created_by: nonEmpty,
    created_at: isoUtc.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.end_time && new Date(value.end_time) <= new Date(value.start_time)) {
      ctx.addIssue({ code: "custom", message: "end_time must be after start_time", path: ["end_time"] });
    }
  });

export const fleetAssetSchema = z
  .object({
    id: z.string().regex(/^A\d{3}$/, "must match A###"),
    type: z.enum(ASSET_TYPES),
    capacity_units: z.number().int().positive(),
    refrigerated: z.boolean(),
    current_lat: z.number().min(-90).max(90),
    current_lon: z.number().min(-180).max(180),
    current_region_code: region,
    status: z.enum(ASSET_STATUSES),
    available_since: isoUtc.nullable().optional(),
    created_at: isoUtc.optional(),
  })
  .strict();

export const assetAssignmentSchema = z
  .object({
    id: z.string().regex(/^AA-\d{4}$/, "must match AA-####"),
    asset_id: z.string().regex(/^A\d{3}$/, "must match A###"),
    shipment_id: z.string().regex(/^S\d{3}$/, "must match S###"),
    start_time: isoUtc,
    end_time: isoUtc,
    reserved: z.boolean(),
    status: z.enum(ASSIGNMENT_STATUSES),
    created_at: isoUtc.optional(),
  })
  .strict()
  .refine((value) => new Date(value.end_time) > new Date(value.start_time), {
    message: "end_time must be after start_time",
    path: ["end_time"],
  });

export const cargoProfileSchema = z
  .object({
    cargo_type: cargoType,
    display_name: nonEmpty,
    is_cold_chain: z.boolean(),
    sensitivity_weight: z.number().min(0).max(1),
    policy_required: z.boolean(),
    notes: z.string().nullable().optional(),
  })
  .strict();

export const temperaturePolicySchema = z
  .object({
    id: z.string().regex(/^TP-[A-Z0-9_]+$/, "must match TP-<CARGO_TYPE>"),
    cargo_type: cargoType,
    min_c: z.number(),
    max_c: z.number(),
    max_excursion_minutes: z.number().int().min(0),
    minor_deviation_c: z.number().positive(),
    major_deviation_c: z.number().positive(),
    critical_duration_minutes: z.number().int().positive(),
    version: z.number().int().min(1),
    effective_from: isoUtc,
    updated_by: nonEmpty,
    updated_at: isoUtc.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.min_c >= value.max_c) {
      ctx.addIssue({ code: "custom", message: "min_c must be below max_c", path: ["min_c"] });
    }
    if (value.major_deviation_c <= value.minor_deviation_c) {
      ctx.addIssue({ code: "custom", message: "major_deviation_c must exceed minor_deviation_c", path: ["major_deviation_c"] });
    }
    if (value.critical_duration_minutes <= value.max_excursion_minutes) {
      ctx.addIssue({
        code: "custom",
        message: "critical_duration_minutes must exceed max_excursion_minutes",
        path: ["critical_duration_minutes"],
      });
    }
  });

export const sensorReadingSchema = z
  .object({
    id: z.string().regex(/^SR-\d{6}$/, "must match SR-######"),
    shipment_id: z.string().regex(/^S\d{3}$/, "must match S###"),
    sensor_id: z.string().regex(/^SEN-\d{3}$/, "must match SEN-###"),
    timestamp: isoUtc,
    temperature_c: z.number(),
    humidity_pct: z.number().min(0).max(100).nullable().optional(),
    source: z.enum(["simulated", "manual"]),
    created_at: isoUtc.optional(),
  })
  .strict();

export const temperatureExcursionSchema = z
  .object({
    id: z.string().regex(/^EX-\d{4}$/, "must match EX-####"),
    shipment_id: z.string().regex(/^S\d{3}$/, "must match S###"),
    policy_id: z.string().regex(/^TP-[A-Z0-9_]+$/).nullable().optional(),
    start_time: isoUtc,
    end_time: isoUtc.nullable().optional(),
    peak_deviation_c: z.number().min(0),
    duration_min: z.number().int().min(0),
    severity: z.enum(EXCURSION_SEVERITIES),
    severity_rationale: nonEmpty,
    data_quality: z.enum(EXCURSION_DATA_QUALITY),
    detected_at: isoUtc.optional(),
    status: z.enum(EXCURSION_STATUSES),
    post_delivery: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.end_time && new Date(value.end_time) < new Date(value.start_time)) {
      ctx.addIssue({ code: "custom", message: "end_time must not be before start_time", path: ["end_time"] });
    }
  });

export const recommendationSchema = z
  .object({
    id: z.string().regex(/^REC-\d{4}$/, "must match REC-####"),
    type: z.enum(RECOMMENDATION_TYPES),
    shipment_id: z.string().regex(/^S\d{3}$/, "must match S###"),
    route_id: z.string().regex(/^R\d{3}$/).nullable().optional(),
    carrier_id: z.string().regex(/^C\d{2}$/).nullable().optional(),
    asset_id: z.string().regex(/^A\d{3}$/).nullable().optional(),
    score: z.number().min(0).max(1),
    factors: z.record(z.any()),
    constraints_checked: z.array(z.string()).min(1),
    rejected_alternatives: z.array(z.any()),
    status: z.enum(RECOMMENDATION_STATUSES),
    created_at: isoUtc.optional(),
    decided_at: isoUtc.nullable().optional(),
    decided_by: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const targets = [
      value.type === "reroute" && value.route_id,
      value.type === "carrier_change" && value.carrier_id,
      value.type === "fleet_redeployment" && value.asset_id,
    ].filter(Boolean);
    const expected =
      (value.type === "reroute" && value.route_id) ||
      (value.type === "carrier_change" && value.carrier_id) ||
      (value.type === "fleet_redeployment" && value.asset_id);
    if (targets.length !== 1 || !expected) {
      ctx.addIssue({ code: "custom", message: `type ${value.type} requires exactly its matching target id`, path: ["type"] });
    }
  });

export const riskAssessmentSchema = z
  .object({
    id: z.string().regex(/^RSK-\d{4}$/, "must match RSK-####"),
    shipment_id: z.string().regex(/^S\d{3}$/, "must match S###"),
    disruption_risk: z.number().min(0).max(1),
    coldchain_risk: z.number().min(0).max(1),
    combined_score: z.number().min(0).max(1),
    factors: z
      .object({
        disruption: z.record(z.any()),
        coldchain: z.record(z.any()),
        weights: z.record(z.any()),
      })
      .strict(),
    computed_at: isoUtc.optional(),
  })
  .strict();

export const auditRecordSchema = z
  .object({
    id: z.string().regex(/^AUD-\d{6}$/, "must match AUD-######"),
    entity_type: z.enum(AUDIT_ENTITY_TYPES),
    entity_id: nonEmpty,
    action: z.enum(AUDIT_ACTIONS),
    actor: nonEmpty,
    timestamp: isoUtc.optional(),
    details: z.record(z.any()).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Input schemas (API boundary)
// ---------------------------------------------------------------------------
export const createDisruptionInputSchema = z
  .object({
    type: z.enum(DISRUPTION_TYPES),
    region_code: region,
    start_time: isoUtc,
    end_time: isoUtc.nullable().optional(),
    severity: z.number().int().min(1).max(5),
    status: z.enum(DISRUPTION_STATUSES),
    description: nonEmpty,
    created_by: nonEmpty,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.end_time && new Date(value.end_time) <= new Date(value.start_time)) {
      ctx.addIssue({ code: "custom", message: "end_time must be after start_time", path: ["end_time"] });
    }
  });

export const sensorReadingInputSchema = sensorReadingSchema
  .omit({ id: true, created_at: true })
  .superRefine((value, ctx) => {
    if (new Date(value.timestamp).getTime() > Date.now() + 60_000) {
      ctx.addIssue({ code: "custom", message: "timestamp must not be in the future", path: ["timestamp"] });
    }
  });

export const decisionInputSchema = z
  .object({
    decision: z.enum(["accepted", "rejected", "modified"]),
    actor: nonEmpty.optional().default("operator-1"),
    notes: z.string().optional(),
    modified_payload: z.record(z.any()).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.decision === "modified" && !value.modified_payload) {
      ctx.addIssue({ code: "custom", message: "modified requires modified_payload", path: ["modified_payload"] });
    }
  });

export const excursionStatusInputSchema = z
  .object({
    status: z.enum(["acknowledged", "closed"]),
    actor: nonEmpty.optional().default("operator-1"),
    note: z.string().optional(),
  })
  .strict();

export const policyUpdateInputSchema = z
  .object({
    min_c: z.number(),
    max_c: z.number(),
    max_excursion_minutes: z.number().int().min(0),
    minor_deviation_c: z.number().positive(),
    major_deviation_c: z.number().positive(),
    critical_duration_minutes: z.number().int().positive(),
    updated_by: nonEmpty.optional().default("operator-1"),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.min_c >= value.max_c) {
      ctx.addIssue({ code: "custom", message: "min_c must be below max_c", path: ["min_c"] });
    }
    if (value.major_deviation_c <= value.minor_deviation_c) {
      ctx.addIssue({ code: "custom", message: "major_deviation_c must exceed minor_deviation_c", path: ["major_deviation_c"] });
    }
    if (value.critical_duration_minutes <= value.max_excursion_minutes) {
      ctx.addIssue({
        code: "custom",
        message: "critical_duration_minutes must exceed max_excursion_minutes",
        path: ["critical_duration_minutes"],
      });
    }
  });

// ---------------------------------------------------------------------------
// Query schemas (Phase 3 — list/filter endpoints)
// ---------------------------------------------------------------------------
const boolQuery = z.union([
  z.boolean(),
  z.literal("true").transform(() => true),
  z.literal("false").transform(() => false),
]);
const limitQuery = (fallback, max = 500) => z.coerce.number().int().min(1).max(max).default(fallback);

export const disruptionListQuerySchema = z
  .object({
    status: z.enum(DISRUPTION_STATUSES).optional(),
    region_code: region.optional(),
    limit: limitQuery(50),
  })
  .strict();

export const disruptionPatchSchema = z
  .object({
    status: z.enum(["active", "resolved"]).optional(),
    end_time: isoUtc.nullable().optional(),
    severity: z.number().int().min(1).max(5).optional(),
    description: nonEmpty.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "at least one field is required" });

export const affectedShipmentsQuerySchema = z
  .object({ include_delivered: boolQuery.default(false) })
  .strict();

export const shipmentListQuerySchema = z
  .object({
    status: z.enum(SHIPMENT_STATUSES).optional(),
    is_cold_chain: boolQuery.optional(),
    disruption_id: z.string().regex(/^D\d{2}$/, "must match D##").optional(),
    region_code: region.optional(),
    limit: limitQuery(100),
  })
  .strict();

export const alternativesQuerySchema = z
  .object({
    limit: limitQuery(5, 20),
    include_rejected: boolQuery.default(true),
  })
  .strict();

export const idleQuerySchema = z
  .object({
    region_code: region.optional(),
    min_idle_minutes: z.coerce.number().int().min(0).default(0),
    limit: limitQuery(100),
  })
  .strict();

export const fleetQuerySchema = z
  .object({
    region_code: region.optional(),
    type: z.enum(ASSET_TYPES).optional(),
    state: z.enum(["available", "assigned", "reserved", "maintenance", "retired"]).optional(),
    limit: limitQuery(100),
  })
  .strict();

export const carrierListQuerySchema = z
  .object({
    status: z.enum(["active", "inactive"]).optional(),
    region_code: region.optional(),
    mode: mode.optional(),
    limit: limitQuery(100),
  })
  .strict();

// ---------------------------------------------------------------------------
// Phase 3 write schemas (endpoints 24/25)
// ---------------------------------------------------------------------------
export const recommendationCreateInputSchema = z
  .object({
    type: z.enum(RECOMMENDATION_TYPES),
    shipment_id: z.string().regex(/^S\d{3}$/, "must match S###"),
    route_id: z.string().regex(/^R\d{3}$/, "must match R###").optional(),
    carrier_id: z.string().regex(/^C\d{2}$/, "must match C##").optional(),
    asset_id: z.string().regex(/^A\d{3}$/, "must match A###").optional(),
    actor: nonEmpty.optional().default("operator-1"),
    notes: z.string().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const targets = [
      value.type === "reroute" && value.route_id,
      value.type === "carrier_change" && value.carrier_id,
      value.type === "fleet_redeployment" && value.asset_id,
    ].filter(Boolean);
    if (targets.length !== 1) {
      ctx.addIssue({
        code: "custom",
        message: `type ${value.type} requires exactly its matching target id`,
        path: ["type"],
      });
    }
  });

export const fleetRedeploymentInputSchema = z
  .object({
    shipment_id: z.string().regex(/^S\d{3}$/, "must match S###"),
    asset_id: z.string().regex(/^A\d{3}$/, "must match A###"),
    actor: nonEmpty.optional().default("operator-1"),
    notes: z.string().optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Phase 3B schemas (cold-chain, shared, Bob)
// ---------------------------------------------------------------------------
export const sensorReadingsEnvelopeSchema = z
  .object({ readings: z.array(z.unknown()).min(1).max(500) })
  .strict();

export const sensorReadingsQuerySchema = z
  .object({
    from: isoUtc.optional(),
    to: isoUtc.optional(),
    order: z.enum(["asc", "desc"]).default("asc"),
  })
  .strict();

export const excursionsQuerySchema = z
  .object({
    shipment_id: z.string().regex(/^S\d{3}$/, "must match S###").optional(),
    severity: z.enum(EXCURSION_SEVERITIES).optional(),
    status: z.enum(EXCURSION_STATUSES).optional(),
    active_only: boolQuery.optional(),
    limit: limitQuery(200),
  })
  .strict();

export const policiesQuerySchema = z.object({ include_history: boolQuery.default(false) }).strict();

export const riskQuerySchema = z.object({ refresh: boolQuery.default(true) }).strict();

export const overviewQuerySchema = z
  .object({
    limit: limitQuery(25, 200),
    include_zero: boolQuery.default(false),
  })
  .strict();

export const recommendationsQuerySchema = z
  .object({
    shipment_id: z.string().regex(/^S\d{3}$/, "must match S###").optional(),
    status: z.enum(RECOMMENDATION_STATUSES).optional(),
    type: z.enum(RECOMMENDATION_TYPES).optional(),
    limit: limitQuery(200),
  })
  .strict();

export const auditQuerySchema = z
  .object({
    entity_type: z.enum(AUDIT_ENTITY_TYPES).optional(),
    entity_id: nonEmpty.optional(),
    limit: limitQuery(100),
    order: z.enum(["asc", "desc"]).default("desc"),
  })
  .strict();

export const bobQuerySchema = z
  .object({
    prompt: nonEmpty,
    context: z.record(z.any()).optional(),
  })
  .strict();

export const incidentBriefInputSchema = z
  .object({
    shipment_id: z.string().regex(/^S\d{3}$/, "must match S###"),
  })
  .strict();

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError("VALIDATION_ERROR", "Invalid input", {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }
  return result.data;
}
