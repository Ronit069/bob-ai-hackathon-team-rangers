# Phase 6 — Scope and Implementation Plan (Integration)

**Status: PLAN ONLY — awaiting review and approval. No code has been modified.**
**Date:** 2026-09-15
**Inputs read:** `PHASE_1_SYSTEM_DESIGN.md` (§16 phases), `docs/PHASE_2_*`, `docs/PHASE_3_*` (findings F1–F8), `docs/PHASE_4_*`, `docs/PHASE_5_SCOPE_AND_PLAN.md`, `docs/PHASE_5_UI_REPORT.md`
**Phase 6 mandate (design §16):** Integration — full flow *disruption → recommendation → decision*; gate: **live E2E works**. This plan additionally triages the deferred findings (F2, F3, F5, F6, F8) and the candidate work areas requested (frontend performance, API refresh behavior, data freshness, demo reliability, grounding/evidence presentation).

---

## 1. Decision summary

| # | Finding / candidate | Recommendation | Backend / contract change? | Approval |
|---|---|---|---|---|
| F2 | Stale seeded feeds | **Phase 6 (partial)** — simulator script; regeneration workflow verified but *not* executed (fixtures untouched) | No backend change; new additive script; fixtures unchanged | A3 |
| F3 | Post-delivery records not emitted | **Deferred (Phase 7, conditional)** — requires coordinated JS+Python+ground-truth change and an explicit data decision | Yes (behavior + data) | A5 |
| F5 | Refresh/snapshot costs | **Phase 6 (recommended)** — write-throttling; responses byte-identical | Yes (fewer writes, no shape change) | A1 |
| F6 | stdio-only MCP transport | **Conditional** — no action until Q6 (Bob access) is answered | Only if triggered | A6 |
| F8 | Unknown path 501 vs 404 | **Phase 6 (recommended)** — replace 501 catch-all with 404 | Yes (unspecified-path behavior only) | A2 |
| — | Frontend performance (bundle, S11 N+1) | **Out of scope** (documented; optional Phase 7 polish) | No | A7 |
| — | API refresh behavior | Folded into F5; no caching layer, no new endpoints | N/A | A1 |
| — | Data freshness | Covered by F2 | — | A3 |
| — | Demo reliability | **Phase 6 core** — live walkthrough + integration report + gap fixes | Frontend-only unless separately approved | — |
| — | Grounding/evidence presentation | **Phase 6 (recommended)** — MCP smoke/demo script (offline grounding demo) | No backend change; new additive script | A4 |
| F4 | Bob live path untested | Conditional on Q6; default remains the safe 503 fallback | No | (with A6) |
| F7 | Report test-count drift | Phase 7 docs pass | No | — |

---

## 2. Finding triage (required elements per item)

### F2 — Stale seeded feeds

1. **Original finding:** Seeded sensor feeds end at the fixture anchor +6 h. After that, the frozen failure rule (stale > 4× interval) marks *every* cold shipment as sensor-failed; only the deliberate S031 fixture failure is meant to show.
2. **User/demo impact:** On demo day the cold-chain screens fill with sensor-failure banners, hiding the reporting/short-gap scenarios and looking like a broken pipeline. The intended live demo path is posting fresh readings through the ingestion endpoint (endpoint 12).
3. **Files/modules that would change:**
   - NEW: `src/backend/scripts/simulate-feed.js` (additive; posts readings via the existing `POST /api/sensor-readings` endpoint — no server change).
   - Existing, unchanged: `src/data-generator/generate.py` (`--now` already supported), `src/backend/scripts/seed.js`.
   - Docs: Phase 6/7 setup guide section (demo-day runbook).
