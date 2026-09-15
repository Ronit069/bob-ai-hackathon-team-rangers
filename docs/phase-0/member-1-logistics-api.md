# Member 1 — Logistics API Contract (Deltas and Detail)

**Role:** Logistics and Optimisation Engineer
**Status:** DRAFT — this file **does not modify** the shared `api-contract.md`. It maps the brief's suggested logistics endpoints onto the frozen contract, adds implementation-level validation detail, and lists additive proposals (A-5, A-6, A-9) that require joint approval before they are added to the shared contract.
**Canonical contract:** `docs/phase-0/api-contract.md` (paths, envelopes, error format, ownership codes)

---

## 1. Conventions (inherited — no changes)

- Base path `/api`; JSON only; ISO 8601 UTC; integer USD; list responses `{ "data": [], "count": n }`; error envelope `{ "error": { "code", "message", "details" } }`.
- Owner codes: `M1` logistics · `M2` cold-chain/Bob · `SH` shared.
- Auth: none (single trusted operator) — documented limitation.
- No DELETE endpoints; audit is append-only; only the decision endpoint changes recommendation status.

---

## 2. Endpoint inventory and mapping of the brief's suggested list

| Brief-suggested endpoint | Shared contract status | Resolution |
|---|---|---|
| `POST /api/disruptions` | exists (3.3) | use as-is; details §3.2 |
| `GET /api/disruptions` | exists (3.2) | use as-is; details §3.1 |
| `GET /api/shipments/affected` | different path | covered by `GET /api/disruptions/:id/affected-shipments` (3.5) — disruption-scoped is unambiguous; a cross-disruption view is available via `GET /api/shipments?disruption_id=` (3.6). No new endpoint. |
| `GET /api/shipments/:id` | exists (3.7) | use as-is; details §3.6 |
| `GET /api/shipments/:id/alternatives` | split in shared contract | covered by `.../route-alternatives` (3.8) + `.../carrier-alternatives` (3.9); the UI shows them as tabs. No combined endpoint. |
| `GET /api/routes/:id` | **missing** | proposed additive A-6 (§4.3, optional/low priority) |
| `GET /api/carriers` | **missing** | proposed additive A-6 (§4.2) |
| `GET /api/fleet` | **missing** | proposed additive A-6 (§4.1 — needed by the Fleet Utilisation screen) |
| `GET /api/fleet/idle` | exists (3.10) | use as-is; details §3.9 |
| `POST /api/fleet/redeployments/recommend` | **missing** | proposed additive A-5 (§4.5); the shared contract has no recommendation-creation endpoint at all (§7 gap G1) |
| `POST /api/recommendations/:id/decision` | exists (3.21) | use as-is; details §3.12 |
| `GET /api/audit` | exists (3.22, shared) | use as-is; details §3.13 |

**Rule:** paths in the shared contract win over the brief's suggestions. No silent renames. Additions are recorded as amendments.

---

## 3. Existing endpoints — logistics implementation detail

### 3.1 `GET /api/disruptions`
- **Owner:** M1 · **Dependency:** schema + seed (SH-01)
- **Query:** `status` (`scheduled|active|resolved`), `region_code`, `limit` (default 50)
- **Response:** `{ "data": [Disruption...], "count": n }`; each item includes derived `is_currently_active`
- **Validation:** enums; unknown query keys rejected
- **Errors:** `400 VALIDATION_ERROR`
- **Notes:** default UI view filters `status=active`

### 3.2 `POST /api/disruptions`
- **Owner:** M1 · **Dependency:** 3.1
- **Body:** `{ type, region_code, start_time, end_time?, severity, status, description, created_by }`
- **Response:** `201` created Disruption with `D##` id
- **Validation:** region vocabulary; type enum; `1 <= severity <= 5`; `end_time > start_time` when present; `start_time` parseable; description non-empty
- **Errors:** `400 VALIDATION_ERROR`; `409 CONFLICT` (identical active disruption, same region + overlapping window)
- **Audit:** writes `created` / `activated`

