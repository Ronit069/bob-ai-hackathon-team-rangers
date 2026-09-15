# Member 1 — Disruption Matching Design (Affected Shipment Detection)

**Role:** Logistics and Optimisation Engineer
**Status:** DRAFT — algorithm design for R1. Baseline rules are frozen in `scope-freeze.md` §1.2; refinements are marked as amendment A-1 and require joint approval.
**Related:** `member-1-logistics-data-design.md`, `member-1-logistics-test-plan.md` (LT-01…LT-09)

---

## 1. Purpose and scope

Identify every shipment affected by an active disruption, deterministically and explainably, and classify how it is affected. No ML, no geometry: region-code matching plus time-window reasoning plus current-position reasoning.

Inputs considered (as required by the brief): disruption location/corridor (`region_code`), route segments, shipment route, shipment status, planned travel window, disruption start/end, severity, current shipment location.

---

## 2. Definitions

| Term | Definition |
|---|---|
| Active disruption | `status = active` AND `start_time <= now` AND (`end_time IS NULL` OR `end_time >= now`) |
| Matched segment | A route segment whose `region_code` equals an active disruption's `region_code` |
| Segment planned window | `[planned_departure + Σ durations(seq < k), + planned_duration_hours]` for the matched segment `k` |
| Position | Shipment's relation to the matched segment: `ON`, `BEFORE`, `PAST`, `UNKNOWN` |
| Exposure | The shipment's planned or actual presence in the disrupted region during the disruption window |
| Passed | Segment window ends strictly before the disruption starts (`segEnd < disruption.start_time`) |
| Upcoming | Segment window starts strictly after a **known** disruption end (`segStart > disruption.end_time`) |

---

## 3. Time-window mathematics

### 3.1 Segment planned window

```
offset(k)   = Σ planned_duration_hours of segments with seq < k
segStart(k) = shipment.planned_departure + offset(k)
segEnd(k)   = segStart(k) + segment(k).planned_duration_hours
```

If `planned_departure` is null → window unknown (`timing_basis = "unknown"`).

### 3.2 Overlap rules (inclusive boundaries, documented)

```
overlap(segStart, segEnd, dStart, dEnd):
    dEndOrInf = dEnd if dEnd != null else +∞
    return segStart <= dEndOrInf AND segEnd >= dStart

passed  = segEnd < dStart
upcoming = dEnd != null AND segStart > dEnd
```

Boundary semantics: a segment window ending exactly when the disruption starts **overlaps** (inclusive). This is deliberate and tested (LT-06).

### 3.3 Disruption window

- `end_time = null` → open-ended: the disruption is treated as ongoing; future arrivals are `at_risk`, never assumed safe.
- `status = scheduled` or start in the future → not currently active → does not trigger matching.
- `status = resolved` or end in the past → not active → does not trigger matching (history preserved).

---

## 4. Impact statuses

| Status | Rank | Meaning |
|---|---|---|
| `critical` | 5 | Shipment is **currently inside** the matched segment and the disruption severity is 4–5 — immediate intervention |
| `blocked` | 4 | Shipment is **currently inside** the matched segment (severity 1–3) — cannot proceed as planned |
| `delayed` | 3 | Exposure occurred or is definite: shipment traversed the segment during the disruption, or is planned to arrive while a known disruption window is still active |
| `unknown_review` | 2 | Route/segment data missing or position unresolvable — a human must review; never silently "unaffected" |
| `at_risk` | 1 | Future or uncertain exposure: disruption end unknown, or timing unknown but route is known — conservative inclusion with low confidence |
| `unaffected` | 0 | Passed before the disruption started, or arrival after a known end — excluded from the affected list (under amendment A-1) |

**Aggregation precedence:** `critical > blocked > delayed > unknown_review > at_risk > unaffected` (worst status wins across multiple disruptions).

---

## 5. Algorithm

### 5.1 Classification decision table

