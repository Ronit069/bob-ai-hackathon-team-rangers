# Feature 2 — AI Incident Commander

**Status:** implemented (backend + frontend + tests). Feature-flagged:
`FEATURE_AI_INCIDENT_COMMANDER` (default `false`; the local demo `.env` sets `true`).
Extends the existing ChainSentinel system — the deterministic services remain authoritative.

## What it does

An operator talks to ChainSentinel in natural language:

```text
Investigate the Mumbai port disruption and prioritize cold-chain shipments.
```

When an AI provider is configured (watsonx/Granite, Gemini or Groq — see
`docs/GRANITE_CONFIGURATION.md`), **the LLM chooses which of the 11 frozen read-only MCP
tools to call and writes the incident brief itself**. The server validates every tool name and
input, executes only through the frozen `callTool`, assembles deterministic evidence, and
grounding-checks the LLM brief before returning it. Without a provider the deterministic
fallback runs and is clearly labelled.

```text
Natural language
  → LLM intent (validated; deterministic parser as fallback)
  → LLM tool loop over the 11 frozen read-only MCP tools (server-validated, capped)
  → deterministic evidence completion + existing ChainSentinel services
  → command evidence (risk engine, matching, fleet, recommendations)
  → LLM final brief → grounding validation → repair pass → deterministic fallback
  → optional proposal (existing endpoint; pending human approval only)
```

## Endpoint

`POST /api/ai/incident-command` — `{ "command": "..." }` (see `docs/phase-0/api-contract.md` §9.2).

Statuses: `FEATURE_DISABLED`, `CLARIFICATION_REQUIRED`, `VALIDATED_AI`, `DETERMINISTIC_FALLBACK`,
`PROVIDER_UNAVAILABLE`, `INVALID_AI_OUTPUT`, `GROUNDING_FAILED`.

## The grounded tool agent

- The model replies with exactly one JSON step per turn:
  `{"tool":"<name>","input":{...}}` or `{"final": <answer|brief>}`.
- Only the 11 frozen tools exist. Unknown tools are rejected, invalid inputs are rejected by
  the frozen zod schemas, and nothing is executed for a rejected step.
- Tool budget: `AI_AGENT_MAX_TOOL_CALLS` (default 6); prompt bounded by
  `AI_AGENT_MAX_PROMPT_CHARS` (default 30000).
- After the LLM's investigation, a deterministic completion step runs any essential read the
  model skipped (affected shipments, risk, excursions, assets) so the evidence is complete.
- The final brief is validated against the brief schema, grounding-checked against the
  evidence, optionally repaired once with the exact violations and allowed vocabulary, and —
  if it still conflicts — replaced by the deterministic explanation.

## Supported commands

| Command example | Intent |
|---|---|
| "Investigate the Mumbai port disruption and prioritize cold-chain shipments." | `INVESTIGATE_INCIDENT` |
| "Which shipments are affected by D01?" | `GET_AFFECTED_ENTITIES` |
| "Which affected shipment has the highest risk?" / "Why is S039 critical?" | `GET_RISK` |
| "What refrigerated assets are available?" | `GET_AVAILABLE_ASSETS` |
| "What recovery options does the system recommend?" | `GET_RECOMMENDATIONS` |
| "Prepare a recovery proposal for S039." | `CREATE_PROPOSAL` (pending approval only) |

Unknown or ambiguous requests return `CLARIFICATION_REQUIRED` with the recorded incidents —
never a guessed incident, shipment or action.

## Security boundary

- **AI can:** understand, investigate (read-only tools), analyze, explain, recommend, and
  prepare a proposal.
- **AI cannot:** override, approve, execute, modify the database, bypass authorization,
  invent facts/tools/results, or claim an action was executed.
- Model output is schema-validated; tool execution is allowlisted and server-side.
- Grounding rejects unknown IDs, unsupported numbers, unsupported category words (negated
  absences are allowed) and recommendation-family conflicts.
- Partial tool results are reported (`partial`, `missing_tools`) and never fabricated.
- The only mutation is proposal creation through the existing recommendation endpoint
  (`status = pending`, audit `created`). Decisions remain human actions in the dashboard.
- Credentials stay server-side; see `docs/GRANITE_CONFIGURATION.md`.

## Bob Chat

`POST /api/bob/query` uses the same agent when a provider is configured and returns an
LLM-generated, grounding-checked answer plus the raw tool evidence. LLM responses add
`status`, `source`, `provider_name` and `grounding` (additive); the deterministic contract
(`{answer, evidence, tool_calls}`) is unchanged when no provider is configured or the
gateway/proxy mode is used.

## Configuration

```env
FEATURE_AI_INCIDENT_COMMANDER=true
AI_PROVIDER=auto                 # watsonx | gemini | groq | bob_gateway | none
WATSONX_API_KEY=...
WATSONX_PROJECT_ID=...
WATSONX_URL=...
WATSONX_MODEL_ID=ibm/granite-4-h-small
```

## UI

`/commander` (nav: BOB → Incident Commander) shows the command box, staged progress, the
response, the proposal state (PROPOSAL READY / human approval required), the per-step tool
activity and the raw evidence JSON. Bob Chat shows an AI/grounded or deterministic-fallback
status badge.

## Tests

- `src/backend/test/ai-providers.test.js` — watsonx IAM/chat, Gemini, Groq (mocked fetch).
- `src/backend/test/ai-tool-agent.test.js` — tool selection, allowlist/input rejection,
  budget, protocol correction, provider errors.
- `src/backend/test/ai-commander-*.test.js` — intent/schema, deterministic paths, LLM tool
  loop, grounded repair, grounding rejection, proposal flows, API contract.
- `src/backend/test/bob-llm.test.js` — LLM answers, grounding fallback, validation.
- `src/frontend/test/screens-commander.test.jsx`, `screens-bob-llm.test.jsx`.

## Not implemented (out of scope)

Feature 3 (what-if simulator), autonomous execution, multi-agent systems, RAG, voice, new ML
models, MCP tool changes, database schema changes.
