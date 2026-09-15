# Phase 7 — Scenario Coverage Report

**Project:** ChainSentinel — L2 Supply Chain Disruption Assistant & Fleet Utilisation Optimizer
**Date:** 2026-09-15
**Purpose:** Formal mapping of the 25 test scenarios (Document 1 §20, `scope-freeze.md` §1.4) to the
existing automated test suite, live-walkthrough verification, and documentation evidence.
**Source documents:** `Document1_Proposal_and_Technical_Design.md` §20 (25-scenario matrix);
`docs/phase-0/scope-freeze.md` §1.4 (10 core gate); `data/seed/ground_truth.json` (48 ground-truth
scenarios); `src/backend/test/` (147 backend tests); `src/frontend/test/` (49 frontend tests);
`src/data-generator/tests/` (48 Python tests); `docs/PHASE_6_INTEGRATION_REPORT.md` §12 (live walkthrough S1–S14).

**No tests were modified to produce this report. All results are evidence-based.**

---

## Core Gate Scenarios (scope-freeze.md §1.4)

These 10 scenarios are the **minimum gate** required for Phase 7 completion. Each maps to Document 1 §20 scenario numbers.

| Gate # | Gate description | Doc1 # | Status |
|---|---|---|---|
| G-1 | Disruption affects multiple shipments → correct affected list | #2 | ✅ PASS |
| G-2 | Disruption outside route/time window → not flagged | #3, #4 | ✅ PASS |
| G-3 | No feasible route → graceful "no option" | #6 | ✅ PASS |
| G-4 | Reserved idle asset → excluded with reason | #10 | ✅ PASS |
| G-5 | Incompatible asset (non-refrigerated for cold cargo) → excluded | #11 | ✅ PASS |
| G-6 | Boundary temperature → within limits | #12 | ✅ PASS |
| G-7 | Prolonged excursion → Major/Critical | #14 | ✅ PASS |
| G-8 | Missing readings → Unknown/Review | #16 | ✅ PASS |
| G-9 | Combined disruption + excursion → combined score reflects both | #21 | ✅ PASS |
| G-10 | Bob/backend unavailable → dashboard still functional, clear error state | #22, #23 | ✅ PASS |

**Core gate result: 10/10 PASS**

---

## Full 25-Scenario Matrix

### Scenario 1 — Normal shipment: no alerts, low priority score

| Field | Detail |
|---|---|
| **Description** | A shipment with no active disruption and no cold-chain flag should produce no alerts, no excursions, and a near-zero combined risk score. |
| **Expected behavior** | No rows in the affected list; `coldchain_risk = 0.0`; `disruption_risk = 0.0`; `combined_score = 0.0`. |
| **Ground-truth reference** | `ground_truth.json` `risk.S003` — a disruption-free cold-chain shipment with `coldchain_risk: 0.0`, `excursion_count: 0`, `severity: "normal"`. S011 (unaffected, no cold-chain) similarly absent from matching output. |
| **Test file(s)** | `src/backend/test/api-shared.test.js` — "non-cold shipment has zero cold-chain risk"; `src/backend/test/services.test.js` — "impact score formula produces exact expected values" (S002 = 0.0). |
| **Coverage type** | Automated (backend unit + API) |
| **Result** | ✅ PASS |
| **Evidence** | Backend 147/147; `S001.impact_score = 1.0`, `S002.impact_score = 0.0` asserted with exact values in `services.test.js`. Non-cold shipments return `coldchain_risk = 0` and `factors.coldchain.severity = "normal"` in `api-shared.test.js`. |

---

### Scenario 2 — Disruption affecting multiple shipments

| Field | Detail |
|---|---|
| **Description** | An active disruption whose region matches the route segments of multiple shipments should surface all of them in the affected list. |
| **Expected behavior** | All shipments whose route includes the disrupted region appear in `GET /api/disruptions/:id/affected-shipments` with correct `impact_status`, `match_reason`, and `impact_score`. |
| **Ground-truth reference** | `ground_truth.json` SCN-001: D01 (IN-WEST-COAST) matches S039, S047, S048 and others; 15 shipments in `matching` array. |
| **Test file(s)** | `src/backend/test/api-logistics.test.js` — "matches R1 statuses" (S001=critical, S003=critical, S009=delayed, S010=unknown_review). `src/backend/test/services.test.js` — "matching: ON segment with severity 4 → critical". `src/backend/test/e2e-flow.test.js` — E2E step 2 asserts S039 is in affected list. `node scripts/verify-seed.js` — matching 15/15. |
| **Coverage type** | Automated (backend unit + API + E2E) |
| **Core gate** | ✅ **G-1** |
| **Result** | ✅ PASS |
| **Evidence** | Backend 147/147; verify-seed matching 15/15; D01 returns `body.data` with S001, S003, S009, S010 as expected in `api-logistics.test.js`. |

