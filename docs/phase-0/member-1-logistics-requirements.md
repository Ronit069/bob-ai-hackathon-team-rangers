# Member 1 — Logistics Requirements

**Role:** Logistics and Optimisation Engineer
**Status:** DRAFT — logistics half of Phase 0; requires Member 2 review for integration points
**Sources of truth:** `Industry Problem Statements - 2026.pdf` (L2), `scope-freeze.md`, `data-contract.md`, `api-contract.md`
**Scope of this file:** what the logistics half must do, area by area, with input → processing → output → user value → acceptance criteria → edge cases.

---

## 0. Traceability summary

| Official requirement | Covered by areas |
|---|---|
| R1 — Identify shipments affected by an active disruption | §1 Disruption events, §2 Shipment impact |
| R2 — Recommend re-routing or carrier alternatives | §3 Route alternatives, §4 Carrier alternatives |
| R3 — Identify idle fleet assets for redeployment | §5 Fleet utilisation, §6 Idle assets, §7 Redeployment |
| R2/R3 explanation + approval (P3, P4) | §3, §4, §7 output envelopes + shared recommendation lifecycle |

Out of scope for this design (frozen in `scope-freeze.md` §3): ML, live feeds, PostGIS geometry, multi-hop route construction, global optimisation, auto-execution.

---

## 1. Disruption events

**Input**
- Operator form / `POST /api/disruptions`: `type`, `region_code`, `start_time`, `end_time` (optional), `severity` (1–5), `status`, `description`, `created_by`.
- Existing disruptions for listing/filtering (`GET /api/disruptions?status=active`).

**Processing**
1. Validate against the data contract (region vocabulary, enum values, severity range, time coherence).
2. Evaluate the active window: `status = active AND start_time <= now AND (end_time IS NULL OR end_time >= now)`.
3. Reject duplicate active disruptions with the same region and overlapping window (`409`).
4. Persist; write an append-only audit record (`created` / `activated` / `deactivated`).
5. Maintain a cached set of "active disruption regions" used by matching and alternative filtering (recomputed on read, not stored as truth).

**Output**
- Disruption record (`D##`) with computed `is_currently_active` flag in API responses.
- Active disruptions list for the UI and the Bob tool `get_active_disruptions`.

**User value**
- One source of truth for "what is disrupted right now", replacing manual news/sheet cross-checking; drives every downstream calculation.

**Acceptance criteria**
- CRUD + activation works with validation and audit records.
- A disruption outside its window never appears as active.
- Region values outside the vocabulary are rejected.
- `PATCH` status transitions are coherent (`active → resolved`; resolving twice → `409`).

**Edge cases**
- `end_time` unknown/null → open-ended: stays active until explicitly resolved.
- `start_time` in the future with `status = active` → not currently active (scheduled exposure only).
- Two active disruptions in the same region → allowed; matching aggregates both (see `member-1-disruption-matching.md` §6).
- Disruption resolved mid-demo → removed from active set; existing recommendations remain auditable.
- Invalid region, severity 0/6, `end_time <= start_time` → `400 VALIDATION_ERROR`.

---

## 2. Shipment impact (affected shipment detection)

**Input**
- Active disruption(s): `region_code`, window, `severity`.
- Shipments with `status ∈ {planned, in_transit, delayed}` and their `route_id`, `current_segment_id`, planned times (see amendment A-3 in `member-1-logistics-data-design.md`).
- Route segments: `region_code`, `seq`, `planned_duration_hours`, `dest_lat/lon`.

**Processing**
- Deterministic matching (full algorithm in `member-1-disruption-matching.md`):
  1. Match route segments by `region_code` (region-level string match, no geometry).
  2. Derive the shipment's planned window on each matched segment from `planned_departure` + cumulative segment durations.
  3. Compare windows (passed / current / upcoming / overlapping) with the disruption window.
  4. Classify `impact_status`: `unaffected | at_risk | delayed | blocked | critical | unknown_review`.
  5. Compute `impact_score` (frozen formula) and list `matched_disruptions`.
  6. Aggregate multiple disruptions by worst status.

**Output**
- Affected shipment list: shipment + `impact_status` + `match_reason` + `matched_segment_ids` + `matched_disruptions` + `impact_score` + `impact_factors`.
- Sorted by `impact_score` desc, then `impact_status` precedence, then `deadline` asc.

**User value**
- Replaces manual route-list grepping; gives the operator the blast radius of a disruption in one ranked list.

**Acceptance criteria**
- Frozen matching rule (`scope-freeze.md` §1.2) implemented exactly; test cases LT-01…LT-08 pass.
- Delivered and cancelled shipments never appear.
- Missing route/segment data → `unknown_review`, never silently "unaffected".
- Response includes a human-readable `match_reason` for every row (no bare booleans).

