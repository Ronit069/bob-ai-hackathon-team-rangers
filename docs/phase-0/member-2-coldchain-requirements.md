# Member 2 — Cold-Chain Requirements

**Role:** Cold-Chain, AI and IBM Bob Engineer
**Status:** DRAFT — cold-chain half of Phase 0; requires Member 1 review for integration points
**Sources of truth:** `Industry Problem Statements - 2026.pdf` (L2), `scope-freeze.md`, `data-contract.md`, `api-contract.md`
**Scope of this file:** what cold-chain monitoring, excursion detection, severity classification, cold-chain risk and the Bob assistant must do — and what they explicitly do not claim.

---

## 0. Traceability summary

| Official requirement | Covered by |
|---|---|
| R4 — Monitor cold-chain IoT sensor logs | §1, §8.1 |
| R5 — Detect temperature excursions | §2, §3, §8.2 |
| R6 — Classify severity using configurable policy rules | §4, §7, §8.3 |
| P2 — Combined disruption + cold-chain priority score (proposed) | §8.4 |
| P5 — Grounded Bob assistant (proposed; Bob integration is a submission requirement) | §8.5 |

Out of scope (frozen in `scope-freeze.md` §3): ML models, live IoT streaming (MQTT/Kafka), real regulatory determinations, real sensor hardware, auto-execution of any action.

---

## 1. What cold-chain monitoring means in this project

[OFFICIAL] The L2 challenge requires monitoring cold-chain IoT sensor logs to detect temperature excursions and classify their severity before delivery.

[PROPOSED] In this prototype it means, concretely:

1. A **simulated IoT feed** posts timestamped temperature readings (15-minute interval) for every cold-chain shipment via `POST /api/sensor-readings`.
2. Readings are **stored, de-duplicated, reordered by timestamp and quality-checked** (gaps, duplicates, out-of-order, implausible values).
3. Every shipment is evaluated against its **configurable `TemperaturePolicy`** (per cargo type) continuously as readings arrive and on read.
4. Breaches become **excursion events** with start, end, peak deviation, duration and data-quality status.
5. Each excursion is **classified** into Warning / Major / Critical / Unknown-Review by a transparent rule ladder.
6. Results are surfaced as **alerts on the dashboard** and as **grounded answers from Bob**, with the raw evidence beside every claim.
7. Every human acknowledgement/closure is **recorded in the audit trail**.

The system does not replace a compliance officer; it removes the "nobody was watching the log" failure mode while attention is consumed by a disruption.

**Acceptance criteria:** a seeded excursion scenario is detected and classified before the shipment's delivery, with visible evidence and an audit record for the human decision.

---

## 2. What a temperature excursion means

[PROPOSED] An excursion is any period during which a shipment's temperature is outside its policy range:

```
breach(reading) = temperature_c < policy.min_c OR temperature_c > policy.max_c
```

- **Boundary is inclusive:** a reading exactly at `min_c` or `max_c` is **within limits** (frozen rule, tested CT-02). This must be documented in the UI tooltip, not left implicit.
- An excursion is an **event with a lifecycle**: `start_time` (first breaching reading), `end_time` (last breaching reading before recovery), `peak_deviation_c`, `duration_min`, `data_quality`, `severity`.
- A single breaching reading is still an excursion with `duration_min = 0` — it is recorded, not discarded.
- Excursions are **not** deleted when they recover; recovery is part of the record.

**Acceptance criteria:** every breach produces exactly one excursion record (after grouping, §8.2); no breach is silently dropped; no non-breach is flagged.

---

## 3. Why duration matters

[PROPOSED] Temperature risk is **time-integrated**: a 2-minute door-opening blip at +1 °C is not equivalent to a 3-hour compressor failure at +1 °C. Two excursions with the same peak can have different product impact. Therefore:

