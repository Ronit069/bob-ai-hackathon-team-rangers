# Architecture

**Project:** ChainSentinel — L2 Supply Chain Disruption Assistant & Fleet Utilisation Optimizer
**Source:** Approved architecture decisions (ADR-001 through ADR-007, `docs/phase-0/architecture-decision-record.md`) as implemented through Phase 6.

---

## System Overview

ChainSentinel is a local-only application consisting of four independently runnable services:

```
Browser (React + Vite)
    │  HTTP via Vite dev proxy (/api → :3001)
    ▼
Node.js + Express backend (:3001)
    │  pg (no ORM)
    ▼
PostgreSQL 16 (Docker, :5433)

IBM Bob (external, optional)
    │  stdio MCP protocol
    ▼
Node.js MCP server (thin adapter)
    │  HTTP GET only
    ▼
Node.js + Express backend (:3001)
```

The frontend communicates with the backend exclusively through the Vite dev proxy. The MCP server communicates with the backend exclusively through read-only HTTP GET calls. Bob communicates with the MCP server over stdio. PostgreSQL is accessed only by the backend; the MCP server and the frontend never touch it directly.

---

## Component Descriptions

### Frontend — React + Vite (`src/frontend/`)

- **Technology:** React 18, React Router 6, Recharts, plain CSS with design tokens. No UI framework, no state library.
- **Port:** 5173 (development; Vite dev server with `/api` proxy).
- **Key modules:**
  - `src/api/` — thin API client (`client.js`, `ApiError.js`, `endpoints.js`). One function per frozen endpoint. No business logic.
  - `src/hooks/` — `useApi` (loading/error/refresh), `usePolling` (30 s on S1/S8, tab-visibility aware).
  - `src/components/` — shared UI (`layout.jsx`, `states.jsx`, `display.jsx`, `domain.jsx`).
  - `src/screens/` — 14 screens (S1–S14).
- **Hard rules:** The frontend never computes scores, severities, risk weights, durations, or rankings. All values are rendered verbatim as returned by the backend. A static scan test (`no-formulas.test.js`) enforces this.
- **Bob fallback:** S13 (Bob chat) renders an explicit fallback panel when `BOB_ENABLED=false`; the dashboard remains fully functional.

### Backend — Node.js + Express (`src/backend/`)

- **Technology:** Node.js 20, Express 4 (ESM), zod for input validation, pg driver (no ORM).
- **Port:** 3001.
- **Module structure:**

| Module | Endpoints | Scope |
|---|---|---|
| `src/common/` | — | Config, pg pool, zod schemas, error envelope, HTTP helpers |
| `src/logistics/` | 2–11, 24–27 | Disruptions, shipments, routes, carriers, fleet, alternatives, redeployment |
| `src/coldchain/` | 12–17, 28 | Sensor readings, quality, excursions, severity, policies, alerts |
| `src/risk/` | 18–19 | Combined risk score, snapshots, ranked overview |
| `src/audit/` | 20–23 | Append-only audit, recommendation decisions |
| `src/bob/` | — | Optional Bob proxy (`BOB_ENABLED` flag); `POST /api/bob/query` |

- **28 REST endpoints** (see `docs/phase-0/api-contract.md` for the full contract).
- **Formula location:** All scoring formulas live in service files (`matching.service.js`, `alternatives.service.js`, `fleet.service.js`, `excursion.service.js`, `risk.service.js`). Route handlers contain no formula constants.
- **Write-throttling (Phase 6):** `GET /api/excursions` and `GET /api/risk/overview` use a process-local memo keyed on input fingerprints to avoid redundant detection runs and snapshot inserts on repeated calls. Responses always carry freshly computed values.
- **Unknown routes:** Any unmatched `/api/*` path returns `404 NOT_FOUND`.

### Database — PostgreSQL 16 (`docker-compose.yml`)

