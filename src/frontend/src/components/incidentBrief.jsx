import { api } from "../api/endpoints.js";
import { useApi } from "../hooks/useApi.js";
import { Card } from "./layout.jsx";
import { JsonViewer, ReasonList } from "./display.jsx";
import { Banner, ErrorState, LoadingSkeleton } from "./states.jsx";

const STATUS_LABEL = {
  VALIDATED_AI: "Validated AI explanation",
  DETERMINISTIC_FALLBACK: "Deterministic fallback",
  PROVIDER_UNAVAILABLE: "AI provider unavailable",
  INVALID_AI_OUTPUT: "AI output rejected (schema)",
  GROUNDING_FAILED: "AI output rejected (grounding)",
};

const STATUS_TONE = {
  VALIDATED_AI: "info",
  DETERMINISTIC_FALLBACK: "warn",
  PROVIDER_UNAVAILABLE: "warn",
  INVALID_AI_OUTPUT: "review",
  GROUNDING_FAILED: "review",
};

const FALLBACK_REASON_LABEL = {
  feature_disabled: "The AI incident brief feature flag is disabled on the backend.",
  provider_not_configured: "No AI provider endpoint is configured on the backend.",
  provider_timeout: "The AI provider timed out.",
  provider_unreachable: "The AI provider is unreachable.",
  provider_error: "The AI provider returned an error.",
  provider_invalid_response: "The AI provider returned a non-JSON response.",
  provider_empty_response: "The AI provider returned an empty answer.",
  prompt_too_large: "The evidence payload exceeded the configured prompt bound.",
  empty_response: "The AI provider returned no usable text.",
  response_too_large: "The AI response exceeded the configured size bound.",
  no_json_object: "The AI response did not contain a JSON object.",
  invalid_json: "The AI response was not valid JSON.",
  schema_invalid: "The AI response did not match the brief schema.",
  grounding_violations: "The AI response contradicted the deterministic evidence.",
};

function BriefSection({ title, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)" }}>
        {title}
      </p>
      {children}
    </div>
  );
}

export function IncidentBriefCard({ shipmentId }) {
  const brief = useApi(() => api.incidentBrief({ shipment_id: shipmentId }), [shipmentId]);
  const data = brief.data;
  const aiGenerated = data?.brief_source === "ai";
  const grounding = data?.grounding;

  return (
    <Card
      title="AI Incident Brief"
      subtitle="Grounded in the deterministic evidence below — the AI never replaces backend risk values"
      actions={
        <button type="button" onClick={brief.refresh} disabled={brief.loading}>
          {brief.loading ? "Generating…" : "Regenerate"}
        </button>
      }
    >
      {brief.loading ? <LoadingSkeleton rows={3} /> : null}
      {brief.error ? <ErrorState error={brief.error} onRetry={brief.refresh} /> : null}

      {data ? (
        <>
          <Banner
            tone={STATUS_TONE[data.status] ?? "info"}
            title={STATUS_LABEL[data.status] ?? data.status}
          >
            {data.fallback_reason ? (
              <span>{FALLBACK_REASON_LABEL[data.fallback_reason] ?? data.fallback_reason} </span>
            ) : null}
            <span>
              {aiGenerated
                ? "This text was produced by the AI provider and passed deterministic grounding validation."
                : "The deterministic fallback is shown below; it is not AI-generated."}
            </span>
          </Banner>

          {grounding && !grounding.ok ? (
            <BriefSection title="Grounding violations">
              <ReasonList reasons={grounding.violations} />
            </BriefSection>
          ) : null}

          <BriefSection title="Summary">
            <p style={{ margin: 0, lineHeight: 1.7 }}>{data.brief.summary}</p>
          </BriefSection>

          <BriefSection title="Why it matters">
            <p style={{ margin: 0, lineHeight: 1.7 }}>{data.brief.whyItMatters}</p>
          </BriefSection>

          <BriefSection title="Evidence used">
            <ReasonList reasons={data.brief.evidenceUsed} />
          </BriefSection>

          <BriefSection title="Recommended next step">
            <p style={{ margin: 0, lineHeight: 1.7 }}>{data.brief.recommendedNextStep}</p>
            <p className="muted small" style={{ margin: "6px 0 0" }}>
              Suggestions only — approvals and execution remain human actions in the dashboard.
            </p>
          </BriefSection>

          <BriefSection title="Limitations">
            <ReasonList reasons={data.brief.limitations} />
          </BriefSection>

          <details className="evidence">
            <summary>Deterministic evidence (raw backend JSON)</summary>
            <div className="evidence-body">
              <JsonViewer value={data.evidence} maxHeight={260} />
            </div>
          </details>
        </>
      ) : null}
    </Card>
  );
}
