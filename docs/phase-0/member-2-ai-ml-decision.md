# Member 2 — AI / ML Decision Analysis

**Role:** Cold-Chain, AI and IBM Bob Engineer
**Status:** DRAFT — decision record for Task 5. Conclusion: **no ML in the MVP**. This matches `scope-freeze.md` §3 and ADR-006.
**Rule:** ML is justified only when (a) a rule baseline is inadequate, (b) training data exists, and (c) the improvement can be measured honestly. None of the candidates below passes all three today.

---

## 1. Context

The official L2 challenge requires detecting and classifying temperature excursions — a **solved, standardised, deterministic domain problem** where a threshold/duration rule is the correct tool and is more auditable to a compliance officer than a learned model. The genuinely AI-shaped parts of this project are:

- **Bob (generative AI):** grounded natural-language synthesis over structured tool output (load-bearing, rubric criterion 5).
- **Rules + transparent scoring:** everything that must be exactly right (thresholds, durations, capacity, matching).

ML is evaluated below on its own merits. No model is trained in Phase 0; no accuracy numbers are claimed anywhere.

---

## 2. Candidate analysis

### 2.1 Temperature anomaly detection (true excursion vs sensor artifact / drift)

| Aspect | Assessment |
|---|---|
| Input features | reading value, delta vs previous, rolling mean/std (e.g. 4-reading window), humidity, time in transit, cargo type, sensor id |
| Target | anomaly label/score (real excursion vs artifact); ideally supervised |
| Training data required | labelled historical sensor streams containing both real excursions and sensor faults |
| Data available | **None.** All readings are synthetic; injecting defects proves the pipeline, not real-world accuracy |
| Baseline (MVP) | threshold breach + quality flags (gap/duplicate/out-of-order/implausible) — implemented |
| Evaluation metric | precision/recall or PR-AUC on labelled anomalies; false-positive rate at fixed recall |
| Why ML might improve | distinguishes sensor drift/faults from real breaches; may catch subtle drift **below** thresholds; reduces alert fatigue |
| Risks | no real labels → synthetic overfit; unexplainable to compliance; a false negative on a real excursion is a safety failure |
| Fallback | rule baseline remains authoritative; any ML output is **advisory only** and never suppresses a threshold breach |
| Decision | **Future scope (F2).** Not in MVP. Rule-based quality flags cover the official requirement. |

### 2.2 ETA delay prediction

| Aspect | Assessment |
|---|---|
| Input features | disruption type/severity/region, lane, carrier reliability, schedule buffer, distance to disruption, cargo type |
| Target | delay in hours (regression) or delayed/on-time (classification) |
| Training data required | historical shipment outcomes (planned vs actual arrival) with features at prediction time |
| Data available | **None.** Synthetic delays can be generated, but a model trained on them demonstrates plumbing, not prediction |
| Baseline (MVP) | fixed buffer per disruption type (rule) — transparent and explainable |
| Evaluation metric | MAE vs naive baseline; or precision/recall for the delayed class |
| Why ML might improve | interacting factors are hard to hand-tune without being too conservative or too loose |
| Risks | distribution shift; synthetic-only training; tempting but misleading accuracy claims; adds scope |
| Fallback | fixed-buffer rule |
| Decision | **Future scope (F1).** Member 1's domain; never blocks the MVP. |

### 2.3 Sensor failure detection

| Aspect | Assessment |
|---|---|
| Input features | time since last reading, interval regularity, variance trend, implausible spikes, device metadata (battery/signal — not available) |
| Target | failure event (binary) and ideally **lead time** before failure |
| Training data required | historical device telemetry with failure events |
| Data available | **None.** No device metadata exists in the MVP schema |
| Baseline (MVP) | timeout rule: > 2× interval = delayed, ≥ 4× interval (60 min) = failed; distinct from a gap — implemented |
| Evaluation metric | detection latency and false-positive rate |
| Why ML might improve | predicts failure **before** it happens from degradation patterns (increasing variance, drift) rather than reacting to silence |
| Risks | no telemetry; synthetic patterns; complexity without a demonstrated payoff |
| Fallback | timeout rule (covers the requirement: "sensor failure flagged distinctly from a normal gap") |
| Decision | **Future scope.** Rule baseline is sufficient for MVP. |

