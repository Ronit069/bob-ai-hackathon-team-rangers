# frontend/ — ChainSentinel dashboard

React 18 + Vite 5 dashboard consuming the **frozen REST API** (28 endpoints). No mock data in
the running application; every score, factor, reason, severity and status is rendered exactly as
the backend returns it.

## Run

```bash
# 1. database + backend (from the repo root / src/backend)
docker compose up -d
cd src/backend && npm run migrate && npm run seed && npm run dev    # backend on :3001

# 2. frontend
cd src/frontend && npm install && npm run dev                       # dashboard on :5173
```

The Vite dev server proxies `/api` to `http://localhost:3001` (finding F1), so the browser needs
no CORS configuration, no credentials and **no frontend `.env` file**.

## Test

```bash
npm test        # 49 tests: API client, shared components, all 14 screens, safety scan
npm run build   # production build
```

The safety scan (`src/api/no-formulas.test.js`) fails the build if the frontend ever contains
scoring weights, severity tables, formula assignments, `process.env` access or credential names.

## Screens

| Route | Screen | Owner |
|---|---|---|
| `/` | S1 Overview / risk worklist (30 s polling) | Shared |
| `/disruptions` | S2 Disruptions (list + create + activate/resolve) | M1 |
| `/disruptions/:id/affected` | S3 Affected shipments | M1 |
| `/shipments/:id` | S4 Shipment detail (route/risk/sensors/recommendations/audit tabs) | M1 |
| `/shipments/:id/alternatives` | S5 Route/carrier comparison + decisions | M1 |
| `/fleet` | S6 Fleet utilisation + idle tab | M1 |
| `/shipments/:id/redeployment` | S7 Redeployment candidates + fleet recommendation | M1 |
| `/coldchain` | S8 Cold-chain monitoring, alerts, policy editor | M2 |
| `/shipments/:id/temperature` | S9 Temperature history graph | M2 |
| `/excursions/:id` | S10 Excursion detail + review lifecycle | M2 |
| `/sensors` | S11 Sensor health | M2 |
| `/shipments/:id/risk` | S12 Risk explanation (RC-3 factors) | M2 lead |
| `/chat` | S13 Bob chat + evidence panel (503 fallback first-class) | M2 |
| `/audit` | S14 Audit trail | Shared |

## Rules

- The frontend never computes scores, severities, rankings or durations.
- Bob is optional: `BOB_ENABLED=false` renders the fallback state; the dashboard stays fully usable.
- No secrets: the frontend has no environment file and no credential access.
