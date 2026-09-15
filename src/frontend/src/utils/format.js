// Display formatting only — no scoring, severity, ranking or duration logic.

export const EMPTY = "—";

export function formatDateTime(value) {
  if (!value) return EMPTY;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY;
  return date.toLocaleString();
}

export function formatTime(value) {
  if (!value) return EMPTY;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatMoneyUsd(value) {
  if (value === null || value === undefined) return EMPTY;
  return `$${Number(value).toLocaleString("en-US")}`;
}

// Renders a 0–1 backend score as a percentage label (display only, no arithmetic
// beyond rounding for presentation).
export function formatScorePercent(value) {
  if (value === null || value === undefined) return EMPTY;
  return `${Math.round(Number(value) * 100)}%`;
}

export function formatNumber(value) {
  if (value === null || value === undefined) return EMPTY;
  return Number(value).toLocaleString("en-US");
}

export function formatKey(key) {
  return String(key)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatValue(value) {
  if (value === null || value === undefined) return EMPTY;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : EMPTY;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function copyJson(payload) {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    return navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  }
  return Promise.resolve();
}
