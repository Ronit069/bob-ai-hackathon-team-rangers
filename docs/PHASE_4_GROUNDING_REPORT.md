# Phase 4 — Grounding Validation Report

**Project:** ChainSentinel — L2 Supply Chain Disruption Assistant & Fleet Utilisation Optimizer
**Date:** 2026-09-15
**Task:** P4-R1 (grounding validation closure) · Decision D2 / open question Q6
**Scope:** verify that the Bob grounding design is enforced at the tool layer, and record the live-Bob half honestly as conditional.

---

## 1. What "grounding" means here

Bob may only state facts that came from a backend tool call. Enforcement has three layers:

| Layer | Enforcement | Status |
|---|---|---|
| Tool layer (code) | 11 read-only tools; strict input validation; JSON passthrough (no business logic); structured errors; no database access; no credentials | **Verified in this report** |
| Prompt layer (configuration) | The 10 grounding rules in `src/backend/src/bob/prompt.js`, attached to every forwarded Bob query | **Verified present; behaviour requires live Bob** |
| Evidence layer (UI) | Raw tool JSON shown beside answers | Phase 5 (evidence panel) |

---

## 2. The 10 grounding rules and their enforcement

| # | Rule | Enforcement point | Evidence |
|---|---|---|---|
| 1 | Answer only from tool JSON | `prompt.js` rule 1; tools return the REST JSON unchanged | Stub-Bob test asserts the rules are attached to every forwarded query |
| 2 | Empty result → "no data returned", never "all clear" | `prompt.js` rule 2; tools return empty arrays with `ok: true` (never fabricated rows) | `get_redeployment_candidates(S017)` returns `data: []`; `get_risk_overview` empty case; tests assert empty is a valid success |
| 3 | Tool error → report explicitly | `prompt.js` rule 3; errors returned as `{ ok: false, error, http_status }` (never thrown) | MCP tests: 404 `NOT_FOUND`, `VALIDATION_ERROR`, `BACKEND_UNREACHABLE`; stdio test asserts `isError: true` |
| 4 | Never compute scores | `prompt.js` rule 4; scores come only from services | Tool `get_combined_risk(S039)` returns exactly the REST/ground-truth value (0.856/0.6/0.728) — no tool-side arithmetic |
| 5 | Never invent entities | `prompt.js` rule 5; tools are pure REST passthrough | E2E equality test: MCP affected list, excursions and risk factors are byte-equal to REST responses |
| 6 | No regulatory/accuracy claims | `prompt.js` rule 6; policy values are configurable placeholders | Policy endpoints return illustrative values; no claim code exists |
| 7 | Ambiguous question → ask for the id | `prompt.js` rule 7 | Prompt-level (live validation pending) |
| 8 | Unsupported question → say so | `prompt.js` rule 8 | Prompt-level (live validation pending) |
| 9 | Evidence always attached | `prompt.js` rule 9; every tool result carries `tool` + raw payload | Tool results include `tool` name and the unchanged endpoint JSON |
| 10 | Never change state | `prompt.js` rule 10; tools are GET-only | Read-only proof test: recommendation/audit/excursion/reading row counts unchanged after calling all 11 tools; zero decided recommendations |

---

## 3. Tool-layer grounding evidence (executed)

| Test file | Tests | What it proves |
|---|---|---|
| `test/mcp-tools.test.js` | 7 | Exactly 11 frozen tools; all return structured backend output; strict input validation; structured errors (`VALIDATION_ERROR`, `UNKNOWN_TOOL`, `NOT_FOUND`, `BACKEND_UNREACHABLE`); ground-truth oracle equality; read-only row-count snapshot; multi-tool Bob flow |
| `test/mcp-server.test.js` | 4 | Spawned stdio server: handshake, `tools/list` = 11, `tools/call` reaches the backend, oracle equality, boundary validation error (`-32602`), backend error passthrough (`isError`) |
| `test/e2e-flow.test.js` | 4 | MCP output equals REST output for risk factors, affected lists and excursions; Bob 503 fallback with the dashboard fully functional |
| `test/bob-proxy.test.js` (new, P4-R3) | 6 | Enabled proxy forwards `prompt` + the 10 grounding rules + bearer auth; maps stub responses to `{answer, evidence, tool_calls}`; maps stub failure/unreachable to `503 BOB_UNAVAILABLE`; never returns or forwards the API key in payloads; 503 fallback intact when disabled |

**Isolation properties verified:** `src/mcp-server` has no database dependency (no `pg` import, no DB package); `src/backend/src/bob/*` imports no database module; tools call REST only; the API key is read from the environment and used only in the outbound `Authorization` header.

---

## 4. Live-Bob validation — CONDITIONAL

| Item | Status |
|---|---|
| Bob access method / credentials (Q6) | **Not available** — no credentials exist and none were invented |
| Live grounding tests (CT-17 live half: run the example questions and verify every entity id in the answer appears in the evidence JSON) | **NOT RUN — CONDITIONAL, blocked on Q6** |
| Claim of a working live Bob integration | **None is made** |
| Fallback if Bob remains unavailable | MCP tool layer + dashboard demo (all six capabilities); grounding is demonstrated through tool calls and evidence JSON; the chat panel shows the documented fallback |
| When access is granted | Re-run the 11 example questions from `member-2-bob-integration.md` §4 against the live Bob; assert answer/evidence consistency; record results in this report |

**Honest limitation:** the prompt rules are configuration, not code-enforced behaviour. The tool layer guarantees that *only real data can be returned*; the live half (that Bob actually phrases answers strictly from that data) can only be proven with a live Bob.

---

## 5. Verdict

| Gate item | Result |
|---|---|
| Tool-layer grounding tests pass | **PASS** (21 tests across 4 files) |
| Read-only guarantee | **PASS** (row-count proof; GET-only code) |
| Bob isolated from PostgreSQL | **PASS** (no DB dependency/import) |
| Grounding rules attached to forwarded queries | **PASS** (stub-Bob test) |
| 503 fallback intact | **PASS** (disabled, failure and unreachable cases) |
| Live-Bob grounding | **CONDITIONAL — blocked on Q6**, with documented fallback; no claim made |

**Grounding validation closure: COMPLETE for the tool layer; live half explicitly deferred.**
