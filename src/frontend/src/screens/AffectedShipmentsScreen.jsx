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
    { key: "id", header: "Shipment", render: (row) => <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600 }}>{row.shipment.id}</span> },
    { key: "cargo_type", header: "Cargo", render: (row) => <span style={{ fontSize: 12 }}>{row.shipment.cargo_type.replace(/_/g, " ")}</span> },
    {
      key: "cold",
      header: "Cold chain",
      render: (row) => (row.shipment.is_cold_chain ? <span className="badge info no-dot">❄ cold chain</span> : <span className="muted small">—</span>),
    },
    {
      key: "impact_status",
      header: "Impact",
      render: (row) => (
        <div className="row" style={{ gap: 5 }}>
          <StatusBadge value={row.impact_status} />
          {row.impact_status === "unknown_review" ? <span className="badge review">review</span> : null}
          {row.timing_basis === "unknown" ? <span className="badge neutral no-dot">timing?</span> : null}
        </div>
      ),
    },
    { key: "impact_score", header: "Impact score", render: (row) => <ScoreBar score={row.impact_score} /> },
    { key: "deadline", header: "Deadline", render: (row) => <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-2)" }}>{formatDateTime(row.shipment.deadline)}</span> },
    { key: "confidence", header: "Confidence", render: (row) => <span className="badge neutral no-dot">{row.confidence}</span> },
    { key: "reason", header: "Match reason", render: (row) => <span className="chip">{row.match_reason}</span> },
  ];

  return (
    <div>
      <PageHeader
        title={`Affected Shipments · ${id}`}
        subtitle={
          disruptionRow
            ? `${disruptionRow.type.replace(/_/g, " ")} in ${disruptionRow.region_code} · severity ${disruptionRow.severity}`
            : "Ranked blast radius with match reasons"
        }
        actions={<RefreshButton onClick={affected.refresh} loading={affected.loading} />}
      />

      <Card title="Ranked Impact List" subtitle="Sorted by backend impact score · delivered/cancelled excluded">
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
