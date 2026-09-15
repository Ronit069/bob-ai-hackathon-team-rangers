# Phase 7 Scope and Plan

**Project:** ChainSentinel — L2 Supply Chain Disruption Assistant & Fleet Utilisation Optimizer
**Date:** 2026-09-15
**Status:** PLAN ONLY — scope review pending approval. No code has been modified.
**Inputs read:** `docs/PHASE_6_INTEGRATION_REPORT.md` · `docs/PHASE_6_SCOPE_AND_PLAN.md` · all prior phase reports (Phase 1–6) · `PHASE_1_SYSTEM_DESIGN.md` §16 (phase mandate) · `docs/phase-0/scope-freeze.md` · `docs/phase-0/api-contract.md` · `docs/phase-0/member-2-excursion-detection.md` · `docs/phase-0/member-2-bob-integration.md` · `docs/phase-0/architecture-decision-record.md` · `docs/PHASE_3_DECISIONS.md` · `docs/PHASE_4_GROUNDING_REPORT.md` · all source files under `src/` · all test files · `data/seed/` fixtures · `README.md` · `submission.yaml` · `demo/` directory.

---

## 1. Current Project Status

### Phase 6 completion status

**Phase 6 (Integration) is complete.** Status line from the integration report:

```
PHASE_6_COMPLETE
PHASE_7_SCOPE_REVIEW_PENDING
```

### Phase 6 verification baseline

| Check | Result |
|---|---|
| Backend tests | **147/147 pass, 0 fail** |
| Frontend tests | **49/49 pass** |
| Python generator tests | **48/48 pass** |
| Contract validator (`python validate.py`) | **PASS** — 48 scenarios, 15 matching, 14 excursions, 2,201 readings |
| Cross-language oracle (`node scripts/verify-seed.js`) | **matching 15/15 · excursions 14/14** |
| Endpoint sweep (28 endpoints) | **28/28** — 0 × 501, 0 unexpected 5xx |
| Unknown-route behavior | **404 NOT_FOUND** (implemented in Phase 6) |
| Bob fallback | **503 BOB_UNAVAILABLE (bob_disabled)** |
| MCP smoke (`npm run smoke`) | **7/7 checks pass** — oracle-grounded 0.728, read-only, no DB dependency |
| Seed SHA-256 | **Identical before and after** (3 files: logistics.json, coldchain.json, ground_truth.json) |
| Live walkthrough (S1–S14) | **PASS** (all 14 screens verified) |
| Unexpected 5xx | **0** |

### Phase 6 items implemented

- **F2** — demo freshness simulator (`src/backend/scripts/simulate-feed.js`).
- **F5** — write-throttling in `coldchain/evaluation.js` and `risk/routes.js`; response values, formulas and semantics unchanged.
- **F8** — unknown `/api/*` paths now return 404 `NOT_FOUND` instead of 501.
- **MCP grounding smoke** — `src/mcp-server/scripts/smoke.js` with `npm run smoke`.

### Phase 6 items intentionally deferred

- **F3** — post-delivery excursion records (A5 approved, data decision required).
- **F6** — MCP HTTP/SSE transport (A6 approved, conditional on Q6).
- **F4** — live Bob path (conditional on Q6; 503 fallback is the verified default).
- **F7** — Phase 3A report test-count drift (docs-only correction, Phase 7 pass).
- **Frontend performance** (bundle-size warning, S11 N+1) — documented limitation, out of scope.

---

## 2. Repository Inspection Summary

The following modules, services, datasets, tests, reports, and scripts were inspected:

### Source code

