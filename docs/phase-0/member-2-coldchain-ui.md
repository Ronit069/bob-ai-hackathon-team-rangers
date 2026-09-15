# Member 2 — Cold-Chain UI Contract

**Role:** Cold-Chain, AI and IBM Bob Engineer
**Status:** APPROVED — Phase 1A closure (2026-09-14).
**Sources:** Document 1 §18, `member-2-coldchain-requirements.md` §8, Phase 1 system design §8 (screens S8–S13), SH-04 shared components
**Related:** `member-2-coldchain-api.md`, `member-2-bob-integration.md`

---

## 1. Screen inventory

| # | Screen | Design ID | Primary APIs | Owner |
|---|---|---|---|---|
| 1 | Cold-chain overview | S8 | `GET /api/shipments?is_cold_chain=true`, `GET /api/alerts/coldchain` | M2 |
| 2 | Active alerts | S8 (tab) | `GET /api/alerts/coldchain` | M2 |
| 3 | Shipment temperature history | S9 | `GET /api/shipments/:id/sensor-readings` | M2 |
| 4 | Excursion details + review | S10 | `GET /api/excursions`, `PATCH /api/excursions/:id` | M2 |
| 5 | Sensor health | S11 | sensor health block (3.13, B-2) | M2 |
| 6 | Risk explanation | S12 | `GET /api/shipments/:id/risk` | Shared |
| 7 | Bob chat | S13 | `POST /api/bob/query` (or MCP direct) | M2 |
| 8 | Evidence panel | S13 (panel) | Bob tool outputs | M2 |

Shared components used (SH-04): app shell/nav, API client with error normalisation, `StatusBadge`, `ScoreBar`, `FactorList`, `EmptyState`, `ErrorState`, `TableSkeleton`, `ChartSkeleton`, `ConfirmDialog`, `Toast`.

---

## 2. Screen specifications

### 2.1 Cold-chain overview (`/coldchain`)

- **Purpose:** single view of cold-chain shipment health; entry point to alerts and shipment history.
- **Data needed:** shipment id, cargo type, sensor status, worst excursion severity, time to delivery, last reading.
- **API:** `GET /api/shipments?is_cold_chain=true` + `GET /api/alerts/coldchain`.
- **User actions:** filter by severity/sensor status; open temperature history; open excursion detail; acknowledge from row.
- **Loading:** table skeleton (5 rows).
- **Empty:** "No cold-chain shipments" + seed/setup hint.
- **Error:** retry banner; filters preserved.
- **Unknown/review state:** rows with `unknown_review` show a distinct badge and reason ("policy missing", "missing readings", "sensor failure").
- **Acceptance criteria:** severity badges match API; unknown states are visually distinct, never shown as normal; every row links to a working detail view.

### 2.2 Active alerts (`/coldchain/alerts`)

- **Purpose:** operator-facing queue of open excursions + sensor failures.
- **Data needed:** alert type, severity, shipment, summary, `human_review_required`.
- **API:** `GET /api/alerts/coldchain`.
- **User actions:** sort by severity/time; acknowledge; open excursion; filter by type.
- **Loading:** skeleton list.
- **Empty:** "No active cold-chain alerts" (valid state, not an error).
- **Error:** retry banner.
- **Unknown/review state:** `unknown_policy` and `sensor_failure` alerts render with explanation and a "Review data/policy" action; never a compliance claim.
- **Acceptance criteria:** sensor failure and excursion alerts are distinguishable; critical rows require a note to close (API enforced); acknowledgement writes an audit record.

### 2.3 Shipment temperature history (`/shipments/:id/temperature`)

- **Purpose:** visual evidence of readings vs policy bounds.
- **Data needed:** readings over time, policy min/max, excursion overlays, gap markers, sensor status.
- **API:** `GET /api/shipments/:id/sensor-readings`.
- **User actions:** zoom/pan; toggle policy bounds; hover values; jump to excursion detail; export evidence (copy JSON).
- **Loading:** chart skeleton.
- **Empty:** "No readings yet" + sensor status hint.
- **Error:** "Sensor data unavailable" + retry.
- **Unknown/review state:** gap bands rendered distinctly (not as flat/safe line); failed sensor shows a banner; implausible readings marked with a warning icon.
- **Acceptance criteria:** chart never interpolates across gaps; policy bounds always visible; excursion windows highlighted.

### 2.4 Excursion details + review (`/excursions/:id`)

- **Purpose:** full evidence and human review lifecycle for one excursion.
- **Data needed:** start/end, duration, peak deviation, severity + rationale, data quality, policy values, readings in window, time to delivery, recommended action, status.
- **API:** `GET /api/excursions?shipment_id=`, `PATCH /api/excursions/:id`.
- **User actions:** acknowledge; close with note (required for critical); view contributing readings; open shipment history.
- **Loading:** detail skeleton.
- **Empty:** n/a (404 → "Excursion not found" + back link).
- **Error:** retry; 409 invalid transition → refresh state.
- **Unknown/review state:** rationale shows the cause (e.g. `missing_readings_in_window`, `policy_missing`); action text says "Investigate data/policy gap — do not assume safe".
- **Acceptance criteria:** every severity shows rationale + data quality; lifecycle transitions match the API; closure writes an audit record.

