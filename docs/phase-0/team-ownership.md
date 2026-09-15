# Phase 0 — Team Ownership

**Status:** DRAFT — requires approval from both members
**Roles (as defined by the team brief):**
- **Member 1 — Logistics and Optimisation Engineer**
- **Member 2 — Cold-Chain, AI and Bob Engineer**

Both members are full-stack contributors: backend, frontend, data, tests, docs and demo. Neither is confined to a single layer.

---

## 1. Member 1 — Logistics and Optimisation Engineer

**Owns:**

| Area | Scope |
|---|---|
| Entities | Shipment, Route, RouteSegment, Carrier, Disruption, FleetAsset, AssetAssignment |
| Logic | Affected shipment detection (R1); route alternatives (R2); carrier alternatives (R2); fleet idle-time analysis (R3); redeployment recommendations (R3) |
| APIs | `/api/disruptions*`, `/api/shipments` (list/detail), `/api/shipments/:id/route-alternatives`, `/api/shipments/:id/carrier-alternatives`, `/api/fleet/idle`, `/api/shipments/:id/redeployment-candidates` |
| UI | Overview screen, Disruption screen, Affected Shipment List, Shipment Detail (route/carrier tabs), Fleet Utilisation/Idle screens |
| Tests | Logistics unit + integration tests; logistics share of end-to-end scenarios |
| Data | Logistics generator (shipments, routes, segments, carriers, disruptions, fleet, assignments) |

**Primary reviewer for:** Member 2's cold-chain APIs, severity logic, Bob tool implementations.

---

## 2. Member 2 — Cold-Chain, AI and Bob Engineer

**Owns:**

| Area | Scope |
|---|---|
| Entities | SensorReading, TemperaturePolicy, TemperatureExcursion |
| Logic | Cold-chain data quality (gaps, duplicates, out-of-order, implausible); excursion detection (R5); severity classification (R6); cold-chain risk contribution to P2 |
| APIs | `/api/sensor-readings`, `/api/shipments/:id/sensor-readings`, `/api/excursions`, `/api/alerts/coldchain`, `/api/temperature-policies*`, `/api/bob/query` |
| Bob | MCP tool definitions (11 tools, frozen list), grounding tests, Bob prompt design, evidence formatting |
| UI | Cold-Chain Monitoring screen, Temperature Graph, Alerts panel, Bob chat panel (conditional on credentials), evidence panel |
| Tests | Cold-chain unit + integration tests; Bob grounding tests; cold-chain share of end-to-end scenarios |
| Data | Cold-chain generator (readings, policies, excursions, defects, sensor failures) |

**Primary reviewer for:** Member 1's disruption matching, route/carrier scoring, fleet logic.

---

## 3. Shared ownership (both members)

| Area | Notes |
|---|---|
| Final architecture | ADR approval; no unilateral structural changes |
| Shared IDs and vocabulary | Data contract §1; changes require joint sign-off |
| Database schema and migrations | One migration per change; reviewed by the other member |
| API contract | This contract is the interface; changes require joint agreement before implementation |
| Combined risk engine (P2) | Co-owned: M1 contributes disruption risk, M2 contributes cold-chain risk; score arithmetic tested jointly |
| Audit + recommendation lifecycle (P4) | Co-owned |
| Integration | Checkpoints in `phase-plan.md`; integration is never solo work |
| End-to-end tests | Jointly defined and run |
| README and submission documents | Both write their sections; final edit together |
| Demo and presentation | Split presenting per `phase-plan.md`; both rehearse |
| Scope decisions | Changes to `scope-freeze.md` require both members |

---

## 4. Module-to-owner matrix

