# Phase 5 — UI Implementation Report

**Project:** ChainSentinel — L2 Supply Chain Disruption Assistant & Fleet Utilisation Optimizer
**Date:** 2026-09-15
**Scope executed:** the approved plan `docs/PHASE_5_SCOPE_AND_PLAN.md` (A1–A7 approved)
**Backend/MCP/generator/data changes:** **none** (frontend-only phase, verified by timestamps)

---

## 1. F1 — Vite `/api` proxy (verified live)

- `src/frontend/vite.config.js` proxies `/api` → `http://localhost:3001` (changeOrigin).
- Live evidence with both servers running:
  - `GET http://localhost:5173/api/health` → `{"status":"ok","database":"up","bob":"disabled",...}`
  - `GET http://localhost:5173/api/shipments/S039/risk` → `combined_score: 0.728` (ground-truth oracle)
  - `GET http://localhost:5173/` → HTTP 200 with the ChainSentinel page
- No CORS configuration, no frontend `.env`, no credentials (guard-checked).

---

## 2. Screens completed (S1–S14)

| Screen | Route | Key endpoints | States implemented |
|---|---|---|---|
| S1 Overview | `/` | `risk/overview` (30 s poll), `disruptions?status=active`, `alerts/coldchain` | loading, empty (no risk / no disruptions), error |
| S2 Disruptions | `/disruptions` | `disruptions` GET/POST/PATCH | loading, empty, error, field-level validation, 409 duplicate/invalid transition toast |
| S3 Affected shipments | `/disruptions/:id/affected` | `affected-shipments` | loading, valid-no-impact empty, error, unknown-review + timing-unknown chips |
| S4 Shipment detail | `/shipments/:id` | `shipments/:id`, `risk`, `sensor-readings`, `recommendations`, `audit` | per-tab loading/empty/error, delivered read-only banner |
| S5 Alternatives | `/shipments/:id/alternatives` | route/carrier alternatives, `recommendations` create + decision | card skeleton, no-option + grouped reasons, rejected panel, 409 refresh, not-actionable |
| S6 Fleet | `/fleet` | `fleet`, `fleet/idle` | skeleton, empty, error, anomaly chips, excluded panel |
| S7 Redeployment | `/shipments/:id/redeployment` | `redeployment-candidates`, `fleet/redeployments/recommend` | skeleton, no-option, contention banner, rejected/excluded, 409 refresh |
| S8 Cold-chain | `/coldchain` | `alerts/coldchain` (30 s poll), `shipments?is_cold_chain`, policies GET/PUT | skeleton, empty, error, unknown/review, sensor-failure banner, policy editor (D7) |
| S9 Temperature history | `/shipments/:id/temperature` | `sensor-readings`, `excursions?shipment_id` | chart skeleton, no readings, sensor-failed review banner, excursion overlay from backend records |
| S10 Excursion detail | `/excursions/:id` | `excursions` (list lookup), `excursions/:id` PATCH | loading, not-found, unknown/review rationale, 409/400 review errors |
| S11 Sensor health | `/sensors` | `shipments?is_cold_chain` + per-shipment sensor block | skeleton, empty, error, failed/unknown review banner |
| S12 Risk explanation | `/shipments/:id/risk` | `shipments/:id/risk` | loading, error, human-review banner, RC-3 factor table |
| S13 Bob chat | `/chat` | `bob/query` | typing, **503 fallback (first-class)**, validation errors, answer + evidence panel |
| S14 Audit | `/audit` | `audit` (filters + order) | skeleton, empty, error, expandable details |

**Field-level screen→endpoint mapping:** unchanged from the approved plan §4; verified by 31 screen tests against contract-shaped fixtures.

---

## 3. Foundation delivered

| Area | Files |
|---|---|
| API client | `src/api/client.js` (query builder, JSON, network→ApiError), `src/api/ApiError.js` (validation/not-found/conflict/Bob/server classifiers), `src/api/endpoints.js` (one pass-through wrapper per frozen endpoint) |
| Hooks | `src/hooks/useApi.js` (loading/error/refresh), `src/hooks/usePolling.js` (30 s, hidden-tab aware) |
| Utils | `src/utils/format.js` (display formatting only) |
| Shared components | `components/layout.jsx` (AppShell, nav, PageHeader, Card, Tabs, filters, refresh), `components/states.jsx` (skeleton, empty, error, banners, field errors, toast), `components/display.jsx` (StatusBadge, ScoreBar, FactorList, ReasonList, MetricCard, JsonViewer, EvidencePanel, DataTable), `components/domain.jsx` (DisruptionForm, DecisionButtons, ExcursionReviewActions, PolicyEditor, RiskFactorTable, TemperatureChart, RedeploymentCard) |
| Routing | `src/App.jsx` (React Router, 14 screens + not-found), `src/main.jsx` |
| Styles | `styles/tokens.css`, `styles/layout.css`, `styles/components.css` |

**Implementation note:** the plan listed individual component files; components were consolidated into four modules (`layout`, `states`, `display`, `domain`) for reviewability. No behavioural deviation.

---

## 4. Constraint compliance