**Edge cases**
- Segment already passed before the disruption started (refined behaviour → `unaffected`; see amendment A-1).
- Shipment planned to enter the region after a known `end_time` (→ `unaffected` under A-1).
- `end_time` unknown → future exposure counts as `at_risk`.
- Shipment currently on the matched segment → `blocked` (or `critical` at severity ≥ 4).
- Missing planned times → `at_risk` with low confidence, `timing_basis = "unknown"`.
- Route with no segments / unresolvable region → `unknown_review`.
- Multiple disruptions → worst status wins; all matched disruption IDs returned.

---

## 3. Route alternatives

**Input**
- Affected shipment (`route_id`, origin/destination nodes, `volume_units`, `deadline`).
- Candidate routes with the same origin/destination nodes, their segments, carriers, costs, durations, capacities.
- Active disruption regions (triggering disruption + others).

**Processing**
1. Generate candidates: same OD, `route.status = active`, `route.id != current`, carrier active.
2. Hard filters: avoid the triggering disruption region; `route_capacity = min(segment.capacity_units) >= volume`; complete capacity data.
3. Rank survivors with the frozen weighted score (`scope-freeze.md` §1.2) over cost, ETA, capacity margin, residual risk (+ optional carrier reliability term, amendment A-4).
4. Record rejected candidates with machine reason codes.
5. Build the explanation envelope (`reasons`, `constraints`, `estimated_eta`, `estimated_cost`, `risk`, `confidence_or_uncertainty`).

**Output**
- Ranked route options (`data[]`), rejected list (`rejected[]`), each with score and factor breakdown.
- Graceful no-option response (`data: []` + rejection reasons).

**User value**
- Turns "call a few carriers and guess" into a ranked, justified shortlist with visible trade-offs.

**Acceptance criteria**
- Infeasible options never appear in `data[]` — they appear in `rejected[]` with a reason.
- Every returned option exposes cost/ETA deltas vs the current route and the constraints checked.
- No-option case is a valid `200` response, not an error.
- Ranking matches the manual calculation on seeded fixtures (LT-09…LT-12).

**Edge cases**
- No route with the same OD exists → no-option response with reason `no_candidate_routes`.
- All candidates overlap the disrupted region → all rejected, no-option.
- Missing capacity data on a candidate → rejected with `missing_capacity_data` (safety-first, documented).
- Single candidate → score normalised with the single-candidate rule; confidence `medium`.
- Current route itself inactive/carrier inactive → still excluded from alternatives (it is not an "alternative").
- Multi-hop rerouting (combining routes) → explicitly out of MVP.

---

## 4. Carrier alternatives

**Input**
- Affected shipment (OD pair, volume, cold-chain flag).
- Carriers with `service_regions`, `modes`, `capacity_units`, `reliability_score`, `status`.
- Each carrier's feasible routes for the OD pair.

**Processing**
1. Candidate carriers: `status = active`, serves origin and destination regions, mode overlap with the lane, capacity ≥ volume, not the current carrier.
2. For each carrier, select its best feasible route for the OD pair (same hard filters as §3).
3. Score with the same formula; factor in carrier reliability (amendment A-4; informational if not approved).
4. Explain: carrier reliability, best route cost/ETA, capacity margin, residual risk, rejected carriers with reasons.

**Output**
- Ranked carrier options with the backing route shown, factor breakdown, and confidence.

**User value**
- Avoids manual carrier phone calls; shows *why* one carrier beats another, not just a name.

**Acceptance criteria**
- Inactive carriers and carriers without a feasible route never appear in `data[]`.
- Every option shows the route it would use, cost, ETA, capacity margin, reliability.
- No-option case handled gracefully (LT-13, LT-14).

**Edge cases**
- Carrier serves the region but has no active route for the OD pair → rejected `no_feasible_route`.
- Carrier at capacity for the lane → rejected `insufficient_capacity`.
- Current carrier also appears as a candidate route operator → excluded from alternatives.
- Duplicate carriers offering the same route → dedupe by `(carrier_id, route_id)`.
- Reliability data missing → treated as unknown, confidence reduced (never invented).

---

## 5. Fleet utilisation

**Input**
- All fleet assets (`status`, location, capacity, refrigeration).
- All assignments (`asset_id`, `shipment_id`, window, `reserved`, `status`).
- Current time.

**Processing**
1. Derive each asset's operational state: `available`, `assigned`, `reserved`, `maintenance`, `retired`.
2. Compute `idle_minutes = now − available_since` for available assets with no active or reserved assignment.
3. Compute utilisation view: assigned minutes vs available window (informational metric; no ML).
4. Surface data anomalies: missing `available_since`, overlapping assignments, stale assignments past `end_time` without completion.