| Position | Timing | Disruption end | Result |
|---|---|---|---|
| `ON` | — | — | `blocked`; `critical` if severity ≥ 4 |
| `PAST` | window known, `segEnd < dStart` | — | `unaffected` (A-1) |
| `PAST` | window known, `segEnd >= dStart` | — | `delayed` (traversed during disruption) |
| `PAST` | window unknown | — | `delayed` (exposure presumed; low confidence) |
| `BEFORE` | window known, `segStart <= dEnd` | known | `delayed` (planned arrival during disruption) |
| `BEFORE` | window known, `segStart > dEnd` | known | `unaffected` (A-1) |
| `BEFORE` | window known | unknown | `at_risk` (arrival may coincide) |
| `BEFORE` | window unknown | any | `at_risk`, `timing_basis = unknown` |
| `UNKNOWN` | window known | — | derive position from `now` vs window, then apply ON/PAST/BEFORE rows |
| `UNKNOWN` | window unknown | — | `unknown_review` if route data also missing, else `at_risk` |
| any | route null / no segments / region null | — | `unknown_review` |

### 5.2 Pseudocode (implementation-ready)

```text
function matchShipments(now):
    active = [d for d in disruptions
              if d.status == "active"
              and d.start_time <= now
              and (d.end_time == null or d.end_time >= now)]
    regionIndex = group active by d.region_code

    rows = []
    for shipment in shipments where shipment.status in {planned, in_transit, delayed}:
        route = routes[shipment.route_id]
        if route == null or route.segments is empty:
            rows.append(row(shipment, unknown_review, "route_data_missing"))
            continue

        matches = []
        for seg in route.segments ordered by seq:
            for d in regionIndex.get(seg.region_code, []):
                matches.append(classify(shipment, route, seg, d, now))

        if matches is empty:
            continue                      # unaffected; not listed

        worst = matches.max(by STATUS_PRECEDENCE)
        rows.append(buildRow(shipment, worst, matches))

    return rows.sortedBy(impact_score desc, status rank desc, deadline asc)

function classify(shipment, route, seg, d, now):
    window   = plannedWindow(shipment, route, seg)
    position = relativePosition(shipment, route, seg)
    if position == UNKNOWN and window != null:
        position = positionFromTime(window, now)

    if position == ON:
        status = d.severity >= 4 ? critical : blocked
        return match(seg, d, status, "currently_in_affected_segment", window)

    if position == PAST:
        if window != null and window.end < d.start_time:
            return match(seg, d, unaffected, "segment_passed_before_disruption", window)
        return match(seg, d, delayed, "traversed_during_disruption", window)

    if position == BEFORE:
        if window == null:
            return match(seg, d, at_risk, "timing_unknown", null)
        if d.end_time != null and window.start > d.end_time:
            return match(seg, d, unaffected, "arrival_after_disruption_end", window)
        if d.end_time != null and window.start <= d.end_time:
            return match(seg, d, delayed, "planned_arrival_during_disruption", window)
        return match(seg, d, at_risk, "disruption_end_unknown", window)

    return match(seg, d, unknown_review, "position_unknown", window)

function plannedWindow(shipment, route, seg):
    if shipment.planned_departure == null: return null
    offset = sum(s.planned_duration_hours for s in route.segments where s.seq < seg.seq)
    start  = shipment.planned_departure + offset
    return { start: start, end: start + seg.planned_duration_hours }

function relativePosition(shipment, route, seg):
    if shipment.current_segment_id == seg.id:  return ON
    if shipment.current_segment_id == null:    return UNKNOWN
    current = route.segments[shipment.current_segment_id]
    if current == null:                        return UNKNOWN
    if current.seq > seg.seq:                  return PAST
    if current.seq < seg.seq:                  return BEFORE
    return UNKNOWN
```

### 5.3 Impact score (frozen formula — unchanged)

```
impact_score = 0.4 * cargo_value_norm + 0.4 * deadline_urgency_norm + 0.2 * is_cold_chain
```

- `cargo_value_norm` and `deadline_urgency_norm` are min–max normalised across the candidate set; when `max == min`, both norms are `0.5` (documented, deterministic).
- Weights live in configuration (defaults above), not hardcoded.
- **Severity is not part of the frozen score.** It drives `impact_status` and display only. Any severity-weighted risk refinement is a joint decision with Member 2 in the shared risk engine (see `member-1-logistics-requirements.md` §8 I1).