- `duration_min` is a first-class field on every excursion and a direct input to severity.
- The policy defines a **tolerance duration** (`max_excursion_minutes`): below it, a small deviation is a Warning; beyond it, severity escalates.
- The policy also defines a **critical duration** (`critical_duration_minutes`): a long enough excursion becomes Critical regardless of a modest peak.
- Duration is computed from readings, not estimated: `duration_min = last_breach_timestamp − first_breach_timestamp` within a grouped excursion.

[ASSUMPTION] The specific tolerance/critical durations in the seed policies are **illustrative placeholders**, configurable by the operator — not regulatory values (see §4 and §9).

**Acceptance criteria:** identical peak with different durations classifies differently where the policy says it should (CT-05, CT-06).

---

## 4. Why cargo-specific policies matter

[PROPOSED] Different cargo types have different safe ranges and tolerances. The system therefore stores one `TemperaturePolicy` per cargo type:

| Field | Meaning |
|---|---|
| `min_c` / `max_c` | allowed range (boundary inclusive) |
| `max_excursion_minutes` | tolerance before severity escalates |
| `minor_deviation_c` | magnitude ceiling for Warning/Major boundary |
| `major_deviation_c` | magnitude threshold for Critical |
| `critical_duration_minutes` | duration threshold for Critical |
| `version`, `effective_from`, `updated_by` | policy change governance (audited) |

- Policies are **editable at runtime** (`PUT /api/temperature-policies/:id`) and **versioned**; old versions are retained so past classifications remain explainable.
- A shipment whose cargo type has **no policy** is classified `unknown_review` — never assumed compliant (frozen rule, tested CT-12).
- We do **not** claim universal regulatory compliance: the values shipped with the demo are labelled `[ASSUMPTION]` placeholders, and the README/presentation must say so. Real deployments require the customer's product-specific and jurisdictional rules.

[ASSUMPTION] Seed policy examples (illustrative, configurable): vaccine 2.0–8.0 °C / 15 min tolerance; insulin 2.0–8.0 °C / 15 min; fresh_produce 0.0–4.0 °C / 20 min; frozen_food −20.0–−15.0 °C / 10 min. These are **not** asserted as the correct regulatory limits for any product.

**Acceptance criteria:** changing a policy changes classification without a code change; policy updates create a new version and an audit record (CT-23).

---

## 5. Why sensor data quality matters

[PROPOSED] The dangerous failure mode is not "no data" — it is **data that looks safe when it is actually missing or untrustworthy**. Therefore:

| Condition | Rule (frozen quality flags) | Consequence |
|---|---|---|
| Duplicate reading | same `(sensor_id, timestamp)` twice | first kept for evaluation; duplicate flagged |
| Out-of-order reading | timestamp earlier than previous ingestion | reordered by timestamp before evaluation; flagged |
| Implausible value | outside −40..60 °C | stored and flagged; never silently trusted (see B-6) |
| Gap | no reading for > 2× the expected interval (> 30 min) | `missing_readings`; if it overlaps a breach window → severity `unknown_review` |
| Sensor failure | no readings for ≥ 4× the interval (≥ 60 min) | distinct `sensor_failure` alert; **no compliance claim** |

- **Missing data is never treated as safe data.** If a gap overlaps a period that would otherwise be evaluated, severity becomes `Unknown / Review Required` (frozen rule, tested CT-08).
- **Sensor failure is distinct from a normal gap:** a gap is a hole in an otherwise reporting feed; failure is the feed stopping. Both are visible; failure raises its own alert type.
- Data-quality status is stored on each excursion (`complete | missing_readings | sensor_failure | out_of_order`) and shown as evidence.

**Acceptance criteria:** all five conditions are detected, surfaced and visible in the UI (CT-08…CT-11, CT-20).

---

## 6. Why the system must detect problems before delivery

[OFFICIAL] The L2 pain statement: breaches are discovered at delivery, when it is too late to act ($500K+ cargo spoiled).

[PROPOSED] Design consequences:

