# Member 2 — Cold-Chain Data Design

**Role:** Cold-Chain, AI and IBM Bob Engineer
**Status:** DRAFT — elaborates the shared `data-contract.md` for the cold-chain domain. It does **not** replace or silently change the shared contract. Additive proposals are recorded in §9 and require joint approval.
**Canonical schema:** `docs/phase-0/data-contract.md` (frozen field names, types, IDs, enums)
**This file adds:** per-field rationale, cold-chain validation detail, derived structures, cargo profiles, fixture metadata rules, and proposed additive entities.

---

## 0. Design rules

1. Field names and enums come from the shared data contract — this file never renames them.
2. Every field must earn its place: required by R4/R5/R6, by a test, or by an explainability requirement.
3. Derived values (`sensor_status`, quality flags, `coldchain_risk`) are computed on read/evaluation; never stored as independent truth.
4. `scenario_id` is fixture metadata (`SCN-###`), not a database column. Cold-chain fixtures use **`SCN-101`…`SCN-125`** (Member 1 uses `SCN-001`…`SCN-025`) — no collisions.
5. "Normal" is a **shipment-level state** (no open excursion), not a stored excursion severity. Excursion severity enum stays `warning | major | critical | unknown_review` (frozen).
6. No universal regulatory claims anywhere in code, data or docs.

---

## 1. SensorReading — `SR-######` (shared entity, cold-chain detail)

**Purpose:** one timestamped IoT temperature observation for a cold-chain shipment; the raw material of R4/R5.
**Relationships:** N readings → 1 shipment; grouped into excursions by the detection pipeline.

| Field | Type | R/O | Example | Validation | Why it exists |
|---|---|---|---|---|---|
| `id` | string | R | `SR-000123` | `^SR-\d{6}$`, unique, sequential | Stable evidence reference (Bob, audit, UI) |
| `shipment_id` | string | R | `S102` | FK → `shipment.id`; shipment should be cold-chain (warn if not) | Links the reading to the cargo being protected |
| `sensor_id` | string | R | `SEN-004` | `^SEN-\d{3}$`; one sensor per shipment in MVP | Identifies the device; supports duplicate detection `(sensor_id, timestamp)` |
| `timestamp` | timestamptz | R | `2026-09-14T09:00:00Z` | not in the future; out-of-order allowed and flagged | Time axis for duration, windows, ordering |
| `temperature_c` | numeric(5,1) | R | `9.4` | plausible range −40.0..60.0; outside → flagged `implausible` | The measurement itself |
| `humidity_pct` | numeric(5,2) | O | `61.20` | 0..100 if present | Optional environmental context; not used in MVP severity |
| `source` | string | R | `simulated` | `simulated \| manual` | Honesty: every record says where it came from |
| `created_at` | timestamptz | R | `2026-09-14T09:00:05Z` | ≤ now | Ingestion audit |

**Computed quality flags (not stored; derived per evaluation):**

| Flag | Rule | Severity impact |
|---|---|---|
| `duplicate` | same `(sensor_id, timestamp)` appears more than once | first kept; duplicates reported |
| `out_of_order` | `timestamp` earlier than the previously ingested reading | reordered before evaluation; excursion `data_quality = out_of_order` |
| `implausible` | `temperature_c` outside −40..60 | stored; see B-6 handling rule |
| `gap` | > 2× expected interval (> 30 min at 15-min sampling) with no reading | `missing_readings`; overlapping a breach → `unknown_review` |
| `sensor_failure` | ≥ 4× interval (≥ 60 min) with no reading | separate alert type; never a compliance claim |

**Example:**
```json
{
  "id": "SR-000123", "shipment_id": "S102", "sensor_id": "SEN-004",
  "timestamp": "2026-09-14T09:00:00Z", "temperature_c": 9.4,
  "humidity_pct": 61.20, "source": "simulated", "created_at": "2026-09-14T09:00:05Z"
}
```

---