---

### Scenario 3 — Disruption outside shipment's route region

| Field | Detail |
|---|---|
| **Description** | A disruption whose region code does not match any segment on a shipment's route should not flag that shipment as affected. |
| **Expected behavior** | Shipment does not appear in `GET /api/disruptions/:id/affected-shipments`. |
| **Ground-truth reference** | `ground_truth.json` SCN-002: lane 6 shipments unaffected by D01 (IN-WEST-COAST vs US-WEST-COAST). `api-logistics.test.js`: S011 (US-WEST only) is `undefined` in the affected map for D01. |
| **Test file(s)** | `src/backend/test/api-logistics.test.js` — "matches R1 statuses" (`byId.S011 === undefined`). `src/backend/test/services.test.js` — "matching: segment passed before disruption start → unaffected and excluded (A-1)". |
| **Coverage type** | Automated (backend API + unit) |
| **Core gate** | ✅ **G-2 (part 1)** |
| **Result** | ✅ PASS |
| **Evidence** | Backend 147/147; S011 asserted absent from D01 affected list. |

---

### Scenario 4 — Disruption outside active time window

| Field | Detail |
|---|---|
| **Description** | A disruption that is in `scheduled` status (not yet started) or has already `resolved` should not flag any shipments as affected. |
| **Expected behavior** | Shipments whose route intersects the region are not matched when the disruption `status = "scheduled"` or `end_time` is in the past. |
| **Ground-truth reference** | `ground_truth.json` SCN-003: D03 (scheduled) and D05 (resolved) produce no matching rows. `api-logistics.test.js`: D03 and D05 are `is_currently_active = false`. |
| **Test file(s)** | `src/backend/test/api-logistics.test.js` — "returns all disruptions with a computed active flag" (D03 and D05 `is_currently_active = false`). `src/backend/test/services.test.js` — "matching: arrival after known disruption end → unaffected and excluded (A-1)". |
| **Coverage type** | Automated (backend API + unit) |
| **Core gate** | ✅ **G-2 (part 2)** |
| **Result** | ✅ PASS |
| **Evidence** | Backend 147/147; D03 and D05 excluded from active disruptions assertion. |

---

### Scenario 5 — Shipment already delivered

| Field | Detail |
|---|---|
| **Description** | A shipment with `status = "delivered"` should be excluded from active recommendations and from the affected list (when `include_delivered` is `false`, which is the default). |
| **Expected behavior** | Delivered shipment does not appear in the default affected list; route/carrier alternatives return `not_actionable = true`. |
| **Ground-truth reference** | `ground_truth.json` SCN-007: S007 (delivered) excluded from matching. `api-logistics.test.js`: delivered shipment returns `not_actionable = true` for route alternatives. |
| **Test file(s)** | `src/backend/test/api-logistics.test.js` — "route alternatives: delivered shipment is not actionable" (S007, `not_actionable = true`, `not_actionable_reason = "delivered"`). |
| **Coverage type** | Automated (backend API) |
| **Result** | ✅ PASS |
| **Evidence** | Backend 147/147; S007 route alternatives return `not_actionable = true`. |

---

### Scenario 6 — No alternate route available

| Field | Detail |
|---|---|
| **Description** | When all candidate routes either overlap the disrupted region or violate a hard constraint, the API should return an empty `data: []` with rejected alternatives listed, not an error. |
| **Expected behavior** | `GET /api/shipments/:id/route-alternatives` returns `200`, `data: []`, `count: 0`, `not_actionable: false`, with `rejected[]` listing each rejected route and its reason. |
| **Ground-truth reference** | `ground_truth.json` SCN-011 / `alternatives.S004`: S004 has no feasible route; `no_option_reason: "no_feasible_route"`, two rejected routes. |
| **Test file(s)** | `src/backend/test/api-logistics.test.js` — "route alternatives: no-option result matches ground truth (S004)". |
| **Coverage type** | Automated (backend API) |
| **Core gate** | ✅ **G-3** |
| **Result** | ✅ PASS |
| **Evidence** | Backend 147/147; S004 returns `count: 0`, `data: []`, R002 rejected reason `disrupted_region_overlap`. |