- Evaluation runs on **every ingestion** and on read — not on a post-delivery batch job.
- **Post-delivery readings are excluded** from pre-delivery severity scoring; excursions found after delivery are logged as post-delivery and do not drive live alerts (frozen rule, tested CT-15).
- Every alert carries **time remaining before delivery** so the operator can judge whether intervention is still possible.
- The MVP has no live external feeds; the simulated feed is explicit and labelled, but the *evaluation path* is the same one a real feed would use.

**Acceptance criteria:** an injected in-transit excursion fires an alert while the shipment is still in transit; a post-delivery excursion does not appear as a live alert (CT-14, CT-15).

---

## 7. What "severity" means in this prototype

[PROPOSED] Severity is a **rule-based priority label** derived from configurable policy thresholds. It is:

- **Not** a regulatory determination.
- **Not** a validated scientific model.
- **Not** a guarantee of product viability.

It exists to answer one operational question: *which breach should a human look at first, and how urgently?*

| Label | Meaning in this prototype |
|---|---|
| `Normal` | **No excursion** — shipment-level state, not an excursion record |
| `Warning` | Brief/small deviation within tolerance — monitor |
| `Major` | Sustained or larger deviation — review and consider action |
| `Critical` | Large or long deviation — immediate human review |
| `Unknown / Review Required` | Missing data, sensor failure or unknown policy — cannot conclude; a human must review |

Each label defines a recommended action, the evidence shown and whether human review is required (full table in `member-2-severity-classification.md` §4).

**Acceptance criteria:** every excursion has a severity, a rationale string and a data-quality status; `Unknown / Review Required` appears whenever the system cannot justify a conclusion.

---

## 8. Requirement areas

### 8.1 Sensor ingestion and monitoring (R4)

- **Input:** simulated readings (`shipment_id`, `sensor_id`, `timestamp`, `temperature_c`, optional `humidity_pct`, `source`), batch ≤ 500.
- **Processing:** validate → dedupe `(sensor_id, timestamp)` → order by timestamp → quality flags (gap/duplicate/out-of-order/implausible) → store → return flags → trigger evaluation.
- **Output:** stored readings; per-shipment quality summary; derived sensor status (`reporting | delayed | failed | unknown`).
- **User value:** live cold-chain visibility instead of post-delivery log review.
- **Acceptance criteria:** CT-01…CT-04, CT-08…CT-11 pass; ingestion rejects future timestamps and bad FKs; batch partial-failure semantics documented.
- **Edge cases:** single-reading shipment; 500-reading batch; timestamp in the future → 400; unknown shipment → 404/400 per contract; humidity absent.

### 8.2 Excursion detection (R5)

- **Input:** ordered, quality-checked readings + the shipment's active policy + delivery cutoff.
- **Processing:** threshold detection (boundary inclusive) → grouping → duration/peak computation → excursion record → quality/unknown handling.
- **Output:** `TemperatureExcursion` records (`EX-####`) with lifecycle status.
- **User value:** catches breaches in transit, before cargo is lost.
- **Acceptance criteria:** CT-05…CT-08, CT-11, CT-12, CT-15 pass; no breach dropped; repeated excursions logged individually.
- **Edge cases:** single-reading breach; breach spanning a gap; two breaches 10 minutes apart (merged) vs 3 hours apart (separate); ongoing breach with no recovery yet; breach after delivery.

### 8.3 Severity classification (R6)

- **Input:** excursion (duration, peak deviation), policy, cargo type, data-quality status, time to delivery.
- **Processing:** the configurable rule ladder (`member-2-severity-classification.md` §3) → severity + rationale.
- **Output:** severity label, rationale codes, recommended action, human-review flag.
- **User value:** prioritises which breach matters most.
- **Acceptance criteria:** every edge case in Task 4 passes; unknown policy/missing data → `unknown_review`; no hardcoded universal thresholds.
- **Edge cases:** exactly at threshold; very brief; very long; repeated; missing data; sensor failure; unknown cargo type; unknown policy; delivered; near delivery.

### 8.4 Cold-chain risk contribution (P2)

