import { useEffect, useState } from "react";
import { api } from "../api/endpoints.js";
import { Card, PageHeader } from "../components/layout.jsx";
import { CommanderResult } from "../components/commander.jsx";
import { ErrorState, FieldErrors } from "../components/states.jsx";

const SUGGESTED = [
  "Investigate the Mumbai port disruption and prioritize cold-chain shipments",
  "Find the highest-risk cold-chain shipment affected by Mumbai port",
  "Which affected shipment has the highest risk?",
  "What refrigerated assets are available?",
  "What recovery options does the system recommend?",
  "Prepare a recovery proposal for S039",
];

const STAGES = [
  "Understanding request…",
  "Investigating incident…",
  "Analyzing evidence…",
  "Preparing response…",
];

export function CommanderScreen() {
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(0);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!busy) {
      setStage(0);
      return undefined;
    }
    const timer = setInterval(() => setStage((current) => Math.min(current + 1, STAGES.length - 1)), 1200);
    return () => clearInterval(timer);
  }, [busy]);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const payload = await api.incidentCommand({ command });
      setResult(payload);
    } catch (apiError) {
      setError(apiError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="AI Incident Commander"
        subtitle="Natural language → validated intent → read-only tools → grounded response. Nothing is executed."
      />

      <div className="bob-glass" style={{ marginBottom: 16 }}>
        <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--glass-border)" }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-3)", marginBottom: 12 }}>
            COMMANDER · Ask ChainSentinel
          </div>
          <form onSubmit={submit}>
            {error?.isValidation?.() ? <FieldErrors error={error} /> : null}
            {error && !error.isValidation?.() ? <ErrorState error={error} /> : null}
            <div className="row" style={{ marginBottom: 12 }}>
              <input
                type="text"
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                placeholder='e.g. "Investigate the Mumbai port disruption and prioritize cold-chain shipments."'
                style={{ flex: 1, background: "rgba(255,255,255,0.85)", fontSize: 14, height: 38 }}
                disabled={busy}
              />
              <button
                type="submit"
                className="primary"
                disabled={busy || command.trim() === ""}
                style={{ height: 38, fontSize: 13 }}
              >
                {busy ? "Investigating…" : "Investigate"}
              </button>
            </div>
          </form>
        </div>
        <div style={{ padding: "12px 18px" }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-3)", display: "block", marginBottom: 8 }}>
            Suggested commands
          </span>
          <ul style={{ margin: 0, paddingLeft: 20, listStyleType: "disc" }}>
            {SUGGESTED.map((suggestion) => (
              <li key={suggestion} style={{ marginBottom: 6 }}>
                <button
                  type="button"
                  className="link"
                  disabled={busy}
                  onClick={() => setCommand(suggestion)}
                  style={{ fontSize: 12.5, color: "var(--text-2)", textAlign: "left", cursor: "pointer" }}
                >
                  {suggestion}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {busy ? (
        <Card title="Investigation" subtitle="Controlled pipeline: intent → allowlist → MCP tools → evidence → grounded explanation">
          <p role="status" aria-live="polite" style={{ margin: 0, fontSize: 13.5, color: "var(--text-2)" }}>
            {STAGES[stage]}
          </p>
        </Card>
      ) : null}

      <CommanderResult result={result} />
    </div>
  );
}