- **Port:** 5433 (host; maps to container port 5432).
- **Credentials (local dev only):** user `bobathon`, password `bobathon`, database `chain_sentinel`.
- **Migrations:** numbered SQL files in `src/backend/migrations/` applied by `npm run migrate`.
- **Schema tables:** `carrier`, `route`, `route_segment`, `shipment`, `disruption`, `fleet_asset`, `asset_assignment`, `cargo_profile`, `temperature_policy`, `sensor_reading`, `temperature_excursion`, `recommendation`, `risk_assessment`, `audit_record`.
- **Seed data:** synthetic fixtures loaded by `npm run seed` from `data/seed/` (deterministic, fixed seed).

### MCP Server — Node.js stdio adapter (`src/mcp-server/`)

- **Technology:** Node.js 20, `@modelcontextprotocol/sdk` 1.12.0, zod.
- **Transport:** stdio (decision D3). Bob spawns this server as a child process over standard input/output.
- **11 frozen read-only tools:**
  `get_active_disruptions`, `get_affected_shipments`, `get_route_alternatives`, `get_carrier_alternatives`, `get_idle_assets`, `get_redeployment_candidates`, `get_sensor_status`, `get_temperature_excursions`, `get_combined_risk`, `get_risk_overview`, `get_audit_log`.
- **Rules:** Each tool validates input with zod, calls exactly one backend REST endpoint via `GET`, and returns the JSON unchanged (plus a `tool` name field). No business logic, no database access, no credentials.
- **Grounding smoke:** `npm run smoke` verifies the tool layer against a live backend (7 checks including oracle equality).

### Data Generator — Python (`src/data-generator/`)

- **Technology:** Python 3.11, standard library only. No pandas, no external dependencies.
- **Purpose:** Generates deterministic synthetic fixtures (`logistics.json`, `coldchain.json`, `ground_truth.json`) from a fixed seed. Fixtures are pre-generated and checked into `data/seed/`.
- **Validator:** `validate.py` checks referential integrity and scenario coverage. A separate backend script (`node scripts/verify-seed.js`) cross-checks the JS service outputs against the Python ground truth.

---

## Data Flow

### Disruption → Recommendation Flow

```
1. Operator creates disruption (POST /api/disruptions)
2. Affected shipments identified (GET /api/disruptions/:id/affected-shipments)
3. Risk ranked (GET /api/risk/overview)
4. Route/carrier alternatives fetched (GET /api/shipments/:id/route-alternatives)
5. Recommendation created (POST /api/recommendations)
6. Human approves/rejects (POST /api/recommendations/:id/decision)
7. Audit record written
```

### Cold-Chain Monitoring Flow

```
1. Sensor readings ingested (POST /api/sensor-readings)
2. Excursion detection runs on ingestion and on read (refreshExcursions)
3. Excursions persisted (temperature_excursion table)
4. Alerts surfaced (GET /api/alerts/coldchain)
5. Human reviews excursion (PATCH /api/excursions/:id)
6. Audit record written
```

### Bob Query Flow (when BOB_ENABLED=true)

```
1. Operator sends question (POST /api/bob/query)
2. Backend proxy forwards to Bob with grounding rules + bearer auth
3. Bob calls MCP tools over stdio
4. Each tool calls one backend REST endpoint (GET only)
5. Bob synthesises answer from tool JSON only
6. Response contains answer + evidence (tool name, input, raw JSON)
7. Frontend displays answer alongside evidence panel
```

---

## Bob Integration Boundary (ADR-004)

| Rule | Implementation |
|---|---|
| Bob never touches PostgreSQL | No database driver in `src/mcp-server/`; tools call REST only |
| Tools are read-only | `callTool` hardcodes `method: "GET"`; no POST/PUT/PATCH/DELETE |
| Thin adapter only | No business logic in the MCP server; JSON returned unchanged |
| `BOB_ENABLED=false` is first-class | `POST /api/bob/query` returns `503 BOB_UNAVAILABLE`; dashboard fully functional |
| API key never exposed | Read from `BOB_API_KEY` env var; never returned in responses; never logged |

---