| Path | Description |
|---|---|
| `src/backend/src/app.js` | App factory; catch-all 404 handler wired |
| `src/backend/src/coldchain/excursion.service.js` | Pure-function detection pipeline (B-3/B-5/B-6/B-8 frozen rules); unchanged since Phase 3 |
| `src/backend/src/coldchain/evaluation.js` | Orchestration + Phase 6 write-throttle memo |
| `src/backend/src/coldchain/repository.js` | Excursion CRUD + reading fingerprints (Phase 6 additions) |
| `src/backend/src/coldchain/routes.js` | Endpoints 12–17, 28 |
| `src/backend/src/risk/routes.js` | Risk overview + snapshot throttle (Phase 6) |
| `src/backend/src/mcp-server/src/tools.js` | 11 frozen read-only tools |
| `src/backend/src/mcp-server/src/index.js` | stdio transport (decision D3); unchanged |
| `src/backend/migrations/003_coldchain.sql` | Schema includes `post_delivery boolean NOT NULL DEFAULT false` |
| `src/backend/scripts/simulate-feed.js` | F2 demo-freshness simulator (Phase 6) |
| `src/backend/scripts/verify-seed.js` | Cross-language oracle verification |
| `src/mcp-server/scripts/smoke.js` | Phase 6 grounding smoke script |
| `src/frontend/src/screens/` | All 14 screens (S1–S14) implemented against frozen API |
| `src/data-generator/chainsentinel/groundtruth.py` | Python mirror of JS detection rules; already computes `post_delivery` field |

### Tests

| File | Tests | Notes |
|---|---|---|
| `src/backend/test/api-coldchain.test.js` | Part of 147 | Includes Phase 6 throttle tests and reseed regression |
| `src/backend/test/services.test.js` | Part of 147 | Unit tests for pure-function services; oracle values |
| `src/backend/test/e2e-flow.test.js` | 4 | Full demo-critical path; MCP/REST equality; Bob 503 |
| `src/backend/test/bob-proxy.test.js` | 6 | Phase 4 stub-Bob proxy test |
| `src/backend/test/mcp-tools.test.js` | 7 | MCP tool-layer tests; read-only row-count snapshot |
| `src/backend/test/mcp-server.test.js` | 4 | Spawned stdio E2E; grounding oracle equality |
| `src/frontend/test/*.test.jsx` | 49 | All screens, components, API client, no-formulas scan |
| `src/data-generator/tests/` | 48 | Python generator + ground-truth formula verification |

### Data and fixtures

| File | Description |
|---|---|
| `data/seed/logistics.json` | 50 shipments, 24 fleet assets, 5 disruptions, 9 carriers, routes/segments (frozen) |
| `data/seed/coldchain.json` | Cargo profiles, 4 temperature policies, 2,201 sensor readings (frozen) |
| `data/seed/ground_truth.json` | Expected outputs: 15 matching scenarios, 14 excursions (all `post_delivery: false`), fleet, alternatives, risk |
| `docs/PHASE_6_SEED_HASHES_BEFORE.txt` / `_AFTER.txt` | SHA-256 before/after Phase 6 — identical |

### Documentation

Phase 0 (31 files) · Phase 1 (system design, signoff, 1A closure) · Phase 2 (backend + generator reports, final review) · Phase 3 (plan, decisions, API report, MCP/Bob report, final review) · Phase 4 (scope/plan, grounding report, completion report) · Phase 5 (scope/plan, UI report) · Phase 6 (scope/plan, integration report, seed hashes).

### Submission artifacts (incomplete — Phase 7/8 work)

| Artifact | State |
|---|---|
| `README.md` | Skeleton with 11 `TODO_REQUIRED` placeholders |
| `submission.yaml` | Team/lead/member identities all `TODO_REQUIRED`; problem/solution summaries `TODO_REQUIRED` |
| `demo/demo-video-link.txt` | `TODO: replace with the real demo video URL before submission` |
| `demo/screenshots/` | No screenshots; only a `README.md` with capture instructions |
| `docs/problem-statement.md` | **Missing** — required by submission template |
| `docs/solution-overview.md` | **Missing** — required by submission template |
| `docs/architecture.md` | **Missing** — required by submission template |
| `docs/setup-guide.md` | **Missing** — required by submission template; README references it for run commands |

---

## 3. Deferred Item Review

### 3.1 F3 — Post-delivery excursion records

#### Original purpose

The design intent (per `docs/phase-0/member-2-excursion-detection.md` §4.3 and `scope-freeze.md` §1.2 freeze item B-5) is that breaches occurring entirely after a shipment's delivery cutoff should be emitted as excursion records flagged `post_delivery: true`. These records are "kept for history, excluded from live alerts and pre-delivery severity."

