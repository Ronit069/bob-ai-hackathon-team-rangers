# Phase 0 — Requirements Matrix

**Status:** DRAFT — requires approval from both members (see `phase-0-review-checklist.md`)
**Source legend:**
- `[OFFICIAL]` — from `Industry Problem Statements - 2026.pdf` (L2 challenge) or `Bobathon_Submission_Template_Guide.pdf`
- `[PROPOSED]` — team design decision that strengthens the submission; not required by the organisers
- `[FUTURE]` — explicitly out of MVP scope; must not be attempted before the MVP is frozen and working

**Official L2 challenge text (verbatim, bullet 4 is bundled):**
> Build a Bob solution that identifies which shipments are affected by an active disruption, recommends re-routing or carrier alternatives, identifies idle fleet assets for redeployment, and monitors cold chain IoT sensor logs to detect temperature excursions and classify their regulatory severity before delivery.

The team brief splits official bullet 4 into three separately testable capabilities (R4, R5, R6). This is a presentation choice for buildability and demo evidence; it does not add or remove any official requirement.

---

## 1. Mandatory requirements (official L2)

| ID | Requirement | Source | Mandatory/Proposed/Future | Planned feature | Acceptance evidence |
|---|---|---|---|---|---|
| R1 | Identify shipments affected by an active disruption | `[OFFICIAL]` L2 bullet 1 (official PDF); `[OFFICIAL]` submission guide rubric criterion 4 (working demo) | **Mandatory** | Disruption matching: active disruption's `region_code` matched against `RouteSegment.region_code`; shipments whose route contains a matching segment are listed with a match reason and impact score | Demo: activate disruption `D01` → affected shipment list populates with `S102`, reason "route passes region IN-WEST-COAST"; API `GET /api/disruptions/:id/affected-shipments` returns correct list on all disruption test scenarios |
| R2 | Recommend rerouting or alternative carriers | `[OFFICIAL]` L2 bullet 2 | **Mandatory** | Route and carrier alternatives: hard-constraint filter (active carrier, capacity ≥ volume, avoids disrupted region) + transparent weighted score (cost, ETA, capacity margin, residual risk); ranked list with factor breakdown and rejected alternatives | Demo: open `S102` → ranked route and carrier options with score factors; "no feasible alternative" case handled gracefully; API `GET /api/shipments/:id/route-alternatives`, `.../carrier-alternatives` |
| R3 | Identify idle fleet assets for redeployment | `[OFFICIAL]` L2 bullet 3 | **Mandatory** | Fleet idle detection: `available` assets with no active/reserved assignment; idle time from `available_since`; compatibility filter (capacity, refrigeration, distance radius); ranked redeployment candidates for affected shipments | Demo: idle asset `A114` (refrigerated, idle 6.2 h) ranked for `S102`; reserved asset excluded with reason; API `GET /api/fleet/idle`, `GET /api/shipments/:id/redeployment-candidates` |
| R4 | Monitor cold-chain IoT sensor logs | `[OFFICIAL]` L2 bullet 4 (first clause) | **Mandatory** | Sensor ingestion + storage + data-quality checks (gaps, duplicates, out-of-order, implausible values); live per-shipment sensor status view | Demo: sensor feed panel updates as simulator posts readings; a missing-data gap is flagged; API `POST /api/sensor-readings`, `GET /api/shipments/:id/sensor-readings` |
| R5 | Detect temperature excursions | `[OFFICIAL]` L2 bullet 4 (second clause) | **Mandatory** | Threshold + duration detection against the shipment's `TemperaturePolicy`; boundary-inclusive rule; per-excursion start/end, peak deviation, duration; sensor-failure distinction | Demo: injected excursion scenario fires an alert before delivery; boundary reading (exactly at limit) classified as within bounds; API `GET /api/excursions`, `GET /api/alerts/coldchain` |
| R6 | Classify excursion severity using configurable policy rules | `[OFFICIAL]` L2 bullet 4 (third clause, "regulatory severity"); brief adds "configurable policy rules" | **Mandatory** | Rule ladder (Warning / Major / Critical / Unknown-Review) evaluated against editable `TemperaturePolicy` records; rationale + data-quality caveats stored with each excursion; **no claim of universal regulatory compliance** — policies are configurable placeholders | Demo: excursion classified "Major" with duration/magnitude shown; missing readings → "Unknown / Review Required"; API `GET /api/temperature-policies`, `PUT /api/temperature-policies/:id`, severity field on excursion |

