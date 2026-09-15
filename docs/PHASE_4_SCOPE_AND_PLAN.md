# Phase 4 — Scope and Implementation Plan

**Project:** ChainSentinel — L2 Supply Chain Disruption Assistant & Fleet Utilisation Optimizer
**Date:** 2026-09-15
**Status:** PLAN — for team approval. **No code has been changed.** Implementation must not begin until this scope is approved (§10).
**Inputs read:** `docs/PHASE_3_FINAL_REVIEW.md` · `docs/PHASE_3_IMPLEMENTATION_PLAN.md` (the file referenced as `docs/PHASE_3_PLAN.md` does not exist — path corrected) · `docs/PHASE_2_FINAL_REVIEW.md` · `docs/PHASE_3_DECISIONS.md` · `docs/PHASE_3_API_REPORT.md` · `docs/PHASE_3_BOB_MCP_REPORT.md` · `PHASE_1_SYSTEM_DESIGN.md` (approved phase table §16 + D1 note) · `docs/phase-0/phase-plan.md` · `api-contract.md` / `data-contract.md` / `scope-freeze.md` (+ Phase 1A amendments) · `member-2-bob-integration.md` and all M2 documents · `CONTRIBUTING.md` (working rules) · current source, tests and fixtures.

---

## 1. Exact approved Phase 4 scope

The approved design (`PHASE_1_SYSTEM_DESIGN.md` §16, amended by decision D1) defines:

> **Phase 4 — Intelligence: ranking, severity refinement, combined risk, MCP tools, grounding tests.**
> Gate: *score matches manual calculation; grounding tests pass.*
> D1 note: *the MCP/Bob tool layer moves into Phase 3; **Phase 4 retains any refinement/grounding validation not completed in Phase 3**.*

**Verified position:** the intelligence *product* work is already delivered (see §2). Therefore the **exact Phase 4 scope is validation closure, not new features**:

1. **Grounding validation closure** — consolidate tool-layer grounding evidence into a report and record the live-Bob half as conditional on Q6 with an explicit fallback (gate item).
2. **Intelligence gate closure** — formal evidence that ranking, severity and combined risk match manual calculations (already unit-verified; consolidated as the Phase 4 verification artifact).
3. **Enabled Bob proxy path closure** — the guarded forward path (D2) is implemented but untested; verify it against a local stub Bob (no credentials required). *Approval item A2.*
4. **Invariant verification + Phase 4 completion report.**

**Explicitly out of Phase 4:** all 8 non-blocking Phase 3 findings (§4), all "if time permits" enhancements (`scope-freeze.md` §2), any UI work (Phase 5), and any change to Phase 3 behaviour.

---

## 2. Intelligence work already delivered (evidence)

| Intelligence deliverable (old phase-plan Phase 3) | Evidence | Status |
|---|---|---|
| Route ranking | `alternatives.service.js`; exact-score tests (R089 0.889 / R095 0.176); ground-truth comparison | Complete |
| Carrier ranking | `carrierAlternatives`; C09 `carrier_inactive` oracle | Complete |
| Shipment priority scoring | Frozen impact-score formula; S001=1.0 / S002=0.0 tests; ground-truth matching | Complete |
| Fleet redeployment ranking | A-7 formula; ground-truth candidate lists; contention test | Complete |
| Temperature severity refinement | B-8 ladder; CT-22 `duration>critical`; edge-case suite | Complete |
| Cold-chain risk scoring | Severity weights; S039 = 0.6; review-flag 0.5 | Complete |
| Evidence generation for explanations | `reasons[]`, factor vocabulary, `severity_rationale`; A-9 tests | Complete |
| Bob tool implementation | 11 frozen tools; stdio server; tool contract tests | Complete (D1) |
| Grounded response testing | Tool-layer grounding tests + stdio E2E; **live-Bob half conditional on Q6** | **Closure pending** |
| Common risk format + reason codes | RC-3 nested factors; shared factor vocabulary | Complete |
| Combined-priority schema + endpoint | Endpoints 18/19; S039 = 0.728 oracle across REST/MCP/stdio | Complete |

---

## 3. Required Phase 4 work