The finding (first raised in Phase 3 as F3; carried through Phases 4, 5, 6) is that the detection pipeline in `excursion.service.js` already computes `post_delivery: true` correctly for readings after the cutoff (lines 216–218 of `excursion.service.js`). However, the evaluation pipeline in `evaluation.js` only operates on readings `<= cutoff` (the `evaluated` slice). Post-delivery readings are silently excluded from the detection loop, so no excursion record is ever created for them — even when breaches occur post-delivery.

#### Current implementation state

- **Schema:** `temperature_excursion.post_delivery` column exists and defaults to `false` (migration `003_coldchain.sql`).
- **Service:** `excursion.service.js` computes `post_delivery: true` and would assign it correctly — but in the current fixture set, no excursion group has `start_time > cutoff` because the `evaluated` array excludes all post-cutoff readings. The assignment on line 218 is therefore always `false` in practice.
- **Python mirror:** `groundtruth.py` line 349 also assigns `post_delivery` identically and would generate `post_delivery: true` records if a scenario supplied readings after the cutoff as breaches.
- **Ground truth:** all 14 excursion records in `data/seed/ground_truth.json` have `post_delivery: false`. The current frozen fixture set for S035 (the "delivered shipment with post-delivery breach" scenario in SCN-115) has no post-cutoff readings that form a breach; consequently, SCN-115 demonstrates "excluded from live alerts" via zero excursions for S035 (the ground truth shows `coldchain_risk: 0.0`, `excursion_count: 0` for S035), but does not demonstrate a stored `post_delivery: true` record.
- **Evaluation orchestration:** `evaluation.js` lines 66–68 filter with `deliveryCutoff`, so any post-delivery breach would be computed but not in the current `evaluated` slice path. The F3 fix would require passing post-cutoff breach readings *through* detection (creating records marked `post_delivery: true`) and then storing them alongside the pre-delivery excursions.

#### Dependencies

1. A change to `excursion.service.js` to pass post-cutoff breach readings through detection with a `post_delivery: true` flag.
2. A change to `evaluation.js` to iterate over post-delivery readings and persist resulting records.
3. A change to `groundtruth.py` (the Python mirror) to match the new behavior.
4. **Regeneration of `data/seed/*.json`**: To demonstrate the feature, S035 (or another delivered shipment) would need injected post-cutoff breach readings in `coldchain.json`. This changes the frozen fixture SHA-256.
5. **Ground-truth update**: `ground_truth.json` must list the new `post_delivery: true` record(s) for the affected shipment(s).
6. **Oracle update**: `verify-seed.js` comparisons and the Python validator (`validate.py`) would fail until regenerated ground truth is in place.
7. **Test updates**: `src/backend/test/services.test.js`, `test/api-coldchain.test.js`, `test/e2e-flow.test.js` — any test asserting the excursion count, the ground-truth oracle tuple set, or the SCN-115 expected output.
8. The `listExcursions` repository function already filters `post_delivery = false` when `active_only = true`, so no schema or repository change is needed.
9. **Frontend:** no change needed — `post_delivery` is already in the API response shape; screens already handle it.

#### Evidence from the repository

- `scope-freeze.md` §1.2: "Excursions after the shipment's delivery timestamp are logged as post-delivery and excluded from pre-delivery severity scoring." — Design intent requires logging, not just exclusion.
- `excursion.service.js` line 218: `post_delivery: cutoff ? new Date(startTime) > cutoff : false` — flag exists but is unreachable under current data and orchestration.
- `docs/PHASE_6_INTEGRATION_REPORT.md` §15: "F3 NOT implemented — `excursion.service.js` untouched."
- `docs/PHASE_6_SCOPE_AND_PLAN.md` §2 (F3 triage): "the fix spans JS detection + Python mirror + regenerated ground truth + three test files for marginal demo value, and it directly risks invariant I7 (seed ground truth unchanged)."
- SCN-115 in `ground_truth.json` (line 9544): description "Delivered shipment with post-delivery breach → excluded from live alerts" — scenario proves the exclusion, but does not contain a `post_delivery: true` entry.