4. **Scope decision:** **Phase 6 (recommended, partial).** Build + verify the simulator (A3). The alternative — regenerating fixtures with a current `--now` — **changes the seed ground truth** and is therefore *not* executed now; it stays a documented Phase 7 demo-day option requiring an explicit data decision.
5. **Acceptance criteria and verification:**
   - `node scripts/simulate-feed.js --shipment S026 --count 6` posts six current readings; S026 flips `sensor_status` from failure → reporting; its sensor-failure alert clears; the deliberate S031 failure remains.
   - `data/seed/*` file hashes unchanged (SHA-256 before/after); `node scripts/verify-seed.js` still 15/15 + 14/14; backend 144/144; no new 5xx.
   - Commands: simulator CLI above; `Get-FileHash data/seed/*`; `node scripts/verify-seed.js`; `npm test` (backend).
6. **Frozen contract / backend behavior:** **None.** The simulator only *uses* endpoint 12; fixtures and ground truth are untouched.

### F3 — Post-delivery records

1. **Original finding:** Readings at/after the delivery cutoff are excluded from evaluation (correct), but a breach occurring entirely after delivery is not emitted as a `post_delivery` excursion record, although the design intent says it is "logged as post-delivery and excluded".
2. **User/demo impact:** Low. Scenario SCN-115 already demonstrates "post-delivery excluded" (no live alert for S035). The missing record is a history/completeness gap invisible in the MVP demo.
3. **Files/modules that would change (if ever approved):**
   - `src/backend/src/coldchain/excursion.service.js` (emit post-cutoff breaches with `post_delivery: true`).
   - `src/data-generator/chainsentinel/groundtruth.py` (mirror detection) + `src/data-generator/validate.py`.
   - Ground truth fixtures under `data/seed/` (regenerated) — **data decision**.
   - Tests: `src/backend/test/services.test.js`, `test/api-coldchain.test.js`, `test/e2e-flow.test.js`.
4. **Scope decision:** **Deferred — Phase 7 (optional), conditional on an explicit data decision.** Rationale: the fix spans JS detection + Python mirror + regenerated ground truth + three test files for marginal demo value, and it directly risks invariant I7 (seed ground truth unchanged). The current behavior is documented as intentional scope.
5. **Acceptance criteria (only if later approved):** S035-style post-delivery breaches produce records flagged `post_delivery: true`, excluded from `active_only` alerts; `verify-seed.js`, `validate.py` and both language suites pass with regenerated ground truth.
6. **Frozen contract / backend behavior:** Yes — detection behavior changes and ground truth is regenerated. Requires the explicit data decision before any work.

### F5 — Refresh/snapshot costs

1. **Original finding:** (a) Unfiltered `GET /api/excursions` re-runs detection for every cold shipment per call; (b) `GET /api/risk/overview` inserts one `risk_assessment` snapshot row per actionable shipment per call (~40 rows/call ≈ 4,800 rows/h at the S1 30 s poll). See `src/backend/src/coldchain/evaluation.js:10` and `src/backend/src/risk/routes.js:121`.
2. **User/demo impact:** No visible breakage at demo scale, but redundant CPU/DB work on every poll and unbounded snapshot growth over a long demo or repeated rehearsals.
3. **Files/modules that would change:**
   - `src/backend/src/risk/routes.js` — skip the snapshot insert when the freshly computed score + factors deep-equal the latest snapshot; the response always returns the fresh value (shape unchanged).
   - `src/backend/src/coldchain/evaluation.js` — process-local memo: skip re-evaluation when a shipment's latest reading timestamp is unchanged since the last evaluation.
   - (Optional) `src/backend/src/common/config.js` — named constant for any throttle window.
   - Tests: `src/backend/test/api-shared.test.js`, `test/api-coldchain.test.js`.
4. **Scope decision:** **Phase 6 (recommended, A1).** Small, response-preserving hardening consistent with the integration/hardening character of this phase.
5. **Acceptance criteria and verification:**
   - Two consecutive identical `GET /api/risk/overview` calls: second call adds **0** new snapshot rows (`SELECT count(*)` before/after) and returns an identical body.
   - Unfiltered `GET /api/excursions` twice: second call performs 0 re-evaluations when no readings changed; a new reading triggers exactly one re-evaluation.
   - All 144 backend tests, the S039 0.728 oracle, `verify-seed.js`, and the live JSON shapes are unchanged.
   - Commands: `npm test` (backend); `node scripts/verify-seed.js`; the two-call SQL/curl check above; F1 proxy re-check.
