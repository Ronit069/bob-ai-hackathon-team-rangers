# Member 1 — Fleet Utilisation and Redeployment Design

**Role:** Logistics and Optimisation Engineer
**Status:** DRAFT — R3 design. Idle/compatibility rules follow `scope-freeze.md` §1.2; the ranking formula and future-commitment blocking are proposed for freezing as amendment A-7.
**Related:** `member-1-logistics-data-design.md` §6–§7, `member-1-logistics-test-plan.md` (LT-15…LT-21)

---

## 1. Purpose and scope

Define exactly when a fleet asset is idle, which assets are genuinely redeployable, how candidates are ranked for an affected shipment, and how human decisions are protected. No ML, no global optimisation, no live telemetry: assignments + availability timestamps + distance.

---

## 2. Definitions (single source of truth)

| Term | Definition |
|---|---|
| **Assigned** | ∃ assignment with `status = active` and `start_time <= now < end_time` |
| **Reserved** | ∃ assignment with `reserved = true` and `end_time >= now` (frozen rule) |
| **Future commitment** | ∃ assignment with `status = planned` and `end_time >= now` (see §4) |
| **Available** | `asset.status = available` AND not assigned AND no future commitment |
| **Idle** | Available (per above) — "idle" is **derived**, never stored |
| **Idle duration** | `now − asset.available_since` (frozen formula), in minutes |
| **Redeployable** | Idle AND compatible with the target shipment (§5) |

**Idle vs reserved:** an asset can be physically idle (no current work) but reserved for future work. Reserved assets are **never** offered as redeployable; they appear in the `excluded[]` list with `reserved` and `reserved_until`. This is the core protection against stealing capacity from an existing commitment.

---

## 3. Idle detection algorithm

```text
function idleAssets(now, filter):
    data, excluded = [], []
    for asset in assets:
        if asset.status == "maintenance": excluded.add(asset, "maintenance"); continue
        if asset.status == "retired":     excluded.add(asset, "retired"); continue
        if hasActiveAssignment(asset, now):
            excluded.add(asset, "currently_assigned", until=current.end_time); continue
        if hasFutureCommitment(asset, now):
            reason = asset.reserved ? "reserved" : "unprotected_future_assignment"
            excluded.add(asset, reason, until=next.start_time); continue
        if asset.available_since == null:
            excluded.add(asset, "missing_availability_timestamp"); continue
        data.add({ asset, idle_minutes: minutes(now − asset.available_since) })

    sort data by idle_minutes desc, asset_id asc
    return { data, excluded }
```

**Note:** `status = available` with a missing `available_since` is a data anomaly. The asset is excluded from idle results (never guessed), flagged for review, and the validator catches it in seed data.

---

## 4. Future-assignment protection

1. Any assignment with `end_time >= now` blocks redeployment — regardless of the `reserved` flag.
2. Normal mechanism: future assignments are stored with `reserved = true`.
3. If a future assignment exists with `reserved = false`, the asset is still blocked (safety-first) and flagged `unprotected_future_assignment`; this is a data anomaly for the operator to fix.
4. A stale assignment (`end_time < now` but `status = active`) is flagged `stale_assignment`; the asset is **not** treated as idle until the record is corrected — stale state is never silently ignored.
5. Overlapping assignments for one asset are flagged `conflicting_assignments` (test fixture); the asset is excluded from redeployment until resolved.

**Reservation horizon:** `end_time >= now` is inclusive — an assignment ending exactly now still blocks (boundary inclusive, tested LT-16).

---

## 5. Compatibility checks

Applied in this order for a target shipment:

| # | Check | Rule | Rejection reason |
|---|---|---|---|
| C1 | Capacity | `asset.capacity_units >= shipment.volume_units` | `insufficient_capacity` |
| C2 | Refrigeration | `shipment.is_cold_chain = true → asset.refrigerated = true` | `incompatible_non_refrigerated` |
| C3 | Proximity | `haversine(asset, target) <= REDEPLOY_RADIUS_KM` (default 150) | `outside_radius` |
| C4 | Lifecycle | `asset.status ∈ {available}` (idle detection already handled) | `maintenance` / `retired` |

