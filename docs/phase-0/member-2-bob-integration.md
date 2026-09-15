# Member 2 — IBM Bob Integration Design

**Role:** Cold-Chain, AI and IBM Bob Engineer
**Status:** APPROVED — Phase 1A closure (2026-09-14). Design frozen; implementation not started (Phase 3/4).
**Sources:** `api-contract.md` §5 + Phase 1A §7, ADR-004, `member-2-coldchain-requirements.md` §8.5, Document 1 §16, blueprint §8

---

## 1. Purpose

Define IBM Bob as a **grounded decision-support assistant**: it answers operator questions by calling backend tools and synthesising only what those tools return. Bob is load-bearing for the submission (rubric criterion 5: 10 pts) but is never a runtime dependency of the dashboard.

**Honesty statement:** this is a design. No Bob integration exists yet; no credentials are assumed. `BOB_ENABLED=false` is the default until access is confirmed (Q6).

---

## 2. Architecture boundary (ADR-004)

```
Operator question → IBM Bob → MCP tool server (thin adapter) → REST API → PostgreSQL
                                ↓
                        structured JSON back to Bob
                                ↓
              answer + evidence (tool name, input, raw JSON) in the UI
```

| Rule | Detail |
|---|---|
| REST is the single source of truth | Every fact Bob states must come from a REST response |
| Bob never touches the DB | No direct SQL, no credentials |
| Tools are read-only | No tool mutates state; approvals happen only via UI → decision/review endpoints |
| Thin adapter | The MCP server contains no business logic — it maps tools to REST calls and returns JSON unchanged |
| `BOB_ENABLED=false` | First-class mode: chat panel shows fallback; dashboard fully functional |
| Evidence always visible | The UI shows raw tool JSON beside the answer |

---

## 3. Tool catalogue (11 frozen tools)

Each tool returns the endpoint's JSON unchanged plus a `tool` name field. Error responses use the standard envelope.

### 3.1 `get_active_disruptions`
- **Purpose:** list currently active disruptions.
- **Input:** `{}`
- **Output:** `{ "data": [Disruption...], "count": n }`
- **Endpoint:** `GET /api/disruptions?status=active`
- **Errors:** `400 VALIDATION_ERROR`, `500 INTERNAL_ERROR`
- **Grounding rule:** only disruptions with `is_currently_active = true` may be described as active.
- **Example question:** "What disruptions are active right now?"

### 3.2 `get_affected_shipments`
- **Purpose:** R1 — shipments affected by a disruption, with reasons and scores.
- **Input:** `{ "disruption_id": "D01", "include_delivered": false }`
- **Output:** rows with `shipment`, `impact_status`, `match_reason`, `impact_score`
- **Endpoint:** `GET /api/disruptions/:id/affected-shipments`
- **Errors:** `404 DISRUPTION_NOT_FOUND`
- **Grounding rule:** quote the returned `match_reason`; never add shipments not in `data`.
- **Example question:** "Which shipments are affected by the Mumbai port strike?"

### 3.3 `get_route_alternatives`
- **Purpose:** R2 — ranked feasible route options with trade-offs.
- **Input:** `{ "shipment_id": "S102", "limit": 5 }`
- **Output:** `data[]` (route, score, factors, reasons, constraints) + `rejected[]`
- **Endpoint:** `GET /api/shipments/:id/route-alternatives`
- **Errors:** `404 SHIPMENT_NOT_FOUND`; empty `data` is valid
- **Grounding rule:** describe only ranked options; rejected options must be labelled as rejected with their reason.
- **Example question:** "What's the best reroute for S102?"

### 3.4 `get_carrier_alternatives`
- **Purpose:** R2 — ranked carrier options with backing route.
- **Input:** `{ "shipment_id": "S102" }`
- **Output:** `data[]` (carrier, backing_route, score, factors) + `rejected[]`
- **Endpoint:** `GET /api/shipments/:id/carrier-alternatives`
- **Errors:** `404 SHIPMENT_NOT_FOUND`
- **Grounding rule:** never claim a carrier "has capacity" unless the factor/constraint says so.
- **Example question:** "Show alternate carriers for shipment S102."

