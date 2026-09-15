# Member 2 — Temperature Excursion Detection Design

**Role:** Cold-Chain, AI and IBM Bob Engineer
**Status:** DRAFT — deterministic baseline for R5. Threshold/boundary rules are frozen in `scope-freeze.md` §1.2; grouping/closure rules are proposed for freezing as B-3.
**Related:** `member-2-coldchain-data-design.md`, `member-2-severity-classification.md`, `member-2-coldchain-test-plan.md` (CT-01…CT-25)

---

## 1. Purpose and scope

Detect temperature excursions deterministically from ingested readings, with explicit handling of every data-quality condition. No ML, no interpolation, no guessing: every conclusion is traceable to specific readings.

**Detection answers:** *was the cargo outside its policy range, for how long, how far, and can we trust the data?*
**Classification (separate doc) answers:** *how severe is it and what should the human do?*

---

## 2. Inputs and sampling model

| Input | Source | Notes |
|---|---|---|
| Readings | `sensor_reading` rows, ordered by `timestamp` | expected interval 15 min (`SENSOR_INTERVAL_MIN`, configurable) |
| Policy | `temperature_policy` for the shipment's `cargo_type` | missing → review state (§8) |
| Shipment | `shipment.status`, `deadline`, `actual_arrival` (A-3 if approved) | delivery cutoff (§4.3) |
| Config | `SENSOR_GAP_MULTIPLIER = 2` (30 min), `SENSOR_FAILURE_MULTIPLIER = 4` (60 min), `EXCURSION_GROUP_GAP_MINUTES = 30` | frozen defaults |

Sampling model: one sensor per shipment (MVP), readings arrive out of order and may duplicate; the pipeline never assumes arrival order.

---

## 3. Detection pipeline

```
1. INGEST      validate → store (dedupe at read time, not at write)
2. NORMALISE   per shipment: order by timestamp; dedupe (sensor_id, timestamp); mark out_of_order
3. QUALITY     compute gap flags (> 2× interval) and failure windows (≥ 4× interval)
4. EVALUATE    breach(t) = t < policy.min_c OR t > policy.max_c      (boundary inclusive)
5. GROUP       consecutive breaching readings with gaps ≤ 30 min form one excursion; larger gaps split
6. MEASURE     start, end (nullable), duration_min, peak_deviation_c
7. QUALIFY     data_quality: complete | missing_readings | sensor_failure | out_of_order
8. CLASSIFY    severity ladder (separate doc) — or unknown_review when data/policy cannot support a conclusion
9. PUBLISH     excursion record + alert; update shipment cold-chain status; hand coldchain_risk to the shared risk engine
10. CLOSE      recovery sets end_time; human acknowledgement/closure sets status (B-7 endpoint)
```

Evaluation is **idempotent**: re-running over the same readings produces the same excursions (deterministic recompute). Ongoing excursions are updated as new breaches arrive; only the human lifecycle (`acknowledged`/`closed`) is monotonic.

---

## 4. Boundary and time-window rules

### 4.1 Boundary (frozen)

```
breach = temperature_c < policy.min_c OR temperature_c > policy.max_c
```

- Exactly `min_c` or `max_c` → **within limits** (tested CT-02). The UI shows "within limits (at boundary)".
- No tolerance band, no rounding tricks: the comparison uses the stored one-decimal values.

### 4.2 Evaluation window

- Start: first reading of the shipment (or `planned_departure` if earlier and A-3 approved).
- End: `delivery_cutoff` when known (§4.3); otherwise `now` (live evaluation).

### 4.3 Delivery cutoff (B-5)

| Situation | Cutoff used |
|---|---|
| `actual_arrival` present (A-3 approved) | `actual_arrival` |
| `status = delivered`, no `actual_arrival` | status-change time (`updated_at`) — **approximation, labelled** |
| Not delivered | `now` |

