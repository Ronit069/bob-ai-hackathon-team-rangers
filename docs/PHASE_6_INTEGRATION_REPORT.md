# Phase 6 — Integration Report

**Project:** ChainSentinel — L2 Supply Chain Disruption Assistant & Fleet Utilisation Optimizer
**Date:** 2026-09-15
**Scope executed:** `docs/PHASE_6_SCOPE_AND_PLAN.md` (A1–A7 approved)
**Status:** PHASE_6_COMPLETE — all required verification checks pass; live walkthrough PASS; next milestone: PHASE_7_SCOPE_REVIEW_PENDING.

---

## 1. Milestone summary

| Item | Result |
|---|---|
| F2 feed simulator | `src/backend/scripts/simulate-feed.js` implemented + documented; verified live (S030 failed → reporting, failure alert 1 → 0, fixtures untouched, oracle uncorrupted) |
| F5 write-throttling | Implemented in `risk/routes.js` + `coldchain/evaluation.js`; response values/formulas identical; writes throttled (second overview call: 0 new snapshots); one integration defect found + fixed (see §7) |
| F8 unknown-route 404 | Catch-all returns 404 `NOT_FOUND`; test + docs updated; valid routes unchanged |
| MCP grounding smoke | `npm run smoke` → 7/7 checks (oracle-grounded 0.728, read-only, no DB dependency) |
| Full verification | Backend 147/147 · Frontend 49/49 · Python 48/48 · validator PASS · verify-seed 15/15 + 14/14 · sweep 28/28 · 0×501 · 0 unexpected 5xx · Bob 503 · seed hashes identical |
| Live walkthrough | PASS after the F5 fix (all 14 screens' request sequences answered as expected) |

---

## 2. Scope completed

- **F2 (approved A3):** demo freshness simulator over the existing ingestion endpoint; no new endpoint; no fixture/data change.
- **F5 (approved A1):** write-throttling in the two approved modules only; change is write-frequency-only; all formulas, scores and semantics preserved.
- **F8 (approved A2):** unknown `/api/*` paths now return 404 instead of the obsolete 501 placeholder.
- **MCP grounding smoke (approved A4):** `src/mcp-server/scripts/smoke.js` + `npm run smoke`.
- **Verification plan (plan §5–§8):** suites, endpoint sweep, 5xx check, Bob fallback, MCP read-only, seed hashes, ML/secrets/formula scans, live walkthrough.
- **Deferred as approved:** F3 (A5, not implemented), F6 MCP transport (A6, untouched), frontend performance/new endpoints (A7, untouched), F4 live Bob (conditional on Q6).

## 3. Files changed

| File | Change |
|---|---|
| `src/backend/scripts/simulate-feed.js` | **New.** Demo freshness simulator (F2). Bounded CLI, 10 s HTTP timeouts, fails fast when backend is down, exits cleanly. |
| `src/backend/src/coldchain/repository.js` | Added `listReadingFingerprints` + `listExcursionFingerprints` (throttle keys; no schema change). |
| `src/backend/src/coldchain/evaluation.js` | `refreshExcursions` memoized on a readings + policy + persisted-excursion fingerprint; skips repeat evaluation only. |
| `src/backend/src/risk/routes.js` | Snapshot write-throttle: insert only when the recomputed assessment differs from the latest stored one; response always carries fresh values. |
| `src/backend/src/common/http.js` | `notImplementedHandler` → `unknownRouteHandler` returning 404 `NOT_FOUND`. |
| `src/backend/src/app.js` | Catch-all wired to the 404 handler. |
| `src/backend/test/api-shared.test.js` | +1 test: overview snapshot throttle (0 new rows on repeat, fresh values returned). |
| `src/backend/test/api-coldchain.test.js` | +2 tests: evaluation throttle (re-evaluates on new reading, skips unchanged); external-reseed memo invalidation (regression for §7). |
| `src/backend/test/api-logistics.test.js` | Unknown-path test now asserts 404 `NOT_FOUND`; header comment updated. |
| `src/backend/README.md`, `src/backend/scripts/README.md` | Current status/scripts; simulator usage + demo-freshness documentation. |
| `src/mcp-server/scripts/smoke.js` | **New.** Grounding smoke test (spawns stdio server as Bob would). |
| `src/mcp-server/package.json` | `"smoke": "node scripts/smoke.js"` script added. |
| `src/mcp-server/README.md` | Status + smoke-test section. |

## 4. Files intentionally not changed

`src/data-generator/**` · `data/seed/**` · `docs/phase-0/**` (frozen contracts) · `src/frontend/**` (no feature/performance work) · `src/mcp-server/src/**` (transport + tool layer untouched) · `src/backend/src/coldchain/excursion.service.js` (F3 not implemented) · migrations/schema · `package.json` dependencies (no new deps).
Verified: no file under those paths was modified after Phase 6 started (13:23 local, when the plan was written).

## 5. F2 — feed simulator

**What it does:** appends current, in-policy sensor readings for one cold-chain shipment through the existing ingestion endpoint `POST /api/sensor-readings` (endpoint 12). No new endpoint, no server change, no fixture/ground-truth write.

**Usage** (backend running):

```bash
node scripts/simulate-feed.js                       # default S030, 90 min, 15-min interval
node scripts/simulate-feed.js --shipment=S030 --minutes=120 --interval=15 --base-url=http://localhost:3001
```

**Required configuration:** backend reachable at `--base-url` (default `http://localhost:3001`); the shipment must be cold-chain with a temperature policy. No env vars or credentials.

**Safety properties:** every HTTP call has a 10 s timeout; fails fast and clearly if the backend is unavailable; generation is bounded (no infinite loops — count derived from `--minutes/--interval`); temperatures stay inside the policy band so no excursion is created or modified; process exits cleanly with a summary.

**Effect on demo freshness:** the seeded feeds end at fixture anchor +6 h; after that every cold shipment shows a `sensor_failure` alert. Running the simulator flips the chosen shipment's sensor status to `reporting` and clears its failure alert; other shipments (including the deliberate S031 failure) keep their state.

**Stop/reset:** run `npm run seed` (truncate + reload — restores the exact fixture baseline and re-stales feeds); Ctrl+C/exit is safe at any point (the script writes only reading rows).

**Verified live:** S030 `failed → reporting`, `sensor_failure` alerts `1 → 0`, S031 deliberate failure retained, `0` rejected readings, `verify-seed` still PASS (15/15 + 14/14) after the simulator run.

## 6. F5 — write-throttling

**Cold-chain (`coldchain/evaluation.js`):** a process-local memo keyed by `reading count | latest reading timestamp | policy id|version | persisted-excursion count | newest detection time`. When nothing changed, detection is skipped (saving reads, detection and idempotent UPDATEs). Any new reading, policy version, or excursion-state change invalidates the key.

**Risk (`risk/routes.js`):** `GET /api/shipments/:id/risk?refresh=true` and `GET /api/risk/overview` still compute every assessment with the frozen formulas; a snapshot row is inserted only when the fresh score/factors differ from the latest stored snapshot (`stableStringify` deep-compare that is immune to PostgreSQL jsonb key reordering). The response always carries the freshly computed values.

**Proof that responses/formulas/scores are unchanged:**
- Backend suite 147/147 including all ground-truth/oracle tests (S039 combined 0.728, overview ranking, `refresh=false` snapshot read) — **no assertion values changed**.
- Live: consecutive `/api/risk/overview` calls returned identical bodies while `risk_assessment` rows went `48 → 93 → 93` (second call inserted 0).
- Live: `/api/excursions` twice → `temperature_excursion` rows `14 → 14` (no churn) and identical 14-row ground-truth set.
- `verify-seed` 15/15 matching + 14/14 excursions before and after the change.
- No request/response shape, status code, or error behavior changed (validated by the 147-test suite + live sweep).

## 7. Defect found during integration (fixed)

**Symptom:** after `npm run seed` with the backend still running, cold-chain state went stale: S039 risk returned 0.428 instead of 0.728 and excursion alerts disappeared — because the process-local memo matched the (deterministic) fixture fingerprint and skipped re-detection against a freshly truncated database.

**Fix:** the memo key now includes the persisted-excursion fingerprint (`count + max(detected_at)`), so any external reset/delete invalidates it; regression test added (`external reseed invalidates the evaluation memo`). The walkthrough then reproduced the documented demo workflow (reseed + continue) and passed with the correct 0.728.

## 8. F8 — unknown-route behavior

`GET /api/does-not-exist` → `404 {"error":{"code":"NOT_FOUND","message":"Unknown API endpoint"}}` (was 501/`NOT_IMPLEMENTED`). Nested unknown id `GET /api/excursions/EX-9999` → 404. All 28 valid endpoints verified unchanged (sweep §11). Updated: `common/http.js`, `app.js`, `test/api-logistics.test.js`, `src/backend/README.md`.

## 9. MCP grounding smoke results

`npm run smoke` (backend at `:3001`), run twice (both 7/7 PASS):

```
PASS  tool layer sends GET requests only
PASS  no database dependency in the MCP server — no pg import, no DATABASE_URL, no pool construction
PASS  server handshake — chainsentinel-mcp
PASS  tools/list exposes exactly the 11 frozen tools — 11 tools
PASS  get_combined_risk(S039) is grounded in the oracle
      evidence: combined=0.728 disruption=0.856 coldchain=0.6 worst_excursion=EX-0014 weights={alpha:0.5,beta:0.5}
PASS  get_active_disruptions returns live rows — 3 active disruptions
PASS  get_affected_shipments(D01) carries match evidence — 10 shipments, S039 impact=critical
```

Read-only confirmed statically (no `POST/PUT/PATCH/DELETE` in the tool layer; `method: "GET"` only) and by the existing `tools are read-only` suite test. Tool outputs are grounded in backend rows and the ground-truth oracle. MCP transport (`src/mcp-server/src/index.js`) not modified.

## 10. Test commands and exact results

| # | Command (working dir) | Result |
|---|---|---|
| 1 | `npm test` (`src/backend`) | **147/147 pass, 0 fail** (144 baseline + 2 F5 tests + 1 reseed regression test) |
| 2 | `npm test` (`src/frontend`) | **49/49 pass** (6 files; unchanged baseline) |
| 3 | `python -m unittest discover -s tests -t .` (`src/data-generator`) | **48 tests, OK** |
| 4 | `python validate.py` (`src/data-generator`) | **PASS** — scenarios=48 matching=15 excursions=14 readings=2201 |
| 5 | `node scripts/verify-seed.js` (`src/backend`) | **matching PASS 15/15 · excursions PASS 14/14** (run twice: clean + after simulator) |
| 6 | `npm run smoke` (`src/mcp-server`) | **7/7 checks pass** |
| 7 | Smoke = 28-endpoint sweep script through the Vite proxy (`:5173`) | 31 calls · 28/28 endpoints · 0×501 · 0 unexpected 5xx · 0 failures |
| 8 | Demo walkthrough script through the proxy | **PASS** (see §12) |
| 9 | Seed SHA-256 before/after (`docs/PHASE_6_SEED_HASHES_*.txt`) | **IDENTICAL** (3 files) |
| 10 | ML / secrets / formula-duplication scans | **Clean** (no ML refs; no `.env`; no hardcoded credentials; frontend no-formulas scan green) |
| 11 | F5 live DB checks (psql counts) | snapshots `48 → 93 → 93`; excursions `14 → 14` |
| 12 | Error-state check (bounded) | backend down → proxy `/api/health` HTTP 500 in 0.13 s, frontend page still 200; after restart health 200 in 0.06 s |

Backend count change explanation: 144 → 147 = +2 new F5 throttle tests + 1 external-reseed regression test.

## 11. Endpoint sweep (through the Vite proxy)

All 28 endpoints exercised with valid inputs: **0 × 501, 0 unexpected 5xx, 0 expectation failures.** Highlights: create/patch disruption (201/200), affected shipments, shipment detail, both alternative types, fleet/idle, redeployment candidates, ingestion (201), readings/quality, excursions, alerts, policies GET/PUT, shipment risk 0.728, overview, recommendation create/decide (201/200), fleet redeployment recommend (201), fleet/carriers/audit, excursion review PATCH (200). Bob = expected 503. A first sweep attempt used a newly created disruption before creating the recommendation, and the eligibility rule correctly returned 409 (`target_not_eligible`) — recorded as designed behavior, not a defect; the sweep now exercises creation flows before injecting a disruption.

## 12. Live walkthrough results

Executed through the Vite proxy (the exact requests the screens issue) against the running backend, after the F5 fix, from a clean seed:

| Screen | Evidence |
|---|---|
| App shell | HTTP 200, `ChainSentinel` present |
| S1 Overview | 25 ranked rows, top S039 0.728 (= baseline), 3 active disruptions, 37 alerts |
| S2 Disruptions | create 201 (`D06`), duplicate create 409 `CONFLICT` |
| S3 Affected | 1 affected row for D06 (unknown_review surfaced) |
| S4 Shipment detail | S039 in_transit/cold; risk 0.728; 97 readings; tabs (recs/audit) answered |
| S5 Alternatives | S040 route options 1 (rejected 1); S006 carrier rejections 8; decision → accepted |
| S6/S7 Fleet | fleet 24 (idle 16); S015 redeployment 2 (rejected 14) |
| S8→S10→S9→S11 | 37 alerts (14 excursions); `EX-0012` acknowledged; 97 readings with policy 2..8; sensor health rendered |
| S12 Risk explanation | severity major · confidence high · action "Review and consider intervention" (from backend factors) |
| S13 Bob | HTTP 503 `BOB_UNAVAILABLE` (reason `bob_disabled`) — safe first-class fallback |
| S14 Audit | audit rows present, newest action `acknowledged` (temperature_excursion) |

Bounded requests only (10 s timeouts); the run completed end-to-end with no hangs. The first attempt stopped on a walkthrough-script ordering bug (the duplicate check needs an active disruption), and the second exposed the §7 memo defect; the final run after the fix is the reference evidence.

## 13. Process hygiene

| Item | Value |
|---|---|
| Backend | PID 47888, port 3001, health 200, stdout `ChainSentinel backend listening on 3001 (Phase 3)`, stderr empty |
| Frontend (Vite) | port 5173, page HTTP 200 |
| Logs | `%TEMP%\opencode\p6-backend3.{out,err}.log`, `p6-frontend.{out,err}.log` |
| Duplicate instances | none — backend restarted only at the explicit F5-fix step and after the error-state check |
| Cleanup | dev servers stopped after verification (restart: `npm run dev` in `src/backend`, `npm run dev` in `src/frontend`) |

## 14. Limitations, warnings, follow-up

1. **Historical feeds stale by design:** without the simulator, all cold shipments show `sensor_failure` (expected behavior of the frozen staleness rule). Demo runbook: start backend → optional `node scripts/simulate-feed.js` → demo; `npm run seed` to reset.
2. **Throttle memo is process-local:** a restart simply re-evaluates once (idempotent). No shared cache introduced.
3. **MCP remains stdio-only (F6)** — no transport change; conditional on Q6.
4. **Bob live path untested (F4)** — no credentials; the 503 fallback is verified and safe.
5. **S11 still issues one sensor call per cold shipment** (would need a new endpoint to aggregate — out of scope).
6. **Frontend bundle-size warning** (Recharts) — untouched by Phase 6.
7. **F3 post-delivery records not implemented** (approved deferral; requires a data decision).
8. **Verification scripts** (sweep/walkthrough) were temporary test tooling outside the repo; the durable artifacts are the suites, the simulator, and the smoke test.

## 15. Constraint confirmations

- **F3 NOT implemented** — `excursion.service.js` untouched (last modified before Phase 6).
- **Fixtures NOT regenerated/modified; ground truth unchanged** — SHA-256 before/after IDENTICAL; `data/` untouched.
- **No new REST endpoints** — 28 endpoints only; simulator/smoke use existing interfaces.
- **No frozen contract changes** — `docs/phase-0/**` untouched; response shapes unchanged.
- **MCP transport NOT modified** — `src/mcp-server/src/**` untouched; tools remain GET-only/read-only.
- **No frontend changes** — features and performance untouched.
- **No ML additions, no secrets, no duplicated formulas** — scans clean.
- **Phase 3–5 invariants preserved** — 28 endpoints functional, 0 unexpected 5xx, Bob 503 fallback safe, oracle values (S039 0.728) unchanged, seed ground truth identical.

---

## 16. Status

**Phase 6 (Integration) is complete.** F2 (feed simulator), F5 (write-throttling), F8 (unknown-route 404) and the MCP grounding smoke are implemented, documented and verified. All required checks pass: backend 147/147, frontend 49/49, Python 48/48, validator PASS, verify-seed 15/15 + 14/14, 28-endpoint sweep with 0×501 and 0 unexpected 5xx, Bob 503 fallback, MCP read-only, seed SHA-256 identical, and the bounded live walkthrough PASS. No new REST endpoints, no frozen-contract changes, no MCP transport changes, no fixture/ground-truth changes (F3 not implemented). Phase 7 (Testing: domain suites + 25-scenario matrix) is not started.

```
PHASE_6_COMPLETE
PHASE_7_SCOPE_REVIEW_PENDING
```
