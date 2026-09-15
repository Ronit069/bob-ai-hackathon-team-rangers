import { Link } from "react-router-dom";
import { api } from "../api/endpoints.js";
import { useApi } from "../hooks/useApi.js";
import { usePolling } from "../hooks/usePolling.js";
import { Card, PageHeader, RefreshButton } from "../components/layout.jsx";
import { DataTable, MetricCard, ScoreBar, StatusBadge } from "../components/display.jsx";
import { EmptyState, ErrorState, LoadingSkeleton } from "../components/states.jsx";
import { formatDateTime } from "../utils/format.js";

const POLL_MS = 30_000; // A2

export function OverviewScreen() {
  const overview = useApi(() => api.riskOverview({ limit: 25 }), []);
  const disruptions = useApi(() => api.listDisruptions({ status: "active", limit: 50 }), []);
  const alerts = useApi(() => api.alerts(), []);

  usePolling(overview.refresh, POLL_MS);

  const excursionAlerts = (alerts.data?.data ?? []).filter((row) => row.type === "excursion");
  const sensorAlerts = (alerts.data?.data ?? []).filter((row) => row.type === "sensor_failure");
  const top = overview.data?.data?.[0] ?? null;

  return (
    <div>
      <PageHeader
        title="Control tower"
        subtitle="One ranked worklist combining disruption exposure and cold-chain risk (P2)."
        actions={<RefreshButton onClick={overview.refresh} loading={overview.loading} />}
      />

      <div className="grid cols-4">
        <MetricCard label="Active disruptions" value={disruptions.data?.count ?? "—"} hint="backend window rule" />
        <MetricCard label="Ranked shipments" value={overview.data?.count ?? "—"} hint="combined score > 0" />
        <MetricCard label="Excursion alerts" value={excursionAlerts.length} hint="open, pre-delivery" />
        <MetricCard label="Sensor-failure alerts" value={sensorAlerts.length} hint="feed stopped ≥ 4× interval" />
      </div>

      {top ? (
        <Card
          title="Highest combined risk"
          subtitle="Score and factors are computed by the backend risk engine — never in the UI."
          actions={
            <Link className="btn" to={`/shipments/${top.shipment.id}/risk`}>
              Explain risk
            </Link>
          }
        >
          <div className="grid cols-4">
            <MetricCard label="Shipment" value={top.shipment.id} hint={`${top.shipment.cargo_type.replace(/_/g, " ")} · deadline ${formatDateTime(top.shipment.deadline)}`} />
            <MetricCard label="Disruption risk" value={<ScoreBar score={top.disruption_risk} />} />
            <MetricCard label="Cold-chain risk" value={<ScoreBar score={top.coldchain_risk} />} />
            <MetricCard label="Combined score" value={<ScoreBar score={top.combined_score} />} />
          </div>
        </Card>
      ) : null}

      <Card title="Priority worklist" subtitle={`Auto-refresh every ${POLL_MS / 1000} s · ordered by combined score (desc).`}>
        {overview.loading ? <LoadingSkeleton rows={6} /> : null}
        {overview.error ? <ErrorState error={overview.error} onRetry={overview.refresh} /> : null}
        {overview.data && overview.data.count === 0 ? (
          <EmptyState title="No active risk items" message="No actionable shipment currently has a combined score above zero." />
        ) : null}
        {overview.data && overview.data.count > 0 ? (
          <DataTable
            columns={[
              {
                key: "shipment",
                header: "Shipment",
                render: (row) => (
                  <Link className="link" to={`/shipments/${row.shipment.id}`}>
                    {row.shipment.id}
                  </Link>
                ),
              },
              { key: "cargo", header: "Cargo", render: (row) => row.shipment.cargo_type.replace(/_/g, " ") },
              {
                key: "cold",
                header: "Cold chain",
                render: (row) => (row.shipment.is_cold_chain ? <StatusBadge value="active" kind="cold" /> : <span className="muted">no</span>),
              },
              { key: "status", header: "Status", render: (row) => <StatusBadge value={row.shipment.status} /> },
              { key: "disruption", header: "Disruption risk", render: (row) => <ScoreBar score={row.disruption_risk} /> },
              { key: "coldrisk", header: "Cold-chain risk", render: (row) => <ScoreBar score={row.coldchain_risk} /> },
              { key: "combined", header: "Combined", render: (row) => <ScoreBar score={row.combined_score} /> },
              {
                key: "factors",
                header: "Top factors",
                render: (row) => (
                  <span className="small muted">
                    {row.factors?.coldchain?.severity ? `cold: ${row.factors.coldchain.severity}` : "cold: none"}
                    {row.factors?.disruption?.impact_status ? ` · disruption: ${row.factors.disruption.impact_status}` : ""}
                  </span>
                ),
              },
            ]}
            rows={overview.data.data}
            rowKey={(row) => row.shipment.id}
          />
        ) : null}
      </Card>

      <Card title="Active disruptions" subtitle="Only events inside their active window are listed.">
        {disruptions.loading ? <LoadingSkeleton rows={3} /> : null}
        {disruptions.error ? <ErrorState error={disruptions.error} onRetry={disruptions.refresh} /> : null}
        {disruptions.data && disruptions.data.count === 0 ? <EmptyState title="No active disruptions" /> : null}
        {disruptions.data && disruptions.data.count > 0 ? (
          <DataTable
            columns={[
              { key: "id", header: "ID" },
              { key: "type", header: "Type", render: (row) => row.type.replace(/_/g, " ") },
              { key: "region_code", header: "Region" },
              { key: "severity", header: "Severity" },
              { key: "window", header: "Window", render: (row) => `${formatDateTime(row.start_time)} → ${row.end_time ? formatDateTime(row.end_time) : "open-ended"}` },
              {
                key: "open",
                header: "",
                render: (row) => (
                  <Link className="link" to={`/disruptions/${row.id}/affected`}>
                    affected shipments
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