**Target location:**
- Primary: the destination node of the shipment's `current_segment_id` (`dest_lat`/`dest_lon`).
- Fallback (no `current_segment_id`): destination of the route's **first** segment, `target_approximate = true`, confidence reduced.
- Distance: haversine, km, rounded to 1 decimal. Region is **not** the criterion (coarse); it is used for filters/display only.

```
haversine(lat1, lon1, lat2, lon2):
    R = 6371
    dLat = rad(lat2 − lat1); dLon = rad(lon2 − lon1)
    a = sin²(dLat/2) + cos(rad(lat1)) * cos(rad(lat2)) * sin²(dLon/2)
    return 2 * R * asin(sqrt(a))
```

**Boundary:** distance exactly equal to the radius is included (inclusive, tested LT-19).

---

## 6. Redeployment ranking (proposed freeze — A-7)

```
proximity_score = 1 − min(distance_km, radius) / radius        // 1.0 = at the target, 0.0 = at the radius edge
idle_score      = min(idle_minutes, 1440) / 1440               // 24 h cap; longer idle does not dominate further
capacity_fit    = min(1, asset.capacity_units / shipment.volume_units)   // 1.0 = sufficient capacity

score = 0.45*proximity_score + 0.35*idle_score + 0.20*capacity_fit
```

| Weight | Default | Rationale |
|---|---|---|
| `0.45` | proximity | The closer the asset, the faster and cheaper the redeployment |
| `0.35` | idle time | Longer idle = more recovered cost; capped at 24 h to avoid one ancient asset dominating |
| `0.20` | capacity fit | Sufficient capacity required; oversized assets are not penalised in MVP (documented) |

**Tie-breaking:** `score desc → distance asc → idle_minutes desc → asset_id asc` (deterministic).

**Why not ML / optimisation:** with a handful of idle assets per region, a transparent weighted ranking is faster to build, easier to defend, and matches the frozen scope. Global greedy/bipartite allocation across multiple shipments is explicitly "if time permits" (`scope-freeze.md` §2).

---

## 7. Contention (multiple shipments, one asset)

- For each affected shipment, compute its top-3 redeployment candidates.
- `contention_count(asset)` = number of affected shipments for which the asset is in the top 3.
- If `contention_count > 1`, the asset option is annotated: *"also a top candidate for N other shipments — human allocation required"*.
- **MVP behaviour:** every shipment sees the asset as a candidate; no automatic allocation. The operator decides. This is honest and prevents the system from silently favouring one shipment.
- Contention data is also useful demo evidence for the "if time permits" greedy matching enhancement.

---

## 8. Response envelope (matches the shared recommendation format)

```json
{
  "shipment_id": "S102",
  "data": [
    {
      "asset": { "id": "A114", "type": "truck", "refrigerated": true, "capacity_units": 16, "current_region_code": "IN-WEST-COAST" },
      "score": 0.770,
      "factors": {
        "distance_km": 18.0,
        "idle_minutes": 372,
        "capacity_fit": 1.0,
        "proximity_score": 0.88,
        "idle_score": 0.258,
        "contention_count": 2,
        "target_approximate": false,
        "confidence_level": "high",
        "confidence_drivers": []
      },
      "constraints_checked": ["asset_available", "not_reserved", "capacity_ok", "refrigeration_ok", "within_radius"],
      "reasons": [
        "18 km from the shipment's next node",
        "idle for 6.2 h",
        "refrigerated and large enough (16 units vs 12 required)",
        "also a top candidate for 1 other shipment — allocate manually"
      ]
    }
  ],
  "rejected": [
    { "asset_id": "A098", "rejected_reason": "incompatible_non_refrigerated" },
    { "asset_id": "A051", "rejected_reason": "maintenance" },
    { "asset_id": "A202", "rejected_reason": "outside_radius", "details": { "distance_km": 240.0 } }
  ],
  "excluded": [
    { "asset_id": "A077", "excluded_reason": "reserved", "reserved_until": "2026-09-15T20:00:00Z" }
  ],
  "count": 1,
  "computed_at": "2026-09-14T09:12:00Z"
}
```