#### Risks

| Risk | Severity |
|---|---|
| Regenerating fixtures changes seed SHA-256, invalidating the Phase 6 hashes | High |
| The Python mirror must be updated to match JS or the cross-language oracle will drift | High |
| Backend test count changes; oracle assertion values change | Medium |
| Adding post-delivery breach readings to S035 (or another shipment) may alter adjacent scenarios if that shipment appears in matching/risk ground truth | Medium |
| If fixture regeneration introduces unintended changes to unrelated scenarios, the Phase 3–6 baseline is corrupted | High |

#### Estimated effort

Medium (4–6 hours of implementation + 2–4 hours of fixture/test regeneration and verification). Disproportionate to demo value.

#### Test impact

- Backend baseline would change: 147 → ~150 (new post-delivery excursion tests).
- Python validator baseline: 48 unchanged (no new Python test methods required), but `validate.py` pass/fail changes.
- `verify-seed.js`: excursion count changes from 14 to 15+ (at minimum one new `post_delivery: true` record).
- Ground-truth SHA-256 changes; Phase 6 seed hashes become historical reference only.

#### Demo/evaluator value

**Low.** The current demo already correctly demonstrates the most important aspect of F3: post-delivery breaches produce *no live alert* (SCN-115 proves this). The stored history record is a completeness detail that is invisible in the live dashboard flow. No evaluator rubric criterion is unlocked by this change. The absence of the stored record does not misrepresent the system's behavior to judges.

#### Recommendation

**Defer.** F3 remains deferred, conditional on an explicit data decision as documented in Phase 6. Rationale:
- The demo value is low; the current SCN-115 scenario correctly demonstrates the exclusion behavior.
- The implementation requires regenerating the frozen seed ground truth and updating the cross-language oracle — the highest-risk class of change in this codebase.
- Phase 7's mandate is "Testing: domain suites + 25-scenario matrix" (per `PHASE_1_SYSTEM_DESIGN.md` §16). F3 would consume Phase 7 capacity without contributing to the test matrix goal.
- If time permits after the Phase 7 gate, F3 may be reconsidered in Phase 8 (Demo + Submission), but only with an explicit data decision and full verification plan.

---

### 3.2 F6 / Q6 — MCP transport decision

#### Original purpose and meaning of Q6

Q6 is the team's open question: **"What is the IBM Bob access method?"** Specifically: does the hackathon provide Bob credentials, and if so, does Bob require the MCP server to speak an HTTP/SSE transport rather than stdio? Decision D2 (Phase 3) deferred the live Bob transport selection until Q6 was answered. Decision D3 (Phase 3) chose stdio as the default transport.

F6 (finding 6 from Phase 3) is the observation that the MCP server currently speaks stdio only, and that if Bob requires HTTP/SSE, a transport addition would be needed.

#### Current implementation state

- `src/mcp-server/src/index.js` uses `StdioServerTransport` exclusively (line 22). The tool layer (`tools.js`) is transport-agnostic.
- `BOB_ENABLED=false` is the production default; no live Bob credentials exist or are assumed.
- The `bob/routes.js` proxy has a guarded forward path that calls `BOB_API_URL` with `BOB_API_KEY` from the environment, but this path has never been exercised against a live Bob (only against a local HTTP stub in `bob-proxy.test.js`).
- Phase 6 explicitly did not modify `src/mcp-server/src/**`. The smoke script (`scripts/smoke.js`) tests the stdio server end-to-end and confirms the tool layer works correctly.

#### Why F6 was made conditional

The transport choice is meaningless without a known Bob access method. Adding HTTP/SSE transport before confirming that Bob actually requires it would be speculative work that adds untested code paths and potential surface area. ADR-001 (`architecture-decision-record.md`) states: "The MCP server is a thin adapter — if Bob's environment expects a different transport, only the adapter changes, not the backend."

#### Whether the current MCP transport is sufficient

