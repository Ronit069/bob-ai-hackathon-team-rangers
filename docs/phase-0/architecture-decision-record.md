# Phase 0 — Architecture Decision Record (ADR)

**Status:** DRAFT — requires approval from both members
**Scope:** one selected architecture for the MVP. Alternatives are listed only to justify the decision; they are not open options.

---

## ADR-001 — Final technology stack

### Context
Two students, one buildathon, one repo. The domain is strongly relational (shipments → routes → segments → carriers; assets → assignments; shipments → readings → excursions). The documents conflict (Node vs FastAPI; PostgreSQL vs MongoDB; tool definitions vs MCP). The MVP must run locally on Windows machines without paid services and must survive IBM Bob being unavailable.

### Decision (selected — no alternatives left open)

| Layer | Selection | Version / notes |
|---|---|---|
| Frontend | **React + Vite (JavaScript)** + React Router + Recharts | Plain CSS with a shared stylesheet (design tokens); no CSS framework |
| Backend | **Node.js 20 + Express 4 (JavaScript, ESM)** | Modular service folders; `zod` for request validation; `pg` for database access |
| Database | **PostgreSQL 16** | Run via Docker Compose; plain SQL migration files applied by an npm script; no ORM |
| Data generation | **Python 3.11, standard library only** | `random` with fixed seed; emits JSON fixtures; no pandas/Faker required |
| Analytics / ML | **None in MVP** | Deterministic rules + transparent weighted scoring; ML is future scope |
| Charts | **Recharts** | Temperature graph, dashboard charts |
| IBM Bob boundary | **REST-first + thin MCP tool server** | Bob never touches the database; MCP tools call the REST API and return structured JSON |
| Local development | **Docker Compose (PostgreSQL only) + two terminals** | `npm run dev` in `src/backend`, `npm run dev` in `src/frontend`; Vite proxies `/api` to the backend |
| Environment variables | **`src/backend/.env` from `src/backend/.env.example`** | `.env` git-ignored; frontend needs no env (uses Vite proxy) |

### Why this selection
- **One language across frontend + backend + MCP server** removes context switching for a two-person team; Python is used only where it is clearly faster (seeded data generation).
- **PostgreSQL** fits the foreign-key-heavy domain, supports `JSONB` for factor/reason payloads, and is the stack both reference documents assume.
- **No ORM** keeps the schema and SQL visible — easier to debug under time pressure, and the data contract stays the single source of truth.
- **`zod` is the only non-trivial backend dependency**; it enforces the API contract at runtime instead of relying on discipline.
- **MCP tool server** makes Bob load-bearing (rubric criterion 5) without making Bob a runtime dependency of the dashboard.
- **Python stdlib generator** produces reproducible data with zero installs; the seed is the demo's reproducibility guarantee.

### Rejected alternatives (recorded, not open)
| Alternative | Why rejected |
|---|---|
| FastAPI (Python) backend | Splits the team across two languages; frontend/backend/MCP context switching costs more than FastAPI's typing benefits for this size |
| MongoDB | Domain is relational; joins (shipment → route → segment → region) are the core query; document store would push join logic into application code |
| SQLite | No `JSONB`, weaker concurrency during parallel dev; Docker Postgres is one command and matches production-shaped SQL |
| Prisma / Sequelize ORM | Extra abstraction and generated code to debug; raw SQL is faster for a schema this small |
| Embedded LLM chat calling Bob API directly from the browser | Exposes credentials in the frontend; creates a Bob-only failure path |
| PostGIS now | Region-code matching satisfies R1 deterministically; geometry is future scope (F9) |

### Consequences
- Both members must be comfortable with JavaScript; Python is limited to the generator.
- Docker Desktop (or a local PostgreSQL 16) is required; documented in the setup guide.
- The MCP server is a thin adapter — if Bob's environment expects a different transport, only the adapter changes, not the backend.
- No ORM means migrations must be hand-written and reviewed; this is intentional.

---

## ADR-002 — Module boundaries and code organization

