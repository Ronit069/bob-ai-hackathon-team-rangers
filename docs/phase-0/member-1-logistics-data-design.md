# Member 1 — Logistics Data Design

**Role:** Logistics and Optimisation Engineer
**Status:** DRAFT — elaborates the shared `data-contract.md` for the logistics domain. It does **not** replace or silently change the shared contract. Additive proposals are recorded in §12 and require joint approval.
**Canonical schema:** `docs/phase-0/data-contract.md` (frozen field names, types, IDs, enums)
**This file adds:** per-field rationale, logistics validation detail, derived-field definitions, fixture metadata rules, and proposed additive fields.

---

## 0. Design rules

1. Field names and enums come from the shared data contract — this file never renames them.
2. A field is added only if a requirement or a test needs it. Every field below has a "why needed" justification.
3. Derived values (`idle_minutes`, `impact_status`, `route_capacity`, …) are computed on read; they are never stored as independent truth.
4. Seed-only metadata (`scenario_id`, ground truth) lives in fixture files, not in runtime tables (§11).
5. All timestamps are ISO 8601 UTC; all money is integer USD; all temperatures one decimal (shared conventions).

---

## 1. Shipment — `S###`

**Purpose:** the cargo movement being protected; the subject of R1, R2, R3 and the combined risk score.
**Relationships:** N shipments → 1 route; N sensor readings, excursions, recommendations, risk assessments → 1 shipment; 1 shipment → N asset assignments; 0–1 current segment.

| Field | Type | R/O | Example | Validation | Why needed |
|---|---|---|---|---|---|
| `id` | string | R | `S102` | `^S\d{3}$`, unique, immutable | Stable cross-domain key (Member 2 sensor data, risk engine, Bob tools) |
| `route_id` | string | R | `R045` | FK → `route.id` must exist | Defines the geography used by disruption matching |
| `cargo_type` | string | R | `vaccine` | §1.2 vocabulary of the shared contract | Links to temperature policy (M2) and compatibility rules |
| `is_cold_chain` | boolean | R | `true` | must be consistent with cargo type (cold types → true) | Drives refrigeration requirement and cold-chain risk |
| `cargo_value_usd` | integer | R | `520000` | ≥ 0 | Input to impact score; prioritisation |
| `volume_units` | integer | R | `12` | > 0 | Capacity checks for routes, carriers, assets |
| `deadline` | timestamptz | R | `2026-09-18T10:00:00Z` | > `created_at` | Deadline urgency in impact score; operator prioritisation |
| `status` | string | R | `in_transit` | `planned \| in_transit \| delayed \| delivered \| cancelled` | Active/inactive filter for matching; delivered excluded |
| `current_segment_id` | string | O | `SEG-012` | FK → `route_segment.id`; must belong to `route_id` | Current-location logic; fleet proximity target |
| `created_at` | timestamptz | R | `2026-09-10T08:00:00Z` | ≤ now | Idle/age fallbacks; audit |
| `updated_at` | timestamptz | R | `2026-09-14T06:30:00Z` | ≥ `created_at` | Change tracking |

**Proposed additive fields (amendment A-3 — pending approval):**

| Field | Type | R/O | Example | Validation | Why needed |
|---|---|---|---|---|---|
| `planned_departure` | timestamptz | R* | `2026-09-10T12:00:00Z` | < `planned_arrival` | Planned travel window for matching (Task 3) |
| `planned_arrival` | timestamptz | R* | `2026-09-17T06:00:00Z` | > `planned_departure` | Planned travel window end; delay computation |
| `actual_departure` | timestamptz | O | `2026-09-10T12:40:00Z` | ≥ planned − tolerance; only when departed | Actual-vs-planned delay; honest status |
| `actual_arrival` | timestamptz | O | `null` | required when `status = delivered` | Delivery cutoff for excursion scoring (M2) and delay metrics |

\* required once A-3 is approved; until then the refined matching treats timing as unknown (`at_risk`, low confidence).

**Derived (not stored):** `current_location` (current segment destination), `next_location` (segment `seq+1` destination), `route_capacity` (min segment capacity), `timing_basis`.

