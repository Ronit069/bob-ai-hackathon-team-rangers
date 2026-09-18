import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { mockFetch } from "./mockFetch.js";
import { renderAt } from "./renderAt.jsx";
import { risk } from "./fixtures.js";
import { IncidentBriefCard } from "../src/components/incidentBrief.jsx";
import { RiskExplanationScreen } from "../src/screens/RiskExplanationScreen.jsx";

afterEach(() => {
  vi.restoreAllMocks();
});

const baseBrief = (overrides = {}) => ({
  shipment_id: "S039",
  status: "VALIDATED_AI",
  brief_source: "ai",
  fallback_reason: null,
  provider_name: "stub",
  grounding: { ok: true, violations: [] },
  brief: {
    summary: "Shipment S039 has a combined risk score of 0.728 with impact status critical.",
    whyItMatters: "Cold-chain severity is major and the recommended action is Review and consider intervention.",
    evidenceUsed: ["combined_score=0.728", "impact_status=critical"],
    recommendedNextStep: "Review and consider intervention",
    limitations: ["Grounded in stored evidence."],
  },
  evidence: { incident_id: "S039", risk: { combined_score: 0.728 } },
  generated_at: "2026-09-14T09:00:00Z",
  ...overrides,
});

const renderCard = () => renderAt(<IncidentBriefCard shipmentId="S039" />);

describe("AI incident brief card", () => {
  it("renders the loading state while the brief is generated", async () => {
    mockFetch([{ match: "/api/ai/incident-brief", payload: baseBrief() }]);
    renderCard();
    expect(screen.getByLabelText("Loading")).toBeInTheDocument();
    expect(await screen.findByText(/validated ai explanation/i)).toBeInTheDocument();
  });

  it("renders a validated AI explanation with evidence, next step and limitations", async () => {
    mockFetch([{ match: "/api/ai/incident-brief", payload: baseBrief() }]);
    renderCard();

    expect(await screen.findByText("Validated AI explanation")).toBeInTheDocument();
    expect(screen.getByText(/combined risk score of 0.728/i)).toBeInTheDocument();
    expect(screen.getByText(/passed deterministic grounding validation/i)).toBeInTheDocument();
    expect(screen.getByText("Evidence used")).toBeInTheDocument();
    expect(screen.getByText("combined_score=0.728")).toBeInTheDocument();
    expect(screen.getByText("Recommended next step")).toBeInTheDocument();
    expect(screen.getByText("Review and consider intervention")).toBeInTheDocument();
    expect(screen.getByText("Limitations")).toBeInTheDocument();
    expect(screen.getByText("Deterministic evidence (raw backend JSON)")).toBeInTheDocument();
  });

  it("clearly labels the deterministic fallback and never claims it is AI", async () => {
    mockFetch([
      {
        match: "/api/ai/incident-brief",
        payload: baseBrief({
          status: "DETERMINISTIC_FALLBACK",
          brief_source: "deterministic",
          fallback_reason: "feature_disabled",
          provider_name: null,
          grounding: null,
        }),
      },
    ]);
    renderCard();

    expect(await screen.findByText("Deterministic fallback")).toBeInTheDocument();
    expect(screen.getByText(/feature flag is disabled/i)).toBeInTheDocument();
    expect(screen.getByText(/not AI-generated/i)).toBeInTheDocument();
    expect(screen.queryByText("Validated AI explanation")).not.toBeInTheDocument();
  });

  it("renders the provider-unavailable state with the fallback brief", async () => {
    mockFetch([
      {
        match: "/api/ai/incident-brief",
        payload: baseBrief({
          status: "PROVIDER_UNAVAILABLE",
          brief_source: "deterministic",
          fallback_reason: "provider_unreachable",
          provider_name: "bob_http",
          grounding: null,
        }),
      },
    ]);
    renderCard();

    expect(await screen.findByText("AI provider unavailable")).toBeInTheDocument();
    expect(screen.getByText(/provider is unreachable/i)).toBeInTheDocument();
    expect(screen.getByText(/not AI-generated/i)).toBeInTheDocument();
  });

  it("renders the invalid-AI-output state", async () => {
    mockFetch([
      {
        match: "/api/ai/incident-brief",
        payload: baseBrief({
          status: "INVALID_AI_OUTPUT",
          brief_source: "deterministic",
          fallback_reason: "schema_invalid",
          grounding: null,
        }),
      },
    ]);
    renderCard();

    expect(await screen.findByText("AI output rejected (schema)")).toBeInTheDocument();
    expect(screen.getByText(/did not match the brief schema/i)).toBeInTheDocument();
  });

  it("renders the grounding-failure state with bounded violations", async () => {
    mockFetch([
      {
        match: "/api/ai/incident-brief",
        payload: baseBrief({
          status: "GROUNDING_FAILED",
          brief_source: "deterministic",
          fallback_reason: "grounding_violations",
          grounding: { ok: false, violations: ["unsupported_number:0.9"] },
        }),
      },
    ]);
    renderCard();

    expect(await screen.findByText("AI output rejected (grounding)")).toBeInTheDocument();
    expect(screen.getByText("Grounding violations")).toBeInTheDocument();
    expect(screen.getByText("unsupported_number:0.9")).toBeInTheDocument();
    expect(screen.getByText(/contradicted the deterministic evidence/i)).toBeInTheDocument();
  });

  it("renders the API error state with the standard error envelope", async () => {
    mockFetch([
      {
        match: "/api/ai/incident-brief",
        status: 500,
        payload: { error: { code: "INTERNAL_ERROR", message: "Unexpected server error", details: {} } },
      },
    ]);
    renderCard();

    expect(await screen.findByText(/INTERNAL_ERROR/)).toBeInTheDocument();
    expect(screen.getByText(/Unexpected server error/)).toBeInTheDocument();
  });
});

describe("Risk explanation screen integration", () => {
  it("shows the incident brief card next to the deterministic factor breakdown", async () => {
    mockFetch([
      { match: "/api/shipments/S039/risk", payload: risk },
      { match: "/api/ai/incident-brief", payload: baseBrief() },
    ]);
    renderAt(<RiskExplanationScreen />, { route: "/shipments/S039/risk", path: "/shipments/:id/risk" });

    expect(await screen.findByText("Factor Breakdown")).toBeInTheDocument();
    expect(await screen.findByText("AI Incident Brief")).toBeInTheDocument();
    expect(await screen.findByText(/combined risk score of 0.728/i)).toBeInTheDocument();
  });
});
