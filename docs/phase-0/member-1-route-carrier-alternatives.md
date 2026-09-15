# Member 1 — Route and Carrier Alternatives Design

**Role:** Logistics and Optimisation Engineer
**Status:** DRAFT — R2 design. Hard constraints and the score shape follow `scope-freeze.md` §1.2; additive proposals (A-4, A-8, A-9) require joint approval.
**Related:** `member-1-logistics-data-design.md` §9.3, `member-1-logistics-test-plan.md` (LT-09…LT-14)

---

## 1. Purpose and scope

For an affected shipment, produce a ranked shortlist of feasible alternate routes and alternate carriers, with a transparent score and an explanation of every rejection. No advanced optimisation, no learned ranking, no live carrier feeds: deterministic filters + weighted scoring over synthetic data.

**Explicitly out of MVP:** multi-hop route construction, capacity rebalancing across shipments, cost negotiation, live carrier APIs, MIP solvers.

---

## 2. Candidate generation

### 2.1 Route candidates

A route is a candidate for shipment `s` if:
1. `route.origin_node = s.route.origin_node` AND `route.destination_node = s.route.destination_node` (same OD pair)
2. `route.status = active`
3. `route.id != s.route_id` (must be a genuine alternative)
4. `route.carrier.status = active`
5. Deduplicated by `route.id`

### 2.2 Carrier candidates

A carrier is a candidate for shipment `s` if:
1. `carrier.status = active`
2. `carrier.id != s.route.carrier_id`
3. Carrier serves the origin region (first segment of `s.route`) and destination region (last segment)
4. Carrier has ≥ 1 mode in common with the shipment's lane
5. `carrier.capacity_units >= s.volume_units`
6. Carrier has ≥ 1 feasible route for the OD pair (per §3)

Each carrier option carries its **backing route** — the best feasible route it would use — so the operator sees the actual path, not just a brand.

---

## 3. Hard filters (feasibility)

Applied in this order; first failure produces the rejection reason. A rejected candidate is never ranked.

| # | Constraint | Pass condition | Rejection reason |
|---|---|---|---|
| H1 | Route active | `route.status = active` | `route_inactive` |
| H2 | Carrier active | `carrier.status = active` | `carrier_inactive` |
| H3 | Not the current route | `route.id != current_route_id` | `same_as_current` |
| H4 | Avoids the triggering disruption | no segment with `region_code = triggering_disruption.region_code` | `disrupted_region_overlap` |
| H5 | Capacity sufficient | `route_capacity = min(segment.capacity_units) >= s.volume_units` | `insufficient_capacity` |
| H6 | Capacity data complete | every segment has `capacity_units > 0` | `missing_capacity_data` |
| H7 | Carrier serves regions | origin + destination regions in `carrier.service_regions` | `carrier_missing_regions` |
| H8 | Mode compatible | `carrier.modes ∩ route modes ≠ ∅` | `mode_incompatible` |

**Clarification A-8 (pending approval):** H4 excludes the **triggering** disruption only. Exposure to *other* active disruptions is not a hard filter — it is scored as `residual_risk` so the operator sees secondary risk instead of a silent exclusion.

**Optional configurable guard (not a contract change):** `MIN_CAPACITY_MARGIN` (default `0.00` = disabled). If a deployment enables it, candidates below the margin are rejected with `capacity_margin_below_minimum`. Not enabled in the MVP demo.

---

## 4. Ranking factors and score

### 4.1 Frozen score shape (`scope-freeze.md` §1.2)

```
score = w1*(1 − cost_norm) + w2*(1 − eta_norm) + w3*capacity_margin − w4*residual_risk
```

