# Member 2 — Severity Classification Design

**Role:** Cold-Chain, AI and IBM Bob Engineer
**Status:** DRAFT — rule-based classification for R6. The ladder is frozen in `scope-freeze.md` §1.2; two defects found in it are recorded as proposals B-8 (branch order) and B-4 (risk modifiers, separate doc).
**Related:** `member-2-excursion-detection.md`, `member-2-combined-risk.md`, `member-2-coldchain-test-plan.md` (CT-02, CT-05, CT-06, CT-12…CT-15, CT-22)

---

## 1. Framework principles

1. **Policy-driven, not universal.** Severity is computed against the shipment's `TemperaturePolicy`, which is configurable per cargo type. The system does not hardcode "the" correct temperature range for any product.
2. **Transparent.** Every label is derived from a small rule ladder; the rationale string lists exactly which conditions fired.
3. **Uncertainty is a first-class outcome.** Missing data, sensor failure, unknown policy or unknown cargo type produce `Unknown / Review Required` — never a silent "Normal" or "compliant".
4. **No regulatory claim.** The labels are operational priority indicators, not compliance determinations. Real deployment requires product-specific and jurisdictional input; this is stated in the README and deck.
5. **Thresholds depend on:** cargo type (policy), specific product (policy version), customer policy (who edits the policy), applicable regulatory context (inputs to policy values, not encoded by us), excursion magnitude, excursion duration, and time remaining before delivery (surfaced + optional risk modifier).

---

## 2. Severity states

| State | Type | Meaning |
|---|---|---|
| `Normal` | Shipment-level state | No open excursion and no review flag — **not** an excursion record |
| `Warning` | Excursion severity | Brief/small deviation within policy tolerance — monitor |
| `Major` | Excursion severity | Sustained or larger deviation — review and consider action |
| `Critical` | Excursion severity | Large or long deviation — immediate human review |
| `Unknown / Review Required` | Excursion severity | Data/policy prevents a conclusion — human must review |

Excursion records never carry `Normal` (frozen enum: `warning | major | critical | unknown_review`).

---

## 3. Rule ladder (frozen baseline) and inputs

### 3.1 Inputs

| Input | Source |
|---|---|
| `duration_min` | excursion detection (`member-2-excursion-detection.md` §5) |
| `magnitude = peak_deviation_c` | excursion detection |
| `data_quality` | `complete \| missing_readings \| sensor_failure \| out_of_order` |
| policy thresholds | `temperature_policy` (min/max, tolerance, minor, major, critical duration) |
| policy existence | null `policy_id` → unknown |
| `time_to_delivery_hours` | `shipment.deadline − now` (or `planned_arrival` if A-3 approved) |

### 3.2 Frozen ladder (as written in `scope-freeze.md` §1.2)

```
IF missing readings during window / unknown policy / sensor failure
                                                          → "Unknown / Review Required"
ELSE IF duration_min <= policy.max_excursion_minutes
        AND magnitude <= policy.minor_deviation_c         → "Warning"
ELSE IF magnitude <= policy.major_deviation_c             → "Major"
ELSE IF magnitude > policy.major_deviation_c
        OR duration_min > policy.critical_duration_minutes → "Critical"
ELSE                                                       → "Warning"   (defensive default)
```

### 3.3 Defects found (recorded, not silently changed)

| # | Defect | Effect | Proposal |
|---|---|---|---|
| D1 | Branch order: `magnitude <= major → Major` fires **before** the critical-duration check | `duration_min > critical_duration_minutes` can never independently escalate to Critical; the `critical_duration_minutes` policy field is currently **inert** | **B-8:** reorder to check `magnitude > major OR duration > critical → Critical` first, then `magnitude <= major → Major` |
| D2 | Final `ELSE → Warning` is unreachable (branch 2 covers every remaining case) | Harmless; retained as a defensive default | Document only |

**B-8 proposed ladder (recommended):**

```
IF missing readings / unknown policy / sensor failure     → "Unknown / Review Required"
ELSE IF duration_min <= policy.max_excursion_minutes
        AND magnitude <= policy.minor_deviation_c         → "Warning"
ELSE IF magnitude > policy.major_deviation_c
        OR duration_min > policy.critical_duration_minutes → "Critical"
ELSE IF magnitude <= policy.major_deviation_c             → "Major"
ELSE                                                       → "Warning"
```

