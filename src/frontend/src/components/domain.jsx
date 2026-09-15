// Domain widgets shared across screens. All values come from the backend;
// no scoring, severity, ranking or duration logic lives here.

import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/endpoints.js";
import { FactorList, ReasonList, ScoreBar, StatusBadge } from "./display.jsx";
import { FieldErrors } from "./states.jsx";

export const REGION_CODES = [
  "IN-WEST-COAST",
  "AE-JEBEL-ALI",
  "SG-SINGAPORE",
  "CN-EAST-COAST",
  "US-WEST-COAST",
  "EU-ROTTERDAM",
  "US-EAST-COAST",
  "IN-NORTH-ICD",
];

export const DISRUPTION_TYPES = ["weather", "port_strike", "geopolitical", "customs", "infrastructure"];

function toIsoUtc(localValue) {
  if (!localValue) return null;
  const date = new Date(localValue);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

function localInputValue(offsetMinutes = 0) {
  const date = new Date(Date.now() + offsetMinutes * 60_000);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function DisruptionForm({ onCreated }) {
  const [form, setForm] = useState({
    type: "port_strike",
    region_code: "IN-WEST-COAST",
    start_time: localInputValue(),
    end_time: localInputValue(180),
    severity: 3,
    status: "active",
    description: "",
    created_by: "operator-1",
  });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const update = (field) => (event) => setForm((previous) => ({ ...previous, [field]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const created = await api.createDisruption({
        ...form,
        severity: Number(form.severity),
        start_time: toIsoUtc(form.start_time),
        end_time: toIsoUtc(form.end_time),
      });
      onCreated?.(created);
    } catch (apiError) {
      setError(apiError);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <FieldErrors error={error} />
      {error?.isConflict?.() ? <div className="banner danger">{error.message}</div> : null}
      <div className="form-row">
        <label>
          Type
          <select value={form.type} onChange={update("type")}>
            {DISRUPTION_TYPES.map((type) => (
              <option key={type} value={type}>
                {type.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          Region
          <select value={form.region_code} onChange={update("region_code")}>
            {REGION_CODES.map((region) => (
              <option key={region} value={region}>
                {region}
              </option>
            ))}
          </select>
        </label>
        <label>
          Severity (1–5)
          <input type="number" min="1" max="5" value={form.severity} onChange={update("severity")} />
        </label>
      </div>
      <div className="form-row">
        <label>
          Start
          <input type="datetime-local" value={form.start_time} onChange={update("start_time")} />
        </label>
        <label>
          End (optional)
          <input type="datetime-local" value={form.end_time} onChange={update("end_time")} />
        </label>
        <label>
          Status
          <select value={form.status} onChange={update("status")}>
            <option value="active">active</option>
            <option value="scheduled">scheduled</option>
          </select>
        </label>
      </div>
      <label>
        Description
        <textarea rows="2" value={form.description} onChange={update("description")} required style={{ width: "100%" }} />
      </label>
      <div className="form-actions">
        <button type="submit" className="primary" disabled={submitting}>
          {submitting ? "Creating…" : "Create disruption"}
        </button>
      </div>
    </form>
  );
}

export function DecisionButtons({ recommendation, onDecided }) {
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const decide = async (decision) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.decideRecommendation(recommendation.id, {
        decision,
        notes: notes || undefined,
      });
      onDecided?.(updated);
    } catch (apiError) {
      setError(apiError);
    } finally {
      setBusy(false);
    }
  };

  if (recommendation.status !== "pending") {
    return (
      <div className="row">
        <span className="small muted">Decision recorded:</span>
        <StatusBadge value={recommendation.status} />
        {recommendation.decided_by ? <span className="muted small">by {recommendation.decided_by}</span> : null}
      </div>
    );
  }

  return (
    <div>
      <FieldErrors error={error} />
      {error?.isConflict?.() ? <div className="banner warn">{error.message}</div> : null}
      <input
        type="text"
        placeholder="Optional note for the audit trail"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        style={{ width: "100%", marginBottom: 8 }}
      />
      <div className="row">
        <button type="button" className="primary" disabled={busy} onClick={() => decide("accepted")}>
          Accept
        </button>
        <button type="button" disabled={busy} onClick={() => decide("rejected")}>
          Reject
        </button>
        <button type="button" disabled={busy} onClick={() => decide("modified")}>
          Mark modified
        </button>
      </div>
    </div>
  );
}

export function ExcursionReviewActions({ excursion, onUpdated }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const transition = async (status) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.patchExcursion(excursion.id, { status, note: note || undefined });
      onUpdated?.(updated);
    } catch (apiError) {
      setError(apiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <FieldErrors error={error} />
      {error?.isConflict?.() ? <div className="banner warn">{error.message}</div> : null}
      {excursion.severity === "critical" ? (
        <div className="banner warn">Closing a critical excursion requires a note (enforced by the API).</div>
      ) : null}
      <input
        type="text"
        placeholder="Review note (required to close critical)"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        style={{ width: "100%", marginBottom: 8 }}
      />
      <div className="row">
        {excursion.status === "open" ? (
          <button type="button" disabled={busy} onClick={() => transition("acknowledged")}>
            Acknowledge
          </button>
        ) : null}
        {excursion.status !== "closed" ? (
          <button type="button" className="primary" disabled={busy} onClick={() => transition("closed")}>
            Close
          </button>
        ) : (
          <StatusBadge value={excursion.status} />
        )}
      </div>
    </div>
  );
}

export function PolicyEditor({ policy, onUpdated }) {
  const [form, setForm] = useState({
    min_c: policy.min_c,
    max_c: policy.max_c,
    max_excursion_minutes: policy.max_excursion_minutes,
    minor_deviation_c: policy.minor_deviation_c,
    major_deviation_c: policy.major_deviation_c,
    critical_duration_minutes: policy.critical_duration_minutes,
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const update = (field) => (event) => setForm((previous) => ({ ...previous, [field]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const updated = await api.updatePolicy(policy.id, {
        min_c: Number(form.min_c),
        max_c: Number(form.max_c),
        max_excursion_minutes: Number(form.max_excursion_minutes),
        minor_deviation_c: Number(form.minor_deviation_c),
        major_deviation_c: Number(form.major_deviation_c),
        critical_duration_minutes: Number(form.critical_duration_minutes),
        updated_by: "operator-1",
      });
      onUpdated?.(updated);
    } catch (apiError) {
      setError(apiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <FieldErrors error={error} />
      <div className="form-row">
        <label>
          Min °C
          <input type="number" step="0.1" value={form.min_c} onChange={update("min_c")} />
        </label>
        <label>
          Max °C
          <input type="number" step="0.1" value={form.max_c} onChange={update("max_c")} />
        </label>
        <label>
          Tolerance (min)
          <input type="number" value={form.max_excursion_minutes} onChange={update("max_excursion_minutes")} />
        </label>
        <label>
          Minor deviation °C
          <input type="number" step="0.1" value={form.minor_deviation_c} onChange={update("minor_deviation_c")} />
        </label>
        <label>
          Major deviation °C
          <input type="number" step="0.1" value={form.major_deviation_c} onChange={update("major_deviation_c")} />
        </label>
        <label>
          Critical duration (min)
          <input type="number" value={form.critical_duration_minutes} onChange={update("critical_duration_minutes")} />
        </label>
      </div>
      <div className="form-actions">
        <button type="submit" className="primary" disabled={busy}>
          {busy ? "Saving…" : `Save new version (current v${policy.version})`}
        </button>
      </div>
    </form>
  );
}

export function RiskFactorTable({ factors }) {
  if (!factors) return <p className="muted small">No factors returned.</p>;
  return (
    <div className="grid cols-3">
      <div>
        <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)" }}>Disruption</p>
        <FactorList factors={factors.disruption} />
      </div>
      <div>
        <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)" }}>Cold chain</p>
        <FactorList factors={factors.coldchain} />
      </div>
      <div>
        <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)" }}>Weights</p>
        <FactorList factors={factors.weights} />
      </div>
    </div>
  );
}

// Policy bounds and excursion windows are backend-provided values; the chart only draws them.
export function TemperatureChart({ readings, policy, excursions = [] }) {
  if (!readings || readings.length === 0) return null;
  const data = readings.map((reading) => ({
    t: new Date(reading.timestamp).getTime(),
    temperature_c: reading.temperature_c,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="t"
          type="number"
          domain={["dataMin", "dataMax"]}
          tick={{ fontSize: 11, fill: "var(--text-3)", fontFamily: "var(--font-mono)" }}
          tickFormatter={(value) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        />
        <YAxis
          domain={["auto", "auto"]}
          unit="°C"
          tick={{ fontSize: 11, fill: "var(--text-3)", fontFamily: "var(--font-mono)" }}
        />
        <Tooltip
          labelFormatter={(value) => new Date(value).toLocaleString()}
          contentStyle={{ fontFamily: "var(--font-mono)", fontSize: 12, border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "var(--surface)" }}
        />
        {policy ? <ReferenceLine y={policy.max_c} stroke="var(--red)" strokeDasharray="4 4" label={{ value: "policy max", fontSize: 10, fill: "var(--red)" }} /> : null}
        {policy ? <ReferenceLine y={policy.min_c} stroke="var(--blue)" strokeDasharray="4 4" label={{ value: "policy min", fontSize: 10, fill: "var(--blue)" }} /> : null}
        {excursions
          .filter((excursion) => excursion.start_time && excursion.end_time)
          .map((excursion) => (
            <ReferenceArea
              key={excursion.id}
              x1={new Date(excursion.start_time).getTime()}
              x2={new Date(excursion.end_time).getTime()}
              fill="var(--red)"
              fillOpacity={0.06}
            />
          ))}
        <Line type="monotone" dataKey="temperature_c" dot={false} stroke="var(--accent)" strokeWidth={1.5} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function RedeploymentCard({ candidate, onSelect, busy }) {
  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <header>
        <div>
          <h3 style={{ fontSize: 13, fontFamily: "var(--font-mono)", fontWeight: 600, textTransform: "none", letterSpacing: "0.01em", color: "var(--text)" }}>
            {candidate.asset.id}
            <span style={{ fontFamily: "var(--font-sans)", color: "var(--text-3)", fontWeight: 400, fontSize: 12, marginLeft: 8 }}>
              {candidate.asset.type}{candidate.asset.refrigerated ? " · ❄ refrigerated" : ""}
            </span>
          </h3>
          <p className="card-sub" style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
            cap {candidate.asset.capacity_units} · {candidate.factors.distance_km} km · idle {candidate.factors.idle_minutes} min
          </p>
        </div>
        <ScoreBar score={candidate.score} label="redeployment score" />
      </header>
      <div className="card-body">
        {candidate.factors.contention_count > 1 ? (
          <div className="banner warn" style={{ marginBottom: 10 }}>
            Also a top candidate for {candidate.factors.contention_count - 1} other shipment(s) — allocate manually.
          </div>
        ) : null}
        <FactorList factors={candidate.factors} />
        <ReasonList reasons={candidate.reasons} />
        <div className="row mt">
          <button type="button" className="primary" disabled={busy} onClick={() => onSelect(candidate)}>
            Create pending recommendation
          </button>
          <span className="small muted">Human approval required — nothing is auto-assigned.</span>
        </div>
      </div>
    </div>
  );
}
