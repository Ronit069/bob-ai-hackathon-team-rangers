// AI Incident Commander — orchestration service (Feature 2).
// Natural language -> validated intent -> server-side allowlist -> frozen MCP tools ->
// existing deterministic services -> evidence -> grounded explanation.
// The AI never mutates state: proposals use the existing recommendation-creation
// endpoint and stop at PENDING APPROVAL. No decision/execution endpoint is ever called.

import { config } from "../common/config.js";
import { callTool } from "../../../mcp-server/src/tools.js";
import * as logisticsRepo from "../logistics/repository.js";
import { aiBriefSchema, extractJsonObject } from "./brief.schema.js";
import { collectEvidenceCategories, validateBriefGrounding } from "./grounding.js";
import { ProviderError } from "./provider.js";
import { parseCommandIntent } from "./commander.schema.js";
import { matchDisruptionsByText, parseDeterministicIntent, selectPriorityShipment } from "./commander.intent.js";
import {
  ACTIVITY_LABEL,
  OPERATION_TOOL,
  PHASE_ONE_OPERATIONS,
  isAllowedOperation,
  planForIntent,
  runOperation,
} from "./commander.tools.js";
import { runToolAgent } from "./toolAgent.js";
import { buildCommandEvidence, normalizeAffected } from "./commander.evidence.js";
import { buildDeterministicCommandExplanation } from "./commander.explanation.js";
import {
  INCIDENT_COMMAND_SYSTEM_PROMPT,
  INCIDENT_COMMANDER_AGENT_SYSTEM_PROMPT,
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

// Single-shot recovery: when the multi-turn agent protocol fails, one plain "write the
// brief from this evidence" call is much easier for small models. Same schema + grounding.
async function writeBriefSingleShot({ provider, evidence, command, log }) {
  try {
    const output = await provider.generate({
      system: INCIDENT_EXPLANATION_SYSTEM_PROMPT,
      prompt: JSON.stringify({
        operator_command: command,
        instruction: "Write the grounded incident brief using only this evidence. Quote values exactly.",
        evidence,
      }),
    });
    const extracted = extractJsonObject(output?.text, { maxChars: 8000 });
    if (!extracted.ok) return null;
    const candidate = extracted.data?.final ?? extracted.data;
    const parsed = aiBriefSchema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  } catch (error) {
    if (error instanceof ProviderError) {
      log("Agent single_shot_failed", { reason: error.reason });
      return null;
    }
    throw error;
  }
}

// One bounded grounded self-correction: the model rewrites its final brief using the
// exact violations and the allowed category vocabulary. Returns null when it fails.
async function repairBriefWithProvider({ provider, evidence, previous, violations, log }) {
  try {
    const prompt = JSON.stringify({
      instruction:
        "Rewrite the incident brief so that every identifier, number and category word appears in the evidence. " +
        "Only use category words from allowed_categories. " +
        "When allowed_recommended_action is not null, recommendedNextStep must be exactly that string. " +
        "Keep the required keys exactly.",
      violations,
      allowed_categories: [...collectEvidenceCategories(evidence)],
      allowed_recommended_action: evidence.coldchain?.recommended_action ?? null,
      previous_final: previous,
      evidence,
    });
    const output = await provider.generate({ system: INCIDENT_EXPLANATION_SYSTEM_PROMPT, prompt });
    const extracted = extractJsonObject(output?.text, { maxChars: 8000 });
    if (!extracted.ok) return null;
    const candidate = extracted.data?.final ?? extracted.data;
    const parsed = aiBriefSchema.safeParse(candidate);
    return parsed.success ? parsed.data : null;
  } catch (error) {
    if (error instanceof ProviderError) {
      log("Agent repair_failed", { reason: error.reason });
      return null;
    }
    throw error;
  }
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

  // Defense in depth: requested operations must be allowlisted (execution planning is
  // always server-side, so a missing/null list is harmless and normalized below).
  if (intent && (intent.requested_operations ?? []).some((operation) => !isAllowedOperation(operation))) {
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

  if (!intent.requested_operations || intent.requested_operations.length === 0) {
    intent = {
      ...intent,
      requested_operations: planForIntent(intent.intent, {
        shipmentId: intent.shipment_id,
        disruptionId: intent.incident_id,
      }),
    };
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

  // --- LLM tool agent + deterministic evidence completion ----------------------
  // When a provider is configured, the model chooses which frozen read-only tools
  // to call (validated server-side). Deterministic completion then fills any
  // essential read the agent skipped, so the grounded brief always has full data.
  const activity = [];
  const missing = [];
  const results = {};

  function recordOperation(operation, result) {
    results[operation] = result;
    if (result?.ok === false && !result.skipped) missing.push(operation);
  }

  async function run(operation, context) {
    log("Tool selected", { operation });
    const result = await runOperation({ operation, context, baseUrl, toolCaller, activity });
    recordOperation(operation, result);
    log("Tool completed", { operation, ok: result?.ok !== false });
    return result;
  }

  function operationForTool(toolName) {
    return Object.entries(OPERATION_TOOL).find(([, tool]) => tool === toolName)?.[0] ?? toolName;
  }

  const providerUsable = provider && provider.available !== false;
  let agentResult = null;

  if (providerUsable) {
    agentResult = await runToolAgent({
      system: INCIDENT_COMMANDER_AGENT_SYSTEM_PROMPT,
      task: JSON.stringify({
        operator_command: command,
        validated_intent: intent.intent,
        priority: intent.priority ?? null,
        resolved_incident: incident
          ? {
              disruption_id: incident.id,
              type: incident.type,
              region_code: incident.region_code,
              severity: incident.severity,
              status: incident.status,
              description: incident.description,
            }
          : null,
        resolved_shipment: shipmentRow
          ? {
              shipment_id: shipmentRow.id,
              cargo_type: shipmentRow.cargo_type,
              is_cold_chain: Boolean(shipmentRow.is_cold_chain),
              status: shipmentRow.status,
            }
          : null,
        required_output: {
          summary: "string",
          whyItMatters: "string",
          evidenceUsed: "string[]",
          recommendedNextStep: "string",
          limitations: "string[]",
        },
      }),
      provider,
      baseUrl,
      toolCaller,
      maxToolCalls: config.aiAgentMaxToolCalls,
      maxPromptChars: config.aiAgentMaxPromptChars,
      validateFinal: (final) =>
        aiBriefSchema.safeParse(final).success
          ? { ok: true }
          : { ok: false, reason: "final must match the brief schema exactly" },
      onEvent: (event, details) => log(`Agent ${event}`, details),
    });

    for (const entry of agentResult.evidence ?? []) {
      const operation = operationForTool(entry.tool);
      const failed = entry.ok === false;
      activity.push({
        operation,
        tool: entry.tool,
        input: entry.input,
        ok: !failed,
        source: "mcp",
        message: ACTIVITY_LABEL[operation] ?? "Tool completed",
      });
      if (!(operation in results)) {
        recordOperation(
          operation,
          failed
            ? { tool: entry.tool, ok: false, error: entry.output ?? { code: "TOOL_ERROR" } }
            : { tool: entry.tool, ok: true, ...(entry.output ?? {}) },
        );
      }
    }
  }

  const plan = planForIntent(intent.intent, { shipmentId: intent.shipment_id, disruptionId: incident?.id ?? null });
  const phaseOne = plan.filter((operation) => PHASE_ONE_OPERATIONS.includes(operation));
  const phaseTwo = plan.filter((operation) => !PHASE_ONE_OPERATIONS.includes(operation));
  const resolvedContext = { disruptionId: incident?.id ?? null, shipmentId: intent.shipment_id ?? null };

  for (const operation of phaseOne) {
    if (!(operation in results)) await run(operation, resolvedContext);
  }

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
  for (const operation of phaseTwo) {
    if (!(operation in results)) await run(operation, detailContext);
  }

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

  // --- LLM final brief + grounding (reuses the Feature 1 grounding validator) ----
  const fallbackExplanation = buildDeterministicCommandExplanation(evidence);
  const checkRecommendation = Boolean(evidence.coldchain?.recommended_action);
  let status = COMMAND_STATUS.DETERMINISTIC_FALLBACK;
  let explanation = fallbackExplanation;
  let grounding = null;
  const providerName = provider?.name ?? null;

  const agentFinal = agentResult?.ok ? aiBriefSchema.safeParse(agentResult.answer) : null;
  if (agentFinal?.success) {
    let candidate = agentFinal.data;
    grounding = validateBriefGrounding(candidate, evidence, { checkRecommendation });

    // Authoritative action normalization: copying the deterministic action verbatim is
    // always safe and fixes action-family conflicts in the model's wording.
    if (!grounding.ok && evidence.coldchain?.recommended_action) {
      const normalized = { ...candidate, recommendedNextStep: evidence.coldchain.recommended_action };
      const normalizedGrounding = validateBriefGrounding(normalized, evidence, { checkRecommendation });
      if (normalizedGrounding.ok) {
        candidate = normalized;
        grounding = normalizedGrounding;
        log("Agent action_normalized", {});
      }
    }

    // One bounded repair attempt with the exact violations before falling back.
    if (!grounding.ok) {
      const repaired = await repairBriefWithProvider({
        provider,
        evidence,
        previous: candidate,
        violations: grounding.violations,
        log,
      });
      const repairedGrounding = repaired
        ? validateBriefGrounding(repaired, evidence, { checkRecommendation })
        : null;
      if (repaired && repairedGrounding.ok) {
        candidate = repaired;
        grounding = repairedGrounding;
        log("Agent repair_completed", {});
      } else if (repairedGrounding) {
        grounding = repairedGrounding;
      }
    }

    // Final recovery: one single-shot grounded brief from the assembled evidence.
    if (!grounding.ok) {
      const singleShot = await writeBriefSingleShot({ provider, evidence, command, log });
      const singleGrounding = singleShot
        ? validateBriefGrounding(singleShot, evidence, { checkRecommendation })
        : null;
      if (singleShot && singleGrounding.ok) {
        candidate = singleShot;
        grounding = singleGrounding;
        fallbackReason = fallbackReason ?? "grounding_repair";
        log("Agent single_shot_completed", {});
      } else if (singleGrounding) {
        grounding = singleGrounding;
      }
    }

    if (grounding.ok) {
      status = COMMAND_STATUS.VALIDATED_AI;
      explanation = candidate;
    } else {
      status = COMMAND_STATUS.GROUNDING_FAILED;
      fallbackReason = fallbackReason ?? "grounding_violations";
      log("Agent brief_rejected", {
        violations: grounding.violations.slice(0, 3),
        draft: JSON.stringify(candidate).slice(0, 300),
      });
    }
  } else if (providerUsable) {
    // Multi-turn agent failed: one single-shot grounded brief from the collected
    // evidence, plus one repair pass if the wording still conflicts.
    let recovered = await writeBriefSingleShot({ provider, evidence, command, log });
    let recoveredGrounding = recovered
      ? validateBriefGrounding(recovered, evidence, { checkRecommendation })
      : null;
    if (recovered && !recoveredGrounding.ok) {
      const repaired = await repairBriefWithProvider({
        provider,
        evidence,
        previous: recovered,
        violations: recoveredGrounding.violations,
        log,
      });
      const repairedGrounding = repaired
        ? validateBriefGrounding(repaired, evidence, { checkRecommendation })
        : null;
      if (repaired && repairedGrounding.ok) {
        recovered = repaired;
        recoveredGrounding = repairedGrounding;
      }
    }

    if (recovered && recoveredGrounding.ok) {
      status = COMMAND_STATUS.VALIDATED_AI;
      explanation = recovered;
      grounding = recoveredGrounding;
      fallbackReason = fallbackReason ?? agentResult?.reason ?? agentResult?.status ?? "agent_recovery";
      log("Agent single_shot_completed", {});
    } else {
      const providerFailure = agentResult?.status === "PROVIDER_ERROR" && !recovered;
      status = providerFailure ? COMMAND_STATUS.PROVIDER_UNAVAILABLE : COMMAND_STATUS.INVALID_AI_OUTPUT;
      fallbackReason = fallbackReason ?? agentResult?.reason ?? "invalid_ai_output";
    }
  }
  log("Explanation generated", {
    status,
    source: status === COMMAND_STATUS.VALIDATED_AI ? "ai" : "deterministic",
  });

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
