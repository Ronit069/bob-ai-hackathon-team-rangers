# ChainSentinel

**Bobathon 2026 — L2: Supply Chain Disruption Assistant & Fleet Utilisation Optimizer**

> TODO_REQUIRED — replace this skeleton before submission. Search for `TODO` and `[` before pushing.

## Team

- Team name: TODO_REQUIRED
- Track: AI
- Lead: TODO_REQUIRED
- Members: TODO_REQUIRED

## Problem Statement

TODO_REQUIRED — 2–3 sentences: disruptions cascade across shipments, fleet sits idle, cold-chain breaches are found at delivery. (Full text: `docs/problem-statement.md`.)

## Solution

TODO_REQUIRED — 2–3 sentences: ChainSentinel is a Bob-powered control tower that identifies affected shipments, ranks reroute/carrier alternatives, finds idle fleet, and classifies cold-chain excursion severity before delivery — with human approval and visible evidence. (Full text: `docs/solution-overview.md`.)

## Key Features

1. Affected shipment detection with match reasons and impact status.
2. Ranked route and carrier alternatives with factor breakdowns and rejected options.
3. Fleet idle detection and compatibility-aware redeployment recommendations.
4. Cold-chain sensor monitoring with data-quality checks (gaps, duplicates, out-of-order, failures).
5. Policy-driven excursion severity classification (Warning / Major / Critical / Unknown-Review).
6. Grounded IBM Bob assistant (MCP tools) with evidence and human-approved decisions.

## Tech Stack

- Frontend: React + Vite (JavaScript), React Router, Recharts
- Backend: Node.js 20 + Express 4 (ESM), zod, pg (no ORM)
- Database: PostgreSQL 16 via Docker Compose
- Data generation: Python 3.11 standard library (seeded fixtures)
- Bob integration: Node MCP tool server (thin adapter over REST)
- ML: none in the MVP (rules + transparent scoring)

## How to Run

TODO_REQUIRED — copy the exact commands from `docs/setup-guide.md` once written (Phase 7). Local-only deployment; `demo/live-demo-url.txt` = NOT DEPLOYED.

## Demo

- Video: see `demo/demo-video-link.txt` (TODO_REQUIRED)
- Screenshots: `demo/screenshots/` (≥3 required)
- Live demo: `demo/live-demo-url.txt` (NOT DEPLOYED)

## Known Limitations

TODO_REQUIRED — must be honest and match the code (synthetic data only; no ML; policy thresholds are illustrative, not regulatory; Bob grounding reduces but does not eliminate hallucination; single-operator auth assumption; local-only deployment).

## What We're Most Proud Of

TODO_REQUIRED — point judges at the strongest verified work (combined disruption + cold-chain priority engine, explainable recommendations, grounded Bob evidence, reproducible seeded scenarios).

## Documentation

- `docs/problem-statement.md` · `docs/solution-overview.md` · `docs/architecture.md` · `docs/setup-guide.md`
- Phase 0/1 planning: `docs/phase-0/`, `PHASE_1_SYSTEM_DESIGN.md`, `docs/PHASE_1_SIGNOFF.md`