Readings after the cutoff are **excluded from pre-delivery evaluation**. A breach found entirely after the cutoff is logged as `post_delivery = true` (kept for history, excluded from live alerts and pre-delivery severity).

---

## 5. Duration calculation

For each grouped excursion:

```
start_time   = timestamp of the first breaching reading in the group
end_time     = timestamp of the last breaching reading in the group (null if the breach is still ongoing)
duration_min = round((end_time − start_time) in minutes)      // 0 for a single breaching reading
peak_deviation_c = max over group readings of:
                   (policy.min_c − t)  when t < min_c
                   (t − policy.max_c)  when t > max_c
```

- Duration is **measured from readings**, never extrapolated across a data gap.
- If a gap (> 30 min) falls **inside** the excursion window, duration is still computed between known breaches, but `data_quality = missing_readings` and severity becomes `unknown_review` (frozen rule — the true duration may be longer).
- A single breaching reading → `duration_min = 0`; it is still an excursion (never discarded).

---

## 6. Quality conditions (each handled explicitly)

| Condition | Detection | Handling | Effect on severity |
|---|---|---|---|
| **Duplicate** | same `(sensor_id, timestamp)` more than once | keep the first for evaluation; count and flag the rest | none (deduped) |
| **Out-of-order** | reading timestamp earlier than the previous ingested one | reorder by timestamp before evaluation; flag | none (ordering corrected); `data_quality = out_of_order` |
| **Implausible** | temperature outside −40..60 °C | retain and flag; **never trust as the sole breach** | sole breach → `unknown_review` (B-6); otherwise plausible breaches drive severity with a note |
| **Gap** | no reading for > 30 min (> 2× interval) | `missing_readings`; alert visible | gap overlapping an excursion window → `unknown_review` |
| **Sensor failure** | no reading for ≥ 60 min (≥ 4× interval) | distinct `sensor_failure` alert; sensor status `failed` | any open excursion → `unknown_review`; **no compliance claim** |

**Missing ≠ safe:** a gap means "we do not know", not "in range". The pipeline never fills gaps, never interpolates, and never classifies a window containing a gap as Normal.

**Failure ≠ gap:** a gap is a hole inside a reporting feed (readings resume); failure is the feed stopping (no resumption within the window). Both are surfaced; failure raises its own alert type.

---

## 7. Excursion grouping and closure (proposed freeze — B-3)

### 7.1 Grouping

```
two breaching readings belong to the same excursion if
    (t_next − t_prev) <= EXCURSION_GROUP_GAP_MINUTES      // default 30 min = 2× sampling interval
otherwise they start a new excursion
```

- A 10-minute break in breaches (with readings in between) → same excursion (the cargo never recovered to range for long).
- A 2-hour recovery → two excursions, each logged individually (tested CT-07).
- Merging is based on **breaching readings only**; in-range readings between breaches do not split the group unless the gap exceeds the threshold. *(Rationale: brief blips back into range during a sustained problem must not fragment the record.)*

### 7.2 Recovery and closure

| Event | Effect |
|---|---|
| First in-range reading after the last breach | `end_time` set to the last breaching timestamp; excursion is "recovered" (still `open` until reviewed) |
| More breaches after recovery within 30 min | **new excursion** (grouping rule) |
| Breach still ongoing (no in-range reading yet) | `end_time = null`; duration grows on re-evaluation |
| Feed stops (sensor failure) with no recovery | `end_time` stays `null`; `data_quality = sensor_failure`; alert raised |
| Shipment delivered | evaluation stops at cutoff; open excursions remain for review but leave the live alert list |
| Operator action | `open → acknowledged → closed` via `POST /api/excursions/:id/status` (B-7); each transition writes an audit record |

---

## 8. Unknown policy and unknown cargo type

