# Phase 3 — REST API Implementation Report (Person 1 Scope)

**Project:** ChainSentinel — L2 Supply Chain Disruption Assistant & Fleet Utilisation Optimizer
**Date:** 2026-09-14
**Scope:** shared REST infrastructure · endpoints 2–11 · endpoints 24–27 · repository extensions · API tests
**Rules honoured:** frozen contracts only (no new endpoints, no formula rewrites, no ML, no UI, no secrets exposed, Bob does not touch the database).

---

## 1. Endpoints implemented

| # | Method + Path | Status | Service used | Notes |
|---|---|---|---|---|
| 2 | GET `/api/disruptions` | Implemented | `isDisruptionActive` | Adds computed `is_currently_active`; filters status/region/limit |
| 3 | POST `/api/disruptions` | Implemented | validation + audit | Generated `D##` id; 409 on duplicate active region+window; audit `created`/`activated` |
| 4 | PATCH `/api/disruptions/:id` | Implemented | transition guard + audit | `scheduled→active`, `active→resolved`; 409 otherwise; audit `activated`/`deactivated` |
| 5 | GET `/api/disruptions/:id/affected-shipments` | Implemented | `matchShipments` (R1) | A-2 fields incl. `impact_status`, `matched_disruptions`, `timing_basis`, `confidence` |
| 6 | GET `/api/shipments` | Implemented | matching + repo filters | `status`, `is_cold_chain`, `region_code`, `disruption_id` (reuses matching), `limit` |
| 7 | GET `/api/shipments/:id` | Implemented | repo + `routeCapacity` | Embeds route, carrier, segments, current/next segment, `route_capacity` |
| 8 | GET `/api/shipments/:id/route-alternatives` | Implemented | `routeAlternatives` (R2) | A-9 `reasons[]`, `not_actionable`; rejected list; no-option `200` |
| 9 | GET `/api/shipments/:id/carrier-alternatives` | Implemented | `carrierAlternatives` (R2) | Backing route + reliability + reasons |
| 10 | GET `/api/fleet/idle` | Implemented | `idleAssets` (R3/A-7) | `excluded[]` with reasons; region/min-idle filters |
| 11 | GET `/api/shipments/:id/redeployment-candidates` | Implemented | `redeploymentCandidates` + `computeContention` | Contention across affected shipments; rejected/excluded lists; reasons |
| 24 | POST `/api/recommendations` | Implemented | alternatives/redeployment recompute + repo | Server-side recompute (client scores ignored); 409 duplicate/ineligible; audit `created` |
| 25 | POST `/api/fleet/redeployments/recommend` | Implemented | `redeploymentCandidates` re-validation | Asset re-validated at creation; 409 no longer eligible; audit `created` |
| 26 | GET `/api/fleet` | Implemented | `deriveOperationalState` + `detectAssetAnomalies` | Derived states, idle minutes, next assignment, anomaly flags |
| 27 | GET `/api/carriers` | Implemented | repo list | status/region/mode filters |

**Out of scope (return `501 NOT_IMPLEMENTED` until the M2/shared batch):** 12–17, 18–23, 28.
**Already implemented:** 1 (`/api/health`, Phase 2A).

---

## 2. Shared infrastructure delivered

| Item | File | Purpose |
|---|---|---|
| App factory | `src/backend/src/app.js` | `createApp({ db })` — injectable pool, route mounting, 501 catch-all, error middleware |
| HTTP helpers | `src/backend/src/common/http.js` | `asyncHandler`, `sendList`, `notImplementedHandler`, `errorHandler` |
| Query schemas | `src/backend/src/common/validation.js` | Strict zod schemas for every query string + write bodies (24/25) |
| Request validation | `validation.js` `parse()` | 400 envelope with field issues; unknown fields rejected |
| Response helpers | `sendList` | `{data,count}` convention |
| Error mapping | `errors.js` + `http.js` | AppError → envelope; PG codes mapped in repos; malformed JSON → 400; unexpected → 500 |
| Test DB setup | `src/test-support/helpers.js` | `setupTestDb` (create + migrate), `resetTables`, `seedTestDatabase` |
| Reusable fixture loading | `scripts/seed.js` exports | `loadFixtures`, `seedIdSequences`, `resetAndLoad` (shared with the seed CLI) |
| API test helpers | `src/test-support/api.js` | `startTestServer(db)` (ephemeral port), `api()` fetch wrapper |
| D6 actor defaults | `validation.js` | `actor`/`updated_by` optional, default `operator-1` (decision D6) |

