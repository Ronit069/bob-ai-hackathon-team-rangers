# Member 2 — Cold-Chain API Contract (Deltas and Detail)

**Role:** Cold-Chain, AI and IBM Bob Engineer
**Status:** APPROVED — Phase 1A closure (2026-09-14). This file elaborates the shared `api-contract.md` (including Phase 1A amendments 24–28); it does not replace it.
**Canonical contract:** `docs/phase-0/api-contract.md` (paths, envelopes, error format, ownership)

---

## 1. Mapping of the brief's suggested cold-chain endpoints

| Brief-suggested endpoint | Shared contract status | Resolution |
|---|---|---|
| `GET /api/cold-chain/shipments/:id` | not a shared path | Composite view = `GET /api/shipments/:id/sensor-readings` (3.13) + `GET /api/excursions?shipment_id=` (3.14) + `GET /api/shipments/:id/risk` (3.18). No new endpoint. |
| `GET /api/cold-chain/alerts` | exists as `/api/alerts/coldchain` (3.15) | Use shared path. |
| `GET /api/cold-chain/excursions` | exists as `/api/excursions` (3.14) | Use shared path. |
| `GET /api/sensors/:id/readings` | covered by 3.13 (one sensor per shipment in MVP) | Use shared path; dedicated `/api/sensors/:id` deferred (if-time). |
| `GET /api/risk/overview` | exists (3.19, shared) | Use as-is; cold-chain contributes `coldchain_risk` + factors. |
| `POST /api/bob/query` | exists (3.23) | Use as-is. |

**Rule:** shared paths win; additions are recorded as Phase 1A amendments in `api-contract.md` §7.

---

## 2. Endpoint specifications (M2-owned)

### 2.1 `POST /api/sensor-readings` (3.12) — R4 ingest
- **Owner:** M2 · **Dependency:** schema + seed
- **Purpose:** ingest simulated IoT readings (single or batch ≤ 500).
- **Request:**
```json
{ "readings": [
  { "shipment_id": "S102", "sensor_id": "SEN-004", "timestamp": "2026-09-14T09:00:00Z",
    "temperature_c": 9.4, "humidity_pct": 61.2, "source": "simulated" }
] }
```
- **Response:** `{ "ingested": 1, "rejected": [], "quality_flags": [{ "reading_id": "SR-000123", "flags": [] }] }`
- **Validation:** shipment FK exists; timestamp not in the future; humidity 0–100 when present; batch size ≤ 500; unknown fields rejected.
- **Errors:** `400 VALIDATION_ERROR` (bad FK/future timestamp/range); per-reading failures returned in `rejected[]` with reasons when at least one reading is valid; `404 SHIPMENT_NOT_FOUND` when a single-reading request references an unknown shipment.
- **Notes:** duplicates are detected at read time (not rejected at write); implausible values are stored and flagged.

### 2.2 `GET /api/shipments/:id/sensor-readings` (3.13) — R4 readings + health
- **Owner:** M2 · **Dependency:** 2.1
- **Query:** `from`, `to` (optional), `order` (default `asc`).
- **Response (with B-2 sensor health block):**
```json
{
  "data": [{ "id": "SR-000123", "timestamp": "2026-09-14T09:00:00Z", "temperature_c": 9.4 }],
  "count": 1,
  "quality": { "gaps": 1, "duplicates": 0, "out_of_order": 1, "implausible": 0, "sensor_status": "reporting" },
  "sensor": { "sensor_id": "SEN-004", "status": "reporting", "expected_interval_min": 15,
              "last_reading_at": "2026-09-14T09:00:00Z", "minutes_since_last": 12,
              "readings_count": 288, "gap_count": 1, "failure_since": null },
  "policy": { "id": "TP-VACCINE", "min_c": 2.0, "max_c": 8.0 }
}
```
- **Validation:** shipment exists; range parseable; `order ∈ asc|desc`.
- **Errors:** `404 SHIPMENT_NOT_FOUND`; `400 VALIDATION_ERROR`.
- **Notes:** `sensor.status ∈ reporting | delayed | failed | unknown`; missing data is never rendered as safe.

### 2.3 `GET /api/excursions` (3.14) — R5 list
- **Owner:** M2 · **Dependency:** 2.1
- **Query:** `shipment_id`, `severity` (`warning|major|critical|unknown_review`), `status` (`open|acknowledged|closed`), `active_only` (bool), `limit`.
- **Response (with B-5 additions):**
```json
{ "data": [{
  "id": "EX-0003", "shipment_id": "S102", "policy_id": "TP-VACCINE",
  "start_time": "2026-09-14T08:15:00Z", "end_time": "2026-09-14T09:00:00Z",
  "duration_min": 45, "peak_deviation_c": 2.4, "severity": "major",
  "severity_rationale": "duration>tolerance;magnitude<=major", "data_quality": "complete",
  "status": "open", "detected_at": "2026-09-14T08:16:00Z",
  "post_delivery": false, "time_to_delivery_hours": 25.0,
  "recommended_action": "Review and consider intervention"
}], "count": 1 }
```
- **Errors:** `400 VALIDATION_ERROR`; `404 SHIPMENT_NOT_FOUND` when `shipment_id` unknown.

