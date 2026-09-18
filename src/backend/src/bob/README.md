# bob/ — grounded Bob query handler (M2)

**Status:** implemented. `POST /api/bob/query` returns `{ answer, evidence: [{tool, input, output}], tool_calls }`.

## Modes (contract: `docs/phase-0/api-contract.md` §3.23, decision D2)

| `BOB_ENABLED` | `BOB_API_URL` | Behaviour |
|---|---|---|
| `false` (default) | any | `503 BOB_UNAVAILABLE`, `details.reason = bob_disabled`; the dashboard stays fully usable |
| `true` | set | forwards `prompt` + the 10 grounding rules to the Bob/MCP gateway with bearer `BOB_API_KEY`; gateway failure/unreachable → `503 BOB_UNAVAILABLE`, `details.reason = bob_unreachable` |
| `true` | empty | local grounded engine (`engine.js`): intent detection → MCP tool calls → grounded answer synthesis; no external API or credentials |

- The local engine reuses the frozen 11-tool MCP layer (`callTool`) and calls the backend REST API only.
- The API key is read from the environment and used only in the outbound `Authorization` header — never logged, never in payloads.
- References: `docs/phase-0/member-2-bob-integration.md` §4–§6, `docs/phase-0/api-contract.md` §3.23.
