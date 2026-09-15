# bob/ — optional Bob query proxy (M2)

Owner: Member 2. Placeholder in Phase 1A.

Planned contents (Phase 4):
- `POST /api/bob/query` — forwards a prompt to the configured Bob/MCP gateway.
- Returns `{ answer, evidence: [{tool, input, output}], tool_calls }`.
- Returns `503 BOB_UNAVAILABLE` when `BOB_ENABLED=false` or Bob is unreachable.
- Never invents data; evidence is the raw tool JSON.

The primary Bob path is the MCP tool server (`src/mcp-server/`) calling the REST API; this proxy exists only for the in-app chat panel when credentials are available (Q6).

Contract: `docs/phase-0/member-2-bob-integration.md`, `docs/phase-0/api-contract.md` §3.23.