## 2. TemperaturePolicy — `TP-<CARGO_TYPE>` (shared entity, cold-chain detail)

**Purpose:** the configurable rule set that defines what a breach is and how severe it becomes (R5/R6).
**Relationships:** 1 policy (per cargo type, per version) → N excursions; referenced by `excursion.policy_id`.

| Field | Type | R/O | Example | Validation | Why it exists |
|---|---|---|---|---|---|
| `id` | string | R | `TP-VACCINE` | `^TP-[A-Z0-9_]+$`, unique per version | Stable policy reference |
| `cargo_type` | string | R | `vaccine` | vocabulary; unique per active version | Policy applies per cargo type, not globally |
| `min_c` | numeric(5,1) | R | `2.0` | < `max_c` | Lower allowed bound (inclusive) |
| `max_c` | numeric(5,1) | R | `8.0` | > `min_c` | Upper allowed bound (inclusive) |
| `max_excursion_minutes` | integer | R | `15` | ≥ 0; "warning duration" from the brief | Tolerance before severity escalates |
| `minor_deviation_c` | numeric(4,1) | R | `1.0` | > 0 | Warning/Major magnitude boundary |
| `major_deviation_c` | numeric(4,1) | R | `3.0` | > `minor_deviation_c` | Major/Critical magnitude boundary |
| `critical_duration_minutes` | integer | R | `60` | > `max_excursion_minutes`; "critical duration" from the brief | Long-breach escalation |
| `version` | integer | R | `1` | starts at 1; increments on update | Past classifications remain explainable |
| `effective_from` | timestamptz | R | `2026-08-01T00:00:00Z` | ≤ now when activated | Policy governance |
| `updated_by` | string | R | `operator-1` | non-empty | Audit |
| `updated_at` | timestamptz | R | `2026-08-01T00:00:00Z` | ≤ now | Audit |

**Validation:** thresholds must be ordered (`minor < major`, `tolerance < critical duration`); updating creates a new version (old retained); a cargo type with no active policy → excursions classified `unknown_review`.

**Seed policy values — `[ASSUMPTION]` illustrative placeholders, not regulatory claims (configurable at runtime):**

| cargo_type | min_c | max_c | max_excursion_minutes | minor_deviation_c | major_deviation_c | critical_duration_minutes |
|---|---|---|---|---|---|---|
| vaccine | 2.0 | 8.0 | 15 | 1.0 | 3.0 | 60 |
| insulin | 2.0 | 8.0 | 15 | 1.0 | 3.0 | 60 |
| fresh_produce | 0.0 | 4.0 | 20 | 1.0 | 3.0 | 90 |
| frozen_food | −20.0 | −15.0 | 10 | 2.0 | 5.0 | 45 |

**Example:** see shared contract §10 (unchanged).

---

## 3. TemperatureExcursion — `EX-####` (shared entity, cold-chain detail)

**Purpose:** a detected breach event with lifecycle, evidence and classification (R5/R6).
**Relationships:** N excursions → 1 shipment; N → 1 policy (or none when unknown); N → audit records.

| Field | Type | R/O | Example | Validation | Why it exists |
|---|---|---|---|---|---|
| `id` | string | R | `EX-0003` | `^EX-\d{4}$`, unique | Alert/evidence reference |
| `shipment_id` | string | R | `S102` | FK → `shipment.id` | Subject |
| `policy_id` | string | O | `TP-VACCINE` | FK; null when no policy matched | Explains which rules were applied |
| `start_time` | timestamptz | R | `2026-09-14T08:15:00Z` | first breaching reading | Duration start |
| `end_time` | timestamptz | O | `2026-09-14T09:02:00Z` | null while ongoing; ≥ start | Duration end; null is honest, not zero |
| `peak_deviation_c` | numeric(4,1) | R | `2.4` | ≥ 0; max distance beyond nearest bound | Magnitude input to severity |
| `duration_min` | integer | R | `47` | ≥ 0; computed (see detection design) | Time-integrated risk |
| `severity` | string | R | `major` | `warning \| major \| critical \| unknown_review` | Priority label (never `normal`) |
| `severity_rationale` | string | R | `duration>tolerance;magnitude<=major` | machine reason codes from the ladder | Explainability; UI renders human text |
| `data_quality` | string | R | `complete` | `complete \| missing_readings \| sensor_failure \| out_of_order` | Uncertainty must be explicit |
| `detected_at` | timestamptz | R | `2026-09-14T08:16:00Z` | ≤ now | Detection latency evidence |
| `status` | string | R | `open` | `open \| acknowledged \| closed` | Human review lifecycle |