### 5.4 Match reason (human-readable, required on every row)

Format: `route {route_id} segment {segment_id} ({region_code}) matches disruption {disruption_id}; {status_reason}`.

Example: `route R045 segment SEG-012 (IN-WEST-COAST) matches disruption D01; currently_in_affected_segment`.

### 5.5 Output row contract (amendment A-2 — additive)

```json
{
  "shipment": { "id": "S102", "cargo_type": "vaccine", "is_cold_chain": true, "cargo_value_usd": 520000, "deadline": "2026-09-18T10:00:00Z", "status": "in_transit" },
  "impact_status": "critical",
  "match_reason": "route R045 segment SEG-012 (IN-WEST-COAST) matches disruption D01; currently_in_affected_segment",
  "matched_segment_ids": ["SEG-012"],
  "matched_disruptions": [
    { "disruption_id": "D01", "severity": 4, "status": "critical", "reason": "currently_in_affected_segment" }
  ],
  "timing_basis": "planned",
  "confidence": "high",
  "impact_score": 0.86,
  "impact_factors": { "cargo_value_norm": 0.95, "deadline_urgency_norm": 0.80, "is_cold_chain": true }
}
```

---

## 6. Handling the required edge situations

| Situation | Behaviour |
|---|---|
| Disruption timing unknown (no `end_time`) | Treated as open-ended. `BEFORE` arrivals → `at_risk`; `ON` → blocked/critical. Never assumed safe. |
| Route information missing (route null, zero segments, or segment `region_code` null) | `unknown_review` with reason `route_data_missing` / `region_missing`. The shipment is surfaced, not dropped. |
| Shipment already delivered (or cancelled) | Excluded from matching entirely (status filter). Not listed, not scored. |
| Multiple disruptions affect one shipment | Each match evaluated independently; `matched_disruptions[]` lists all; final status = worst by precedence. Example E7. |
| Segment already passed before disruption start | `unaffected` under A-1 (baseline frozen rule would include it; see §7). |
| Arrival after known disruption end | `unaffected` under A-1 (no exposure). |
| Planned times missing | `at_risk`, `timing_basis = "unknown"`, confidence `low`. |
| Position unknown (`current_segment_id` null while in transit) | Derive from planned window vs `now`; if that is impossible → `at_risk` (route known) or `unknown_review` (route data missing). |
| Disruption `scheduled`/future, or `resolved`/past | Not active → does not trigger matching. |

---

## 7. Amendment A-1 — planned-window relevance filter (pending approval)

**Baseline (frozen):** every shipment whose route contains a region-matching segment is "affected", regardless of timing.
**Refinement (proposed):** shipments that provably passed the segment before the disruption started, or arrive after a known disruption end, are `unaffected` and excluded from the list.

| | Baseline | Refined (A-1) |
|---|---|---|
| Passed segment before disruption | listed, `at_risk` (conservative) | excluded, `unaffected` |
| Arrival after known end | listed, `at_risk` (conservative) | excluded, `unaffected` |
| False positives in demo | visible (e.g. S088 listed for D01) | removed |
| Risk | inflated blast radius | requires A-3 planned-time fields |

**Recommendation:** approve A-1 + A-3. If rejected, the algorithm above still runs; the two `unaffected` rows collapse to `at_risk` with reason `exposure_not_confirmed`, and the affected list keeps the frozen semantics.

---

## 8. Worked examples

All values are synthetic and illustrative. `now = 2026-09-14T09:00:00Z`.

**E1 — Currently inside the segment (critical)**
- S102, route R045, segment SEG-012 (seq 2, `IN-WEST-COAST`, 96 h), `current_segment_id = SEG-012`, `planned_departure = 2026-09-05T12:00:00Z`.
- Window: seg1 120 h → `segStart = 2026-09-10T12:00Z`, `segEnd = 2026-09-14T12:00Z`. `now` is inside.
- D01: `IN-WEST-COAST`, active, severity 4, window `[09-14T06:00, 09-17T06:00]`.
- Position `ON` → **`critical`** (severity ≥ 4). `impact_score = 0.86` (high value + cold chain + near deadline).

