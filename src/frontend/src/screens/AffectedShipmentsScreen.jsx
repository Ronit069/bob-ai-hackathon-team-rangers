import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api/endpoints.js";
import { useApi } from "../hooks/useApi.js";
import { Card, PageHeader, RefreshButton } from "../components/layout.jsx";
import { DataTable, ScoreBar, StatusBadge } from "../components/display.jsx";
import { EmptyState, ErrorState, LoadingSkeleton } from "../components/states.jsx";
import { formatDateTime } from "../utils/format.js";

export function AffectedShipmentsScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const affected = useApi(() => api.affectedShipments(id, { include_delivered: false }), [id]);

  const disruption = useApi(() => api.listDisruptions({ limit: 100 }), []);
  const disruptionRow = disruption.data?.data?.find((row) => row.id === id) ?? null;

  const columns = [
    { key: "id", header: "Shipment", render: (row) => row.shipment.id },
    { key: "cargo_type", header: "Cargo", render: (row) => row.shipment.cargo_type.replace(/_/g, " ") },
    {
      key: "cold",
      header: "Cold chain",
      render: (row) => (row.shipment.is_cold_chain ? <StatusBadge value="active" kind="cold-chain" /> : <span className="muted">no</span>),
    },
    {
      key: "impact_status",
      header: "Impact",
      render: (row) => (
        <div className="row">
          <StatusBadge value={row.impact_status} />
          {row.impact_status === "unknown_review" ? <span className="small muted">review required</span> : null}
          {row.timing_basis === "unknown" ? <span className="small muted">timing unknown</span> : null}
        </div>
      ),
    },
    { key: "impact_score", header: "Impact score", render: (row) => <ScoreBar score={row.impact_score} /> },
    { key: "deadline", header: "Deadline", render: (row) => formatDateTime(row.shipment.deadline) },
    { key: "confidence", header: "Confidence", render: (row) => row.confidence },
    { key: "reason", header: "Match reason", render: (row) => <span className="small">{row.match_reason}</span> },
  ];

  return (
    <div>
      <PageHeader
        title={`Affected shipments · ${id}`}
        subtitle={
          disruptionRow
            ? `${disruptionRow.type.replace(/_/g, " ")} in ${disruptionRow.region_code} · severity ${disruptionRow.severity}`
            : "Ranked blast radius with match reasons (R1)."
        }
        actions={<RefreshButton onClick={affected.refresh} loading={affected.loading} />}
      />

      <Card title="Ranked impact list" subtitle="Sorted by the backend impact score; delivered/cancelled shipments excluded.">
        {affected.loading ? <LoadingSkeleton rows={6} /> : null}
        {affected.error ? <ErrorState error={affected.error} onRetry={affected.refresh} /> : null}
        {affected.data && affected.data.count === 0 ? (
          <EmptyState
            title="No shipments affected by this disruption"
            message="A valid outcome — the disruption does not overlap any active shipment route window."
          />
        ) : null}
        {affected.data && affected.data.count > 0 ? (
          <DataTable
            columns={columns}
            rows={affected.data.data}
            rowKey={(row) => row.shipment.id}
            onRowClick={(row) => navigate(`/shipments/${row.shipment.id}`)}
          />
        ) : null}
      </Card>
    </div>
  );
}
