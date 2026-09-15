// ChainSentinel MCP tool layer — exactly the 11 frozen tools (api-contract.md §5).
// Thin, read-only adapter over the REST API. No business logic, no database access,
// no credentials. Inputs are validated; errors are returned as structured objects.

import { z } from "zod";

// Vocabularies duplicated from data-contract.md §1.1 for early tool-input validation.
// The REST API remains the authority; this only rejects malformed tool calls.
const REGIONS = [
  "IN-WEST-COAST",
  "AE-JEBEL-ALI",
  "SG-SINGAPORE",
  "CN-EAST-COAST",
  "US-WEST-COAST",
  "EU-ROTTERDAM",
  "US-EAST-COAST",
  "IN-NORTH-ICD",
];
const SEVERITIES = ["warning", "major", "critical", "unknown_review"];
const EXCURSION_STATUSES = ["open", "acknowledged", "closed"];
const ENTITY_TYPES = [
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

const shipmentId = z.string().regex(/^S\d{3}$/, "must match S###");
const disruptionId = z.string().regex(/^D\d{2}$/, "must match D##");
const isoUtc = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/, "must be ISO 8601 UTC");

export const TOOL_DEFINITIONS = [
  {
    name: "get_active_disruptions",
    description: "List currently active disruptions (REST: GET /api/disruptions?status=active).",
    input: {},
    build: () => ({ path: "/api/disruptions", query: { status: "active" } }),
  },
  {
    name: "get_affected_shipments",
    description: "List shipments affected by a disruption with match reasons (REST: GET /api/disruptions/:id/affected-shipments).",
    input: { disruption_id: disruptionId, include_delivered: z.boolean().optional() },
    build: (input) => ({
      path: `/api/disruptions/${input.disruption_id}/affected-shipments`,
      query: { include_delivered: input.include_delivered },
    }),
  },
  {
    name: "get_route_alternatives",
    description: "Ranked feasible route alternatives for a shipment (REST: GET /api/shipments/:id/route-alternatives).",
    input: { shipment_id: shipmentId, limit: z.number().int().min(1).max(20).optional() },
    build: (input) => ({
      path: `/api/shipments/${input.shipment_id}/route-alternatives`,
      query: { limit: input.limit },
    }),
  },
  {
    name: "get_carrier_alternatives",
    description: "Ranked feasible carrier alternatives for a shipment (REST: GET /api/shipments/:id/carrier-alternatives).",
    input: { shipment_id: shipmentId },
    build: (input) => ({ path: `/api/shipments/${input.shipment_id}/carrier-alternatives` }),
  },
  {
    name: "get_idle_assets",
    description: "Idle fleet assets with exclusion reasons (REST: GET /api/fleet/idle).",
    input: {
      region_code: z.enum(REGIONS).optional(),
      min_idle_minutes: z.number().int().min(0).optional(),
    },
    build: (input) => ({
      path: "/api/fleet/idle",
      query: { region_code: input.region_code, min_idle_minutes: input.min_idle_minutes },
    }),
  },
  {
    name: "get_redeployment_candidates",
    description: "Ranked redeployment candidates for a shipment (REST: GET /api/shipments/:id/redeployment-candidates).",
    input: { shipment_id: shipmentId },
    build: (input) => ({ path: `/api/shipments/${input.shipment_id}/redeployment-candidates` }),
  },
  {
    name: "get_sensor_status",
    description: "Sensor readings, quality flags and sensor health for a shipment (REST: GET /api/shipments/:id/sensor-readings).",
    input: { shipment_id: shipmentId, from: isoUtc.optional(), to: isoUtc.optional() },
    build: (input) => ({
      path: `/api/shipments/${input.shipment_id}/sensor-readings`,
      query: { from: input.from, to: input.to },
    }),
  },
  {
    name: "get_temperature_excursions",
    description: "Temperature excursions with severity and data quality (REST: GET /api/excursions).",
    input: {
      shipment_id: shipmentId.optional(),
      severity: z.enum(SEVERITIES).optional(),
      status: z.enum(EXCURSION_STATUSES).optional(),
      active_only: z.boolean().optional(),
    },
    build: (input) => ({
      path: "/api/excursions",
      query: {
        shipment_id: input.shipment_id,
        severity: input.severity,
        status: input.status,
        active_only: input.active_only,
      },
    }),
  },
  {
    name: "get_combined_risk",
    description: "Combined disruption + cold-chain risk score with factors for a shipment (REST: GET /api/shipments/:id/risk).",
    input: { shipment_id: shipmentId },
    build: (input) => ({ path: `/api/shipments/${input.shipment_id}/risk` }),
  },
  {
    name: "get_risk_overview",
    description: "Ranked combined-risk worklist across shipments (REST: GET /api/risk/overview).",
    input: { limit: z.number().int().min(1).max(200).optional(), include_zero: z.boolean().optional() },
    build: (input) => ({
      path: "/api/risk/overview",
      query: { limit: input.limit, include_zero: input.include_zero },
    }),
  },
  {
    name: "get_audit_log",
    description: "Append-only audit trail (REST: GET /api/audit).",
    input: { entity_type: z.enum(ENTITY_TYPES).optional(), entity_id: z.string().min(1).optional() },
    build: (input) => ({
      path: "/api/audit",
      query: { entity_type: input.entity_type, entity_id: input.entity_id },
    }),
  },
];

export function findTool(name) {
  return TOOL_DEFINITIONS.find((tool) => tool.name === name) ?? null;
}

export function validateToolInput(definition, input) {
  const schema = z.object(definition.input).strict();
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }
  return { ok: true, data: result.data };
}

// Executes a tool: validate input -> one read-only REST call -> structured result.
// Never throws for expected failures: callers (MCP server, Bob) receive { ok: false, error }.
export async function callTool(baseUrl, name, input, { fetchImpl = fetch } = {}) {
  const definition = findTool(name);
  if (!definition) {
    return {
      tool: name,
      ok: false,
      error: { code: "UNKNOWN_TOOL", message: `Unknown tool: ${name}`, details: {} },
    };
  }

  const validation = validateToolInput(definition, input);
  if (!validation.ok) {
    return {
      tool: name,
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid tool input",
        details: { issues: validation.issues },
      },
    };
  }

  const { path, query } = definition.build(validation.data);
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }

  try {
    const response = await fetchImpl(url, { method: "GET", headers: { accept: "application/json" } });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        tool: name,
        ok: false,
        http_status: response.status,
        error: body?.error ?? { code: "HTTP_ERROR", message: `HTTP ${response.status}`, details: {} },
      };
    }
    return { tool: name, ok: true, ...body };
  } catch (error) {
    return {
      tool: name,
      ok: false,
      error: {
        code: "BACKEND_UNREACHABLE",
        message: "Backend API unreachable",
        details: { detail: error.message },
      },
    };
  }
}
