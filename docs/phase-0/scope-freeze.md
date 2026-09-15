# Phase 0 — Scope Freeze

**Status:** APPROVED — Phase 1A closure (2026-09-14). Amendments A-1/A-7/A-8/B-3/B-6/B-8 are applied; see the normative section at the end of this file.
**Working project name:** ChainSentinel (final name confirmed Q3)

This document is the boundary. If a feature is not in §1, it does not get built before the MVP works end to end. If a feature is in §3, it is explicitly forbidden during the MVP build.

---

## 1. MVP — must build

The MVP is the smallest system that demonstrates all six official capabilities end to end, with real code, real data, and evidence a judge can reproduce.

### 1.1 Mandatory capabilities (map to R1–R6 in `requirements-matrix.md`)

| # | Capability | Minimum deliverable | Evidence |
|---|---|---|---|
| M-1 | Disruption management + affected shipment detection (R1) | Create/activate/deactivate disruption; region-code matching against route segments; affected list with reason + impact score | API + UI + test scenarios |
| M-2 | Route alternatives (R2) | Feasible candidate routes ranked by transparent score; rejected alternatives with reasons; graceful "no option" | API + UI + tests |
| M-3 | Carrier alternatives (R2) | Feasible carriers ranked by the same scoring shape; inactive/over-capacity carriers excluded | API + UI + tests |
| M-4 | Fleet idle detection (R3) | Idle = `available` asset with no active or reserved assignment; idle time from `available_since` | API + UI + tests |
| M-5 | Redeployment recommendations (R3) | Compatible assets (capacity, refrigeration, distance radius) ranked for an affected shipment | API + UI + tests |
| M-6 | Sensor ingestion + data quality (R4) | Ingest readings; detect gaps, duplicates, out-of-order, implausible values; surface sensor status | API + UI + tests |
| M-7 | Excursion detection (R5) | Threshold breach detection with duration + peak deviation; boundary-inclusive rule; sensor-failure distinction | API + UI + tests |
| M-8 | Severity classification (R6) | Configurable policy rules → Warning / Major / Critical / Unknown-Review, with rationale stored | API + UI + tests |
| M-9 | Temperature policy management (R6) | Policy records per cargo type, editable via API (and minimal UI), versioned; **illustrative values, not regulatory claims** | API + test |
| M-10 | Combined priority engine (P2) | `combined_score = α·disruption_risk + β·coldchain_risk`, defaults α=β=0.5, normalised 0–1, snapshot persisted | API + tests |
| M-11 | Recommendation lifecycle + audit (P3, P4) | pending → accepted/rejected/modified; append-only audit record; decision endpoint | API + UI + tests |
| M-12 | Control-tower dashboard (P1) | Minimum screens: Overview, Affected Shipments, Shipment Detail (route/carrier tabs), Fleet/Idle, Cold-Chain + Temperature Graph, Risk Worklist, Audit | Screenshots + demo |
| M-13 | Grounded Bob layer (P5, P6) | MCP tool server exposing the frozen tool list over the REST API; tool outputs structured; grounding tests; evidence shown with answers. Embedded chat proxy only if credentials exist | Tool tests + grounding test report + demo |
| M-14 | Synthetic data generator + validation (all) | Seeded, reproducible datasets for both domains with required scenario coverage; referential-integrity validation script | Generator + validation report |
| M-15 | Repo + packaging skeleton (O1–O6) | Repo from official template; `src/backend`, `src/frontend`, `src/data-generator`, `src/mcp-server`; `.env.example`; migrations | Green validation action |

### 1.2 Frozen behavioural rules (implementation must match exactly)

**Disruption matching (R1)**
```
affected(shipment) = TRUE
  if ∃ segment ∈ shipment.route.segments:
       segment.region_code == disruption.region_code
       AND disruption.status == "active"
       AND (disruption.start_time <= now)
       AND (disruption.end_time IS NULL OR disruption.end_time >= now)
```
- Region-level string matching only (no geometry). Shipments with `status = delivered` or `cancelled` are excluded.

**Impact score (R1 prioritisation)**
```
impact_score = 0.4·cargo_value_norm + 0.4·deadline_urgency_norm + 0.2·is_cold_chain
```
Weights live in configuration, not hardcoded. `*_norm` are min–max normalised within the candidate set.

**Route/carrier scoring (R2)**
```
score = w1·(1 − cost_norm) + w2·(1 − eta_norm) + w3·capacity_margin − w4·residual_risk
```
Hard constraints checked first (active carrier, capacity ≥ shipment volume, avoids disrupted region, route ≠ current route). Feasible options ranked; rejected options listed with the constraint that failed.