**Impact if B-8 is rejected:** the literal frozen ladder is implemented; `critical_duration_minutes` stays inert and is documented as such; a long small-magnitude excursion remains `Major`.

**Note:** B-8 changes only the label ordering, not the Warning rule, the Unknown rule, or the policy fields.

---

## 4. Per-severity definitions

### 4.1 Normal (shipment-level)

| Aspect | Definition |
|---|---|
| Meaning | No open excursion and no review flag |
| Inputs | Open excursions for the shipment; review flags (`policy_missing`, `unknown_cargo_type`, `sensor_failure`, `missing_readings` on a potential breach) |
| Rule | `open_excursions = 0 AND review_flags = 0` |
| Output | `coldchain_status = "normal"` |
| Recommended action | None — keep monitoring |
| Evidence shown | Latest readings, policy bounds, sensor status |
| Human review | Not required |

### 4.2 Warning

| Aspect | Definition |
|---|---|
| Meaning | Brief and small deviation within tolerance |
| Inputs | `duration_min`, `magnitude`, policy tolerance and minor threshold |
| Rule | `duration_min <= max_excursion_minutes AND magnitude <= minor_deviation_c` |
| Output | `severity = "warning"`, rationale `duration<=tolerance;magnitude<=minor` |
| Recommended action | Monitor; no intervention required; re-check on next readings |
| Evidence shown | Breaching readings, duration, magnitude vs thresholds, data quality |
| Human review | Not mandatory; alert visible; may be acknowledged |

### 4.3 Major

| Aspect | Definition |
|---|---|
| Meaning | Sustained or larger deviation that deserves review |
| Inputs | `duration_min`, `magnitude`, policy minor/major thresholds |
| Rule (baseline) | Not Warning AND `magnitude <= major_deviation_c` |
| Output | `severity = "major"`, rationale e.g. `duration>tolerance;magnitude<=major` |
| Recommended action | Review now; consider intervention (reroute via M1 flow, redeployment, or customer notification) |
| Evidence shown | All excursion fields + time to delivery + policy values used |
| Human review | Recommended (surfaced in the review queue) |

### 4.4 Critical

| Aspect | Definition |
|---|---|
| Meaning | Large or long deviation requiring immediate human attention |
| Inputs | `magnitude`, `duration_min`, policy major threshold and critical duration |
| Rule (baseline literal) | `magnitude > major_deviation_c` (duration clause inert until B-8) |
| Rule (B-8) | `magnitude > major_deviation_c OR duration_min > critical_duration_minutes` |
| Output | `severity = "critical"`, rationale e.g. `magnitude>major` or `duration>critical` |
| Recommended action | Immediate compliance/ops review; evaluate whether cargo is salvageable; consider emergency options; notify stakeholders |
| Evidence shown | Full evidence bundle + time to delivery + data-quality caveats |
| Human review | **Required** — alert stays open until acknowledged and closed |

### 4.5 Unknown / Review Required

| Aspect | Definition |
|---|---|
| Meaning | The system cannot justify a conclusion; a human must review the data or policy gap |
| Inputs | `data_quality` (missing_readings, sensor_failure), policy existence, cargo type validity, implausible sole breach (B-6) |
| Rule | Missing readings inside the window, sensor failure, no policy, unknown cargo type, or sole implausible breach |
| Output | `severity = "unknown_review"`, rationale naming the cause (e.g. `policy_missing`, `missing_readings_in_window`) |
| Recommended action | Investigate the data/policy gap first; do not assume the cargo is safe or spoiled |
| Evidence shown | Gap map, sensor status, missing policy name, readings with flags |
| Human review | **Required** |

---

## 5. Policy-driven example (vaccine policy, synthetic)

Policy `TP-VACCINE`: min 2.0 / max 8.0 / tolerance 15 min / minor 1.0 / major 3.0 / critical duration 60 min.

