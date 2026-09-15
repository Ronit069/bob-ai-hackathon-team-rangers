# Phase 3B — Bob/MCP and Remaining Endpoints Report (Person 2 Scope)

**Project:** ChainSentinel — L2 Supply Chain Disruption Assistant & Fleet Utilisation Optimizer
**Date:** 2026-09-14
**Scope:** endpoints 12–17, 18–23, 28 · exactly the 11 frozen MCP tools · Bob orchestration/tool-calling foundation · 503 fallback · E2E Bob → MCP → backend → structured output
**Rules honoured:** frozen contracts only · Phase 2 services reused (no formula changes) · Person 1's infrastructure reused (no rewrites) · no new endpoints or tools · no ML · MCP tools read-only · Bob never touches PostgreSQL · inputs validated · structured errors · ground truth used as the oracle.

---

## 1. Endpoints completed

| # | Method + Path | Service dependency | DB dependency | Status codes | Tests |
|---|---|---|---|---|---|
| 12 | POST `/api/sensor-readings` | `computeQuality` (flags), `detectExcursions` (via refresh) | `getShipment`, `listReadingsByShipment`, `insertSensorReadingsBatch`, `nextEntityId`, `insertTemperatureExcursion`/`updateExcursionEvaluation` | 201, 400 (all-invalid per D5), 400 validation | 7 |
| 13 | GET `/api/shipments/:id/sensor-readings` | `computeQuality`, `sensorStatus`, `detectExcursions` | `getShipment`, `listReadingsByShipment`, `getLatestPolicyForCargo` | 200, 400, 404 | 2 |
| 14 | GET `/api/excursions` | `detectExcursions` (refresh), `recommendedAction`, `timeToDeliveryHours` | `getShipment`, `listExcursions` | 200, 400, 404 | 3 |
| 15 | GET `/api/alerts/coldchain` | `sensorStatus` logic via latest readings | `listExcursions(active)`, `listShipments(cold)`, `listLatestReadingsByShipment` | 200 | 1 |
| 16 | GET `/api/temperature-policies` | — | `listTemperaturePolicies` | 200, 400 | 2 |
| 17 | PUT `/api/temperature-policies/:id` | validation + versioning | `getTemperaturePolicy`, `getLatestPolicyForCargo`, `insertTemperaturePolicy`, `appendAuditRecord` | 200, 400, 404 | 2 |
| 18 | GET `/api/shipments/:id/risk` | `matchShipments`, `detectExcursions`, `coldchainRisk`, `combinedScore` | `getShipment`, network context, `insertRiskAssessment`, `getLatestRiskAssessment` | 200, 400, 404 | 3 |
| 19 | GET `/api/risk/overview` | same as 18 over actionable shipments | network context + `insertRiskAssessment` per row | 200, 400 | 1 |
| 20 | GET `/api/recommendations` | — | `listRecommendations` | 200, 400 | 2 |
| 21 | POST `/api/recommendations/:id/decision` | single-transition guard (D4) | `getRecommendation`, `updateRecommendationDecision`, `appendAuditRecord` | 200, 400, 404, 409 | 3 |
| 22 | GET `/api/audit` | — | `listAuditRecords` (asc/desc) | 200, 400 | 1 |
| 23 | POST `/api/bob/query` | Bob proxy (D2) | none (never touches the DB) | 200 (enabled), 400, 503 | 2 |
| 28 | PATCH `/api/excursions/:id` | transition guard + critical-note rule | `getTemperatureExcursion`, `updateExcursionStatus`, `appendAuditRecord` | 200, 400, 404, 409 | 3 |

**Endpoint 1 (health)** already existed. All 28 frozen endpoints are now implemented; no new endpoints were added.

### Verification matrix (request/response/errors)
- **Request schemas:** `sensorReadingsEnvelopeSchema` (per-reading validation), `sensorReadingsQuerySchema`, `excursionsQuerySchema`, `policiesQuerySchema`, `riskQuerySchema`, `overviewQuerySchema`, `recommendationsQuerySchema`, `auditQuerySchema`, `bobQuerySchema` — all strict, unknown fields rejected.
- **Response schemas:** exactly per `api-contract.md` §3.12–3.23, §3.28 + amendments (B-2 sensor health block, B-5 `post_delivery`/`time_to_delivery_hours`/`recommended_action`, RC-3 nested risk factors).
- **Status codes / errors:** verified per endpoint (success, validation 400, not-found 404, conflict 409, Bob 503, DB failure 500) in the test suite.
- **Ground truth oracle:** persisted excursions match `ground_truth.json` exactly (14/14 tuples); S039 combined risk = 0.728 (ground truth) across REST, MCP tool and stdio MCP server paths.

