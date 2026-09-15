import { useState } from "react";
import { api } from "../api/endpoints.js";
import { useApi } from "../hooks/useApi.js";
import { Card, FilterBar, FilterField, PageHeader, RefreshButton } from "../components/layout.jsx";
import { DataTable } from "../components/display.jsx";
import { EmptyState, ErrorState, LoadingSkeleton } from "../components/states.jsx";
import { formatDateTime } from "../utils/format.js";

const ENTITY_TYPES = [
  "shipment",
  "route",
  "carrier",
  "disruption",
  "fleet_asset",
  "sensor_reading",
  "temperature_policy",
  "temperature_excursion",
  "recommendation",
  "risk_assessment",
];

export function AuditScreen() {
  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");
  const [order, setOrder] = useState("desc");
  const audit = useApi(
    () =>
      api.audit({
        entity_type: entityType || undefined,
        entity_id: entityId || undefined,
        order,
        limit: 200,
      }),
    [entityType, entityId, order],
  );

  return (
    <div>
      <PageHeader
        title="Audit Trail"
        subtitle="Append-only decision and event log. Records are never updated or deleted."
        actions={<RefreshButton onClick={audit.refresh} loading={audit.loading} />}
      />

      <FilterBar>
        <FilterField label="Entity type">
          <select value={entityType} onChange={(event) => setEntityType(event.target.value)}>
            <option value="">all</option>
            {ENTITY_TYPES.map((type) => (
              <option key={type} value={type}>{type.replace(/_/g, " ")}</option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Entity ID">
          <input type="text" value={entityId} onChange={(event) => setEntityId(event.target.value)} placeholder="e.g. REC-0001" />
        </FilterField>
        <FilterField label="Order">
          <select value={order} onChange={(event) => setOrder(event.target.value)}>
            <option value="desc">newest first</option>
            <option value="asc">oldest first</option>
          </select>
        </FilterField>
      </FilterBar>

      <Card title="Records" subtitle="Actor stored verbatim; decisions default to operator-1" noPad>
        {audit.loading ? <div style={{ padding: 16 }}><LoadingSkeleton rows={6} /></div> : null}
        {audit.error ? <div style={{ padding: 16 }}><ErrorState error={audit.error} onRetry={audit.refresh} /></div> : null}
        {audit.data && audit.data.count === 0 ? (
          <EmptyState title="No decisions recorded yet" message="Approvals, rejections and policy updates will appear here." />
        ) : null}
        {audit.data && audit.data.count > 0 ? (
          audit.data.data.map((row) => (
            <div className="audit-row" key={row.id}>
              <div className="audit-ts">{formatDateTime(row.timestamp)}</div>
              <div className="audit-body">
                <div className="row" style={{ gap: 6, marginBottom: 4 }}>
                  <span className="badge info" style={{ fontSize: 10 }}>{String(row.action).replace(/_/g, " ")}</span>
                  <span className="badge neutral no-dot" style={{ fontSize: 10 }}>{row.entity_type}</span>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{row.entity_id}</span>
                </div>
                <div className="small muted">
                  Actor: <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{row.actor}</span>
                  {row.details?.notes ? <span> · {row.details.notes}</span> : null}
                  {row.details?.decision ? <span> · decision: <strong style={{ color: "var(--text)" }}>{row.details.decision}</strong></span> : null}
                </div>
              </div>
              <div>
                <details style={{ fontSize: 11 }}>
                  <summary style={{ cursor: "pointer", color: "var(--text-3)", userSelect: "none" }}>details</summary>
                  <pre className="json" style={{ maxHeight: 120, marginTop: 4 }}>{JSON.stringify(row.details, null, 2)}</pre>
                </details>
              </div>
            </div>
          ))
        ) : null}
      </Card>
    </div>
  );
}
