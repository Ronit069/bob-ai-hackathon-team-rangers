# Phase 2B — Synthetic Data Generator and Ground Truth Report

**Project:** ChainSentinel — L2 Supply Chain Disruption Assistant & Fleet Utilisation Optimizer
**Date:** 2026-09-14
**Scope:** Python 3.11 stdlib generator, deterministic ground truth, contract validation, PostgreSQL seed/import support, tests
**Constraints honoured:** no ML, no invented formulas (all rules copied from the frozen contracts), no Bob integration, original reference documents untouched.

---

## 1. Generator structure

```text
src/data-generator/
├── generate.py                 # CLI: build → validate → export JSON
├── validate.py                 # CLI: validate exported fixtures
├── chainsentinel/
│   ├── __init__.py
│   ├── common.py               # vocabularies, seed policies/profiles, time helpers, seeded RNG
│   ├── logistics.py            # network + scenario shipments + fleet + disruptions
│   ├── coldchain.py            # profiles, policies, sensor readings (scenario patterns)
│   ├── groundtruth.py          # Python mirrors of the frozen JS rules (expected outputs)
│   └── validator.py            # contract + scenario + ground-truth consistency checks
└── tests/
    ├── test_generator.py       # 30 tests
    ├── test_validator.py       # 9 tests
    └── test_groundtruth.py     # 9 tests
```

**Design:** scenario values are explicit data tables (deterministic by construction); a single seeded `random.Random` is used only for filler variation. Ground truth is computed at generation time by re-implementing the frozen rules (matching, excursion detection, severity, fleet, alternatives, risk) in Python, then **cross-verified against the actual JS services** running on the seeded database (`src/backend/scripts/verify-seed.js`).

---

## 2. Input parameters

| Parameter | Default | Meaning |
|---|---|---|
| `--seed` | `20260914` | Seed for the single deterministic RNG (filler variation) |
| `--now` | `2026-09-14T09:00:00Z` | Time anchor for every timestamp (frozen demo window) |
| `--out` | `<repo>/data/seed` | Output directory |

Dataset sizes follow `scope-freeze.md` §1.3: 6 lanes, 8 routes + 1 defect route, 16 segments, 9 carriers (8–10), 48 shipments (40–60), 5 disruptions, 24 assets (20–30), 4 policies, 8 cargo profiles, 2,201 readings.

---

## 3. Output format

| File | Contents | Format |
|---|---|---|
| `data/seed/logistics.json` | carriers, routes, route_segments, shipments, disruptions, fleet_assets, asset_assignments | snake_case fields matching DB columns; ISO-8601 UTC timestamps; `meta` block (version, seed, now) |
| `data/seed/coldchain.json` | cargo_profiles, temperature_policies, sensor_readings | same conventions |
| `data/seed/ground_truth.json` | matching, excursions, review_flags, fleet, redeployment, alternatives, risk, scenarios | expected outputs keyed by shipment/scenario |

Notes:
- `scenario_tags` and the `defect` marker live in the fixture JSON for traceability; the seed loader ignores them (no DB columns).
- `ground_truth.json` is **not** seeded — inputs are fixtures, ground truth is the expected result set for tests and verification.

---

## 4. Random seed behaviour

- One `random.Random(seed)` instance; scenario values are hard-coded (no RNG), so edge cases are guaranteed, not probabilistic.
- **Reproducibility:** identical `--seed` **and** `--now` produce byte-identical files. Verified by SHA-256 over repeated runs:

| File | Identical across runs |
|---|---|
| `logistics.json` | True (`CB95008FD2209CBA…`) |
| `coldchain.json` | True (`1DA28625F67C3B65…`) |
| `ground_truth.json` | True (`5DEA5E5CB247ED8D…`) |

- Changing `--now` shifts all timestamps (still deterministic for that anchor); this supports demo refreshes without changing the seed.

---

## 5. Ground-truth formulas (all copied from frozen contracts — none invented)

