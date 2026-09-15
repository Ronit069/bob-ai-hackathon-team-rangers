# Member 2 — Cold-Chain Test Plan

**Role:** Cold-Chain, AI and IBM Bob Engineer
**Status:** APPROVED — Phase 1A closure (2026-09-14). Test design only; no framework installed (Phase 2/3).
**Fixture convention:** each test references a `scenario_id` in the seeded dataset with stored ground truth. Cold-chain scenarios use **`SCN-101`…`SCN-125`** (Member 1 uses `SCN-001`…`SCN-025`).
**Related:** `member-2-excursion-detection.md`, `member-2-severity-classification.md`, `member-2-combined-risk.md`, `member-2-bob-integration.md`

---

## 1. Test types and ownership

| Type | Owner | Tooling (Phase 2/3) |
|---|---|---|
| Unit (detection, severity, quality flags) | M2 | `node:test` |
| Integration (service ↔ PostgreSQL) | M2 | `node:test` + test database |
| API contract (shapes, errors) | M2 (M1 reviews) | `node:test` + `fetch` |
| UI state tests (empty/loading/error/unknown) | M2 | Vitest + Testing Library (if adopted) |
| Bob grounding | M2 | Tool-layer tests; live Bob tests if credentials exist |
| End-to-end (combined risk, Bob fallback) | Shared | Scripted run / Playwright if adopted |

---

## 2. Detection and quality tests

| ID | Scenario | Fixture / input | Expected output | Why it matters | Owner |
|---|---|---|---|---|---|
| CT-01 | Normal reading | `SCN-101`: S102 readings all within 2–8 °C | No excursion; shipment cold-chain status `normal` | Baseline acceptance | M2 |
| CT-02 | Exact boundary | `SCN-102`: readings exactly 2.0 and 8.0 °C | No breach (inclusive boundary); UI shows "within limits (at boundary)" | Frozen boundary semantics | M2 |
| CT-03 | Below minimum | `SCN-103`: readings at 1.4 °C | Breach detected; excursion with correct magnitude | R5 core | M2 |
| CT-04 | Above maximum | `SCN-104`: readings at 9.4 °C | Breach detected; excursion with correct magnitude | R5 core | M2 |
| CT-05 | Short excursion | `SCN-105`: single reading 8.8 °C, duration 0 | Severity `warning` (`duration<=tolerance;magnitude<=minor`) | Severity ladder Warning branch | M2 |
| CT-06 | Prolonged excursion | `SCN-106`: 10.4 °C for 45 min | Severity `major` (`duration>tolerance;magnitude<=major`) | Severity ladder Major branch | M2 |
| CT-07 | Repeated excursion | `SCN-107`: two breach groups 2 h apart | Two `EX-####` records; shipment status = worst; `excursion_count = 2` | B-3 grouping; worst-wins rule | M2 |
| CT-08 | Missing reading inside breach | `SCN-108`: breach at 08:15, gap until 09:45, breach at 09:45 | `data_quality = missing_readings`; severity `unknown_review` | Missing ≠ safe | M2 |
| CT-09 | Duplicate reading | `SCN-109`: same `(sensor_id, timestamp)` twice | First kept; duplicate counted in quality evidence; no double duration | Dedup rule | M2 |
| CT-10 | Out-of-order reading | `SCN-110`: timestamps delivered out of order | Reordered by timestamp; `data_quality = out_of_order`; severity still computed | Ordering correction | M2 |
| CT-11 | Sensor failure | `SCN-111`: no readings for 75 min after 08:00 | `sensor_failure` alert; sensor status `failed`; open excursion → `unknown_review`; no compliance claim | Failure ≠ gap | M2 |
| CT-12 | Unknown policy | `SCN-112`: cargo type `vaccine_lot_x` has no policy | Review flag `policy_missing`; no fabricated excursion; `coldchain_risk = 0.5`, confidence low | Never compliant without policy | M2 |
| CT-13 | Unknown cargo type | `SCN-113`: cargo type not in vocabulary | Review flag `unknown_cargo_type`; alert raised | Data integrity | M2 |
| CT-14 | Shipment near delivery | `SCN-114`: excursion with `time_to_delivery_hours = 8` | `time_to_delivery_hours` surfaced on excursion/alert; action text reflects urgency | Prioritisation | M2 |
| CT-15 | Shipment already delivered | `SCN-115`: delivered at 12:00; breach readings at 12:30 | Excursion logged `post_delivery = true`; excluded from live alerts and pre-delivery severity | Delivery cutoff (B-5/A-3) | M2 |
| CT-20 | Implausible reading | `SCN-116`: sole breach at 45.0 °C (outside −40..60 plausible? 45 is within; use 65.0) | Flagged `implausible`; sole breach → `severity = unknown_review`, `data_quality = implausible` | B-6 rule | M2 |
| CT-21 | Grouping boundary | `SCN-117`: breaches 30 min apart (merge) and 31 min apart (split) | ≤30 min → one excursion; >30 min → two excursions + gap flag | B-3 boundary determinism | M2 |
| CT-22 | Long small-magnitude excursion | `SCN-118`: 9.2 °C for 75 min (magnitude 1.2, critical duration 60) | B-8 ladder → `critical` (`duration>critical`); baseline literal would be `major` — assert B-8 | Confirms approved ladder order | M2 |
| CT-23 | Policy update reclassifies | `SCN-119`: update `TP-VACCINE` tolerance 15 → 5 min | New policy version; audit `policy_updated` with before/after; re-evaluation changes CT-05 outcome | Configurable policies (R6) | M2 |

