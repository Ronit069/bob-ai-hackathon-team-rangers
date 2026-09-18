// AI Incident Commander — server-side tool allowlist and controlled execution (Feature 2).
// The LLM never chooses a tool: validated intents map to fixed plans, and every operation
// maps to exactly one frozen read-only MCP tool. No mutating tool exists in this module.

export const OPERATION_TOOL = Object.freeze({
  GET_ACTIVE_DISRUPTIONS: "get_active_disruptions",
  GET_AFFECTED_SHIPMENTS: "get_affected_shipments",
  GET_COMBINED_RISK: "get_combined_risk",
  GET_RISK_OVERVIEW: "get_risk_overview",
  GET_TEMPERATURE_EXCURSIONS: "get_temperature_excursions",
  GET_IDLE_ASSETS: "get_idle_assets",
  GET_REDEPLOYMENT_CANDIDATES: "get_redeployment_candidates",
  GET_ROUTE_ALTERNATIVES: "get_route_alternatives",
  GET_CARRIER_ALTERNATIVES: "get_carrier_alternatives",
  GET_SENSOR_STATUS: "get_sensor_status",
  GET_AUDIT_LOG: "get_audit_log",
  // Proposal creation is NOT an MCP tool; it uses the existing recommendation-creation
  // endpoint via the proposal client. It is never executed unless the validated intent
  // is CREATE_PROPOSAL and the operator explicitly named a shipment.
  CREATE_RECOVERY_PROPOSAL: null,
});

export const READ_ONLY_TOOLS = Object.freeze(Object.values(OPERATION_TOOL).filter(Boolean));

export const ACTIVITY_LABEL = Object.freeze({
  GET_ACTIVE_DISRUPTIONS: "Known incidents retrieved",
  GET_AFFECTED_SHIPMENTS: "Affected shipments retrieved",
  GET_RISK_OVERVIEW: "Risk overview retrieved",
  GET_COMBINED_RISK: "Risk evaluated",
  GET_TEMPERATURE_EXCURSIONS: "Cold-chain excursions retrieved",
  GET_IDLE_ASSETS: "Available assets retrieved",
  GET_REDEPLOYMENT_CANDIDATES: "Redeployment candidates retrieved",
  GET_ROUTE_ALTERNATIVES: "Route alternatives retrieved",
  GET_CARRIER_ALTERNATIVES: "Carrier alternatives retrieved",
  GET_SENSOR_STATUS: "Sensor status retrieved",
  GET_AUDIT_LOG: "Audit trail retrieved",
});

export function isAllowedOperation(operation) {
  return Object.prototype.hasOwnProperty.call(OPERATION_TOOL, operation);
}

export function toolForOperation(operation) {
  return isAllowedOperation(operation) ? OPERATION_TOOL[operation] : null;
}

// Fixed server-side plan per validated intent. `shipmentId`/`disruptionId` only select
// which IDs the plan targets; the plan itself never comes from model output.
export function planForIntent(intent, { shipmentId = null, disruptionId = null } = {}) {
  switch (intent) {
    case "INVESTIGATE_INCIDENT":
      return [
        "GET_ACTIVE_DISRUPTIONS",
        "GET_AFFECTED_SHIPMENTS",
        "GET_RISK_OVERVIEW",
        "GET_COMBINED_RISK",
        "GET_TEMPERATURE_EXCURSIONS",
        "GET_IDLE_ASSETS",
      ];
    case "GET_AFFECTED_ENTITIES":
      return ["GET_ACTIVE_DISRUPTIONS", "GET_AFFECTED_SHIPMENTS"];
    case "GET_RISK":
      return shipmentId && !disruptionId
        ? ["GET_COMBINED_RISK"]
        : ["GET_ACTIVE_DISRUPTIONS", "GET_AFFECTED_SHIPMENTS", "GET_RISK_OVERVIEW", "GET_COMBINED_RISK"];
    case "GET_AVAILABLE_ASSETS":
      return shipmentId ? ["GET_IDLE_ASSETS", "GET_REDEPLOYMENT_CANDIDATES"] : ["GET_IDLE_ASSETS"];
    case "GET_RECOMMENDATIONS":
      return shipmentId && !disruptionId
        ? ["GET_COMBINED_RISK"]
        : ["GET_ACTIVE_DISRUPTIONS", "GET_AFFECTED_SHIPMENTS", "GET_RISK_OVERVIEW"];
    case "CREATE_PROPOSAL":
      return ["GET_COMBINED_RISK", "GET_REDEPLOYMENT_CANDIDATES"];
    default:
      return [];
  }
}

export const PHASE_ONE_OPERATIONS = ["GET_ACTIVE_DISRUPTIONS", "GET_AFFECTED_SHIPMENTS", "GET_RISK_OVERVIEW"];

// Tool inputs are built server-side from validated IDs only.
export function buildToolInput(operation, { disruptionId = null, shipmentId = null } = {}) {
  switch (operation) {
    case "GET_ACTIVE_DISRUPTIONS":
      return {};
    case "GET_AFFECTED_SHIPMENTS":
      return disruptionId ? { disruption_id: disruptionId } : null;
    case "GET_COMBINED_RISK":
      return shipmentId ? { shipment_id: shipmentId } : null;
    case "GET_RISK_OVERVIEW":
      return { include_zero: true, limit: 50 };
    case "GET_TEMPERATURE_EXCURSIONS":
      return shipmentId ? { shipment_id: shipmentId } : null;
    case "GET_IDLE_ASSETS":
      return {};
    case "GET_REDEPLOYMENT_CANDIDATES":
      return shipmentId ? { shipment_id: shipmentId } : null;
    case "GET_ROUTE_ALTERNATIVES":
      return shipmentId ? { shipment_id: shipmentId, limit: 5 } : null;
    case "GET_CARRIER_ALTERNATIVES":
      return shipmentId ? { shipment_id: shipmentId } : null;
    case "GET_SENSOR_STATUS":
      return shipmentId ? { shipment_id: shipmentId } : null;
    case "GET_AUDIT_LOG":
      return {};
    default:
      return null;
  }
}

// Runs one allowlisted read operation. Never throws: unexpected caller errors are
// converted into a structured failed result, exactly like callTool does.
export async function runOperation({ operation, context = {}, baseUrl, toolCaller, activity = [] }) {
  if (!isAllowedOperation(operation)) {
    return {
      tool: operation,
      ok: false,
      error: { code: "OPERATION_NOT_ALLOWED", message: `Operation ${operation} is not allowlisted`, details: {} },
    };
  }

  const tool = toolForOperation(operation);
  if (!tool) {
    return {
      tool: operation,
      ok: false,
      skipped: true,
      error: { code: "NOT_A_TOOL", message: `${operation} is not executed through the MCP tool layer`, details: {} },
    };
  }

  const input = buildToolInput(operation, context);
  if (input === null) {
    return { tool, ok: false, skipped: true, error: { code: "MISSING_CONTEXT", message: "Required id is not available", details: {} } };
  }

  let result;
  try {
    result = await toolCaller(baseUrl, tool, input);
  } catch (error) {
    result = {
      tool,
      ok: false,
      error: { code: "TOOL_CALL_FAILED", message: error?.message ?? "Tool call failed", details: {} },
    };
  }

  activity.push({
    operation,
    tool,
    input,
    ok: result?.ok !== false,
    source: "mcp",
    message: ACTIVITY_LABEL[operation] ?? operation,
  });
  return result;
}