| ID | Task | Deliverable | Owner | Dependency | Acceptance criteria |
|---|---|---|---|---|---|
| P4-R1 | Grounding validation closure | `docs/PHASE_4_GROUNDING_REPORT.md` | M2 (M1 reviews) | Q6 status recorded | Tool-layer grounding evidence consolidated (11 tools, empty/error/unsupported cases, read-only proof); live-Bob half explicitly marked **CONDITIONAL — blocked on Q6** with the documented fallback (tool layer + dashboard); no claim of a working live Bob |
| P4-R2 | Intelligence gate closure | Section in `docs/PHASE_4_COMPLETION_REPORT.md` | SH | — | Ranking/severity/combined-risk evidence listed with exact expected values and the tests that assert them; gate statement "score matches manual calc; grounding tests pass" recorded with the conditional noted |
| P4-R3 | Enabled Bob proxy path verification *(approval item A2)* | `src/backend/test/bob-proxy.test.js` (new) | M2 (M1 reviews) | This plan approved | Stub-Bob server: proxy forwards `prompt` + the 10 grounding rules; 200 → `{answer,evidence,tool_calls}`; stub 5xx/unreachable → `503 BOB_UNAVAILABLE` (`reason: bob_unreachable`); API key never returned or logged; **no change to `bob/routes.js` unless the test finds a defect (then documented as a blocking defect)** |
| P4-R4 | Invariant verification | Section in `docs/PHASE_4_COMPLETION_REPORT.md` | SH | R1–R3 | All invariants in §5 verified with commands and results |
| P4-R5 | Phase 4 completion report | `docs/PHASE_4_COMPLETION_REPORT.md` | SH | R1–R4 | Report covers scope, files, tests, results, findings, exit criteria; ends with the Phase 4 status line |

**Files/modules Phase 4 will touch:**

| Action | File | Notes |
|---|---|---|
| New (docs) | `docs/PHASE_4_SCOPE_AND_PLAN.md` (this), `docs/PHASE_4_GROUNDING_REPORT.md`, `docs/PHASE_4_COMPLETION_REPORT.md` | Documentation only |
| New (test) | `src/backend/test/bob-proxy.test.js` | Only if A2 is approved |
| Modified (only on defect) | `src/backend/src/bob/routes.js` | Not planned; defect must be documented separately before any edit |
| **Untouched** | all 5 routers, services, repositories, `app.js`, `common/*`, migrations, generator, fixtures, contracts, MCP tools/server, frontend | Phase 3 behaviour frozen |

---

## 4. Separation — the 8 non-blocking Phase 3 findings are NOT Phase 4 work

| Finding | Triage | Rationale |
|---|---|---|
| F1 — Vite proxy config missing | **Phase 5** (first task) | Required for UI wiring; API is already HTTP-testable |
| F2 — seeded feeds age out (stale-feed alerts) | **Phase 7 / demo ops** | Demo must regenerate fixtures with current `--now` or run the simulator; documented in both Phase 3 reports |
| F3 — post-delivery excursion records not emitted | **Phase 5/6 backlog** | Design gap carried from Phase 2B; no MVP blocker |
| F4 — Bob live path untested (no credentials) | **Conditional on Q6** | Partially closed by P4-R3 (stub verification); live validation waits for access |
| F5 — excursion refresh / snapshot persistence cost | **Phase 6** | Performance work; demo scale is fine |
| F6 — MCP stdio-only transport | **Future** | Per decision D3; no action |
| F7 — Phase 3A report test-count drift (94 → 138) | **Phase 7 docs pass** | Documentation-only correction |
| F8 — unknown `/api/*` paths return 501, not 404 | **Phase 6 (optional)** | Cosmetic; preserves Phase 2 behaviour |

None of the findings block Phase 4 closure or Phase 5 start.

---

## 5. Phase 3 invariants to preserve (with verification method)

| # | Invariant | Verification |
|---|---|---|
| I1 | All 28 REST endpoints remain functional | Endpoint sweep against a seeded test server (28 checks) |
| I2 | 0 unexpected 5xx | Sweep + full test suite (expected exceptions: none; Bob 503 is expected) |
| I3 | Bob 503 fallback intact | `api-shared`, `e2e-flow`, sweep (`BOB_ENABLED=false` → `503 BOB_UNAVAILABLE`, `reason: bob_disabled`) |
| I4 | MCP GET-only and read-only | `mcp-tools` row-count snapshot test; code inspection (`callTool` hardcodes GET; no mutating tool) |
| I5 | No ML | Dependency and import scan (backend, MCP, generator) |
| I6 | No duplicated formulas | Route files contain no score/weight constants; formulas only in services |
| I7 | Seed ground truth unchanged | SHA-256 of `data/seed/*` vs a fresh `python generate.py`; validator PASS; `verify-seed` 15/15 + 14/14; excursion/risk oracles |
| I8 | No secrets / reference files untouched | No `.env`; no key logging; reference file sizes/timestamps unchanged |

