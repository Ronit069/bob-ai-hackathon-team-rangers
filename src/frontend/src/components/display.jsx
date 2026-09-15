// Display components — every value is rendered exactly as provided by the backend.
// No score, severity, ranking or duration computation happens here.

import { formatKey, formatScorePercent, formatValue, copyJson } from "../utils/format.js";

const LABELS = {
  critical: ["Critical", "danger"],
  blocked: ["Blocked", "danger"],
  delayed: ["Delayed", "warn"],
  at_risk: ["At risk", "warn"],
  unknown_review: ["Unknown / review", "review"],
  unaffected: ["Unaffected", "neutral"],
  major: ["Major", "warn"],
  warning: ["Warning", "warn"],
  open: ["Open", "warn"],
  acknowledged: ["Acknowledged", "info"],
  closed: ["Closed", "neutral"],
  pending: ["Pending", "info"],
  accepted: ["Accepted", "ok"],
  rejected: ["Rejected", "neutral"],
  modified: ["Modified", "review"],
  active: ["Active", "danger"],
  scheduled: ["Scheduled", "info"],
  resolved: ["Resolved", "ok"],
  inactive: ["Inactive", "neutral"],
  available: ["Available", "ok"],
  assigned: ["Assigned", "info"],
  reserved: ["Reserved", "warn"],
  maintenance: ["Maintenance", "warn"],
  retired: ["Retired", "neutral"],
  reporting: ["Reporting", "ok"],
  delayed_sensor: ["Delayed", "warn"],
  failed: ["Failed", "danger"],
  unknown: ["Unknown", "review"],
  normal: ["Normal", "ok"],
  excursion: ["Excursion", "danger"],
  sensor_failure: ["Sensor failure", "danger"],
  in_transit: ["In transit", "info"],
  planned: ["Planned", "neutral"],
  delivered: ["Delivered", "ok"],
  cancelled: ["Cancelled", "neutral"],
  complete: ["Complete", "ok"],
  missing_readings: ["Missing readings", "review"],
  out_of_order: ["Out of order", "warn"],
  implausible: ["Implausible", "review"],
};

export function StatusBadge({ value, kind }) {
  if (value === null || value === undefined || value === "") return null;
  const [label, tone] = LABELS[value] ?? [formatKey(value), "neutral"];
  return (
    <span className={`badge ${tone}`} title={kind ? `${kind}: ${value}` : value}>
      {label}
    </span>
  );
}

// Renders the backend score 0–1 as a bar; the value itself is displayed verbatim.
export function ScoreBar({ score, label }) {
  if (score === null || score === undefined) return <span className="muted">—</span>;
  const width = Math.max(0, Math.min(100, Math.round(Number(score) * 100)));
  return (
    <div className="score" title={label ?? "score"}>
      <div className="bar">
        <i style={{ width: `${width}%` }} />
      </div>
      <span className="value">{formatScorePercent(score)}</span>
    </div>
  );
}

export function FactorList({ factors }) {
  if (!factors || Object.keys(factors).length === 0) return <span className="muted">No factors returned</span>;
  const entries = [];
  for (const [key, value] of Object.entries(factors)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        entries.push([`${formatKey(key)} · ${formatKey(nestedKey)}`, nestedValue]);
      }
    } else {
      entries.push([formatKey(key), value]);
    }
  }
  return (
    <div className="factors">
      {entries.map(([label, value]) => (
        <div className="factor" key={label}>
          <span>{label}</span>
          <strong>{formatValue(value)}</strong>
        </div>
      ))}
    </div>
  );
}

export function ReasonList({ reasons }) {
  if (!reasons || reasons.length === 0) return null;
  return (
    <ul className="reasons">
      {reasons.map((reason, index) => (
        <li key={index}>{reason}</li>
      ))}
    </ul>
  );
}

export function MetricCard({ label, value, hint }) {
  return (
    <div className="metric">
      <div className="label">{label}</div>
      <div className="value">{value ?? "—"}</div>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function JsonViewer({ value, maxHeight }) {
  return (
    <pre className="json" style={maxHeight ? { maxHeight } : undefined}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function EvidencePanel({ evidence }) {
  if (!evidence || evidence.length === 0) {
    return <p className="muted small">No tool calls were reported for this answer.</p>;
  }
  return (
    <div>
      {evidence.map((entry, index) => (
        <details className="evidence" key={index} open={index === 0}>
          <summary>
            <span>
              Tool: {entry.tool ?? "unknown"}
            </span>
            <button
              type="button"
              className="copy-btn"
              onClick={(e) => { e.stopPropagation(); copyJson(entry); }}
            >
              copy
            </button>
          </summary>
          <div className="evidence-body">
            <div className="small muted" style={{ marginBottom: 4 }}>Input</div>
            <JsonViewer value={entry.input ?? {}} maxHeight={120} />
            <div className="small muted mt" style={{ marginBottom: 4 }}>Output (raw backend JSON)</div>
            <JsonViewer value={entry.output ?? {}} maxHeight={220} />
          </div>
        </details>
      ))}
    </div>
  );
}

export function DataTable({ columns, rows, emptyMessage = "No rows", rowKey, onRowClick }) {
  if (!rows || rows.length === 0) {
    return <p className="muted small">{emptyMessage}</p>;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="data">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={rowKey ? rowKey(row) : index}
              className={onRowClick ? "clickable" : undefined}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
            >
              {columns.map((column) => (
                <td key={column.key}>{column.render ? column.render(row) : formatValue(row[column.key])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