| Factor | Definition |
|---|---|
| `cost_norm` | min–max normalisation of `route.planned_cost_usd` across feasible candidates; `0.5` for all if `max = min` |
| `eta_norm` | min–max normalisation of `route.planned_duration_hours`; `0.5` if `max = min` |
| `capacity_margin` | `(route_capacity − shipment.volume_units) / route_capacity`, range 0–1 |
| `residual_risk` | severity-weighted share of route duration passing through regions of **other** active disruptions (0 if none), range 0–1 |

```
residual_risk(route, otherDisruptions) =
    Σ (severity_d / 5) * segment.duration_hours  for segments whose region matches otherDisruptions
    ────────────────────────────────────────────────────────────────────────────────────────────────
                                    route.planned_duration_hours
```

### 4.2 Default weights (configurable, frozen defaults)

| Weight | Default | Meaning |
|---|---|---|
| `w1` | 0.35 | cost |
| `w2` | 0.35 | ETA / duration |
| `w3` | 0.20 | capacity margin |
| `w4` | 0.10 | residual (secondary) risk |

Sum = 1.00. Score is clamped to `[0, 1]`.

### 4.3 Optional reliability term (amendment A-4 — pending approval)

If approved, carrier reliability is added for both route and carrier scoring:

```
score = w1*(1−cost_norm) + w2*(1−eta_norm) + w3*capacity_margin − w4*residual_risk + w5*reliability
extended defaults: w1=0.30, w2=0.30, w3=0.15, w4=0.10, w5=0.15
```

For routes, `reliability = carrier.reliability_score` of the route's carrier. If A-4 is rejected, reliability is displayed as an informational factor only — never silently scored.

### 4.4 Tie-breaking (deterministic)

`score desc → estimated_cost asc → estimated_duration asc → route_id asc` (then `carrier_id` for carrier options).

---

## 5. Estimated values and confidence

| Output | Rule | Notes |
|---|---|---|
| `estimated_cost` | `route.planned_cost_usd` | Integer USD; `cost_index` is already reflected in generated costs (decision D-2) |
| `estimated_eta` | `now + route.planned_duration_hours` (ISO timestamp) | Documented approximation: alternatives are treated as starting from the OD origin, not the shipment's mid-route position. `eta_delta_h` compares against the current route duration |
| `cost_delta_pct` | `(candidate_cost − current_cost) / current_cost × 100`, 1 decimal | Negative = cheaper |
| `eta_delta_h` | `candidate_duration − current_duration` | Positive = slower |

**Confidence (required by the brief as `confidence_or_uncertainty`):**

| Level | Conditions |
|---|---|
| `high` | ≥ 2 feasible candidates, shipment planned times present, all capacities present, carrier data complete |
| `medium` | exactly 1 feasible candidate, or missing planned times, or missing reliability data (when A-4 rejected: reliability always informational → does not lower confidence) |
| `low` | missing capacity data on the selected option, `target_approximate = true`, or conflicting assignment data detected |

`confidence_drivers` lists the specific causes (e.g. `["single_feasible_candidate", "planned_times_missing"]`).

---

## 6. Recommendation envelope (required fields)

Every option returned to the UI/Bob uses this logical payload; the wire mapping to the shared API contract is in §6.2.

### 6.1 Logical payload

```json
{
  "recommendation": { "type": "reroute", "route_id": "R089", "carrier_id": "C09" },
  "score": 0.884,
  "reasons": [
    "12% cheaper than the current route",
    "+6 h longer transit",
    "capacity margin 95% (220 units vs 12 required)",
    "passes SG-SINGAPORE where disruption D02 (severity 3) is active"
  ],
  "constraints": ["route_active", "carrier_active", "avoids_triggering_disruption", "route_differs_from_current", "capacity_ok", "capacity_data_complete"],
  "estimated_eta": "2026-09-20T09:00:00Z",
  "estimated_cost": 73920,
  "risk": { "residual_risk": 0.05, "risk_notes": ["segment SEG-088 (SG-SINGAPORE) overlaps active disruption D02 (severity 3)"] },
  "alternative_options": [
    { "route_id": "R095", "score": 0.176, "rejected_reason": null, "rank": 2 },
    { "route_id": "R091", "score": null, "rejected_reason": "disrupted_region_overlap" },
    { "route_id": "R100", "score": null, "rejected_reason": "insufficient_capacity" },
    { "route_id": "R102", "score": null, "rejected_reason": "same_as_current" }
  ],
  "confidence_or_uncertainty": { "level": "high", "drivers": [] }
}
```

