# Solution Overview

**Project:** ChainSentinel — L2 Supply Chain Disruption Assistant & Fleet Utilisation Optimizer
**Event:** Bobathon 2026 — Logistics & Ports, Problem L2

---

## What ChainSentinel Does

ChainSentinel is a Bob-powered logistics control tower that turns a declared disruption into a ranked, explainable, human-approved action plan. It unifies three correlated risk problems — disruption impact, fleet idle capacity, and cold-chain integrity — into a single dashboard backed by deterministic rules, transparent scoring, and grounded AI assistance.

When a disruption is declared, ChainSentinel:

1. Identifies every affected shipment with match reasons, timing analysis, and a priority score.
2. Proposes ranked reroute and carrier alternatives with transparent factor breakdowns and explicit rejected options.
3. Scans idle fleet assets for compatibility-aware redeployment candidates.
4. Monitors cold-chain sensor streams, classifies temperature excursion severity before delivery, and surfaces data-quality issues.
5. Computes a combined disruption + cold-chain risk score across all shipments for prioritisation.
6. Provides a grounded IBM Bob assistant that answers operator questions using backend tool calls, with raw evidence visible alongside every answer.

No recommendation is ever auto-executed. Every decision requires human approval and is recorded in an append-only audit trail.

---

## Key Capabilities

### 1. Disruption Impact Engine (R1)

Active disruptions are matched against shipment route segments by region code and temporal window. Each affected shipment receives an `impact_status` (critical, blocked, delayed, at_risk, unknown_review), a `match_reason` citing the specific segment, and an `impact_score` based on cargo value, deadline urgency, and cold-chain flag. Multi-disruption exposure is handled: the worst status wins and all matching disruptions are listed.

### 2. Route and Carrier Alternatives (R2)

For each affected shipment, candidate routes and carriers are filtered by hard constraints (active carrier, sufficient capacity, no overlap with the disrupted region, avoids the current route) and ranked by a weighted score covering cost delta, ETA delta, capacity margin, and residual risk from other active disruptions. Rejected alternatives are always listed with the constraint that caused rejection. Delivered or cancelled shipments are marked not-actionable.

### 3. Fleet Idle Detection and Redeployment (R3)

Fleet assets are classified by operational state based on assignment data. Idle assets are those with `status = available` and no active or future assignment. Redeployment candidates are filtered by compatibility rules (capacity, refrigeration requirement, distance radius) and ranked by proximity, idle time, and capacity fit. Contention is surfaced when multiple affected shipments compete for the same asset.

### 4. Cold-Chain Sensor Monitoring (R4)

Sensor readings are ingested through a batch REST endpoint and stored with data-quality flags (duplicate, out-of-order, implausible). Quality metrics are computed per shipment and surfaced via a sensor health view. A simulator script can post fresh in-policy readings during demo for improved sensor status display.

### 5. Temperature Excursion Detection (R5)

Excursions are detected deterministically from stored readings against the shipment's temperature policy. The pipeline handles: boundary-inclusive thresholds, consecutive-breach grouping with a configurable merge gap, data gaps (missing readings), sensor failures (feed stopped), duplicate de-duplication, and out-of-order reordering. Post-delivery breaches are excluded from live alerts. Every excursion stores start/end time, duration, peak deviation, data quality, and severity rationale.

### 6. Severity Classification (R6)

A configurable rule ladder classifies each excursion as Warning, Major, Critical, or Unknown/Review Required. The ladder is evaluated against the shipment's cargo-type temperature policy. Data-quality issues (missing readings, sensor failure, implausible values) escalate to Unknown/Review rather than being classified as normal. Policies are versioned and editable via the dashboard; all thresholds are illustrative configurable values, not regulatory standards.

### 7. Combined Risk Prioritisation (P2)

A combined score `combined_score = 0.5 × disruption_risk + 0.5 × coldchain_risk` (weights configurable) ranks shipments by total exposure. The Overview screen shows this ranked worklist with drill-down to the contributing factors for each shipment.

### 8. Human-Approval Workflow and Audit Trail (P4)

Every recommendation goes through a pending → accepted / rejected / modified lifecycle. No system state is changed by a Bob answer or recommendation alone — a human operator must click the decision button. Every state-changing action is recorded in an append-only audit trail with actor, timestamp, and before/after details.

### 9. Grounded IBM Bob Assistant (P5)

A thin MCP tool server exposes 11 read-only tools over the REST API. Bob calls these tools to answer operator questions and attaches the raw tool JSON as visible evidence beside every answer. The system prompt prevents Bob from computing scores, inventing entities, or making regulatory claims. The full dashboard operates without Bob (`BOB_ENABLED=false`); the chat panel shows an explicit fallback state rather than fabricated answers.

---

## What ChainSentinel Does Not Do

- **No auto-execution.** No reroute, rebooking, or assignment is ever made without human approval.
- **No ML.** All logic is deterministic rules and transparent weighted scoring. ML is explicitly deferred to future scope.
- **No live external feeds.** Disruptions are entered via form/API; sensor readings are posted by the demo simulator or by batch ingestion. No AIS, weather, or carrier APIs.
- **No regulatory compliance claims.** Temperature policy thresholds are illustrative and configurable, not regulatory benchmarks.
- **No real data.** All datasets are synthetic, generated with a fixed seed for reproducibility.
- **No authentication beyond a single operator assumption.** No RBAC, SSO, or multi-tenant isolation.
- **No deployment.** Local-only; no cloud hosting.

---

## Innovation

- **Cross-domain risk correlation:** a single combined score merges disruption exposure and cold-chain risk — not two separate dashboards.
- **Explainable recommendations with rejected alternatives listed**, so operators understand why the top-ranked option was chosen.
- **Grounded Bob with visible evidence:** every claim Bob makes is traceable to a backend tool call; the raw JSON is always shown.
- **Human-in-the-loop by design:** no action is taken without an explicit operator decision, and every decision is audited.
- **Synthetic data with realistic failure cases:** missing readings, reserved assets, duplicate sensor records, implausible values — not just happy-path demo data.

---

## Technical Summary

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite 5 (JavaScript), React Router 6, Recharts, plain CSS |
| Backend | Node.js 20 + Express 4 (ESM), zod validation, pg driver, no ORM |
| Database | PostgreSQL 16 via Docker Compose, plain SQL migrations |
| Data generation | Python 3.11 standard library only; deterministic fixed-seed fixtures |
| Bob integration | Thin MCP tool server (stdio transport, 11 read-only tools); grounding via system prompt |
| ML | None in the MVP; all logic is deterministic rules + weighted scoring |

See `docs/architecture.md` for the full system design and `docs/setup-guide.md` for local run instructions.