| Domain | Rule | Source |
|---|---|---|
| Matching | Region match + active window + position (ON/BEFORE/PAST) + A-1 planned-window relevance; statuses `critical/blocked/delayed/at_risk/unknown_review`; unaffected excluded | `scope-freeze.md` §1.2 + A-1/A-2 |
| Impact score | `0.4·cargo_value_norm + 0.4·deadline_urgency_norm + 0.2·is_cold_chain` (min–max normalised; 0.5 when flat; urgency horizon 168 h) | `scope-freeze.md` §1.2 |
| Excursion detection | `breach = t < min_c OR t > max_c` (inclusive boundary); dedupe `(sensor_id, timestamp)`; reorder; gaps > 2× interval; failures ≥ 4× interval; grouping ≤ 30 min (or unobserved data gap); duration = last−first breach; peak = max deviation | `scope-freeze.md` §1.2 + B-3/B-6 |
| Severity (B-8 order) | unknown data/policy → `unknown_review`; else warning / critical (`magnitude>major OR duration>critical`) / major / warning | `scope-freeze.md` §1.2 (B-8) |
| Fleet idle | `idle = available + no active assignment + no future commitment`; `idle_minutes = now − available_since` | `scope-freeze.md` §1.2 + A-7 |
| Redeployment | Compatibility (capacity, refrigeration, haversine ≤ 150 km) + `0.45·proximity + 0.35·idle + 0.20·capacity_fit` | A-7 |
| Alternatives | H1–H8 hard filters + `w1..w4` weighted score (0.35/0.35/0.20/0.10); residual risk over other active disruptions | `scope-freeze.md` §1.2 + A-8 |
| Risk | Severity weights (0/0.3/0.6/1.0/0.5), worst open excursion, review flags 0.5; `combined = 0.5·disruption + 0.5·coldchain` | `member-2-combined-risk.md` |

---

## 6. Sample records

**Shipment (S039 — combined disruption + cold-chain scenario):**
```json
{
  "id": "S039", "route_id": "R001", "cargo_type": "vaccine", "is_cold_chain": true,
  "cargo_value_usd": 520000, "volume_units": 12, "deadline": "2026-09-18T09:00:00Z",
  "status": "in_transit", "current_segment_id": "SEG-001",
  "planned_departure": "2026-09-11T09:00:00Z", "planned_arrival": "2026-09-17T09:00:00Z",
  "scenario_tags": ["SCN-120"]
}
```

**Sensor readings (S028 — data gap inside a breach window):**
```json
{"id": "SR-000xxx", "shipment_id": "S028", "sensor_id": "SEN-028",
 "timestamp": "2026-09-14T07:00:00Z", "temperature_c": 9.4, "humidity_pct": 56.5, "source": "simulated"}
```
(two readings dropped at 07:15/07:30 → 45-minute hole; next breach at 07:45)

**Expected excursion (ground truth):**
```json
{
  "shipment_id": "S028", "policy_id": "TP-VACCINE",
  "start_time": "2026-09-14T07:00:00Z", "end_time": null,
  "duration_min": 45, "peak_deviation_c": 1.4,
  "severity": "unknown_review", "severity_rationale": "data_quality:missing_readings",
  "data_quality": "missing_readings", "status": "open", "post_delivery": false
}
```

**Expected matching row (S001 — two disruptions, worst wins):**
```json
{
  "shipment_id": "S001", "impact_status": "critical",
  "match_reason": "route R001 segment SEG-001 matches disruption D01; currently_in_affected_segment",
  "matched_segment_ids": ["SEG-001", "SEG-002"],
  "matched_disruptions": [
    {"disruption_id": "D01", "severity": 4, "status": "critical", "reason": "currently_in_affected_segment"},
    {"disruption_id": "D04", "severity": 2, "status": "delayed", "reason": "planned_arrival_during_disruption"}
  ],
  "timing_basis": "planned", "confidence": "high", "impact_score": 0.477
}
```

**Expected risk (S039):** `{"disruption_risk": 0.856, "coldchain_risk": 0.6, "combined_score": 0.728, "severity": "major"}`.

---

## 7. Validation results

`python validate.py` (and the generation-time gate) — **PASS**:

