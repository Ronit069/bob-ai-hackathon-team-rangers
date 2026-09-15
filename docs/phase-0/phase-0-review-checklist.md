# Phase 0 — Review Checklist and Sign-Off

**Purpose:** this is the gate between Phase 0 and Phase 1. Both members must review and approve before any dataset generation or feature implementation begins.

---

## 1. How to use this checklist

1. Both members read all files in `docs/phase-0/`.
2. Each member independently ticks every box below and answers the open questions in §8.
3. Any unchecked box or unresolved question is discussed in one joint session (max 45 minutes).
4. Both members fill the approval table in §9.
5. Only then does Phase 1 start (`phase-plan.md` §7).

---

## 2. Document completeness

- [ ] `project-inspection-report.md` — exists; conflicts and gaps match what both members know
- [ ] `requirements-matrix.md` — all six mandatory requirements present with source and acceptance evidence
- [ ] `scope-freeze.md` — MVP / if-time / future boundaries agreed
- [ ] `architecture-decision-record.md` — one stack selected; Bob boundary and fallback understood
- [ ] `data-contract.md` — 13 entities with IDs, types, validation and examples
- [ ] `api-contract.md` — every endpoint has method, path, request, response, errors, owner, dependency
- [ ] `team-ownership.md` — ownership matches the brief; interfaces and backup tasks clear
- [ ] `phase-plan.md` — phases, task board, checkpoints and Definition of Done clear
- [ ] `risk-register.md` — all required risks covered with mitigations and fallbacks
- [ ] This checklist — completed and signed

---

## 3. Scope review

- [ ] I can state the six official L2 capabilities from memory (R1–R6).
- [ ] I agree that ML, live feeds, PostGIS, auth and execution engines are out of MVP scope.
- [ ] I agree with the scope-cut order and accept that "if time permits" features never block the MVP.
- [ ] I agree that no feature will be claimed as implemented unless it exists and is tested.
- [ ] I agree the MVP dataset sizes are sufficient for a credible demo.
- [ ] I agree that temperature policy values are illustrative and configurable — never presented as regulatory truth.

---

## 4. Architecture review

- [ ] I agree with the selected stack: React + Vite / Node + Express / PostgreSQL 16 / Python stdlib generator / no ORM / no ML.
- [ ] I agree with the module boundaries and that services do not call each other over HTTP.
- [ ] I understand how data flows from generator → seed → database → API → UI.
- [ ] I understand the Bob boundary: REST is the source of truth; MCP tools are thin adapters; `BOB_ENABLED=false` is a first-class mode.
- [ ] I agree that the dashboard must work fully with Bob disabled.
- [ ] I can run (or know how to run) the planned local setup: Docker Postgres + backend + frontend.

---

## 5. Data contract review

- [ ] All 13 entities are present with required fields and types.
- [ ] I agree with the ID formats (`S###`, `R###`, `SEG-###`, `C##`, `D##`, `A###`, `AA-####`, `SR-######`, `TP-*`, `EX-####`, `REC-####`, `RSK-####`, `AUD-######`).
- [ ] I agree with the region-code vocabulary and the region-matching rule (no geometry in MVP).
- [ ] I agree with the status enums and validation rules.
- [ ] I agree with the cross-entity invariants, including overlap detection for asset assignments.
- [ ] I agree that audit records are append-only and that risk assessments are snapshots.
- [ ] I agree with the change-control rule: contract update + migration + both approvals in one PR.

---

## 6. API contract review

- [ ] Every endpoint in the summary table has a full specification.
- [ ] I agree with the error envelope and status-code conventions.
- [ ] I agree that only the decision endpoint changes recommendation status.
- [ ] I agree with the frozen 11-tool Bob mapping.
- [ ] I agree that empty results are `200` with an empty list, not `404`.
- [ ] I agree that `POST /api/bob/query` returns `503 BOB_UNAVAILABLE` when Bob is disabled, and the UI degrades gracefully.

---

## 7. Ownership and plan review

- [ ] I accept the modules assigned to me in `team-ownership.md`.
- [ ] I accept the reviewer responsibilities for the other member's modules.
- [ ] I accept the working rules (branches, PR review, daily sync, 30–45 minute blocker rule, contribution log).
- [ ] I accept the Phase 0–7 sequence and the integration checkpoints.
- [ ] I accept the Definition of Done for every task.
- [ ] I know my backup tasks and will use them instead of idling.

---

## 8. Open questions (answer before Phase 1)

| # | Question | Proposed default | Decision |
|---|---|---|---|
| Q1 | Final project name (ChainPulse vs ChainSentinel vs other)? | **ChainSentinel** (blueprint name); rename docs only, code identifiers unaffected | |
| Q2 | Team name, lead name/email, member name/email for `submission.yaml`? | Not invented — must come from the team | |
| Q3 | How will IBM Bob be accessed (CLI, IDE, MCP endpoint, API key)? Is a key available? | Assume MCP tool server + Bob CLI; `BOB_ENABLED=false` until credentials exist | |
| Q4 | What is the actual submission deadline? | Default to the 7-day sequence in Document 2 | |
| Q5 | GitHub account/org and repo name (`bob-ai-hackathon-[team-name]`)? | Public repo from the official template | |
| Q6 | Docker Desktop available on both machines? | Yes; native Postgres fallback documented otherwise | |
| Q7 | Is the region-code vocabulary and dataset size acceptable? | Yes per `scope-freeze.md` §1.3 | |
| Q8 | Is the "if time permits" ordering acceptable? | Yes per `scope-freeze.md` §2 | |
| Q9 | Who owns final merge rights / branch protection on `main`? | Both; PR review required; no direct pushes | |
| Q10 | Demo machine and rehearsal schedule? | Same machine for both rehearsals; recorded backup video | |

---

## 9. Approval

| Role | Name | Decision (Approve / Approve with changes / Reject) | Date | Notes |
|---|---|---|---|---|
| Member 1 — Logistics and Optimisation Engineer | _(name pending Q4 — deferred, does not block MVP)_ | **Approve** | 2026-09-14 | Recorded in Phase 1A closure (`docs/PHASE_1_SIGNOFF.md`) |
| Member 2 — Cold-Chain, AI and Bob Engineer | _(name pending Q4 — deferred, does not block MVP)_ | **Approve** | 2026-09-14 | Recorded in Phase 1A closure (`docs/PHASE_1_SIGNOFF.md`) |

**Approval means:** the scope, architecture, data contract, API contract, ownership and plan are frozen. Changes after this point follow the change-control rules in the respective documents.

---

## 10. Phase 1 gate conditions (all must be true)

- [ ] All boxes in §2–§7 ticked by both members.
- [ ] All questions in §8 answered (or explicitly deferred with a date).
- [ ] Approval table in §9 completed by both members.
- [ ] Repo bootstrapped from the official template (P0-08) and `submission.yaml` skeleton started (P0-09).
- [ ] GitHub Issues created for M1-01…SH-13 with owners and phases.

**Until these are true: no dataset generation, no feature implementation, no dependency installation beyond the repo bootstrap.**
