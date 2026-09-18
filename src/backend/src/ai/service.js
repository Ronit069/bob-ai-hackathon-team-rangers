import { config } from "../common/config.js";
import { notFound } from "../common/errors.js";
import { buildIncidentEvidence } from "./evidence.js";
import { buildDeterministicBrief } from "./fallback.js";
import { parseAiBrief } from "./brief.schema.js";
import { validateBriefGrounding } from "./grounding.js";
import { ProviderError } from "./provider.js";
import { INCIDENT_BRIEF_SYSTEM_PROMPT } from "./prompt.js";

export const BRIEF_STATUS = Object.freeze({
  VALIDATED_AI: "VALIDATED_AI",
  DETERMINISTIC_FALLBACK: "DETERMINISTIC_FALLBACK",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  INVALID_AI_OUTPUT: "INVALID_AI_OUTPUT",
  GROUNDING_FAILED: "GROUNDING_FAILED",
});

function shapeResult({ evidence, status, brief, briefSource, fallbackReason = null, providerName = null, grounding = null }) {
  return {
    shipment_id: evidence.incident_id,
    status,
    brief_source: briefSource,
    fallback_reason: fallbackReason,
    provider_name: providerName,
    grounding,
    brief,
    evidence,
    generated_at: evidence.generated_at,
  };
}

export async function generateIncidentBrief({
  db,
  shipmentId,
  now = new Date(),
  provider = null,
  enabled = config.aiIncidentBriefEnabled,
  maxPromptChars = config.aiBriefMaxPromptChars,
  maxResponseChars = config.aiBriefMaxResponseChars,
}) {
  const evidence = await buildIncidentEvidence(db, shipmentId, { now });
  if (!evidence) throw notFound("Shipment", shipmentId);
  const fallback = buildDeterministicBrief(evidence);

  if (!enabled) {
    return shapeResult({
      evidence,
      status: BRIEF_STATUS.DETERMINISTIC_FALLBACK,
      brief: fallback,
      briefSource: "deterministic",
      fallbackReason: "feature_disabled",
    });
  }

  if (!provider || provider.available === false) {
    return shapeResult({
      evidence,
      status: BRIEF_STATUS.PROVIDER_UNAVAILABLE,
      brief: fallback,
      briefSource: "deterministic",
      fallbackReason: provider?.reason ?? "provider_not_configured",
      providerName: provider?.name ?? null,
    });
  }

  const prompt = JSON.stringify(evidence);
  if (prompt.length > maxPromptChars) {
    return shapeResult({
      evidence,
      status: BRIEF_STATUS.PROVIDER_UNAVAILABLE,
      brief: fallback,
      briefSource: "deterministic",
      fallbackReason: "prompt_too_large",
      providerName: provider.name,
    });
  }

  let output;
  try {
    output = await provider.generate({ system: INCIDENT_BRIEF_SYSTEM_PROMPT, prompt });
  } catch (error) {
    if (error instanceof ProviderError) {
      return shapeResult({
        evidence,
        status: BRIEF_STATUS.PROVIDER_UNAVAILABLE,
        brief: fallback,
        briefSource: "deterministic",
        fallbackReason: error.reason,
        providerName: provider.name,
      });
    }
    throw error;
  }

  const parsed = parseAiBrief(output?.text, { maxChars: maxResponseChars });
  if (!parsed.ok) {
    return shapeResult({
      evidence,
      status: BRIEF_STATUS.INVALID_AI_OUTPUT,
      brief: fallback,
      briefSource: "deterministic",
      fallbackReason: parsed.reason,
      providerName: provider.name,
    });
  }

  const grounding = validateBriefGrounding(parsed.data, evidence);
  if (!grounding.ok) {
    return shapeResult({
      evidence,
      status: BRIEF_STATUS.GROUNDING_FAILED,
      brief: fallback,
      briefSource: "deterministic",
      fallbackReason: "grounding_violations",
      providerName: provider.name,
      grounding,
    });
  }

  return shapeResult({
    evidence,
    status: BRIEF_STATUS.VALIDATED_AI,
    brief: parsed.data,
    briefSource: "ai",
    providerName: provider.name,
    grounding,
  });
}