Yes, **for the current state of the project**. Without live Bob credentials and a confirmed access method, stdio is both the correct and the only tested transport. The 7/7 smoke test and the 21 grounding tests all exercise the stdio transport and confirm it works. The 503 fallback (Bob disabled) is verified and safe for the demo.

#### Whether any transport change is actually needed

**Unknown until Q6 is resolved.** If Bob access is provided during Phase 7 or Phase 8 with a network-accessible endpoint that requires HTTP/SSE, a transport addition would be needed. However:

- The tool layer (`tools.js`) requires **no change** regardless of transport.
- Only `src/mcp-server/src/index.js` would need an additional transport branch (behind a flag; stdio remains the default).
- This is a small, additive, low-risk change.
- The `BOB_API_URL` environment variable already exists in `.env.example` for the forward path.

#### Benefits and risks of a transport change

| Aspect | Detail |
|---|---|
| Benefit | Enables live Bob demonstration if credentials materialize |
| Benefit | Small, well-scoped change; tool layer untouched |
| Risk | Untested network transport; new code path requires explicit tests |
| Risk | If HTTP/SSE is added but Bob credentials are not provided, the new code path remains untested live |
| Risk | Any transport startup error must not take down stdio (must be guarded behind a flag) |

#### Whether F6 should remain deferred

**Yes, F6 should remain deferred** until Q6 is answered. If Bob access is confirmed with a specific transport requirement during Phase 7 or 8, the transport addition can be done quickly as a Phase 8 item without touching any frozen contract, test, or fixture.

#### Recommendation

**Defer.** F6 remains conditional on Q6. No transport change in Phase 7. Rationale:
- The current stdio transport passes all grounding smoke checks.
- Adding transport without confirmed Bob access creates unverified code paths.
- The Phase 7 mandate (testing + 25-scenario matrix) does not require a live Bob path.
- The safe 503 fallback is the correct demo path until Bob access is confirmed.

---

## 4. Recommended Phase 7 Objective

**Phase 7 objective: Submission packaging — documentation, setup guide, screenshots, and the 25-scenario test-coverage pass.**

This is the original Phase 7 mandate from `PHASE_1_SYSTEM_DESIGN.md` §16: *"Testing: domain suites + 25-scenario matrix (10 core gate). Gate: Core gate passes; failures documented."*

Evidence for this recommendation:
1. The 10 core gate scenarios (defined in `scope-freeze.md` §1.4) are already covered by the existing test suites. Phase 7 should formally verify and document this coverage.
2. The four required submission documents (`docs/problem-statement.md`, `docs/solution-overview.md`, `docs/architecture.md`, `docs/setup-guide.md`) are **missing** and are blocking a complete submission.
3. `README.md` has 11 `TODO_REQUIRED` placeholders and references the missing setup guide.
4. `submission.yaml` has all team and project fields as `TODO_REQUIRED`.
5. No demo screenshots exist; `demo/demo-video-link.txt` contains only a placeholder.
6. The F7 documentation drift (Phase 3A report stating 94 tests vs the real 138/147) should be corrected.
7. F3 and F6 carry higher risk than demo value, and both require decisions before they can be implemented.

Phase 7 does not need new features, new endpoints, new fixtures, or new data decisions. The codebase is complete, integrated, and verified. The gap is submission packaging and documentation.

---

## 5. Proposed Milestones

### P7-1 — Scenario coverage verification and documentation

| Field | Detail |
|---|---|
| **ID** | P7-1 |
| **Objective** | Formally verify and document which of the 25 scenarios in `scope-freeze.md` §1.4 are covered by existing test suites, which are covered by the live walkthrough, and which remain undocumented. Identify the 10 core gate scenarios explicitly. |
| **Files likely to change** | `docs/PHASE_7_SCOPE_AND_PLAN.md` (this document, updated); new `docs/PHASE_7_SCENARIO_COVERAGE.md` |
| **Files that must not change** | All `data/seed/**`; all `src/**` test and production files; all `docs/phase-0/**` |
| **Tests required** | None new. Run the existing suites to confirm the baseline is still 147/147 + 49/49 + 48/48. |
| **Acceptance criteria** | A coverage table mapping each of the 25 scenarios to: the test file(s) that cover it, the expected output, and the actual test result. Core gate (10 scenarios) explicitly marked PASS or FAIL with evidence. |
| **Rollback / safety plan** | Documentation-only; no rollback needed. |