**Example (consistent with the frozen ladder — see conflict B-C1):**
```json
{
  "id": "EX-0003", "shipment_id": "S102", "policy_id": "TP-VACCINE",
  "start_time": "2026-09-14T08:15:00Z", "end_time": "2026-09-14T09:02:00Z",
  "peak_deviation_c": 2.4, "duration_min": 47, "severity": "major",
  "severity_rationale": "duration>tolerance;magnitude<=major",
  "data_quality": "complete", "detected_at": "2026-09-14T08:16:00Z", "status": "open"
}
```

---

## 4. CargoProfile — proposed entity B-1 (additive)

**Purpose:** centralise cargo-type attributes used by risk scoring, display and policy validation, instead of scattering them in code.
**Status:** **proposed additive** to the shared data contract (B-1). Fallback if rejected: sensitivity weights live in a config file keyed by `cargo_type` (no schema change).

| Field | Type | R/O | Example | Validation | Why it exists |
|---|---|---|---|---|---|
| `cargo_type` | string | R | `vaccine` | PK; shared cargo vocabulary | Join key with shipments and policies |
| `display_name` | string | R | `Vaccines` | non-empty | UI/Bob display |
| `is_cold_chain` | boolean | R | `true` | must match shipments of that type | Consistency guard for seed data |
| `sensitivity_weight` | numeric(3,2) | R | `0.90` | 0.00–1.00 | Cargo sensitivity input to cold-chain risk (B-4) and prioritisation display |
| `policy_required` | boolean | R | `true` | true for cold-chain types | Validator: cold types without a policy are deliberate fixtures only |
| `notes` | string | O | `Illustrative demo sensitivity; not a product-specific claim.` | free text | Honesty note surfaced in docs |

**Seed rows (`[ASSUMPTION]` illustrative):** vaccine 0.90 · insulin 0.90 · fresh_produce 0.60 · frozen_food 0.70 · pharma_generic 0.50 · non-cold types 0.00 with `policy_required = false`.

**Relationship:** `cargo_profile.cargo_type` ↔ `shipment.cargo_type` ↔ `temperature_policy.cargo_type` (logical, not all FK-enforced in MVP).

---

## 5. SensorStatus — derived structure, proposed response block B-2

**Purpose:** answer "is the sensor actually reporting?" — sensor health from the brief.
**Status:** **derived, not stored.** Returned as a block on `GET /api/shipments/:id/sensor-readings` (B-2, additive). Optional persisted `sensor_device` entity is future scope.

| Field | Type | Example | Rule |
|---|---|---|---|
| `sensor_id` | string | `SEN-004` | from the latest reading |
| `shipment_id` | string | `S102` | — |
| `status` | string | `reporting` | `reporting` if last reading ≤ 2× interval; `delayed` if > 2× and < 4×; `failed` if ≥ 4× (60 min); `unknown` if never reported |
| `expected_interval_min` | integer | `15` | configurable, default 15 |
| `last_reading_at` | timestamptz | `2026-09-14T09:00:00Z` | latest timestamp (or null) |
| `minutes_since_last` | integer | `12` | `now − last_reading_at` (or null) |
| `readings_count` | integer | `288` | total stored |
| `gap_count` | integer | `1` | number of detected gaps |
| `failure_since` | timestamptz | `null` | first timestamp of the failure window when `status = failed` |

