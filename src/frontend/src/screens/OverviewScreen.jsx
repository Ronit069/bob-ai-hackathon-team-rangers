import { Link } from "react-router-dom";
import { api } from "../api/endpoints.js";
import { useApi } from "../hooks/useApi.js";
import { usePolling } from "../hooks/usePolling.js";
import { Card, PageHeader, RefreshButton } from "../components/layout.jsx";
import { DataTable, ScoreBar, StatusBadge } from "../components/display.jsx";
import { EmptyState, ErrorState, LoadingSkeleton } from "../components/states.jsx";
import { formatDateTime } from "../utils/format.js";

const POLL_MS = 30_000;

function severityClass(row) {
  const s = row.combined_score ?? 0;
  if (s >= 0.75) return "critical";
  if (s >= 0.5) return "major";
  if (s >= 0.25) return "warning";
  return "ok";
}

export function OverviewScreen() {
  const overview = useApi(() => api.riskOverview({ limit: 25 }), []);
  const disruptions = useApi(() => api.listDisruptions({ status: "active", limit: 50 }), []);
  const alerts = useApi(() => api.alerts(), []);

  usePolling(overview.refresh, POLL_MS);

  const excursionAlerts = (alerts.data?.data ?? []).filter((row) => row.type === "excursion");
  const sensorAlerts = (alerts.data?.data ?? []).filter((row) => row.type === "sensor_failure");

  return (
    <div>
      <PageHeader
        title="Control Tower"
        subtitle={`Priority worklist — combined disruption + cold-chain risk · auto-refresh every ${POLL_MS / 1000} s`}
        actions={<RefreshButton onClick={overview.refresh} loading={overview.loading} />}
      />

      {/* KPI strip */}
      <div className="stat-strip">
        <div className={`metric ${(disruptions.data?.count ?? 0) > 0 ? "danger-stripe" : "accent-stripe"}`}>
          <div className="label">Active Disruptions</div>
          <div className={`value ${(disruptions.data?.count ?? 0) > 0 ? "critical" : ""}`}>
            {disruptions.loading ? "—" : (disruptions.data?.count ?? "—")}
          </div>
          <div className="hint">current window</div>
        </div>
        <div className="metric accent-stripe">
          <div className="label">Ranked Shipments</div>
          <div className="value">{overview.loading ? "—" : (overview.data?.count ?? "—")}</div>
          <div className="hint">combined score &gt; 0</div>
        </div>
        <div className={`metric ${excursionAlerts.length > 0 ? "danger-stripe" : ""}`}>
          <div className="label">Excursion alerts</div>
          <div className={`value ${excursionAlerts.length > 0 ? "critical" : ""}`}>
            {excursionAlerts.length}
          </div>
          <div className="hint">open, pre-delivery</div>
        </div>
        <div className={`metric ${sensorAlerts.length > 0 ? "warn-stripe" : ""}`}>
          <div className="label">Sensor-failure alerts</div>
          <div className={`value ${sensorAlerts.length > 0 ? "warn" : ""}`}>
            {sensorAlerts.length}
          </div>
          <div className="hint">feed stopped ≥ 4× interval</div>
        </div>
      </div>

      {/* Priority worklist */}
      <Card
        title="Priority Worklist"
        subtitle="Ordered by combined score · disruption + cold-chain"
        noPad
      >
        {overview.loading ? <div style={{ padding: "16px 18px" }}><LoadingSkeleton rows={6} /></div> : null}
        {overview.error ? <div style={{ padding: "16px 18px" }}><ErrorState error={overview.error} onRetry={overview.refresh} /></div> : null}
        {overview.data && overview.data.count === 0 ? (
          <EmptyState title="No active risk items" message="No actionable shipment currently has a combined score above zero." />
        ) : null}
        {overview.data && overview.data.count > 0 ? (
          overview.data.data.map((row) => {
            const sev = severityClass(row);
            return (
              <div className="priority-row" key={row.shipment.id}>
                <div className={`sev-bar ${sev}`} />
                <div className="row-content">
                  {/* ID + type */}
                  <span className="row-id">
                    <Link className="link" to={`/shipments/${row.shipment.id}`}>
                      {row.shipment.id}
                    </Link>
                  </span>
                  <span className="row-meta">
                    {row.shipment.cargo_type.replace(/_/g, " ")}
                    {row.shipment.is_cold_chain ? <span className="badge info no-dot" style={{ marginLeft: 6, fontSize: 10 }}>❄ cold chain</span> : null}
                  </span>
                  <StatusBadge value={row.shipment.status} />
                  {/* Scores */}
                  <div className="row-scores">
                    <div className="score-col">
                      <span className="score-label">Disruption</span>
                      <ScoreBar score={row.disruption_risk} />
                    </div>
                    <div className="score-col">
                      <span className="score-label">Cold chain</span>
                      <ScoreBar score={row.coldchain_risk} />
                    </div>
                    <div className="score-col">
                      <span className="score-label">Combined</span>
                      <ScoreBar score={row.combined_score} />
                    </div>
                  </div>
                </div>
                <div className="row-action">
                  <Link className="btn" to={`/shipments/${row.shipment.id}/risk`} style={{ fontSize: 12 }}>Inspect</Link>
                </div>
              </div>
            );
          })
        ) : null}
      </Card>

      {/* Active disruptions table */}
      <Card title="Active Disruptions" subtitle="Events within their active window">
        {disruptions.loading ? <LoadingSkeleton rows={3} /> : null}
        {disruptions.error ? <ErrorState error={disruptions.error} onRetry={disruptions.refresh} /> : null}
        {disruptions.data && disruptions.data.count === 0 ? <EmptyState title="No active disruptions" /> : null}
        {disruptions.data && disruptions.data.count > 0 ? (
          <DataTable
            columns={[
              {
                key: "id",
                header: "ID",
                render: (row) => <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600 }}>{row.id}</span>,
              },
              {
                key: "type",
                header: "Type",
                render: (row) => <span className="badge neutral no-dot">{row.type.replace(/_/g, " ")}</span>,
              },
              { key: "region_code", header: "Region" },
              { key: "severity", header: "Sev" },
              {
                key: "window",
                header: "Window",
                render: (row) => (
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-2)" }}>
                    {formatDateTime(row.start_time)} → {row.end_time ? formatDateTime(row.end_time) : "open"}
                  </span>
                ),
              },
              {
                key: "open",
                header: "",
                render: (row) => (
                  <Link className="link" to={`/disruptions/${row.id}/affected`}>
                    affected shipments →
                  </Link>
                ),
              },
            ]}
            rows={disruptions.data.data}
            rowKey={(row) => row.id}
          />
        ) : null}
      </Card>
    </div>
  );
}