### 3.5 `get_idle_assets`
- **Purpose:** R3 — idle assets with exclusion reasons.
- **Input:** `{ "region_code": "IN-WEST-COAST", "min_idle_minutes": 0 }` (both optional)
- **Output:** `{ "data": [{asset, idle_minutes}], "excluded": [{asset_id, reason}], "count" }`
- **Endpoint:** `GET /api/fleet/idle`
- **Errors:** `400 VALIDATION_ERROR`
- **Grounding rule:** reserved assets are never described as available; quote the exclusion reason.
- **Example question:** "Which idle trucks are near the affected region?"

### 3.6 `get_redeployment_candidates`
- **Purpose:** R3 — ranked compatible assets for a shipment.
- **Input:** `{ "shipment_id": "S102" }`
- **Output:** `data[]` (asset, score, distance, idle, capacity fit, contention) + `rejected[]`/`excluded[]`
- **Endpoint:** `GET /api/shipments/:id/redeployment-candidates`
- **Errors:** `404 SHIPMENT_NOT_FOUND`
- **Grounding rule:** mention contention when `contention_count > 1`; never auto-allocate.
- **Example question:** "Which idle trucks can take cold cargo for S102?"

### 3.7 `get_sensor_status`
- **Purpose:** R4 — readings quality and sensor health for a shipment.
- **Input:** `{ "shipment_id": "S102", "from": "...", "to": "..." }` (time range optional)
- **Output:** readings + `quality` block + `sensor` health block (B-2) + `policy`
- **Endpoint:** `GET /api/shipments/:id/sensor-readings`
- **Errors:** `404 SHIPMENT_NOT_FOUND`
- **Grounding rule:** missing data is described as missing — never as safe; sensor `failed` is distinct from a gap.
- **Example questions:** "Are any sensor readings missing?" / "What happens if the sensor stops reporting?"

### 3.8 `get_temperature_excursions`
- **Purpose:** R5 — excursion list with severity and evidence.
- **Input:** `{ "shipment_id": "S102", "severity": "critical", "active_only": true }` (all optional)
- **Output:** `{ "data": [TemperatureExcursion...], "count" }`
- **Endpoint:** `GET /api/excursions`
- **Errors:** `400 VALIDATION_ERROR`; `404` if `shipment_id` unknown
- **Grounding rule:** always state `severity`, `duration_min`, `peak_deviation_c` and `data_quality`; unknown policy/missing data must be stated.
- **Example question:** "Which cold-chain shipments have active excursions?"

### 3.9 `get_combined_risk`
- **Purpose:** P2 — combined score with factors for one shipment.
- **Input:** `{ "shipment_id": "S102" }`
- **Output:** `{ shipment_id, disruption_risk, coldchain_risk, combined_score, factors{disruption, coldchain, weights}, computed_at }`
- **Endpoint:** `GET /api/shipments/:id/risk`
- **Errors:** `404 SHIPMENT_NOT_FOUND`
- **Grounding rule:** explain factor by factor; never compute a score itself.
- **Example question:** "Why is shipment S102 marked critical?"

### 3.10 `get_risk_overview`
- **Purpose:** P2 — ranked worklist across shipments.
- **Input:** `{ "limit": 25, "include_zero": false }`
- **Output:** `{ "data": [risk rows + shipment summary], "count", "computed_at" }` sorted by `combined_score` desc
- **Endpoint:** `GET /api/risk/overview`
- **Errors:** `400 VALIDATION_ERROR`
- **Grounding rule:** preserve the API order; quote scores exactly as returned.
- **Example question:** "Give me a consolidated action plan" (combined with other tools).

### 3.11 `get_audit_log`
- **Purpose:** P4 — decision/event trail.
- **Input:** `{ "entity_type": "recommendation", "entity_id": "REC-0009" }` (both optional)
- **Output:** `{ "data": [AuditRecord...], "count" }`
- **Endpoint:** `GET /api/audit`
- **Errors:** `400 VALIDATION_ERROR`
- **Grounding rule:** quote the logged reason; never infer a decision that is not recorded.
- **Example question:** "Explain why this recommendation was rejected."

---

## 4. Example questions → tools

