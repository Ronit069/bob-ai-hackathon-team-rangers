# Phase 0 — API Contract

**Status:** APPROVED — Phase 1A closure (2026-09-14). Amendments A-2/A-5/A-6/A-9/B-2/B-5/B-7 applied; see the normative section at the end of this file (endpoints 24–28).

---

## 1. Conventions

| Convention | Rule |
|---|---|
| Base path | `/api` |
| Content type | `application/json` only |
| IDs and timestamps | Per `data-contract.md` §1 (ISO 8601 UTC) |
| List responses | `{ "data": [ ... ], "count": <n> }` |
| Detail responses | The resource object directly |
| Error responses | `{ "error": { "code": "...", "message": "...", "details": {} } }` |
| Validation | All inputs validated with `zod` before touching the database; unknown fields rejected |
| Auth (MVP) | None — single trusted operator; documented limitation, not hidden |
| Pagination | Not in MVP; list endpoints accept sensible `limit` where noted |
| Actor | Decision/audit endpoints take `actor` (default `operator-1`) |

### 1.1 Standard error codes

| HTTP | Code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Malformed/missing/invalid fields; `details` lists field errors |
| 404 | `NOT_FOUND` | Entity does not exist (e.g. `SHIPMENT_NOT_FOUND`, `DISRUPTION_NOT_FOUND`, `RECOMMENDATION_NOT_FOUND`) |
| 409 | `CONFLICT` | State conflict (e.g. recommendation already decided, overlapping assignment) |
| 422 | `SEMANTIC_ERROR` | Valid shape but impossible operation (e.g. cold-chain shipment with no matching policy is reported, not rejected) |
| 500 | `INTERNAL_ERROR` | Unexpected failure; logged server-side |
| 503 | `BOB_UNAVAILABLE` | Bob path requested while `BOB_ENABLED=false` or Bob unreachable |

Example error body:
```json
{
  "error": {
    "code": "SHIPMENT_NOT_FOUND",
    "message": "Shipment S999 does not exist",
    "details": {}
  }
}
```

### 1.2 Owner codes

`M1` = Member 1 (Logistics & Optimisation) · `M2` = Member 2 (Cold-Chain, AI & Bob) · `SH` = Shared

---

## 2. Endpoint summary

| # | Method | Path | Purpose | Owner | Depends on |
|---|---|---|---|---|---|
| 1 | GET | `/api/health` | Liveness + DB + Bob status | SH | schema |
| 2 | GET | `/api/disruptions` | List disruptions (filter by status) | M1 | schema, seed |
| 3 | POST | `/api/disruptions` | Create/activate a disruption | M1 | schema |
| 4 | PATCH | `/api/disruptions/:id` | Update status/end time | M1 | 3 |
| 5 | GET | `/api/disruptions/:id/affected-shipments` | R1: affected shipments with reason + impact score | M1 | 2, seed |
| 6 | GET | `/api/shipments` | List/filter shipments for dashboard | M1 | schema, seed |
| 7 | GET | `/api/shipments/:id` | Shipment detail (route, carrier, current segment) | M1 | schema |
| 8 | GET | `/api/shipments/:id/route-alternatives` | R2: ranked route options + rejected list | M1 | 5, 7 |
| 9 | GET | `/api/shipments/:id/carrier-alternatives` | R2: ranked carrier options | M1 | 5, 7 |
| 10 | GET | `/api/fleet/idle` | R3: idle assets (region filter) | M1 | schema, seed |
| 11 | GET | `/api/shipments/:id/redeployment-candidates` | R3: ranked compatible assets | M1 | 5, 10 |
| 12 | POST | `/api/sensor-readings` | R4: ingest reading(s) + quality flags | M2 | schema |
| 13 | GET | `/api/shipments/:id/sensor-readings` | R4: readings + quality summary | M2 | 12 |
| 14 | GET | `/api/excursions` | R5: list excursions (filters incl. shipment) | M2 | 12 |
| 15 | GET | `/api/alerts/coldchain` | R5: open excursions + sensor failures | M2 | 12, 14 |
| 16 | GET | `/api/temperature-policies` | R6: list configurable policies | M2 | schema, seed |
| 17 | PUT | `/api/temperature-policies/:id` | R6: update policy (version bump) | M2 | 16 |
| 18 | GET | `/api/shipments/:id/risk` | P2: combined risk snapshot | SH | 5, 14 |
| 19 | GET | `/api/risk/overview` | P2: ranked worklist across shipments | SH | 18 |
| 20 | GET | `/api/recommendations` | List recommendations (filter shipment/status) | SH | 8, 9, 11 |
| 21 | POST | `/api/recommendations/:id/decision` | P4: record human decision + audit | SH | 20 |
| 22 | GET | `/api/audit` | P4: audit log (entity filters) | SH | 21 |
| 23 | POST | `/api/bob/query` | P5: grounded Bob query (proxy, optional) | M2 | Bob credentials |