**Example (shared contract + A-3 fields):**
```json
{
  "id": "S102", "route_id": "R045", "cargo_type": "vaccine", "is_cold_chain": true,
  "cargo_value_usd": 520000, "volume_units": 12, "deadline": "2026-09-18T10:00:00Z",
  "status": "in_transit", "current_segment_id": "SEG-012",
  "planned_departure": "2026-09-10T12:00:00Z", "planned_arrival": "2026-09-17T06:00:00Z",
  "actual_departure": "2026-09-10T12:40:00Z", "actual_arrival": null,
  "created_at": "2026-09-10T08:00:00Z", "updated_at": "2026-09-14T06:30:00Z"
}
```

---

## 2. Route — `R###`

**Purpose:** a planned path between two nodes served by one carrier; candidate unit for R2.
**Relationships:** N routes → 1 carrier; 1 route → N segments (ordered); 1 route → N shipments.

| Field | Type | R/O | Example | Validation | Why needed |
|---|---|---|---|---|---|
| `id` | string | R | `R045` | `^R\d{3}$`, unique | Alternative identification |
| `origin_node` | string | R | `INMUM` | non-empty, ≠ destination | OD-pair matching for alternatives |
| `destination_node` | string | R | `NLRTM` | non-empty | OD-pair matching |
| `carrier_id` | string | R | `C07` | FK → `carrier.id` | Carrier alternative derivation; carrier status filter |
| `status` | string | R | `active` | `active \| inactive` | Inactive routes excluded from alternatives |
| `total_distance_km` | numeric(10,1) | R | `11240.0` | > 0 | Informational; sanity check for durations |
| `planned_duration_hours` | numeric(6,1) | R | `384.0` | > 0 | ETA delta computation |
| `planned_cost_usd` | integer | R | `84000` | > 0 | Cost delta computation |
| `created_at` | timestamptz | R | `2026-08-01T00:00:00Z` | ≤ now | Audit |

**Derived:** `route_capacity = min(segment.capacity_units)` (bottleneck), `segment_count`, `regions[]` (ordered), `is_disrupted(regionSet)`.

**Why no stored capacity on Route:** capacity is a property of legs (segments); storing it twice would create two sources of truth. The bottleneck is derived.

**Note on `carrier.cost_index`:** used at generation time to keep route costs consistent with carrier economics (`planned_cost_usd` already reflects the carrier). Runtime scoring uses `planned_cost_usd` directly to avoid double counting. This clarifies the shared data contract wording ("used by scoring") — record as decision D-2 in the final report.

---

## 3. RouteSegment — `SEG-###`

**Purpose:** the leg that disruptions match against; the atomic unit of route feasibility.
**Relationships:** N segments → 1 route; matched by disruptions via `region_code`; referenced by `shipment.current_segment_id`.

| Field | Type | R/O | Example | Validation | Why needed |
|---|---|---|---|---|---|
| `id` | string | R | `SEG-012` | `^SEG-\d{3}$`, unique | Match reason + current-location references |
| `route_id` | string | R | `R045` | FK → `route.id` | Route composition |
| `seq` | integer | R | `2` | ≥ 1, unique per route | Ordering; cumulative duration for planned windows |
| `name` | string | R | `SEA-1 Mumbai–Jebel Ali` | non-empty | Human-readable match reason |
| `region_code` | string | R | `IN-WEST-COAST` | §1.1 vocabulary | **The only disruption match key** (frozen rule) |
| `mode` | string | R | `sea` | `sea \| road \| rail \| air` | Carrier mode compatibility |
| `origin_node` | string | R | `INMUM` | non-empty | Continuity checks |
| `destination_node` | string | R | `AEJEA` | non-empty | Continuity; proximity target |
| `distance_km` | numeric(10,1) | R | `1930.0` | > 0 | Informational |
| `planned_duration_hours` | numeric(6,1) | R | `96.0` | > 0 | Cumulative planned windows |
| `capacity_units` | integer | R | `220` | > 0 | Bottleneck capacity for feasibility |
| `cost_usd` | integer | R | `14000` | > 0 | Informational; route cost breakdown |
| `dest_lat` | numeric(9,6) | R | `25.012800` | −90..90 | Fleet proximity target |
| `dest_lon` | numeric(9,6) | R | `55.061400` | −180..180 | Fleet proximity target |

**Derived:** segment planned window for a shipment = `planned_departure + Σ durations(seq < k)` → `+ duration(seq = k)` (see `member-1-disruption-matching.md` §3).

