import { z } from "zod";

export const AI_BRIEF_TEXT_LIMITS = {
  summary: 600,
  whyItMatters: 800,
  evidenceUsed: 200,
  recommendedNextStep: 400,
  limitations: 300,
};

export const aiBriefSchema = z
  .object({
    summary: z.string().trim().min(1).max(AI_BRIEF_TEXT_LIMITS.summary),
    whyItMatters: z.string().trim().min(1).max(AI_BRIEF_TEXT_LIMITS.whyItMatters),
    evidenceUsed: z.array(z.string().trim().min(1).max(AI_BRIEF_TEXT_LIMITS.evidenceUsed)).min(1).max(10),
    recommendedNextStep: z.string().trim().min(1).max(AI_BRIEF_TEXT_LIMITS.recommendedNextStep),
    limitations: z.array(z.string().trim().min(1).max(AI_BRIEF_TEXT_LIMITS.limitations)).max(8),
  })
  .strict();

export function parseAiBrief(text, { maxChars = 8000 } = {}) {
  if (typeof text !== "string" || text.trim() === "") {
    return { ok: false, reason: "empty_response" };
  }
  const trimmed = text.trim();
  if (trimmed.length > maxChars) {
    return { ok: false, reason: "response_too_large" };
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return { ok: false, reason: "no_json_object" };
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return { ok: false, reason: "invalid_json" };
  }

  const result = aiBriefSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      reason: "schema_invalid",
      issues: result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    };
  }
  return { ok: true, data: result.data };
}