**Example:**
```json
{ "sensor_id": "SEN-004", "shipment_id": "S102", "status": "reporting", "expected_interval_min": 15,
  "last_reading_at": "2026-09-14T09:00:00Z", "minutes_since_last": 12, "readings_count": 288, "gap_count": 1, "failure_since": null }
```

---

## 6. Cold-chain risk contribution (shared `RiskAssessment`)

**Purpose:** the cold-chain half of the combined priority score (P2). The `RiskAssessment` entity itself is shared (`data-contract.md` §13); this section defines the cold-chain inputs and factor keys.

| Field (on `risk_assessment`) | Type | Example | Rule |
|---|---|---|---|
| `coldchain_risk` | numeric(4,3) | `0.600` | frozen baseline: severity weight of the **worst open excursion** — Normal 0.0, Warning 0.3, Major 0.6, Critical 1.0, Unknown 0.5; no excursion → 0.0 |
| `factors.coldchain` | jsonb | see below | explainable inputs; keys frozen in §9.3 of `member-1-logistics-data-design.md` style |

**Cold-chain factor keys (vocabulary):**
`worst_excursion_id`, `severity`, `peak_deviation_c`, `duration_min`, `time_to_delivery_hours`, `data_quality`, `cargo_sensitivity`, `excursion_count`, `weights`, `confidence_level`, `confidence_drivers`.

**Example `factors` block:**
```json
{
  "coldchain": {
    "worst_excursion_id": "EX-0003", "severity": "major",
    "peak_deviation_c": 2.4, "duration_min": 47,
    "time_to_delivery_hours": 25.0, "data_quality": "complete",
    "cargo_sensitivity": 0.90, "excursion_count": 1,
    "weights": { "alpha": 0.5, "beta": 0.5 },
    "confidence_level": "high", "confidence_drivers": []
  }
}
```

**Refinement proposal B-4 (optional):** multiply the frozen severity weight by transparent, configurable modifiers (magnitude, duration, delivery proximity). Baseline stays frozen for MVP; see `member-2-combined-risk.md` §4.

---

## 7. AuditRecord — shared entity, cold-chain usage

**Purpose:** immutable trail for cold-chain human actions and policy changes (P4).
**Relationships:** polymorphic (`entity_type` + `entity_id`), no FK.

| Cold-chain audit events | `entity_type` | `action` | Trigger |
|---|---|---|---|
| Excursion acknowledged | `temperature_excursion` | `acknowledged` | Operator clicks Acknowledge |
| Excursion closed | `temperature_excursion` | `closed` | Operator closes after review |
| Policy updated | `temperature_policy` | `policy_updated` | `PUT /api/temperature-policies/:id` (details contain before/after) |
| Alert acknowledged | `temperature_excursion` | `acknowledged` | Same as excursion acknowledge (alerts are views over excursions/sensor failures) |

**Decision:** **no audit row per sensor reading** — ingestion volume would drown the decision trail. Ingestion is covered by technical logs (not the business audit). Recorded here as a deliberate boundary.

---

## 8. Special-field cross-reference (brief-mandated fields)

| Brief field | Where it lives | Notes |
|---|---|---|
| Timestamp | `sensor_reading.timestamp` | ISO 8601 UTC; out-of-order allowed and flagged |
| Temperature | `sensor_reading.temperature_c` | numeric(5,1), °C, one decimal |
| Optional humidity | `sensor_reading.humidity_pct` | nullable; not used in MVP severity |
| Sensor health | derived `SensorStatus` (§5) | not stored; B-2 response block |
| Cargo type | `shipment.cargo_type`, `temperature_policy.cargo_type`, `cargo_profile.cargo_type` | shared vocabulary |
| Minimum / maximum allowed temperature | `temperature_policy.min_c` / `max_c` | inclusive bounds |
| Warning duration | `temperature_policy.max_excursion_minutes` | tolerance |
| Critical duration | `temperature_policy.critical_duration_minutes` | escalation threshold |
| Delivery time | `shipment.deadline` (frozen); `actual_arrival` (A-3, proposed) | time-to-delivery for prioritisation; post-delivery cutoff (B-5) |
| Data quality status | derived flags + `excursion.data_quality` | `complete \| missing_readings \| sensor_failure \| out_of_order` |

