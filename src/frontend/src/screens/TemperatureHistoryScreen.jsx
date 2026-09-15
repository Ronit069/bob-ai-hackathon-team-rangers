import { Link, useParams } from "react-router-dom";
import { api } from "../api/endpoints.js";
import { useApi } from "../hooks/useApi.js";
import { Card, PageHeader, RefreshButton } from "../components/layout.jsx";
import { DataTable, FactorList, StatusBadge } from "../components/display.jsx";
import { TemperatureChart } from "../components/domain.jsx";
import { EmptyState, ErrorState, LoadingSkeleton, UnknownReviewBanner } from "../components/states.jsx";
import { formatDateTime } from "../utils/format.js";

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
        title={`Temperature history · ${id}`}
        subtitle="Readings, policy bounds (from the backend) and backend-detected excursion windows."
        actions={
          <>
            <Link className="btn" to={`/shipments/${id}`}>
              Shipment detail
            </Link>
            <RefreshButton onClick={readings.refresh} loading={readings.loading} />
          </>
        }
      />

      <Card title="Sensor quality" subtitle="All counts and statuses come from the backend quality block.">
        {readings.loading ? <LoadingSkeleton rows={3} /> : null}
        {readings.error ? <ErrorState error={readings.error} onRetry={readings.refresh} /> : null}
        {readings.data ? (
          <div className="grid cols-4">
            <div className="metric">
              <div className="label">Sensor</div>
              <div className="value">
                <StatusBadge value={sensor?.status} />
              </div>
              <div className="hint">last reading {formatDateTime(sensor?.last_reading_at)}</div>
            </div>
            <div className="metric">
              <div className="label">Readings</div>
              <div className="value">{readings.data.count}</div>
              <div className="hint">gap count {sensor?.gap_count ?? 0}</div>
            </div>
            <div className="metric">
              <div className="label">Quality flags</div>
              <div className="value small" style={{ fontSize: 13 }}>
                gaps {quality?.gaps ?? 0} · duplicates {quality?.duplicates ?? 0}
              </div>
              <div className="hint">
                out-of-order {quality?.out_of_order ?? 0} · implausible {quality?.implausible ?? 0}
              </div>
            </div>
            <div className="metric">
              <div className="label">Policy</div>
              <div className="value">
                {readings.data.policy ? `${readings.data.policy.min_c} … ${readings.data.policy.max_c} °C` : "none"}
              </div>
              <div className="hint">{readings.data.policy?.id ?? "no policy — review required"}</div>
            </div>
          </div>
        ) : null}
        {sensorFailed ? (
          <div className="mt">
            <UnknownReviewBanner reason={`sensor ${sensor.status} (${sensor.minutes_since_last ?? "?"} min since last reading)`} />
          </div>
        ) : null}
      </Card>

      <Card title="Chart" subtitle="Dashed lines are policy bounds; shaded bands are backend-detected excursions.">
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

      <Card title="Excursions for this shipment" subtitle="Detected and classified by the backend.">
        {excursions.loading ? <LoadingSkeleton rows={3} /> : null}
        {excursions.error ? <ErrorState error={excursions.error} onRetry={excursions.refresh} /> : null}
        {excursions.data && excursions.data.count === 0 ? (
          <EmptyState title="No excursions detected" />
        ) : null}
        {excursions.data && excursions.data.count > 0 ? (
          <DataTable
            columns={[
              {
                key: "id",
                header: "Excursion",
                render: (row) => (
                  <Link className="link" to={`/excursions/${row.id}`}>
                    {row.id}
                  </Link>
                ),
              },
              { key: "severity", header: "Severity", render: (row) => <StatusBadge value={row.severity} /> },
              { key: "start_time", header: "Start", render: (row) => formatDateTime(row.start_time) },
              { key: "duration_min", header: "Duration (min)" },
              { key: "peak_deviation_c", header: "Peak deviation °C" },
              { key: "data_quality", header: "Data quality", render: (row) => <StatusBadge value={row.data_quality} /> },
              { key: "status", header: "Status", render: (row) => <StatusBadge value={row.status} /> },
            ]}
            rows={excursions.data.data}
            rowKey={(row) => row.id}
          />
        ) : null}
        {excursions.data?.data?.[0] ? (
          <div className="mt">
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
