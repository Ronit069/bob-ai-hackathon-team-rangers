# Feature 2 — AI Incident Commander

**Status:** implemented (backend + frontend + tests). Feature-flagged: `FEATURE_AI_INCIDENT_COMMANDER`
(default `false`; local demo `.env` sets `true`). Extends the existing ChainSentinel system — the
deterministic services remain authoritative.

## What it does

An operator talks to ChainSentinel in natural language:

```text
Investigate the Mumbai port disruption and prioritize cold-chain shipments.
```

The commander interprets the command, validates it against a server-side allowlist, runs the
frozen read-only MCP tools, reuses the existing deterministic risk/recommendation engines, and
returns a grounded explanation plus optional pending proposal. It never executes anything.

```text
Natural language
  → existing AI provider (Granite/watsonx when configured; deterministic fallback otherwise)
  → validated intent (zod)
  → server-side allowlist + fixed tool plan
  → frozen MCP tools (11, read-only)
  → existing ChainSentinel services (risk engine, matching, fleet, recommendations)
  → command evidence
  → Feature 1 grounding validator
  → explanation
  → proposal (optional; pending human approval only)
```

## Endpoint

`POST /api/ai/incident-command` — `{ "command": "..." }` (see `docs/phase-0/api-contract.md` §9.2).

Statuses: `FEATURE_DISABLED`, `CLARIFICATION_REQUIRED`, `VALIDATED_AI`, `DETERMINISTIC_FALLBACK`,
`PROVIDER_UNAVAILABLE`, `INVALID_AI_OUTPUT`, `GROUNDING_FAILED`.

## Supported commands

| Command example | Intent | Fixed tool plan |
|---|---|---|
| "Investigate the Mumbai port disruption and prioritize cold-chain shipments." | `INVESTIGATE_INCIDENT` | active disruptions → affected shipments → risk overview → combined risk → excursions → idle assets |
| "Which shipments are affected by D01?" | `GET_AFFECTED_ENTITIES` | active disruptions → affected shipments |
| "Which affected shipment has the highest risk?" / "Why is S039 critical?" | `GET_RISK` | context tools → combined risk |
| "What refrigerated assets are available?" | `GET_AVAILABLE_ASSETS` | idle assets (+ redeployment candidates when a shipment is named) |
| "What recovery options does the system recommend?" | `GET_RECOMMENDATIONS` | context tools + existing recommendation repository |
| "Prepare a recovery proposal for S039." | `CREATE_PROPOSAL` | combined risk → redeployment candidates → `POST /api/recommendations` (pending only) |

Unknown or ambiguous requests return `CLARIFICATION_REQUIRED` with the recorded incidents — never
a guessed incident, shipment or action.

## Security boundary

- **AI can:** understand, investigate, retrieve, analyze, explain, recommend, prepare a proposal.
- **AI cannot:** override, approve, execute, modify the database directly, bypass authorization,
  invent facts/tools/results, or claim an action was executed.
- Model output is schema-validated; the executed operations come from a fixed server-side plan.
- Unknown intents/operations/extra fields are rejected; the deterministic parser is used instead.
- Tool names are never derived from user or evidence text; all tool input IDs are re-verified
  against the database.
- Evidence (including disruption descriptions) is untrusted data; prompts instruct the model to
  ignore instructions found inside it.
- The grounding validator (Feature 1) rejects unknown IDs, unsupported numbers, mismatched
  categories and recommendation conflicts; rejected AI text falls back to the deterministic
  explanation.
- Failures/partial tool results are reported (`partial`, `missing_tools`) and never fabricated.
- The only mutation is proposal creation through the existing recommendation endpoint
  (`status = pending`, audit `created`). Decisions remain human actions in the dashboard.
- Credentials (watsonx/Bob) stay server-side; see `docs/GRANITE_CONFIGURATION.md`.

## Configuration

```env
FEATURE_AI_INCIDENT_COMMANDER=true     # enable the commander (default false)
WATSONX_API_KEY=...                    # Granite/watsonx boundary (placeholders until provided)
WATSONX_PROJECT_ID=...
WATSONX_URL=...
WATSONX_MODEL_ID=ibm/granite-3-8b-instruct
```

When no provider is configured the commander still works: deterministic intent parsing and the
deterministic grounded explanation are used (`DETERMINISTIC_FALLBACK`). No request is fabricated.

## UI

`/commander` (nav: BOB → Incident Commander) shows the command box, staged progress
("Understanding request… → Preparing response…"), the response, the proposal state
(PROPOSAL READY / human approval required), the per-step tool activity and the raw evidence JSON.
Approval is performed in the existing shipment recommendation tab.

## Tests

- `src/backend/test/ai-commander-unit.test.js` — schema, deterministic parser, incident matching,
  priority selection, allowlist/plans, explanation grounding, default proposal client.
- `src/backend/test/ai-commander-service.test.js` — investigation, cold-chain priority, unknown
  incident, ambiguous command, prompt injection, unauthorized operations, tool failure (partial),
  provider failure, proposal flows, feature flag, observability.
- `src/backend/test/ai-commander-api.test.js` — route validation, feature flag, clarification
  paths, invalid AI intent, provider failure, validated AI path, Feature 1 coexistence.
- `src/frontend/test/screens-commander.test.jsx` — screen states and proposal link.

## Not implemented (out of scope)

Feature 3 (what-if simulator), simulation engines, autonomous execution, multi-agent systems, RAG,
voice, new ML models, MCP tool changes, database schema changes.
