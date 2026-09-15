# mcp-server/ — IBM Bob tool layer (M2)

Node.js thin MCP adapter. **Status:** implemented (Phase 3B) — stdio transport, 11 frozen read-only tools. Grounding smoke: `npm run smoke` (Phase 6).

## Grounding smoke (`npm run smoke`)

Spawns the stdio server exactly as Bob would and verifies the frozen contract against a
running backend (default `http://localhost:3001`, override with `BACKEND_URL` or
`--base-url=`):

- `tools/list` exposes exactly the 11 frozen tools;
- `get_combined_risk(S039)` matches the generated ground-truth oracle;
- `get_active_disruptions` / `get_affected_shipments(D01)` return live grounded rows;
- static scan: the tool layer sends only `GET` requests (read-only);
- static scan: no database driver/`DATABASE_URL` usage — all data arrives through REST.

## Rules (ADR-004)

- Tools are **read-only**; no tool mutates state.
- Each tool validates input, calls exactly one REST endpoint, and returns the JSON unchanged (plus a `tool` name).
- No business logic here — REST is the single source of truth.
- Bob never touches the database and never receives credentials.
- The tool layer is testable without Bob credentials (M2-09b/M2-10a).

## Frozen tools (11)

`get_active_disruptions` · `get_affected_shipments` · `get_route_alternatives` · `get_carrier_alternatives` · `get_idle_assets` · `get_redeployment_candidates` · `get_sensor_status` · `get_temperature_excursions` · `get_combined_risk` · `get_risk_overview` · `get_audit_log`

Design: `docs/phase-0/member-2-bob-integration.md` · Mapping: `docs/phase-0/api-contract.md` §5.
