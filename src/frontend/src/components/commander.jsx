import { Link } from "react-router-dom";
import { Card } from "./layout.jsx";
import { JsonViewer, ReasonList, ScoreBar } from "./display.jsx";
import { Banner } from "./states.jsx";

export const COMMAND_STATUS_LABEL = {
  VALIDATED_AI: "Validated AI explanation",
  DETERMINISTIC_FALLBACK: "Deterministic fallback",
  PROVIDER_UNAVAILABLE: "AI provider unavailable",
  INVALID_AI_OUTPUT: "AI output rejected (schema)",
  GROUNDING_FAILED: "AI output rejected (grounding)",
  FEATURE_DISABLED: "AI Incident Commander disabled",
  CLARIFICATION_REQUIRED: "Clarification required",
};

export const COMMAND_STATUS_TONE = {
  VALIDATED_AI: "info",
  DETERMINISTIC_FALLBACK: "warn",
  PROVIDER_UNAVAILABLE: "warn",
  INVALID_AI_OUTPUT: "review",
  GROUNDING_FAILED: "review",
  FEATURE_DISABLED: "info",
  CLARIFICATION_REQUIRED: "info",
};

export const COMMAND_FALLBACK_REASON_LABEL = {
  feature_disabled: "The AI Incident Commander feature flag is disabled on the backend.",
  provider_not_configured: "No AI provider endpoint is configured on the backend.",
  granite_runtime_pending: "Granite configuration is present; the watsonx runtime adapter is not implemented yet.",
  provider_timeout: "The AI provider timed out.",
  provider_unreachable: "The AI provider is unreachable.",
  provider_error: "The AI provider returned an error.",
  provider_invalid_response: "The AI provider returned a non-JSON response.",
  provider_empty_response: "The AI provider returned an empty answer.",
  prompt_too_large: "The evidence payload exceeded the configured prompt bound.",
  response_too_large: "The AI response exceeded the configured size bound.",
  empty_response: "The AI provider returned no usable text.",
  no_json_object: "The AI response did not contain a JSON object.",
  invalid_json: "The AI response was not valid JSON.",
  schema_invalid: "The AI response did not match the required schema.",
  invalid_ai_intent: "The AI intent was rejected and the deterministic parser was used instead.",
  operation_not_allowed: "The AI requested an operation outside the allowlist; it was rejected.",
  grounding_violations: "The AI response contradicted the deterministic evidence.",
};

const PROPOSAL_STATUS_LABEL = {
  pending: "PROPOSAL READY — human approval required",
  not_available: "No eligible recovery target was available",
  failed: "The recovery proposal could not be prepared",
  not_created: "No proposal was created",
};

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <p style={{ margin: "0 0 6px", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-3)" }}>
        {title}
      </p>
      {children}
    </div>
  );
}