**Fleet idle + compatibility (R3)**
```
idle_minutes(asset) = now − asset.available_since      (asset.status = "available", no active/reserved assignment)
compatible(asset, shipment) = asset.capacity_units >= shipment.volume_units
                              AND (shipment.is_cold_chain → asset.refrigerated = TRUE)
                              AND distance(asset, shipment.current_segment destination) <= redeploy_radius_km
reserved(asset) = EXISTS assignment WHERE reserved = TRUE AND end_time >= now
```

**Excursion detection + severity ladder (R5, R6)**
```
breach = temperature_c < policy.min_c OR temperature_c > policy.max_c   (boundary inclusive = within limits)
IF missing readings during window / unknown policy        → "Unknown / Review Required"
ELSE IF duration_min <= policy.max_excursion_minutes
        AND magnitude <= policy.minor_deviation_c         → "Warning"
ELSE IF magnitude > policy.major_deviation_c
        OR duration_min > policy.critical_duration_minutes → "Critical"   (B-8 reordered)
ELSE IF magnitude <= policy.major_deviation_c             → "Major"
ELSE                                                       → "Warning"
```
- Duplicate readings de-duplicated by `(sensor_id, timestamp)` before evaluation.
- Out-of-order readings reordered by timestamp before evaluation.
- Excursions after the shipment's delivery timestamp are logged as post-delivery and excluded from pre-delivery severity scoring.
- Every excursion stores `severity_rationale` and `data_quality` so the UI can explain itself.

**Combined priority (P2)**
```
disruption_risk = impact_score if affected else 0
coldchain_risk  = severity weight: Normal 0.0, Warning 0.3, Major 0.6, Critical 1.0, Unknown 0.5
combined_score  = 0.5·disruption_risk + 0.5·coldchain_risk      (weights configurable)
```

**Human-in-the-loop (P4)**
- No recommendation is ever auto-executed.
- Only the decision endpoint changes a recommendation's status, and it always writes an audit record.
- Audit records are append-only: no updates, no deletes.

### 1.3 Minimum dataset size (demo credibility, not production scale)

- 6 trade lanes, 12–16 route segments, 8–10 carriers
- 40–60 shipments (≈15–20% cold-chain)
- 20–30 fleet assets (mix truck/container/vessel; ≈30% idle; at least one reserved; at least one non-refrigerated)
- 3 disruption scenarios (port strike, weather, customs) covering: multi-shipment impact, no-feasible-alternative, out-of-window
- Sensor logs: 15-minute interval per cold-chain shipment, with deliberate defects and injected excursions (one sub-threshold, one prolonged/major, one critical with missing readings)
- Fixed random seed; `scenario_id` tags; ground truth stored separately for validation

