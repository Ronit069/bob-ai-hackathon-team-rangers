const ID_PATTERN = /\b(?:S\d{3}|D\d{2}|EX-\d{4}|REC-\d{4}|A\d{3}|C\d{2}|R\d{3})\b/g;
const NUMBER_PATTERN = /-?\d+(?:\.\d+)?%?/g;
// Timestamps are quoted evidence, not numeric claims: accept ISO forms with T or space,
// with/without seconds, fractional seconds, Z or a numeric offset, and bare clock times.
const ISO_PATTERN = /\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?)?/g;
const TIME_PATTERN = /\b\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?\b/g;
const CATEGORY_PATTERN = /\b(critical|blocked|delayed|warning|major|normal|unaffected|at[_ ]risk|unknown[_ ]review)\b/gi;

const ACTION_FAMILIES = [
  { family: "monitor", pattern: /monitor/i },
  { family: "review", pattern: /review|investigate|inspect|assess/i },
  { family: "intervene", pattern: /interven|immediate action|act immediately|reroute|re-route|redeploy|reassign|escalat/i },
];

// A category word in a negation ("no critical shipments", "0 with critical impact") is an
// absence statement, not an unsupported claim. Positive uses are still flagged.
const NEGATED_CATEGORY_PREFIX = /\b(no|not|none|never|without|zero|0)\b[\s\w-]{0,24}$/i;

function walk(value, visit) {
  if (Array.isArray(value)) {
    for (const entry of value) walk(entry, visit);
    return;
  }
  if (value && typeof value === "object") {
    for (const entry of Object.values(value)) walk(entry, visit);
    return;
  }
  visit(value);
}

export function collectEvidenceIds(evidence) {
  const ids = new Set();
  walk(evidence, (value) => {
    if (typeof value !== "string") return;
    for (const match of value.matchAll(ID_PATTERN)) ids.add(match[0]);
  });
  return ids;
}

function addNumberVariants(target, value) {
  if (!Number.isFinite(value)) return;
  target.add(String(value));
  if (!Number.isInteger(value)) {
    target.add(value.toFixed(2));
    target.add(value.toFixed(3));
  }
  if (value >= 0 && value <= 1) target.add(String(Math.round(value * 100)));
}

export function collectEvidenceNumbers(evidence) {
  const numbers = new Set();
  walk(evidence, (value) => {
    if (typeof value === "number") {
      addNumberVariants(numbers, value);
      return;
    }
    if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
      addNumberVariants(numbers, Number(value));
    }
  });
  return numbers;
}

export function collectEvidenceCategories(evidence) {
  const categories = new Set();
  walk(evidence, (value) => {
    if (typeof value !== "string") return;
    for (const match of value.matchAll(CATEGORY_PATTERN)) {
      categories.add(match[0].toLowerCase().replace(/ /g, "_"));
    }
  });
  return categories;
}

export function actionFamilies(text) {
  const families = new Set();
  const value = String(text ?? "");
  for (const entry of ACTION_FAMILIES) {
    if (!entry.pattern.test(value)) continue;
    if (entry.family === "intervene" && /no intervention|no action/i.test(value)) continue;
    families.add(entry.family);
  }
  return families;
}

// Shared text checks: identifiers, numbers and category words must appear in the evidence.
// Reused by the brief validator and by free-text agent answers (Bob Chat).
function collectTextViolations(text, evidence) {
  const violations = [];
  const allowedIds = collectEvidenceIds(evidence);
  const allowedNumbers = collectEvidenceNumbers(evidence);
  const allowedCategories = collectEvidenceCategories(evidence);

  const withoutDates = text.replace(ISO_PATTERN, " ").replace(TIME_PATTERN, " ");

  for (const match of withoutDates.matchAll(ID_PATTERN)) {
    if (!allowedIds.has(match[0]) && violations.length < 10) {
      violations.push(`unknown_id:${match[0]}`);
    }
  }

  const withoutIdentifiers = withoutDates.replace(ID_PATTERN, " ");

  for (const match of withoutIdentifiers.matchAll(NUMBER_PATTERN)) {
    const token = match[0].replace(/%$/, "");
    if (!allowedNumbers.has(token) && violations.length < 10) {
      violations.push(`unsupported_number:${match[0]}`);
    }
  }

  for (const match of text.matchAll(CATEGORY_PATTERN)) {
    const term = match[0].toLowerCase().replace(/ /g, "_");
    if (allowedCategories.has(term)) continue;
    const prefix = text.slice(Math.max(0, (match.index ?? 0) - 40), match.index ?? 0);
    if (NEGATED_CATEGORY_PREFIX.test(prefix)) continue;
    if (violations.length < 10) violations.push(`category_mismatch:${match[0]}`);
  }

  return violations;
}

// checkRecommendation: Feature 1 always enforces action-family consistency with the
// deterministic cold-chain action. The Commander passes false only when its evidence
// contains no deterministic recommended_action (e.g. an incident with no shipments).
export function validateBriefGrounding(brief, evidence, { checkRecommendation = true } = {}) {
  const text = [
    brief.summary,
    brief.whyItMatters,
    brief.recommendedNextStep,
    ...(brief.evidenceUsed ?? []),
    ...(brief.limitations ?? []),
  ].join("\n");

  const violations = collectTextViolations(text, evidence);

  if (checkRecommendation) {
    const deterministicFamilies = actionFamilies(evidence.coldchain?.recommended_action);
    const briefFamilies = actionFamilies(brief.recommendedNextStep);
    for (const family of briefFamilies) {
      if (!deterministicFamilies.has(family) && violations.length < 10) {
        violations.push(`recommendation_conflict:${family}`);
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

// Free-text grounding for LLM-generated answers (Bob Chat).
export function validateGroundedText(text, evidence) {
  const violations = collectTextViolations(String(text ?? ""), evidence);
  return { ok: violations.length === 0, violations };
}