### 2.4 Cold-chain risk prediction (learned risk score)

| Aspect | Assessment |
|---|---|
| Input features | excursion severity, duration, magnitude, cargo sensitivity, time to delivery, data quality, prior excursion count |
| Target | risk score / probability of spoilage or compliance failure |
| Training data required | real outcome labels (spoilage, rejection, claim) tied to excursion histories — high-stakes and regulated |
| Data available | **None.** Manufacturing synthetic labels would be circular |
| Baseline (MVP) | frozen severity-weight mapping (Normal 0.0 / Warning 0.3 / Major 0.6 / Critical 1.0 / Unknown 0.5) + optional transparent multipliers (B-4) |
| Evaluation metric | calibration + discrimination (e.g. Brier score, PR-AUC) against held-out real outcomes |
| Why ML might improve | non-linear interactions and product-specific viability curves |
| Risks | high-stakes domain; unexplainable scores; regulatory sensitivity; no labels; a black-box score breaks the P3 explainability requirement |
| Fallback | transparent weighted formula (decomposable into factors) |
| Decision | **Future scope.** The frozen formula is the MVP; B-4 remains a transparent formula, not ML. |

---

## 3. Decision matrix

| Candidate | Baseline exists | Data exists | Measurable gain | MVP? | Label in submission |
|---|---|---|---|---|---|
| Temperature anomaly detection | yes | no | unknown | No | Future enhancement (F2) |
| ETA delay prediction | yes | no | unknown | No | Future enhancement (F1) |
| Sensor failure detection | yes | no | unknown | No | Future enhancement |
| Cold-chain risk prediction | yes | no | unknown | No | Future enhancement |

**MVP AI content = Bob (generative, grounded) + deterministic rules + transparent scoring.** This is an honest position, not a gap: the official requirements are met by auditable rules, and the rubric explicitly rewards working code and honest limitations over name-dropped ML.

---

## 4. What would change our mind

A future ML component becomes justified only when **all** of the following exist:

1. A real historical dataset (sensor streams with labelled faults, or shipment outcomes with features at prediction time).
2. A domain expert who validates labels and thresholds.
3. A held-out evaluation protocol with the metric agreed **before** training.
4. A demonstrable improvement over the rule baseline (e.g. higher recall at equal precision).
5. Time budget outside the MVP critical path, with a feature flag and a documented fallback.

Until then, no ML is trained, and no "AI-powered" claim is made beyond Bob's grounded generation.

---

## 5. Risks of forcing ML into the MVP

| Risk | Why it matters | Mitigation |
|---|---|---|
| Fake accuracy claims | Judges read code; unverifiable claims hurt credibility | No ML claims; limitations section states the position |
| Unexplainable decisions | Compliance/ops users need auditability (P3) | Rules + factors for every score |
| Scope creep | ML would delay the six official capabilities | `scope-freeze.md` §3 forbids it on the MVP path |
| Safety: model suppresses a real breach | A false negative could "clear" spoiled cargo | Any future ML is advisory; threshold breaches always stand |
| Synthetic overfit | A model trained on our own generator proves nothing | Deferred until real data exists |

---

## 6. Honest claims for the submission

**We will say:**
- Excursion detection and severity classification are deterministic, policy-driven rules.
- Bob is a grounded generative layer over backend tools; it never computes scores.
- The risk score is a transparent, configurable heuristic, not a validated model.
- All data is synthetic; no accuracy claims are made.

**We will not say:**
- "AI detects anomalies" (unless F2 is actually built and evaluated — it is not planned for MVP).
- "The model predicts failures/ETA" (not built).
- Any percentage accuracy, savings or compliance claim.

---

## 7. Open points for Member 1

1. Confirm the shared position (ADR-006 + `scope-freeze.md` §3): no ML on the MVP path; ML listed only as future work.
2. Confirm that any future ML experiment is timeboxed on a feature-flagged branch and can never block `main`.
3. Confirm the deck/README limitations wording above so both members tell the same story to evaluators.