export function ToolActivity({ activity }) {
  if (!activity || activity.length === 0) return null;
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {activity.map((entry, index) => (
        <li key={`${entry.operation}-${index}`} style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 6 }}>
          <span className={`badge ${entry.ok ? "ok" : "warn"}`} style={{ minWidth: 18, textAlign: "center" }}>
            {entry.ok ? "✓" : "✗"}
          </span>
          <span style={{ fontSize: 12.5, color: "var(--text-2)" }}>
            {entry.message}
            {entry.tool ? <span className="mono small" style={{ marginLeft: 6, color: "var(--text-3)" }}>{entry.tool}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Clarification({ clarification }) {
  return (
    <Card title="Clarification required" subtitle="ChainSentinel never guesses an incident or an action">
      <Banner tone="info" title="I need more information">
        {clarification.message}
      </Banner>
      {clarification.options?.length ? (
        <Section title="Recorded incidents">
          <ul className="reasons">
            {clarification.options.map((option) => (
              <li key={option.disruption_id}>
                <span className="mono">{option.disruption_id}</span> — {option.description}
                {option.region_code ? <span className="muted small"> · {option.region_code}</span> : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </Card>
  );
}

export function CommanderResult({ result }) {
  if (!result) return null;

  if (result.status === "FEATURE_DISABLED") {
    return (
      <Card title="AI Incident Commander" subtitle="Feature-flagged and currently disabled">
        <Banner tone="info" title="The feature is disabled on the backend">
          Set <span className="mono">FEATURE_AI_INCIDENT_COMMANDER=true</span> to enable the commander. No AI request or
          MCP orchestration was performed, and the deterministic dashboard remains fully available.
        </Banner>
      </Card>
    );
  }

  if (result.clarification) return <Clarification clarification={result.clarification} />;

  const evidence = result.evidence ?? {};
  const summary = evidence.incident_summary ?? {};
  const explanation = result.explanation;
  const proposal = result.proposal;
  const priority = evidence.priority_shipment;

  return (
    <>
      <Card
        title="Incident response"
        subtitle={`Command interpreted as ${result.intent?.intent ?? "—"} · ${result.intent_source === "ai" ? "AI intent" : "deterministic intent"}`}
      >
        <Banner tone={COMMAND_STATUS_TONE[result.status] ?? "info"} title={COMMAND_STATUS_LABEL[result.status] ?? result.status}>
          {result.fallback_reason ? (
            <span>{COMMAND_FALLBACK_REASON_LABEL[result.fallback_reason] ?? result.fallback_reason} </span>
          ) : null}
          <span>
            {result.status === "VALIDATED_AI"
              ? "This response was produced by the AI provider and passed deterministic grounding validation."
              : "This response was assembled deterministically from live tool results."}
          </span>
        </Banner>

        {result.partial ? (
          <Banner tone="warn" title="Partial results">
            Some information could not be retrieved: {result.missing_tools.join(", ")}. This response is not complete.
          </Banner>
        ) : null}

        <div className="stat-strip" style={{ "--strip-cols": 4, marginBottom: 4 }}>
          <div className="metric">
            <div className="label">Affected shipments</div>
            <div className="value">{summary.affected_count ?? 0}</div>
          </div>
          <div className="metric">
            <div className="label">Critical</div>
            <div className="value">{summary.critical_count ?? 0}</div>
          </div>
          <div className="metric">
            <div className="label">Cold-chain</div>
            <div className="value">{summary.cold_chain_count ?? 0}</div>
          </div>
          <div className="metric">
            <div className="label">Refrigerated assets available</div>
            <div className="value">{summary.refrigerated_assets_count ?? 0}</div>
          </div>
        </div>

        {priority?.combined_score != null ? (
          <p className="muted small" style={{ margin: "4px 0 14px" }}>
            Highest priority: <span className="mono">{priority.shipment_id}</span>{" "}
            <span className="mono">{priority.combined_score}</span> combined score · impact status {priority.impact_status}
          </p>
        ) : null}

        {explanation ? (
          <>
            <Section title="Summary">
              <p style={{ margin: 0, lineHeight: 1.7 }}>{explanation.summary}</p>
            </Section>
            <Section title="Why it matters">
              <p style={{ margin: 0, lineHeight: 1.7 }}>{explanation.whyItMatters}</p>
            </Section>
            <Section title="Evidence used">
              <ReasonList reasons={explanation.evidenceUsed} />
            </Section>
            <Section title="Recommended next step">
              <p style={{ margin: 0, lineHeight: 1.7 }}>{explanation.recommendedNextStep}</p>
              <p className="muted small" style={{ margin: "6px 0 0" }}>
                Suggestions only — approvals and execution remain human actions in the dashboard.
              </p>
            </Section>
            <Section title="Limitations">
              <ReasonList reasons={explanation.limitations} />
            </Section>
          </>
        ) : null}

        {result.grounding && !result.grounding.ok ? (
          <Section title="Grounding violations">
            <ReasonList reasons={result.grounding.violations} />
          </Section>
        ) : null}
      </Card>

      {proposal?.id ? (
        <Card
          title="Recovery proposal"
          subtitle="Created through the existing recommendation endpoint — nothing is executed automatically"
        >
          <Banner tone="review" title="Human approval required">
            Proposal <span className="mono">{proposal.id}</span> is <strong>pending</strong>. An authorized operator must
            decide in the dashboard before anything happens.
          </Banner>
          {priority?.shipment_id ? (
            <p style={{ margin: "8px 0 0" }}>
              <Link className="btn" to={`/shipments/${priority.shipment_id}?tab=recommendations`}>
                Review recommendation
              </Link>
            </p>
          ) : null}
        </Card>
      ) : result.proposal_status && result.proposal_status !== "not_created" ? (
        <Card title="Recovery proposal">
          <Banner tone="warn" title={PROPOSAL_STATUS_LABEL[result.proposal_status] ?? result.proposal_status}>
            No pending recommendation was created. Nothing was executed.
          </Banner>
        </Card>
      ) : null}

      <Card title="Investigation activity" subtitle="Read-only steps performed by the commander">
        <ToolActivity activity={result.tool_activity} />
      </Card>

      <Card title="Evidence" subtitle="Raw deterministic output — if the answer and this JSON disagree, trust the JSON">
        <details className="evidence" open>
          <summary>Command evidence (raw backend JSON)</summary>
          <div className="evidence-body">
            <JsonViewer value={evidence} maxHeight={320} />
          </div>
        </details>
        {priority?.shipment_id ? (
          <p className="muted small" style={{ margin: "8px 0 0" }}>
            Priority shipment risk source: ChainSentinel risk engine · <ScoreBar score={priority.combined_score ?? 0} />
          </p>
        ) : null}
      </Card>
    </>
  );
}
