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
        title="Bob Assistant"
        subtitle="Grounded answers only — every claim traces to a live tool call with visible evidence"
      />

      {unavailable ? (
        <Banner tone="info" title="Bob is unavailable — the dashboard is fully functional">
          {error.details?.reason === "bob_disabled" ? "Bob is disabled (BOB_ENABLED=false)." : error.message} All
          capabilities remain available through the screens and through the MCP tool layer.
        </Banner>
      ) : null}

      {/* Input panel — glass treatment */}
      <div className="bob-glass" style={{ marginBottom: 16 }}>
        <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--glass-border)" }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-3)", marginBottom: 12 }}>
            BOB · Ask anything
          </div>
          <form onSubmit={submit}>
            {!unavailable && error?.isValidation?.() ? <FieldErrors error={error} /> : null}
            {!unavailable && error && !error.isValidation?.() ? <ErrorState error={error} /> : null}
            <div className="row" style={{ marginBottom: 12 }}>
              <input
                type="text"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder='e.g. "Which shipments are affected by the port strike?"'
                style={{ flex: 1, background: "rgba(255,255,255,0.85)", fontSize: 14, height: 38 }}
                disabled={unavailable}
              />
              <button
                type="submit"
                className="primary"
                disabled={busy || unavailable || prompt.trim() === ""}
                style={{ height: 38, fontSize: 13 }}
              >
                {busy ? "Asking…" : "Ask"}
              </button>
            </div>
          </form>
        </div>
        {/* Suggested questions */}
        <div style={{ padding: "10px 18px", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-3)", flexShrink: 0 }}>
            Suggested
          </span>
          {SUGGESTED.map((question) => (
            <button
              key={question}
              type="button"
              className="link"
              disabled={unavailable}
              onClick={() => setPrompt(question)}
              style={{ fontSize: 12, color: "var(--text-2)" }}
            >
              {question}
            </button>
          ))}
        </div>
      </div>

      {/* Answer */}
      {response ? (
        <Card
          title="Answer"
          subtitle={`${response.tool_calls} tool call(s) · grounded in live backend data`}
        >
          <p style={{
            whiteSpace: "pre-wrap",
            margin: 0,
            lineHeight: 1.75,
            fontSize: 13.5,
            color: "var(--text)",
            fontFamily: "var(--font-sans)",
          }}>
            {response.answer}
          </p>
        </Card>
      ) : null}

      {/* Evidence */}
      {response ? (
        <Card
          title="Evidence"
          subtitle="Raw tool output — if the answer and this JSON disagree, trust the JSON"
        >
          <EvidencePanel evidence={response.evidence} />
        </Card>
      ) : null}
    </div>
  );
}