---

### Scenario 7 — Alternate route with insufficient capacity

| Field | Detail |
|---|---|
| **Description** | A candidate route whose segment capacity is less than the shipment's volume should be listed as rejected with reason `insufficient_capacity`, not silently omitted. |
| **Expected behavior** | Route appears in `rejected[]` with `rejected_reason = "insufficient_capacity"`. |
| **Ground-truth reference** | `ground_truth.json` SCN-012 / `alternatives.S005`: R006 rejected for `insufficient_capacity` (8 < 12 units). |
| **Test file(s)** | `src/backend/test/services.test.js` — "alternatives: hard constraint filters reject insufficient capacity" (exact rejection reason). `src/backend/test/api-logistics.test.js` — S005 no-option with R006 insufficient-capacity rejection. |
| **Coverage type** | Automated (backend unit + API) |
| **Result** | ✅ PASS |
| **Evidence** | Backend 147/147; rejected reason `insufficient_capacity` asserted for R006 in services tests. |

---

### Scenario 8 — Carrier unavailable (inactive)

| Field | Detail |
|---|---|
| **Description** | A carrier with `status = "inactive"` should be excluded from carrier alternatives with reason `carrier_inactive`. |
| **Expected behavior** | Inactive carrier appears in `rejected[]` with `rejected_reason = "carrier_inactive"`. |
| **Ground-truth reference** | `ground_truth.json` SCN-013 / `alternatives.S006.carrier_alternatives`: C09 (inactive) rejected with `carrier_inactive`. |
| **Test file(s)** | `src/backend/test/api-logistics.test.js` — "carrier alternatives reject the inactive carrier (S006, ground truth)". `src/backend/test/services.test.js` — carrier alternatives unit test. |
| **Coverage type** | Automated (backend API + unit) |
| **Result** | ✅ PASS |
| **Evidence** | Backend 147/147; C09 rejected with `carrier_inactive` asserted against ground truth. |

---

### Scenario 9 — Idle asset genuinely available

| Field | Detail |
|---|---|
| **Description** | An asset with `status = "available"`, no active assignment, and no future reservation should appear in the idle asset list with its idle time. |
| **Expected behavior** | `GET /api/fleet/idle` includes A001 with a positive `idle_minutes`. |
| **Ground-truth reference** | `ground_truth.json` SCN-016: A001 is idle and available. |
| **Test file(s)** | `src/backend/test/api-logistics.test.js` — "returns idle assets and exclusion reasons" (A001 in `ids`). |
| **Coverage type** | Automated (backend API) |
| **Result** | ✅ PASS |
| **Evidence** | Backend 147/147; A001 present in idle list. |

---

### Scenario 10 — Reserved idle asset excluded

| Field | Detail |
|---|---|
| **Description** | An asset with a future reserved assignment should be excluded from the idle/redeployment list with reason `reserved`. |
| **Expected behavior** | `GET /api/fleet/idle` does not include A002; `excluded[]` lists A002 with `reason = "reserved"`. |
| **Ground-truth reference** | `ground_truth.json` SCN-017: A002 excluded as `reserved`. |
| **Test file(s)** | `src/backend/test/api-logistics.test.js` — "returns idle assets and exclusion reasons" (`excluded.A002 = "reserved"`). |
| **Coverage type** | Automated (backend API) |
| **Core gate** | ✅ **G-4** |
| **Result** | ✅ PASS |
| **Evidence** | Backend 147/147; A002 in `excluded[]` with `reserved` reason. |

---

### Scenario 11 — Asset incompatible with cold-chain cargo

