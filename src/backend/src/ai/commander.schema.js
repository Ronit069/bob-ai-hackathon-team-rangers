// AI Incident Commander — validated command intent (Feature 2).
// The LLM may only produce this shape; the server re-validates everything and the
// executed tool plan is fixed server-side (see commander.tools.js).

import { z } from "zod";
import { extractJsonObject } from "./brief.schema.js";

export const COMMAND_INTENTS = [
  "INVESTIGATE_INCIDENT",
  "GET_AFFECTED_ENTITIES",
  "GET_RISK",
  "GET_AVAILABLE_ASSETS",
  "GET_RECOMMENDATIONS",
  "CREATE_PROPOSAL",
];

// Every operation maps to exactly one of the 11 frozen read-only MCP tools, except
// CREATE_RECOVERY_PROPOSAL, which uses the existing recommendation-creation endpoint.
// Anything outside this list is rejected before any tool can run.
export const COMMAND_OPERATIONS = [
  "GET_ACTIVE_DISRUPTIONS",
  "GET_AFFECTED_SHIPMENTS",
  "GET_COMBINED_RISK",
  "GET_RISK_OVERVIEW",
  "GET_TEMPERATURE_EXCURSIONS",
  "GET_IDLE_ASSETS",
  "GET_REDEPLOYMENT_CANDIDATES",
  "GET_ROUTE_ALTERNATIVES",
  "GET_CARRIER_ALTERNATIVES",
  "GET_SENSOR_STATUS",
  "GET_AUDIT_LOG",
  "CREATE_RECOVERY_PROPOSAL",
];

export const COMMAND_PRIORITIES = ["COLD_CHAIN", "CRITICAL", "VALUE", "DEADLINE"];

export const incidentCommandInputSchema = z
  .object({
    command: z.string().trim().min(3).max(500),
  })
  .strict();

export const commandIntentSchema = z
  .object({
    intent: z.enum(COMMAND_INTENTS),
    incident_id: z.string().regex(/^D\d{2}$/, "must match D##").nullable().optional(),
    incident_text: z.string().trim().min(1).max(120).nullable().optional(),
    shipment_id: z.string().regex(/^S\d{3}$/, "must match S###").nullable().optional(),
    priority: z.enum(COMMAND_PRIORITIES).nullable().optional(),
    requested_operations: z.array(z.enum(COMMAND_OPERATIONS)).min(1).max(10),
  })
  .strict();

// Parses and validates a model-produced command intent. Never trusts the model output:
// unknown intents, operations or extra fields fail schema validation.
export function parseCommandIntent(text, { maxChars = 8000 } = {}) {
  const extracted = extractJsonObject(text, { maxChars });
  if (!extracted.ok) return extracted;
  const result = commandIntentSchema.safeParse(extracted.data);
  if (!result.success) {
    return {
      ok: false,
      reason: "schema_invalid",
      issues: result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    };
  }
  return { ok: true, data: result.data };
}