### Decision
```
src/
├── backend/
│   ├── src/
│   │   ├── logistics/     # M1: disruptions, shipments, routes, carriers, fleet
│   │   ├── coldchain/     # M2: readings, policies, excursions, severity
│   │   ├── risk/          # Shared: combined score, overview
│   │   ├── audit/         # Shared: audit records, decisions
│   │   ├── bob/           # M2: optional /api/bob/query proxy (BOB_ENABLED)
│   │   └── common/        # config, db, validation, errors, logging
│   ├── migrations/        # numbered .sql files
│   └── scripts/           # migrate, seed, validate
├── frontend/              # M1 logistics screens + M2 cold-chain/Bob screens
├── data-generator/        # Python, stdlib only: logistics + coldchain generators, validator
└── mcp-server/            # M2: MCP tool definitions calling backend REST
```

### Rules
- Services within the backend never call each other over HTTP; they share the database and import from `common/`.
- Each domain folder is owned by one member (see `team-ownership.md`); `risk/` and `audit/` are jointly owned.
- `risk/` reads logistics and cold-chain tables but owns only `risk_assessment`; it never mutates domain data.
- The MCP server contains no business logic — it maps tools to REST calls and returns the JSON it receives.

---

## ADR-003 — Data layer and seeding

### Decision
- One PostgreSQL database, schema defined by numbered SQL migrations committed to the repo.
- The Python generator writes `data/seed/*.json`; `npm run seed` loads them inside a single transaction (all-or-nothing).
- `scenario_id` tags and generator-computed ground truth are stored in the JSON fixtures; the validator script checks referential integrity and scenario coverage before seeding.
- Seed data is deterministic: fixed seed value in config; rerunning produces byte-identical fixtures.

### Consequences
- The demo can be reset with `npm run seed` at any time.
- Ground truth enables automated validation of classification logic (not just eyeballing).
- Schema changes require a new migration + joint approval (see change control in `data-contract.md`).

---

## ADR-004 — IBM Bob integration boundary

### Decision
- **The REST API is the single source of operational truth.** Every fact Bob can state must come from a REST response.
- A thin **MCP tool server** (`src/mcp-server`) exposes the frozen tool list (see `api-contract.md` §5). Each tool validates input, calls one REST endpoint, and returns the structured JSON unchanged.
- Bob's system prompt: answer only from tool outputs; if a tool returns empty/null/error, say so; never compute scores, never invent entities.
- The UI shows the raw tool JSON (evidence) beside Bob's answer when the embedded chat panel is enabled.
- **`BOB_ENABLED=false` is a first-class mode.** The dashboard, all six capabilities, all APIs and all tests work without Bob.

### Bob-unavailable behaviour (required by the brief)
| Situation | Behaviour |
|---|---|
| `BOB_ENABLED=false` (default for local dev) | Chat panel shows: "Bob is unavailable — the dashboard is fully functional." All other screens unaffected. `POST /api/bob/query` returns `503 BOB_UNAVAILABLE` |
| Bob/MCP reachable but a tool call fails | The failure is returned explicitly in the response envelope (`error` field) and shown as evidence; Bob is instructed to report it, not guess |
| Demo day without credentials | Demo uses the MCP server directly (tool calls + evidence) plus the dashboard; the chat panel is skipped or shown in fallback state — never faked |

---

## ADR-005 — Local development and environment strategy

### Decision
- `docker-compose.yml` at repo root runs **PostgreSQL 16 only**.
- `src/backend/.env.example` (committed) documents every variable; `.env` (git-ignored) holds real values:

| Variable | Purpose | Default / example |
|---|---|---|
| `PORT` | Backend HTTP port | `3001` |
| `DATABASE_URL` | Postgres connection string | `postgres://bobathon:bobathon@localhost:5432/chain_sentinel` |
| `BOB_ENABLED` | Enable Bob proxy path | `false` |
| `BOB_API_URL` | Bob/MCP gateway URL (if applicable) | empty |
| `BOB_API_KEY` | Secret for Bob (never committed) | empty |
| `SEED` | Data generator seed | `20260914` |
| `REDEPLOY_RADIUS_KM` | Fleet proximity radius | `150` |
| `RISK_ALPHA`, `RISK_BETA` | Combined score weights | `0.5`, `0.5` |
| `NODE_ENV` | Runtime mode | `development` |

