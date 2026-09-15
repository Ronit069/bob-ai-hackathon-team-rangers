# Phase 2A — Database and Backend Foundation Report

**Project:** ChainSentinel — L2 Supply Chain Disruption Assistant & Fleet Utilisation Optimizer
**Date:** 2026-09-14
**Scope:** PostgreSQL 16 (Docker), migrations, repositories, deterministic services, zod validation, tests
**Constraints honoured:** no Bob integration, no ML, no unsupported features, credentials only in environment variables, no secrets in the frontend, original reference documents untouched.

---

## 1. Environment and setup

| Item | Value |
|---|---|
| Node.js | v22.18.0 · npm 10.9.3 |
| Docker | 29.5.3 · Compose v5.1.4 · image `postgres:16-alpine` |
| Container | `chainsentinel-db`, status **healthy** |
| Host port | **5433** (a local PostgreSQL 18 service already occupies 5432 on this machine — documented in `src/.env.example`) |
| Database / user | `chain_sentinel` / `bobathon` (dev), `chain_sentinel_test` (tests) |
| Backend dependencies | `express@^4.19.2`, `pg@^8.12.0`, `zod@^3.23.8` (83 packages, 0 vulnerabilities) |
| Credentials | `.env` only (git-ignored); defaults in `config.js`; frontend has no credentials and no env file |

Commands:

```bash
docker compose up -d                 # start PostgreSQL 16
cd src/backend && npm install        # install backend dependencies
npm run migrate                      # apply migrations (dev database)
npm test                             # run the test suite (test database)
npm run dev                          # start the API (health only until Phase 3)
```

---

## 2. Files created

### Root
| File | Purpose |
|---|---|
| `docker-compose.yml` | PostgreSQL 16 service, healthcheck, named volume, port 5433 |

### Backend — common (`src/backend/src/common/`)
| File | Purpose |
|---|---|
| `config.js` | Environment loading (no dotenv dependency), typed config with defaults |
| `db.js` | `pg` Pool, `query`, `withTransaction`, `ping`, `closePool`; numeric → JS number |
| `errors.js` | `AppError` + standard error codes (`VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT`, …) and `fromPgError` mapping (23503/23505/23514/23502) |
| `ids.js` | Runtime prefixed ID generation via `id_sequence` (S/R/SEG-/C/D/A/AA-/SR-/EX-/REC-/RSK-/AUD-) |
| `validation.js` | All zod schemas, vocabularies, input refinements, `parse()` helper |

### Backend — migrations (`src/backend/migrations/`)
`001_sequences.sql` · `002_logistics.sql` · `003_coldchain.sql` · `004_shared.sql` · `005_indexes.sql`

### Backend — scripts
`scripts/migrate.js` — ordered, transactional, idempotent migration runner (CLI + exported `runMigrations` for tests)

### Backend — repositories
| File | Entities |
|---|---|
| `src/logistics/repository.js` | carrier, route, route_segment, shipment, disruption, fleet_asset, asset_assignment |
| `src/coldchain/repository.js` | cargo_profile, temperature_policy, sensor_reading, temperature_excursion |
| `src/risk/repository.js` | risk_assessment |
| `src/audit/repository.js` | audit_record (append-only: no update/delete functions exist) |

### Backend — services (deterministic)
| File | Functions |
|---|---|
| `src/logistics/matching.service.js` | `isDisruptionActive`, `plannedWindow`, `relativePosition`, `classifyMatch`, `impactScores`, `matchShipments` |
| `src/logistics/alternatives.service.js` | `routeAlternatives`, `carrierAlternatives`, `routeCapacity`, `residualRisk`, `normalize` |
| `src/logistics/fleet.service.js` | `haversineKm`, `deriveOperationalState`, `idleAssets`, `redeploymentCandidates`, `computeContention` |
| `src/coldchain/excursion.service.js` | `normalizeReadings`, `computeQuality`, `sensorStatus`, `classifySeverity`, `detectExcursions` |
| `src/risk/risk.service.js` | `coldchainRisk`, `combinedScore` |

### Backend — tests and support
| File | Tests |
|---|---|
| `src/test-support/helpers.js` | test-DB creation, migrations, truncation, pg-error assertion helper |
| `test/connection.test.js` | 5 |
| `test/validation.test.js` | 13 |
| `test/inserts.test.js` | 17 |
| `test/services.test.js` | 28 |

### Modified
| File | Change |
|---|---|
| `src/backend/src/server.js` | `/api/health` now pings the database; other `/api/*` return `501` until Phase 3 |
| `src/backend/package.json` | test script (`node --test --test-concurrency=1`) |
| `src/.env.example` | port 5433, `TEST_DATABASE_URL`, excursion/sensor config |

---

## 3. Migrations