## 3. Risk, lifecycle and API tests

| ID | Scenario | Fixture / input | Expected output | Why it matters | Owner |
|---|---|---|---|---|---|
| CT-16 | Combined disruption + cold-chain risk | `SCN-120`: S102 affected by D01 + major excursion | `combined_score = 0.5·disruption_risk + 0.5·coldchain_risk` within 0.001; nested factors present (RC-3) | P2 combined engine | Shared |
| CT-24 | Excursion review lifecycle | `SCN-121`: excursion `open` → acknowledge → close | `200` + audit records; invalid transition → `409`; critical close without note → `400` | Human review + audit (B-7) | M2 |
| CT-25 | Evidence consistency | `SCN-122`: UI evidence vs backend JSON | Every entity ID in Bob/UI text appears in raw JSON; truncation shows counts | Grounding transparency | M2 |
| CT-26 | API contract shapes | All M2 endpoints | Responses match `api-contract.md` + §7 amendments; unknown fields rejected; standard error envelope | Contract drift prevention | M2 |

## 4. Bob and resilience tests

| ID | Scenario | Fixture / input | Expected output | Why it matters | Owner |
|---|---|---|---|---|---|
| CT-17 | Bob grounding | `SCN-123`: questions with known tool outputs | Answers contain only returned facts; empty result → "no data returned"; no invented IDs | Rubric criterion 5 | M2 |
| CT-18 | Bob unavailable | `SCN-124`: `BOB_ENABLED=false`; open chat | `503 BOB_UNAVAILABLE`; fallback message; dashboard fully usable | Resilience (ADR-004) | M2 |
| CT-19 | Backend unavailable | `SCN-125`: stop API; load cold-chain screens | Retry banners/error states; no blank screens; no false "normal" | Resilience (NFR-05) | Shared |

## 5. Fixture-to-scenario coverage

The cold-chain generator must produce `SCN-101`…`SCN-125` (one scenario per test above, except CT-26 which runs against all). The validator asserts:
1. every `SCN` exists at least once;
2. ground truth (expected severity, duration, peak, quality) is re-derivable from fixture readings;
3. policy/cargo-profile rows exist for all non-review scenarios;
4. deliberate defects (duplicates, gaps, failures, implausible) are tagged, not accidental.

## 6. Out of scope

- Performance/load testing (demo scale only).
- Real regulatory validation of thresholds (illustrative placeholders).
- ML model tests (no ML in MVP).