**Any Phase 4 change that breaks an invariant is a blocking defect and must be documented before any fix.**

---

## 6. Implementation and verification plan (order)

| Step | Action | Command / method | Expected result |
|---|---|---|---|
| 0 | Team approves this plan (A1–A3, §10) | review | Approval recorded |
| 1 | Write `PHASE_4_GROUNDING_REPORT.md` (P4-R1) | documentation | Grounding evidence consolidated; live-Bob marked conditional; fallback stated |
| 2 | Add stub-Bob proxy test (P4-R3, if A2 approved) | `src/backend/test/bob-proxy.test.js` — local HTTP stub on an ephemeral port; set `BOB_ENABLED`/`BOB_API_URL` before a dynamic `import()` of `app.js`; assert forward payload, success mapping, 503 mapping, key isolation | 4–6 new tests pass; no production file changes |
| 3 | Full verification | `npm test` · `python -m unittest discover` · `python validate.py` · `node scripts/verify-seed.js` · endpoint sweep · SHA-256 regeneration · ML/secrets/formula greps | 138 + new tests green; 48/48 Python; validator PASS; 15/15 + 14/14; 0 × 501; 0 unexpected 5xx; fixtures identical; greps clean |
| 4 | Write `PHASE_4_COMPLETION_REPORT.md` (P4-R2, R4, R5) | documentation | Intelligence gate closure + invariant results + exit criteria recorded |

**Commands (canonical):**
```
cd src/backend        && npm test
cd src/backend        && node scripts/verify-seed.js
cd src/data-generator && python -m unittest discover -s tests -t .
cd src/data-generator && python validate.py
```

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Config is loaded at import time, so flipping `BOB_ENABLED` in tests is not straightforward | Test file sets env vars, then uses dynamic `import()`; documented in the test |
| Stub-Bob port conflicts | Ephemeral port (`listen(0)`) |
| Scope creep (pulling findings or "if time permits" items into Phase 4) | §1 and §4 are explicit; findings are triaged, not scheduled |
| Accidentally changing Phase 3 behaviour while adding the test | P4-R3 touches production code only if a defect is proven; otherwise test-only |
| Documentation drift (F7) | Not fixed here; queued for the Phase 7 docs pass |

---

## 8. Phase 4 Definition of Done

1. This plan approved by both members.
2. `PHASE_4_GROUNDING_REPORT.md` exists; tool-layer grounding evidence consolidated; live-Bob conditional documented with fallback; **no claim of a working live Bob**.
3. Enabled-proxy stub test exists and passes (if A2 approved) — or A2 explicitly deferred with the path recorded as conditional on Q6.
4. All invariants I1–I8 verified with recorded commands and results.
5. Existing suites remain green (138 backend + 48 Python + oracle checks).
6. No change to any frozen contract, formula, fixture or Phase 3 endpoint behaviour.
7. `PHASE_4_COMPLETION_REPORT.md` written with the exit criteria and the Phase 4 status line.
8. No non-blocking finding was silently pulled into Phase 4 scope.

---

## 9. What triggers Phase 5

Phase 5 (Dashboard) may start once §8 is complete. Its first task is finding F1 (Vite proxy configuration), followed by the S1–S14 screens on the existing REST API (`PHASE_1_SYSTEM_DESIGN.md` §8).

---

## 10. Approval items (required before implementation)

| ID | Question | Recommended default |
|---|---|---|
| A1 | Approve the Phase 4 scope as **validation closure only** (no new features)? | Approve |
| A2 | Include the stub-Bob proxy test (P4-R3) in Phase 4? | Approve (small, closes an implemented path, no credentials needed) |
| A3 | Confirm the 8 findings remain triaged out of Phase 4 (per §4)? | Approve |

**Status: PLAN ONLY — no implementation started.**
