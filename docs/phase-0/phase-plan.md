# Phase 0 — Phase Plan and Task Board

**Status:** DRAFT — Phase 1 must not start until both members approve (`phase-0-review-checklist.md`)

---

## 1. Phase overview and gates

| Phase | Goal | Primary outputs | Gate to exit |
|---|---|---|---|
| 0 — Scope and contracts | Freeze scope, architecture, data and API contracts, ownership | This `docs/phase-0/` set + repo bootstrap | Both members approve; Phase 0 checklist complete |
| 1 — Data | Seeded, validated synthetic datasets for both domains | Generators, migrations, seed loader, validator report | All required scenario types present; validator passes |
| 2 — Vertical slices | Each member independently demoable end to end | R1–R6 first working endpoints + minimal UI per domain | Each slice runs against seeded data without the other domain |
| 3 — Intelligence | Ranking, severity, combined risk, Bob tools | Recommendations with factors, severity ladder, risk engine, MCP server | Combined score matches manual calculation; grounding tests pass |
| 4 — Dashboard | Full control-tower UI | All MVP screens on real APIs with empty/loading/error states | No screen uses mock data |
| 5 — Integration | One coherent application | End-to-end flow disruption → recommendation → decision | Demo flow works start to finish, live |
| 6 — Testing | Verified behaviour and edge cases | Logistics, cold-chain/Bob, end-to-end test runs | Core gate scenarios pass; failures documented |
| 7 — Demo and submission | Complete, honest submission package | Template docs, README, demo video, screenshots, deck, validation green | Submission checklist 100% |

**Timeline note:** the event deadline is unknown (open question Q4). The plan is deadline-agnostic and gate-based. Document 2's 7-day plan is the default assumption; the 3-day plan is only viable if Phase 1 datasets are cut to the §1.3 minimums. No phase may be skipped — only scope-cut per `scope-freeze.md` §4.

---

## 2. Phase 0 task board

Tasks P0-01 to P0-07 were produced by the Phase 0 inspection; they are **pending both members' review**, not done.

| Task ID | Task | Owner | Reviewer | Priority | Dependency | Deliverable | Acceptance criteria |
|---|---|---|---|---|---|---|---|
| P0-01 | Project inspection | Agent (for team) | Both | High | — | `project-inspection-report.md` | Conflicts and gaps documented; no existing work altered |
| P0-02 | Requirements matrix | Agent (for team) | Both | High | P0-01 | `requirements-matrix.md` | All six mandatory requirements traced to official source with evidence |
| P0-03 | Scope freeze | Agent (for team) | Both | High | P0-02 | `scope-freeze.md` | MVP / if-time / future boundaries and cut order agreed |
| P0-04 | Architecture decision | Agent (for team) | Both | High | P0-02 | `architecture-decision-record.md` | One stack selected; Bob boundary and fallback defined |
| P0-05 | Data contract | Agent (for team) | Both | High | P0-04 | `data-contract.md` | 13 entities with IDs, types, validation, examples |
| P0-06 | API contract | Agent (for team) | Both | High | P0-05 | `api-contract.md` | Every endpoint has request/response/errors/owner/dependency; tool map frozen |
| P0-07 | Team ownership + risk register | Agent (for team) | Both | High | P0-02 | `team-ownership.md`, `risk-register.md` | Ownership matches brief; all required risks covered |
| P0-08 | Repo bootstrap from official template | SH | Both | High | P0-03 approval | Public repo with template structure; official PDFs copied to `docs/reference/`; `.env.example` placeholder | Template files intact; no `[placeholder]` left in `submission.yaml` where known; validation action runs |
| P0-09 | Fill `submission.yaml` skeleton | SH | Both | Medium | P0-08, Q2 answered | `submission.yaml` | Required fields filled with real team data; valid YAML |
| P0-10 | Phase 0 sign-off | Both | Both | High | P0-01…P0-09 | Signed `phase-0-review-checklist.md` | Both members approve scope, architecture, contracts, ownership |

---

## 3. Build backlog (Phases 1–7)

### 3.1 Member 1 — Logistics and Optimisation

