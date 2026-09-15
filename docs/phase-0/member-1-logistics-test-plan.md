# Member 1 — Logistics Test Plan

**Role:** Logistics and Optimisation Engineer
**Status:** DRAFT — test design for the logistics half. No test framework is installed in Phase 0 (by rule); Phase 1 selects one (suggestion: Node's built-in `node:test` for backend units/API, Vitest for UI if the team adds it) and turns these cases into code.
**Fixture convention:** each test references a `scenario_id` (`SCN-###`) in the seeded dataset with stored ground truth (`member-1-logistics-data-design.md` §11).
**Traceability:** maps to the shared core gate (`scope-freeze.md` §1.4) and Document 1's 25-scenario matrix where noted.

---

## 1. Test types and ownership

| Type | Owner | Tooling (Phase 1) |
|---|---|---|
| Unit (matching, scoring, idle, distance) | M1 | `node:test` |
| Integration (service ↔ PostgreSQL) | M1 | `node:test` + test database |
| API contract (endpoint shapes, errors) | M1 (M2 reviews) | `node:test` + `fetch` |
| UI state tests (empty/loading/error) | M1 | Vitest + Testing Library (if adopted) |
| End-to-end (full flow) | Shared | Scripted run / Playwright if adopted |

All tests use the **shared seeded dataset**, never ad-hoc local data (Definition of Done).

---

## 2. Matching tests (R1)

| ID | Scenario | Fixture / input | Expected output | Why it matters | Owner |
|---|---|---|---|---|---|
| LT-01 | Disruption intersects route | `SCN-001`: D01 active (`IN-WEST-COAST`); S102 route R045 contains SEG-012 in that region; `now` inside D01 window | S102 listed; `matched_segment_ids=[SEG-012]`; status `blocked` or `critical`; match reason present; `impact_score` within 0..1 | Core R1 acceptance; a false negative breaks the demo (shared core gate #1; matrix #2) | M1 |
| LT-02 | Disruption does not intersect route | `SCN-002`: D01 active; S140 route R052 has no segment in `IN-WEST-COAST` | `data: []`; S140 not listed; no match reason fabricated | Proves matching is region-scoped, not "flag everything" (matrix #3) | M1 |
| LT-03 | Disruption outside time window | `SCN-003`: D02 `end_time` in the past (status `active` is a data inconsistency fixture) and D03 `start_time` in the future | Neither triggers matching; affected list empty for both; `is_currently_active=false` on both | Window logic correctness (matrix #4; shared core gate #2) | M1 |
| LT-04 | Multiple disruptions on one shipment | `SCN-004`: S102 matches D01 (ON, severity 4 → `critical`) and D05 (BEFORE, known end → `delayed`) | S102 listed once; final status `critical`; `matched_disruptions` contains both with per-disruption status | Aggregation must not drop or double-count (brief requirement) | M1 |
| LT-05 | Missing route data | `SCN-005`: S201 route R071 has zero segments; S202 segment region null | Both → `unknown_review` with `route_data_missing` / `region_missing`; surfaced, not dropped | Data defects must never silently become "unaffected" (brief requirement) | M1 |
| LT-06 | Missing disruption end time | `SCN-006`: D02 `end_time = null`; S177 planned to enter `SG-SINGAPORE` after D02 start | S177 → `at_risk` (arrival may coincide); never assumed safe | Open-ended disruptions are the common real case (brief requirement) | M1 |
| LT-07 | Delivered shipment | `SCN-007`: S250 `status = delivered`, route passes through D01 region | S250 absent from affected list; excluded before matching | Delivered cargo is not actionable (matrix #5) | M1 |
| LT-08 | Passed / upcoming segment (A-1) | `SCN-008`: S088 segment window ended before D01 start; S140 arrival after D03 known end | Both `unaffected` and excluded under A-1; if A-1 rejected → listed as `at_risk` with `exposure_not_confirmed` | Removes false positives; needs joint approval of A-1/A-3 | M1 |
| LT-09 | Timing unknown | `SCN-009`: S260 `planned_departure = null`, route known, position BEFORE | `at_risk`, `timing_basis = "unknown"`, confidence `low` | Conservative inclusion instead of guessing (brief requirement) | M1 |
| LT-10 | Window boundary (inclusive) | `SCN-010`: segment window ends exactly at D01 `start_time` | Overlap → listed (inclusive boundary, documented) | Boundary semantics must be explicit and stable | M1 |

## 3. Route/carrier alternative tests (R2)

| ID | Scenario | Fixture / input | Expected output | Why it matters | Owner |
|---|---|---|---|---|---|
| LT-11 | No alternate route | `SCN-011`: every candidate route for S102's OD overlaps D01 region | `200`, `data: []`, `rejected[]` lists each candidate with `disrupted_region_overlap`; no fabricated option | Graceful no-option is a required demo edge (matrix #6; shared core gate #3) | M1 |
| LT-12 | Insufficient route capacity | `SCN-012`: candidate R100 capacity 10 < S102 volume 12 | R100 only in `rejected[]` with `insufficient_capacity`; never ranked | Capacity is a hard constraint, not a scoring nudge (matrix #7) | M1 |
| LT-13 | Carrier unavailable | `SCN-013`: candidate carrier C02 `status = inactive`; C03 active but its only route overlaps D01 | C02 rejected `carrier_inactive`; C03 rejected `no_feasible_route`; neither in `data[]` | Inactive/unusable carriers must not be recommended (matrix #8) | M1 |
| LT-14 | Missing capacity data | `SCN-014`: candidate route has a segment with `capacity_units = null` | Rejected `missing_capacity_data` (safety-first) | Unknown feasibility is not feasibility | M1 |
| LT-15 | Ranking determinism and weights | `SCN-015`: R089 vs R095 (synthetic values in the alternatives doc) | Exact score matches manual calculation; changing `w1..w4` via config changes ranking deterministically; tie-break stable across runs | Transparent scoring is the innovation claim (P3); tests make it auditable | M1 |

## 4. Fleet and redeployment tests (R3)

| ID | Scenario | Fixture / input | Expected output | Why it matters | Owner |
|---|---|---|---|---|---|
| LT-16 | Idle asset available | `SCN-016`: A114 `available`, no assignments, `available_since` set | In `data[]` with correct `idle_minutes = now − available_since` | Baseline R3 acceptance (matrix #9; shared core gate #4 sibling) | M1 |
| LT-17 | Idle asset reserved | `SCN-017`: A077 `available` but reserved assignment until 09-15 20:00 | In `excluded[]` reason `reserved`, `reserved_until` shown; never in `data[]` | Prevents stealing capacity from commitments (matrix #10; shared core gate #4) | M1 |
| LT-18 | Incompatible asset | `SCN-018`: A098 non-refrigerated, cold-chain S102 | Rejected `incompatible_non_refrigerated`; never ranked (matrix #11; shared core gate #5) | Cold-chain safety rule | M1 |
| LT-19 | Asset too far / boundary | `SCN-019`: A202 at 240 km (> 150 radius); A131 at exactly 150.0 km | A202 rejected `outside_radius`; A131 included (inclusive boundary) | Proximity rule and documented boundary | M1 |
| LT-20 | No asset available | `SCN-020`: all assets assigned/reserved/maintenance | `data: []`; `rejected[]`/`excluded[]` explain every asset; UI shows no-option message | Graceful no-option (brief requirement) | M1 |
| LT-21 | Multiple shipments compete for one asset | `SCN-021`: A114 is top-3 for S102 and S140 | Both shipment responses include A114 with `contention_count >= 2`; no automatic allocation occurs | Honest contention handling; prevents silent bias (brief requirement) | M1 |
| LT-22 | Missing availability timestamp | `SCN-022`: A150 `status=available`, `available_since=null` | Excluded `missing_availability_timestamp`; anomaly flagged; idle never guessed | Data integrity over convenience | M1 |
| LT-23 | Conflicting assignments | `SCN-023`: two overlapping assignments for A160 | Asset flagged `conflicting_assignments`; excluded from redeployment until resolved; no silent resolution | Matrix #24; conflicts must be visible | M1 |

## 5. UI, API and end-to-end tests

| ID | Scenario | Fixture / input | Expected output | Why it matters | Owner |
|---|---|---|---|---|---|
| LT-24 | UI empty/loading/error states | All screens §2 of `member-1-logistics-ui.md` | Each screen renders skeleton, empty state and retry banner per the state matrix | Definition of Done requires error states | M1 |
| LT-25 | Decision lifecycle + audit | `SCN-025`: create pending recommendation → accept; then attempt second decision | First decision → `200` + audit record; second → `409`; audit entry immutable and retrievable | Human-in-the-loop proof (P4); shared with M2 | Shared (M1 creates, M2 audits) |
| LT-26 | API contract shapes | All logistics endpoints | Responses match `api-contract.md` shapes; unknown fields rejected; error envelope used for all 4xx/5xx | Contract drift is the top integration risk (R-03) | M1 |
| LT-27 | Backend unavailable | Stop API; load UI screens | Retry banners, no blank screens; dashboard shell intact | Shared core gate #10 | M1 (shared) |

*(LT-24…LT-27 are logistics-side; the shared end-to-end matrix covers combined risk, cold-chain and Bob scenarios.)*

---

## 6. Fixture-to-scenario coverage requirements

The logistics generator must produce, at minimum, one scenario for each: `SCN-001` … `SCN-023` plus `SCN-025`. The validator asserts:
1. every `SCN` exists at least once;
2. stored ground truth matches re-derived expectations for LT-01…LT-23;
3. referential integrity holds (no orphans, no overlapping assignments unless deliberate, contiguous segment `seq`).

---

## 7. Out of scope for this test plan

- Cold-chain, sensor, severity and Bob grounding tests — Member 2 (`member-2` documents).
- Performance/load testing — not an MVP requirement.
- Security testing — single-operator MVP, documented limitation.