---

### P7-2 — Submission documentation (four required template docs)

| Field | Detail |
|---|---|
| **ID** | P7-2 |
| **Objective** | Create the four required submission template documents: `docs/problem-statement.md`, `docs/solution-overview.md`, `docs/architecture.md`, `docs/setup-guide.md`. Test the setup guide on a clean terminal (fresh clone, no pre-existing DB or node modules). |
| **Files likely to change** | `docs/problem-statement.md` (new) · `docs/solution-overview.md` (new) · `docs/architecture.md` (new) · `docs/setup-guide.md` (new) |
| **Files that must not change** | All `src/**` · `data/seed/**` · `docs/phase-0/**` · all phase reports |
| **Tests required** | No code tests. The setup guide is verified by executing it on a clean terminal: `docker compose up -d` → `npm run migrate` → `npm run seed` → backend → frontend → `curl http://localhost:5173/api/health` returns backend JSON. |
| **Acceptance criteria** | (1) All four files exist with content. (2) `docs/setup-guide.md` has been executed clean and produces a working local environment. (3) README references are resolved (setup-guide section in README points to correct file). |
| **Rollback / safety plan** | Documentation-only. If the setup guide reveals a missing dependency or wrong command, the fix is in the guide; no code change allowed without explicit approval. |

---

### P7-3 — README, submission.yaml, and demo artifacts

| Field | Detail |
|---|---|
| **ID** | P7-3 |
| **Objective** | Fill all `TODO_REQUIRED` placeholders in `README.md` and `submission.yaml`. Capture the required screenshots (≥3 per submission template, recommended ≥7 per `demo/screenshots/README.md`). Update `demo/demo-video-link.txt` once a recording is available. |
| **Files likely to change** | `README.md` · `submission.yaml` · `demo/demo-video-link.txt` · `demo/screenshots/` (add PNG files) |
| **Files that must not change** | All `src/**` · `data/seed/**` · `docs/phase-0/**` |
| **Tests required** | None. Screenshots verified by visual inspection during a demo rehearsal. |
| **Acceptance criteria** | (1) No `TODO_REQUIRED` strings in `README.md` or `submission.yaml`. (2) ≥3 screenshots in `demo/screenshots/`. (3) `demo/demo-video-link.txt` replaced with a real link (or noted as "recorded separately"). (4) Known limitations section in README is honest and matches the code. |
| **Rollback / safety plan** | Text/media only. |

---

### P7-4 — Documentation correctness pass (F7)

| Field | Detail |
|---|---|
| **ID** | P7-4 |
| **Objective** | Correct the F7 documentation drift: `docs/PHASE_3_API_REPORT.md` states "94/94 pass" (the test count at the time the report was written, before Phase 3B). Update to note that the report reflects Phase 3A scope only and that the full Phase 3 suite was 138/138. Also verify that all phase reports accurately reference their own test counts and that no report makes claims that contradict later phases. |
| **Files likely to change** | `docs/PHASE_3_API_REPORT.md` (add a clarifying note only; do not rewrite history) |
| **Files that must not change** | All `src/**` · `data/seed/**` · `docs/phase-0/**` |
| **Tests required** | None. Run `npm test` (backend) to confirm 147/147 still passes after any documentation edits. |
| **Acceptance criteria** | `PHASE_3_API_REPORT.md` contains a note clarifying that "94/94" was the Phase 3A count and that the final Phase 3 count was 138/138 (consolidated in `PHASE_3_FINAL_REVIEW.md`). No test expectations changed. |
| **Rollback / safety plan** | Documentation-only. |

---

### P7-5 — Final invariant verification and Phase 7 completion report

