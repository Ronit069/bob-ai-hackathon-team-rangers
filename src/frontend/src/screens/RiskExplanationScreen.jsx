import { Link, useParams } from "react-router-dom";
import { api } from "../api/endpoints.js";
import { useApi } from "../hooks/useApi.js";
import { Card, PageHeader, RefreshButton } from "../components/layout.jsx";
import { RiskFactorTable } from "../components/domain.jsx";
import { ScoreBar } from "../components/display.jsx";
import { IncidentBriefCard } from "../components/incidentBrief.jsx";
import { Banner, ErrorState, LoadingSkeleton } from "../components/states.jsx";
import { formatDateTime } from "../utils/format.js";

const monoSm = { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)" };

export function RiskExplanationScreen() {
  const { id } = useParams();
  const risk = useApi(() => api.shipmentRisk(id), [id]);

  return (
    <div>
      <PageHeader
        title={`Risk Explanation · ${id}`}
        subtitle="Factor-by-factor breakdown of the backend combined score (RC-3)"
        actions={
          <>
            <Link className="btn" to={`/shipments/${id}`}>Shipment</Link>
            <Link className="btn" to={`/shipments/${id}/temperature`}>Temperature</Link>
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

          <Card
            title="Scores"
            subtitle={
              <span>
                Computed at{" "}
                <span style={monoSm}>{formatDateTime(risk.data.computed_at)}</span>
              </span>
            }
          >
            <div className="stat-strip" style={{ "--strip-cols": 3 }}>
              <div className="metric-card accent-stripe">
                <div className="metric-label">Disruption risk</div>
                <div className="metric-value"><ScoreBar score={risk.data.disruption_risk} /></div>
              </div>
              <div className="metric-card warn-stripe">
                <div className="metric-label">Cold-chain risk</div>
                <div className="metric-value"><ScoreBar score={risk.data.coldchain_risk} /></div>
              </div>
              <div className="metric-card danger-stripe">
                <div className="metric-label">Combined score</div>
                <div className="metric-value"><ScoreBar score={risk.data.combined_score} /></div>
              </div>
            </div>
          </Card>

          <Card title="Factor Breakdown" subtitle="Disruption, cold-chain and weight inputs from the API">
            <RiskFactorTable factors={risk.data.factors} />
          </Card>
        </>
      ) : null}

      <IncidentBriefCard shipmentId={id} />
    </div>
  );
}