### 6.2 Wire mapping to the shared contract (`api-contract.md` 3.8 / 3.9)

| Logical field | Wire location | Status |
|---|---|---|
| `recommendation` | `data[].route` / `data[].carrier` (+ `type` in factors) | existing |
| `score` | `data[].score` | existing |
| `constraints` | `data[].constraints_checked` | existing |
| `estimated_eta` | `data[].factors.estimated_eta` | existing jsonb |
| `estimated_cost` | `data[].factors.estimated_cost_usd` | existing jsonb |
| `risk` | `data[].factors.residual_risk` + `factors.risk_notes` | existing jsonb |
| `confidence_or_uncertainty` | `data[].factors.confidence_level` + `confidence_drivers` | existing jsonb |
| `reasons` (human strings) | `data[].reasons` | **additive — A-9** |
| `alternative_options` | `rejected[]` (with `route_id`/`carrier_id`, `score`, `rejected_reason`) | existing |
| `not_actionable` (delivered shipment) | top-level `not_actionable` + `not_actionable_reason` | **additive — A-9** |

`reasons` is a backend-rendered humanisation of the numeric factors so the UI, Bob evidence and tests all read the same strings. If A-9 is rejected, the UI renders from `factors` with shared display templates.

---

## 7. No-alternative behaviour

- Response: `200` with `data: []`, the full `rejected[]` list, and (A-9) `not_actionable: false`.
- UI/Bob message is derived from rejection reasons — e.g. "No feasible alternate route: all candidates overlap the disrupted region (2) or lack capacity (1)."
- **Never** fabricate a partial option, never return the disrupted route, never rank an infeasible candidate.
- The shipment remains actionable: the operator may still redeploy fleet (§ fleet design) or escalate manually.

---

## 8. Pseudocode

```text
function routeAlternatives(shipment, now, config):
    current = routes[shipment.route_id]
    triggering = activeDisruptions whose region matches any segment of current   // set
    others     = activeDisruptions − triggering

    feasible, rejected = [], []
    for route in routes where sameOD(route, current):
        reason = firstFailedConstraint(route, shipment, triggering)   // §3 H1–H6
        if reason: rejected.append({route_id: route.id, rejected_reason: reason}); continue
        feasible.append(route)

    if feasible is empty: return { data: [], rejected }

    costs = feasible.map(planned_cost_usd); etas = feasible.map(planned_duration_hours)
    for route in feasible:
        cost_norm = normalize(route.cost, costs)          // 0.5 if max == min
        eta_norm  = normalize(route.duration, etas)
        margin    = (routeCapacity(route) − shipment.volume_units) / routeCapacity(route)
        residual  = residualRisk(route, others)
        score     = clamp(w1*(1−cost_norm) + w2*(1−eta_norm) + w3*margin − w4*residual, 0, 1)
        option    = buildEnvelope(route, score, margin, residual, shipment, now)
        feasible_scored.append(option)

    sort(feasible_scored, by score desc, cost asc, duration asc, route_id asc)
    return { data: feasible_scored, rejected }

function carrierAlternatives(shipment, now, config):
    out, rejected = [], []
    for carrier in carriers where carrier.id != current.carrier_id:
        reason = firstFailedCarrierConstraint(carrier, shipment)      // §2.2 + H2/H7/H8
        if reason: rejected.append({carrier_id: carrier.id, rejected_reason: reason}); continue
        best = max(routeAlternativesForCarrier(carrier, shipment, now), by score)
        if best == null: rejected.append({carrier_id: carrier.id, rejected_reason: "no_feasible_route"}); continue
        out.append(buildCarrierEnvelope(carrier, best))
    sort(out, by score desc, cost asc, carrier_id asc)
    return { data: out, rejected }
```

