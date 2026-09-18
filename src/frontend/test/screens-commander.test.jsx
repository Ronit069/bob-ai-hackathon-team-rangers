import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { mockFetch } from "./mockFetch.js";
import { renderAt } from "./renderAt.jsx";
import { CommanderScreen } from "../src/screens/CommanderScreen.jsx";

afterEach(() => {
  vi.restoreAllMocks();
});

const baseResult = (overrides = {}) => ({
  command: "Investigate the Mumbai port disruption and prioritize cold-chain shipments.",
  status: "VALIDATED_AI",
  intent: {
    intent: "INVESTIGATE_INCIDENT",
    priority: "COLD_CHAIN",
    incident_id: "D01",
    incident_text: null,
    shipment_id: null,
    requested_operations: ["GET_ACTIVE_DISRUPTIONS", "GET_AFFECTED_SHIPMENTS"],
  },
  intent_source: "ai",
  fallback_reason: null,
  provider_name: "stub",
  clarification: null,
  grounding: { ok: true, violations: [] },
  explanation: {
    summary: "I investigated incident D01: Dock workers strike at Mumbai port.",
    whyItMatters: "The deterministic system requires human review before acting on this incident.",
    evidenceUsed: ["affected_count=3", "coldchain_severity=major"],
    recommendedNextStep: "Review and consider intervention",
    limitations: ["This response is advisory: no operational action has been executed."],
  },
  evidence: {
    incident: { disruption_id: "D01", description: "Dock workers strike at Mumbai port; berth operations suspended." },
    incident_summary: {
      affected_count: 3,
      critical_count: 1,
      cold_chain_count: 1,
      available_assets_count: 3,
      refrigerated_assets_count: 3,
    },
    priority_shipment: { shipment_id: "S039", combined_score: 0.728, impact_status: "critical", is_cold_chain: true },
    affected_shipments: [],
    known_incidents: [],
    missing_tools: [],
  },
  tool_activity: [
    { operation: "GET_AFFECTED_SHIPMENTS", tool: "get_affected_shipments", ok: true, source: "mcp", message: "Affected shipments retrieved" },
    { operation: "GET_COMBINED_RISK", tool: "get_combined_risk", ok: true, source: "mcp", message: "Risk evaluated" },
    { operation: "GENERATE_EXPLANATION", tool: null, ok: true, source: "provider", message: "AI explanation generated" },
  ],
  proposal: null,
  proposal_status: null,
  partial: false,
  missing_tools: [],
  generated_at: "2026-09-14T09:00:00Z",
  ...overrides,
});