*(`excluded[]` on this endpoint is additive — part of A-7/A-9 review; the shared `GET /api/fleet/idle` already returns `excluded[]`.)*

---

## 9. Worked example (synthetic)

**Shipment S102** (vaccine, cold-chain, 12 units), target = SEG-012 destination (Mumbai area, 19.076, 72.878), radius 150 km.

| Asset | Type | Refrigerated | Capacity | State | Distance | Idle | Result |
|---|---|---|---|---|---|---|---|
| A114 | truck | yes | 16 | idle since 03:20 | 18 km | 372 min | **rank 1** — score 0.770 |
| A131 | truck | yes | 20 | idle since 05:00 | 42 km | 240 min | rank 2 |
| A098 | truck | **no** | 18 | idle | 12 km | 500 min | rejected `incompatible_non_refrigerated` |
| A077 | container | yes | 30 | **reserved** until 09-15 20:00 | 25 km | — | excluded `reserved` |
| A051 | truck | yes | 14 | **maintenance** | 30 km | — | rejected `maintenance` |
| A202 | vessel | yes | 400 | idle | 240 km | 900 min | rejected `outside_radius` |

**Score for A114:** proximity `1 − 18/150 = 0.88`; idle `372/1440 = 0.258`; capacity fit `1.0` →
`0.45×0.88 + 0.35×0.258 + 0.20×1.0 = 0.396 + 0.090 + 0.200 = 0.686`. *(Illustrative arithmetic; final values come from code.)*

---

## 10. Edge cases (brief-mandated, all tested)

| Edge case | Behaviour |
|---|---|
| Asset appears idle but has a future assignment | Blocked; `excluded[]` reason `reserved` (or `unprotected_future_assignment` anomaly); `reserved_until` shown |
| Asset incompatible with cargo | `rejected[]` reason `incompatible_non_refrigerated`; never ranked |
| Asset lacks sufficient capacity | `rejected[]` reason `insufficient_capacity`; never ranked |
| Asset too far away | `rejected[]` reason `outside_radius` with distance; boundary inclusive |
| Asset under maintenance | `rejected[]` reason `maintenance`; visible in fleet utilisation |
| No asset available | `data: []` + `rejected[]`/`excluded[]` reasons; UI shows "No idle compatible assets" |
| Multiple shipments compete for one asset | `contention_count` surfaced; manual allocation; no silent auto-assign |
| Missing `available_since` | `excluded[]` reason `missing_availability_timestamp`; anomaly flagged |
| Stale assignment (past end, still active) | Flagged `stale_assignment`; not idle until corrected |
| Overlapping assignments | Flagged `conflicting_assignments`; excluded until resolved |
| Shipment has no current segment | Target = first segment destination, `target_approximate = true`, confidence reduced |
| Asset in another region but within radius | Included (distance is the criterion) |
| Identical scores | Deterministic tie-break (distance, idle, asset_id) |

---

## 11. Open points for Member 2

1. **A-7 freeze** — approve the ranking formula, weights and the future-commitment blocking rule so the shared contract is authoritative.
2. **Shared explanation vocabulary** — `factors`/`constraints_checked`/`rejected` keys must match the cold-chain recommendation format (`data-contract.md` §9.3).
3. **A-5 recommendation creation** — the fleet redeployment recommendation must be persistable as `pending` for the decision endpoint to work.
4. **Risk engine** — redeployment does not feed the combined risk score in MVP; confirm this boundary (fleet is a recovery action, not a risk signal).
