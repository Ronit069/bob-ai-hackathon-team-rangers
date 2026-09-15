# Member 1 — Logistics Backlog

**Role:** Logistics and Optimisation Engineer
**Status:** DRAFT — ready to become GitHub Issues after Phase 0 sign-off (`phase-0-review-checklist.md` §10). Epic IDs (`M1-01`…`M1-11`) match `phase-plan.md` §3.1; sub-tasks are Issue-sized.
**Priority:** `P0` = critical path (demo breaks without it) · `P1` = required for the credible demo · `P2` = polish / if time permits
**Effort:** honest engineering estimate in hours (one person)

---

## 1. Phase 1 — Data (Epics M1-01, M1-02)

| Task ID | Task | Description | Priority | Dependency | Deliverable | Acceptance criteria | Est. |
|---|---|---|---|---|---|---|---|
| M1-01a | Generator skeleton | Seeded RNG, config, fixture writer, schema-shape helpers | P0 | P0-10 approval | `src/data-generator/` skeleton | Same seed → byte-identical fixtures | 3 h |
| M1-01b | Lanes, routes, segments, carriers | 6 lanes, 12–16 segments, 8–10 carriers, contiguous `seq`, region vocabulary | P0 | M1-01a | `logistics.json` (routes part) | Validator: ≥2 segments/route, unique seq, regions valid | 5 h |
| M1-01c | Shipments, assignments, fleet assets | 40–60 shipments (15–20% cold-chain), 20–30 assets, assignments incl. reserved/maintenance/conflict fixtures | P0 | M1-01b | `logistics.json` (rest) | Capacity/refrigeration/state fixtures match `scope-freeze.md` §1.3 | 5 h |
| M1-01d | Disruption + scenario fixtures | D01–D05 and `SCN-001`…`SCN-023` edge scenarios | P0 | M1-01c | Scenario-tagged fixtures | Every test-plan scenario exists at least once | 4 h |
| M1-01e | Ground truth + scenario metadata | Store expected `impact_status`/matching results per scenario | P0 | M1-01d | `ground_truth.json` | Validator re-derives and matches ground truth | 2 h |
| M1-02a | Logistics migrations | SQL migrations for 7 logistics entities (+A-3 fields if approved) | P0 | P0-10, A-3 decision | `migrations/*.sql` | Matches `data-contract.md`; validator passes | 4 h |
| M1-02b | Seed-loader support (with SH-01) | Load logistics fixtures transactionally | P0 | M1-01e, M1-02a | `npm run seed` logistics half | Re-seed reproducible; FK integrity holds | 2 h |

## 2. Phase 2 — Vertical slice (Epics M1-03, M1-05, M1-06)

| Task ID | Task | Description | Priority | Dependency | Deliverable | Acceptance criteria | Est. |
|---|---|---|---|---|---|---|---|
| M1-03a | Disruption CRUD API | POST/GET/PATCH + validation + audit + 409 duplicate | P0 | M1-02b | Endpoints 3.1–3.3 | LT-03; audit records written | 5 h |
| M1-03b | Affected-shipment matching (frozen baseline) | Region match + active window + impact score | P0 | M1-03a | Endpoint 3.4 | LT-01, LT-02, LT-07 pass | 5 h |
| M1-03c | Impact status refinement | `impact_status`, `matched_disruptions`, `timing_basis` (A-1/A-2) | P1 | M1-03b + A-1/A-2 approval | Updated 3.4 response | LT-04…LT-10 pass | 3 h |
| M1-05a | Shipment list/detail API | Filters, embedded route/carrier/segments, derived route capacity | P0 | M1-02b | Endpoints 3.5–3.6 | Contract shapes verified | 4 h |
| M1-06a | Route alternatives — generation + filters | OD candidates, H1–H6 hard filters, rejection reasons | P0 | M1-03b, M1-05a | Endpoint 3.7 (part) | LT-11, LT-12, LT-14 pass | 5 h |
| M1-06b | Route alternatives — scoring + envelope | Normalisation, weights, factors, reasons, confidence | P0 | M1-06a | Endpoint 3.7 (complete) | LT-15 matches manual calculation | 4 h |
| M1-06c | Carrier alternatives | Candidate carriers, backing route, scoring, rejections | P1 | M1-06b | Endpoint 3.8 | LT-13 passes; dedupe works | 3 h |

## 3. Phase 3 — Intelligence (Epics M1-07, M1-08, M1-06d)

| Task ID | Task | Description | Priority | Dependency | Deliverable | Acceptance criteria | Est. |
|---|---|---|---|---|---|---|---|
| M1-07a | Fleet states + idle API | Derived states, `available_since` rules, exclusions, `GET /api/fleet` (A-6) | P0 | M1-02b | Endpoints 3.9 + 4.1 | LT-16, LT-17, LT-22 pass | 5 h |
| M1-07b | Compatibility + distance | Capacity/refrigeration/haversine + radius config | P0 | M1-07a | Compatibility module | LT-18, LT-19 pass | 3 h |
| M1-08a | Redeployment ranking + contention | Formula, tie-breaks, `contention_count` | P0 | M1-07b, M1-03b | Endpoint 3.10 | LT-20, LT-21 pass | 4 h |
| M1-06d | Recommendation creation (A-5) | `POST /api/recommendations` + fleet convenience; server-side score recompute | P0 | M1-06b, M1-08a + A-5 approval | Endpoints 4.4–4.5 | LT-25 creation half passes | 3 h |

## 4. Phase 4 — Dashboard (Epic M1-09)

