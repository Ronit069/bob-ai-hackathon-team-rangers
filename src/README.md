# src/ — layout

All source code lives here (submission requirement).

```text
src/
├── .env.example      # every environment variable, documented
├── README.md         # this file
├── backend/          # Node.js 20 + Express 4 (ESM), zod, pg — REST API
│   ├── src/
│   │   ├── common/       # config, db pool, validation, errors, logging
│   │   ├── logistics/    # M1: disruptions, shipments, routes, carriers, fleet
│   │   ├── coldchain/    # M2: readings, quality, excursions, severity, policies
│   │   ├── risk/         # shared: combined score, snapshots, overview
│   │   ├── audit/        # shared: append-only records, decisions
│   │   ├── bob/          # M2: optional /api/bob/query proxy
│   │   └── server.js     # placeholder entry point (Phase 1A scaffold)
│   ├── migrations/       # numbered .sql files
│   └── scripts/          # migrate, seed, validate
├── frontend/         # React + Vite (JavaScript)
├── data-generator/   # Python 3.11 stdlib — seeded fixtures + ground truth
└── mcp-server/       # Node MCP tool server — thin adapter over REST (11 tools)
```

**Status:** Phase 1A scaffold only — folders and placeholders; no product features implemented.

**Do not commit:** `node_modules/`, `.env`, `__pycache__/`, `.venv/`, build artefacts.