- ID formats and uniqueness for all entities; FK resolution (routes→carriers, segments→routes, shipments→routes, current segment on its route, assignments, readings).
- Controlled vocabularies (regions, modes, cargo types, statuses) and numeric ranges.
- Route ≥ 2 segments, except the tagged defect route `R071` (SCN-005).
- Cold-chain cargo has a policy unless deliberately unknown (S032/S033).
- Timestamp format and coherence; delivered shipments have `actual_arrival`.
- Scenario coverage: all 48 SCN definitions present; fixture tags known.
- Ground-truth consistency: matching and excursions re-derived from the fixtures match the stored ground truth.

**PostgreSQL seed verification** (`npm run seed` + psql):

| Table | Rows |
|---|---|
| carrier / route / route_segment | 9 / 9 / 16 |
| shipment / disruption | 48 / 5 |
| fleet_asset / asset_assignment | 24 / 7 |
| cargo_profile / temperature_policy | 8 / 4 |
| sensor_reading | 2,201 |

**Cross-language verification** (`node scripts/verify-seed.js` against the seeded DB):

```
matching:   PASS (expected 15, got 15)
excursions: PASS (expected 14, got 14)
```

This check found and fixed a real bug in the Phase 2A JS service (see §10).

---

## 8. Edge cases covered (fixtures)

| Scenario | Shipment/Asset | Expected outcome |
|---|---|---|
| SCN-001 multi-shipment disruption | S001, S002, S003 | critical / blocked / critical |
| SCN-004 multiple disruptions | S001 | worst status critical; 2 disruptions listed |
| SCN-005 missing route data | S010 (defect route R071) | `unknown_review` |
| SCN-006 open-ended disruption | S011 | `at_risk` |
| SCN-007 delivered | S007 | excluded |
| SCN-008 passed segment (A-1) | S008 | excluded |
| SCN-010 inclusive boundary | S009 | `delayed` |
| SCN-011 no feasible route | S004 | no-option + `disrupted_region_overlap` |
| SCN-012 insufficient capacity | S005 | `insufficient_capacity` |
| SCN-013 carrier unavailable | S006 | `carrier_inactive` (C09) + `no_feasible_route` |
| SCN-015 deterministic ranking | S040 | single alternate R006, score 0.4 |
| SCN-016 idle asset | A001 | in candidates near Singapore |
| SCN-017 reserved asset | A002 | excluded `reserved` |
| SCN-018 incompatible asset | A003 (non-refrigerated, cold cargo) | rejected `incompatible_non_refrigerated` |
| SCN-019 proximity | A005 (~145 km) vs A004 (~240 km) | included vs `outside_radius` |
| SCN-020 no compatible asset | S017 (Rotterdam) | empty candidates |
| SCN-021 contention | A003/A001/A017 top-3 for S018+S019 | overlap confirmed |
| SCN-022 missing availability timestamp | A007 | excluded with reason |
| SCN-023 conflicting assignments | A006 (AA-0002/AA-0003 overlap) | conflict data present (flagging is Phase 3) |
| SCN-101/102 normal + boundary | S021/S022 | no excursion |
| SCN-103/104 below/above range | S023/S024 | `major` excursions |
| SCN-105 short deviation | S025 | `warning`, duration 0 |
| SCN-106 prolonged | S026 | `major`, 45 min |
| SCN-107 repeated | S027 | 2 records |
| SCN-108 data gap in breach | S028 | `missing_readings` → `unknown_review` |
| SCN-109 duplicate | S029 | deduped, no false breach |
| SCN-110 out-of-order | S030 | reordered, flagged |
| SCN-111 sensor failure | S031 | status `failed` (75 min silent) |
| SCN-112/113 unknown policy/cargo | S032/S033 | `policy_missing` review flag |
| SCN-114 near delivery | S034 | `major`, time-to-delivery surfaced |
| SCN-115 delivered post-delivery | S035 | no live excursion |
| SCN-116 implausible sole breach | S036 | `unknown_review` / `implausible` |
| SCN-117 grouping boundary | S037 | 3 excursions (merge + splits) |
| SCN-118 long small magnitude (B-8) | S038 | `critical` (`duration>critical`) |
| SCN-120 combined risk | S039 | combined 0.728 |

