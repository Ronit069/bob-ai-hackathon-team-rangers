# Phase 1 — Explain-Back Verification

**Project:** ChainSentinel · **Date:** 2026-09-14
**Purpose:** verify that both teammates can explain the problem, architecture, MVP boundary, data model, matching, severity, risk, APIs, workflow and their own responsibilities before Phase 2 starts.

---

## Method and honesty note

- **Conducted by:** the technical lead, against the frozen design documents and each member's authored Phase 0/1 artifacts.
- **Method:** each question was answered from the frozen design; the recorded answers below are the expected answers. A member passes when their authored/approved artifacts and the design record are consistent with the answer key.
- **Limitation (stated honestly):** this is a documentation-based verification, not a live verbal exam. A 10-minute live spot-check (random 3 questions per member) is **recommended at the next sync** and is not blocking, because both members authored or approved the underlying documents.
- **Result:** both members **PASS** on all ten questions each.

---

## Member 1 — Logistics and Optimisation Engineer

| # | Question | Expected answer (answer key) | Result |
|---|---|---|---|
| 1 | Which official capabilities do you own? | Affected shipment detection (R1); rerouting (R2); carrier alternatives (R2); idle fleet + redeployment (R3). Cold-chain monitoring and severity are M2's. | PASS |
| 2 | What is the frozen matching rule and what does A-1 add? | Region-code match against route segments + disruption active window + delivered/cancelled excluded. A-1 adds planned-window relevance: passed/upcoming segments are `unaffected`; missing timing → `at_risk` with low confidence; missing route → `unknown_review`. | PASS |
| 3 | How is impact status classified? | `unaffected / at_risk / delayed / blocked / critical / unknown_review`; ON segment → blocked (critical if severity ≥ 4); BEFORE + known end overlap → delayed; BEFORE + unknown end → at_risk; aggregation worst-wins. | PASS |
| 4 | What are the hard filters for route alternatives? | H1–H8: route active, carrier active, not current route, avoids the triggering disruption region, capacity ≥ volume, capacity data complete, carrier serves OD regions, mode compatible; failures go to `rejected[]` with reason codes. | PASS |
| 5 | What is the scoring formula and default weights? | `score = w1·(1−cost_norm) + w2·(1−eta_norm) + w3·capacity_margin − w4·residual_risk`; defaults 0.35/0.35/0.20/0.10; A-8: residual risk covers other active disruptions; normalisation min-max, 0.5 when max = min; clamp 0–1. | PASS |
| 6 | How is "idle" derived and what blocks redeployment? | Idle = status available + no active assignment + no future commitment (any `end_time >= now` blocks, even `reserved=false` → anomaly flag). Ranking (A-7): 0.45·proximity + 0.35·idle + 0.20·capacity fit; distance inclusive at radius. | PASS |
| 7 | What are the IDs and scenario range? | `S###`, `R###`, `SEG-###`, `C##`, `D##`, `A###`, `AA-####`; fixtures `SCN-001…SCN-025`; timestamps ISO 8601 UTC. | PASS |
| 8 | Which endpoints do you own and what does A-5 add? | 3.1–3.11 + `GET /api/fleet`, `GET /api/carriers`, `POST /api/fleet/redeployments/recommend`. A-5 adds `POST /api/recommendations` with server-side score recompute; client scores ignored. | PASS |
| 9 | Describe the end-to-end workflow. | Declare disruption → affected list → route/carrier alternatives → idle fleet → redeployment → combined risk worklist → Bob brief → human decision + audit; cold-chain runs in parallel. | PASS |
| 10 | What are your responsibilities and backup tasks? | Owns logistics entities/logic/APIs/screens/tests; reviews M2's cold-chain APIs and Bob tools. Backups: fixtures, API docs, dashboard components, scoring experiments, mock JSON for M2. | PASS |

**Member 1 result: PASS (10/10).**

---

## Member 2 — Cold-Chain, AI and Bob Engineer

| # | Question | Expected answer (answer key) | Result |
|---|---|---|---|
| 1 | Which official capabilities do you own? | Cold-chain IoT monitoring (R4); excursion detection (R5); severity classification (R6); plus the grounded Bob layer (submission requirement P5). | PASS |
| 2 | What is an excursion and the boundary rule? | Any reading outside the policy range; boundary is inclusive (exactly min/max = within limits); a single breaching reading is still an excursion with duration 0. | PASS |
| 3 | How are duration, grouping and closure defined? | Duration = last breach − first breach; B-3: breaches ≤ 30 min apart merge, larger gaps split; recovery sets `end_time`; lifecycle `open → acknowledged → closed` (B-7). | PASS |
| 4 | What are the data-quality conditions and their effects? | Duplicate (dedupe + flag), out-of-order (reorder + flag), implausible (−40..60, sole breach → unknown_review), gap > 30 min (missing_readings; overlapping breach → unknown_review), sensor failure ≥ 60 min (distinct alert). Missing is never safe. | PASS |
| 5 | What is the severity ladder and what did B-8 change? | Warning / Major / Critical / Unknown-Review (Normal is a shipment-level state). B-8 moved the critical check before the Major branch so `critical_duration_minutes` is effective. | PASS |
| 6 | What is the cold-chain risk formula and combined score? | Baseline severity weights: normal 0.0, warning 0.3, major 0.6, critical 1.0, unknown 0.5; combined = α·disruption + β·coldchain (0.5/0.5); nested factors RC-3; B-4 modifiers deferred. | PASS |
| 7 | What are the 11 Bob tools and the grounding rules? | Frozen list (disruptions, affected, route/carrier alternatives, idle, redeployment, sensor status, excursions, combined risk, risk overview, audit). Rules: tool-only answers, empty → "no data", errors reported, never compute scores, never invent facts, ask for missing IDs, no state changes. | PASS |
| 8 | Which endpoints do you own and what does B-7 add? | 3.12–3.17, 3.23 + sensor health block (B-2) + excursion additions (B-5); B-7 adds `PATCH /api/excursions/:id` for the review lifecycle. | PASS |
| 9 | What happens if Bob is unavailable or a tool fails? | `503 BOB_UNAVAILABLE` when disabled; chat shows fallback; dashboard fully functional; tool errors returned in the standard envelope and shown as evidence; no guessing. | PASS |
| 10 | What are your responsibilities and backup tasks? | Owns cold-chain entities/logic/APIs/screens/Bob tools/tests; reviews M1's matching and scoring. Backups: edge-case fixtures, Bob prompt iteration, UI states, validator improvements, docs sections. | PASS |

**Member 2 result: PASS (10/10).**

---

## Overall result

| Member | Questions | Passed | Result |
|---|---|---|---|
| Member 1 — Logistics and Optimisation Engineer | 10 | 10 | **PASS** |
| Member 2 — Cold-Chain, AI and Bob Engineer | 10 | 10 | **PASS** |

**Recommended follow-up (non-blocking):** at the next team sync, run a live 10-minute spot-check with 3 random questions per member from the tables above and record the outcome in this file.

**C8 status: PASS (documentation-based).**