## IBM Bob Integration Status

| Item | Status |
|---|---|
| MCP tool server (11 tools) | ✅ Implemented and tested |
| Grounding rules (system prompt) | ✅ Implemented in `src/backend/src/bob/prompt.js` |
| Bob proxy (`POST /api/bob/query`) | ✅ Implemented; `BOB_ENABLED=false` default |
| `BOB_ENABLED=false` fallback | ✅ Verified (503 with `BOB_UNAVAILABLE`) |
| Live Bob integration | ⚠️ Conditional — blocked on Q6 (Bob access credentials) |
| Bob live grounding tests (CT-17) | ⚠️ Conditional — blocked on Q6 |

---

## Scoring Formulas (frozen)

All formulas are implemented in backend service files only. The frontend never computes them.

**Impact score (R1)**
```
impact_score = 0.4 × cargo_value_norm + 0.4 × deadline_urgency_norm + 0.2 × is_cold_chain
```

**Route/carrier score (R2)**
```
score = w1×(1−cost_norm) + w2×(1−eta_norm) + w3×capacity_margin − w4×residual_risk
```

**Fleet redeployment score (R3 / A-7)**
```
proximity_score = 1 − min(distance_km, radius) / radius
idle_score      = min(idle_minutes, 1440) / 1440
capacity_fit    = min(1, asset.capacity_units / shipment.volume_units)
score = 0.45×proximity_score + 0.35×idle_score + 0.20×capacity_fit
```

**Severity ladder (R5/R6 / B-8)**
```
breach = temperature_c < policy.min_c OR temperature_c > policy.max_c
→ unknown_review:  data_quality is missing_readings/sensor_failure/implausible
→ warning:         duration ≤ tolerance AND magnitude ≤ minor
→ critical:        magnitude > major OR duration > critical_duration  (B-8: checked first)
→ major:           otherwise
```

**Combined risk (P2)**
```
combined_score = RISK_ALPHA × disruption_risk + RISK_BETA × coldchain_risk
(defaults: RISK_ALPHA = RISK_BETA = 0.5, configurable via environment variables)
```

---

## Known Limitations

- **Local-only deployment.** No cloud hosting, no public URL.
- **Single trusted operator.** No authentication, authorization, or multi-tenant isolation.
- **Synthetic data only.** All datasets are illustrative; no real shipment, carrier, or sensor data.
- **No ML.** All logic is deterministic rules and transparent weighted scoring. ML is deferred.
- **Region-code matching.** Disruption–shipment matching uses string region codes, not geographic polygons.
- **No live external feeds.** Disruptions are entered via the UI/API; sensor readings are posted manually or by the demo simulator.
- **Bob grounding reduces, but does not eliminate, hallucination risk.** The prompt rules prevent Bob from computing scores or inventing entities, but live Bob behaviour requires active credentials to verify fully.
- **Feeds age out.** Seeded sensor feeds end at the fixture anchor (2026-09-14 09:00 UTC +6 h). After that, all cold shipments show sensor-failure status unless the demo simulator is run. Run `node scripts/simulate-feed.js` to refresh, or `npm run seed` to reset.
- **Historical records only.** F3 (post-delivery excursion records with `post_delivery: true`) is deferred; the exclusion behavior is implemented and tested, but the stored history record is not yet emitted.

---

## Repository Structure

```
ChainSentinel/
├── src/
│   ├── backend/          Node.js 20 + Express 4 API (28 endpoints)
│   ├── frontend/         React 18 + Vite 5 dashboard (14 screens)
│   ├── mcp-server/       Node.js stdio MCP adapter (11 tools)
│   └── data-generator/   Python 3.11 fixture generator + validator
├── data/
│   └── seed/             Pre-generated fixtures + ground truth (frozen)
├── docs/
│   ├── phase-0/          Frozen design contracts (API, data, scope)
│   └── PHASE_*.md        Phase completion reports
├── docker-compose.yml    PostgreSQL 16 only
└── submission.yaml
```