---

## 3. Endpoint specifications

### 3.1 `GET /api/health`
- **Owner:** SH · **Dependency:** schema
- **Purpose:** liveness for setup guide verification and demo.
- **Request:** none.
- **Response:**
```json
{ "status": "ok", "database": "up", "bob": "disabled", "time": "2026-09-14T09:00:00Z" }
```
- **Errors:** `500 INTERNAL_ERROR` if DB unreachable (`database: "down"` with 500).

### 3.2 `GET /api/disruptions`
- **Owner:** M1 · **Dependency:** schema, seed
- **Purpose:** list disruptions for the Disruption screen and `get_active_disruptions` tool.
- **Query:** `status` optional (`scheduled|active|resolved`), `limit` optional (default 50).
- **Response:** `{ "data": [Disruption...], "count": n }` (shape per data contract §6).
- **Errors:** `400 VALIDATION_ERROR` invalid status value.

### 3.3 `POST /api/disruptions`
- **Owner:** M1 · **Dependency:** schema
- **Purpose:** create a disruption; optionally immediately active (R1 demo entry point).
- **Request:**
```json
{
  "type": "port_strike",
  "region_code": "IN-WEST-COAST",
  "start_time": "2026-09-14T06:00:00Z",
  "end_time": "2026-09-17T06:00:00Z",
  "severity": 4,
  "status": "active",
  "description": "Dock workers strike at Mumbai port.",
  "created_by": "operator-1"
}
```
- **Response:** `201` created Disruption (with generated `D##` id).
- **Errors:** `400 VALIDATION_ERROR` (bad region/enum/severity/time window); `409 CONFLICT` if an identical active disruption already exists for the same region and overlapping window.
- **Audit:** writes `created` audit record.

### 3.4 `PATCH /api/disruptions/:id`
- **Owner:** M1 · **Dependency:** 3
- **Purpose:** activate/deactivate/resolve; adjust end time.
- **Request (partial):** `{ "status": "resolved", "end_time": "2026-09-16T12:00:00Z" }`
- **Response:** updated Disruption.
- **Errors:** `404 DISRUPTION_NOT_FOUND`; `400 VALIDATION_ERROR`; `409 CONFLICT` resolving an already-resolved disruption.
- **Audit:** `activated | deactivated` record.

### 3.5 `GET /api/disruptions/:id/affected-shipments`
- **Owner:** M1 · **Dependency:** 2, seed
- **Purpose:** **R1 core.** Applies the frozen matching rule (`scope-freeze.md` §1.2) and ranks results.
- **Query:** `include_delivered` optional (default `false`).
- **Response:** each item carries the shipment, match reason, and score:
```json
{
  "data": [
    {
      "shipment": {"id": "S102", "cargo_type": "vaccine", "is_cold_chain": true, "cargo_value_usd": 520000, "deadline": "2026-09-18T10:00:00Z", "status": "in_transit"},
      "match_reason": "route R045 segment SEG-012 region IN-WEST-COAST matches disruption D01",
      "matched_segment_ids": ["SEG-012"],
      "impact_score": 0.86,
      "impact_factors": {"cargo_value_norm": 0.95, "deadline_urgency_norm": 0.80, "is_cold_chain": true}
    }
  ],
  "count": 3,
  "disruption_id": "D01",
  "computed_at": "2026-09-14T09:05:00Z"
}
```
- **Errors:** `404 DISRUPTION_NOT_FOUND`; empty `data` when nothing matches (not an error).