6. **Frozen contract / backend behavior:** Response contract unchanged; write behavior changes (fewer snapshots/evaluations). **Requires approval** (A1).

### F6 — stdio-only MCP transport

1. **Original finding:** The MCP server speaks stdio only (decision D3); HTTP/SSE transports are not implemented.
2. **User/demo impact:** None while Bob is invoked locally over stdio. If IBM Bob requires a network MCP endpoint, stdio alone would block that integration.
3. **Files/modules that would change (only if triggered):** `src/mcp-server/src/index.js` (add the required transport behind an explicit flag, stdio stays default), `src/mcp-server/package.json` (script), possibly README run instructions.
4. **Scope decision:** **Conditional — out of Phase 6.** No action until Q6 (Bob access) is answered. If HTTP/SSE is required, it is a small additive transport with the tool layer untouched.
5. **Acceptance criteria (if triggered):** Server starts with the required transport; `tools/list` returns the same 11 tools with identical schemas; every tool remains a pass-through to GET/read-only backend endpoints; stdio client path still works.
6. **Frozen contract / backend behavior:** None; the MCP read-only invariant is preserved.

### F8 — Unknown-path 501 vs 404

1. **Original finding:** Unmatched `/api/*` paths return `501 NOT_IMPLEMENTED` (`src/backend/src/common/http.js:14`), a leftover from the vertical-slice era.
2. **User/demo impact:** Cosmetic but evaluator-visible: a judge probing an unknown path sees 501 (implying "not built yet") instead of a correct 404. All 28 endpoints are implemented, so 501 is obsolete.
3. **Files/modules that would change:**
   - `src/backend/src/common/http.js` — `notImplementedHandler` → standardized 404 `NOT_FOUND` envelope.
   - `src/backend/src/app.js` — catch-all wiring/comment.
   - `src/backend/test/api-logistics.test.js` — update the catch-all assertion.
4. **Scope decision:** **Phase 6 (recommended, A2).** One-line behavior hardening with a test update.
5. **Acceptance criteria and verification:**
   - `curl -i http://localhost:3001/api/does-not-exist` → HTTP 404 with the project's standard JSON error envelope; existing routes unaffected.
   - Backend 144/144 green after the test update.
   - Commands: the curl above; `npm test` (backend); F1 proxy variant `http://localhost:5173/api/nope`.
6. **Frozen contract / backend behavior:** Unknown-path behavior was never specified in the frozen contract; the change is behavior-only for unspecified paths. **Requires approval** (A2).

### F4 — Bob live path (context)

1. **Original finding:** No IBM Bob credentials, so the live Bob path is untested; the deterministic 503 fallback is the safe behavior.
2. **Impact:** If Q6 provides credentials, a live grounding demo becomes possible; otherwise the fallback is the demo path.
3. **Files:** none now; later, Phase 7 runbook only (credentials stay out of the repo — environment variables at runtime).
4. **Decision:** **Conditional on Q6; Phase 7** if access materializes. Never commit credentials (I8).
5. **Acceptance (if triggered):** Bob answers with evidence citing backend rows; fallback covered by `test/bob-proxy.test.js` regardless.
6. **Contract:** none.

### F7 — Phase 3A report test-count drift

1. **Original finding:** `docs/PHASE_3_API_REPORT.md` states 94 tests; the corrected count is 138/144 in later reports.
2. **Impact:** Internal documentation only; no runtime effect.
3. **Files:** that report.
4. **Decision:** **Phase 7 docs pass** (bundle with final documentation).
5. **Acceptance:** counts consistent across all phase reports.
6. **Contract:** none.

---

## 3. Candidate review (requested areas)