| Field | Detail |
|---|---|
| **ID** | P7-5 |
| **Objective** | Run the full verification suite one final time and write `docs/PHASE_7_COMPLETION_REPORT.md` documenting results, known limitations, and the Phase 8 trigger. |
| **Files likely to change** | `docs/PHASE_7_COMPLETION_REPORT.md` (new) |
| **Files that must not change** | All `src/**` · `data/seed/**` · `docs/phase-0/**` |
| **Tests required** | Full suite: backend 147/147, frontend 49/49, Python 48/48, validator PASS, verify-seed 15/15 + 14/14, smoke 7/7, endpoint sweep 28/28. |
| **Acceptance criteria** | All verification checks pass at the established baselines. Report documents: scenario coverage (from P7-1), known limitations, deferred items (F3, F6, F4, Playwright E2E, frontend bundle-size warning, S11 N+1), and the Phase 8 mandate. |
| **Rollback / safety plan** | Documentation-only. |

**Implementation order:** P7-1 → P7-2 → P7-3 → P7-4 → P7-5. P7-2 and P7-3 may run in parallel after P7-1 is complete.

---

## 6. Data and Ground-Truth Decision

Phase 7, as recommended, requires:

| Item | Required? | Decision |
|---|---|---|
| Fixture changes (`data/seed/*.json`) | **No** | Fixtures are frozen; Phase 7 does not touch them |
| Ground-truth changes (`data/seed/ground_truth.json`) | **No** | Ground truth is frozen; Phase 7 does not touch it |
| Oracle changes (S039 combined 0.728, etc.) | **No** | All oracle values are unchanged |
| Seed changes (regenerating with new `--now`) | **No** | Not required for Phase 7; noted as a demo-day runbook option |
| New database records (from source code changes) | **No** | No source code changes in Phase 7 |

**Explicit approval gate:** If any future decision introduces a fixture, ground-truth, or oracle change, it must be brought for explicit approval before implementation. This applies specifically to F3 (post-delivery records) if it is ever reconsidered.

---

## 7. API and MCP Impact

| Item | Status |
|---|---|
| Existing APIs (28 endpoints) sufficient for Phase 7? | **Yes** — Phase 7 is documentation and packaging only |
| New REST endpoints required? | **No** |
| Existing API contracts would change? | **No** |
| MCP tools or transport would change? | **No** |
| Bob proxy path changes? | **No** (F4 remains conditional on Q6) |
| `docs/phase-0/api-contract.md` changes? | **No** |

Phase 7 touches no source code. Any API or MCP change remains out of scope unless explicitly approved with a new decision record.

---

## 8. Regression and Verification Plan

The following checks must pass at the completion of each Phase 7 milestone and must remain at the established baselines throughout:

| Check | Command / Method | Expected Result |
|---|---|---|
| Backend test baseline | `npm test` (in `src/backend`) | **147/147 pass, 0 fail** |
| Frontend test baseline | `npm test` (in `src/frontend`) | **49/49 pass** |
| Python test baseline | `python -m unittest discover -s tests -t .` (in `src/data-generator`) | **48/48 pass** |
| Contract validator | `python validate.py` (in `src/data-generator`) | **PASS** — scenarios=48, matching=15, excursions=14, readings=2201 |
| Cross-language oracle | `node scripts/verify-seed.js` (in `src/backend`) | **matching 15/15 · excursions 14/14** |
| MCP grounding smoke | `npm run smoke` (in `src/mcp-server`) | **7/7 checks pass** |
| Endpoint sweep | 31 HTTP calls through Vite proxy (`:5173`) | **28/28 endpoints · 0 × 501 · 0 unexpected 5xx** |
| Oracle check | `GET /api/shipments/S039/risk` | `combined_score: 0.728` |
| Seed hash comparison | SHA-256 of `data/seed/{logistics,coldchain,ground_truth}.json` | **Identical to Phase 6 before/after hashes** |
| Bob fallback | `POST /api/bob/query` with `BOB_ENABLED=false` | **HTTP 503 · code: BOB_UNAVAILABLE · reason: bob_disabled** |
| MCP read-only | Existing `mcp-tools.test.js` read-only row-count snapshot test | **Counts unchanged after all 11 tool calls** |
| Unknown-route behavior | `GET /api/does-not-exist` | **HTTP 404 · code: NOT_FOUND** |
| No ML | Dependency scan on `src/backend`, `src/mcp-server`, `src/frontend`, `src/data-generator` | **No ML library imports** |
| No secrets | `.env` scan; no credentials in committed files | **Clean** |
| No duplicated formulas | `rg "0\.35\|0\.45\|SEVERITY_WEIGHTS\|combined_score\s*=" src/frontend/src` | **No matches** |