**Example:**
```json
{
  "id": "SEG-012", "route_id": "R045", "seq": 2, "name": "SEA-1 Mumbai–Jebel Ali",
  "region_code": "IN-WEST-COAST", "mode": "sea", "origin_node": "INMUM", "destination_node": "AEJEA",
  "distance_km": 1930.0, "planned_duration_hours": 96.0, "capacity_units": 220, "cost_usd": 14000,
  "dest_lat": 25.012800, "dest_lon": 55.061400
}
```

---

## 4. Carrier — `C##`

**Purpose:** transport provider; the entity behind carrier alternatives and route feasibility.
**Relationships:** 1 carrier → N routes.

| Field | Type | R/O | Example | Validation | Why needed |
|---|---|---|---|---|---|
| `id` | string | R | `C07` | `^C\d{2}$`, unique | Alternative identification |
| `name` | string | R | `BlueWave Shipping` | non-empty | UI display |
| `service_regions` | string[] | R | `["IN-WEST-COAST","AE-JEBEL-ALI","EU-ROTTERDAM"]` | subset of vocabulary, ≥ 1 | Carrier candidate eligibility |
| `modes` | string[] | R | `["sea"]` | subset of modes, ≥ 1 | Mode compatibility with the lane |
| `capacity_units` | integer | R | `900` | > 0 | Carrier-level capacity check |
| `cost_index` | numeric(4,2) | R | `1.05` | 0.50–2.00 | Generator input for route costs; displayed as relative economics |
| `reliability_score` | numeric(3,2) | R | `0.94` | 0.00–1.00 | Ranking factor (informational under frozen formula; scored under amendment A-4) |
| `status` | string | R | `active` | `active \| inactive` | Inactive carriers excluded (hard filter) |

**Derived:** `feasible_routes_for(OD)`; `best_route` (highest-scoring feasible route).

---

## 5. Disruption — `D##`

**Purpose:** an active event that triggers impact analysis.
**Relationships:** matches route segments by `region_code` (no FK); aggregated per shipment by matching.

| Field | Type | R/O | Example | Validation | Why needed |
|---|---|---|---|---|---|
| `id` | string | R | `D01` | `^D\d{2}$`, unique | Referenced by match reasons, risk factors, audit |
| `type` | string | R | `port_strike` | `weather \| port_strike \| geopolitical \| customs \| infrastructure` | Operator context; severity expectations |
| `region_code` | string | R | `IN-WEST-COAST` | §1.1 vocabulary | Match key (frozen) |
| `start_time` | timestamptz | R | `2026-09-14T06:00:00Z` | required | Window logic |
| `end_time` | timestamptz | O | `2026-09-17T06:00:00Z` | null = open-ended; if set > `start_time` | Window logic; unknown-end handling |
| `severity` | integer | R | `4` | 1–5 | Impact status (`critical` threshold), display, optional risk weighting |
| `status` | string | R | `active` | `scheduled \| active \| resolved` | Only `active` + current window triggers matching |
| `description` | string | R | `Dock workers strike at Mumbai port…` | non-empty | Operator context; audit |
| `created_by` | string | R | `operator-1` | non-empty | Audit |
| `created_at` | timestamptz | R | `2026-09-14T06:05:00Z` | ≤ now | Audit |

**Derived:** `is_currently_active` = `status = active AND start_time <= now AND (end_time IS NULL OR end_time >= now)`.

---

## 6. FleetAsset — `A###`

**Purpose:** truck/container/vessel that can be redeployed; the subject of R3.
**Relationships:** 1 asset → N assignments; 1 asset → N redeployment recommendations.

| Field | Type | R/O | Example | Validation | Why needed |
|---|---|---|---|---|---|
| `id` | string | R | `A114` | `^A\d{3}$`, unique | Candidate identification |
| `type` | string | R | `truck` | `truck \| container \| vessel` | UI grouping; informational mode note |
| `capacity_units` | integer | R | `16` | > 0 | Capacity compatibility |
| `refrigerated` | boolean | R | `true` | — | Cold-chain compatibility |
| `current_lat` | numeric(9,6) | R | `19.076000` | −90..90 | Distance computation |
| `current_lon` | numeric(9,6) | R | `72.877700` | −180..180 | Distance computation |
| `current_region_code` | string | R | `IN-WEST-COAST` | §1.1 vocabulary | Filtering/display (not the distance criterion) |
| `status` | string | R | `available` | `available \| maintenance \| retired` | Availability gate; "idle" is derived, never stored |
| `available_since` | timestamptz | O* | `2026-09-14T03:20:00Z` | required when `status = available`; null otherwise | Idle duration (`now − available_since`) |
| `created_at` | timestamptz | R | `2026-06-01T00:00:00Z` | ≤ now | Fallback context |