| Task ID | Task | Owner | Reviewer | Priority | Dependency | Deliverable | Acceptance criteria |
|---|---|---|---|---|---|---|---|
| M1-01 | Logistics dataset generator | M1 | M2 | High | P0-10 | Python generator → `data/seed/logistics.json` | Seeded; all logistics scenario types present (multi-shipment disruption, no-alternative, reserved asset, incompatible asset, out-of-window) |
| M1-02 | Schema migrations (logistics entities) | M1 | M2 | High | P0-05, P0-10 | SQL migrations | Matches data contract; validator passes |
| M1-03 | Disruption CRUD + activation API | M1 | M2 | High | M1-02 | Endpoints 3.2–3.4 | Validation + audit records; tested |
| M1-04 | Affected shipment detection (R1) | M1 | M2 | High | M1-03 | Endpoint 3.5 | Correct on all disruption scenarios; reason + impact score returned |
| M1-05 | Shipment list/detail API | M1 | M2 | High | M1-02 | Endpoints 3.6–3.7 | Filters work; detail resolves route/carrier/segments |
| M1-06 | Route + carrier alternatives (R2) | M1 | M2 | High | M1-04 | Endpoints 3.8–3.9 | Hard constraints filter correctly; ranked with factors; no-option handled |
| M1-07 | Fleet idle detection (R3) | M1 | M2 | High | M1-02 | Endpoint 3.10 | Reserved/assigned excluded with reasons; idle time correct |
| M1-08 | Redeployment ranking (R3) | M1 | M2 | High | M1-06, M1-07 | Endpoint 3.11 | Compatibility + proximity filters correct; ranking matches manual calculation |
| M1-09 | Logistics dashboard screens | M1 | M2 | High | M1-04…M1-08 | React screens | Real APIs; empty/loading/error states present |
| M1-10 | Logistics tests | M1 | M2 | High | M1-04…M1-08 | Test suite | Core gate scenarios 1–5 pass |
| M1-11 | Logistics docs + demo segment | M1 | M2 | Medium | M1-09 | README sections; demo script part | Reviewed by M2 |

### 3.2 Member 2 — Cold-Chain, AI and Bob

| Task ID | Task | Owner | Reviewer | Priority | Dependency | Deliverable | Acceptance criteria |
|---|---|---|---|---|---|---|---|
| M2-01 | Cold-chain dataset generator | M2 | M1 | High | P0-10 | Python generator → `data/seed/coldchain.json` | Seeded; defects + 3 excursion severities + sensor failure + combined-risk case present |
| M2-02 | Schema migrations (cold-chain entities) | M2 | M1 | High | P0-05, P0-10 | SQL migrations | Matches data contract; validator passes |
| M2-03 | Sensor ingestion + quality checks (R4) | M2 | M1 | High | M2-02 | Endpoints 3.12–3.13 | Gaps/duplicates/out-of-order/implausible detected and surfaced |
| M2-04 | Excursion detection (R5) | M2 | M1 | High | M2-03 | Endpoint 3.14 | Boundary inclusive; duration + peak deviation correct; post-delivery excluded |
| M2-05 | Severity classification (R6) | M2 | M1 | High | M2-04 | Severity ladder + rationale | All edge cases in scope freeze §1.2 pass; missing data → Unknown/Review |
| M2-06 | Temperature policy API (R6) | M2 | M1 | High | M2-02 | Endpoints 3.16–3.17 | Versioning works; audit record on update |
| M2-07 | Alerts endpoint | M2 | M1 | Medium | M2-04, M2-05 | Endpoint 3.15 | Excursions and sensor failures distinguished |
| M2-08 | Cold-chain risk factor for P2 | M2 | M1 | High | M2-05 | Severity→risk mapping | Matches scope freeze weights |
| M2-09 | MCP tool server | M2 | M1 | High | M1-04…M1-08, M2-03…M2-07 | `src/mcp-server` | All 11 frozen tools return correct JSON; read-only |
| M2-10 | Grounding tests | M2 | M1 | High | M2-09 | Test report | Bob/tool layer refuses to answer on empty/error; no invented data on tested cases |
| M2-11 | Cold-chain + Bob UI | M2 | M1 | High | M2-03…M2-07 | Screens + graph + alerts + evidence panel | Real APIs; empty/loading/error states present |
| M2-12 | Cold-chain/Bob tests + docs + demo segment | M2 | M1 | Medium | M2-10, M2-11 | Test suite; README; demo script part | Reviewed by M1 |

### 3.3 Shared