**Documented non-generatable scenarios** (contract/DB constraints — covered by JS unit tests instead): SCN-009 (planned times are NOT NULL under A-3), SCN-014 (`capacity_units` NOT NULL > 0). **Runtime scenarios** (no fixtures): SCN-119, SCN-121…SCN-125. **Upcoming-arrival branch** of SCN-008 is unit-tested in JS (network layout makes a fixture ambiguous); the passed branch is fixture-covered.

---

## 9. Test results

| Suite | Command | Result |
|---|---|---|
| Python generator tests | `python -m unittest discover -s tests -t .` | **48/48 pass** (30 generator, 9 validator, 9 ground-truth formula) |
| JS backend tests (regression) | `npm test` (from `src/backend`) | **64/64 pass** |
| Seed + DB counts | `npm run seed` + psql | counts match exactly |
| Cross-language ground truth | `node scripts/verify-seed.js` | matching 15/15, excursions 14/14 — PASS |
| File-level determinism | SHA-256 across two runs | all three files identical |

Python tests cover normal, boundary (exact min/max), invalid (corrupted fixtures rejected: unknown region, dangling FK, short route, duplicate IDs, policy order, missing scenario, ground-truth mismatch) and edge cases (gaps, duplicates, order, implausible, failure, grouping, B-8).

---

## 10. Issues found and fixed

1. **Missing sensor mapping** for S017 (KeyError) — added `SEN-017`.
2. **S014 missing from redeployment ground truth** — added to the computed set.
3. **Defect route R071 violated the DB duration check** (zero-length route) — kept the missing-segments defect but gave the route plausible metrics.
4. **Cargo-agnostic temperature pattern** produced false excursions for `fresh_produce`/`frozen_food` (4–6 °C vs their policies) — the normal pattern is now policy-midpoint-based.
5. **Phase 2A JS bug caught by cross-language verification:** `plannedWindow` multiplied hour durations by 60,000 ms instead of 3,600,000 ms (windows 60× too short). Unit tests had masked it because `ON` position short-circuits on `current_segment_id`. Fixed and covered by a new regression test (`plannedWindow` exact timestamps).
6. **Test expectation correction:** 60-minute holes are failures (≥ 4× interval), not gaps — test updated to assert both gap and failure thresholds.

---

## 11. Known issues and limitations

| # | Item | Status |
|---|---|---|
| 1 | Post-delivery breaches are excluded from live evaluation but not emitted as `post_delivery` records | Phase 3 enhancement (design intent); documented |
| 2 | Conflicting overlapping assignments (A006) exist as data; the fleet service does not yet flag `conflicting_assignments` | Phase 3 service enhancement |
| 3 | Carrier-alternative rejections are in ground truth but the endpoint is Phase 3 | Expected |
| 4 | Readings cover a 24-hour window (NOW−18 h … NOW+6 h), not the full multi-day transit | Demo-scale decision, documented |
| 5 | Cold-chain share is 22/48 shipments (scenario-driven; baseline fillers follow 15–20%) | Documented deviation from the indicative proportion |
| 6 | SCN-009/SCN-014 not generatable under DB constraints; upcoming branch of SCN-008 not fixture-covered | Unit-tested in JS; documented |
| 7 | `--now` changes timestamps (deterministic per anchor); default is the frozen demo window | Documented |
| 8 | No ML anywhere; policy thresholds are illustrative placeholders, not regulatory claims | By design |

---

## 12. Readiness status

**Phase 2B (synthetic data generator and ground truth): COMPLETE — ready for Phase 3 (vertical slices).**

- Deterministic, contract-valid fixtures exist for every approved scenario that the schema permits; ground truth is computed and cross-verified against the real JS services.
- PostgreSQL seed/import is transactional, referentially checked and reproducible; DB counts match the fixtures exactly.
- 48 Python tests + 64 JS tests pass; a genuine implementation bug was found and fixed by the ground-truth verification.

**Next steps:** Phase 3 — expose REST endpoints over the existing services and seeded data (`/api/disruptions/:id/affected-shipments`, alternatives, fleet, excursions, alerts), then wire the dashboard.
