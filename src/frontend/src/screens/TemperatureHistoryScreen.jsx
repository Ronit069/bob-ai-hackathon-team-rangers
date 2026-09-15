import { Link, useParams } from "react-router-dom";
import { api } from "../api/endpoints.js";
import { useApi } from "../hooks/useApi.js";
import { Card, PageHeader, RefreshButton } from "../components/layout.jsx";
import { DataTable, FactorList, StatusBadge } from "../components/display.jsx";
import { TemperatureChart } from "../components/domain.jsx";
import { EmptyState, ErrorState, LoadingSkeleton, UnknownReviewBanner } from "../components/states.jsx";
import { formatDateTime } from "../utils/format.js";

const monoVal = { fontFamily: "var(--font-mono)", fontWeight: 600 };
const monoSm  = { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" };

export function TemperatureHistoryScreen() {
  const { id } = useParams();
  const readings = useApi(() => api.sensorReadings(id, { order: "asc" }), [id]);
  const excursions = useApi(() => api.listExcursions({ shipment_id: id, limit: 100 }), [id]);

  const sensor = readings.data?.sensor;
  const quality = readings.data?.quality;
  const sensorFailed = sensor && (sensor.status === "failed" || sensor.status === "unknown");

  return (
    <div>
      <PageHeader
        title={`Temperature History · ${id}`}
        subtitle="Readings, policy bounds and backend-detected excursion windows"
        actions={
          <>
            <Link className="btn" to={`/shipments/${id}`}>Shipment</Link>
            <RefreshButton onClick={readings.refresh} loading={readings.loading} />
          </>
        }
      />

      <Card title="Sensor Quality" subtitle="All counts and statuses come from the backend quality block">
        {readings.loading ? <LoadingSkeleton rows={3} /> : null}
        {readings.error ? <ErrorState error={readings.error} onRetry={readings.refresh} /> : null}
        {readings.data ? (
          <>
            <div className="stat-strip" style={{ marginBottom: sensorFailed ? 16 : 0 }}>
              <div className="metric-card">
                <div className="metric-label">Sensor</div>
                <div className="metric-value"><StatusBadge value={sensor?.status} /></div>
                <div className="metric-sub" style={monoSm}>last {formatDateTime(sensor?.last_reading_at)}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Readings</div>
                <div className="metric-value" style={monoVal}>{readings.data.count}</div>
                <div className="metric-sub" style={monoSm}>gap count {sensor?.gap_count ?? 0}</div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Quality flags</div>
                <div className="metric-value" style={{ ...monoVal, fontSize: 13 }}>
                  gaps {quality?.gaps ?? 0} · dupes {quality?.duplicates ?? 0}
                </div>
                <div className="metric-sub" style={monoSm}>
                  oo-order {quality?.out_of_order ?? 0} · implausible {quality?.implausible ?? 0}
                </div>
              </div>
              <div className="metric-card">
                <div className="metric-label">Policy °C</div>
                <div className="metric-value" style={{ ...monoVal, fontSize: 14 }}>
                  {readings.data.policy
                    ? `${readings.data.policy.min_c} … ${readings.data.policy.max_c} °C`
                    : <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>none</span>}
                </div>
                <div className="metric-sub" style={monoSm}>{readings.data.policy?.id ?? "no policy — review required"}</div>
              </div>
            </div>
            {sensorFailed ? (
              <UnknownReviewBanner reason={`sensor ${sensor.status} (${sensor.minutes_since_last ?? "?"} min since last reading)`} />
            ) : null}
          </>
        ) : null}
      </Card>

      <Card title="Temperature Chart" subtitle="Dashed lines are policy bounds; shaded bands are backend-detected excursions">
        {readings.loading ? <LoadingSkeleton rows={4} /> : null}
        {readings.data && readings.data.count === 0 ? <EmptyState title="No readings yet" /> : null}
        {readings.data && readings.data.count > 0 ? (
          <TemperatureChart
            readings={readings.data.data}
            policy={readings.data.policy}
            excursions={excursions.data?.data ?? []}
          />
        ) : null}
      </Card>

      <Card title="Excursions for this shipment" subtitle="Detected and classified by the backend">
        {excursions.loading ? <LoadingSkeleton rows={3} /> : null}
        {excursions.error ? <ErrorState error={excursions.error} onRetry={excursions.refresh} /> : null}
        {excursions.data && excursions.data.count === 0 ? (
          <EmptyState title="No excursions detected" />
        ) : null}
        {excursions.data && excursions.data.count > 0 ? (
          <DataTable
            columns={[
              { key: "id", header: "Excursion", render: (row) => (
                <Link className="link" to={`/excursions/${row.id}`} style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 12 }}>{row.id}</Link>
              )},
              { key: "severity", header: "Severity", render: (row) => <StatusBadge value={row.severity} /> },
              { key: "start_time", header: "Start", render: (row) => <span style={monoSm}>{formatDateTime(row.start_time)}</span> },
              { key: "duration_min", header: "Duration (min)", render: (row) => <span style={{ fontFamily: "var(--font-mono)" }}>{row.duration_min}</span> },
              { key: "peak_deviation_c", header: "Peak dev °C", render: (row) => <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>{row.peak_deviation_c}</span> },
              { key: "data_quality", header: "Data quality", render: (row) => <StatusBadge value={row.data_quality} /> },
              { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
            ]}
            rows={excursions.data.data}
            rowKey={(row) => row.id}
          />
        ) : null}
        {excursions.data?.data?.[0] ? (
          <div style={{ marginTop: 12 }}>
            <FactorList
              factors={{
                recommended_action: excursions.data.data[0].recommended_action,
                time_to_delivery_hours: excursions.data.data[0].time_to_delivery_hours,
                rationale: excursions.data.data[0].severity_rationale,
              }}
            />
          </div>
        ) : null}
      </Card>
    </div>
  );
}