\* "required when available" is enforced by validation; a violation is surfaced as an anomaly (`missing_availability_timestamp`), never guessed.

**Derived:** `operational_state` (`available \| assigned \| reserved \| maintenance \| retired`), `idle_minutes`, `next_assignment`, `distance_to(target)` (haversine).

**Why `current_region_code` is not the proximity rule:** region granularity is coarse; distance in km is the criterion (frozen `compatible()` rule). Region is used for filters and display only.

---

## 7. AssetAssignment — `AA-####`

**Purpose:** links an asset to a shipment; defines assigned/reserved states.
**Relationships:** N assignments → 1 asset; N assignments → 1 shipment.

| Field | Type | R/O | Example | Validation | Why needed |
|---|---|---|---|---|---|
| `id` | string | R | `AA-0007` | `^AA-\d{4}$`, unique | Audit/reference |
| `asset_id` | string | R | `A114` | FK → `fleet_asset.id` | Asset state derivation |
| `shipment_id` | string | R | `S102` | FK → `shipment.id` | Assignment purpose; next-location derivation |
| `start_time` | timestamptz | R | `2026-09-15T08:00:00Z` | required | Window logic |
| `end_time` | timestamptz | R | `2026-09-15T20:00:00Z` | > `start_time` | Reservation horizon |
| `reserved` | boolean | R | `false` | — | `true` blocks redeployment even when the asset looks idle |
| `status` | string | R | `planned` | `planned \| active \| completed \| cancelled` | Active vs historical; stale detection |
| `created_at` | timestamptz | R | `2026-09-14T07:10:00Z` | ≤ now | Audit |

**Derived state rules:**
- `assigned(asset, now)` = ∃ assignment with `status = active` and `start_time <= now < end_time`.
- `reserved(asset, now)` = ∃ assignment with `reserved = true` and `end_time >= now` (frozen).
- `hasFutureCommitment(asset, now)` = ∃ assignment with `status = planned` and `end_time >= now`.

**Invariant:** no overlapping assignments for the same asset; violations are flagged (`conflicting_assignments`) and never auto-resolved.

---

## 8. Recommendation — `REC-####`

**Purpose:** a persisted, explainable suggestion awaiting a human decision (shared P3/P4; logistics types are reroute, carrier_change, fleet_redeployment).
**Relationships:** N recommendations → 1 shipment; exactly one target (`route_id` XOR `carrier_id` XOR `asset_id`) by type; decisions produce audit records.

| Field | Type | R/O | Example | Validation | Why needed |
|---|---|---|---|---|---|
| `id` | string | R | `REC-0009` | `^REC-\d{4}$`, unique | Decision endpoint key; audit linkage |
| `type` | string | R | `reroute` | `reroute \| carrier_change \| fleet_redeployment` | Target coherence |
| `shipment_id` | string | R | `S102` | FK → `shipment.id` | Subject |
| `route_id` | string | O | `R089` | required when `type = reroute`; FK | Target route |
| `carrier_id` | string | O | `null` | required when `type = carrier_change`; FK | Target carrier |
| `asset_id` | string | O | `null` | required when `type = fleet_redeployment`; FK | Target asset |
| `score` | numeric(4,3) | R | `0.810` | 0.000–1.000 | Ranking transparency |
| `factors` | jsonb | R | `{"cost_delta_pct":-12,"eta_delta_h":6,"capacity_margin":0.34,"residual_risk":0.05}` | required keys per type (§9.3) | Explanation (P3) |
| `constraints_checked` | jsonb | R | `["carrier_active","capacity_ok","avoids_disrupted_region"]` | ≥ 1 for returned options | Shows hard filters passed |
| `rejected_alternatives` | jsonb | R | `[{"route_id":"R091","score":0.62,"rejected_reason":"capacity_margin_below_minimum"}]` | may be `[]` | Explainability of what was not chosen |
| `status` | string | R | `pending` | `pending \| accepted \| rejected \| modified`; transitions from `pending` only | Human-in-the-loop |
| `created_at` | timestamptz | R | `2026-09-14T09:12:00Z` | ≤ now | Audit |
| `decided_at` | timestamptz | O | `null` | set on first decision | Audit |
| `decided_by` | string | O | `null` | actor label | Audit |
| `notes` | string | O | `null` | free text | Decision context |

