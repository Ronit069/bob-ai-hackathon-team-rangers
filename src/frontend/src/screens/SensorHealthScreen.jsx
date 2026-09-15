import { Link } from "react-router-dom";
import { api } from "../api/endpoints.js";
import { useApi } from "../hooks/useApi.js";
import { Card, PageHeader, RefreshButton } from "../components/layout.jsx";
import { DataTable, StatusBadge } from "../components/display.jsx";
import { EmptyState, ErrorState, LoadingSkeleton, UnknownReviewBanner } from "../components/states.jsx";
import { formatDateTime } from "../utils/format.js";

export function SensorHealthScreen() {
  const sensors = useApi(async () => {
    const shipments = await api.listShipments({ is_cold_chain: true, limit: 100 });
    return Promise.all(
      shipments.data.map(async (shipment) => {
        const readings = await api.sensorReadings(shipment.id, { order: "desc" });
        return {
          shipment,
          sensor: readings.sensor,
          quality: readings.quality,
          policy: readings.policy,
          readingCount: readings.count,
        };
      }),
    );
  }, []);

  const failed = (sensors.data ?? []).filter(
    (row) => row.sensor?.status === "failed" || row.sensor?.status === "unknown",
  );

  return (
    <div>
      <PageHeader
        title="Sensor health"
        subtitle="Per-shipment device status from the backend sensor block (B-2)."
        actions={<RefreshButton onClick={sensors.refresh} loading={sensors.loading} />}
      />

      {failed.length > 0 ? (
        <UnknownReviewBanner reason={`${failed.length} sensor(s) not reporting`} />
      ) : null}

      <Card title="Sensors" subtitle="Status thresholds (delayed/failed) are computed by the backend.">
        {sensors.loading ? <LoadingSkeleton rows={6} /> : null}
        {sensors.error ? <ErrorState error={sensors.error} onRetry={sensors.refresh} /> : null}
        {sensors.data && sensors.data.length === 0 ? <EmptyState title="No sensors reporting" /> : null}
        {sensors.data && sensors.data.length > 0 ? (
          <DataTable
            columns={[
              { key: "shipment", header: "Shipment", render: (row) => <Link className="link" to={`/shipments/${row.shipment.id}/temperature`}>{row.shipment.id}</Link> },
              { key: "sensor_id", header: "Sensor", render: (row) => row.sensor?.sensor_id ?? "—" },
              { key: "status", header: "Status", render: (row) => <StatusBadge value={row.sensor?.status} /> },
              { key: "last", header: "Last reading", render: (row) => formatDateTime(row.sensor?.last_reading_at) },
              { key: "since", header: "Min since last", render: (row) => row.sensor?.minutes_since_last ?? "—" },
              { key: "gaps", header: "Gaps", render: (row) => row.sensor?.gap_count ?? 0 },
              { key: "readings", header: "Readings", render: (row) => row.readingCount },
              {
                key: "policy",
                header: "Policy",
                render: (row) => (row.policy ? `${row.policy.min_c}…${row.policy.max_c} °C` : <span className="badge review">missing</span>),
              },
            ]}
            rows={sensors.data}
            rowKey={(row) => row.shipment.id}
          />
        ) : null}
      </Card>
    </div>
  );
}