---

## 9. Proposed amendments and conflicts (all pending joint approval)

| ID | Target | Proposal | Impact if rejected |
|---|---|---|---|
| B-1 | `data-contract.md` (new reference entity) | Add `cargo_profile` (cargo_type, display_name, is_cold_chain, sensitivity_weight, policy_required, notes) | Sensitivity weights move to config; display names hardcoded in UI |
| B-2 | `api-contract.md` 3.13 | Additive `sensor` health block (derived `SensorStatus`) + optional `GET /api/sensors/:id` | Sensor health computed ad hoc in UI; no dedicated endpoint |
| B-3 | `scope-freeze.md` §1.2 | Freeze excursion grouping/closure rules: group gap 30 min (2× interval), single-reading duration = 0, recovery sets `end_time`, lifecycle transitions | Detection results become implementation-defined — unacceptable for a frozen contract |
| B-4 | `scope-freeze.md` §1.2 | Optional refined cold-chain risk modifiers (magnitude, duration, delivery proximity) | Baseline severity weights remain; factors still returned |
| B-5 | `data-contract.md` §2 / A-3 | Delivery cutoff needs `actual_arrival` (A-3) or an equivalent delivered timestamp; MVP approximation uses the status-change time and is labelled | Post-delivery exclusion becomes approximate — documented in limitations |
| B-6 | `scope-freeze.md` §1.2 | Implausible-reading rule: flagged readings are retained; if an implausible reading is the **sole** breach, severity = `unknown_review` (never trusted as a real breach) | Ambiguous handling of sensor spikes; risk of false Critical |
| B-7 | `api-contract.md` §2 (gap) | Add excursion status endpoint `POST /api/excursions/:id/status` (`open → acknowledged → closed`, writes audit) | Human review lifecycle has no API path; alerts can never be acknowledged/closed |
| B-8 | `scope-freeze.md` §1.2 | Severity ladder branch order: check `magnitude > major OR duration > critical → Critical` before the Major branch, so `critical_duration_minutes` is not inert (`member-2-severity-classification.md` §3.3) | `critical_duration_minutes` remains unused; long small-magnitude excursions stay Major |
| B-C1 | `data-contract.md` §11 (example defect) | The `EX-0003` example shows `peak_deviation_c = 3.4` with severity `major`, but the frozen ladder classifies 3.4 > `major_deviation_c (3.0)` as `critical`. Fix: change the example peak to `2.4` (keeps severity `major`) or change severity to `critical` | A shared-contract example contradicts the frozen rules — must be corrected before Phase 1 |

**Nothing here is applied to the shared files until both members approve** (`phase-0-review-checklist.md`). Phase 1 implementation uses the frozen baseline; B-proposals stay on feature branches.

---

## 10. Validation checklist (cold-chain half, enforced by the seed validator)

1. Every reading's `shipment_id` and `sensor_id` resolve; cold-chain flag matches the shipment.
2. Readings are unique by `(sensor_id, timestamp)` in seed data (defect fixtures are deliberate and tagged).
3. Every cold-chain shipment has a matching policy unless it is a deliberate `unknown_policy` fixture (`SCN-112`).
4. Policy thresholds are ordered; versions are contiguous.
5. Every excursion's severity is in the frozen enum and its `data_quality` matches the readings' quality flags.
6. `duration_min` and `peak_deviation_c` are re-derivable from the fixture readings (ground truth check).
7. `scenario_id` coverage: every cold-chain scenario (`SCN-101`…`SCN-125`) exists at least once.
8. No reading timestamps in the future; no excursion `end_time` before `start_time`.
