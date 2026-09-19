import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { mockFetch } from "./mockFetch.js";
import { renderAt } from "./renderAt.jsx";
import { BobChatScreen } from "../src/screens/BobChatScreen.jsx";

afterEach(() => {
  vi.restoreAllMocks();
});

const submit = () => {
  fireEvent.change(screen.getByPlaceholderText(/which shipments are affected/i), {
    target: { value: "Which disruptions are active?" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Ask" }));
};

describe("Bob chat LLM status", () => {
  it("labels a grounded LLM answer and shows the evidence", async () => {
    mockFetch([
      {
        match: "/api/bob/query",
        payload: {
          answer: "The active disruption list includes D01.",
          evidence: [{ tool: "get_active_disruptions", input: {}, output: { data: [{ id: "D01" }], count: 1 } }],
          tool_calls: 1,
          status: "VALIDATED_AI",
          source: "llm",
          provider_name: "granite_watsonx",
          grounding: { ok: true, violations: [] },
        },
      },
    ]);
    renderAt(<BobChatScreen />);
    submit();

    expect(await screen.findByText("AI-generated answer (grounded)")).toBeInTheDocument();
    expect(screen.getByText(/grounded in the live tool evidence/i)).toBeInTheDocument();
    expect(screen.getByText("The active disruption list includes D01.")).toBeInTheDocument();
  });

  it("labels the deterministic fallback when the AI answer fails grounding", async () => {
    mockFetch([
      {
        match: "/api/bob/query",
        payload: {
          answer: "No active disruptions found. No data returned.",
          evidence: [],
          tool_calls: 0,
          status: "GROUNDING_FAILED",
          source: "deterministic",
          provider_name: "granite_watsonx",
          grounding: { ok: false, violations: ["unknown_id:S999"] },
        },
      },
    ]);
    renderAt(<BobChatScreen />);
    submit();

    expect(await screen.findByText("AI answer rejected (grounding)")).toBeInTheDocument();
    expect(screen.getByText(/deterministic grounded engine answered instead/i)).toBeInTheDocument();
  });

  it("does not show an AI badge for the unchanged deterministic contract", async () => {
    mockFetch([{ match: "/api/bob/query", payload: { answer: "Deterministic answer.", evidence: [], tool_calls: 0 } }]);
    renderAt(<BobChatScreen />);
    submit();

    expect(await screen.findByText("Deterministic answer.")).toBeInTheDocument();
    expect(screen.queryByText(/AI-generated answer/i)).not.toBeInTheDocument();
  });
});