**Live walkthrough** (manual, using `npm run dev` in both `src/backend` and `src/frontend`):
Run the simulator (`node scripts/simulate-feed.js`) to refresh S030, then walk S1–S14 verifying that all screens render without errors and all states (loading, empty, error, 503 fallback, unknown/review) are reachable.

---

## 9. Approval Gates

The following decisions must be approved before the corresponding work begins:

| Gate ID | Decision | Required for |
|---|---|---|
| **AG-1** | Confirm Phase 7 scope as documentation + packaging only (P7-1 through P7-5) | All Phase 7 implementation |
| **AG-2** | Approve team identity and project summary text for `README.md` and `submission.yaml` (Q4 from Phase 1A) | P7-3 |
| **AG-3** | Confirm F3 (post-delivery records) remains deferred and is not in Phase 7 scope | P7-1 (to close the finding cleanly) |
| **AG-4** | Confirm F6 (MCP transport) remains conditional on Q6 and is not in Phase 7 scope | P7-5 (completion report) |
| **AG-5** | Any fixture / ground-truth / oracle change — explicit data decision required before any fixture regeneration | Blocks F3 if ever reconsidered |

---

## 10. Explicit Out-of-Scope Items

The following must **not** be implemented in Phase 7 without a new explicit decision and approval:

| Item | Reason |
|---|---|
| F3 — post-delivery excursion records | Requires data decision + fixture regeneration + ground-truth change; low demo value |
| F6 / F4 — MCP transport change or live Bob path | Conditional on Q6 (Bob access method); no credentials confirmed |
| New REST endpoints | No new endpoint is required; adding one would change the endpoint sweep count and require new tests |
| Frontend performance improvements (bundle splitting, S11 aggregate endpoint) | S11 aggregate would require a new endpoint; bundle splitting is cosmetic at demo scale |
| Playwright / browser E2E tests | Deferred to Phase 7 per plan (A7 in Phase 5); may be reconsidered for Phase 8 if time permits |
| Any change to `data/seed/**` | Frozen; seed SHA-256 must remain identical to Phase 6 hashes |
| Any change to `docs/phase-0/**` | Frozen design contracts |
| Any change to formula constants, service logic, or algorithm behavior | All formulas are frozen; invariant I6 must be preserved |
| ML additions | Explicitly forbidden per ADR-006 and `scope-freeze.md` §3 |
| Authentication, deployment, live external feeds | Future production scope per `scope-freeze.md` §3 |
| Modification of any Phase 1–6 completion report | Historical records; F7 documentation correction (P7-4) adds a clarifying note only |

---

## 11. Final Recommendation

The repository is in excellent shape after Phase 6. The implementation is complete (28 endpoints, 14 screens, 11 MCP tools, full test coverage), the integration is verified (147/147 backend, 49/49 frontend, 48/48 Python, oracle 0.728 stable, seed hash identical), and the demo flow works end-to-end.

The only genuine gaps before submission are:
1. Four missing required documentation files (`problem-statement.md`, `solution-overview.md`, `architecture.md`, `setup-guide.md`).
2. Unfilled `README.md` and `submission.yaml` placeholders.
3. No screenshots or demo video.
4. The F7 test-count documentation drift.
5. A formal scenario coverage table for the 25-scenario matrix.

None of these gaps require new code, new endpoints, fixture changes, or data decisions. F3 and F6 should remain deferred; their risk-to-value ratio in Phase 7 is unfavorable.

```
PHASE_7_SCOPE_READY_FOR_APPROVAL
```