- Frontend calls `/api/*`; Vite dev server proxies to `http://localhost:3001`. No frontend env file, no credentials in the browser.
- Startup order documented in the setup guide: `docker compose up -d` → `npm run migrate` → `npm run seed` → backend → frontend.

### Consequences
- Fresh-clone reproducibility is a Phase 7 gate (setup guide tested on a clean terminal).
- Secrets never enter git; the validation action and a manual `git log` check guard this (O6).

---

## ADR-006 — Rules, scoring, and ML policy

### Decision
- MVP uses **deterministic rules** for matching, constraints, thresholds and data-quality handling, and **transparent weighted scores** for ranking (frozen in `scope-freeze.md` §1.2).
- **No ML component is built or claimed in the MVP.** Weights are configuration, not learned parameters.
- Any ML work is future scope (F1, F2) and may only be described as future work in the deck/README.

### Why
- Judges read code (rubric criterion 1) and reward honest limitations (criterion 6). A transparent formula that the team can defend beats a half-trained model that cannot be explained or reproduced.
- Every score must be decomposable into factors on screen; a black-box model would break the explainability requirement (P3).

---

## ADR-007 — Risk snapshots and audit immutability

### Decision
- `GET /api/shipments/:id/risk` computes the score on read and persists a snapshot row in `risk_assessment` (history retained; latest snapshot returned by default).
- `audit_record` is append-only. There is no update/delete code path; the decision endpoint inserts one audit row per decision.
- `recommendation.status` transitions only `pending → accepted | rejected | modified`; a second decision returns `409`.

### Consequences
- Recomputing after data changes produces a new snapshot, preserving what the operator saw at decision time.
- Demo can show score changes over time without mutating history.

---

## System diagram (MVP)

```mermaid
flowchart TB
    subgraph Client["Frontend — React + Vite"]
        UI[Control Tower Dashboard]
        Chat[Bob Chat Panel - conditional]
    end

    subgraph API["Backend — Node.js + Express"]
        Gateway[REST API /api]
        Log[logistics service - M1]
        Cold[coldchain service - M2]
        Risk[risk service - shared]
        Audit[audit service - shared]
        BobProxy[bob proxy - M2, optional]
    end

    subgraph BobLayer["IBM Bob Integration"]
        MCPServer[MCP tool server - thin adapter]
        BobAgent[IBM Bob]
    end

    subgraph Data["Data Layer"]
        DB[(PostgreSQL 16)]
        Gen[Python generator - stdlib, seeded]
    end

    UI -->|REST| Gateway
    Chat -.->|REST| BobProxy
    BobAgent -->|MCP tool calls| MCPServer
    MCPServer -->|REST| Gateway
    BobProxy -.->|if BOB_ENABLED| BobAgent
    Gateway --> Log
    Gateway --> Cold
    Gateway --> Risk
    Gateway --> Audit
    Log --> DB
    Cold --> DB
    Risk --> DB
    Audit --> DB
    Gen -->|seed JSON| DB
```

**Key property:** removing Bob, the MCP server and the chat panel leaves a fully functional dashboard backed by the same REST API. Bob is additive, never load-bearing for core operation — but it is load-bearing for the submission's IBM integration criterion, which is why the tool layer and grounding tests are MVP-mandatory.

---

## Decision log summary

| ADR | Decision | Owner | Reversible? |
|---|---|---|---|
| 001 | React+Vite / Node+Express / PostgreSQL / Python generator / no ML | Shared | No (frozen) |
| 002 | Domain module boundaries, no service-to-service HTTP | Shared | No (frozen) |
| 003 | SQL migrations + seeded JSON fixtures + validator | Shared | Partially |
| 004 | REST-first, thin MCP tool server, `BOB_ENABLED` flag | M2 (review M1) | Adapter only |
| 005 | Docker Postgres + `.env` strategy + Vite proxy | Shared | Partially |
| 006 | Rules + scoring only, ML future | Shared | No (frozen) |
| 007 | Risk snapshots persisted; audit append-only | Shared | No (frozen) |
