import { Link, useParams } from "react-router-dom";
import { api } from "../api/endpoints.js";
import { useApi } from "../hooks/useApi.js";
import { Card, PageHeader, RefreshButton } from "../components/layout.jsx";
import { FactorList, StatusBadge } from "../components/display.jsx";
import { ExcursionReviewActions } from "../components/domain.jsx";
import { EmptyState, ErrorState, LoadingSkeleton, UnknownReviewBanner } from "../components/states.jsx";
import { formatDateTime } from "../utils/format.js";

export function ExcursionDetailScreen() {
  const { id } = useParams();
  const excursion = useApi(async () => {
    const listed = await api.listExcursions({ limit: 500 });
    const found = listed.data.find((row) => row.id === id);
    if (!found) {
      const error = new Error(`Excursion ${id} was not found`);
      error.code = "NOT_FOUND";
      error.status = 404;
      throw error;
    }
    return found;
  }, [id]);

  if (excursion.loading) return <LoadingSkeleton rows={5} />;
  if (excursion.error) {
    return (
      <div>
        <PageHeader title={`Excursion ${id}`} subtitle="Not found in the current excursion list." />
        <ErrorState error={excursion.error} onRetry={excursion.refresh} />
      </div>
    );
  }

  const data = excursion.data;

  return (
    <div>
      <PageHeader
        title={`Excursion ${data.id}`}
        subtitle={`Shipment ${data.shipment_id} · ${formatDateTime(data.start_time)} → ${data.end_time ? formatDateTime(data.end_time) : "ongoing"}`}
        actions={
          <>
            <Link className="btn" to={`/shipments/${data.shipment_id}/temperature`}>Temperature history</Link>
            <RefreshButton onClick={excursion.refresh} loading={excursion.loading} />
          </>
        }
      />

      {data.severity === "unknown_review" ? <UnknownReviewBanner reason={data.severity_rationale} /> : null}

      <Card title="Classification" subtitle="Severity, rationale and recommended action are backend decisions">
        <div className="grid cols-4" style={{ marginBottom: 16 }}>
          <div className="metric">
            <div className="label">Severity</div>
            <div className="value" style={{ fontSize: 14, paddingTop: 4 }}><StatusBadge value={data.severity} /></div>
            <div className="hint">{data.severity_rationale}</div>
          </div>
          <div className="metric">
            <div className="label">Duration</div>
            <div className="value">{data.duration_min} <span style={{ fontSize: 14, fontWeight: 500 }}>min</span></div>
            <div className="hint">peak deviation <strong style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{data.peak_deviation_c}°C</strong></div>
          </div>
          <div className="metric">
            <div className="label">Data quality</div>
            <div className="value" style={{ fontSize: 14, paddingTop: 4 }}><StatusBadge value={data.data_quality} /></div>
            <div className="hint">policy {data.policy_id ?? "none"}</div>
          </div>
          <div className="metric">
            <div className="label">Time to delivery</div>
            <div className="value">{data.time_to_delivery_hours ?? "—"} <span style={{ fontSize: 14, fontWeight: 500 }}>h</span></div>
            <div className="hint">post-delivery: {data.post_delivery ? "yes" : "no"}</div>
          </div>
        </div>
        <FactorList
          factors={{
            recommended_action: data.recommended_action,
            status: data.status,
            detected_at: data.detected_at,
          }}
        />
      </Card>

      <Card title="Human Review" subtitle="Transitions are validated and audited by the backend">
        <ExcursionReviewActions excursion={data} onUpdated={() => excursion.refresh()} />
      </Card>
    </div>
  );
}