| Area | Evidence | Decision |
|---|---|---|
| **Frontend performance** | 618 kB single chunk (Recharts warning); S11 issues one sensor-block call per cold shipment (~23) | **Out of scope.** Local demo is unaffected. Optional Phase 7 polish: lazy-load the two chart screens. An S11 aggregate endpoint would be a *new* endpoint — **forbidden**; S11 stays as-is. |
| **API refresh behavior** | S1/S8 poll at 30 s; evaluation-on-read is approved design | **No caching layer, no new endpoints.** Only F5 throttling (A1). Polling cadence unchanged. |
| **Data freshness** | Feeds end at anchor +6 h | **F2 only** (A3). Regeneration with a new `--now` = explicit data decision, deferred to Phase 7 runbook. |
| **Demo reliability** | Design gate "live E2E works" | **Phase 6 core.** Live walkthrough of both storylines + failure modes; fix defects (frontend-only unless separately approved); produce `docs/PHASE_6_INTEGRATION_REPORT.md`. |
| **Grounding/evidence presentation** | S13 evidence panel verified by 49 frontend tests; MCP layer proven by tests but not demoable without an MCP client | **Phase 6 (A4).** NEW `src/mcp-server/scripts/smoke.js`: spawn the stdio server, `tools/list` (expect 11), call 3 representative read-only tools against the live backend, print structured evidence. No server changes; read-only preserved. |

---

## 4. Phase 6 work items (recommended scope)

| ID | Item | Type | Approval |
|---|---|---|---|
| P6-0 | Live integrated walkthrough (both storylines + failure modes), defect log | Verification | — |
| P6-1 | Fix integration defects found — frontend-only; stop and ask if backend change seems needed | Code (frontend) | — |
| P6-2 | F5 write-throttling + tests | Code (backend) | A1 |
| P6-3 | F8 404 catch-all + test update | Code (backend) | A2 |
| P6-4 | F2 simulator script + freshness verification | Code (additive script) | A3 |
| P6-5 | MCP smoke/demo script | Code (additive script) | A4 |
| P6-6 | Invariant re-verification + `docs/PHASE_6_INTEGRATION_REPORT.md` | Verification + docs | — |

**Not in Phase 6:** F3 (A5), F6 transport (A6), F4 live Bob (Q6), F7 docs, frontend perf polish, 25-scenario matrix, video/screenshots/deck (Phase 7/8).

**Implementation order:** P6-0 → P6-1 → A1 → A2 → A3 → A4 → P6-6. Each item is independently droppable except P6-0/P6-1/P6-6 (the gate).

---

## 5. Live walkthrough script (P6-0, the Phase 6 gate)

Run with DB + backend + frontend live (proxy F1). Evidence captured per step in the integration report:

1. **Logistics flow:** S2 create a disruption (and a duplicate → 409 toast) → S3 affected list → S4 shipment detail (all tabs) → S5 alternatives → create recommendation → accept → S14 audit shows the transition.
2. **Cold-chain flow:** S8 alerts (sensor-failure banners expected until F2 simulator runs) → S10 review (acknowledge/close) → S9 temperature history → S11 sensor health.
3. **Freshness:** run the F2 simulator for one shipment → its banner clears → alert count drops by one → S031 deliberate failure remains.
4. **Bob:** S13 fallback banner (input disabled, no fabricated answer) — or live if Q6 delivers credentials.
5. **Grounding:** MCP smoke script prints tool evidence rows matching the live DB (e.g., S039 combined 0.728).
6. **Failure modes:** stop backend → all screens show error states (no white screens); restart → recovery; unknown path → 404 (after P6-3).
7. **Reset:** `npm run seed` restores the demo baseline; re-run steps 1–3 quickly.

---

## 6. Invariants to preserve (re-verified at every milestone)