### 3.6 `GET /api/shipments`
- **Owner:** M1 · **Dependency:** schema, seed
- **Purpose:** dashboard list; filter support.
- **Query:** `status`, `is_cold_chain` (bool), `disruption_id` (returns affected subset), `limit` (default 100).
- **Response:** `{ "data": [Shipment...], "count": n }`.
- **Errors:** `400 VALIDATION_ERROR`.

### 3.7 `GET /api/shipments/:id`
- **Owner:** M1 · **Dependency:** schema
- **Purpose:** Shipment Detail screen; resolves route, carrier, segments, current segment.
- **Response:** Shipment plus embedded `route`, `carrier`, `segments[]`, `current_segment`.
- **Errors:** `404 SHIPMENT_NOT_FOUND`.

### 3.8 `GET /api/shipments/:id/route-alternatives`
- **Owner:** M1 · **Dependency:** 5, 7
- **Purpose:** **R2 core.** Hard-constraint filter then weighted ranking (`scope-freeze.md` §1.2).
- **Query:** `limit` optional (default 5).
- **Response:**
```json
{
  "data": [
    {
      "route": {"id": "R089", "origin_node": "INMUM", "destination_node": "NLRTM", "carrier_id": "C09"},
      "score": 0.810,
      "factors": {"cost_delta_pct": -12, "eta_delta_h": 6, "capacity_margin": 0.34, "residual_risk": 0.05},
      "constraints_checked": ["carrier_active", "capacity_ok", "avoids_disrupted_region", "route_differs_from_current"]
    }
  ],
  "rejected": [
    {"route_id": "R091", "score": 0.620, "rejected_reason": "capacity_margin_below_minimum"}
  ],
  "count": 1,
  "shipment_id": "S102"
}
```
- **Errors:** `404 SHIPMENT_NOT_FOUND`; `200` with empty `data` + `rejected` reasons when no feasible route exists (graceful "no option" case).

### 3.9 `GET /api/shipments/:id/carrier-alternatives`
- **Owner:** M1 · **Dependency:** 5, 7
- **Purpose:** **R2 core.** Same filter/score shape at carrier level; current carrier and inactive carriers excluded.
- **Response:** same envelope as 3.8 with `carrier` objects instead of `route`.
- **Errors:** `404 SHIPMENT_NOT_FOUND`; empty data is a valid result.

### 3.10 `GET /api/fleet/idle`
- **Owner:** M1 · **Dependency:** schema, seed
- **Purpose:** **R3 core.** Idle = `status=available`, no active assignment, not reserved (`scope-freeze.md` §1.2).
- **Query:** `region_code` optional; `min_idle_minutes` optional (default 0); `limit` optional.
- **Response:** assets with derived idle time and exclusion reasons:
```json
{
  "data": [
    {"asset": {"id": "A114", "type": "truck", "refrigerated": true, "capacity_units": 16, "current_region_code": "IN-WEST-COAST"}, "idle_minutes": 372, "idle_since": "2026-09-14T03:20:00Z"}
  ],
  "excluded": [
    {"asset_id": "A088", "reason": "reserved", "reserved_until": "2026-09-15T20:00:00Z"}
  ],
  "count": 1
}
```
- **Errors:** `400 VALIDATION_ERROR`.