| Constraint | Result |
|---|---|
| Only the frozen REST API | PASS — every call goes through `api/endpoints.js`; no other origin is referenced |
| No mock data in the running app | PASS — fixtures exist only under `src/frontend/test/` |
| No new backend endpoints | PASS — backend untouched (timestamp-verified) |
| No backend/MCP/generator/fixture/contract/reference changes | PASS — all timestamps unchanged since Phase 4 |
| No duplicated formulas | PASS — `no-formulas.test.js` scans for weights (0.35/0.45), `SEVERITY_WEIGHTS`, score/duration assignments; all match-free |
| No ML | PASS — no ML dependency or code |
| No secrets / no frontend `.env` | PASS — no `.env` files; no `process.env`; no credential names (scanned) |
| Backend-provided scores/factors/reasons/evidence/statuses | PASS — 31 screen tests assert verbatim rendering; S12 renders RC-3 factors as returned |
| Bob 503 first-class fallback | PASS — S13 shows the fallback banner, disables input, never fabricates answers |
| F2–F8 kept out of scope | PASS — only F1 addressed; F2 surfaced as an informational state, not fixed |

---

## 5. Tests and verification

| Check | Command | Result |
|---|---|---|
| Frontend tests | `npm test` (in `src/frontend`) | **49/49 pass** (client 6, components 10, screens-logistics 11, screens-coldchain 8, screens-shared 6, safety scan 8 assertions) |
| Production build | `npm run build` | PASS (built in ~6 s; chunk-size warning only — Recharts) |
| F1 live proxy | curl via `:5173` | health JSON + ground-truth risk 0.728 + HTML 200 |
| Backend tests | `npm test` (in `src/backend`) | **144/144 pass** |
| Cross-language oracle | `node scripts/verify-seed.js` | matching 15/15 · excursions 14/14 |
| Python generator + validator | `python -m unittest discover` · `python validate.py` | 48/48 OK · validator PASS |
| Untouched check | timestamps under `src/backend`, `src/mcp-server`, `src/data-generator`, `data/` | no modifications during Phase 5 |
| Secrets check | `.env` scan + `no-formulas` credential scan | clean |

---

## 6. Files created / modified

**Created (config + app):** `vite.config.js` · `src/App.jsx` · `src/main.jsx` (rewritten from placeholder)
**Created (api/hooks/utils):** `src/api/client.js` · `ApiError.js` · `endpoints.js` · `src/hooks/useApi.js` · `usePolling.js` · `src/utils/format.js`
**Created (components):** `src/components/layout.jsx` · `states.jsx` · `display.jsx` · `domain.jsx`
**Created (screens, 14):** `Overview`, `Disruptions`, `AffectedShipments`, `ShipmentDetail`, `Alternatives`, `Fleet`, `Redeployment`, `ColdChain`, `TemperatureHistory`, `ExcursionDetail`, `SensorHealth`, `RiskExplanation`, `BobChat`, `Audit`
**Created (styles):** `tokens.css` · `layout.css` · `components.css`
**Created (tests):** `test/setup.js` · `test/mockFetch.js` · `test/fixtures.js` · `test/renderAt.jsx` · `test/screens-logistics.test.jsx` · `test/screens-coldchain.test.jsx` · `test/screens-shared.test.jsx` · `src/api/client.test.js` · `src/api/no-formulas.test.js` · `src/components/components.test.jsx`
**Modified:** `package.json` (scripts + dev-only test deps, A1) · `index.html` (title) · `README.md`
**Untouched:** everything under `src/backend`, `src/mcp-server`, `src/data-generator`, `data/`, `docs/phase-0/` contracts, reference files

---

## 7. Scope / contract issues encountered

| # | Issue | Resolution |
|---|---|---|
| 1 | Plan referenced `docs/PHASE_1_SYSTEM_DESIGN.md`; the file is at the repo root | Path corrected in the plan document |
| 2 | Design §8 mentions `GET /api/excursions/:id`, which is not a frozen endpoint | S10 resolves the record from `GET /api/excursions` (approval item A3, no backend change) |
| 3 | Component files consolidated (4 modules instead of ~25 files in the plan's "likely" list) | Implementation detail; no behavioural deviation |
| 4 | `dist/` build artifact created locally | Covered by `.gitignore` (`dist/`); not committed |

No backend or frozen-contract change was ever required.

---

## 8. Known issues (non-blocking, out of Phase 5 scope)

| # | Item | Notes |
|---|---|---|
| 1 | Historical fixtures age out → cold-chain screens show sensor-failure banners (F2) | Correct backend state; demo-day regeneration or simulator run is Phase 7 work |
| 2 | S11 performs one sensor-block call per cold shipment (≈23) | Phase 6 performance candidate (would need a new endpoint — out of scope) |
| 3 | React `act()` warning in the S8 polling test | Test-output noise only; test passes deterministically |
| 4 | Bundle size warning (>500 kB) | Recharts; acceptable for local demo, code-splitting is a Phase 6/8 nicety |

---

## 9. Status

Phase 5 implementation is complete: F1 verified live, all 14 screens built on the frozen API with the full state matrix, 49 frontend tests plus the no-formulas/secret scans green, backend invariants (144 tests, oracle, validator) untouched and green. Remaining Phase 5 work: none. Phase 6 (integration) is **not** started.
