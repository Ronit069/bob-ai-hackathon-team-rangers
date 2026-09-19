// Model-facing catalog of the 11 frozen MCP tools (Feature 2 / Bob Chat agent).
// Names must match TOOL_DEFINITIONS exactly (asserted by tests). This is a prompt
// catalog only — execution always goes through the frozen callTool validation.

import { TOOL_DEFINITIONS } from "../../../mcp-server/src/tools.js";

export const AGENT_TOOLS = Object.freeze([
  {
    name: "get_active_disruptions",
    description: "List disruptions with database status 'active' (id, type, region, severity, description).",
    input: {},
  },
  {
    name: "get_affected_shipments",
    description: "Shipments affected by one disruption, with impact_status, impact_score and match reasons.",
    input: { disruption_id: "disruption id like D01 (required)", include_delivered: "boolean (optional)" },
  },
  {
    name: "get_route_alternatives",
    description: "Ranked feasible route alternatives for a shipment.",
    input: { shipment_id: "shipment id like S039 (required)", limit: "integer 1-20 (optional)" },
  },
  {
    name: "get_carrier_alternatives",
    description: "Ranked feasible carrier alternatives for a shipment.",
    input: { shipment_id: "shipment id like S039 (required)" },
  },
  {
    name: "get_idle_assets",
    description: "Idle fleet assets (trucks/containers/vessels) with idle minutes and exclusion reasons.",
    input: { region_code: "region code (optional)", min_idle_minutes: "integer (optional)" },
  },
  {
    name: "get_redeployment_candidates",
    description: "Ranked redeployment candidates for a shipment with scores and constraints.",
    input: { shipment_id: "shipment id like S039 (required)" },
  },
  {
    name: "get_sensor_status",
    description: "Sensor readings, quality flags and sensor health for a shipment.",
    input: { shipment_id: "shipment id like S039 (required)", from: "ISO UTC (optional)", to: "ISO UTC (optional)" },
  },
  {
    name: "get_temperature_excursions",
    description: "Temperature excursions with severity, duration, data quality and recommended action.",
    input: {
      shipment_id: "shipment id like S039 (optional)",
      severity: "warning | major | critical | unknown_review (optional)",
      status: "open | acknowledged | closed (optional)",
      active_only: "boolean (optional)",
    },
  },
  {
    name: "get_combined_risk",
    description: "Combined disruption + cold-chain risk score with factors for one shipment (authoritative).",
    input: { shipment_id: "shipment id like S039 (required)" },
  },
  {
    name: "get_risk_overview",
    description: "Ranked combined-risk worklist across shipments (highest first).",
    input: { limit: "integer 1-200 (optional)", include_zero: "boolean (optional)" },
  },
  {
    name: "get_audit_log",
    description: "Append-only audit trail records (actions, actors, entities).",
    input: { entity_type: "entity type (optional)", entity_id: "entity id (optional)" },
  },
]);

const NAMES = new Set(AGENT_TOOLS.map((tool) => tool.name));

export function isAgentTool(name) {
  return NAMES.has(name);
}

export function toolCatalogNames() {
  return AGENT_TOOLS.map((tool) => tool.name);
}

// Sanity guard: the prompt catalog must never drift from the frozen tool list.
export function catalogMatchesFrozenTools() {
  const frozen = TOOL_DEFINITIONS.map((tool) => tool.name).sort();
  const catalog = [...NAMES].sort();
  return frozen.length === catalog.length && frozen.every((name, index) => name === catalog[index]);
}