### 3.11 `GET /api/shipments/:id/redeployment-candidates`
- **Owner:** M1 · **Dependency:** 5, 10
- **Purpose:** **R3 core.** Compatibility filter (capacity, refrigeration, distance radius) then ranking.
- **Response:** ranked assets with factors and rejected alternatives:
```json
{
  "data": [
    {"asset": {"id": "A114", "type": "truck", "refrigerated": true}, "score": 0.770, "factors": {"distance_km": 18, "idle_minutes": 372, "capacity_fit": 1.00}}
  ],
  "rejected": [
    {"asset_id": "A098", "rejected_reason": "incompatible_non_refrigerated"}
  ],
  "count": 1,
  "shipment_id": "S102"
}
```
- **Errors:** `404 SHIPMENT_NOT_FOUND`; empty data is valid.

### 3.12 `POST /api/sensor-readings`
- **Owner:** M2 · **Dependency:** schema
- **Purpose:** **R4 core.** Ingestion endpoint used by the simulator; stores reading(s) and returns quality flags.
- **Request (single or batch ≤ 500):**
```json
{ "readings": [
  {"shipment_id": "S102", "sensor_id": "SEN-004", "timestamp": "2026-09-14T09:00:00Z", "temperature_c": 9.4, "humidity_pct": 61.2, "source": "simulated"}
] }
```
- **Response:** `{ "ingested": 1, "rejected": [], "quality_flags": [] }` — flags describe duplicate/out-of-order/implausible immediately.
- **Errors:** `400 VALIDATION_ERROR` (bad FK, future timestamp, humidity range); per-reading rejections returned in `rejected[]` with reasons instead of failing the whole batch when at least one is valid.

### 3.13 `GET /api/shipments/:id/sensor-readings`
- **Owner:** M2 · **Dependency:** 12
- **Purpose:** **R4 core.** Chart data + sensor health.
- **Query:** `from`, `to` optional; `order` default `asc` by timestamp.
- **Response:**
```json
{
  "data": [{"id": "SR-000123", "timestamp": "2026-09-14T09:00:00Z", "temperature_c": 9.4}],
  "count": 1,
  "quality": {"gaps": 1, "duplicates": 0, "out_of_order": 1, "implausible": 0, "sensor_status": "reporting"},
  "policy": {"id": "TP-VACCINE", "min_c": 2.0, "max_c": 8.0}
}
```
- **Errors:** `404 SHIPMENT_NOT_FOUND`.

### 3.14 `GET /api/excursions`
- **Owner:** M2 · **Dependency:** 12
- **Purpose:** **R5 core.** List detected excursions; powers alerts, shipment tab and Bob tool.
- **Query:** `shipment_id`, `severity`, `status`, `active_only` (bool), `limit`.
- **Response:** `{ "data": [TemperatureExcursion...], "count": n }`.
- **Errors:** `400 VALIDATION_ERROR`; `404 SHIPMENT_NOT_FOUND` if `shipment_id` unknown.

### 3.15 `GET /api/alerts/coldchain`
- **Owner:** M2 · **Dependency:** 12, 14
- **Purpose:** **R5 core.** Operator-facing alert list = open excursions + sensor failures (distinct).
- **Response:**
```json
{
  "data": [
    {"type": "excursion", "severity": "critical", "shipment_id": "S204", "excursion_id": "EX-0007", "summary": "Peak +6.4°C above max, 47 min, 2 readings missing"},
    {"type": "sensor_failure", "shipment_id": "S177", "sensor_id": "SEN-009", "summary": "No readings for 75 minutes"}
  ],
  "count": 2
}
```
- **Errors:** `500 INTERNAL_ERROR` only.

### 3.16 `GET /api/temperature-policies`
- **Owner:** M2 · **Dependency:** schema, seed
- **Purpose:** **R6 core.** Show configurable rules currently in force (latest version per cargo type; `include_history=true` returns all versions).
- **Response:** `{ "data": [TemperaturePolicy...], "count": n }`.
- **Errors:** none beyond `400`.