| Task ID | Task | Description | Priority | Dependency | Deliverable | Acceptance criteria | Est. |
|---|---|---|---|---|---|---|---|
| M1-09a | Disruption list + create screens | Table, filters, form, validation errors | P0 | M1-03a, SH-04 | Screens 2.1–2.2 | UI contract §2.1–2.2 acceptance | 5 h |
| M1-09b | Affected shipments screen | Ranked table, status badges, match reasons | P0 | M1-03c, SH-04 | Screen 2.3 | LT-24 states; empty no-impact state | 4 h |
| M1-09c | Shipment detail (route tab) | Header, segment timeline, planned/actual, tabs scaffold | P0 | M1-05a, SH-04 | Screen 2.4 | Read-only delivered banner works | 5 h |
| M1-09d | Route/carrier comparison + decisions | Ranked cards, factor lists, rejected panel, create→decide flow | P0 | M1-06c, M1-06d, SH-04 | Screen 2.5 | LT-25 UI half; 409 refresh | 6 h |
| M1-09e | Fleet utilisation + idle screens | State table, anomalies, idle tab, excluded panel | P1 | M1-07a (A-6 approval), SH-04 | Screens 2.6–2.7 | UI contract §2.6–2.7 acceptance | 5 h |
| M1-09f | Redeployment drawer | Ranked candidates, contention warning, create→decide | P1 | M1-08a, M1-09c | Screen 2.8 | Contention + 409 refresh work | 3 h |

## 5. Phase 5 — Integration (Epic M1-X)

| Task ID | Task | Description | Priority | Dependency | Deliverable | Acceptance criteria | Est. |
|---|---|---|---|---|---|---|---|
| M1-X01 | Cross-domain wiring | Shipment IDs into risk engine; disruption impact into combined score; fleet target from M2 sensor shipments | P0 | M1-06d, SH-02 | Integrated flows | Combined score uses logistics inputs | 4 h (shared) |
| M1-X02 | Error handling + polish pass | Consistent error envelopes, empty states, polling/refresh strategy | P1 | All M1 screens | Integrated UI | No blank screens on failure | 4 h |

## 6. Phase 6 — Testing (Epic M1-10)

| Task ID | Task | Description | Priority | Dependency | Deliverable | Acceptance criteria | Est. |
|---|---|---|---|---|---|---|---|
| M1-10a | Unit tests | Matching, scoring, idle, distance, boundaries | P0 | M1-03c, M1-06b, M1-08a | Test suite | LT-01…LT-23 pass | 6 h |
| M1-10b | API contract tests | Shapes, errors, status codes, validation | P0 | All endpoints | Contract suite | LT-26 passes | 4 h |
| M1-10c | UI state tests | Loading/empty/error per screen | P1 | M1-09a–f | UI test suite | LT-24 passes | 3 h |
| M1-10d | End-to-end logistics scenarios | Core gate + LT-25/LT-27 + matrix #2–#11 | P0 | M1-X02 | E2E run + report | Core gate passes; failures documented | 4 h (shared) |

## 7. Phase 7 — Docs and demo (Epic M1-11)

| Task ID | Task | Description | Priority | Dependency | Deliverable | Acceptance criteria | Est. |
|---|---|---|---|---|---|---|---|
| M1-11a | Module README + API docs | Logistics module docs, endpoint examples | P1 | M1-10b | `src/backend/src/logistics/README.md` | Reviewed by M2 | 2 h |
| M1-11b | Submission docs support | README logistics sections; problem-statement/solution-overview input | P1 | M1-10d | Doc sections | No placeholder text | 3 h |
| M1-11c | Demo segment prep | Disruption→impact→alternatives→fleet script + rehearsal | P0 | M1-10d | Demo script section | Runs live twice | 3 h |

---

## 8. Totals and capacity reality check

| Phase | Hours |
|---|---|
| 1 — Data | 25 |
| 2 — Vertical slice | 29 |
| 3 — Intelligence | 15 |
| 4 — Dashboard | 28 |
| 5 — Integration | 8 |
| 6 — Testing | 17 |
| 7 — Docs/demo | 8 |
| **Total** | **130 h** |

**Reality check:** 130 h for Member 1 (and a similar figure for Member 2) is a 3–4 day full-time sprint for each person, or ~7 days part-time. If the event is shorter:

1. Follow the cut order in `scope-freeze.md` §4 (drop `P2` first, then reduce UI to the 6 essential screens).
2. Minimum viable M1 path (~60 h): M1-01a/b/c/d/e, M1-02a/b, M1-03a/b, M1-05a, M1-06a/b, M1-07a/b, M1-08a, M1-09a/b/c, M1-10a/d, M1-11c.
3. `P1` tasks (M1-03c, M1-06c, M1-06d, M1-09e/f, M1-10c, M1-11a/b) are the first to slip — never the `P0` path.

---

## 9. Dependency notes on shared work

| M1 task | Needs from shared/M2 |
|---|---|
| M1-01e, M1-02b | SH-01 seed loader + validator interface |
| M1-03c | Joint approval of A-1/A-2 (matching refinement) |
| M1-06d | Joint approval of A-5 (recommendation creation) |
| M1-09a–f | SH-04 shared components + API client |
| M1-X01 | SH-02 combined risk engine; M2 sensor-to-shipment links |
| M1-10d | Shared end-to-end matrix and Bob-disabled scenario |

---

## 10. Issue-creation checklist (after Phase 0 sign-off)

- [ ] One GitHub Issue per row, labelled `owner:M1`, `phase:N`, `priority:P0/P1/P2`
- [ ] Each Issue body links to the relevant design doc section and acceptance criteria
- [ ] Dependencies referenced as `blocked by #<issue>`
- [ ] P0 issues added to the project board first; P2 issues parked