- **Input:** worst open excursion per shipment, cargo sensitivity, data quality, time to delivery.
- **Processing:** frozen severity→weight mapping (Normal 0.0, Warning 0.3, Major 0.6, Critical 1.0, Unknown 0.5); optional refined multipliers proposed as B-4.
- **Output:** `coldchain_risk` (0–1) + explainable factors; combined with `disruption_risk` by the shared engine.
- **User value:** one ranked worklist across both domains.
- **Acceptance criteria:** CT-16 passes; cold-chain risk changes when severity changes; factors are returned, not just a number.
- **Edge cases:** multiple excursions (worst wins); unknown severity; no policy; delivered shipment (risk frozen at delivery).

### 8.5 Grounded Bob assistant (P5)

- **Input:** operator natural-language question.
- **Processing:** Bob selects the frozen tool(s), calls the backend REST API through the MCP tool layer, composes an answer only from tool output.
- **Output:** answer + evidence (tool name, input, raw JSON) + explicit failure messages when tools fail.
- **User value:** removes the need to learn the UI; synthesises both domains into one brief.
- **Acceptance criteria:** CT-17 passes (no invented facts on tested cases); CT-18 (Bob unavailable) and CT-19 (backend failure) degrade gracefully.
- **Edge cases:** ambiguous question (ask for the shipment ID rather than guess); empty tool result ("no data" — not "all clear"); tool error (report it); unsupported question (say so and list capabilities).

### 8.6 Evidence and explanation generation

- **Input:** excursions, readings, policy, risk assessments, recommendations.
- **Processing:** deterministic rendering of factor keys into human strings (shared vocabulary from `data-contract.md` §9.3); raw JSON retained.
- **Output:** factor lists, rationale strings, evidence bundles for UI and Bob.
- **User value:** trust — the operator can audit every claim.
- **Acceptance criteria:** every alert/severity/score shows its inputs; Bob's evidence panel matches the backend JSON exactly.
- **Edge cases:** missing values rendered as "unknown", never omitted silently; long lists truncated with a count, not dropped.

---

## 9. Label discipline (official vs proposed vs assumption vs future)

| Item | Label |
|---|---|
| Monitor cold-chain logs, detect excursions, classify severity before delivery | `[OFFICIAL]` L2 bullet 4 |
| Bob as the conversational layer over backend tools | `[OFFICIAL]` submission rubric criterion 5 (Bob must be load-bearing) |
| 15-minute simulated feed; REST ingestion; 4 severity labels; quality flags | `[PROPOSED]` |
| Policy thresholds in seed data (2–8 °C etc.); duration tolerances | `[ASSUMPTION]` — illustrative, configurable, not regulatory |
| ML anomaly detection, ML delay prediction, learned risk, live IoT streaming, real regulatory mappings | `[FUTURE]` — see `member-2-ai-ml-decision.md` |
| "Regulatory compliance" claims of any kind | **Prohibited** — the system classifies against configurable policy, not law |

---

## 10. Open integration points for Member 1

| # | Point | Needs from Member 1 |
|---|---|---|
| J1 | Shipment linkage | Stable `shipment_id` in seed data and APIs; `is_cold_chain` correct; `deadline` present (and `planned_arrival` if A-3 approved) for time-to-delivery |
| J2 | Delivery cutoff | `actual_arrival` (A-3) or an equivalent delivered timestamp for post-delivery exclusion; otherwise documented approximation (B-5) |
| J3 | Combined risk | Accept `coldchain_risk` + factors from this domain into the shared `RiskAssessment` and `/api/risk/overview` |
| J4 | Explanation vocabulary | Reuse `factors`/`constraints_checked`/`rejected` keys and reason-code style across domains |
| J5 | Audit write path | Shared service contract for `AuditRecord` writes from cold-chain actions (acknowledge/close/policy update) |
| J6 | UI shell | SH-04 shared components before cold-chain screens are wired |
| J7 | Recommendation creation | Cold-chain does not create reroute/redeployment recommendations; it raises alerts + review states. Confirm this boundary (M1's A-5 stays logistics-only) |
