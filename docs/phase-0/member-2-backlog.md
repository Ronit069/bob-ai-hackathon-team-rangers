# Member 2 — Cold-Chain, AI and Bob Backlog

**Role:** Cold-Chain, AI and IBM Bob Engineer
**Status:** APPROVED — Phase 1A closure (2026-09-14). Ready to become GitHub Issues after Phase 2 kickoff.
**Epic IDs** match `phase-plan.md` §3.2 (`M2-01`…`M2-12`); sub-tasks are Issue-sized.
**Priority:** `P0` = critical path · `P1` = required for the credible demo · `P2` = polish / if time permits
**Effort:** honest estimate in hours (one person)

---

## 1. Phase 2 — Data (Epics M2-01, M2-02)

| Task ID | Task | Description | Priority | Dependency | Deliverable | Acceptance criteria | Est. |
|---|---|---|---|---|---|---|---|
| M2-01a | Generator skeleton | Seeded RNG, config, fixture writer, scenario-tag helpers | P0 | Phase 1A sign-off | `src/data-generator/coldchain` skeleton | Same seed → byte-identical fixtures | 3 h |
| M2-01b | Policies + cargo profiles | 4 policy rows + 8 cargo-profile rows (B-1) | P0 | M2-01a | `coldchain.json` (policies/profiles) | Thresholds ordered; validator passes | 3 h |
| M2-01c | Sensor feeds + defects | 15-min readings per cold-chain shipment; duplicates, gaps, out-of-order, implausible fixtures | P0 | M2-01b | `coldchain.json` (readings) | All defect types present and tagged | 5 h |
| M2-01d | Excursion scenarios + ground truth | `SCN-101`…`SCN-125` with expected severity/duration/peak/quality | P0 | M2-01c | `ground_truth.json` (cold-chain) | Every CT scenario exists; ground truth re-derivable | 4 h |
| M2-02a | Cold-chain migrations | SQL for readings, policies, excursions, cargo_profile + indexes | P0 | M2-01d, A-3/B-1 approved | `migrations/*.sql` | Matches data contract §17; validator passes | 3 h |
| M2-02b | Seed-loader support (with SH-01) | Load cold-chain fixtures transactionally | P0 | M2-02a | `npm run seed` cold-chain half | Re-seed reproducible; FK integrity holds | 2 h |

## 2. Phase 3 — Vertical slice (Epics M2-03…M2-07)

| Task ID | Task | Description | Priority | Dependency | Deliverable | Acceptance criteria | Est. |
|---|---|---|---|---|---|---|---|
| M2-03a | Ingestion endpoint | `POST /api/sensor-readings` with batch ≤ 500 + partial rejection | P0 | M2-02b | 3.12 | CT-01…CT-04; future timestamps rejected | 4 h |
| M2-03b | Quality checks | Dedupe, reorder, gap/failure/implausible flags | P0 | M2-03a | Quality module | CT-08…CT-11, CT-20 pass | 5 h |
| M2-03c | Sensor health block | Derived `SensorStatus` on 3.13 (B-2) | P1 | M2-03b | 3.13 response | CT-11 statuses correct | 3 h |
| M2-04a | Excursion detection | Threshold + duration + peak + grouping (B-3) | P0 | M2-03b | `EX-####` records | CT-02, CT-05, CT-06, CT-07, CT-21 pass | 6 h |
| M2-04b | Delivery cutoff + post-delivery | A-3/B-5 handling; post-delivery exclusion | P0 | M2-04a | Detection module | CT-15 passes | 2 h |
| M2-05a | Severity ladder (B-8) | Reordered ladder + rationale codes | P0 | M2-04a | Severity module | CT-05, CT-06, CT-22 pass | 4 h |
| M2-05b | Unknown/review handling | Missing data, sensor failure, unknown policy/cargo, implausible (B-6) | P0 | M2-05a | Review states | CT-08, CT-11, CT-12, CT-13, CT-20 pass | 3 h |
| M2-06a | Policy API + versioning | `GET`/`PUT /api/temperature-policies` + audit | P0 | M2-02b | 3.16–3.17 | CT-23 passes | 4 h |
| M2-07a | Alerts endpoint | Open excursions + sensor failures (3.15) | P0 | M2-04a, M2-05a | 3.15 | Alert types distinguishable | 3 h |
| M2-07b | Excursion review lifecycle | `PATCH /api/excursions/:id` (B-7) + audit | P0 | M2-07a | 28 | CT-24 passes | 3 h |

## 3. Phase 4 — Intelligence and Bob (Epics M2-08…M2-10)

