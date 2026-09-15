import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api/endpoints.js";
import { useApi } from "../hooks/useApi.js";
import { Card, FilterBar, FilterField, PageHeader, RefreshButton, Tabs } from "../components/layout.jsx";
import { DataTable, StatusBadge } from "../components/display.jsx";
import { EmptyState, ErrorState, LoadingSkeleton } from "../components/states.jsx";
import { REGION_CODES } from "../components/domain.jsx";
import { formatDateTime, formatValue } from "../utils/format.js";

const ASSET_TYPES = ["truck", "container", "vessel"];
const ASSET_STATES = ["available", "assigned", "reserved", "maintenance", "retired"];

export function FleetScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "idle" ? "idle" : "all";

  const [region, setRegion] = useState("");
  const [type, setType] = useState("");
  const [state, setState] = useState("");
  const [minIdle, setMinIdle] = useState("");

  const fleet = useApi(
    () => api.fleet({ region_code: region || undefined, type: type || undefined, state: state || undefined, limit: 200 }),
    [region, type, state],
    { enabled: tab === "all" },
  );
  const idle = useApi(
    () => api.idleAssets({ region_code: region || undefined, min_idle_minutes: minIdle || undefined, limit: 200 }),
    [region, minIdle],
    { enabled: tab === "idle" },
  );

  const idStyle = { fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600, letterSpacing: "0.01em" };
  const monoSm = { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-2)" };

  const fleetColumns = [
    { key: "id", header: "Asset", render: (row) => <span style={idStyle}>{row.asset.id}</span> },
    { key: "type", header: "Type", render: (row) => <span className="badge neutral no-dot" style={{ textTransform: "none" }}>{row.asset.type}</span> },
    {
      key: "refrigerated",
      header: "Refrig.",
      render: (row) => (row.asset.refrigerated ? <span className="badge info no-dot">❄ yes</span> : <span className="muted small">—</span>),
    },
    { key: "capacity", header: "Cap.", render: (row) => <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{row.asset.capacity_units}</span> },
    {
      key: "state",
      header: "State",
      render: (row) => (
        <div className="row" style={{ gap: 5 }}>
          <StatusBadge value={row.operational_state} />
          {(row.anomalies ?? []).map((anomaly) => (
            <span className="badge review" key={anomaly} title="Data anomaly — surfaced, never auto-resolved">
              {anomaly.replace(/_/g, " ")}
            </span>
          ))}
        </div>
      ),
    },
    { key: "region", header: "Region", render: (row) => <span style={{ fontSize: 12 }}>{row.asset.current_region_code}</span> },
    { key: "idle", header: "Idle min", render: (row) => <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, textAlign: "right" }}>{formatValue(row.idle_minutes)}</span> },
    {
      key: "next",
      header: "Next assignment",
      render: (row) =>
        row.next_assignment ? (
          <span style={monoSm}>
            {row.next_assignment.assignment_id} · {row.next_assignment.shipment_id} · {formatDateTime(row.next_assignment.start_time)}
            {row.next_assignment.reserved ? " · reserved" : ""}
          </span>
        ) : (
          <span className="muted small">—</span>
        ),
    },
  ];

  const idleColumns = [
    { key: "id", header: "Asset", render: (row) => <span style={idStyle}>{row.asset.id}</span> },
    { key: "type", header: "Type", render: (row) => <span className="badge neutral no-dot" style={{ textTransform: "none" }}>{row.asset.type}</span> },
    { key: "region", header: "Region", render: (row) => <span style={{ fontSize: 12 }}>{row.asset.current_region_code}</span> },
    { key: "capacity", header: "Cap.", render: (row) => <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{row.asset.capacity_units}</span> },
    {
      key: "refrigerated",
      header: "Refrig.",
      render: (row) => (row.asset.refrigerated ? <span className="badge info no-dot">❄ yes</span> : <span className="muted small">—</span>),
    },
    { key: "idle", header: "Idle min", render: (row) => <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{row.idle_minutes}</span> },
    { key: "since", header: "Idle since", render: (row) => <span style={monoSm}>{formatDateTime(row.idle_since)}</span> },
  ];

  return (
    <div>
      <PageHeader
        title="Fleet"
        subtitle="Derived states, idle durations and anomaly flags — all computed by the backend"
        actions={<RefreshButton onClick={tab === "all" ? fleet.refresh : idle.refresh} loading={tab === "all" ? fleet.loading : idle.loading} />}
      />

      <Tabs
        tabs={[
          { id: "all", label: "All assets" },
          { id: "idle", label: "Idle assets" },
        ]}
        active={tab}
        onChange={(next) => setSearchParams({ tab: next })}
      />

      <FilterBar>
        <FilterField label="Region">
          <select value={region} onChange={(event) => setRegion(event.target.value)}>
            <option value="">all</option>
            {REGION_CODES.map((code) => (
              <option key={code} value={code}>{code}</option>
            ))}
          </select>
        </FilterField>
        {tab === "all" ? (
          <>
            <FilterField label="Type">
              <select value={type} onChange={(event) => setType(event.target.value)}>
                <option value="">all</option>
                {ASSET_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </FilterField>
            <FilterField label="State">
              <select value={state} onChange={(event) => setState(event.target.value)}>
                <option value="">all</option>
                {ASSET_STATES.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </FilterField>
          </>
        ) : (
          <FilterField label="Min idle (min)">
            <input type="number" min="0" value={minIdle} onChange={(event) => setMinIdle(event.target.value)} />
          </FilterField>
        )}
      </FilterBar>

      {tab === "all" ? (
        <Card title="Fleet Assets" subtitle="Reserved assets stay visible but are never offered for redeployment">
          {fleet.loading ? <LoadingSkeleton rows={6} /> : null}
          {fleet.error ? <ErrorState error={fleet.error} onRetry={fleet.refresh} /> : null}
          {fleet.data && fleet.data.count === 0 ? <EmptyState title="No fleet assets match the filters" /> : null}
          {fleet.data && fleet.data.count > 0 ? (
            <DataTable columns={fleetColumns} rows={fleet.data.data} rowKey={(row) => row.asset.id} />
          ) : null}
        </Card>
      ) : (
        <>
          <Card title="Idle Assets" subtitle="Available, not assigned and not reserved">
            {idle.loading ? <LoadingSkeleton rows={5} /> : null}
            {idle.error ? <ErrorState error={idle.error} onRetry={idle.refresh} /> : null}
            {idle.data && idle.data.count === 0 ? (
              <EmptyState title="No idle assets" message="See the exclusion reasons below." />
            ) : null}
            {idle.data && idle.data.count > 0 ? (
              <DataTable columns={idleColumns} rows={idle.data.data} rowKey={(row) => row.asset.id} />
            ) : null}
          </Card>
          {idle.data?.excluded?.length > 0 ? (
            <Card title="Excluded from idle" subtitle="Backend-provided reasons — never silently dropped">
              <DataTable
                columns={[
                  { key: "asset_id", header: "Asset", render: (row) => <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{row.asset_id}</span> },
                  { key: "reason", header: "Reason", render: (row) => <span className="badge review">{String(row.reason).replace(/_/g, " ")}</span> },
                  { key: "until", header: "Until", render: (row) => (row.until ? <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{formatDateTime(row.until)}</span> : "—") },
                ]}
                rows={idle.data.excluded}
                rowKey={(row, index) => `${row.asset_id}-${index}`}
              />
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