---

## 3. Repository extensions delivered

| # | Extension | Location | Notes |
|---|---|---|---|
| 1 | `updateDisruption` | `logistics/repository.js` | Partial update; PG errors mapped |
| 2 | Shipment filter by `disruption_id` | endpoint 6 handler | **Deliberate design:** reuses `matchShipments` instead of a second SQL region filter, so endpoints 5 and 6 can never diverge (single source of truth for R1) |
| 3 | Shipment filter by `region_code` | `listShipments` | `EXISTS` over `current_segment_id` region |
| 4 | Batch sensor-reading insert | `coldchain/repository.js` | Multi-row `VALUES` in chunks of 200 (used by endpoint 12 in the M2 batch) |
| 5 | Latest-reading query | `coldchain/repository.js` | `DISTINCT ON (shipment_id)` for alerts/sensor health |
| 6 | Anomaly helper | `fleet.service.js` `detectAssetAnomalies` | `missing_availability_timestamp`, `stale_assignment`, `conflicting_assignments` (A-7 rules, surfaced never resolved) |
| 7 | Recommendation repository | `audit/recommendation.repository.js` | insert / get / list / single-transition decision / pending-duplicate guard |

---

## 4. Files changed

**New:** `src/app.js` · `src/common/http.js` · `src/audit/recommendation.repository.js` · `src/logistics/routes.js` · `src/logistics/explanations.js` · `src/test-support/api.js` · `test/api-logistics.test.js` · `test/api-recommendations.test.js`

**Modified:** `src/server.js` (thin listener over the app factory) · `src/common/validation.js` (query/write schemas + D6 defaults) · `src/logistics/repository.js` (updateDisruption, region filter) · `src/coldchain/repository.js` (batch + latest readings) · `src/logistics/fleet.service.js` (anomalies) · `src/logistics/matching.service.js` (`includeDelivered` option) · `src/audit/repository.js` + `src/risk/repository.js` (explicit jsonb stringify) · `scripts/seed.js` (exports + id-sequence seeding) · `src/test-support/helpers.js` (fixture seeding) · `src/data-generator/chainsentinel/logistics.py` + `groundtruth.py` (fixture windows + SCN-021 mapping) · `data/seed/*.json` (regenerated)

**No changes to:** frozen formulas, contracts, migrations, or the ground-truth calculation rules.

---

## 5. Tests run and results

| Suite | Command | Result |
|---|---|---|
| Backend (existing + new) | `npm test` | **94/94 pass** (0 fail) |
| — existing Phase 2 suites | | 64/64 (connection 5, validation 13, inserts 17, services 29) |
| — new API tests | | **30/30** (`api-logistics` 22, `api-recommendations` 8) |
| Python generator | `python -m unittest discover` | 48/48 pass |
| Contract validation | `python validate.py` | PASS (48 scenarios, 15 matching, 14 excursions) |
| Cross-language | `node scripts/verify-seed.js` | matching 15/15 · excursions 14/14 |
| Live smoke (seeded dev DB) | manual | health `ok`; 3 active disruptions; D01 → 10 affected (S001 critical); S040 → R006; 16 idle / 8 excluded; 1 maintenance |

**API test coverage:** success paths · validation errors (400) · invalid ids (404) · conflicts (409) · duplicates · ineligible targets · empty results (`200` + `[]`) · malformed JSON · database failure (500 envelope) · placeholder (501) · ground-truth comparisons for alternatives (S004/S006/S040) and redeployment (S015/S017/S009 contention).

---

## 6. Contract deviations (recorded, not silent)

| # | Deviation | Rationale |
|---|---|---|
| 1 | Endpoint 5 `include_delivered=true` uses an additive `includeDelivered` option in `matchShipments` (delivered shipments become candidates). Default `false` keeps the frozen rule; all ground-truth comparisons unchanged | Contract lists the flag but not its semantics |
| 2 | Endpoint 24: target exists but is not currently feasible → `409 CONFLICT` (`reason: target_not_eligible`); target does not exist → `404`. Non-actionable shipment → `409 shipment_not_actionable` | Contract specifies 404 for missing targets and 409 for duplicates; infeasibility/non-actionable needed a consistent disposition |
| 3 | `reasons[]` (A-9) is rendered by backend templates from the frozen factor values (`logistics/explanations.js`) | A-9 requires the additive field; no score logic added |
| 4 | Unimplemented endpoints (12–23, 28) return `501 NOT_IMPLEMENTED` | Temporary placeholder until the M2/shared batch; documented in `app.js` |
| 5 | Endpoint 6 `disruption_id` reuses the matching service rather than a separate SQL filter | Prevents divergent R1 results between endpoints 5 and 6 |

