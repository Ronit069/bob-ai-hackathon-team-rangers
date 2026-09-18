// AI Incident Commander — orchestration service (Feature 2).
// Natural language -> validated intent -> server-side allowlist -> frozen MCP tools ->
// existing deterministic services -> evidence -> grounded explanation.
// The AI never mutates state: proposals use the existing recommendation-creation
// endpoint and stop at PENDING APPROVAL. No decision/execution endpoint is ever called.

import { config } from "../common/config.js";
import { callTool } from "../../../mcp-server/src/tools.js";
import * as logisticsRepo from "../logistics/repository.js";
import { parseAiBrief } from "./brief.schema.js";
import { validateBriefGrounding } from "./grounding.js";
import { ProviderError } from "./provider.js";
import { parseCommandIntent } from "./commander.schema.js";
import { matchDisruptionsByText, parseDeterministicIntent, selectPriorityShipment } from "./commander.intent.js";
import { PHASE_ONE_OPERATIONS, isAllowedOperation, planForIntent, runOperation } from "./commander.tools.js";
import { buildCommandEvidence, normalizeAffected } from "./commander.evidence.js";
import { buildDeterministicCommandExplanation } from "./commander.explanation.js";
import {
  INCIDENT_COMMAND_SYSTEM_PROMPT,
  INCIDENT_EXPLANATION_SYSTEM_PROMPT,
} from "./commander.prompt.js";

export const COMMAND_STATUS = Object.freeze({
  FEATURE_DISABLED: "FEATURE_DISABLED",
  CLARIFICATION_REQUIRED: "CLARIFICATION_REQUIRED",
  VALIDATED_AI: "VALIDATED_AI",
  DETERMINISTIC_FALLBACK: "DETERMINISTIC_FALLBACK",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  INVALID_AI_OUTPUT: "INVALID_AI_OUTPUT",
  GROUNDING_FAILED: "GROUNDING_FAILED",
});

export const PROPOSAL_ACTOR = "ai-commander";