### 3.3 `PATCH /api/disruptions/:id`
- **Owner:** M1 · **Dependency:** 3.2
- **Body (partial):** `{ status?, end_time?, severity?, description? }`
- **Response:** updated Disruption
- **Validation:** only `active → resolved`, `scheduled → active`, `active → resolved`; cannot re-resolve (`409`)
- **Errors:** `404 DISRUPTION_NOT_FOUND`; `400 VALIDATION_ERROR`; `409 CONFLICT`
- **Audit:** `activated` / `deactivated`

### 3.4 `GET /api/disruptions/:id/affected-shipments`  ← R1 core
- **Owner:** M1 · **Dependency:** 3.1, 3.2, seed
- **Query:** `include_delivered` (default `false`)
- **Response (per `member-1-disruption-matching.md` §5.5, amendment A-2):**
```json
{
  "data": [{
    "shipment": { "id": "S102", "cargo_type": "vaccine", "is_cold_chain": true, "cargo_value_usd": 520000, "deadline": "2026-09-18T10:00:00Z", "status": "in_transit" },
    "impact_status": "critical",
    "match_reason": "route R045 segment SEG-012 (IN-WEST-COAST) matches disruption D01; currently_in_affected_segment",
    "matched_segment_ids": ["SEG-012"],
    "matched_disruptions": [{ "disruption_id": "D01", "severity": 4, "status": "critical", "reason": "currently_in_affected_segment" }],
    "timing_basis": "planned",
    "confidence": "high",
    "impact_score": 0.86,
    "impact_factors": { "cargo_value_norm": 0.95, "deadline_urgency_norm": 0.80, "is_cold_chain": true }
  }],
  "count": 1,
  "disruption_id": "D01",
  "computed_at": "2026-09-14T09:05:00Z"
}
```
- **Validation:** disruption must exist; `include_delivered` boolean
- **Errors:** `404 DISRUPTION_NOT_FOUND`; empty `data` is valid (nothing affected)
- **Determinism:** sorted by `impact_score` desc, status rank desc, `deadline` asc, `shipment_id` asc

### 3.5 `GET /api/shipments`
- **Owner:** M1 · **Dependency:** seed
- **Query:** `status`, `is_cold_chain`, `disruption_id`, `region_code` (current segment region), `limit` (default 100)
- **Response:** `{ "data": [Shipment...], "count": n }`
- **Errors:** `400 VALIDATION_ERROR`; `404 DISRUPTION_NOT_FOUND` when `disruption_id` unknown

### 3.6 `GET /api/shipments/:id`
- **Owner:** M1 · **Dependency:** seed
- **Response:** Shipment + embedded `route` + `carrier` + `segments[]` + `current_segment` + derived `route_capacity`, `next_segment`
- **Errors:** `404 SHIPMENT_NOT_FOUND`

### 3.7 `GET /api/shipments/:id/route-alternatives`  ← R2 core
- **Owner:** M1 · **Dependency:** 3.4, 3.6, active disruptions
- **Query:** `limit` (default 5), `include_rejected` (default `true`)
- **Response:** `data[]` ranked options + `rejected[]` (per `member-1-route-carrier-alternatives.md` §6.2); additive `reasons` field (A-9)
- **Validation:** shipment exists and is actionable (`planned|in_transit|delayed`); delivered/cancelled → `data: []` + `not_actionable` (A-9)
- **Errors:** `404 SHIPMENT_NOT_FOUND`; empty data is valid (no-option case)
- **Determinism:** score desc → cost asc → duration asc → `route_id` asc

### 3.8 `GET /api/shipments/:id/carrier-alternatives`  ← R2 core
- **Owner:** M1 · **Dependency:** 3.7
- **Response:** `data[]` carrier options each with `backing_route`; `rejected[]`; additive `reasons` (A-9)
- **Errors:** `404 SHIPMENT_NOT_FOUND`; empty data valid
- **Notes:** current carrier excluded; inactive carriers and carriers without feasible routes appear only in `rejected[]`

### 3.9 `GET /api/fleet/idle`  ← R3 core
- **Owner:** M1 · **Dependency:** seed, assignments
- **Query:** `region_code`, `min_idle_minutes` (default 0), `limit`
- **Response:** `{ "data": [{ asset, idle_minutes, idle_since }], "excluded": [{ asset_id, reason, reserved_until? }], "count": n }`
- **Validation:** `min_idle_minutes >= 0`; region vocabulary
- **Errors:** `400 VALIDATION_ERROR`
- **Notes:** `excluded[]` always returned so the UI can explain why near-miss assets are unavailable

