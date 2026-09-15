# Member 2 — Combined Risk Contribution (Cold-Chain Half)

**Role:** Cold-Chain, AI and IBM Bob Engineer
**Status:** APPROVED — Phase 1A closure (2026-09-14). Baseline formula frozen; B-4 refinement deferred.
**Sources:** `scope-freeze.md` §1.2 + Phase 1A amendments, `data-contract.md` §13/§17 (RC-3), `member-2-coldchain-data-design.md` §6
**Related:** `member-2-severity-classification.md`, `member-1-disruption-matching.md` §5.3

---

## 1. Purpose and boundary

Define the cold-chain half of the combined priority score (P2). The shared `RiskAssessment` entity is owned jointly; this document freezes the cold-chain inputs, formula, factor keys and explainable fields.

**Boundaries confirmed with Member 1:**
- Logistics supplies `disruption_risk` (from the affected flag + impact score).
- Cold-chain supplies `coldchain_risk` (from the worst open excursion).
- Fleet/redeployment is **not** a risk input — it is a recovery action.
- `impact_status` is display/prioritisation metadata, not a score input.
- The severity **label** stays as defined in `member-2-severity-classification.md`; risk may weight it but never relabels it.

---

## 2. Frozen baseline formula

```
coldchain_risk = severity_weight(worst open excursion)
```

| Shipment cold-chain state | `severity_weight` |
|---|---|
| No excursion and no review flag (`normal`) | 0.0 |
| `warning` | 0.3 |
| `major` | 0.6 |
| `critical` | 1.0 |
| `unknown_review` (missing data, sensor failure, unknown policy, implausible sole breach) | 0.5 |

Rules:
1. The **worst open excursion** drives the score (precedence: critical > major > warning > unknown_review); repeated excursions never average out.
2. Review flags without an excursion (e.g. `policy_missing`) score 0.5 with `confidence_level = low` — never 0.0 (unknown is not safe).
3. Delivered shipments keep their last computed snapshot; no live re-scoring after delivery (post-delivery excursions excluded).
4. `excursion_count` is recorded as a factor but does not change the baseline score.
5. Weights live in configuration, not hardcoded.

---

## 3. Explainable fields (required output)

Every cold-chain risk output returns:

| Field | Type | Example | Meaning |
|---|---|---|---|
| `risk_score` | 0–1 | `0.600` | The `coldchain_risk` value |
| `severity` | enum | `major` | Worst open excursion severity (or `normal` / `unknown_review`) |
| `main_factors` | object | see §4 | Named factor values that produced the score |
| `data_quality` | enum | `complete` | `complete \| missing_readings \| sensor_failure \| out_of_order \| implausible` |
| `uncertainty` | object | `{"level": "high", "drivers": []}` | Confidence level + drivers |
| `recommended_action` | string | `"Review and consider intervention"` | Operator-facing next step |
| `human_review_required` | boolean | `true` | True for critical and unknown_review; recommended for major |

**Confidence rules:** `high` = complete data + known policy; `medium` = minor gaps (e.g. out-of-order corrected, single excursion); `low` = missing readings, sensor failure, unknown policy/cargo, or implausible sole breach.

---

## 4. Factor structure (RC-3 nested — frozen)

The cold-chain block inside `risk_assessment.factors`:

```json
{
  "coldchain": {
    "worst_excursion_id": "EX-0003",
    "severity": "major",
    "peak_deviation_c": 2.4,
    "duration_min": 45,
    "time_to_delivery_hours": 25.0,
    "data_quality": "complete",
    "cargo_sensitivity": 0.90,
    "excursion_count": 1,
    "confidence_level": "high",
    "confidence_drivers": [],
    "recommended_action": "Review and consider intervention",
    "human_review_required": false
  },
  "weights": { "alpha": 0.5, "beta": 0.5 }
}
```

`cargo_sensitivity` comes from `cargo_profile.sensitivity_weight` (B-1, approved).

---

## 5. Combination with disruption risk

```
combined_score = α · disruption_risk + β · coldchain_risk        (defaults α = β = 0.5, configurable)
```

- Both sub-scores are normalised 0–1 before combination, so neither domain silently dominates.
- `disruption_risk = impact_score` when affected, else `0` (frozen logistics rule).
- Snapshots are persisted on read (`risk_assessment` rows); history is retained so the operator's decision context is preserved.
- `/api/risk/overview` ranks by `combined_score` desc with factor breakdown per row.

---

## 6. Worked examples (synthetic)

| Shipment | disruption_risk | Worst excursion | coldchain_risk | combined | Interpretation |
|---|---|---|---|---|---|
| S102 | 0.78 | warning | 0.30 | 0.540 | Disruption-dominant; cold-chain monitor |
| S204 | 0.40 | critical | 1.00 | 0.700 | Cold-chain-dominant; immediate review |
| S140 | 0.62 | none | 0.00 | 0.310 | Disruption only |
| S177 | 0.00 | unknown_review (policy missing) | 0.50 | 0.250 | Cannot verify compliance; review required |
| S088 | 0.00 | none | 0.00 | 0.000 | Normal (excluded from overview by default) |

Arithmetic check (S102): `0.5×0.78 + 0.5×0.30 = 0.54`.

---

## 7. Optional refinement (B-4 — DEFERRED)

For future consideration only; **not part of the MVP**:

```
coldchain_risk = clamp(severity_weight × (0.6 + 0.2·magnitude_norm + 0.2·duration_norm), 0, 1)
                 × delivery_proximity_multiplier
```
where `magnitude_norm = min(1, peak_deviation_c / policy.major_deviation_c)`, `duration_norm = min(1, duration_min / policy.critical_duration_minutes)`, and proximity ∈ {1.0, 1.1 (< 24 h), 1.2 (< 12 h)}.

Deferral rationale: baseline severity weights already satisfy the requirement; modifiers add tuning surface without ground-truth data. All modifier inputs are still returned as factors, so the refinement can be added without a schema change.

---

## 8. Acceptance criteria

- Cold-chain risk changes when severity changes (CT-16).
- No excursion + no review flag → 0.0; unknown policy → 0.5, never 0.0.
- Every score returns factors, data quality, uncertainty and review requirement.
- Combined arithmetic matches manual calculation within 0.001.
- Delivered shipments do not gain live risk.

## 9. Open points for Member 1

1. Confirm the nested factor structure (RC-3) is implemented by the shared risk service.
2. Confirm `cargo_profile` (B-1) is loaded by the seed loader before risk evaluation.
3. Confirm the overview endpoint includes cold-chain factors for Bob's `get_combined_risk` and `get_risk_overview` tools.