**Output**
- Fleet utilisation list: per asset — state, current location/region, capacity, refrigeration, idle time, next assignment (derived), anomaly flags.
- Filterable by region, type, state.

**User value**
- Fleet managers finally see idle capacity system-wide instead of relying on memory and phone calls.

**Acceptance criteria**
- Derived states match the fixtures exactly (LT-15…LT-17).
- A reserved asset is never shown as idle.
- Anomalies are flagged, never silently resolved (scenario 24).

**Edge cases**
- Asset `available` but missing `available_since` → anomaly `missing_availability_timestamp`; excluded from idle ranking with reason.
- Asset with an assignment whose `end_time` has passed but `status` is still `active` → flagged `stale_assignment`, treated as not idle until corrected.
- Overlapping assignments for one asset → flagged `conflicting_assignments` (test fixture).
- `maintenance`/`retired` assets → excluded from idle and redeployment, still visible in utilisation.
- Asset never assigned → idle since `created_at` fallback only if `available_since` is set by the generator; otherwise anomaly.

---

## 6. Idle assets

**Input**
- Fleet utilisation state (derived in §5).
- Optional filters: `region_code`, `min_idle_minutes`.

**Processing**
- Apply the frozen idle rule: `status = available` AND no active assignment AND not reserved (`reserved = true AND end_time >= now`).
- Compute idle duration; sort desc; include exclusion reasons for near-miss assets (reserved, assigned, maintenance, missing timestamp).

**Output**
- `data[]` idle assets with `idle_minutes`; `excluded[]` with machine reasons.

**User value**
- Prevents false "available" signals — the single biggest cause of bad redeployment decisions.

**Acceptance criteria**
- Reserved assets appear in `excluded[]` with `reserved` and `reserved_until`, never in `data[]` (LT-16).
- Idle time is correct to the minute on fixtures.
- Region filter works against `current_region_code`.

**Edge cases**
- Asset idle 5 minutes vs 5 hours → both idle, ranking favours longer idle.
- Future assignment starts in 10 minutes → still reserved, excluded.
- Asset currently assigned but assignment ends in 2 minutes → not idle yet (no look-ahead scheduling in MVP).
- No idle assets at all → empty list + `excluded[]` reasons.

---

## 7. Redeployment recommendations

**Input**
- Affected shipment (target location, volume, cold-chain flag).
- Idle assets from §6.
- Configurable `REDEPLOY_RADIUS_KM` (default 150).

**Processing**
1. Compatibility filter: capacity ≥ volume; cold chain → refrigerated; distance ≤ radius; asset not maintenance/retired.
2. Rank with the transparent formula (`member-1-fleet-redeployment.md` §6): proximity, idle time, capacity fit.
3. Detect contention: assets that are top candidates for multiple affected shipments.
4. Build the explanation envelope and rejected list.

**Output**
- Ranked candidates with `distance_km`, `idle_minutes`, `capacity_fit`, `contention_count`, confidence; rejected list with reasons.
- Optional creation of a pending `fleet_redeployment` recommendation for human decision (creation endpoint — amendment A-5).

**User value**
- Converts idle cost into recovered capacity, with proximity/compatibility justification the operator can audit.

**Acceptance criteria**
- Incompatible assets (non-refrigerated for cold cargo) never appear in `data[]` (LT-18).
- Distance filter enforced with the configured radius (LT-19).
- No asset available → graceful empty response with reasons (LT-20).
- Multi-shipment contention surfaced, not silently auto-allocated (LT-21).
- Human decision required before any status change; audit record written (shared P4).

**Edge cases**
- Asset exactly at the radius boundary → included (inclusive boundary, documented).
- Shipment has no `current_segment_id` → target = first segment destination, `target_approximate = true`, confidence reduced.
- Asset in another region but within radius → included (distance is the criterion, region is informational).
- Several assets with identical scores → deterministic tie-break: distance asc, then `asset_id` asc.
- Multiple shipments competing for one asset → each shipment sees it; `contention_count` > 1; allocation is manual in MVP.

---

## 8. Open integration points for Member 2

| # | Point | Needs from Member 2 |
|---|---|---|
| I1 | Combined risk input | `disruption_risk` produced by logistics matching (impact score + affected flag); severity weighting proposal in `member-1-disruption-matching.md` §5.3 |
| I2 | Recommendation envelope consistency | Agree that `factors`/`constraints_checked`/`rejected_alternatives` JSON keys are the shared explanation format across domains |
| I3 | Recommendation creation gap | Joint approval of amendment A-5 (`POST /api/recommendations`) |
| I4 | Audit write path | Shared service contract for `AuditRecord` writes from logistics actions |
| I5 | UI shell | Shared nav/API client/state components (SH-04) before logistics screens are wired |