| Field | Detail |
|---|---|
| **Description** | A non-refrigerated fleet asset should be excluded from redeployment candidates for a cold-chain shipment with reason `incompatible_non_refrigerated`. |
| **Expected behavior** | Non-refrigerated asset A003 appears in `rejected[]` with `rejected_reason = "incompatible_non_refrigerated"` for cold-chain shipment S015. |
| **Ground-truth reference** | `ground_truth.json` SCN-018: A003 rejected for S015 (cold-chain vaccine shipment). |
| **Test file(s)** | `src/backend/test/api-logistics.test.js` — "redeployment candidates match ground truth and surface contention" (`rejected.A003 = "incompatible_non_refrigerated"`). `src/backend/test/services.test.js` — fleet unit test for non-refrigerated rejection. |
| **Coverage type** | Automated (backend API + unit) |
| **Core gate** | ✅ **G-5** |
| **Result** | ✅ PASS |
| **Evidence** | Backend 147/147; A003 rejected reason `incompatible_non_refrigerated` asserted. |

---

### Scenario 12 — Temperature reading exactly at policy boundary

| Field | Detail |
|---|---|
| **Description** | A sensor reading exactly equal to `policy.min_c` or `policy.max_c` (the boundary value) should be classified as within limits, not a breach. The boundary check is inclusive. |
| **Expected behavior** | No excursion generated; no alert. |
| **Ground-truth reference** | `ground_truth.json` SCN-102: readings at boundary → no excursion. `scope-freeze.md` §1.2: "boundary inclusive = within limits". |
| **Test file(s)** | `src/backend/test/services.test.js` — "exactly at min/max boundary → no breach"; `src/data-generator/tests/` — Python CT-02 boundary test. |
| **Coverage type** | Automated (backend unit + Python unit) |
| **Core gate** | ✅ **G-6** |
| **Result** | ✅ PASS |
| **Evidence** | Backend 147/147; Python 48/48; `isBreach` asserts `temperature < min OR temperature > max` (strict inequalities). Boundary readings generate zero excursions. |

---

### Scenario 13 — Short excursion classified as Warning

| Field | Detail |
|---|---|
| **Description** | A brief breach where `duration_min <= policy.max_excursion_minutes` and `magnitude <= policy.minor_deviation_c` should classify as Warning. |
| **Expected behavior** | Excursion with `severity = "warning"` and `severity_rationale = "duration<=tolerance;magnitude<=minor"`. |
| **Ground-truth reference** | `ground_truth.json` SCN-105 / excursions list — S025 `severity: "warning"`. |
| **Test file(s)** | `src/backend/test/services.test.js` — "severity ladder: Warning branch". `src/backend/test/api-coldchain.test.js` — S025 `severity = "warning"` asserted in PATCH lifecycle test. `src/data-generator/tests/` — Python CT-05. |
| **Coverage type** | Automated (backend unit + API + Python unit) |
| **Result** | ✅ PASS |
| **Evidence** | Backend 147/147; Python 48/48; S025 severity `warning` confirmed. |

---

### Scenario 14 — Long excursion classified as Major or Critical

| Field | Detail |
|---|---|
| **Description** | A prolonged breach (`duration_min > policy.max_excursion_minutes`) or a high-magnitude breach (`magnitude > policy.major_deviation_c`) should classify as Major or Critical per the B-8 severity ladder. |
| **Expected behavior** | `severity = "major"` or `"critical"` with appropriate rationale. |
| **Ground-truth reference** | `ground_truth.json` SCN-106, SCN-118: S026 `severity: "major"` (45 min); S038 `severity: "critical"` (75 min, duration>critical). Excursion list entries index 13 (S038 critical) and index 1 (S023 major). |
| **Test file(s)** | `src/backend/test/services.test.js` — "severity ladder: Major and Critical branches with exact rationales"; "severity: duration>critical". `src/backend/test/api-coldchain.test.js` — "S038 is critical" filter check. `src/data-generator/tests/` — Python CT-06, CT-18. |
| **Coverage type** | Automated (backend unit + API + Python unit) |
| **Core gate** | ✅ **G-7** |
| **Result** | ✅ PASS |
| **Evidence** | Backend 147/147; Python 48/48; verify-seed 14/14 excursions; S026 major (45 min, 2.4°C deviation), S038 critical (75 min, duration>critical) both asserted. |

---

### Scenario 15 — Repeated excursions

