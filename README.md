# ChainSentinel

**Bobathon 2026 — L2: Supply Chain Disruption Assistant & Fleet Utilisation Optimizer**

---

## Team

- **Team name:** Rangers And *(see submission.yaml — team identity to be completed at submission time)*
- **Track:** AI
- **Lead:** *(see submission.yaml — identity to be completed at submission time)*
- **Members:** Member 1 (Logistics & Optimisation), Member 2 (Cold-Chain, AI & Bob)

## Problem Statement

Mid-size freight operators lose visibility during supply-chain disruptions because disruption impact, fleet idle capacity, and cold-chain sensor integrity are tracked in separate tools. A port strike, weather event, or geopolitical crisis cascades across hundreds of shipments — but identifying which shipments are affected, which assets are idle and compatible, and whether cold-chain cargo is at risk requires hours of manual cross-referencing. By the time a temperature excursion is found, the cargo may already be a write-off.

Full problem statement: `docs/problem-statement.md`

## Solution

ChainSentinel is a Bob-powered logistics control tower that turns a declared disruption into a ranked, explainable, human-approved action plan. It unifies three correlated risk problems in one dashboard:

1. **Affected shipment detection** — matches disruptions to route segments with timing analysis and a priority score.
2. **Route and carrier alternatives** — ranks feasible options with transparent factor breakdowns and explicit rejected alternatives.
3. **Fleet redeployment** — identifies idle compatible assets and ranks redeployment candidates.
4. **Cold-chain monitoring** — detects temperature excursions before delivery, classifies severity, and surfaces data-quality issues (gaps, failures, duplicates).
5. **Combined risk prioritisation** — merges disruption and cold-chain risk into a single ranked worklist.
6. **Grounded Bob assistant** — answers operator questions using backend tool calls, with raw evidence always visible. Bob never invents data.

Every recommendation requires human approval. All decisions are recorded in an append-only audit trail.

Full solution overview: `docs/solution-overview.md`

## Key Features

1. Disruption management (create, activate, resolve) with real-time affected-shipment detection and match reasons.
2. Ranked route and carrier alternatives with transparent scoring, capacity checks, and rejected-alternative explanations.
3. Fleet idle detection (availability, reservations, compatibility rules) and redeployment candidate ranking.
4. Cold-chain sensor monitoring — ingestion, data-quality flags (gaps, duplicates, out-of-order, implausible), per-shipment sensor health.
5. Temperature excursion detection and severity classification (Warning / Major / Critical / Unknown-Review) against configurable temperature policies.
6. Combined disruption + cold-chain priority score (`combined_score = 0.5 × disruption_risk + 0.5 × coldchain_risk`).
7. Human-approval recommendation lifecycle (pending → accepted / rejected / modified) with append-only audit trail.
8. Grounded IBM Bob assistant via 11 read-only MCP tools; evidence shown alongside every answer; dashboard fully functional when Bob is unavailable.

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite 5 (JavaScript), React Router 6, Recharts, plain CSS |
| Backend | Node.js 20 + Express 4 (ESM), zod validation, pg (no ORM) |
| Database | PostgreSQL 16 via Docker Compose |
| Data generation | Python 3.11 standard library (seeded deterministic fixtures) |
| Bob integration | Node.js MCP tool server (stdio transport, 11 read-only tools) |
| ML | **None in the MVP** — all logic is deterministic rules and transparent weighted scoring |

## How to Run

**Quick start** (requires Docker, Node.js 20+, Python 3.11+):

```bash
# 1. Clone and set up environment
git clone https://github.com/Ronit069/bob-ai-hackathon-team-rangersand
cd bob-ai-hackathon-team-rangersand
cp src/.env.example src/backend/.env

# 2. Start the database
docker compose up -d

# 3. Backend — install, migrate, seed, start
cd src/backend
npm install
npm run migrate
npm run seed
npm run dev          # backend on :3001

# 4. Frontend — install and start (new terminal)
cd src/frontend
npm install
npm run dev          # dashboard on :5173
```

Open `http://localhost:5173` in your browser.

Full instructions with troubleshooting: `docs/setup-guide.md`

## Project Structure

```
src/
├── backend/          Node.js 20 + Express 4 API (28 endpoints, 147 tests)
├── frontend/         React 18 + Vite 5 dashboard (14 screens, 49 tests)
├── mcp-server/       Node.js stdio MCP adapter (11 read-only tools)
└── data-generator/   Python 3.11 fixture generator + validator (48 tests)
data/seed/            Pre-generated fixtures + ground truth (frozen, deterministic)
docs/                 Architecture, setup guide, phase reports, frozen contracts
```

## API Overview

28 REST endpoints implemented in the backend. Key groups:

| Group | Endpoints |
|---|---|
| Disruptions | GET/POST `/api/disruptions`, PATCH `/api/disruptions/:id`, GET `/api/disruptions/:id/affected-shipments` |
| Shipments | GET `/api/shipments`, GET `/api/shipments/:id`, alternatives, sensor-readings, risk, redeployment-candidates |
| Fleet | GET `/api/fleet`, `GET /api/fleet/idle`, POST `/api/fleet/redeployments/recommend` |
| Cold-chain | POST `/api/sensor-readings`, GET `/api/excursions`, PATCH `/api/excursions/:id`, alerts, policies |
| Risk | GET `/api/shipments/:id/risk`, GET `/api/risk/overview` |
| Decisions | GET/POST `/api/recommendations`, POST `/api/recommendations/:id/decision` |
| Audit | GET `/api/audit` |
| Bob | POST `/api/bob/query` |

Full API contract: `docs/phase-0/api-contract.md`

## Bob Integration

The MCP server exposes 11 read-only tools over the REST API via stdio transport. Bob is invoked by the backend proxy when `BOB_ENABLED=true`. The dashboard is fully functional with `BOB_ENABLED=false` (the default); the chat panel (S13) shows an explicit fallback state.

IBM Bob credentials are required for the live chat path. Without credentials, the tool layer and grounding evidence are demonstrable directly via `npm run smoke` in `src/mcp-server/`.

MCP tools: `get_active_disruptions`, `get_affected_shipments`, `get_route_alternatives`, `get_carrier_alternatives`, `get_idle_assets`, `get_redeployment_candidates`, `get_sensor_status`, `get_temperature_excursions`, `get_combined_risk`, `get_risk_overview`, `get_audit_log`.

## Testing

```bash
cd src/backend && npm test                                           # 147/147
cd src/frontend && npm test                                          # 49/49
cd src/data-generator && python -m unittest discover -s tests -t .  # 48/48
cd src/data-generator && python validate.py                          # PASS
cd src/backend && node scripts/verify-seed.js                       # 15/15 + 14/14
cd src/mcp-server && npm run smoke                                  # 7/7 (backend running)
```

## Demo

- **Video:** `demo/demo-video-link.txt` *(to be completed at submission time)*
- **Screenshots:** `demo/screenshots/` *(to be captured before submission)*
- **Live demo:** NOT DEPLOYED — local only

Demo runbook (after `npm run dev` in both `src/backend` and `src/frontend`):

1. **Logistics flow:** S2 → create a disruption → S3 affected shipments → S4 shipment detail → S5 route/carrier alternatives → create and approve a recommendation → S14 audit trail.
2. **Cold-chain flow:** S8 cold-chain monitoring → S10 excursion detail → acknowledge → S9 temperature history → S11 sensor health.
3. **Risk overview:** S1 ranked worklist with S039 combined score 0.728.
4. **Bob:** S13 — either grounded answer with evidence (if `BOB_ENABLED=true`) or documented fallback banner (if disabled).
5. **MCP grounding:** `cd src/mcp-server && npm run smoke` — prints tool evidence from the live backend.
6. **Reset:** `cd src/backend && npm run seed` — restores the exact fixture baseline.

## Known Limitations

- **Synthetic data only.** No real shipment, carrier, sensor, or regulatory dataset is used or claimed.
- **No ML.** All logic is deterministic rules and transparent weighted scoring. ML is explicitly deferred.
- **Policy thresholds are illustrative.** Temperature policy values are configurable placeholders, not regulatory benchmarks.
- **Bob grounding reduces but does not eliminate hallucination risk.** Tool-only answers and visible evidence mitigate this, but live Bob behavior requires active credentials to verify fully.
- **Single trusted operator.** No authentication, authorization, or multi-tenant isolation.
- **Local-only deployment.** No cloud hosting or public URL.
- **Sensor feeds age out.** After the fixture anchor (+6 h), cold shipments show sensor-failure banners. Run the simulator (`node scripts/simulate-feed.js`) to refresh, or `npm run seed` to reset.
- **Region-code matching.** Disruption–shipment matching uses string region codes, not geographic polygons.
- **Post-delivery excursion records (F3) deferred.** Post-delivery breach exclusion is implemented and tested; the stored history record (`post_delivery: true`) is not yet emitted.

## What We Are Most Proud Of

- **Combined disruption + cold-chain priority engine** — the `combined_score` oracle (S039 = 0.728) is asserted identically across REST, MCP tool, stdio server, and grounding smoke.
- **Explainable recommendations with rejected alternatives** — every score is decomposable into factors on screen; every rejected option shows the constraint that failed.
- **Grounded Bob evidence** — raw tool JSON always visible beside answers; any mismatch is immediately visible to the operator.
- **Cross-language ground truth** — 48 Python ground-truth scenarios verified against the JS services by `verify-seed.js`; the oracle is reproducible with a fixed seed.
- **Full state coverage in the frontend** — every screen handles loading, empty, validation error, unexpected error, 503 Bob fallback, unknown/review, not-actionable, and conflict states.

## Documentation

- Problem statement: `docs/problem-statement.md`
- Solution overview: `docs/solution-overview.md`
- Architecture: `docs/architecture.md`
- Setup guide: `docs/setup-guide.md`
- API contract: `docs/phase-0/api-contract.md`
- Data contract: `docs/phase-0/data-contract.md`
- Frozen scope: `docs/phase-0/scope-freeze.md`
- Phase reports: `docs/PHASE_*.md`