- **No policy for the cargo type:** the system cannot define a breach. No excursion record is fabricated. The shipment is marked **cold-chain review required** (`policy_missing`), an alert of type `unknown_policy` is raised, `coldchain_risk = 0.5` (frozen unknown weight) with low confidence. **Never marked compliant.**
- **Unknown cargo type** (not in the vocabulary): same review state (`unknown_cargo_type`), plus a data-quality note.
- Adding the missing policy later triggers re-evaluation: excursions may then be detected retroactively within the retained readings (history is never deleted).

---

## 9. Repeated excursions and shipment-level status

- Each excursion group is a separate `EX-####` record (tested CT-07).
- Shipment-level cold-chain status = **worst open excursion** by severity precedence: `critical > major > warning > unknown_review`; no excursion and no review flag → `normal`.
- `excursion_count` is part of the risk factors; repeated excursions do not average out — the worst drives the score (frozen mapping).

---

## 10. Pseudocode (implementation-ready)

```text
function detectExcursions(shipment, readings, policy, cutoff, now, config):
    if policy == null:
        return reviewState(shipment, "policy_missing")

    ordered = dedupeAndOrder(readings)                    # dedupe (sensor_id, timestamp), sort by timestamp
    quality = computeQualityFlags(ordered, config)        # gaps, failures, out-of-order, implausible

    evaluated = [r for r in ordered if cutoff == null or r.timestamp <= cutoff]
    postDelivery = [r for r in ordered if cutoff != null and r.timestamp > cutoff]

    breaches = [r for r in evaluated if isBreach(r, policy)]   # strict inequalities
    if breaches is empty:
        return { excursions: [], sensorStatus: statusFrom(ordered, now, config), quality: quality }

    groups = groupByGap(breaches, config.EXCURSION_GROUP_GAP_MINUTES)
    excursions = []
    for g in groups:
        start = g.first.timestamp
        end   = g.last.timestamp                  # null semantics handled below
        duration = minutes(end − start)           # 0 if single reading
        peak = maxDeviation(g, policy)

        dq = "complete"
        if hasGapInside(g, quality):        dq = "missing_readings"
        if hasFailureOverlap(g, quality):   dq = "sensor_failure"
        else if hasOutOfOrder(g, quality):  dq = "out_of_order"
        if soleBreachIsImplausible(g):      dq = "unknown_review"    # B-6

        ongoing = noInRangeReadingAfter(evaluated, g.last)
        excursions.append({
            shipment_id: shipment.id, policy_id: policy.id,
            start_time: start, end_time: ongoing ? null : end,
            duration_min: duration, peak_deviation_c: peak,
            data_quality: dq, status: "open", detected_at: now
        })

    return { excursions, sensorStatus: statusFrom(ordered, now, config), quality, postDelivery }
```

Severity is assigned by `classifySeverity(excursion, policy, shipment, now)` (`member-2-severity-classification.md` §3). Excursion persistence is idempotent per `(shipment_id, start_time, end_time)` group identity.

---

## 11. Worked examples (synthetic, illustrative)

Policy: vaccine `min 2.0 / max 8.0 / tolerance 15 min / minor 1.0 / major 3.0 / critical duration 60 min`.

**E1 — Normal readings**
`[4.2, 5.1, 6.0, 7.4]` → no breaches → **no excursion**, shipment status `normal`.

**E2 — Exactly at the boundary (CT-02)**
`[2.0, 8.0, 8.0, 2.0]` → no strict breach → **no excursion**; UI shows "within limits (at boundary)".

**E3 — Short excursion → Warning (CT-05)**
`08:00 7.2, 08:15 8.8, 08:30 7.9` → one breach (`8.8`, deviation 0.8), duration 0 ≤ 15, magnitude 0.8 ≤ minor 1.0 → **Warning**.

**E4 — Prolonged excursion → Major (CT-06)** *(the corrected EX-0003 example)*
`08:00 7.0, 08:15 9.0, 08:30 10.4, 09:00 9.1, 09:15 7.8` → breach from 08:15 to 09:00 → duration 45 min > 15; peak deviation 2.4 ≤ major 3.0 → **Major** (`duration>tolerance;magnitude<=major`).

