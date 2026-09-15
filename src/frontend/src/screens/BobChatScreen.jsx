import { useState } from "react";
import { api } from "../api/endpoints.js";
import { Card, PageHeader } from "../components/layout.jsx";
import { EvidencePanel } from "../components/display.jsx";
import { Banner, ErrorState, FieldErrors } from "../components/states.jsx";

const SUGGESTED = [
  "Which shipments are affected by the Mumbai port strike?",
  "Which cold-chain shipments have active excursions?",
  "Why is shipment S039 marked critical?",
  "Which idle trucks can be redeployed?",
  "Give me a consolidated six-hour action plan",
  "Are any sensor readings missing?",
];

export function BobChatScreen() {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [response, setResponse] = useState(null);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResponse(null);
    try {
      const result = await api.bobQuery({ prompt });
      setResponse(result);
    } catch (apiError) {
      setError(apiError);
    } finally {
      setBusy(false);
    }
  };

  const unavailable = error?.isBobUnavailable?.() ?? false;

  return (
    <div>
      <PageHeader
        title="Bob assistant"
        subtitle="Grounded answers only — every claim must come from a tool call with visible evidence."
      />

      {unavailable ? (
        <Banner tone="info" title="Bob is unavailable — the dashboard is fully functional">
          {error.details?.reason === "bob_disabled" ? "Bob is disabled (BOB_ENABLED=false)." : error.message} All six
          capabilities remain available through the screens and through the MCP tool layer (stdio, read-only).
        </Banner>
      ) : null}

      <Card
        title="Ask a question"
        subtitle="Bob never computes scores and never invents data; empty tool results must be reported as 'no data'."
      >
        <form onSubmit={submit}>
          {!unavailable && error?.isValidation?.() ? <FieldErrors error={error} /> : null}
          {!unavailable && error && !error.isValidation?.() ? <ErrorState error={error} /> : null}
          <div className="row">
            <input
              type="text"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder='e.g. "Which shipments are affected by the port strike?"'
              style={{ flex: 1, minWidth: 320 }}
              disabled={unavailable}
            />
            <button type="submit" className="primary" disabled={busy || unavailable || prompt.trim() === ""}>
              {busy ? "Asking Bob…" : "Ask"}
            </button>
          </div>
          <div className="row mt small muted">
            <span>Suggested:</span>
            {SUGGESTED.map((question) => (
              <button key={question} type="button" className="link" disabled={unavailable} onClick={() => setPrompt(question)}>
                {question}
              </button>
            ))}
          </div>
        </form>
      </Card>

      {response ? (
        <>
          <Card title="Answer" subtitle={`${response.tool_calls} tool call(s) · grounded in backend JSON`}>
            <p style={{ whiteSpace: "pre-wrap" }}>{response.answer}</p>
          </Card>
          <Card title="Evidence (raw tool output)" subtitle="If the answer and this JSON disagree, trust the JSON.">
            <EvidencePanel evidence={response.evidence} />
          </Card>
        </>
      ) : null}
    </div>
  );
}
