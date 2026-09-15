# Phase 3 — Decision Record

**Project:** ChainSentinel — L2 Supply Chain Disruption Assistant & Fleet Utilisation Optimizer
**Date:** 2026-09-14
**Source:** `docs/PHASE_3_IMPLEMENTATION_PLAN.md` §17 (D1–D9)
**Basis:** team-lead directive to adopt the recommended defaults unless the team explicitly chooses otherwise
**Principle:** no frozen behaviour is changed silently — every decision that touches an API, schema, tool or response shape is written into the normative contract first (see §"Contract updates applied").

---

## Summary

| ID | Question | Final decision | Affects contract? | Approval |
|---|---|---|---|---|
| D1 | Fold MCP/Bob into Phase 3? | Yes — MCP/Bob tool layer is part of Phase 3 | No (phase mapping) | APPROVED |
| D2 | Bob transport when `BOB_ENABLED=true` | Implement 503 path now; forward path stays behind env, transport deferred to Q6 | No (3.23 unchanged) | APPROVED |
| D3 | MCP transport + SDK pin | stdio transport; pin SDK version at implementation | No (tool catalogue unchanged; noted in §8 D3) | APPROVED |
| D4 | `modified_payload` semantics | Record in audit details; status `modified`; no mutation, no execution | **Yes** (api-contract §8 D4) | APPROVED |
| D5 | Ingestion when all readings invalid | `400 VALIDATION_ERROR` with per-reading reasons | **Yes** (api-contract §8 D5) | APPROVED |
| D6 | `actor` default | Optional; defaults to `operator-1` | **Yes** (api-contract §8 D6) | APPROVED |
| D7 | Policy editor UI | API-only in Phase 3; editor folded into S8 in Phase 5 | No (UI doc note) | APPROVED |
| D8 | Missing `PHASE_2_IMPLEMENTATION_PLAN.md` | Proceed; Phase 1 design + backlogs + Phase 2 reports are the plan of record | No | APPROVED |
| D9 | Contention computation scope | Across currently affected shipments at demo scale; A-7 definition unchanged | Clarification (api-contract §8 D9) | APPROVED |

---

## Contract updates applied (before any coding)

| Document | Update |
|---|---|
| `docs/phase-0/api-contract.md` | New normative section **§8 "Phase 3 — Approved decisions"** covering D3, D4, D5, D6, D9 |
| `PHASE_1_SYSTEM_DESIGN.md` §16 | Phase mapping note for D1 (MCP/Bob folded into Phase 3) |
| `docs/phase-0/member-2-coldchain-ui.md` | New §5 note for D7 (policy editing API-only in Phase 3, editor in Phase 5) |
| `docs/PHASE_3_IMPLEMENTATION_PLAN.md` §17 | "Resolved" note pointing to this record |

---

## D1 — Fold MCP/Bob into Phase 3

| Field | Record |
|---|---|
| **Question ID** | D1 |
| **Final decision** | Approved: the MCP/Bob tool layer (11 frozen tools + Bob proxy fallback) is implemented in Phase 3 together with the REST API. |
| **Reason** | The tools are thin adapters over REST endpoints; building them after the endpoints is shortest-path. Grounding tests need live endpoints. Keeps the demo critical path short. |
| **Implementation impact** | Phase 3 now includes `src/mcp-server` (M2-3.5) and the Bob proxy 503 path (M2-3.6); ordering per plan §14/§15. No endpoint, schema or tool changes. |
| **Contract/document updated** | `PHASE_1_SYSTEM_DESIGN.md` §16 (note); this record. |
| **Approval status** | APPROVED (recommended default adopted; countersign at next sync). |

## D2 — Bob transport when `BOB_ENABLED=true`

| Field | Record |
|---|---|
| **Question ID** | D2 |
| **Final decision** | Implement the `503 BOB_UNAVAILABLE` path now (Bob disabled by default). The enabled forwarding path remains behind `BOB_ENABLED`; the concrete transport (REST gateway vs MCP vs SDK) is chosen when Bob access is confirmed (Q6). |
| **Reason** | No credentials or transport are confirmed; the contract already defines the disabled behaviour and the enabled response shape. Nothing should block on Q6, and the dashboard-first resilience requirement is preserved. |
| **Implementation impact** | `src/backend/src/bob/` proxy: disabled → 503; enabled → guarded forward using `BOB_API_URL`/`BOB_API_KEY` from env only. MCP tools remain directly testable without Bob; live Bob tests are conditional and documented as a limitation if unavailable. |
| **Contract/document updated** | None required — `api-contract.md` 3.23 remains normative and unchanged. |
| **Approval status** | APPROVED (default adopted). Transport selection deferred to Q6 — does not block Phase 3. |

## D3 — MCP transport and SDK version pin

| Field | Record |
|---|---|
| **Question ID** | D3 |
| **Final decision** | MCP transport is **stdio**; the `@modelcontextprotocol/sdk` version is pinned to an exact version at implementation time (replacing the `^1.0.0` placeholder) and recorded in `package-lock.json`. |
| **Reason** | stdio is the standard local integration path for an agent host, avoids network exposure, and keeps the adapter credential-free. An exact pin keeps builds reproducible. |
| **Implementation impact** | `src/mcp-server/package.json` version pin at implementation; adapter calls REST via `BACKEND_URL` (default `http://localhost:3001`). Tool catalogue and schemas unchanged. |
| **Contract/document updated** | `api-contract.md` §8 D3 note (tool catalogue unchanged); `src/mcp-server/README.md` to state stdio at implementation. |
| **Approval status** | APPROVED (default adopted). |

