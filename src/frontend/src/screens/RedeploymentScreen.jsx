import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/endpoints.js";
import { useApi } from "../hooks/useApi.js";
import { Card, PageHeader, RefreshButton } from "../components/layout.jsx";
import { DecisionButtons, RedeploymentCard } from "../components/domain.jsx";
import { DataTable } from "../components/display.jsx";
import { EmptyState, ErrorState, LoadingSkeleton, NotActionableBanner, Toast } from "../components/states.jsx";
import { formatDateTime } from "../utils/format.js";

export function RedeploymentScreen() {
  const { id } = useParams();
  const [created, setCreated] = useState(null);
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);

  const shipment = useApi(() => api.getShipment(id), [id]);
  const candidates = useApi(() => api.redeploymentCandidates(id, { limit: 10 }), [id]);

  const create = async (candidate) => {
    setBusy(true);
    try {
      const recommendation = await api.recommendRedeployment({ shipment_id: id, asset_id: candidate.asset.id });
      setCreated(recommendation);
      setToast({ message: `${recommendation.id} created (pending human approval).`, tone: "ok" });
    } catch (error) {
      setToast({
        message: error.isConflict?.() ? `${error.message} — refreshing candidates.` : error.message,
        tone: error.isConflict?.() ? "warn" : "danger",
      });
      candidates.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={`Redeployment · ${id}`}
        subtitle="Compatible idle assets ranked by the backend. Nothing is assigned automatically."
        actions={
          <>
            <Link className="btn" to={`/shipments/${id}`}>Shipment detail</Link>
            <RefreshButton onClick={candidates.refresh} loading={candidates.loading} />
          </>
        }
      />

      {shipment.data?.status === "delivered" ? <NotActionableBanner reason="delivered" /> : null}

      <Card title="Ranked Candidates" subtitle="Capacity, refrigeration and distance filters already applied by the API">
        {candidates.loading ? <LoadingSkeleton rows={5} /> : null}
        {candidates.error ? <ErrorState error={candidates.error} onRetry={candidates.refresh} /> : null}
        {candidates.data && candidates.data.count === 0 ? (
          <EmptyState title="No compatible idle assets" message="Check the rejection and exclusion reasons below." />
        ) : null}
        {candidates.data && candidates.data.count > 0 ? (
          <div>
            {candidates.data.data.map((candidate) => (
              <RedeploymentCard key={candidate.asset.id} candidate={candidate} onSelect={create} busy={busy || Boolean(created)} />
            ))}
          </div>
        ) : null}
      </Card>

      {created ? (
        <Card title={`Decision · ${created.id}`} subtitle="Human approval is recorded in the audit trail — nothing is auto-executed.">
          <DecisionButtons recommendation={created} onDecided={(updated) => setCreated(updated)} />
        </Card>
      ) : null}

      {candidates.data?.rejected?.length > 0 ? (
        <Card title="Rejected Candidates" subtitle="Hard-constraint failures — backend rejection reasons">
          <DataTable
            columns={[
              { key: "asset_id", header: "Asset", render: (row) => <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600 }}>{row.asset_id}</span> },
              { key: "rejected_reason", header: "Reason", render: (row) => <span className="badge warn" style={{ textTransform: "none" }}>{String(row.rejected_reason).replace(/_/g, " ")}</span> },
              { key: "details", header: "Details", render: (row) => <span className="small muted">{row.details ? JSON.stringify(row.details) : "—"}</span> },
            ]}
            rows={candidates.data.rejected}
            rowKey={(row, index) => `${row.asset_id}-${index}`}
          />
        </Card>
      ) : null}

      {candidates.data?.excluded?.length > 0 ? (
        <Card title="Excluded Assets" subtitle="Not idle — reserved, assigned, maintenance, retired or missing timestamps">
          <DataTable
            columns={[
              { key: "asset_id", header: "Asset", render: (row) => <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 600 }}>{row.asset_id}</span> },
              { key: "reason", header: "Reason", render: (row) => <span className="badge review" style={{ textTransform: "none" }}>{String(row.reason).replace(/_/g, " ")}</span> },
              { key: "until", header: "Until", render: (row) => (row.until ? <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-2)" }}>{formatDateTime(row.until)}</span> : <span className="muted">—</span>) },
            ]}
            rows={candidates.data.excluded}
            rowKey={(row, index) => `${row.asset_id}-${index}`}
          />
        </Card>
      ) : null}

      <Toast message={toast?.message} tone={toast?.tone} onDismiss={() => setToast(null)} />
    </div>
  );
}
