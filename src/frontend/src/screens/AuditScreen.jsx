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
        title="Audit trail"
        subtitle="Append-only decision and event log. Records are never updated or deleted."
        actions={<RefreshButton onClick={audit.refresh} loading={audit.loading} />}
      />

      <FilterBar>
        <FilterField label="Entity type">
          <select value={entityType} onChange={(event) => setEntityType(event.target.value)}>
            <option value="">all</option>
            {ENTITY_TYPES.map((type) => (
              <option key={type} value={type}>
                {type.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Entity id">
          <input type="text" value={entityId} onChange={(event) => setEntityId(event.target.value)} placeholder="e.g. REC-0001" />
        </FilterField>
        <FilterField label="Order">
          <select value={order} onChange={(event) => setOrder(event.target.value)}>
            <option value="desc">newest first</option>
            <option value="asc">oldest first</option>
          </select>
        </FilterField>
      </FilterBar>

      <Card title="Records" subtitle="Actor is stored verbatim; decisions default to operator-1 (D6).">
        {audit.loading ? <LoadingSkeleton rows={6} /> : null}
        {audit.error ? <ErrorState error={audit.error} onRetry={audit.refresh} /> : null}
        {audit.data && audit.data.count === 0 ? (
          <EmptyState title="No decisions recorded yet" message="Approvals, rejections and policy updates will appear here." />
        ) : null}
        {audit.data && audit.data.count > 0 ? (
          <DataTable
            columns={[
              { key: "timestamp", header: "When", render: (row) => formatDateTime(row.timestamp) },
              { key: "entity_type", header: "Entity type" },
              { key: "entity_id", header: "Entity" },
              { key: "action", header: "Action", render: (row) => <span className="badge info">{String(row.action).replace(/_/g, " ")}</span> },
              { key: "actor", header: "Actor" },
              {
                key: "details",
                header: "Details",
                render: (row) => (
                  <details>
                    <summary className="small">view</summary>
                    <pre className="json" style={{ maxHeight: 160 }}>{JSON.stringify(row.details, null, 2)}</pre>
                  </details>
                ),
              },
            ]}
            rows={audit.data.data}
            rowKey={(row) => row.id}
          />
        ) : null}
      </Card>
    </div>
  );
}