| Question | Tool(s) |
|---|---|
| "Which cold-chain shipments have active excursions?" | `get_temperature_excursions(active_only=true)` |
| "Why is shipment S102 marked critical?" | `get_combined_risk(S102)` + `get_temperature_excursions(S102)` |
| "Show the evidence for this temperature alert." | `get_temperature_excursions` + `get_sensor_status` |
| "Which affected shipments are near delivery?" | `get_affected_shipments` + `get_combined_risk` (time_to_delivery factor) |
| "Give me a consolidated action plan." | `get_active_disruptions` + `get_affected_shipments` + `get_risk_overview` + `get_temperature_excursions` + `get_idle_assets` |
| "Are any sensor readings missing?" | `get_sensor_status` |
| "What happens if the sensor stops reporting?" | `get_sensor_status` (failure rules + current status) |
| "Which shipments are affected by the port strike?" | `get_active_disruptions` + `get_affected_shipments` |
| "Which idle trucks can I redeploy right now?" | `get_idle_assets` (+ `get_redeployment_candidates` per shipment) |
| "Show alternate carriers for S102." | `get_carrier_alternatives(S102)` |
| "Explain why this recommendation was rejected." | `get_audit_log` |

---

## 5. Grounding rules and prompt contract

Bob's system prompt enforces:

1. Answer **only** from tool outputs; no outside facts.
2. Empty result → say "no data returned" — **never** "all clear" or "no issues".
3. Tool error → report the failure explicitly and point to the dashboard.
4. Never compute scores, thresholds, durations or risk itself.
5. Never invent shipments, readings, carriers, routes, assets, policies or decisions.
6. Never make regulatory/accuracy claims.
7. Ambiguous question (no shipment/disruption ID) → ask for the missing identifier instead of guessing.
8. Unsupported question → say so and list available capabilities.
9. Always attach evidence (tool name + input + raw JSON) to the answer.
10. Never change state; approvals belong to the UI.

---

## 6. Failure handling

| Situation | Behaviour |
|---|---|
| Bob unavailable / `BOB_ENABLED=false` | `POST /api/bob/query` → `503 BOB_UNAVAILABLE`; chat panel shows "Bob is unavailable — the dashboard is fully functional"; all six capabilities remain available |
| A backend API fails during a tool call | Tool returns the standard error envelope; Bob reports it; UI shows the raw error as evidence |
| MCP server unreachable | Bob reports the transport failure; dashboard unaffected |
| Ambiguous question | Bob asks for the shipment/disruption ID |
| Unsupported question | Bob states the limit and lists example capabilities |

---

## 7. UI evidence and human approval

- **Evidence panel:** renders `tool_calls[]` — tool name, input, raw JSON — beside the answer. Any mismatch between answer and JSON is visible to the operator.
- **Chat panel states:** suggested starter questions (empty), typing indicator (loading), fallback message (Bob unavailable), tool-error card (failure).
- **Human approval preserved:** Bob cannot accept/reject/modify recommendations or acknowledge/close excursions. Those actions exist only in the UI and call `POST /api/recommendations/:id/decision` or `PATCH /api/excursions/:id`, which write audit records.

---

## 8. Grounding test approach (M2-10)

Without Bob credentials, the tool layer is testable directly:

1. Call each of the 11 tools against seeded data; assert JSON shape and read-only behaviour.
2. Assert empty-result handling: no "all clear" phrasing in the prompt contract test fixtures.
3. Assert error passthrough: unknown IDs → error envelope unchanged.
4. With Bob available (if credentials exist), run the 11 example questions and check every entity ID in the answer appears in the evidence JSON (CT-17).
5. Record results in the test report; if Bob is unavailable, mark grounding tests as tool-layer verified and state that in limitations.

---

## 9. Status

| Item | Status |
|---|---|
| Design (this document) | Complete |
| MCP tool server | Not implemented (Phase 3) |
| Bob prompts | Not implemented (Phase 3) |
| Grounding tests | Not run (Phase 3) |
| Bob credentials | Unknown (Q6) — `BOB_ENABLED=false` until confirmed |

No claim of a working Bob integration is made until items above are implemented and tested.
