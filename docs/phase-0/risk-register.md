# Phase 0 — Risk Register

**Status:** DRAFT — reviewed at every phase gate
**Scale:** Probability High/Medium/Low · Impact High/Medium/Low
**Owner codes:** M1, M2, SH (shared)

---

## 1. Risk register

| ID | Risk | Category | Prob. | Impact | Mitigation | Owner | Trigger / early warning | Fallback |
|---|---|---|---|---|---|---|---|---|
| R-01 | **Scope expansion beyond MVP** — features get added because they seem easy or impressive | Delivery | Medium | High | `scope-freeze.md` is the contract; every new idea goes to the "if time permits" list; phase gates require both members to confirm no scope creep | SH | A task appears that is not in `phase-plan.md` §3 | Cut §2 enhancements; enforce cut order in `scope-freeze.md` §4 |
| R-02 | **AI coding agent (DeepSeek/OpenCode or similar) makes uncontrolled changes** — rewrites working code, deletes files, changes contracts, "improves" things unasked | Tooling | Medium | High | Only run agents inside feature branches; never grant agents credentials; review every diff before commit; agents must not touch `main`; contract files change only with explicit instruction and both members' review | SH | Diff touches files outside the requested scope; contract/schema files modified without a task | `git checkout -- <file>` / revert commit; restore from last reviewed commit; re-run tests |
| R-03 | **API mismatch between domains** — M2 calls a field M1 renamed, or frontend expects a shape the backend does not return | Integration | Medium | High | API contract frozen in `api-contract.md`; `zod` validation server-side; contract tests per endpoint; changes require joint sign-off in the same PR | SH | Frontend shows `undefined`; contract test fails; 400s on integration | Roll back to last agreed contract version; joint 15-min session to reconcile; update contract first, then code |
| R-04 | **Database schema changes mid-build** — an entity needs a field nobody planned; migrations collide | Data | Low | High | Schema frozen in `data-contract.md`; additive migrations only; both members approve any migration before merge; seed regenerated after schema change | SH | A PR adds/renames columns without a contract update | New migration forward (never edit applied migrations); regenerate seeds; re-validate |
| R-05 | **Bob hallucination** — Bob states a shipment, temperature or route that no tool returned | AI / Trust | Medium | High | Tools return structured JSON only; system prompt forbids answering beyond tool output; grounding tests (M2-10) before demo; evidence panel shows raw tool JSON beside answers | M2 | Grounding test fails; an answer contains an entity ID not present in the evidence | Disable chat panel for that demo segment; use MCP tool calls + dashboard directly; log the failing prompt as a known limitation |
| R-06 | **Missing credentials / no Bob access** — no API key, no MCP access, or Bob unavailable on demo day | External | Medium | High | `BOB_ENABLED=false` is a first-class mode; all six capabilities work without Bob; MCP tools testable without credentials; demo script has a no-Bob variant | M2 | Bob login/API fails during a rehearsal | Dashboard-only demo; show MCP tool server directly; state honestly that Bob access was unavailable |
| R-07 | **Synthetic data quality** — data looks fake, inconsistent, or lacks the required edge cases | Data | Medium | Medium | Generator emits consistent FK chains; validator checks integrity + scenario coverage + ground truth; scenario tags; fixed seed | M1, M2 | Validator failures; demo scenario missing (e.g. no reserved asset) | Patch generator, re-run validator, regenerate seeds; shrink scenario set only to `scope-freeze.md` minimums |
| R-08 | **ML work takes too long** | Delivery | Low | Low | **No ML in MVP** (ADR-006); ML is future scope only; any experiment is timeboxed to a few hours on a branch that cannot block `main` | M2 | An ML task appears on the critical path | Drop it; rule-based baseline remains the deliverable; describe ML as future work |
| R-09 | **Integration delays** — Phase 5 runs long and eats demo/QA time | Integration | Medium | High | Integration checkpoints early (mocked contracts in Phases 2–4); shared interfaces defined in Phase 0; daily syncs during Phases 3–5 | SH | Checkpoint 3 or 4 slips by more than a day | Borrow time from "if time permits"; reduce UI to 6 essential screens; fix broken link in isolation (never restart) |
| R-10 | **One member becomes blocked** — waiting on the other's API, data or review | Team | Medium | Medium | 30–45 minute rule + backup task list (`team-ownership.md` §6); mock contracts available from Phase 1; PRs reviewed within the same day | SH | A member reports idle time at a sync | Switch to backup task; document blocker; reassign by remaining hours, not strict role |
| R-11 | **Demo failure** — live bug, DB down, wrong seed state, network issue | Demo | Low | High | Rehearse twice on the demo machine; `npm run seed` reset documented; recorded backup video; no feature demoed that is not in the frozen scope | SH | Any rehearsal failure | Play the recorded video; explain the failure honestly; fall back to screenshots |
| R-12 | **Project name conflict** (ChainPulse vs ChainSentinel vs SupplyChain Sentinel) | Branding | High | Low | Decide once in Phase 0 (Q1); rename only in docs/UI, never in code identifiers after Phase 1 | SH | Name appears differently in submission files | Pick the blueprint name (ChainSentinel) by default; update all docs in one commit |
| R-13 | **Deadline unknown** — planning against a guessed timeline | Planning | Medium | Medium | Deadline-agnostic gates; confirm deadline before Phase 1 (Q4); default to the 7-day sequence | SH | Deadline not confirmed by end of Phase 0 | Compress to the 3-day sequence with minimum datasets (`scope-freeze.md` §1.3) |
| R-14 | **Windows/Docker setup friction** — Postgres container or tooling fails on a teammate's machine | Environment | Medium | Medium | Document exact versions in setup guide; test on a clean terminal (SH-09); keep Docker usage to Postgres only; document native Postgres fallback | SH | `docker compose up` fails during Phase 1 | Native PostgreSQL 16 install with the same `DATABASE_URL` shape; schema identical |
| R-15 | **Overclaiming in submission** — docs/deck imply more than the code does | Compliance | Medium | High | `requirements-matrix.md` traceability; limitations section maintained from Phase 0; every claim must point to code or evidence; rubric warns overclaiming hurts | SH | A sentence in docs cannot be traced to a feature or test | Rewrite the claim or remove it; judges reward honest limitations |

---

## 2. Risk review cadence

- **At every phase gate:** review R-01…R-15, update probability/impact, close resolved risks, add new ones.
- **At every demo rehearsal:** verify R-05, R-06, R-11 mitigations are actually in place (fallback tested, not assumed).
- **Any new risk discovered mid-phase:** added here within 24 hours with owner and fallback.

## 3. Standing rules that prevent the top risks

1. `main` is always demoable — no direct pushes, PR review required (R-02, R-11).
2. Contracts change before code, in the same PR (R-03, R-04).
3. Bob is additive; dashboard never depends on it (R-05, R-06).
4. No ML on the MVP path (R-08).
5. Scope changes require both members (R-01, R-12, R-13).