### 2.5 Sensor health (`/coldchain/sensors`)

- **Purpose:** device-level status across cold-chain shipments.
- **Data needed:** sensor id, status (`reporting/delayed/failed/unknown`), last reading, minutes since last, gap count, failure since.
- **API:** sensor health block from 3.13 (per shipment).
- **User actions:** filter by status; open shipment history; copy sensor id.
- **Loading:** table skeleton.
- **Empty:** "No sensors reporting" + setup hint.
- **Error:** retry banner.
- **Unknown/review state:** `failed` and `unknown` are distinct from `delayed`; failure shows `failure_since`; no "safe" language anywhere.
- **Acceptance criteria:** statuses match `member-2-excursion-detection.md` §6 rules; failed sensors never render as normal.

### 2.6 Risk explanation (`/shipments/:id/risk`)

- **Purpose:** show why a shipment has its combined score.
- **Data needed:** `disruption_risk`, `coldchain_risk`, `combined_score`, nested factors (disruption/coldchain/weights), uncertainty, review requirement.
- **API:** `GET /api/shipments/:id/risk`.
- **User actions:** expand factor groups; open related excursion/disruption; refresh.
- **Loading:** factor skeleton.
- **Empty:** "No risk assessment yet" + refresh action.
- **Error:** retry banner.
- **Unknown/review state:** `unknown_review` factors render with uncertainty drivers and `human_review_required = true`.
- **Acceptance criteria:** score never shown without factors; weights visible; arithmetic verifiable by the user (sub-scores × weights).

### 2.7 Bob chat (`/chat` or panel)

- **Purpose:** grounded natural-language access to both domains.
- **Data needed:** prompt, answer, `tool_calls[]`, evidence JSON, availability status.
- **API:** `POST /api/bob/query` (or MCP direct); `503` → fallback.
- **User actions:** ask suggested questions; expand evidence; copy evidence; navigate to linked entities.
- **Loading:** typing indicator; tool-call spinner per tool.
- **Empty:** suggested starter questions (e.g. "Which cold-chain shipments have active excursions?").
- **Error:** `503` → "Bob is unavailable — the dashboard is fully functional"; tool error → error card with raw envelope.
- **Unknown/review state:** Bob answers "no data returned" for empty tool results; it must never claim "all clear".
- **Acceptance criteria:** every entity ID in an answer appears in the evidence JSON (CT-17); no state-changing controls exist in the chat.

### 2.8 Evidence panel (part of 2.7)

- **Purpose:** make grounding visible and auditable.
- **Data needed:** tool name, input, raw output JSON per call.
- **API:** included in the Bob response.
- **User actions:** expand/collapse; copy JSON; jump to entity.
- **Loading:** per-call skeleton.
- **Empty:** "No tool calls" (e.g. unsupported question).
- **Error:** raw error envelope displayed verbatim.
- **Unknown/review state:** truncated lists show counts (e.g. "showing 10 of 42"), never silently dropped.
- **Acceptance criteria:** panel content matches backend JSON exactly; mismatch between answer and evidence is user-visible.

---

## 3. Cross-screen state matrix

| Screen | Loading | Empty | Error | Unknown/review |
|---|---|---|---|---|
| 2.1 Overview | skeleton | setup hint | retry | distinct badge + reason |
| 2.2 Alerts | skeleton | valid no-alerts | retry | policy/failure explanation |
| 2.3 History | chart skeleton | no readings | sensor unavailable | gap bands, failed banner, implausible marks |
| 2.4 Excursion | detail skeleton | 404 page | retry / 409 refresh | rationale + "do not assume safe" |
| 2.5 Sensors | table skeleton | no sensors | retry | failed ≠ delayed; failure_since |
| 2.6 Risk | factor skeleton | no assessment | retry | uncertainty drivers + review flag |
| 2.7 Chat | typing | starter questions | 503 fallback / tool error card | "no data returned" |
| 2.8 Evidence | per-call | no tool calls | raw envelope | truncation counts |

Every screen must pass all four states before it is marked done (Definition of Done).

---

## 4. UI conventions

- Severity/status badges use text + icon, never colour alone.
- Missing/unknown data renders as "unknown", never omitted or shown as normal.
- No compliance claims in UI copy; policy values carry the "illustrative, configurable" note.
- State-changing actions (acknowledge/close) require confirmation and show the resulting audit link.
- The frontend never computes severity or risk; it renders API values and factors.

---

## 5. Policy editing (D7 — Phase 3 decision)

Policy configuration (`GET`/`PUT /api/temperature-policies`, endpoints 16/17) is **API-only in Phase 3** — no UI is built. A small policy editor is folded into the cold-chain screen (2.1 / S8) in Phase 5. Until then, policy values are displayed read-only with the "illustrative, configurable" note.