### 3.10 `GET /api/shipments/:id/redeployment-candidates`  ← R3 core
- **Owner:** M1 · **Dependency:** 3.9
- **Query:** `limit` (default 5), `include_rejected` (default `true`)
- **Response:** per `member-1-fleet-redeployment.md` §8 (ranked `data[]` + `rejected[]` + additive `excluded[]`)
- **Validation:** shipment exists; cold-chain flag drives refrigeration check
- **Errors:** `404 SHIPMENT_NOT_FOUND`; empty data valid
- **Determinism:** score desc → distance asc → idle desc → `asset_id` asc

### 3.11 `GET /api/recommendations`
- **Owner:** SH (logistics usage) · **Dependency:** recommendation creation (A-5)
- **Query:** `shipment_id`, `status`, `type`, `limit`
- **Response:** `{ "data": [Recommendation...], "count": n }`
- **Errors:** `400 VALIDATION_ERROR`

### 3.12 `POST /api/recommendations/:id/decision`
- **Owner:** SH · **Dependency:** 3.11, audit service (SH-03)
- **Body:** `{ decision: "accepted"|"rejected"|"modified", actor, notes?, modified_payload? }`
- **Response:** updated Recommendation + `audit_record_id`
- **Validation:** `modified` requires `modified_payload`; recommendation must be `pending`
- **Errors:** `404 RECOMMENDATION_NOT_FOUND`; `409 CONFLICT` (already decided); `400 VALIDATION_ERROR`
- **Rule:** no auto-execution; this is the only status-changing endpoint

### 3.13 `GET /api/audit`
- **Owner:** SH · **Dependency:** audit writes
- **Query:** `entity_type`, `entity_id`, `limit` (default 100), `order` (default `desc`)
- **Response:** `{ "data": [AuditRecord...], "count": n }`
- **Errors:** `400 VALIDATION_ERROR`

---

## 4. Proposed additive endpoints (require joint approval — A-5, A-6)

### 4.1 `GET /api/fleet` — proposed A-6
- **Owner:** M1 · **Dependency:** seed, assignments
- **Purpose:** Fleet Utilisation screen needs **all** assets with derived states, not just idle ones.
- **Query:** `region_code`, `type`, `state` (`available|assigned|reserved|maintenance|retired`), `limit` (default 100)
- **Response:**
```json
{
  "data": [{
    "asset": { "id": "A114", "type": "truck", "refrigerated": true, "capacity_units": 16, "current_region_code": "IN-WEST-COAST" },
    "operational_state": "available",
    "idle_minutes": 372,
    "next_assignment": { "assignment_id": "AA-0011", "shipment_id": "S140", "start_time": "2026-09-15T08:00:00Z", "reserved": true },
    "anomalies": []
  }],
  "count": 1,
  "computed_at": "2026-09-14T09:12:00Z"
}
```
- **Validation:** enums; region vocabulary
- **Errors:** `400 VALIDATION_ERROR`
- **Additive status:** backward-compatible read; requires `api-contract.md` §2 update upon approval

### 4.2 `GET /api/carriers` — proposed A-6
- **Owner:** M1 · **Dependency:** seed
- **Purpose:** carrier comparison context, filters, and Bob evidence for carrier alternatives.
- **Query:** `status`, `region_code`, `mode`
- **Response:** `{ "data": [Carrier...], "count": n }`
- **Errors:** `400 VALIDATION_ERROR`

### 4.3 `GET /api/routes/:id` — proposed A-6 (optional, low priority)
- **Owner:** M1 · **Dependency:** seed
- **Purpose:** route detail drill-down; shipment detail already embeds route + segments, so this is convenience only.
- **Response:** Route + `segments[]` + `carrier`
- **Errors:** `404 ROUTE_NOT_FOUND`