*(Smaller than the blueprint's 150–300 shipments on purpose: two students, one buildathon, and every extra row costs demo time without adding judge value.)*

### 1.4 MVP test gate

- 25-scenario matrix from Document 1 §20 is the target; the 10 core scenarios below are the **minimum gate**:
  1. Disruption affects multiple shipments → correct affected list
  2. Disruption outside route/time window → not flagged
  3. No feasible route → graceful "no option"
  4. Reserved idle asset → excluded with reason
  5. Incompatible asset (non-refrigerated for cold cargo) → excluded
  6. Boundary temperature → within limits
  7. Prolonged excursion → Major/Critical
  8. Missing readings → Unknown/Review
  9. Combined disruption + excursion → combined score reflects both
  10. Bob/backend unavailable → dashboard still functional, clear error state

---

## 2. If time permits (must never block the MVP)

Ordered by value; each is a separate branch that can be abandoned without breaking `main`:

| Order | Enhancement | Guardrail |
|---|---|---|
| 1 | What-if mode for Bob (exclude a carrier, recompute) | Feature-flagged; core Q&A unaffected |
| 2 | Greedy bipartite matching for redeployment across multiple shipments | Ranking view remains the default |
| 3 | Additional UI polish (map view, richer charts) | Only after all screens have empty/loading/error states |
| 4 | Extra test scenarios beyond the core gate | Never delays submission packaging |
| 5 | Docker Compose for backend+frontend (not just DB) | Never blocks local dev docs |

---

## 3. Future production scope (forbidden during MVP build)

- ML: ETA delay prediction, sensor anomaly detection, learned carrier reliability
- Optimisation: MIP/global assignment solver
- Live feeds: weather, port status, AIS, carrier APIs, MQTT/Kafka streaming
- LLM extraction of unstructured disruption text
- Authentication, SSO, RBAC, multi-tenant isolation
- Workflow execution / carrier booking APIs
- PostGIS polygon matching
- Deployment to cloud infrastructure

These may be described in the deck and README as future work only. They must never be claimed as implemented.

---

## 4. Scope-cut order (when time is short)

1. Cut §2 enhancements in reverse order (5 → 1).
2. Reduce UI to the 6 essential screens: Overview, Affected Shipments, Route/Carrier Comparison, Fleet/Idle, Cold-Chain Monitoring, Bob chat/evidence.
3. Reduce the embedded Bob chat panel to the MCP tool server + CLI demo (if credentials are the blocker) — the tool layer and grounding tests are never cut.
4. Reduce dataset size further (never below: 2 disruptions, 1 no-option case, 1 reserved asset, 3 excursion severities, 1 missing-data case).
5. **Never cut:** disruption matching (R1), route/carrier alternatives (R2), fleet idle + redeployment (R3), sensor monitoring (R4), excursion detection (R5), severity classification (R6), audit of decisions (P4), and the submission packaging (O1–O11).

---

## 5. Explicit non-goals (do not build, do not claim)

- No real shipment, carrier, sensor or regulatory dataset is used or claimed.
- No universal regulatory temperature standard is asserted; policies are configurable illustrative values.
- No auto-execution of reroutes, bookings or assignments.
- No accuracy, savings or SLA claims.
- No production security claims (no pen-testing, no encryption-at-rest beyond Postgres defaults, single trusted operator assumed).

---

## 6. Change control

- Any change to §1 requires: (a) a written reason, (b) both members' approval in the review checklist or a dated addendum, (c) updates to `requirements-matrix.md`, `api-contract.md` and `data-contract.md` in the same commit.
- Any change to §3 requires no approval — it is simply not allowed.

---

## Phase 1A — Approved amendments (normative)

**Approved:** 2026-09-14 (see `docs/PHASE_1_SIGNOFF.md`). These amendments are part of the frozen contract.

### A-1 — Matching planned-window relevance filter (approved)

In addition to the frozen region/window rule, a matched segment must be **temporally relevant**:

- Segment planned window: `segStart = planned_departure + Σ durations(seq < k)`, `segEnd = segStart + segment.planned_duration_hours` (requires A-3 fields).
- `passed = segEnd < disruption.start_time` → **unaffected** (excluded from the affected list).
- `upcoming = disruption.end_time != null AND segStart > disruption.end_time` → **unaffected**.
- If planned times are missing: `at_risk`, `timing_basis = "unknown"`, confidence `low`.
- If route/segment data is missing: `unknown_review` (never silently unaffected).

### A-7 — Redeployment detection and ranking (approved)

- **Future-commitment blocking:** any assignment with `end_time >= now` blocks redeployment regardless of the `reserved` flag. A future assignment with `reserved = false` is flagged `unprotected_future_assignment` and still blocks.
- **Ranking formula (frozen):**

```
proximity_score = 1 − min(distance_km, radius) / radius
idle_score      = min(idle_minutes, 1440) / 1440
capacity_fit    = min(1, asset.capacity_units / shipment.volume_units)
score = 0.45*proximity_score + 0.35*idle_score + 0.20*capacity_fit
```

- Tie-break: `score desc → distance asc → idle_minutes desc → asset_id asc`.
- Distance boundary is inclusive (`<= REDEPLOY_RADIUS_KM`, default 150 km).

### A-8 — Residual-risk clarification (approved)

- The H4 hard filter excludes only the **triggering** disruption's region.
- `residual_risk` measures severity-weighted exposure to **other** active disruptions:

```
residual_risk = Σ (severity_d / 5) × segment.duration_hours  for segments matching other active disruptions
                ÷ route.planned_duration_hours
```

### B-3 — Excursion grouping and closure (approved)

- Two breaching readings belong to the same excursion if the gap between them is `<= EXCURSION_GROUP_GAP_MINUTES` (default 30 = 2× sampling interval); a larger gap starts a new excursion.
- `duration_min = last_breach_timestamp − first_breach_timestamp`; a single breaching reading has `duration_min = 0`.
- Recovery sets `end_time` to the last breaching timestamp; the excursion remains `open` until human review.
- Lifecycle: `open → acknowledged → closed` (via `PATCH /api/excursions/:id`).
- Gaps > 30 min inside an excursion window → `data_quality = missing_readings` and severity `unknown_review`.

### B-6 — Implausible readings (approved)

- Readings outside −40..60 °C are stored and flagged `implausible`.
- If an implausible reading is the **sole** breach, severity = `unknown_review` and `data_quality = implausible` (enum extended in the data contract).
- Plausible breaching readings still drive severity when present alongside implausible ones.

### B-8 — Severity ladder order (approved)

Applied in place above: the critical check (`magnitude > major OR duration > critical`) now precedes the Major branch, so `critical_duration_minutes` is effective.

### Deferred (not part of the MVP)

- **A-4** carrier reliability term — reliability is displayed as an informational factor only.
- **B-4** cold-chain risk modifiers — the baseline severity-weight mapping remains frozen.