**E2 — Passed before the disruption (unaffected under A-1)**
- S088, route R060, segment SEG-030 (`IN-WEST-COAST`, seq 1), window `[09-05T00:00, 09-09T00:00]`, `current_segment_id` at seq 3.
- D01 starts `09-14T06:00` → `segEnd (09-09) < dStart` → `PAST` → **`unaffected`** under A-1.
- Baseline (frozen) would list it as `at_risk`; this is exactly the false positive A-1 removes.

**E3 — Arrival after a known end (unaffected under A-1)**
- S140, route R052, segment SEG-040 (`EU-ROTTERDAM`, seq 2), window `[09-20T00:00, 09-24T00:00]`, `current_segment_id` at seq 1.
- D03: `EU-ROTTERDAM`, active, window `[09-14T00:00, 09-15T00:00]`.
- `segStart (09-20) > dEnd (09-15)` → **`unaffected`** under A-1 (no exposure).

**E4 — Planned arrival during a known disruption (delayed)**
- S155, route R070, segment SEG-050 (`IN-WEST-COAST`, seq 3), window `[09-15T00:00, 09-17T00:00]`, `current_segment_id` at seq 1.
- D01 end `09-17T06:00`; `segStart (09-15) <= dEnd` → `BEFORE` → **`delayed`**.

**E5 — Disruption end unknown (at_risk)**
- S177, route R066, segment SEG-060 (`SG-SINGAPORE`, seq 2), window `[09-16T00:00, 09-19T00:00]`, `current_segment_id` at seq 1.
- D02: `SG-SINGAPORE`, active, `end_time = null`, severity 3.
- `BEFORE` + unknown end → **`at_risk`** (arrival may coincide with an ongoing disruption).

**E6 — Missing route data (unknown_review)**
- S201, route R071 exists but has **zero segments** in the fixture (deliberate data defect).
- Matching cannot resolve any region → **`unknown_review`**, reason `route_data_missing`. Surfaced to the operator, never dropped.

**E7 — Multiple disruptions (worst wins)**
- S102 matches D01 via SEG-012 (`ON` → `critical`) and D05 via SEG-013 (`AE-JEBEL-ALI`, seq 3, `BEFORE`, known end → `delayed`).
- Aggregation: **`critical`**; `matched_disruptions = [D01 critical, D05 delayed]`.

**E8 — Delivered shipment (excluded)**
- S250, `status = delivered`, route contains SEG-012, D01 active.
- Status filter excludes it before matching → **not listed**. (Test LT-08.)

**E9 — Planned times missing (at_risk, low confidence)**
- S260, route R075, segment SEG-070 (`IN-WEST-COAST`, seq 2), `planned_departure = null`, `current_segment_id` at seq 1.
- `BEFORE` + window unknown → **`at_risk`**, `timing_basis = "unknown"`, confidence `low`.

---

## 9. Determinism and complexity

- Pure function of (shipments, routes, segments, disruptions, `now`) — no randomness, no wall-clock dependence beyond `now` injected as a parameter.
- Complexity: O(S × G) where S = active shipments and G = segments per route; region index makes disruption lookup O(1). Dataset size (`scope-freeze.md` §1.3) is trivial for this.
- Sorting is stable with explicit tie-breakers (`impact_score` desc, status rank desc, `deadline` asc, `shipment_id` asc) so results are reproducible across runs.
- `now` is injectable for tests (no frozen-clock flakiness).

---

## 10. Open points for Member 2

1. **A-1/A-2/A-3 approval** — refined statuses and planned-time fields affect the shared contract.
2. **Risk engine input** — logistics provides `affected` (boolean) and `impact_score`; `impact_status` is display/prioritisation metadata. Severity weighting stays out unless jointly agreed.
3. **Reason-code vocabulary** — `match_reason` and status reasons above should be reused by the cold-chain domain where shapes overlap (one explanation style).