| Module | Owner | Reviewer |
|---|---|---|
| Disruption management | M1 | M2 |
| Shipment impact analysis (R1) | M1 | M2 |
| Route recommendation (R2) | M1 | M2 |
| Carrier recommendation (R2) | M1 | M2 |
| Fleet utilisation + idle detection (R3) | M1 | M2 |
| Redeployment recommendation (R3) | M1 | M2 |
| Sensor ingestion + data quality (R4) | M2 | M1 |
| Excursion detection (R5) | M2 | M1 |
| Severity classification (R6) | M2 | M1 |
| Temperature policy management (R6) | M2 | M1 |
| Combined risk engine (P2) | Shared | Both |
| Recommendation lifecycle + audit (P4) | Shared | Both |
| Dashboard shell / navigation | Shared | Both |
| Bob MCP tool server (P5) | M2 | M1 |
| Bob chat proxy + evidence panel (P5, conditional) | M2 | M1 |
| Data generator (logistics half) | M1 | M2 |
| Data generator (cold-chain half) | M2 | M1 |
| Seed validator | Shared | Both |
| Docs (problem statement, solution overview) | M1 lead, M2 review | Both |
| Docs (architecture, setup guide) | M2 lead, M1 review | Both |
| Demo video + screenshots | Shared | Both |
| Presentation deck | Shared | Both |

---

## 5. Interfaces between the two members (contract points)

| # | Interface | Provider | Consumer | Frozen artifact |
|---|---|---|---|---|
| 1 | Shipment IDs | M1 generator | M2 sensor data, risk engine, Bob tools | `data-contract.md` §2, ID `S###` |
| 2 | Disruption IDs | M1 API | M2 Bob tools, risk engine | `api-contract.md` 3.2–3.5 |
| 3 | Shipment detail (incl. `current_segment_id`, coords) | M1 API | M2 fleet proximity, risk engine | `api-contract.md` 3.7 |
| 4 | Sensor quality + excursion summary | M2 API | M1 shipment screens, risk engine, Bob tools | `api-contract.md` 3.13–3.15 |
| 5 | Severity weights (cold-chain risk) | M2 logic | Shared risk engine | `scope-freeze.md` §1.2 |
| 6 | Combined score endpoint | Shared | Both UIs, Bob tools | `api-contract.md` 3.18–3.19 |
| 7 | Recommendation records + decision endpoint | Shared | Both UIs, audit | `api-contract.md` 3.20–3.21 |
| 8 | Seed fixtures + `scenario_id` + ground truth | Both generators | Both test suites | `data-contract.md` §15 |

**Rule:** if an interface must change, both members agree first, then the contract file is updated in the same PR as the code change. No undocumented local assumptions.

---

## 6. Working rules

1. **One shared repo**, branches: `main` always demoable; feature branches `feat/<area>-<task>`.
2. **PR required for every merge**; the other member reviews; no direct pushes to `main`.
3. **Daily sync (15 min):** done / next / blockers. During Phases 3–5, twice daily if needed.
4. **Task board:** every task from `phase-plan.md` becomes a GitHub Issue with owner, phase and acceptance criteria.
5. **Blocked > 30–45 minutes:** switch to a backup task (below) and record the blocker on the issue; raise it at the next sync.
6. **Definition of Done** (`phase-plan.md` §5) applies to every task before it is marked done.
7. **Contribution log** per member: task, date, commit/PR link, evidence, review performed.

### Backup tasks (anti-idle list)

| Member 1 backups | Member 2 backups |
|---|---|
| Test fixtures for logistics scenarios | Extra sensor edge-case fixtures |
| API docs for finished logistics endpoints | Bob prompt iteration + grounding tests on live APIs |
| Dashboard shared components / styling | UI empty/loading/error state polish |
| Route/carrier scoring-weight experiments | Validation-script improvements |
| Mock JSON for M2 if their generator lags | Evidence-panel formatting |
| README logistics sections | README cold-chain/Bob sections |

---

## 7. Escalation and conflict resolution

- **Technical disagreement:** 15-minute timeboxed discussion; if unresolved, the owner of the module makes the call and documents it in the PR; either member may raise it at the next sync. No silent reversals.
- **Scope disagreement:** `scope-freeze.md` wins; changing it requires both members.
- **Contract disagreement:** the contract file wins until both members agree to change it.
- **One member unavailable:** the other continues with backup tasks; no shared task is merged without review, so critical integration waits — this is accepted and planned for.

---

## 8. Contribution evidence (submission requirement)

Each member maintains a contribution log containing: task name and date; commit/PR links; screenshots or short recordings; APIs/modules delivered; tests written and results; known limitations; reviews performed for the other member. The final individual contribution report (Document 2 template) is filled from this log before submission.
