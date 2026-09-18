const ID_PATTERN = /\b(?:S\d{3}|D\d{2}|EX-\d{4}|REC-\d{4}|A\d{3}|C\d{2}|R\d{3})\b/g;
const NUMBER_PATTERN = /-?\d+(?:\.\d+)?%?/g;
const ISO_PATTERN = /\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?/g;
const CATEGORY_PATTERN = /\b(critical|blocked|delayed|warning|major|normal|unaffected|at[_ ]risk|unknown[_ ]review)\b/gi;

const ACTION_FAMILIES = [
  { family: "monitor", pattern: /monitor/i },
  { family: "review", pattern: /review|investigate|inspect|assess/i },
  { family: "intervene", pattern: /interven|immediate action|act immediately|reroute|re-route|redeploy|reassign|escalat/i },
];

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

export function validateBriefGrounding(brief, evidence) {
  const text = [
    brief.summary,
    brief.whyItMatters,
    brief.recommendedNextStep,
    ...(brief.evidenceUsed ?? []),
    ...(brief.limitations ?? []),
  ].join("\n");

  const violations = [];
  const allowedIds = collectEvidenceIds(evidence);
  const allowedNumbers = collectEvidenceNumbers(evidence);
  const allowedCategories = collectEvidenceCategories(evidence);

  const withoutDates = text.replace(ISO_PATTERN, " ");

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
    if (!allowedCategories.has(term) && violations.length < 10) {
      violations.push(`category_mismatch:${match[0]}`);
    }
  }

  const deterministicFamilies = actionFamilies(evidence.coldchain?.recommended_action);
  const briefFamilies = actionFamilies(brief.recommendedNextStep);
  for (const family of briefFamilies) {
    if (!deterministicFamilies.has(family) && violations.length < 10) {
      violations.push(`recommendation_conflict:${family}`);
    }
  }

  return { ok: violations.length === 0, violations };
}