## D4 — `modified_payload` semantics

| Field | Record |
|---|---|
| **Question ID** | D4 |
| **Final decision** | For `decision = "modified"`: the payload is stored verbatim in the audit record `details`; the recommendation target, score and factors are not mutated; nothing is executed; status becomes `modified`; `notes` is stored on the recommendation. |
| **Reason** | Preserves the human-in-the-loop guarantee (no hidden re-computation or execution) and keeps the audit trail authoritative. |
| **Implementation impact** | Endpoint 21 handler: write `details.modified_payload` + `details.decision`; single status transition; tests cover payload capture and non-mutation. |
| **Contract/document updated** | **`api-contract.md` §8 D4 (normative).** |
| **Approval status** | APPROVED (default adopted). |

## D5 — Ingestion when no reading is valid

| Field | Record |
|---|---|
| **Question ID** | D5 |
| **Final decision** | If every reading in the batch is invalid → `400 VALIDATION_ERROR` with `details.rejected` listing per-reading reasons. If at least one reading is valid → success with invalid readings in `rejected[]` (unchanged). |
| **Reason** | An all-invalid batch is a client error, not a silent no-op; the partial-success path already exists and stays as-is. |
| **Implementation impact** | Endpoint 12 handler: validation split + error envelope on all-invalid; tests cover all-invalid, partial and all-valid batches. |
| **Contract/document updated** | **`api-contract.md` §8 D5 (normative).** |
| **Approval status** | APPROVED (default adopted). |

## D6 — `actor` default

| Field | Record |
|---|---|
| **Question ID** | D6 |
| **Final decision** | `actor` is optional on decision/review/policy inputs and defaults to `operator-1` (contract §1). Explicit values are stored verbatim. |
| **Reason** | The contract already specifies the default; the Phase 2 zod schemas required the field, so this aligns implementation with the frozen convention rather than changing it. |
| **Implementation impact** | Update `decisionInputSchema`, `excursionStatusInputSchema`, `policyUpdateInputSchema`: `actor` optional with default `"operator-1"`; audit records store the resolved value. |
| **Contract/document updated** | **`api-contract.md` §8 D6 (normative clarification).** |
| **Approval status** | APPROVED (default adopted). |

## D7 — Policy editor UI

| Field | Record |
|---|---|
| **Question ID** | D7 |
| **Final decision** | Temperature-policy configuration is **API-only in Phase 3** (endpoints 16/17). A small policy editor is folded into the cold-chain screen (S8) in Phase 5. |
| **Reason** | Phase 3 builds no UI; R6 "configurable policies" is satisfied by the versioned API. Adding a screen now would expand scope without demo value. |
| **Implementation impact** | Phase 5 screen task; until then, policy values are displayed read-only with the "illustrative, configurable" note. |
| **Contract/document updated** | `member-2-coldchain-ui.md` §5 (note). |
| **Approval status** | APPROVED (default adopted). |

## D8 — Missing `PHASE_2_IMPLEMENTATION_PLAN.md`

| Field | Record |
|---|---|
| **Question ID** | D8 |
| **Final decision** | Proceed without a retrospective file. The executed Phase 2 plan of record is `PHASE_1_SYSTEM_DESIGN.md` §16 + `phase-plan.md` + both member backlogs, with results documented in the two Phase 2 reports and the final review. |
| **Reason** | Phase 2 is complete and independently verified (`APPROVED_FOR_PHASE_3`); creating a retrospective artifact adds no engineering value now. |
| **Implementation impact** | None. The finding remains recorded as F1 in `docs/PHASE_2_FINAL_REVIEW.md`. |
| **Contract/document updated** | This record. |
| **Approval status** | APPROVED (default adopted). |

## D9 — Contention computation scope

| Field | Record |
|---|---|
| **Question ID** | D9 |
| **Final decision** | `contention_count` (endpoint 11) is computed across **currently affected shipments** (matching result) at demo scale. The A-7 definition is unchanged. |
| **Reason** | Matches the frozen A-7 amendment exactly; the dataset (≤48 shipments) makes full computation cheap and complete. |
| **Implementation impact** | Endpoint 11 handler composes matching + redeployment results; no response-shape change. If Phase 6 shows slowness, a configured top-N window may be used without changing the shape. |
| **Contract/document updated** | `api-contract.md` §8 D9 (clarification). |
| **Approval status** | APPROVED (default adopted). |

---

## Confirmation

- All nine decisions have a final disposition; none remains open.
- Three decisions required normative contract updates (D4, D5, D6) and were written into `api-contract.md` §8 **before** implementation; D3/D9 are recorded there as clarifications; D1/D7/D8 update planning/UI documents only.
- No frozen rule, formula, tool, endpoint or schema was changed silently.
- Implementation may proceed per `docs/PHASE_3_IMPLEMENTATION_PLAN.md` §15 ordering.

PHASE_3_DECISIONS_RECORDED