**E5 — Large deviation → Critical**
`10:00 8.6, 10:15 11.5, 10:30 8.2` → duration 15 ≤ tolerance but magnitude 3.5 > major 3.0 → **Critical** (`magnitude>major`).

**E6 — Repeated excursions (CT-07)**
Breach 08:15–08:45, recovered, second breach 10:45–11:30 → gap 120 min > 30 → **two excursions**; shipment status = worst (`major` over `warning`); `excursion_count = 2`.

**E7 — Missing readings inside a breach (CT-08)**
Breach at 08:15 (`9.4`), then no readings until 09:45 (`9.1`), then in range → gap 90 min > 30 inside the window → `data_quality = missing_readings` → severity **Unknown / Review Required** (duration is unreliable).

**E8 — Sensor failure (CT-11)**
Last reading 08:00 (in range); no readings by 09:15 (75 min ≥ 60) → `sensor_failure` alert, sensor status `failed`; any previously open excursion → `unknown_review`; **no compliance claim**.

**E9 — Unknown policy (CT-12)**
Shipment cargo type `vaccine_lot_x` has no policy → no excursion fabricated; review flag `policy_missing`; `coldchain_risk = 0.5`, confidence low; alert type `unknown_policy`.

**E10 — Post-delivery breach (CT-15)**
Delivered at 12:00; breach readings at 12:30 → logged `post_delivery = true`, excluded from live alerts and pre-delivery severity.

---

## 12. Output contract

Each detected excursion (see `member-2-coldchain-data-design.md` §3) plus derived additions returned to the API:

```json
{
  "id": "EX-0003", "shipment_id": "S102", "policy_id": "TP-VACCINE",
  "start_time": "2026-09-14T08:15:00Z", "end_time": "2026-09-14T09:00:00Z",
  "duration_min": 45, "peak_deviation_c": 2.4,
  "severity": "major", "severity_rationale": "duration>tolerance;magnitude<=major",
  "data_quality": "complete", "status": "open", "detected_at": "2026-09-14T08:16:00Z",
  "post_delivery": false, "time_to_delivery_hours": 25.0, "recommended_action": "Review and consider intervention"
}
```

---

## 13. Edge-case summary (all tested)

| Edge case | Behaviour |
|---|---|
| Exactly at threshold | within limits (inclusive) |
| Very brief excursion | Warning if magnitude ≤ minor and duration ≤ tolerance; otherwise Major per ladder |
| Long excursion | Major/Critical per ladder; duration never extrapolated across gaps |
| Repeated excursions | separate records; worst drives shipment status |
| Missing readings | `missing_readings`; overlapping breach → `unknown_review` |
| Duplicate readings | deduped; counted in evidence |
| Out-of-order readings | reordered; flagged; severity still computed |
| Implausible spike as sole breach | `unknown_review` (B-6) |
| Sensor failure | distinct alert; `unknown_review` for any open excursion |
| Unknown policy / cargo type | review state; never compliant; risk 0.5 (unknown) |
| Already delivered | post-delivery logged, excluded from live alerts |
| Near delivery | `time_to_delivery_hours` surfaced with severity |
| Ongoing breach | `end_time = null`; duration grows on re-evaluation |
| Recovery | `end_time` set; excursion remains open for human review |
| Policy added later | retroactive re-evaluation over retained readings |

---

## 14. Open points for Member 1

1. **B-3 freeze** (grouping/closure rules) and **B-6** (implausible readings) — needed for a deterministic contract.
2. **B-5 / A-3** — precise delivery cutoff requires `actual_arrival`; otherwise the MVP approximation is labelled in limitations.
3. **Cold-chain risk handoff** — `coldchain_risk` + factors enter the shared `RiskAssessment` (SH-02); confirm key names (§6 of the data design).
4. **B-7** — excursion status endpoint is required for the human review lifecycle (acknowledge/close).