| Task ID | Task | Owner | Reviewer | Priority | Dependency | Deliverable | Acceptance criteria |
|---|---|---|---|---|---|---|---|
| SH-01 | Seed loader + validator | SH | Both | High | M1-01, M2-01 | `npm run seed`, `validate.js` | Referential integrity + scenario coverage + ground-truth checks pass |
| SH-02 | Combined risk engine (P2) | SH | Both | High | M1-04, M2-08 | Endpoints 3.18–3.19 | Score arithmetic verified against manual calculation; snapshots persisted |
| SH-03 | Recommendation lifecycle + audit (P4) | SH | Both | High | M1-06, M1-08, M2-05 | Endpoints 3.20–3.22 | Single transition; 409 on repeat; audit append-only |
| SH-04 | Navigation shell + shared UI components | SH | Both | High | P0-10 | Shared layout, API client, states | Consistent across both domains |
| SH-05 | Integration (Phases 2–5 wiring) | SH | Both | High | All above | Working full-stack demo | Disruption → recommendation → decision flow works live |
| SH-06 | End-to-end test matrix (25 scenarios; 10 core gate) | SH | Both | High | SH-05 | Completed matrix | Core gate passes; all others pass or documented |
| SH-07 | `docs/problem-statement.md` + `solution-overview.md` | M1 lead | M2 | Medium | SH-05 | Template docs | No placeholder text; accurate claims |
| SH-08 | `docs/architecture.md` (from ADR) + diagram | M2 lead | M1 | Medium | SH-05 | Template doc | Mermaid diagram + component table + data flow |
| SH-09 | `docs/setup-guide.md` tested on clean terminal | SH | Both | High | SH-05 | Template doc | Fresh-clone run succeeds following the guide exactly |
| SH-10 | README + `submission.yaml` final | SH | Both | High | SH-07…SH-09 | Submission files | No `[` placeholders; validation action green |
| SH-11 | Demo video + ≥3 screenshots | SH | Both | High | SH-05 | `demo/` folder | Video shows real output; screenshots of running app |
| SH-12 | Presentation deck | SH | Both | Medium | SH-05 | `presentation/slides.pdf` | Required order; honest limitations |
| SH-13 | Contribution reports + final rehearsal | SH | Both | High | SH-10…SH-12 | Contribution logs; rehearsal notes | Both present their half without notes |

---

## 4. Integration checkpoints

| # | Checkpoint | Required inputs | Acceptance criteria | Failure recovery |
|---|---|---|---|---|
| 1 | Schema | Data contract approved | Both members can query all 13 tables locally | Joint session before proceeding |
| 2 | Dataset | Both generators + validator | All scenario types present; integrity passes | Patch generator, re-run, re-validate |
| 3 | API | Endpoints match contract | Contract tests pass for every endpoint | Adjust contract jointly; update both sides |
| 4 | Vertical slices | Independent domain slices | Each slice demoable alone against seeded data | Extend Phase 2 by one day; cut an enhancement |
| 5 | Dashboard | All screens on real APIs | No mock data remains | Prioritise the 6 essential screens |
| 6 | Bob | 11 tools + grounding tests | Grounding tests pass; no hallucination on tested cases | Reduce tool set only if necessary — never fake answers |
| 7 | End-to-end | Full flow wired | Disruption → recommendation → decision live | Fix the broken link in isolation |
| 8 | Final demo | Rehearsed run-through | Both members present without notes | One more rehearsal; trim scope |

---

## 5. Definition of Done (applies to every task)

A task is complete only when:
1. Code is committed on a feature branch and merged via PR with the other member's review.
2. Input/output is documented (module README or docstring).
3. The normal case works against the **shared seeded dataset** (not ad-hoc local data).
4. Relevant edge cases from the scope freeze are handled.
5. At least one test exists and passes.
6. An error state exists (API error response or UI error state).
7. Evidence exists (API example or screenshot).
8. The feature appears in at least one demo scenario or is explicitly marked backup/future.

---

## 6. Submission template mapping (which phase produces which required file)

| Required file | Drafted in | Finalised in |
|---|---|---|
| `submission.yaml` | Phase 0 (P0-09) | Phase 7 (SH-10) |
| `README.md` | Phase 3 (per-domain sections) | Phase 7 (SH-10) |
| `docs/problem-statement.md` | Phase 0 (requirements matrix source) | Phase 7 (SH-07) |
| `docs/solution-overview.md` | Phase 0 (scope freeze source) | Phase 7 (SH-07) |
| `docs/architecture.md` | Phase 0 (ADR source) | Phase 7 (SH-08) |
| `docs/setup-guide.md` | Phase 5 | Phase 7 (SH-09, tested clean) |
| `src/` code | Phases 1–6 | Phase 7 freeze |
| `demo/` video + screenshots | Phase 6 rehearsal | Phase 7 (SH-11) |
| `presentation/slides.pdf` | Phase 6 | Phase 7 (SH-12) |

---

## 7. Immediate next actions after approval

1. Both members read `phase-0-review-checklist.md` and sign off (P0-10).
2. Bootstrap the repo from the official template (P0-08); copy official PDFs to `docs/reference/`.
3. Create GitHub Issues for M1-01…SH-13 from §3 (labels: owner, phase).
4. Start Phase 1 with both generators in parallel (M1-01, M2-01) — nothing else until SH-01 passes.