---

## 2. Proposed enhancements (not official requirements)

| ID | Requirement | Source | Mandatory/Proposed/Future | Planned feature | Acceptance evidence |
|---|---|---|---|---|---|
| P1 | Unified control-tower dashboard (one screen for disruption + fleet + cold-chain) | `[PROPOSED]` Document 1 §3.2 / Blueprint §3.2 | Proposed — **in MVP** | Single React app with Overview, Affected Shipments, Shipment Detail, Fleet/Idle, Cold-Chain, Risk worklist, Audit screens | Demo: navigation across all screens hitting real APIs |
| P2 | Combined disruption + cold-chain priority score | `[PROPOSED]` Document 1 §13 | Proposed — **in MVP** | `combined_score = α·disruption_risk + β·coldchain_risk` (defaults 0.5/0.5, configurable), normalised 0–1, persisted snapshot | Demo: `S102` score changes when either sub-score changes; API `GET /api/shipments/:id/risk`, `GET /api/risk/overview` |
| P3 | Explainable recommendation cards (factors + rejected alternatives) | `[PROPOSED]` Document 1 §15 | Proposed — **in MVP** | Every recommendation stores `factors_json`, `constraints_checked`, `rejected_alternatives`; UI renders them | Demo: recommendation card shows score breakdown and why runner-up was rejected |
| P4 | Human-approval workflow + append-only audit trail | `[PROPOSED]` Document 1 §19 | Proposed — **in MVP** | `Recommendation.status` lifecycle pending → accepted/rejected/modified; `AuditRecord` append-only; decision endpoint | Demo: accept a recommendation → audit entry appears; API `POST /api/recommendations/:id/decision`, `GET /api/audit` |
| P5 | Grounded IBM Bob assistant (tool-only answers + visible evidence) | `[OFFICIAL]` submission guide rubric criterion 5 ("Bob load-bearing") + `[PROPOSED]` tool design | Proposed — **in MVP** (MCP tool server + grounding tests mandatory; embedded chat proxy conditional on credentials) | Thin MCP tool server exposing frozen tools over the REST API; every tool returns structured JSON; UI chat panel (if enabled) shows raw evidence next to answers | Demo: Bob answers an operator question using tool output with evidence table; with `BOB_ENABLED=false` the dashboard remains fully functional and chat shows a fallback message |
| P6 | Bob-generated 6-hour operational brief | `[PROPOSED]` Document 1 §16 | Proposed — **in MVP demo script** | Multi-tool prompt producing a prioritised brief from ranked outputs; Bob formats, never computes | Demo: "Give me a six-hour action plan" returns per-item brief linked to evidence |
| P7 | What-if scenario mode ("what if carrier C3 goes down?") | `[PROPOSED]` Document 1 §16 | Proposed — **if time permits** | Re-run carrier/route ranking with one entity excluded | Demo only if complete; never presented as done before it is |
| P8 | Greedy bipartite matching for fleet redeployment | `[PROPOSED]` Document 1 §12.3 | Proposed — **if time permits** | Simple greedy pair matching across multiple shipments/assets; replaces 1:1 ranking view | Demo only if complete |
| P9 | Docker Compose one-command setup | `[PROPOSED]` Document 1 §9 | Proposed — **in MVP** (DB container only) | `docker-compose.yml` runs PostgreSQL; app runs locally | Setup guide reproduces DB with one command |

---

## 3. Future production scope (do not attempt in MVP)