| Task ID | Task | Description | Priority | Dependency | Deliverable | Acceptance criteria | Est. |
|---|---|---|---|---|---|---|---|
| M2-08a | Cold-chain risk contribution | Severity weights + factors (RC-3 nested) | P0 | M2-05a, SH-02 | Risk factors | CT-16 passes; arithmetic verified | 4 h |
| M2-08b | Uncertainty + review flags | confidence levels, drivers, `human_review_required` | P1 | M2-08a | Factor block | Unknown states surface correctly | 2 h |
| M2-09a | MCP server + 11 tools | Thin adapter → REST; read-only; JSON passthrough | P0 | M1-04…M1-08, M2-03…M2-07 APIs live | `src/mcp-server` | All 11 tools return correct JSON | 8 h |
| M2-09b | Tool contract tests | Shape + error + read-only assertions per tool | P0 | M2-09a | Test suite | CT-26 passes for tools | 4 h |
| M2-10a | Grounding test harness | Empty/error/unsupported-question cases against tool layer | P0 | M2-09a | Test report | CT-17 tool-layer half passes | 4 h |
| M2-10b | Bob prompt design | System prompt with grounding rules; example question set | P0 | M2-09a | Prompt config | Rules 1–10 encoded; reviewed by M1 | 3 h |

## 4. Phase 5 — Dashboard (Epic M2-11)

| Task ID | Task | Description | Priority | Dependency | Deliverable | Acceptance criteria | Est. |
|---|---|---|---|---|---|---|---|
| M2-11a | Cold-chain overview + alerts | Screens 2.1–2.2 incl. unknown/review badges | P1 | M2-07a, SH-04 | S8 | UI contract §2.1–2.2 acceptance | 6 h |
| M2-11b | Temperature history graph | Policy bounds, gap bands, excursion overlays | P1 | M2-03c | S9 | No interpolation across gaps | 4 h |
| M2-11c | Excursion detail + sensor health | Screens 2.4–2.5 + review actions | P1 | M2-07b, M2-03c | S10–S11 | Lifecycle + audit visible | 4 h |
| M2-11d | Bob chat + evidence panel | Screens 2.7–2.8 with fallback and tool-error cards | P1 | M2-09a, SH-04 | S13 | CT-18 fallback works; evidence matches JSON | 5 h |

## 5. Phase 6 — Testing and docs (Epic M2-12)

| Task ID | Task | Description | Priority | Dependency | Deliverable | Acceptance criteria | Est. |
|---|---|---|---|---|---|---|---|
| M2-12a | Unit + integration tests | Detection, severity, quality, policies | P0 | M2-05b, M2-06a | Test suite | CT-01…CT-15, CT-20…CT-23 pass | 6 h |
| M2-12b | UI state tests | Loading/empty/error/unknown per screen | P1 | M2-11a–d | UI test suite | Cross-screen matrix passes | 3 h |
| M2-12c | Bob grounding tests (live, if available) | Example questions vs evidence | P1 | M2-10b, Q6 | Test report | CT-17 live half or documented limitation | 3 h |
| M2-12d | Docs + demo segment | Module README, cold-chain README sections, demo script part | P1 | M2-12a | Docs | Reviewed by M1; no placeholders | 4 h |

---

## 6. Totals and capacity check

| Phase | Hours |
|---|---|
| 2 — Data | 20 |
| 3 — Vertical slice | 37 |
| 4 — Intelligence/Bob | 25 |
| 5 — Dashboard | 19 |
| 6 — Testing/docs | 16 |
| **Total** | **117 h** |

Member 1's backlog totals ~130 h; the split is balanced (Δ ≈ 13 h, within tolerance). The highest-uncertainty task is **M2-09a (MCP server)** — mitigate by implementing it against frozen REST endpoints early in Phase 4 and by keeping the tool layer testable without Bob credentials.

**If time is short:** follow `scope-freeze.md` §4 — drop P2 first, then reduce Bob chat to the MCP tool layer + CLI demo (M2-09/M2-10 are never cut; M2-11d may slip).

---

## 7. Dependency notes on shared work

| M2 task | Needs |
|---|---|
| M2-02a | A-3/B-1 write-back (done in Phase 1A) + SH-01 loader interface |
| M2-08a | SH-02 combined risk engine; RC-3 nested factors |
| M2-11a–d | SH-04 shared components + API client |
| M2-12a | Shared seeded dataset (SH-01 validator) |
| M2-12c | Bob access (Q6) — otherwise documented limitation |

## 8. Issue-creation checklist (Phase 2 kickoff)

- [ ] One GitHub Issue per row, labelled `owner:M2`, `phase:N`, `priority:P0/P1/P2`
- [ ] Each Issue links to the relevant design doc section and acceptance criteria
- [ ] Dependencies referenced as `blocked by #<issue>`
- [ ] P0 issues added to the project board first; P2 issues parked