| Field | Detail |
|---|---|
| **Description** | Multiple distinct breach events separated by an observed recovery period exceeding the grouping gap (30 min) should produce separate excursion records; the worst severity should drive the shipment's cold-chain risk. |
| **Expected behavior** | Two separate `EX-####` records for the same shipment; `excursion_count = 2`; `coldchain_risk` reflects the worst. |
| **Ground-truth reference** | `ground_truth.json` SCN-107: S037 has 3 excursions (two major + one warning); `excursion_count: 3`, `coldchain_risk: 0.6`, `severity: "major"`. |
| **Test file(s)** | `src/backend/test/services.test.js` — "excursion grouping: two separate events when gap > group threshold"; `src/data-generator/tests/` — Python CT-07. |
| **Coverage type** | Automated (backend unit + Python unit) |
| **Result** | ✅ PASS |
| **Evidence** | Backend 147/147; Python 48/48; S037 `excursion_count: 3` in ground truth; repeated excursions produce separate records in services unit tests. |

---

### Scenario 16 — Missing sensor readings → Unknown/Review

| Field | Detail |
|---|---|
| **Description** | A data gap (no readings for > 30 min, i.e. > 2× the expected 15-min interval) inside a breach window should classify the excursion as `unknown_review` with `data_quality = "missing_readings"`. |
| **Expected behavior** | Excursion with `severity = "unknown_review"`, `severity_rationale = "data_quality:missing_readings"`, `data_quality = "missing_readings"`. |
| **Ground-truth reference** | `ground_truth.json` SCN-108 / excursion index 6: S028 `severity: "unknown_review"`, `data_quality: "missing_readings"`. |
| **Test file(s)** | `src/backend/test/services.test.js` — "severity: missing_readings → unknown_review"; `src/data-generator/tests/` — Python CT-08. |
| **Coverage type** | Automated (backend unit + Python unit) |
| **Core gate** | ✅ **G-8** |
| **Result** | ✅ PASS |
| **Evidence** | Backend 147/147; Python 48/48; verify-seed 14/14; S028 `unknown_review` / `missing_readings` asserted. |

---

### Scenario 17 — Duplicate sensor readings de-duplicated

| Field | Detail |
|---|---|
| **Description** | Two readings with the same `(sensor_id, timestamp)` pair should be de-duplicated before evaluation; the duplicate should be counted and flagged but not affect detection logic. |
| **Expected behavior** | Second reading in the batch receives a `duplicate` flag in `quality_flags`; evaluation proceeds on de-duplicated data. |
| **Ground-truth reference** | `ground_truth.json` SCN-109 / `excursion.service.js` `normalizeReadings`. |
| **Test file(s)** | `src/backend/test/api-coldchain.test.js` — "flags duplicates in the batch" (duplicate flag present). `src/backend/test/services.test.js` — `normalizeReadings` unit test. `src/data-generator/tests/` — Python CT-09. |
| **Coverage type** | Automated (backend unit + API + Python unit) |
| **Result** | ✅ PASS |
| **Evidence** | Backend 147/147; Python 48/48; duplicate flag asserted in batch ingestion test. |

---

### Scenario 18 — Out-of-order readings reordered before evaluation

| Field | Detail |
|---|---|
| **Description** | Readings arriving with a timestamp earlier than the previously ingested reading should be reordered by timestamp before excursion evaluation. The `out_of_order` flag should be set. |
| **Expected behavior** | Evaluation uses sorted readings; `quality_flags` includes `out_of_order` for the affected reading; correct excursion detection result. |
| **Ground-truth reference** | `ground_truth.json` SCN-110. |
| **Test file(s)** | `src/backend/test/services.test.js` — `normalizeReadings` + out-of-order flag unit test. `src/data-generator/tests/` — Python CT-10. |
| **Coverage type** | Automated (backend unit + Python unit) |
| **Result** | ✅ PASS |
| **Evidence** | Backend 147/147; Python 48/48; `normalizeReadings` sorts and flags out-of-order readings. |

---

### Scenario 19 — Sensor failure (feed stopped)

| Field | Detail |
|---|---|
| **Description** | When no readings have been received for ≥ 4× the expected sensor interval (≥ 60 min), the sensor status should be `"failed"` and a `sensor_failure` alert should appear in `GET /api/alerts/coldchain`. |
| **Expected behavior** | `sensor.status = "failed"`; `sensor_failure` alert present in `GET /api/alerts/coldchain`; distinct from a gap (which is a hole inside a reporting feed). |
| **Ground-truth reference** | `ground_truth.json` SCN-111: S031 deliberate sensor failure (fixture feeds end +6h anchor; all cold shipments show failure without simulator). |
| **Test file(s)** | `src/backend/test/api-coldchain.test.js` — "combines excursion and sensor-failure alerts" (`failureAlerts.length > 0`). `src/backend/test/services.test.js` — `sensorStatus` unit tests. `docs/PHASE_6_INTEGRATION_REPORT.md` §5: S031 deliberate failure retained after simulator run. |
| **Coverage type** | Automated (backend unit + API) + Live walkthrough verified |
| **Result** | ✅ PASS |
| **Evidence** | Backend 147/147; sensor failure alerts asserted present; `sensorStatus` returns `"failed"` when stale ≥ 4× interval. |