### 4.4 `POST /api/recommendations` — proposed A-5 (gap G1)
- **Owner:** SH (creation logic per type: M1 for reroute/carrier/redeployment) · **Dependency:** 3.7–3.10
- **Purpose:** persist a selected option as a `pending` Recommendation so the decision endpoint and audit trail work.
- **Body:**
```json
{
  "type": "reroute",
  "shipment_id": "S102",
  "route_id": "R089",
  "factors": { "cost_delta_pct": -12, "eta_delta_h": 6, "capacity_margin": 0.945, "residual_risk": 0.05, "confidence_level": "high" },
  "constraints_checked": ["route_active", "carrier_active", "avoids_triggering_disruption", "capacity_ok"],
  "rejected_alternatives": [{ "route_id": "R091", "rejected_reason": "disrupted_region_overlap" }],
  "actor": "operator-1"
}
```
- **Response:** `201` Recommendation (`status = pending`) + `audit_record_id`
- **Validation:** exactly one target matching `type`; shipment and target exist; **score and factors are recomputed server-side — client-supplied scores are ignored** (anti-tampering rule)
- **Errors:** `400 VALIDATION_ERROR`; `404 SHIPMENT_NOT_FOUND` / target not found; `409 CONFLICT` (duplicate pending recommendation for same shipment+type+target)
- **Audit:** `created`

### 4.5 `POST /api/fleet/redeployments/recommend` — proposed A-5 (brief-suggested convenience)
- **Owner:** M1 · **Dependency:** 3.10
- **Purpose:** one-call creation of a `fleet_redeployment` recommendation from a selected candidate asset.
- **Body:** `{ "shipment_id": "S102", "asset_id": "A114", "actor": "operator-1" }`
- **Response:** `201` Recommendation (server recomputes score/factors from the current candidate set) + `audit_record_id`
- **Validation:** asset must currently pass all compatibility checks for that shipment (re-validated at creation time — never trust a stale ranking)
- **Errors:** `400 VALIDATION_ERROR`; `404` shipment/asset not found; `409 CONFLICT` asset no longer eligible (e.g. became reserved between ranking and creation); `409` duplicate pending recommendation

---

## 5. Logistics error catalogue

| HTTP | Code | Typical cause |
|---|---|---|
| 400 | `VALIDATION_ERROR` | bad enum/region/severity/time; unknown query key |
| 404 | `DISRUPTION_NOT_FOUND` | unknown `D##` |
| 404 | `SHIPMENT_NOT_FOUND` | unknown `S###` |
| 404 | `ROUTE_NOT_FOUND` | unknown `R###` (A-6 endpoint) |
| 404 | `ASSET_NOT_FOUND` | unknown `A###` (A-5 endpoints) |
| 404 | `RECOMMENDATION_NOT_FOUND` | unknown `REC-####` |
| 409 | `CONFLICT` | duplicate active disruption; re-resolving; already-decided recommendation; duplicate pending recommendation; asset no longer eligible |
| 500 | `INTERNAL_ERROR` | unexpected failure (logged) |

---

## 6. Validation summary (server-side, `zod`)

| Endpoint | Key validation |
|---|---|
| 3.2 | region ∈ vocabulary; severity 1–5; time coherence |
| 3.4 | disruption exists; boolean query flags |
| 3.7–3.8 | shipment exists; actionable status; `limit` 1–20 |
| 3.9–3.10 | `min_idle_minutes >= 0`; region vocabulary; shipment exists |
| 3.12 | decision enum; `modified` requires payload; status must be `pending` |
| 4.4–4.5 | target coherence by type; FK existence; server-side score recomputation; eligibility re-check |

---

## 7. Contract gaps and amendments (recorded, not silently changed)

| ID | Gap | Proposal | Owner of decision |
|---|---|---|---|
| G1 | Shared contract has **no recommendation-creation endpoint**, yet 3.21 requires a `pending` recommendation id | A-5: `POST /api/recommendations` (+ 4.5 convenience) | Joint (M1 + M2) |
| G2 | No endpoint lists all fleet assets for the Fleet Utilisation screen | A-6: `GET /api/fleet` | Joint |
| G3 | Carrier list/route detail not exposed | A-6: `GET /api/carriers`, `GET /api/routes/:id` (optional) | Joint |
| G4 | `impact_status`, `matched_disruptions`, `timing_basis` not in 3.5 response | A-2 (additive) | Joint |
| G5 | Human-readable `reasons` and `not_actionable` not in alternative responses | A-9 (additive) | Joint |

**Until approved:** implement the frozen contract exactly; keep proposed fields out of `main` behind a feature flag or a branch, and do not present them as done.