---

## 2. MCP tools completed (exactly 11 — no additions)

| Tool | Input schema (validated) | REST endpoint | Read-only |
|---|---|---|---|
| `get_active_disruptions` | `{}` | 2 | yes |
| `get_affected_shipments` | `{disruption_id, include_delivered?}` | 5 | yes |
| `get_route_alternatives` | `{shipment_id, limit?}` | 8 | yes |
| `get_carrier_alternatives` | `{shipment_id}` | 9 | yes |
| `get_idle_assets` | `{region_code?, min_idle_minutes?}` | 10 | yes |
| `get_redeployment_candidates` | `{shipment_id}` | 11 | yes |
| `get_sensor_status` | `{shipment_id, from?, to?}` | 13 | yes |
| `get_temperature_excursions` | `{shipment_id?, severity?, status?, active_only?}` | 14 | yes |
| `get_combined_risk` | `{shipment_id}` | 18 | yes |
| `get_risk_overview` | `{limit?, include_zero?}` | 19 | yes |
| `get_audit_log` | `{entity_type?, entity_id?}` | 22 | yes |

- Transport: **stdio** (decision D3); SDK pinned exactly `@modelcontextprotocol/sdk@1.12.0`.
- Implementation: `src/mcp-server/src/tools.js` (definitions + validation + REST caller), `src/mcp-server/src/index.js` (SDK server registration).
- Validation: zod strict schemas; invalid arguments are rejected at the MCP boundary with a structured JSON-RPC error (`-32602`); backend errors return `{ ok: false, error, http_status }` without throwing.
- Read-only proof: a dedicated test snapshots recommendation/audit/excursion/reading row counts before and after calling all 11 tools — unchanged, zero decided recommendations.

---

## 3. Bob flow completed

- **Grounding foundation:** `src/backend/src/bob/prompt.js` (the 10 grounding rules) is attached to every forwarded Bob query; `src/backend/src/bob/routes.js` implements the proxy with the 503 fallback.
- **Tool-calling flow:** operator → Bob → MCP tool server → REST API → deterministic service → structured JSON → answer + evidence. Proven end-to-end by `test/mcp-server.test.js` (spawned stdio server + JSON-RPC handshake + `tools/list` + `tools/call`) and `test/e2e-flow.test.js` (REST vs MCP output equality).
- **Fallback:** `BOB_ENABLED=false` (default) → `503 BOB_UNAVAILABLE` with `details.reason`; the dashboard path remains fully functional (verified).
- **No database access for Bob:** tools call REST only; the proxy forwards to Bob without credentials in logs and never touches the DB.

---

## 4. Files created / changed

**New (backend):** `src/coldchain/routes.js` · `src/coldchain/evaluation.js` · `src/risk/routes.js` · `src/audit/routes.js` · `src/bob/routes.js` · `src/bob/prompt.js`
**New (MCP):** `src/mcp-server/src/tools.js` · `src/mcp-server/src/index.js` (replaced placeholder)
**New (tests):** `test/api-coldchain.test.js` · `test/api-shared.test.js` · `test/mcp-tools.test.js` · `test/mcp-server.test.js` · `test/e2e-flow.test.js`
**Modified:** `src/app.js` (mount four routers) · `src/common/config.js` (`BOB_API_KEY`) · `src/common/validation.js` (Phase 3B schemas) · `src/coldchain/repository.js` (`updateExcursionEvaluation`) · `src/audit/repository.js` (audit ordering) · `src/mcp-server/package.json` (SDK pinned 1.12.0, description) · `test/api-logistics.test.js` (catch-all test updated — the old 501 target is now implemented)

**No changes to:** frozen formulas, contracts, migrations, fixtures, or ground truth.

---

## 5. Tests executed and results

| Suite | Command | Result |
|---|---|---|
| Full backend + MCP + E2E | `npm test` | **138/138 pass, 0 fail** |
| — Phase 2 suites (unchanged) | | 64/64 |
| — Phase 3A API tests (Person 1) | | 30/30 |
| — **Phase 3B new tests** | | **44/44** (coldchain 19, shared 10, MCP tools 7, MCP stdio server 4, E2E 4) |
| Python generator | `python -m unittest discover` | 48/48 pass |
| Contract validation | `python validate.py` | PASS (48 scenarios, 15 matching, 14 excursions) |
| Cross-language oracle | `node scripts/verify-seed.js` | matching 15/15 · excursions 14/14 |
| Live smoke (dev DB) | manual | excursions S026 → 1 major + recommended action · alerts 37 (14 excursion + 23 sensor failure) · overview top3 S039=0.728, S038=0.5, S047=0.316 · policies 4 · Bob 503 |