### 3.17 `PUT /api/temperature-policies/:id`
- **Owner:** M2 · **Dependency:** 16
- **Purpose:** **R6 core.** Edit policy values; creates a new version (old retained).
- **Request:** `{ "min_c": 2.0, "max_c": 8.0, "max_excursion_minutes": 15, "minor_deviation_c": 1.0, "major_deviation_c": 3.0, "critical_duration_minutes": 60, "updated_by": "operator-1" }`
- **Response:** new policy version.
- **Errors:** `404 POLICY_NOT_FOUND`; `400 VALIDATION_ERROR` (min ≥ max, thresholds out of order).
- **Audit:** `policy_updated` record with before/after values.

### 3.18 `GET /api/shipments/:id/risk`
- **Owner:** SH · **Dependency:** 5, 14
- **Purpose:** **P2 core.** Compute combined score, persist snapshot, return latest.
- **Query:** `refresh` optional (default `true`; `false` returns latest stored snapshot).
- **Response:**
```json
{
  "shipment_id": "S102",
  "disruption_risk": 0.780,
  "coldchain_risk": 0.300,
  "combined_score": 0.540,
  "factors": {"impact_score": 0.86, "affected_disruption_id": "D01", "excursion_severity": "warning", "weights": {"alpha": 0.5, "beta": 0.5}},
  "computed_at": "2026-09-14T09:12:00Z"
}
```
- **Errors:** `404 SHIPMENT_NOT_FOUND`.

### 3.19 `GET /api/risk/overview`
- **Owner:** SH · **Dependency:** 18
- **Purpose:** **P2 core.** Ranked worklist for the Overview/Risk screens and Bob's action brief.
- **Query:** `limit` (default 25), `include_zero` (default `false`).
- **Response:** `{ "data": [RiskAssessment + shipment summary...], "count": n, "computed_at": "..." }` sorted by `combined_score` desc.
- **Errors:** `400 VALIDATION_ERROR`.

### 3.20 `GET /api/recommendations`
- **Owner:** SH · **Dependency:** 8, 9, 11
- **Purpose:** list generated recommendations; powers approval queue and audit views.
- **Query:** `shipment_id`, `status`, `type`, `limit`.
- **Response:** `{ "data": [Recommendation...], "count": n }`.
- **Errors:** `400 VALIDATION_ERROR`.

### 3.21 `POST /api/recommendations/:id/decision`
- **Owner:** SH · **Dependency:** 20
- **Purpose:** **P4 core.** Record human decision; single state transition; writes audit.
- **Request:** `{ "decision": "accepted", "actor": "operator-1", "notes": "Approved after checking capacity margin." }` (`decision` ∈ `accepted|rejected|modified`; `modified` additionally requires `modified_payload`).
- **Response:** updated Recommendation + `audit_record_id`.
- **Errors:** `404 RECOMMENDATION_NOT_FOUND`; `409 CONFLICT` already decided; `400 VALIDATION_ERROR`.
- **Rules:** never auto-executes anything; no other endpoint may change recommendation status.

### 3.22 `GET /api/audit`
- **Owner:** SH · **Dependency:** 21
- **Purpose:** **P4 core.** Append-only decision/event trail.
- **Query:** `entity_type`, `entity_id`, `limit` (default 100), `order` (default `desc`).
- **Response:** `{ "data": [AuditRecord...], "count": n }`.
- **Errors:** `400 VALIDATION_ERROR`.

### 3.23 `POST /api/bob/query`
- **Owner:** M2 · **Dependency:** Bob credentials (optional path)
- **Purpose:** **P5 core (conditional).** Proxy a natural-language query to Bob/MCP; return answer + raw tool evidence.
- **Request:** `{ "prompt": "Which shipments are affected by the port strike?", "context": {} }`
- **Response (Bob enabled):**
```json
{
  "answer": "3 shipments are affected: S102, S140, S177 — all route through IN-WEST-COAST.",
  "evidence": [{"tool": "get_affected_shipments", "input": {"disruption_id": "D01"}, "output": {"data": []}}],
  "tool_calls": 1
}
```
- **Errors:** `503 BOB_UNAVAILABLE` when `BOB_ENABLED=false` or Bob unreachable (`details.reason` explains); `400 VALIDATION_ERROR`.
- **Rule:** this endpoint never invents data; when Bob is unavailable the UI shows the fallback message and the dashboard remains fully usable (ADR-004).

