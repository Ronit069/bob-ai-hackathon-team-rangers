import { Link, useParams } from "react-router-dom";
import { api } from "../api/endpoints.js";
import { useApi } from "../hooks/useApi.js";
import { Card, PageHeader, RefreshButton } from "../components/layout.jsx";
import { RiskFactorTable } from "../components/domain.jsx";
import { MetricCard, ScoreBar } from "../components/display.jsx";
import { Banner, ErrorState, LoadingSkeleton } from "../components/states.jsx";
import { formatDateTime } from "../utils/format.js";

export function RiskExplanationScreen() {
  const { id } = useParams();
  const risk = useApi(() => api.shipmentRisk(id), [id]);

  return (
    <div>
      <PageHeader
        title={`Risk explanation · ${id}`}
        subtitle="Factor-by-factor breakdown of the backend combined score (RC-3)."
        actions={
          <>
            <Link className="btn" to={`/shipments/${id}`}>
              Shipment detail
            </Link>
            <Link className="btn" to={`/shipments/${id}/temperature`}>
              Temperature history
            </Link>
            <RefreshButton onClick={risk.refresh} loading={risk.loading} />
          </>
        }
      />

      {risk.loading ? <LoadingSkeleton rows={5} /> : null}
      {risk.error ? <ErrorState error={risk.error} onRetry={risk.refresh} /> : null}

      {risk.data ? (
        <>
          {risk.data.factors?.coldchain?.human_review_required ? (
            <Banner tone="review" title="Human review required">
              {String(risk.data.factors.coldchain.recommended_action ?? "Review the cold-chain factors before acting.")}
            </Banner>
          ) : null}

          <Card title="Scores" subtitle={`Computed at ${formatDateTime(risk.data.computed_at)} by the shared risk engine.`}>
            <div className="grid cols-3">
              <MetricCard label="Disruption risk" value={<ScoreBar score={risk.data.disruption_risk} />} />
              <MetricCard label="Cold-chain risk" value={<ScoreBar score={risk.data.coldchain_risk} />} />
              <MetricCard label="Combined score" value={<ScoreBar score={risk.data.combined_score} />} />
            </div>
          </Card>

          <Card title="Factors" subtitle="Disruption, cold-chain and weight inputs exactly as returned by the API.">
            <RiskFactorTable factors={risk.data.factors} />
          </Card>
        </>
      ) : null}
    </div>
  );
}