Key oracle assertions: persisted excursions == `ground_truth.excursions` (14/14); S039 risk 0.856/0.6/0.728 via REST, tool layer and stdio MCP; affected-shipment lists identical between REST and MCP.

---

## 6. Contract deviations (recorded, not silent)

| # | Deviation | Rationale |
|---|---|---|
| 1 | **Policy version IDs:** v1 = `TP-<CARGO>`; v2+ = `TP-<CARGO>_V<N>` (matches the `^TP-[A-Z0-9_]+$` pattern) | The `temperature_policy` PK is `id` while versions must be retained; the contract fixes the format for v1 and requires versioning |
| 2 | **Excursion persistence:** detection runs on ingestion (12) and on read (13/14/15/18/19) and persists idempotently (match on shipment + start_time); closed excursions are immutable; no audit row per reading | Approved design ("detection on ingest and read; excursions stored so alerts/review/risk can reference them"); member-2 data design §7 boundary |
| 3 | **Risk `refresh=false` with no stored snapshot → 404** | Contract specifies "returns latest stored snapshot" but not the empty case |
| 4 | **Alerts treat stale feeds (≥ 4× interval) as sensor failures** | Correct per the frozen failure rule; seeded feeds are historical, so the simulator (endpoint 12) is the live demo path |
| 5 | **MCP invalid arguments** rejected at the SDK boundary with JSON-RPC `-32602`; backend errors return as structured `{ok:false}` results | Both are structured errors; the SDK validates before the handler runs |
| 6 | **Overview persists one snapshot per computed shipment per call** | Contract: snapshots persisted on read |
| 7 | **`human_review_required`:** alerts → true for severity ≠ warning; risk factors → true for severity ∉ {normal, warning} | Severity classification doc: required for critical/unknown, recommended for major |
| 8 | **Tool error envelope** carries `http_status` and the backend error object unchanged | Keeps Bob grounded on failures (rule 3) |

---

## 7. Known issues

| # | Item | Impact |
|---|---|---|
| 1 | Seeded sensor feeds end at the fixture anchor +6 h; after that every cold shipment raises a sensor-failure alert until live readings are posted | Demo should regenerate fixtures with a current `--now` (`python generate.py --now <now>`) or run the simulator; documented |
| 2 | `GET /api/excursions` (unfiltered) refreshes all cold shipments per call (~2,200 readings) | Acceptable at demo scale; revisit in Phase 6 |
| 3 | Post-delivery breaches are excluded but not emitted as `post_delivery` excursion records | Carried from Phase 2B; detection filters at the delivery cutoff |
| 4 | No Bob credentials (Q6) → only the 503 path is exercised; the enabled forward path is untested against a live Bob | Conditional on team access |
| 5 | Risk overview writes ~40 snapshots per call | Demo scale; pruning is a Phase 6 concern |
| 6 | MCP transport is stdio only | Per decision D3 |
| 7 | No UI consumes the new endpoints yet | Phase 5 |

---

## 8. Remaining work

- **Phase 3 consolidation:** cross-member PR review (Person 1 reviews 3B endpoints/tools; Person 2 reviews 3A endpoints), then the Phase 3 completion checkpoint (the phase is **not** marked complete here).
- **Bob live integration:** implement/validate the enabled forward path once Q6 (access method/credentials) is confirmed; run live grounding tests (CT-17 live half).
- **Phase 4/5:** dashboard screens consuming the new endpoints; policy editor folded into S8 (D7); evidence panel wiring.
- **Phase 6 candidates:** excursion refresh performance, snapshot pruning, fixture freshness automation for demo day.

---

## 9. Readiness

All Phase 3B deliverables are implemented and verified; the complete REST surface (28 endpoints), the 11-tool MCP server, the Bob proxy fallback and the end-to-end tool flow are covered by 138 passing backend tests plus Python and cross-language verification. The phase itself remains open pending cross-member review and the Phase 3 completion checkpoint.

PERSON_2_PHASE_3_SCOPE_COMPLETE