| Scenario | Readings (peak) | Duration | Magnitude | Label (baseline / B-8) | Rationale |
|---|---|---|---|---|---|
| A — brief small | 8.8 | 0 min | 0.8 | Warning / Warning | `duration<=tolerance;magnitude<=minor` |
| B — sustained moderate | 10.4 | 45 min | 2.4 | Major / Major | `duration>tolerance;magnitude<=major` |
| C — large deviation | 11.5 | 15 min | 3.5 | Critical / Critical | `magnitude>major` |
| D — long small deviation | 9.2 | 75 min | 1.2 | **Major** / **Critical** | baseline: `duration>tolerance;magnitude<=major`; B-8: `duration>critical` |
| E — missing data in window | 9.4 then gap | unreliable | ≥1.4 | Unknown / Unknown | `missing_readings_in_window` |
| F — no policy | any | — | — | Unknown / Unknown | `policy_missing` |

Scenario D is the concrete case B-8 fixes: under the literal frozen ladder a 75-minute deviation is "only" Major; with B-8 it escalates to Critical because it exceeds the policy's critical duration.

---

## 6. Time remaining before delivery

- `time_to_delivery_hours` is computed from `shipment.deadline` (frozen) or `planned_arrival` (A-3, if approved) and attached to every excursion/alert.
- It is **not** part of the frozen severity label (the label stays policy + excursion driven).
- It **is** part of:
  - the recommended action text ("2 h to delivery — intervene now" vs "36 h to delivery — monitor");
  - the optional cold-chain risk modifiers (B-4);
  - Bob's answers and the action brief.
- Shipments already delivered: `time_to_delivery_hours = null`, alert marked post-delivery.

---

## 7. Human review lifecycle

| Severity | Review requirement | Lifecycle |
|---|---|---|
| Warning | Not mandatory | `open → acknowledged → closed` (operator may bulk-acknowledge) |
| Major | Recommended | same lifecycle; appears in the review queue |
| Critical | Required | same lifecycle; **cannot be bulk-closed**; requires a note (audit details) |
| Unknown/Review | Required | same lifecycle; closing requires a note explaining the data/policy resolution |

All transitions go through `POST /api/excursions/:id/status` (proposal B-7) and write an `audit_record`. The decision endpoint used by logistics recommendations is **not** reused for excursions — excursions are alerts with a review lifecycle, not recommendations (boundary confirmed with Member 1's ownership).

---

## 8. Edge cases (brief-mandated)

| Edge case | Behaviour |
|---|---|
| Exactly at threshold | Within limits (inclusive) — no excursion |
| Very brief excursion | Warning if within tolerance and ≤ minor magnitude; otherwise Major per ladder |
| Long excursion | Major/Critical per ladder; duration > critical → Critical under B-8 |
| Repeated excursions | Each classified separately; shipment status = worst open excursion |
| Missing data | `Unknown / Review Required` when it affects a breach window |
| Sensor failure | `Unknown / Review Required` for open excursions + distinct failure alert |
| Unknown cargo type | `Unknown / Review Required` (`unknown_cargo_type`) |
| Unknown policy | `Unknown / Review Required` (`policy_missing`); never compliant |
| Shipment already delivered | Post-delivery excursions excluded from live classification; history retained |
| Shipment close to delivery | `time_to_delivery_hours` surfaced; recommended action escalates in wording; B-4 may increase risk |

---

## 9. Threshold governance

- Policies are edited via `PUT /api/temperature-policies/:id` (M2-owned endpoint); every edit creates a **new version** and an audit record with before/after values.
- Old versions are retained so historical classifications remain explainable.
- The UI must label seed values as **illustrative placeholders** and link to this document.
- No code path hardcodes a temperature number: all thresholds come from the policy table (config).

---

## 10. Open points for Member 1

1. **B-8 decision** — recommended: approve the reorder so `critical_duration_minutes` is meaningful; otherwise it is documented as inert.
2. **B-3/B-6** — grouping and implausible-reading rules feed the inputs of this ladder.
3. **B-4** — optional risk modifiers; the severity **label** stays as defined here regardless of B-4.
4. **B-7** — excursion review lifecycle endpoint.
5. **Shared explanation vocabulary** — rationale codes here should render through the same display templates as logistics reasons (one style).