**Proposed additive factor keys (within existing jsonb — no schema change):** `estimated_eta`, `estimated_cost_usd`, `confidence_level`, `confidence_drivers`, `distance_km`, `idle_minutes`, `capacity_fit`, `contention_count`, `target_approximate`. Exact per-type keys in §9.3.

---

## 9. Special-field cross-reference (brief-mandated attention points)

### 9.1 Identifier fields

| Field | Lives on | Format | Referenced by |
|---|---|---|---|
| `shipment_id` | Shipment (`id`) | `S###` | readings, excursions, recommendations, assignments, risk |
| `route_id` | Route (`id`) | `R###` | shipments, segments, recommendations |
| `segment_id` | RouteSegment (`id`) | `SEG-###` | `shipment.current_segment_id`, match reasons |
| `carrier_id` | Carrier (`id`) | `C##` | routes, recommendations |
| `asset_id` | FleetAsset (`id`) | `A###` | assignments, recommendations |
| `disruption_id` | Disruption (`id`) | `D##` | match reasons, risk factors, audit |
| `scenario_id` | Fixture metadata only | `SCN-###` | seed validator, tests, ground truth (§11) |

### 9.2 Timestamp fields

| Timestamp | Lives on | Purpose |
|---|---|---|
| `start_time` / `end_time` | Disruption, AssetAssignment | Windows |
| `created_at` / `updated_at` | All mutable entities | Audit |
| `planned_departure` / `planned_arrival` | Shipment (proposed A-3) | Planned travel window (matching) |
| `actual_departure` / `actual_arrival` | Shipment (proposed A-3) | Actuals, delay, delivery cutoff |
| `available_since` | FleetAsset | Idle duration |
| `deadline` | Shipment | Urgency |

### 9.3 Factor keys per recommendation type (frozen vocabulary for the shared `factors` JSON)

| Type | Required factor keys | Required constraint keys | Required rejection reasons |
|---|---|---|---|
| `reroute` | `cost_delta_pct`, `eta_delta_h`, `capacity_margin`, `residual_risk`, `estimated_cost_usd`, `estimated_eta`, `confidence_level`, `confidence_drivers` | `carrier_active`, `capacity_ok`, `avoids_triggering_disruption`, `route_differs_from_current` | `no_candidate_routes`, `route_inactive`, `carrier_inactive`, `same_as_current`, `disrupted_region_overlap`, `insufficient_capacity`, `missing_capacity_data` |
| `carrier_change` | same as reroute + `carrier_reliability`, `backing_route_id` | reroute constraints + `carrier_serves_regions`, `mode_compatible` | reroute reasons + `no_feasible_route`, `insufficient_carrier_capacity` |
| `fleet_redeployment` | `distance_km`, `idle_minutes`, `capacity_fit`, `contention_count`, `target_approximate`, `confidence_level`, `confidence_drivers` | `asset_available`, `not_reserved`, `capacity_ok`, `refrigeration_ok`, `within_radius` | `reserved`, `currently_assigned`, `maintenance`, `retired`, `incompatible_non_refrigerated`, `insufficient_capacity`, `outside_radius`, `missing_availability_timestamp`, `conflicting_assignments` |

---

## 10. Derived fields (never stored)

| Derived value | Inputs | Rule |
|---|---|---|
| `is_currently_active` (disruption) | status, start, end, now | frozen window rule |
| `operational_state` (asset) | status + assignments + now | §7 state rules |
| `idle_minutes` | `available_since`, now | `now − available_since` (frozen) |
| `route_capacity` | segments | `min(capacity_units)` |
| `impact_status` | matching algorithm | `member-1-disruption-matching.md` §4 |
| `timing_basis` | planned times presence | `planned \| unknown` |
| `estimated_eta` | route duration, now | `now + planned_duration_hours` (documented approximation) |
| `contention_count` | candidate sets across shipments | count of affected shipments ranking the asset top-3 |
| `next_assignment` | assignments | nearest future assignment by `start_time` |