---

## 4. Cross-cutting rules

1. Every read endpoint that returns derived data includes the factors/reasons behind it (no bare scores).
2. No endpoint other than `POST /api/recommendations/:id/decision` may change `recommendation.status`.
3. No endpoint may update or delete `audit_record` rows.
4. Deleting domain records is not supported in the MVP (no DELETE endpoints).
5. All timestamps in responses are UTC `Z`.
6. Empty results are `200` with `data: []` — never `404` (except unknown parent ID).

---

## 5. Bob tool mapping (frozen list — implemented in `src/mcp-server`)

| Tool | Backing endpoint |
|---|---|
| `get_active_disruptions` | `GET /api/disruptions?status=active` |
| `get_affected_shipments(disruption_id)` | `GET /api/disruptions/:id/affected-shipments` |
| `get_route_alternatives(shipment_id)` | `GET /api/shipments/:id/route-alternatives` |
| `get_carrier_alternatives(shipment_id)` | `GET /api/shipments/:id/carrier-alternatives` |
| `get_idle_assets(region_code?)` | `GET /api/fleet/idle` |
| `get_redeployment_candidates(shipment_id)` | `GET /api/shipments/:id/redeployment-candidates` |
| `get_sensor_status(shipment_id)` | `GET /api/shipments/:id/sensor-readings` (quality block) |
| `get_temperature_excursions(filter)` | `GET /api/excursions` |
| `get_combined_risk(shipment_id)` | `GET /api/shipments/:id/risk` |
| `get_risk_overview(limit?)` | `GET /api/risk/overview` |
| `get_audit_log(entity_type?, entity_id?)` | `GET /api/audit` |

Tool rules:
- Tools are read-only; no tool mutates state.
- Each tool returns the endpoint's JSON unchanged (plus a `tool` name field).
- Bob's system prompt: answer only from tool output; on empty/error, say so; never compute scores; never invent entities.

---

## 6. Change control

- Adding an optional query parameter or a response field is backward-compatible; still update this file in the same PR.
- Changing a field name, removing a field, or changing an enum is breaking: requires both members' approval, a version note in this file, and simultaneous updates to backend, frontend, MCP server and tests.
- The MCP tool list is frozen for the MVP; extra tools are "if time permits" and must be marked as such.

---

## 7. Phase 1A — Approved amendments (normative)

**Approved:** 2026-09-14 (`docs/PHASE_1_SIGNOFF.md`). These amendments are part of the frozen contract.

### A-2 — Affected-shipments response additions (3.5)

Additive fields per row: `impact_status`, `matched_disruptions[]`, `timing_basis`, `confidence`. See `member-1-disruption-matching.md` §5.5.

### A-9 — Alternative/redeployment response additions (3.7–3.11)

Additive fields: `reasons[]` (human-readable factor strings) and `not_actionable` + `not_actionable_reason` (delivered/cancelled shipments return `200` with `data: []`).

### B-2 — Sensor health block (3.13)

Response gains:

```json
"sensor": {
  "sensor_id": "SEN-004", "status": "reporting", "expected_interval_min": 15,
  "last_reading_at": "2026-09-14T09:00:00Z", "minutes_since_last": 12,
  "readings_count": 288, "gap_count": 1, "failure_since": null
}
```

`sensor.status ∈ reporting | delayed | failed | unknown`.

### B-5 — Excursion response additions (3.14 / 3.15)

Additive per-excursion fields: `post_delivery` (boolean), `time_to_delivery_hours` (number|null), `recommended_action` (string).

### B-7 — Excursion review lifecycle (new endpoint 28)