| # | Invariant | Verification |
|---|---|---|
| I1 | 28 REST endpoints remain functional | Endpoint sweep (28 curls) + backend suites |
| I2 | No unexpected 5xx | Sweep + suites + walkthrough log |
| I3 | Bob 503 fallback remains safe | `test/bob-proxy.test.js` + live S13 check |
| I4 | MCP remains GET-only/read-only | Existing MCP tests + smoke-script assertion (no write verbs in tool layer) |
| I5 | No ML | No ML dependency/code added |
| I6 | No duplicated formulas | Frontend `no-formulas` scan + grep (weights, severity tables) |
| I7 | Seed ground truth unchanged (unless explicit data decision) | `data/seed/*` SHA-256 before/after + `verify-seed.js` 15/15 + 14/14 |
| I8 | No secrets; frozen reference files untouched | `.env` scan; timestamp check on `data/`, `docs/phase-0/`, reference files |

Baseline suite gates: backend **144/144**, frontend **49/49**, Python **48/48** + `validate.py` PASS.

---

## 7. Files expected to change in Phase 6

**Create:**
- `docs/PHASE_6_SCOPE_AND_PLAN.md` (this document)
- `docs/PHASE_6_INTEGRATION_REPORT.md` (P6-6)
- `src/backend/scripts/simulate-feed.js` (P6-4, if A3 approved)
- `src/mcp-server/scripts/smoke.js` (P6-5, if A4 approved)

**Modify (only with approval):**
- `src/backend/src/risk/routes.js`, `src/backend/src/coldchain/evaluation.js` (P6-2 / A1)
- `src/backend/src/common/http.js`, `src/backend/src/app.js` (P6-3 / A2)
- `src/backend/test/api-shared.test.js`, `test/api-coldchain.test.js`, `test/api-logistics.test.js` (test updates for approved items)
- `src/mcp-server/package.json` (smoke script entry, if A4 approved)
- Frontend files: **only** fixes for defects found in P6-0 (no planned changes)

**Explicitly untouched:** `src/data-generator/**`, `data/seed/**`, `docs/phase-0/**` contracts, frozen reference files, `.env` (none exists).

---

## 8. Acceptance criteria for Phase 6

1. Live walkthrough (Section 5) executed with zero unexplained errors and logged evidence.
2. Any integration defects found are fixed and covered (frontend tests stay ≥49 and green).
3. Approved hardening items implemented, each with its per-item acceptance criteria met and full suites re-run.
4. All invariants I1–I8 verified as listed.
5. `docs/PHASE_6_INTEGRATION_REPORT.md` written with: walkthrough evidence, defect log, files changed, test results, invariant results, and remaining findings.
6. No step in this phase requires a frozen-contract change; if one appears, stop and request approval instead.

---

## 9. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | F5 throttling breaks snapshot-related test expectations | Implement value-preserving (responses identical); run full backend suite; droppable item |
| R2 | In-process evaluation memo resets on restart | Harmless one-time re-evaluation; documented |
| R3 | Simulator readings newer than fixtures trigger out-of-order flags on old reads | Expected per ingestion rules; document in runbook |
| R4 | Walkthrough exposes a genuine backend bug | Stop; present finding + proposed fix for approval instead of changing the frozen layer unilaterally |
| R5 | Q6 (Bob access) still unanswered | Fallback demo is the default; no dependency for Phase 6 completion |
| R6 | Time pressure near demo | P6-2…P6-5 are individually droppable; only P6-0/P6-1/P6-6 are the gate |

---

## 10. Approval requested

- **A1** — Approve F5 write-throttling in Phase 6 (recommended).
- **A2** — Approve F8 unknown-path 404 in Phase 6 (recommended).
- **A3** — Approve the F2 simulator script in Phase 6; fixtures/ground truth stay unchanged (recommended).
- **A4** — Approve the MCP smoke/demo script in Phase 6 (recommended).
- **A5** — Confirm F3 (post-delivery records) is deferred to Phase 7, conditional on an explicit data decision (recommended).
- **A6** — Confirm F6 (HTTP/SSE transport) stays conditional on Q6.
- **A7** — Confirm frontend performance work and any new endpoints are out of Phase 6.

**Status: PLAN ONLY.** No code has been modified. On approval, implementation proceeds in the order in Section 4.