| # | File | Contents |
|---|---|---|
| 001 | `001_sequences.sql` | `id_sequence` (runtime ID counters) |
| 002 | `002_logistics.sql` | carrier → route → route_segment → shipment → disruption → fleet_asset → asset_assignment |
| 003 | `003_coldchain.sql` | cargo_profile (B-1) → temperature_policy → sensor_reading → temperature_excursion (incl. `implausible` data_quality, `post_delivery`) |
| 004 | `004_shared.sql` | recommendation → risk_assessment → audit_record |
| 005 | `005_indexes.sql` | 14 indexes (FK and hot-path lookups) |

- Applied in filename order inside transactions; recorded in `schema_migrations` (5 rows).
- Re-run result: **"No pending migrations"** (idempotent).
- Schema matches `data-contract.md` including Phase 1A amendments A-3 (planned/actual times), B-1 (cargo profile), B-6 (`implausible`), B-5 (`post_delivery`).

---

## 4. Tables implemented (15 + `schema_migrations`)

| Table | PK format | Notable constraints |
|---|---|---|
| `carrier` | `C##` | region/mode vocabulary arrays, reliability 0–1, cost_index 0.5–2.0 |
| `route` | `R###` | carrier FK, nodes differ |
| `route_segment` | `SEG-###` | region vocabulary, `UNIQUE(route_id, seq)`, `UNIQUE(id, route_id)` (for composite FK) |
| `shipment` | `S###` | A-3 planned/actual times; planned window coherent; delivered ⇒ `actual_arrival`; **composite FK** `(current_segment_id, route_id) → route_segment(id, route_id)` |
| `disruption` | `D##` | severity 1–5, window coherence, region vocabulary |
| `fleet_asset` | `A###` | coordinate ranges, status enum; `available_since` intentionally nullable (defect fixture LT-22) |
| `asset_assignment` | `AA-####` | window coherence; **overlaps intentionally allowed** (conflict fixture LT-23) |
| `cargo_profile` | `cargo_type` | sensitivity 0–1 |
| `temperature_policy` | `TP-*` | ordered thresholds, `UNIQUE(cargo_type, version)` |
| `sensor_reading` | `SR-######` | humidity 0–100; temperature range deliberately **not** constrained (implausible values are stored + flagged) |
| `temperature_excursion` | `EX-####` | severity/data_quality/status enums, window coherence |
| `recommendation` | `REC-####` | **target coherence per type** (exactly one of route/carrier/asset) |
| `risk_assessment` | `RSK-####` | sub-scores 0–1 |
| `audit_record` | `AUD-######` | entity/action enums, append-only by code |
| `id_sequence` | — | prefix counters for runtime IDs |

**Indexes:** `route_carrier_idx`, `route_od_idx`, `route_segment_route_idx`, `shipment_route_idx`, `shipment_status_idx`, `shipment_current_segment_idx`, `disruption_region_status_idx`, `fleet_asset_status_idx`, `asset_assignment_asset_end_idx`, `asset_assignment_shipment_idx`, `temperature_policy_cargo_idx`, `sensor_reading_shipment_ts_idx`, `sensor_reading_sensor_ts_idx`, `excursion_shipment_status_idx`, `excursion_severity_idx`, `recommendation_shipment_status_idx`, `risk_assessment_shipment_idx`, `audit_entity_idx`.

---

## 5. Services implemented (deterministic, no ML, no Bob)

| Service | Frozen rule source | Behaviour |
|---|---|---|
| Matching | scope-freeze §1.2 + A-1/A-2 | Region match + active window + position (ON/BEFORE/PAST) + planned windows; statuses `critical/blocked/delayed/at_risk/unknown_review`; unaffected excluded; worst-of-multiple aggregation; impact score `0.4·value + 0.4·urgency + 0.2·cold` |
| Alternatives | scope-freeze §1.2 + A-4/A-8 | H1–H8 hard filters, min–max normalisation (0.5 when flat), score `w1..w4`, rejected reason codes, no-option result, carrier best-route grouping |
| Fleet | scope-freeze §1.2 + A-7 | Derived states, idle from `available_since`, future-commitment blocking, haversine radius, score `0.45·proximity + 0.35·idle + 0.20·fit`, contention counts |
| Excursions | scope-freeze §1.2 + B-3/B-6 | Dedupe, reorder, gaps (>30 min), failures (≥60 min), implausible (−40..60), grouping, duration/peak, recovery, post-delivery, review flags |
| Severity | scope-freeze §1.2 + B-8 | Reordered ladder; `critical_duration` branch effective; unknown data → `unknown_review` |
| Risk | scope-freeze §1.2 + member-2-combined-risk | Severity weights (0/0.3/0.6/1.0/0.5), worst open excursion, review flags 0.5, combined `α·disruption + β·coldchain` |

---

## 6. Validation rules