### 2.4 `GET /api/alerts/coldchain` (3.15) — R5 alerts
- **Owner:** M2 · **Dependency:** 2.1, 2.3
- **Purpose:** operator-facing list = open excursions + sensor failures (distinct types).
- **Response:**
```json
{ "data": [
  { "type": "excursion", "severity": "critical", "shipment_id": "S204", "excursion_id": "EX-0007",
    "summary": "Peak +6.4°C above max, 47 min, 2 readings missing", "human_review_required": true },
  { "type": "sensor_failure", "shipment_id": "S177", "sensor_id": "SEN-009",
    "summary": "No readings for 75 minutes", "human_review_required": true }
], "count": 2 }
```
- **Errors:** `500 INTERNAL_ERROR` only (read-only aggregation).

### 2.5 `GET /api/temperature-policies` (3.16) — R6 list
- **Owner:** M2 · **Dependency:** schema + seed
- **Query:** `include_history` (bool, default false).
- **Response:** `{ "data": [TemperaturePolicy...], "count": n }` (latest version per cargo type by default).
- **Errors:** `400 VALIDATION_ERROR`.

### 2.6 `PUT /api/temperature-policies/:id` (3.17) — R6 update
- **Owner:** M2 · **Dependency:** 2.5
- **Request:** `{ "min_c": 2.0, "max_c": 8.0, "max_excursion_minutes": 15, "minor_deviation_c": 1.0, "major_deviation_c": 3.0, "critical_duration_minutes": 60, "updated_by": "operator-1" }`
- **Response:** new policy version.
- **Validation:** `min_c < max_c`; `minor < major`; `tolerance < critical duration`; all thresholds positive.
- **Errors:** `404 POLICY_NOT_FOUND`; `400 VALIDATION_ERROR`.
- **Audit:** `policy_updated` with before/after values.

### 2.7 `PATCH /api/excursions/:id` (28, B-7) — review lifecycle
- **Owner:** M2 · **Dependency:** 2.3
- **Request:** `{ "status": "acknowledged" | "closed", "actor": "operator-1", "note": "..." }`
- **Response:** updated excursion + `audit_record_id`.
- **Validation:** `open → acknowledged → closed` only; closing a `critical` excursion requires a non-empty `note`.
- **Errors:** `404 EXCURSION_NOT_FOUND`; `409 CONFLICT` (invalid transition); `400 VALIDATION_ERROR`.
- **Audit:** `acknowledged` / `closed`.

### 2.8 `POST /api/bob/query` (3.23) — P5
- **Owner:** M2 · **Dependency:** Bob access (Q6)
- **Request:** `{ "prompt": "Which cold-chain shipments have active excursions?", "context": {} }`
- **Response (enabled):** `{ "answer": "...", "evidence": [{ "tool": "get_temperature_excursions", "input": {...}, "output": {...} }], "tool_calls": 1 }`
- **Errors:** `503 BOB_UNAVAILABLE` when `BOB_ENABLED=false` or Bob unreachable (`details.reason`); `400 VALIDATION_ERROR`.
- **Rule:** answers come only from tool JSON; the UI shows the evidence; no state changes.

---

## 3. Shared endpoints used by cold-chain

| Endpoint | Role for cold-chain |
|---|---|
| `GET /api/shipments/:id/risk` (3.18) | Returns `coldchain_risk` + nested factors (RC-3) |
| `GET /api/risk/overview` (3.19) | Ranked worklist combining both domains |
| `GET /api/audit` (3.22) | Excursion/policy audit entries |
| `GET /api/shipments?is_cold_chain=true` (3.6) | Cold-chain shipment list for the monitoring screen |

---

## 4. Error catalogue (cold-chain)

| HTTP | Code | Typical cause |
|---|---|---|
| 400 | `VALIDATION_ERROR` | bad enum/range/timestamp; unknown query key |
| 404 | `SHIPMENT_NOT_FOUND` | unknown `S###` |
| 404 | `EXCURSION_NOT_FOUND` | unknown `EX-####` |
| 404 | `POLICY_NOT_FOUND` | unknown `TP-*` |
| 409 | `CONFLICT` | invalid excursion transition |
| 422 | `SEMANTIC_ERROR` | valid shape but impossible evaluation (e.g. policy mismatch) |
| 500 | `INTERNAL_ERROR` | unexpected failure |
| 503 | `BOB_UNAVAILABLE` | Bob disabled or unreachable |

---

## 5. Dependencies and ownership

| Dependency | Owner | Notes |
|---|---|---|
| Schema + migrations (cold-chain entities + `cargo_profile`) | M2 (review M1) | Phase 2 |
| Seed fixtures + ground truth (`SCN-101…SCN-125`) | M2 | Phase 2 |
| Shared error envelope + `zod` schemas | SH | `common/` |
| Risk endpoints (3.18/3.19) | SH | Consume cold-chain risk |
| Audit service | SH | Writes excursion/policy audit records |
| Bob access | External (Q6) | `BOB_ENABLED=false` until confirmed |

## 6. Change control

Same as `api-contract.md` §6: additive changes update this file and the shared contract in the same PR; breaking changes require both members' approval and simultaneous updates to backend, frontend, MCP server and tests.
