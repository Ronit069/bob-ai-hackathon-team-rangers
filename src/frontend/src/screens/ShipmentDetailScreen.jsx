import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/endpoints.js";
import { useApi } from "../hooks/useApi.js";
import { Card, PageHeader, RefreshButton, Tabs } from "../components/layout.jsx";
import { DataTable, FactorList, ScoreBar, StatusBadge } from "../components/display.jsx";
import { DecisionButtons } from "../components/domain.jsx";
import {
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  NotActionableBanner,
  UnknownReviewBanner,
} from "../components/states.jsx";
import { formatDateTime, formatMoneyUsd } from "../utils/format.js";

const TABS = [
  { id: "route", label: "Route" },
  { id: "risk", label: "Risk" },
  { id: "sensors", label: "Sensors" },
  { id: "recommendations", label: "Recommendations" },
  { id: "audit", label: "Audit" },
];

export function ShipmentDetailScreen() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = TABS.some((item) => item.id === searchParams.get("tab")) ? searchParams.get("tab") : "route";

  const shipment = useApi(() => api.getShipment(id), [id]);
  const risk = useApi(() => api.shipmentRisk(id), [id], { enabled: tab === "risk" });
  const sensors = useApi(() => api.sensorReadings(id, { order: "asc" }), [id], { enabled: tab === "sensors" });
  const recommendations = useApi(
    () => api.listRecommendations({ shipment_id: id, limit: 50 }),
    [id],
    { enabled: tab === "recommendations" },
  );
  const audit = useApi(() => api.audit({ entity_id: id, order: "desc", limit: 100 }), [id], { enabled: tab === "audit" });

  if (shipment.loading) return <LoadingSkeleton rows={6} />;
  if (shipment.error) return <ErrorState error={shipment.error} onRetry={shipment.refresh} />;
  if (!shipment.data) return <EmptyState title="Shipment not found" />;

  const data = shipment.data;
  const delivered = data.status === "delivered" || data.status === "cancelled";

  return (
    <div>
      <PageHeader
        title={`Shipment ${data.id}`}
        subtitle={`${data.cargo_type.replace(/_/g, " ")} · ${data.is_cold_chain ? "cold chain" : "standard"} · ${formatMoneyUsd(data.cargo_value_usd)} · deadline ${formatDateTime(data.deadline)}`}
        actions={
          <>
            <StatusBadge value={data.status} />
            <Link className="btn" to={`/shipments/${id}/alternatives`}>
              Alternatives
            </Link>
            <Link className="btn" to={`/shipments/${id}/redeployment`}>
              Redeployment
            </Link>
            <Link className="btn" to={`/shipments/${id}/temperature`}>
              Temperature
            </Link>
            <Link className="btn" to={`/shipments/${id}/risk`}>
              Risk detail
            </Link>
          </>
        }
      />

      {delivered ? <NotActionableBanner reason={data.status} /> : null}

      <Tabs tabs={TABS} active={tab} onChange={(next) => setSearchParams({ tab: next })} />

      {tab === "route" ? (
        <Card title="Route" subtitle={`${data.route?.origin_node} → ${data.route?.destination_node} · carrier ${data.carrier?.name ?? "—"}`}>
          <div className="grid cols-4">
            <div className="metric">
              <div className="label">Route capacity</div>
              <div className="value">{data.route_capacity ?? "—"}</div>
              <div className="hint">bottleneck segment capacity</div>
            </div>
            <div className="metric">
              <div className="label">Current segment</div>
              <div className="value">{data.current_segment?.id ?? "—"}</div>
              <div className="hint">{data.current_segment?.region_code ?? "position unknown"}</div>
            </div>
            <div className="metric">
              <div className="label">Next segment</div>
              <div className="value">{data.next_segment?.id ?? "—"}</div>
              <div className="hint">{data.next_segment?.region_code ?? "final leg"}</div>
            </div>
            <div className="metric">
              <div className="label">Planned window</div>
              <div className="value small" style={{ fontSize: 13 }}>
                {formatDateTime(data.planned_departure)} → {formatDateTime(data.planned_arrival)}
              </div>
              <div className="hint">
                actual: {data.actual_departure ? formatDateTime(data.actual_departure) : "—"} →{" "}
                {data.actual_arrival ? formatDateTime(data.actual_arrival) : "—"}
              </div>
            </div>
          </div>
          <div className="mt">
            <DataTable
              columns={[
                { key: "seq", header: "Seq" },
                { key: "id", header: "Segment" },
                { key: "region_code", header: "Region" },
                { key: "mode", header: "Mode" },
                { key: "planned_duration_hours", header: "Planned hours" },
                { key: "capacity_units", header: "Capacity" },
                { key: "cost_usd", header: "Cost" },
              ]}
              rows={data.segments ?? []}
              rowKey={(row) => row.id}
            />
          </div>
        </Card>
      ) : null}

      {tab === "risk" ? (
        <Card
          title="Combined risk"
          subtitle="Backend snapshot (RC-3 factors); refresh recomputes and stores a new snapshot."
          actions={<RefreshButton onClick={risk.refresh} loading={risk.loading} />}
        >
          {risk.loading ? <LoadingSkeleton rows={4} /> : null}
          {risk.error ? <ErrorState error={risk.error} onRetry={risk.refresh} /> : null}
          {risk.data ? (
            <>
              <div className="grid cols-3">
                <div className="metric">
                  <div className="label">Disruption risk</div>
                  <div className="value">
                    <ScoreBar score={risk.data.disruption_risk} />
                  </div>
                </div>
                <div className="metric">
                  <div className="label">Cold-chain risk</div>
                  <div className="value">
                    <ScoreBar score={risk.data.coldchain_risk} />
                  </div>
                </div>
                <div className="metric">
                  <div className="label">Combined score</div>
                  <div className="value">
                    <ScoreBar score={risk.data.combined_score} />
                  </div>
                </div>
              </div>
              <div className="mt">
                <FactorList factors={risk.data.factors?.coldchain} />
              </div>
            </>
          ) : null}
        </Card>
      ) : null}

      {tab === "sensors" ? (
        <Card title="Sensor status" subtitle="Quality flags and sensor health for this shipment.">
          {sensors.loading ? <LoadingSkeleton rows={4} /> : null}
          {sensors.error ? <ErrorState error={sensors.error} onRetry={sensors.refresh} /> : null}
          {sensors.data ? (
            <>
              <div className="grid cols-3">
                <div className="metric">
                  <div className="label">Sensor</div>
                  <div className="value">
                    <StatusBadge value={sensors.data.sensor?.status} />
                  </div>
                  <div className="hint">last reading {formatDateTime(sensors.data.sensor?.last_reading_at)}</div>
                </div>
                <div className="metric">
                  <div className="label">Readings</div>
                  <div className="value">{sensors.data.count}</div>
                  <div className="hint">gaps {sensors.data.quality?.gaps ?? 0} · duplicates {sensors.data.quality?.duplicates ?? 0}</div>
                </div>
                <div className="metric">
                  <div className="label">Policy</div>
                  <div className="value">
                    {sensors.data.policy ? `${sensors.data.policy.min_c}…${sensors.data.policy.max_c} °C` : "none"}
                  </div>
                  <div className="hint">{sensors.data.policy?.id ?? "no policy — review required"}</div>
                </div>
              </div>
              {sensors.data.sensor?.status === "failed" || sensors.data.sensor?.status === "unknown" ? (
                <div className="mt">
                  <UnknownReviewBanner reason={`sensor ${sensors.data.sensor?.status}`} />
                </div>
              ) : null}
            </>
          ) : null}
        </Card>
      ) : null}

      {tab === "recommendations" ? (
        <Card title="Recommendations" subtitle="Every recommendation requires a human decision (audited).">
          {recommendations.loading ? <LoadingSkeleton rows={3} /> : null}
          {recommendations.error ? <ErrorState error={recommendations.error} onRetry={recommendations.refresh} /> : null}
          {recommendations.data && recommendations.data.count === 0 ? (
            <EmptyState title="No recommendations yet" message="Create one from the alternatives or redeployment screens." />
          ) : null}
          {recommendations.data?.data?.map((recommendation) => (
            <div className="card" key={recommendation.id} style={{ marginBottom: 12 }}>
              <header>
                <div>
                  <h3>
                    {recommendation.id} · {recommendation.type.replace(/_/g, " ")}
                  </h3>
                  <p className="card-sub">
                    target {recommendation.route_id ?? recommendation.carrier_id ?? recommendation.asset_id} · score{" "}
                    {recommendation.score}
                  </p>
                </div>
                <StatusBadge value={recommendation.status} />
              </header>
              <DecisionButtons recommendation={recommendation} onDecided={() => recommendations.refresh()} />
            </div>
          ))}
        </Card>
      ) : null}

      {tab === "audit" ? (
        <Card title="Audit trail" subtitle="Append-only records for this shipment.">
          {audit.loading ? <LoadingSkeleton rows={4} /> : null}
          {audit.error ? <ErrorState error={audit.error} onRetry={audit.refresh} /> : null}
          {audit.data && audit.data.count === 0 ? <EmptyState title="No decisions recorded yet" /> : null}
          {audit.data && audit.data.count > 0 ? (
            <DataTable
              columns={[
                { key: "timestamp", header: "When", render: (row) => formatDateTime(row.timestamp) },
                { key: "entity_type", header: "Entity" },
                { key: "action", header: "Action" },
                { key: "actor", header: "Actor" },
                { key: "notes", header: "Details", render: (row) => <span className="small">{row.details?.notes ?? row.details?.decision ?? "—"}</span> },
              ]}
              rows={audit.data.data}
              rowKey={(row) => row.id}
            />
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