---

## 9. Worked example (synthetic, clearly illustrative)

**Shipment:** S102 (vaccine, cold-chain, volume 12, current route R045 / carrier C07, cost $84,000, duration 384 h).
**Active:** D01 (port strike, `IN-WEST-COAST`, severity 4) — the triggering disruption; D02 (weather, `SG-SINGAPORE`, severity 3, open-ended).

| Candidate | Carrier | Cost | Duration | Capacity | Overlaps D01 region? | Result |
|---|---|---|---|---|---|---|
| R089 | C09 | $73,920 | 390 h | 220 | no (passes `SG-SINGAPORE`) | feasible, score 0.884 |
| R095 | C11 | $79,800 | 420 h | 100 | no | feasible, score 0.176 |
| R091 | C03 | $92,400 | 360 h | 60 | yes | rejected `disrupted_region_overlap` |
| R100 | C05 | $68,000 | 400 h | 10 | no | rejected `insufficient_capacity` (10 < 12) |
| R102 | C07 | $84,000 | 384 h | 220 | no | rejected `same_as_current` |
| R104 | C02 | — | — | — | — | rejected `carrier_inactive` |

**Score calculation for R089 (w1=0.35, w2=0.35, w3=0.20, w4=0.10):**
- `cost_norm = 0` (cheapest) → cost term `0.35`
- `eta_norm = 0` (shortest among feasible) → ETA term `0.35`
- `capacity_margin = (220 − 12)/220 = 0.945` → term `0.189`
- `residual_risk = (3/5) × duration-share in SG-SINGAPORE ≈ 0.05` → penalty `0.005`
- `score = 0.35 + 0.35 + 0.189 − 0.005 = 0.884` → clamped `0.884`

**Carrier alternatives:** C09 → R089 (0.884), C11 → R095 (0.176); C03 rejected `no_feasible_route` (its only OD route is disrupted); C07 excluded (current carrier).

**Operator message:** "R089 via C09 is the best option: 12% cheaper, 6 h slower, 95% capacity margin, minor exposure to D02. Runner-up R095 is slower and costlier. R091 rejected: passes the strike region."

---

## 10. Edge cases (all covered by tests)

| Edge case | Behaviour |
|---|---|
| No OD candidates exist | `data: []`, rejection `no_candidate_routes` |
| All candidates overlap the triggering region | all in `rejected[]`, no-option response |
| Capacity data missing on a candidate | rejected `missing_capacity_data` (safety-first) |
| Single feasible candidate | ranked; `cost_norm`/`eta_norm` = 0.5; confidence `medium` |
| Current route inactive but still "current" | still excluded via `same_as_current` |
| Duplicate route offered by two carriers | dedupe by `route.id`; carrier options dedupe by `(carrier_id, route_id)` |
| Shipment delivered/cancelled | `not_actionable: true`, `not_actionable_reason: "delivered"` (A-9); `data: []` |
| Shipment has no `current_segment_id` | alternatives unaffected (OD-based); fleet target falls back per fleet design |
| Weights changed via config | results change deterministically; no code change |
| `max = min` for a factor | normalisation returns 0.5 for all candidates (documented) |

---

## 11. Open points for Member 2

1. Approve A-4 (reliability term), A-8 (residual-risk clarification), A-9 (additive `reasons` / `not_actionable` fields).
2. Confirm the shared explanation vocabulary in `data-contract.md` §9.3 factor keys is reused by cold-chain recommendations (one format across domains).
3. Confirm the recommendation-creation gap (A-5) because ranked options currently exist only as a computed response, not a persisted `pending` recommendation.