**PATCH `/api/excursions/:id`**
- **Owner:** M2 · **Dependency:** 3.14
- **Purpose:** record the human review transition for an excursion.
- **Body:** `{ "status": "acknowledged" | "closed", "actor": "operator-1", "note": "..." }`
- **Response:** updated TemperatureExcursion + `audit_record_id`
- **Validation:** transitions only `open → acknowledged → closed`; closing a `critical` excursion requires a non-empty `note`
- **Errors:** `404 EXCURSION_NOT_FOUND`; `409 CONFLICT` (invalid transition); `400 VALIDATION_ERROR`
- **Audit:** `acknowledged` / `closed`

### A-5 — Recommendation creation (new endpoints 24–25)

**POST `/api/recommendations`**
- **Owner:** SH (creation logic per type: M1) · **Dependency:** 3.7–3.11
- **Purpose:** persist a selected option as a `pending` Recommendation so the decision endpoint and audit trail work.
- **Body:** `{ "type": "reroute|carrier_change|fleet_redeployment", "shipment_id": "S102", "route_id|carrier_id|asset_id": "...", "factors": {...}, "constraints_checked": [...], "rejected_alternatives": [...], "actor": "operator-1" }`
- **Response:** `201` Recommendation (`status = pending`) + `audit_record_id`
- **Validation:** exactly one target matching `type`; **score and factors are recomputed server-side — client-supplied scores are ignored**; target exists
- **Errors:** `400 VALIDATION_ERROR`; `404 SHIPMENT_NOT_FOUND` / target not found; `409 CONFLICT` (duplicate pending recommendation for same shipment+type+target)
- **Audit:** `created`

**POST `/api/fleet/redeployments/recommend`**
- **Owner:** M1 · **Dependency:** 3.10
- **Body:** `{ "shipment_id": "S102", "asset_id": "A114", "actor": "operator-1" }`
- **Response:** `201` fleet_redeployment Recommendation + `audit_record_id`
- **Validation:** asset re-validated against all compatibility checks at creation time (never trust a stale ranking)
- **Errors:** `400 VALIDATION_ERROR`; `404` shipment/asset not found; `409 CONFLICT` (asset no longer eligible / duplicate pending)

### A-6 — Read endpoints for the logistics UI (new endpoints 26–27)

**GET `/api/fleet`**
- **Owner:** M1 · **Query:** `region_code`, `type`, `state` (`available|assigned|reserved|maintenance|retired`), `limit`
- **Response:** `{ "data": [{ "asset": {...}, "operational_state": "...", "idle_minutes": 372, "next_assignment": {...}, "anomalies": [] }], "count": 1, "computed_at": "..." }`
- **Errors:** `400 VALIDATION_ERROR`

**GET `/api/carriers`**
- **Owner:** M1 · **Query:** `status`, `region_code`, `mode`
- **Response:** `{ "data": [Carrier...], "count": n }`
- **Errors:** `400 VALIDATION_ERROR`

### Endpoint summary additions

| # | Method | Path | Purpose | Owner |
|---|---|---|---|---|
| 24 | POST | `/api/recommendations` | Create pending recommendation (server recompute) | SH/M1 |
| 25 | POST | `/api/fleet/redeployments/recommend` | Create fleet recommendation | M1 |
| 26 | GET | `/api/fleet` | All assets + derived states | M1 |
| 27 | GET | `/api/carriers` | Carrier list/filter | M1 |
| 28 | PATCH | `/api/excursions/:id` | Excursion review lifecycle | M2 |

---

## 8. Phase 3 — Approved decisions (normative)

**Recorded:** 2026-09-14 (`docs/PHASE_3_DECISIONS.md`). These decisions clarify or complete the frozen contract; no existing behaviour is silently changed.

### D4 — `modified_payload` semantics (3.21)

When `decision = "modified"`, `modified_payload` is recorded verbatim in the audit record's `details`. The recommendation's target (`route_id`/`carrier_id`/`asset_id`), `score` and `factors` are **not** mutated, and nothing is executed. The recommendation `status` becomes `modified`; `notes` is stored on the recommendation.

### D5 — Ingestion when no reading is valid (3.12)