---

## 11. `scenario_id` and ground truth (fixture metadata, not runtime columns)

- **Decision:** `scenario_id` (`SCN-###`) tags records **inside seed fixture JSON files** and in a separate `data/seed/ground_truth.json`. It is **not** a database column.
- **Why:** runtime tables must not carry test tags; fixtures must be queryable by scenario for the validator and tests.
- Fixture shape:
```json
{
  "scenario_id": "SCN-004",
  "description": "Shipment planned to enter disrupted region after disruption end",
  "records": {"shipments": ["S140"], "disruptions": ["D03"]},
  "ground_truth": {"S140": {"impact_status": "unaffected", "timing_basis": "planned"}}
}
```
- The validator asserts every declared scenario exists at least once and re-derives ground truth independently (`phase-plan.md` SH-01).

---

## 12. Proposed amendments to shared contracts (all pending joint approval)

| ID | Target | Proposal | Impact if rejected |
|---|---|---|---|
| A-1 | `scope-freeze.md` §1.2 | Add planned-window relevance filter to matching (passed/upcoming shipments classified correctly) | Refined matching falls back to frozen region rule; `impact_status` uses `at_risk` for ambiguous cases; false positives remain (documented) |
| A-2 | `api-contract.md` 3.5 | Add derived `impact_status` + `matched_disruptions` + `timing_basis` to affected-shipments response (additive) | UI/Bob show only the affected flag and impact score |
| A-3 | `data-contract.md` §2 | Add `planned_departure`, `planned_arrival`, `actual_departure`, `actual_arrival` to Shipment (additive) | Refined time logic degrades to `timing_basis = unknown`; `at_risk` only |
| A-4 | `scope-freeze.md` §1.2 | Optional carrier reliability term in carrier scoring (`w5`) | Reliability shown as informational only; frozen formula unchanged |
| A-5 | `api-contract.md` §2 | Add recommendation creation endpoint(s): `POST /api/recommendations` (+ optional `POST /api/fleet/redeployments/recommend`) | No persisted pending recommendations → decision endpoint unreachable; must use a stopgap |
| A-6 | `api-contract.md` §2 | Add `GET /api/fleet`, `GET /api/carriers`, optional `GET /api/routes/:id` (additive reads for logistics UI) | Fleet Utilisation screen cannot list non-idle assets; carrier filters limited |
| A-7 | `scope-freeze.md` §1.2 | Freeze redeployment detection + ranking rules: idle/future-commitment blocking and the ranking formula (`member-1-fleet-redeployment.md` §4, §6) | Ranking remains an undocumented local formula — unacceptable for a frozen contract |
| A-8 | `scope-freeze.md` §1.2 (clarification) | Hard filter excludes the **triggering** disruption region; `residual_risk` measures exposure to **other** active disruptions | If interpreted as "exclude all active disruption regions", `residual_risk` is always 0 and w4 becomes dead weight |
| A-9 | `api-contract.md` 3.7–3.10 | Additive explanation fields on alternative/redeployment responses (`reasons`) and `not_actionable` flags (`member-1-route-carrier-alternatives.md` §6.2) | UI renders from numeric `factors` using shared display templates; delivered shipments still return empty `data` |

**Decision D-2 (no contract change):** `carrier.cost_index` is a generation-time input; runtime scoring uses `route.planned_cost_usd` to avoid double counting. Recorded for the final report.

---

## 13. Validation checklist (logistics half, enforced by the seed validator)

1. Every FK resolves; no orphans.
2. Every route has ≥ 2 segments with unique contiguous `seq`.
3. Every `region_code` is in the shared vocabulary; every disruption region is covered by ≥ 1 segment.
4. No overlapping assignments per asset (conflicts are flagged fixtures, not accidents).
5. `shipment.current_segment_id` belongs to `shipment.route_id` when present.
6. Cold-chain shipments have a matching temperature policy (or are deliberate `unknown_policy` fixtures — M2).
7. Proposed A-3 fields: `planned_arrival > planned_departure`; `status = delivered → actual_arrival` present.
8. All timestamps parse as ISO 8601 UTC; money integers; capacities positive.
9. `scenario_id` coverage: every scenario type in the test plan exists in fixtures with ground truth.