const submit = (text = "Investigate the Mumbai port disruption and prioritize cold-chain shipments.") => {
  fireEvent.change(screen.getByPlaceholderText(/Investigate the Mumbai/i), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Investigate" }));
};

describe("AI Incident Commander screen", () => {
  it("submits a command, shows the investigation state and renders the grounded response", async () => {
    mockFetch([{ match: "/api/ai/incident-command", payload: baseResult() }]);
    renderAt(<CommanderScreen />);

    submit();
    expect(screen.getByRole("button", { name: /investigating/i })).toBeDisabled();

    expect(await screen.findByText("Validated AI explanation")).toBeInTheDocument();
    expect(screen.getByText(/I investigated incident D01/i)).toBeInTheDocument();
    expect(screen.getByText("Affected shipments")).toBeInTheDocument();
    expect(screen.getByText("Risk evaluated")).toBeInTheDocument();
    expect(screen.getByText("AI explanation generated")).toBeInTheDocument();
    expect(screen.getByText(/no operational action has been executed/i)).toBeInTheDocument();
    expect(screen.getByText("Affected shipments retrieved")).toBeInTheDocument();
  });

  it("renders the deterministic fallback state without claiming AI authorship", async () => {
    mockFetch([
      {
        match: "/api/ai/incident-command",
        payload: baseResult({ status: "DETERMINISTIC_FALLBACK", intent_source: "deterministic", provider_name: "none", fallback_reason: "provider_not_configured" }),
      },
    ]);
    renderAt(<CommanderScreen />);
    submit();

    expect(await screen.findByText("Deterministic fallback")).toBeInTheDocument();
    expect(screen.getByText(/assembled deterministically from live tool results/i)).toBeInTheDocument();
    expect(screen.queryByText("Validated AI explanation")).not.toBeInTheDocument();
  });

  it("renders a proposal with pending human approval and a link to the decision surface", async () => {
    mockFetch([
      {
        match: "/api/ai/incident-command",
        payload: baseResult({
          status: "DETERMINISTIC_FALLBACK",
          fallback_reason: "provider_not_configured",
          proposal: { id: "REC-0001", type: "fleet_redeployment", target_id: "A017", status: "pending", approval_required: true },
          proposal_status: "pending",
        }),
      },
    ]);
    renderAt(<CommanderScreen />);
    submit("Prepare a recovery proposal for S039.");

    expect(await screen.findByText("Human approval required")).toBeInTheDocument();
    expect(screen.getByText("REC-0001")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /review recommendation/i });
    expect(link).toHaveAttribute("href", "/shipments/S039?tab=recommendations");
  });

  it("renders clarification requests with the recorded incidents", async () => {
    mockFetch([
      {
        match: "/api/ai/incident-command",
        payload: baseResult({
          status: "CLARIFICATION_REQUIRED",
          explanation: null,
          evidence: null,
          tool_activity: [],
          clarification: {
            reason: "incident_not_found",
            message: "I could not find an incident matching \"Atlantis port\".",
            options: [{ disruption_id: "D01", description: "Dock workers strike at Mumbai port.", region_code: "IN-WEST-COAST" }],
          },
        }),
      },
    ]);
    renderAt(<CommanderScreen />);
    submit("Investigate Atlantis port.");

    expect(await screen.findByText("Clarification required")).toBeInTheDocument();
    expect(screen.getByText(/could not find an incident matching/i)).toBeInTheDocument();
    expect(screen.getByText("D01")).toBeInTheDocument();
  });

  it("renders the feature-disabled state without investigation details", async () => {
    mockFetch([
      {
        match: "/api/ai/incident-command",
        payload: baseResult({
          status: "FEATURE_DISABLED",
          fallback_reason: "feature_disabled",
          intent: null,
          intent_source: null,
          explanation: null,
          evidence: null,
          tool_activity: [],
        }),
      },
    ]);
    renderAt(<CommanderScreen />);
    submit();

    expect(await screen.findByText("The feature is disabled on the backend")).toBeInTheDocument();
    expect(screen.getByText(/FEATURE_AI_INCIDENT_COMMANDER=true/)).toBeInTheDocument();
    expect(screen.queryByText("Incident response")).not.toBeInTheDocument();
  });

  it("flags partial results when tool calls fail", async () => {
    mockFetch([
      {
        match: "/api/ai/incident-command",
        payload: baseResult({
          partial: true,
          missing_tools: ["GET_COMBINED_RISK"],
          evidence: {
            ...baseResult().evidence,
            priority_shipment: { shipment_id: "S039", combined_score: null, impact_status: "critical" },
            missing_tools: ["GET_COMBINED_RISK"],
            partial: true,
          },
        }),
      },
    ]);
    renderAt(<CommanderScreen />);
    submit();

    expect(await screen.findByText("Partial results")).toBeInTheDocument();
    expect(screen.getAllByText(/GET_COMBINED_RISK/).length).toBeGreaterThan(0);
  });

  it("renders the standard API error envelope", async () => {
    mockFetch([
      {
        match: "/api/ai/incident-command",
        status: 500,
        payload: { error: { code: "INTERNAL_ERROR", message: "Unexpected server error", details: {} } },
      },
    ]);
    renderAt(<CommanderScreen />);
    submit();

    expect(await screen.findByText(/INTERNAL_ERROR/)).toBeInTheDocument();
    expect(screen.getByText(/Unexpected server error/)).toBeInTheDocument();
  });
});