If **every** reading in the batch fails validation, the request fails with `400 VALIDATION_ERROR` and `details.rejected` lists per-reading reasons. If at least one reading is valid, the request succeeds (`200`/`201`) and invalid readings are returned in `rejected[]` (unchanged).

### D6 — `actor` default (1.1)

`actor` is optional on decision/review/policy inputs and defaults to `operator-1` (contract §1). Explicit values are recorded verbatim in audit records. Implementation: the zod input schemas make `actor` optional with default `operator-1`.

### D9 — Contention scope (3.11 / A-7)

`contention_count` is computed across **currently affected shipments** (matching result) at demo scale; the A-7 definition is unchanged. If this proves slow in Phase 6, it may be reduced to a configured top-N window without changing the response shape.

### D3 — MCP transport (5)

The MCP tool catalogue and schemas in §5 are unchanged. Transport is **stdio**, with the SDK version pinned at implementation time; no additional tools.

---

## 9. Additive AI-layer endpoints (Feature 1/2 — feature-flagged)

**Recorded:** 2026-09-19. These endpoints are additive; they change nothing in §3–§5, add no MCP tool and no schema change. Both are disabled by default, reuse the existing deterministic services, and never mutate operational state.

### 9.1 `POST /api/ai/incident-brief` (Feature 1)

- **Body:** `{ "shipment_id": "S039" }`
- **Response:** grounded brief + `status`, `brief_source`, `fallback_reason`, `provider_name`, `grounding`, `evidence`, `generated_at`.
- **Flag:** `FEATURE_AI_INCIDENT_BRIEF` (default `false`). When disabled/unavailable the deterministic fallback is returned and no provider call is made.
- **Rules:** never mutates risk, recommendation, excursion or audit rows.

### 9.2 `POST /api/ai/incident-command` (Feature 2 — AI Incident Commander)

- **Body:** `{ "command": "Investigate the Mumbai port disruption." }`
- **Response:** `status`, `intent` (validated), `intent_source`, `fallback_reason`, `provider_name`, `clarification`, `grounding`, `explanation`, `evidence`, `tool_activity`, `proposal`, `proposal_status`, `partial`, `missing_tools`, `generated_at`.
- **Statuses:** `FEATURE_DISABLED` · `CLARIFICATION_REQUIRED` · `VALIDATED_AI` · `DETERMINISTIC_FALLBACK` · `PROVIDER_UNAVAILABLE` · `INVALID_AI_OUTPUT` · `GROUNDING_FAILED`.
- **Flag:** `FEATURE_AI_INCIDENT_COMMANDER` (default `false`). While disabled: no AI request and no MCP orchestration; the deterministic dashboard is unaffected.
- **Rules:** with an AI provider configured, the model chooses which of the 11 frozen read-only MCP tools to call; the server validates every tool name/input through the frozen schemas and executes only via `callTool` (capped by `AI_AGENT_MAX_TOOL_CALLS`). Deterministic completion fills essential reads, and mutating/decision endpoints are never called. `CREATE_PROPOSAL` uses `POST /api/recommendations` (existing validation, duplicate guard and audit) and stops at `pending` human approval. Without a provider the deterministic intent parser, fixed plan and deterministic brief run instead.
- **Grounding:** reuses the Feature 1 validator; the LLM brief is checked against the command evidence (unknown IDs, unsupported numbers, unsupported category words, recommendation-family conflicts), gets one bounded repair pass, and is replaced by the deterministic explanation if it still conflicts.

### 9.3 `POST /api/bob/query` — additive LLM fields

The frozen response (`answer`, `evidence`, `tool_calls`) is unchanged. When the local LLM tool
agent answers, the response additionally carries `status` (`VALIDATED_AI` | `GROUNDING_FAILED` |
`PROVIDER_UNAVAILABLE`), `source` (`llm` | `deterministic`), `provider_name`, `grounding`, and
(when applicable) `fallback_reason`. Proxy/gateway mode and the no-provider deterministic mode
return exactly the frozen fields.