**zod (API boundary, strict — unknown fields rejected):**
- ID patterns per entity; controlled vocabularies (regions, cargo types, modes, statuses, severities, data quality, audit actions).
- ISO-8601-UTC-only timestamps; planned/actual window coherence; delivered ⇒ `actual_arrival`.
- Ranges: capacity > 0, values ≥ 0, scores 0–1, coordinates, humidity 0–100, severity 1–5.
- Policy ordering (`min < max`, `minor < major`, tolerance < critical duration).
- Recommendation target coherence per type; decision `modified` requires payload.
- Sensor ingestion rejects future timestamps; risk factors must use the nested RC-3 structure.

**Database (second layer, tested directly):**
- NOT NULL, CHECK (enums/ranges/windows), UNIQUE (`route_id, seq`; `cargo_type, version`), FKs incl. the composite shipment↔segment FK, recommendation target coherence.
- Deliberate leniency (documented): no `available_since` NOT NULL, no overlap exclusion on assignments, no temperature range constraint, no combined-score arithmetic check in SQL.

---

## 7. Tests executed

```
npm test   →   node --test --test-concurrency=1
```

| File | Focus | Tests |
|---|---|---|
| `connection.test.js` | DB connectivity, migration record, tables, indexes, ID sequence | 5 |
| `validation.test.js` | required fields, enums, strict rejection, windows, ranges, vocabulary, policy ordering, future timestamps, decision payload, recommendation coherence, nested factors | 13 |
| `inserts.test.js` | valid repository round-trips (logistics, fleet+assignment, cold-chain, risk+audit); FK failures (route/carrier, shipment/route, reading/shipment, composite segment-route); unique violation; check violations (status, capacity, delivered, assignment window, recommendation target, policy order, excursion window); not-null | 17 |
| `services.test.js` | matching (9), alternatives (3), fleet (4), excursion/severity (10), risk (2) | 28 |
| **Total** | | **63** |

Smoke tests:
- `GET /api/health` → `200 {"status":"ok","database":"up","bob":"disabled"}`
- `GET /api/shipments` (not yet implemented) → `501` standard envelope
- Server starts with no stderr output.

---

## 8. Test results

```
# tests 63
# pass 63
# fail 0
# duration ~9 s
```

All 63 tests pass against the dedicated test database (`chain_sentinel_test`), created and migrated automatically by the test helper.

**Issues found and fixed during implementation:**

1. **Port conflict:** local PostgreSQL 18 occupies 5432 → Docker PG16 mapped to **5433**; documented in `.env.example` and the report.
2. **Docker engine stopped:** started Docker Desktop; container healthy.
3. **Test discovery:** `test/helpers.js` was executed as an empty test file → moved to `src/test-support/helpers.js` (63 real tests, no phantom file test).
4. **B-3 grouping vs missing-data rule:** with a 30-minute grouping threshold, breaches separated by a data gap would always split, making `data_quality = missing_readings` unreachable. Fixed by merging breaches across **unobserved data gaps** (no readings between) while still splitting when observed in-range readings separate them by more than 30 minutes — consistent with the approved design intent ("missing data is not safe") and covered by tests.

---

## 9. Known issues and limitations

| # | Item | Status / impact |
|---|---|---|
| 1 | REST product endpoints not implemented (only `/api/health`) | Planned Phase 3; `501` until then |
| 2 | Bob integration not started | By instruction; `BOB_ENABLED=false` |
| 3 | No seed data yet | Phase 2 data generation (generators + loader); tests use self-contained fixtures |
| 4 | `available_since` nullable by design | Deliberate defect fixture; service flags `missing_availability_timestamp` |
| 5 | Overlapping assignments allowed | Deliberate conflict fixture; service flags, never resolves |
| 6 | Combined-score arithmetic not enforced in SQL | Weights are configurable; enforced in service tests |
| 7 | Deadline check compares to `created_at` | Fixtures must supply coherent timestamps (tested) |
| 8 | Local-only deployment | `NOT DEPLOYED`; no cloud infrastructure |
| 9 | Docker Desktop must be running | Documented; native PostgreSQL fallback (same `DATABASE_URL` shape) |
| 10 | No `.env` file committed | Config defaults target 5433; real values stay local |

---

## 10. Readiness status

**Phase 2A (database and backend foundation): COMPLETE — ready for Phase 2B (data generation) and Phase 3 (vertical slices).**

- PostgreSQL 16 runs through Docker; schema, constraints and indexes match the frozen data contract (including Phase 1A amendments).
- Repositories, deterministic services, and validation are implemented and covered by 63 passing tests.
- Environment strategy verified: credentials only in env vars; frontend untouched; no Bob, no ML, no unsupported features.
- Next steps: (a) Phase 2B — Python generators + seed loader + validator (M1/M2 data tasks); (b) Phase 3 — REST endpoints wired to the existing services.