const truncate = (value, max) => {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

// Structured observability: events only, never secrets, never full user payloads.
function defaultLog(event, details = {}) {
  const parts = Object.entries(details)
    .map(([key, value]) => `${key}=${Array.isArray(value) ? `[${value.join(",")}]` : String(value)}`)
    .join(" ");
  console.log(`[AI-COMMANDER] ${event}${parts ? ` ${parts}` : ""}`);
}

// Default proposal client: the existing recommendation-creation endpoint. It creates a
// pending recommendation (never a decision, never an execution) and writes its audit row.
export async function defaultProposalClient({ baseUrl, body, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl(`${String(baseUrl).replace(/\/+$/, "")}/api/recommendations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      return {
        ok: false,
        http_status: response.status,
        error: payload?.error ?? { code: "HTTP_ERROR", message: `HTTP ${response.status}`, details: {} },
        recommendation_id: payload?.error?.details?.recommendation_id ?? null,
      };
    }
    return { ok: true, recommendation: payload };
  } catch (error) {
    return {
      ok: false,
      error: { code: "PROPOSAL_UNREACHABLE", message: "Recommendation service unreachable", details: { detail: error?.message } },
    };
  }
}

function clarificationResult({ command, reason, message, options = [], generatedAt, intent = null, intentSource = null, fallbackReason = null, providerName = null }) {
  return {
    command,
    status: COMMAND_STATUS.CLARIFICATION_REQUIRED,
    intent,
    intent_source: intentSource,
    fallback_reason: fallbackReason,
    provider_name: providerName,
    clarification: {
      reason,
      message,
      options: options.slice(0, 5).map((row) => ({
        disruption_id: row.id,
        type: row.type ?? null,
        region_code: row.region_code ?? null,
        status: row.status ?? null,
        description: row.description ?? null,
      })),
    },
    grounding: null,
    explanation: null,
    evidence: null,
    tool_activity: [],
    proposal: null,
    proposal_status: null,
    partial: false,
    missing_tools: [],
    generated_at: generatedAt,
  };
}

function incidentOptions(disruptions) {
  return (disruptions ?? []).slice(0, 5).map((row) => row);
}

function incidentListText(disruptions) {
  const rows = incidentOptions(disruptions);
  if (rows.length === 0) return "No recorded incidents are available.";
  return `Known incidents: ${rows.map((row) => `${row.id} (${row.description})`).join("; ")}.`;
}

async function prepareProposal({ intent, results, baseUrl, proposalClient, command, activity, log }) {
  const candidates = results.GET_REDEPLOYMENT_CANDIDATES?.data ?? [];
  const routes = results.GET_ROUTE_ALTERNATIVES?.data ?? [];

  let body = null;
  let targetId = null;
  if (candidates.length > 0 && candidates[0].asset?.id) {
    targetId = candidates[0].asset.id;
    body = {
      type: "fleet_redeployment",
      shipment_id: intent.shipment_id,
      asset_id: targetId,
      actor: PROPOSAL_ACTOR,
      notes: `Prepared by AI Incident Commander from command: ${truncate(command, 160)}`,
    };
  } else if (routes.length > 0 && routes[0].route?.id) {
    targetId = routes[0].route.id;
    body = {
      type: "reroute",
      shipment_id: intent.shipment_id,
      route_id: targetId,
      actor: PROPOSAL_ACTOR,
      notes: `Prepared by AI Incident Commander from command: ${truncate(command, 160)}`,
    };
  }

  if (!body) {
    activity.push({
      operation: "CREATE_RECOVERY_PROPOSAL",
      tool: null,
      source: "service",
      ok: false,
      message: "No eligible recovery target was available; no proposal was created",
    });
    return { ok: false, status: "not_available", reason: "no_eligible_target" };
  }

  const result = await proposalClient({ baseUrl, body });
  if (result.ok && result.recommendation?.id) {
    activity.push({
      operation: "CREATE_RECOVERY_PROPOSAL",
      tool: null,
      source: "service",
      ok: true,
      message: "Recovery proposal prepared (pending approval)",
    });
    log("Proposal created", { recommendation_id: result.recommendation.id, type: body.type });
    return {
      ok: true,
      status: "pending",
      id: result.recommendation.id,
      type: body.type,
      target_id: targetId,
      approval_required: true,
    };
  }

  if (result.http_status === 409 && result.recommendation_id) {
    activity.push({
      operation: "CREATE_RECOVERY_PROPOSAL",
      tool: null,
      source: "service",
      ok: true,
      message: "An equivalent proposal is already pending approval",
    });
    return {
      ok: true,
      status: "pending",
      id: result.recommendation_id,
      type: body.type,
      target_id: targetId,
      approval_required: true,
    };
  }

  activity.push({
    operation: "CREATE_RECOVERY_PROPOSAL",
    tool: null,
    source: "service",
    ok: false,
    message: "The recovery proposal could not be prepared",
  });
  return { ok: false, status: "failed", reason: result.error?.code ?? "proposal_failed" };
}

export async function runIncidentCommand({
  db,
  command,
  now = new Date(),
  provider = null,
  enabled = config.aiIncidentCommanderEnabled,
  baseUrl = `http://localhost:${config.port}`,
  toolCaller = callTool,
  proposalClient = defaultProposalClient,
  maxPromptChars = config.aiBriefMaxPromptChars,
  maxResponseChars = config.aiBriefMaxResponseChars,
  log = defaultLog,
} = {}) {
  const generatedAt = now.toISOString();
  log("User request received", { command_length: String(command ?? "").length });

  if (!enabled) {
    log("Feature disabled");
    return {
      command,
      status: COMMAND_STATUS.FEATURE_DISABLED,
      intent: null,
      intent_source: null,
      fallback_reason: "feature_disabled",
      provider_name: null,
      clarification: null,
      grounding: null,
      explanation: null,
      evidence: null,
      tool_activity: [],
      proposal: null,
      proposal_status: null,
      partial: false,
      missing_tools: [],
      generated_at: generatedAt,
    };
  }

  // Candidate incidents come from the deterministic repository (read-only).
  const disruptions = await logisticsRepo.listDisruptions(db, { status: "active", limit: 50 });

  // --- Intent: model first (validated), deterministic fallback -----------------
  let intent = null;
  let intentSource = "deterministic";
  let fallbackReason = null;

  if (provider && provider.available !== false) {
    const prompt = JSON.stringify({
      command,
      known_incidents: disruptions.map((row) => ({
        disruption_id: row.id,
        type: row.type,
        region_code: row.region_code,
        severity: row.severity,
        status: row.status,
        description: truncate(row.description, 200),
      })),
      instructions: "Map the command to one supported intent. Use incident_text for incidents named without an ID.",
    });

    if (prompt.length > maxPromptChars) {
      fallbackReason = "prompt_too_large";
    } else {
      let output = null;
      try {
        output = await provider.generate({ system: INCIDENT_COMMAND_SYSTEM_PROMPT, prompt });
      } catch (error) {
        if (error instanceof ProviderError) fallbackReason = error.reason;
        else throw error;
      }
      if (output) {
        const parsed = parseCommandIntent(output.text, { maxChars: maxResponseChars });
        if (parsed.ok) {
          intent = parsed.data;
          intentSource = "ai";
        } else {
          fallbackReason = parsed.reason === "schema_invalid" ? "invalid_ai_intent" : parsed.reason;
        }
      }
    }
  } else {
    fallbackReason = provider?.reason ?? "provider_not_configured";
  }

  // Defense in depth: every requested and planned operation must be allowlisted.
  if (intent && (intent.requested_operations.some((operation) => !isAllowedOperation(operation)))) {
    fallbackReason = "operation_not_allowed";
    intent = null;
  }

  if (!intent) {
    const deterministic = parseDeterministicIntent(command);
    if (deterministic) {
      intent = deterministic;
      intentSource = "deterministic";
    } else {
      log("Intent rejected", { reason: fallbackReason ?? "unsupported_command" });
      return clarificationResult({
        command,
        reason: "ambiguous_command",
        message:
          'I could not map that request to a supported ChainSentinel command. Try: "Investigate the Mumbai port disruption", ' +
          '"Which affected shipment has the highest risk?", "What refrigerated assets are available?", ' +
          '"What recovery options does the system recommend?", or "Prepare a recovery proposal for S039".',
        disruptions,
        generatedAt,
        fallbackReason,
        providerName: provider?.name ?? null,
      });
    }
  }
  log("Intent parsed", { source: intentSource, intent: intent.intent, priority: intent.priority ?? "-" });
  log("Intent validated", { intent: intent.intent, operations: intent.requested_operations });

  // --- Deterministic resolution (never trusts model IDs) -----------------------
  let incident = null;
  if (intent.incident_id) {
    incident = await logisticsRepo.getDisruption(db, intent.incident_id);
    if (!incident) {
      return clarificationResult({
        command,
        reason: "incident_not_found",
        message: `I could not find incident ${intent.incident_id}. ${incidentListText(disruptions)}`,
        options: incidentOptions(disruptions),
        generatedAt,
        intent,
        intentSource,
        fallbackReason,
        providerName: provider?.name ?? null,
      });
    }
  }

  if (!incident && intent.incident_text) {
    const matched = matchDisruptionsByText(disruptions, intent.incident_text);
    if (matched.ambiguous) {
      return clarificationResult({
        command,
        reason: "incident_ambiguous",
        message: `More than one incident matches "${truncate(intent.incident_text, 80)}". Which one should I investigate?`,
        options: matched.candidates,
        generatedAt,
        intent,
        intentSource,
        fallbackReason,
        providerName: provider?.name ?? null,
      });
    }
    incident = matched.incident;
  }

  const requiresIncident =
    intent.intent === "INVESTIGATE_INCIDENT" ||
    intent.intent === "GET_AFFECTED_ENTITIES" ||
    (!intent.shipment_id && (intent.intent === "GET_RISK" || intent.intent === "GET_RECOMMENDATIONS"));

  if (requiresIncident && !incident) {
    return clarificationResult({
      command,
      reason: intent.incident_text ? "incident_not_found" : "incident_required",
      message: intent.incident_text
        ? `I could not find an incident matching "${truncate(intent.incident_text, 80)}". ${incidentListText(disruptions)}`
        : `Which incident should I investigate? ${incidentListText(disruptions)}`,
      options: incidentOptions(disruptions),
      generatedAt,
      intent,
      intentSource,
      fallbackReason,
      providerName: provider?.name ?? null,
    });
  }

  let shipmentRow = null;
  if (intent.shipment_id) {
    shipmentRow = await logisticsRepo.getShipment(db, intent.shipment_id);
    if (!shipmentRow) {
      return clarificationResult({
        command,
        reason: "shipment_not_found",
        message: `I could not find shipment ${intent.shipment_id}.`,
        generatedAt,
        intent,
        intentSource,
        fallbackReason,
        providerName: provider?.name ?? null,
      });
    }
  }

  if (intent.intent === "CREATE_PROPOSAL" && !intent.shipment_id) {
    return clarificationResult({
      command,
      reason: "proposal_target_required",
      message: 'Which shipment should I prepare a recovery proposal for? Include the shipment ID, for example "Prepare a recovery proposal for S039".',
      generatedAt,
      intent,
      intentSource,
      fallbackReason,
      providerName: provider?.name ?? null,
    });
  }

  // --- Controlled MCP execution (fixed server-side plan) -----------------------
  const activity = [];
  const missing = [];
  const results = {};

  async function run(operation, context) {
    log("Tool selected", { operation });
    const result = await runOperation({ operation, context, baseUrl, toolCaller, activity });
    results[operation] = result;
    if (result?.ok === false && !result.skipped) missing.push(operation);
    log("Tool completed", { operation, ok: result?.ok !== false });
    return result;
  }

  const plan = planForIntent(intent.intent, { shipmentId: intent.shipment_id, disruptionId: incident?.id ?? null });
  const phaseOne = plan.filter((operation) => PHASE_ONE_OPERATIONS.includes(operation));
  const phaseTwo = plan.filter((operation) => !PHASE_ONE_OPERATIONS.includes(operation));
  const resolvedContext = { disruptionId: incident?.id ?? null, shipmentId: intent.shipment_id ?? null };

  for (const operation of phaseOne) await run(operation, resolvedContext);

  const affected = normalizeAffected(results.GET_AFFECTED_SHIPMENTS?.data);
  const riskOverview = results.GET_RISK_OVERVIEW?.data ?? [];
  let priorityShipment =
    (intent.shipment_id ? affected.find((row) => row.id === intent.shipment_id) : null) ??
    (intent.shipment_id
      ? null
      : selectPriorityShipment({ affected, riskOverview, priority: intent.priority }));

  if (!priorityShipment && shipmentRow) {
    priorityShipment = {
      id: shipmentRow.id,
      cargo_type: shipmentRow.cargo_type,
      is_cold_chain: Boolean(shipmentRow.is_cold_chain),
      status: shipmentRow.status,
      impact_status: null,
      impact_score: null,
    };
  } else if (priorityShipment && shipmentRow && !priorityShipment.cargo_type) {
    priorityShipment = {
      ...priorityShipment,
      cargo_type: shipmentRow.cargo_type,
      is_cold_chain: Boolean(shipmentRow.is_cold_chain),
    };
  }

  const detailContext = {
    disruptionId: incident?.id ?? null,
    shipmentId: priorityShipment?.id ?? intent.shipment_id ?? null,
  };
  for (const operation of phaseTwo) await run(operation, detailContext);

  // Proposal creation: only for the explicit validated CREATE_PROPOSAL intent.
  let proposalResult = null;
  if (intent.intent === "CREATE_PROPOSAL" && intent.shipment_id) {
    if (!(results.GET_REDEPLOYMENT_CANDIDATES?.data ?? []).length) {
      await run("GET_ROUTE_ALTERNATIVES", detailContext);
    }
    proposalResult = await prepareProposal({
      intent,
      results,
      baseUrl,
      proposalClient,
      command,
      activity,
      log,
    });
  }

  // --- Evidence -----------------------------------------------------------------
  const evidence = await buildCommandEvidence({
    db,
    command,
    intent,
    incident,
    priorityShipment,
    results,
    activity,
    missing,
    proposal: proposalResult?.ok ? proposalResult : null,
    now,
  });
  evidence.proposal_status =
    proposalResult?.status ?? (intent.intent === "CREATE_PROPOSAL" ? "not_created" : null);
  log("Evidence assembled", { affected: evidence.incident_summary.affected_count, partial: evidence.partial });

  // --- Grounded explanation (reuses the Feature 1 grounding validator) ----------
  const fallbackExplanation = buildDeterministicCommandExplanation(evidence);
  const checkRecommendation = Boolean(evidence.coldchain?.recommended_action);
  let status = COMMAND_STATUS.DETERMINISTIC_FALLBACK;
  let explanation = fallbackExplanation;
  let grounding = null;
  const providerName = provider?.name ?? null;

  if (provider && provider.available !== false) {
    const prompt = JSON.stringify(evidence);
    if (prompt.length > maxPromptChars) {
      status = COMMAND_STATUS.PROVIDER_UNAVAILABLE;
      fallbackReason = fallbackReason ?? "prompt_too_large";
    } else {
      let output = null;
      let failure = null;
      try {
        output = await provider.generate({ system: INCIDENT_EXPLANATION_SYSTEM_PROMPT, prompt });
      } catch (error) {
        if (error instanceof ProviderError) failure = error.reason;
        else throw error;
      }

      if (failure) {
        status = COMMAND_STATUS.PROVIDER_UNAVAILABLE;
        fallbackReason = fallbackReason ?? failure;
      } else {
        const parsed = parseAiBrief(output?.text, { maxChars: maxResponseChars });
        if (!parsed.ok) {
          status = COMMAND_STATUS.INVALID_AI_OUTPUT;
          fallbackReason = fallbackReason ?? parsed.reason;
        } else {
          grounding = validateBriefGrounding(parsed.data, evidence, { checkRecommendation });
          if (!grounding.ok) {
            status = COMMAND_STATUS.GROUNDING_FAILED;
            fallbackReason = fallbackReason ?? "grounding_violations";
          } else {
            status = COMMAND_STATUS.VALIDATED_AI;
            explanation = parsed.data;
          }
        }
      }
    }
  }
  log("Explanation generated", { status, source: status === COMMAND_STATUS.VALIDATED_AI ? "ai" : "deterministic" });

  return {
    command,
    status,
    intent,
    intent_source: intentSource,
    fallback_reason: fallbackReason,
    provider_name: providerName,
    clarification: null,
    grounding,
    explanation,
    evidence,
    tool_activity: evidence.tool_activity,
    proposal: proposalResult?.ok
      ? {
          id: proposalResult.id,
          type: proposalResult.type,
          target_id: proposalResult.target_id,
          status: "pending",
          approval_required: true,
        }
      : null,
    proposal_status: evidence.proposal_status,
    partial: evidence.partial,
    missing_tools: evidence.missing_tools,
    generated_at: generatedAt,
  };
}