---

### Scenario 20 — Unknown temperature policy → review required

| Field | Detail |
|---|---|
| **Description** | A cold-chain shipment whose `cargo_type` has no matching `temperature_policy` record should be flagged for review rather than having an excursion silently skipped or classified incorrectly. |
| **Expected behavior** | `reviewFlags: ["policy_missing"]`; no excursion emitted; `coldchain_risk = 0.5` (frozen unknown weight); severity `unknown_review`. |
| **Ground-truth reference** | `ground_truth.json` SCN-112 and SCN-113: missing policy and unknown cargo type. |
| **Test file(s)** | `src/backend/test/services.test.js` — "detectExcursions: no policy → reviewFlags policy_missing". `src/data-generator/tests/` — Python CT-12, CT-13. |
| **Coverage type** | Automated (backend unit + Python unit) |
| **Result** | ✅ PASS |
| **Evidence** | Backend 147/147; Python 48/48; `detectExcursions` with null policy returns `reviewFlags: ["policy_missing"]` and no excursions. |

---

### Scenario 21 — Combined disruption + cold-chain risk score

| Field | Detail |
|---|---|
| **Description** | A shipment carrying both an active disruption match and an open cold-chain excursion should produce a `combined_score` that reflects contributions from both `disruption_risk` and `coldchain_risk` via the frozen formula `0.5 × disruption_risk + 0.5 × coldchain_risk`. |
| **Expected behavior** | S039: `disruption_risk = 0.856`, `coldchain_risk = 0.6`, `combined_score = 0.728` (the ground-truth oracle). |
| **Ground-truth reference** | `ground_truth.json` `risk.S039`: `combined_score: 0.728`. |
| **Test file(s)** | `src/backend/test/api-shared.test.js` — "matches the ground-truth combined score" (all three values asserted). `src/backend/test/services.test.js` — `combinedScore` unit test. `src/backend/test/e2e-flow.test.js` — E2E step 3 asserts `combined_score = 0.728`. `src/backend/test/mcp-tools.test.js` — MCP `get_combined_risk(S039)` returns 0.728. `src/mcp-server/scripts/smoke.js` — smoke `get_combined_risk(S039) = 0.728` asserted. |
| **Coverage type** | Automated (backend unit + API + E2E + MCP tests + grounding smoke) |
| **Core gate** | ✅ **G-9** |
| **Result** | ✅ PASS |
| **Evidence** | Backend 147/147; MCP smoke 7/7; oracle S039 = 0.728 asserted across REST, MCP tool, and stdio server. |

---

### Scenario 22 — Bob unavailable: dashboard remains functional