| ID | Requirement | Source | Mandatory/Proposed/Future | Planned feature | Acceptance evidence |
|---|---|---|---|---|---|
| F1 | ML-based ETA delay prediction | `[FUTURE]` Document 1 §12.4, Blueprint §4.2 | Future | Regression baseline on synthetic historical delays, evaluated vs fixed-buffer rule | Not in MVP; named in limitations only |
| F2 | Sensor anomaly / fault detection (ML) | `[FUTURE]` Blueprint §4.9 | Future | Unsupervised anomaly detection to separate sensor faults from real excursions | Not in MVP; MVP uses explicit data-quality flags |
| F3 | Mixed-integer / full optimisation for network-wide fleet assignment | `[FUTURE]` Document 1 §12.3 | Future | MIP solver over all assets/shipments | Not in MVP |
| F4 | Live external feeds (weather, port status, AIS, carrier APIs) | `[FUTURE]` Blueprint §11.3 | Future | Real ingestion pipelines | Not in MVP; disruptions are created via form/API |
| F5 | Real IoT streaming (MQTT/Kafka) | `[FUTURE]` Document 1 §23 | Future | Streaming ingestion with backpressure | Not in MVP; simulator posts to REST |
| F6 | Unstructured disruption-text extraction via LLM | `[PROPOSED→FUTURE]` Blueprint §4.7 | Future | Bob/LLM extracts structured event from news text | Not in MVP; creates a schema dependency and cannot be demoed reliably without credentials |
| F7 | Authentication / SSO / RBAC / multi-tenant isolation | `[FUTURE]` Document 1 §19, Blueprint §11.2 | Future | Enterprise identity + row-level isolation | Not in MVP; single trusted operator assumed and documented |
| F8 | Workflow execution (actually rebooking carriers) | `[FUTURE]` Document 1 §23 | Future | External carrier booking APIs | Not in MVP; no auto-execution ever |
| F9 | PostGIS spatial matching / polygon disruptions | `[FUTURE]` Blueprint §4.1 | Future | Geometry-based intersection | Not in MVP; region-code matching frozen |
| F10 | Learned carrier reliability from outcomes | `[FUTURE]` Blueprint §3.3 | Future | Model updated from real on-time data | Not in MVP; static synthetic reliability score |

---

## 4. Submission and packaging obligations (from the authoritative template guide)

| ID | Obligation | Source | Mandatory/Proposed/Future | Where satisfied | Acceptance evidence |
|---|---|---|---|---|---|
| O1 | Repo created from official template, public visibility | `[OFFICIAL]` guide §2 | Mandatory | Phase 0/1 bootstrap | Repo URL accessible; template files intact |
| O2 | `submission.yaml` with all REQUIRED fields | `[OFFICIAL]` guide §4.1 | Mandatory | Phase 7 (drafted Phase 0) | Validate Submission action green |
| O3 | `README.md` with no `[placeholder]` text | `[OFFICIAL]` guide §4.2 | Mandatory | Phase 7 | Search for `[` returns none |
| O4 | `docs/problem-statement.md`, `solution-overview.md`, `architecture.md`, `setup-guide.md` | `[OFFICIAL]` guide §4.3 | Mandatory | Phase 7 (architecture drafted from ADR; setup guide written last, tested clean) | All four files complete |
| O5 | All source code inside `src/` | `[OFFICIAL]` guide §4.4 | Mandatory | Phases 1–6 | No code outside `src/` except docs/config |
| O6 | `src/.env.example` lists every variable; no real `.env` committed | `[OFFICIAL]` guide §4.4 | Mandatory | Phase 1 | `git log` shows no `.env`; `.env.example` complete |
| O7 | Demo video 3–5 min showing app running (not mocked) | `[OFFICIAL]` guide §4.5 | Mandatory | Phase 7 | `demo/demo-video-link.txt` has working URL |
| O8 | ≥3 screenshots of running app in `demo/screenshots/` | `[OFFICIAL]` guide §4.5 | Mandatory | Phase 7 | Sequential PNGs present |
| O9 | Slide deck `presentation/slides.pdf` in required order | `[OFFICIAL]` guide §4.6 | Mandatory | Phase 7 | Deck covers problem → solution → demo/architecture → IBM tech → impact |
| O10 | Validate Submission GitHub Action green | `[OFFICIAL]` guide §5 | Mandatory | Phase 7 | Actions tab shows green |
| O11 | Honest known limitations; no overclaiming | `[OFFICIAL]` guide §7 | Mandatory | All phases | Limitations section in README + docs; claims match code |

---

## 5. Traceability rules

1. Every mandatory row (R1–R6) maps to at least one MVP module, at least one API endpoint, and at least one test scenario in the phase plan.
2. No proposed or future row may block a mandatory row; if time runs out, proposed rows are cut in the order defined in `scope-freeze.md`.
3. Any change to this matrix requires both members' approval and an update to `scope-freeze.md`.