---

## 7. Issues found and fixed during implementation

1. **JSONB array serialization bug (real defect):** `node-postgres` encodes JS arrays as Postgres array literals, which is invalid for `jsonb`. `insertRecommendation` failed with a 500 until `factors`/`constraints_checked`/`rejected_alternatives` (and audit `details`, risk `factors`) were explicitly `JSON.stringify`-ed.
2. **Fixture windows expired hours after the frozen anchor:** scenario assignments used short future windows relative to `--now`, so reservations/active assignments lapsed by the time tests/demos ran later the same day. Windows were lengthened (`+12…+60 h`) and fixtures regenerated; ground truth unchanged in meaning.
3. **SCN-021 contention mapping corrected:** S018/S019 are not affected by any active disruption, so they cannot contend. The fixture description and ground-truth mapping now reference the real case (S009 and S047 both ranking A005 in their top 3).
4. **Endpoint 5 empty-result expectation corrected:** a disruption in a region with no segments still surfaces S010 (route data missing → `unknown_review` by the frozen design); the test now asserts exactly that instead of an empty list.

---

## 8. Known issues

| # | Item | Status |
|---|---|---|
| 1 | Endpoints 12–23, 28 not implemented (M2/shared batch) → 501 | Expected; plan §14/§15 |
| 2 | Recommendation list/decision endpoints (20/21) not exposed yet; the repository is ready | Shared batch |
| 3 | `estimated_eta` uses wall-clock `now`, so tests assert its presence, not its value | Documented |
| 4 | Idle/contention values depend on wall-clock now vs the fixture anchor; windows lengthened for demo-day robustness, but fixtures should be regenerated (`python generate.py`) if the demo is on a later date | Documented |
| 5 | Unknown `/api/*` paths also return 501 (catch-all) until all routers are mounted | Temporary |
| 6 | No authentication (single trusted operator) | Documented limitation (contract §1) |

---

## 9. Readiness status

**Person 1 Phase 3 scope: COMPLETE.**

- 14 endpoints implemented exactly per the frozen contract, with 30 new API tests; the full backend suite is 94/94 green, Python 48/48, cross-language verification still 15/15 and 14/14.
- Shared infrastructure, repository extensions and the recommendation repository are in place for the M2/shared batch (endpoints 12–23, 28) to build on.
- No formula, contract or ground-truth change; no ML; no secrets; no UI.

**Next:** M2/shared endpoints (12–17, 18–23, 28) + MCP tool server, then the E2E flow test and `PHASE_3_API_REPORT` consolidation.

---

## Historical Note — Test-Count Clarification (Phase 7 documentation pass, F7)

The test count reported in §5 above ("94/94 pass") reflects the **Phase 3A milestone only** — the scope covered by this report: Member 1's logistics endpoints (2–11, 24–27) built on the existing Phase 2 suite (64 tests + 30 new = 94 tests). This report was written before the Phase 3B batch (Member 2's cold-chain + shared + MCP endpoints and tests) was completed.

The consolidated **final Phase 3 count was 138/138** (verified in `docs/PHASE_3_FINAL_REVIEW.md` §2), composed of:
- Phase 2 suites: 64 tests (connection, validation, inserts, services)
- Phase 3A new API tests: 30 tests (logistics + recommendations)
- Phase 3B new tests: 44 tests (cold-chain 19, shared 10, MCP tools 7, MCP stdio server 4, E2E 4)

After Phase 4 (stub-Bob proxy: +6 tests) and Phase 6 (write-throttle + reseed regression: +3 tests), the current baseline is **147/147** (as verified in `docs/PHASE_6_INTEGRATION_REPORT.md` §10).

The authoritative Phase 3 completion evidence is `docs/PHASE_3_FINAL_REVIEW.md`. This report remains as the Phase 3A scope record.