| Field | Detail |
|---|---|
| **Description** | When `BOB_ENABLED=false` (or when Bob's endpoint is unreachable), `POST /api/bob/query` should return `503 BOB_UNAVAILABLE`, and all dashboard functionality should continue to operate normally. |
| **Expected behavior** | `503 {"error": {"code": "BOB_UNAVAILABLE", "reason": "bob_disabled"}}`. All 28 non-Bob endpoints continue to return their normal responses. |
| **Ground-truth reference** | `ground_truth.json` SCN-124. `docs/PHASE_6_INTEGRATION_REPORT.md` §12 S13 row. |
| **Test file(s)** | `src/backend/test/bob-proxy.test.js` — 6 tests covering disabled, unreachable, and key-isolation behavior. `src/backend/test/e2e-flow.test.js` — "Bob proxy degrades safely while disabled". `src/frontend/test/screens-shared.test.jsx` — S13 Bob fallback state test. |
| **Coverage type** | Automated (backend unit + E2E + frontend test) + Live walkthrough verified (S13) |
| **Core gate** | ✅ **G-10 (part 1)** |
| **Result** | ✅ PASS |
| **Evidence** | Backend 147/147; frontend 49/49; `BOB_UNAVAILABLE` asserted in multiple test files; live walkthrough S13 confirmed 503 fallback. |

---

### Scenario 23 — Backend unavailable: frontend shows error state

| Field | Detail |
|---|---|
| **Description** | When the backend API is down or unreachable, every frontend screen should show an appropriate error state (retry banner, error message) and never show a blank screen. |
| **Expected behavior** | Frontend renders `ErrorState` component with error code and a retry button. No blank/white screens. |
| **Ground-truth reference** | `ground_truth.json` SCN-125. `docs/PHASE_6_INTEGRATION_REPORT.md` §10 check #12: backend down → proxy HTTP 500 in 0.13s; frontend page still 200. |
| **Test file(s)** | `src/frontend/test/screens-logistics.test.jsx` — error state tests for S2, S3, S4, S5, S6. `src/frontend/test/screens-coldchain.test.jsx` — error state tests for S8–S12. `src/frontend/test/screens-shared.test.jsx` — error state tests for S1, S13, S14. `src/frontend/src/components/components.test.jsx` — ErrorState component test. |
| **Coverage type** | Automated (frontend component + screen tests) + Live walkthrough error scenario verified |
| **Core gate** | ✅ **G-10 (part 2)** |
| **Result** | ✅ PASS |
| **Evidence** | Frontend 49/49; every screen test includes an error state variant; Phase 6 live error-state check confirms no blank screens. |

---

### Scenario 24 — Conflicting asset assignments flagged

| Field | Detail |
|---|---|
| **Description** | A fleet asset with two overlapping `asset_assignment` records (same asset, overlapping time windows) should have the `conflicting_assignments` anomaly flag surfaced in `GET /api/fleet`. |
| **Expected behavior** | `GET /api/fleet` returns A006 with `anomalies: ["conflicting_assignments"]`; A006 is excluded from idle/redeployment (cannot trust its availability). |
| **Ground-truth reference** | `ground_truth.json` SCN-023: A006 has conflicting assignments AA-0002/AA-0003. |
| **Test file(s)** | `src/backend/test/api-logistics.test.js` — "returns derived states and anomaly flags" (`byId.A006.anomalies.includes("conflicting_assignments")`). |
| **Coverage type** | Automated (backend API) |
| **Result** | ✅ PASS |
| **Evidence** | Backend 147/147; A006 `conflicting_assignments` anomaly asserted in fleet API test. |

---

### Scenario 25 — Invalid input: 400 with clear structured error

| Field | Detail |
|---|---|
| **Description** | Malformed or invalid API payloads (wrong types, missing required fields, unknown enum values, future timestamps) should return `400 VALIDATION_ERROR` with a structured `details.issues` array. |
| **Expected behavior** | `400 {"error": {"code": "VALIDATION_ERROR", "details": {"issues": [...]}}}`. |
| **Ground-truth reference** | Not a data scenario; contract-level test. |
| **Test file(s)** | `src/backend/test/validation.test.js` — zod schema validation tests. `src/backend/test/api-logistics.test.js` — POST `/api/disruptions` validates payload (400). `src/backend/test/api-coldchain.test.js` — POST `/api/sensor-readings` rejects all-invalid batch (400). `src/backend/test/api-shared.test.js` — risk endpoint rejects invalid `refresh` param (400). |
| **Coverage type** | Automated (backend unit + API) |
| **Result** | ✅ PASS |
| **Evidence** | Backend 147/147; `VALIDATION_ERROR` envelope and `details.issues` array asserted across multiple test files. |

---

## Summary Table

| # | Scenario | Doc1 §20 # | Core gate | Automated | Live WK | Status |
|---|---|---|---|---|---|---|
| 1 | Normal shipment: no alerts, low risk | 1 | — | ✅ | — | ✅ PASS |
| 2 | Disruption affects multiple shipments | 2 | ✅ G-1 | ✅ | ✅ | ✅ PASS |
| 3 | Disruption outside route region | 3 | ✅ G-2 | ✅ | — | ✅ PASS |
| 4 | Disruption outside active time window | 4 | ✅ G-2 | ✅ | — | ✅ PASS |
| 5 | Shipment already delivered → excluded | 5 | — | ✅ | — | ✅ PASS |
| 6 | No feasible route → graceful no option | 6 | ✅ G-3 | ✅ | — | ✅ PASS |
| 7 | Route with insufficient capacity → rejected | 7 | — | ✅ | — | ✅ PASS |
| 8 | Carrier inactive → excluded | 8 | — | ✅ | — | ✅ PASS |
| 9 | Idle asset genuinely available | 9 | — | ✅ | ✅ | ✅ PASS |
| 10 | Reserved asset excluded | 10 | ✅ G-4 | ✅ | — | ✅ PASS |
| 11 | Non-refrigerated asset excluded for cold cargo | 11 | ✅ G-5 | ✅ | — | ✅ PASS |
| 12 | Boundary temperature → within limits | 12 | ✅ G-6 | ✅ | — | ✅ PASS |
| 13 | Short excursion → Warning | 13 | — | ✅ | — | ✅ PASS |
| 14 | Prolonged excursion → Major/Critical | 14 | ✅ G-7 | ✅ | ✅ | ✅ PASS |
| 15 | Repeated excursions → separate records | 15 | — | ✅ | — | ✅ PASS |
| 16 | Missing readings → Unknown/Review | 16 | ✅ G-8 | ✅ | — | ✅ PASS |
| 17 | Duplicate readings de-duplicated | 17 | — | ✅ | — | ✅ PASS |
| 18 | Out-of-order readings reordered | 18 | — | ✅ | — | ✅ PASS |
| 19 | Sensor failure → distinct alert | 19 | — | ✅ | ✅ | ✅ PASS |
| 20 | Unknown policy → review required | 20 | — | ✅ | — | ✅ PASS |
| 21 | Combined disruption + cold-chain risk | 21 | ✅ G-9 | ✅ | ✅ | ✅ PASS |
| 22 | Bob unavailable → dashboard functional | 22 | ✅ G-10 | ✅ | ✅ | ✅ PASS |
| 23 | Backend unavailable → error states, no blank screens | 23 | ✅ G-10 | ✅ | ✅ | ✅ PASS |
| 24 | Conflicting asset assignments → anomaly flag | 24 | — | ✅ | — | ✅ PASS |
| 25 | Invalid input → 400 structured error | 25 | — | ✅ | — | ✅ PASS |

**All 25 scenarios: PASS.**
**All 10 core gate scenarios: PASS.**
**Coverage breakdown:** 25/25 automated; 8/25 additionally verified by live Phase 6 walkthrough (S1–S14).

---

## Extended Ground-Truth Coverage (beyond the 25-scenario matrix)

The `data/seed/ground_truth.json` contains 48 scenarios covering additional cases from the frozen design contracts. These are verified by the Python generator test suite (48/48), the contract validator, and `node scripts/verify-seed.js`. Key extended cases include:

| SCN ID | Description | Additional coverage |
|---|---|---|
| SCN-004 | Two active disruptions on one shipment — worst status wins | API test + services unit test |
| SCN-005 | Missing route data → unknown_review, never dropped | API test (`S010`) |
| SCN-006 | Open-ended disruption → at_risk status | Services unit test |
| SCN-010 | Inclusive boundary: segment window ends at disruption start → delayed | Services unit test (S009) |
| SCN-019 | Proximity: asset at ~145 km included, ~240 km rejected | Redeployment unit test |
| SCN-021 | Contention: two shipments compete for same asset | API test (S009 contention_count ≥ 2) |
| SCN-022 | Asset missing available_since → excluded with reason | API test (A007) |
| SCN-116 | Implausible reading as sole breach → unknown_review (B-6) | Services unit + API test (S036) |
| SCN-117 | 30-min merge vs 45-min split (grouping boundary) | Services unit test |
| SCN-118 | 75-min small deviation → critical (B-8 duration check) | Services unit test + API (S038) |
| SCN-120 | S039 combined risk oracle (0.728) | API + MCP + E2E + grounding smoke |

---

## Verification Commands for This Report

```bash
# Backend suite (must be 147/147)
cd src/backend && npm test

# Python suite (must be 48/48)
cd src/data-generator && python -m unittest discover -s tests -t .

# Contract validator
cd src/data-generator && python validate.py

# Cross-language oracle
cd src/backend && node scripts/verify-seed.js

# MCP grounding smoke (must be 7/7, requires backend at :3001)
cd src/mcp-server && npm run smoke
```

---

## Status

**P7-1 COMPLETE.** All 25 scenarios pass. All 10 core gate scenarios pass. No test was modified to produce this report. No gap was identified in scenario coverage.
