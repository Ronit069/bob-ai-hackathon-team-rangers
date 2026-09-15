# Setup Guide

**Project:** ChainSentinel — L2 Supply Chain Disruption Assistant & Fleet Utilisation Optimizer

Local-only setup. No cloud deployment, no paid services.

---

## Prerequisites

| Tool | Required version | Check |
|---|---|---|
| Node.js | 20 or later | `node --version` |
| npm | bundled with Node.js | `npm --version` |
| Docker Desktop (or Docker Engine) | any recent version | `docker --version` |
| Python | 3.11 or later | `python3 --version` |
| Git | any | `git --version` |

Docker is used only for PostgreSQL. The database runs in a container; the backend and frontend run directly on your machine.

---

## 1. Clone the Repository

```bash
git clone https://github.com/Ronit069/bob-ai-hackathon-team-rangersand
cd bob-ai-hackathon-team-rangersand
```

---

## 2. Configure Environment Variables

Copy the example file and review it:

```bash
cp src/.env.example src/backend/.env
```

The defaults work out of the box for the standard setup. Review these values and change if needed:

```
# Database — default host port is 5433 (avoids conflict with a local PostgreSQL on 5432)
DATABASE_URL=postgres://bobathon:bobathon@localhost:5433/chain_sentinel
TEST_DATABASE_URL=postgres://bobathon:bobathon@localhost:5433/chain_sentinel_test

# Bob integration — leave false unless you have IBM Bob credentials
BOB_ENABLED=false
BOB_API_URL=
BOB_API_KEY=
```

If port 5433 is already in use on your machine, change it in both the `.env` file and `docker-compose.yml` (the `POSTGRES_HOST_PORT` variable).

**Never commit `.env`.** It is git-ignored.

---

## 3. Start the Database

```bash
docker compose up -d
```

This starts PostgreSQL 16 in a container (`chainsentinel-db`) on port 5433. Wait for it to be healthy:

```bash
docker compose ps
# Expected: "healthy" under the STATUS column for the db service
```

If the container is not healthy after 60 seconds, check logs:

```bash
docker compose logs db
```

---

## 4. Install Backend Dependencies and Set Up the Database

```bash
cd src/backend
npm install
npm run migrate
npm run seed
```

- `npm run migrate` — applies the numbered SQL migrations in `src/backend/migrations/`.
- `npm run seed` — loads `data/seed/*.json` into the database transactionally. This is safe to re-run (truncates and reloads).

Verify the seed loaded correctly:

```bash
node scripts/verify-seed.js
# Expected:
# matching PASS 15/15
# excursions PASS 14/14
```

---

## 5. Start the Backend

```bash
# In src/backend (or open a second terminal)
npm run dev
```

Expected output:
```
ChainSentinel backend listening on 3001 (Phase 3)
```

Verify it is running:

```bash
curl http://localhost:3001/api/health
# Expected: {"status":"ok","database":"up","bob":"disabled",...}
```

---

## 6. Install Frontend Dependencies and Start the Dashboard

Open a new terminal:

```bash
cd src/frontend
npm install
npm run dev
```

Expected output:
```
  VITE v5.x.x  ready in xxx ms
  ➜  Local:   http://localhost:5173/
```

Open `http://localhost:5173` in your browser. The Vite dev server proxies all `/api` requests to the backend at `http://localhost:3001` — no CORS configuration needed, no frontend `.env` file.

Verify the proxy is working:

```bash
curl http://localhost:5173/api/health
# Expected: same backend JSON as step 5
```

---

## 7. (Optional) Run the Demo Freshness Simulator

The seeded sensor feeds end at a fixed anchor timestamp. After that, cold-chain shipments show sensor-failure banners. To refresh one shipment for demo purposes:

```bash
# In src/backend, with the backend running
node scripts/simulate-feed.js
# Default: posts in-policy readings for S030 over 90 minutes at 15-min intervals
# No fixture files are modified; run npm run seed to restore the baseline
```

Options:
```bash
node scripts/simulate-feed.js --shipment=S030 --minutes=120 --interval=15 --base-url=http://localhost:3001
```

---

## 8. (Optional) Verify the MCP Grounding Smoke

With the backend running at `:3001`:

```bash
cd src/mcp-server
npm install
npm run smoke
# Expected: 7/7 checks pass
```

---

## 9. Shut Down

```bash
# Stop the frontend (Ctrl+C in the frontend terminal)
# Stop the backend (Ctrl+C in the backend terminal)
# Stop the database
docker compose down
```

To also remove the database volume (full reset):

```bash
docker compose down -v
```

---

## Testing

### Backend tests (147 tests)

```bash
cd src/backend
npm test
# Expected: 147/147 pass, 0 fail
```

> Note: tests use `TEST_DATABASE_URL` (defaults to `chain_sentinel_test` on the same host). The test suite creates and migrates its own test database automatically.

### Frontend tests (49 tests)

```bash
cd src/frontend
npm test
# Expected: 49/49 pass
```

### Python generator tests (48 tests)

```bash
cd src/data-generator
python -m unittest discover -s tests -t .
# Expected: 48 tests, OK
```

### Contract validator

```bash
cd src/data-generator
python validate.py
# Expected: PASS — scenarios=48 matching=15 excursions=14 readings=2201
```

---

## Regenerating Fixtures (Advanced)

The fixtures in `data/seed/` are pre-generated and checked in. **Do not regenerate them during normal setup** — the frozen SHA-256 hashes are the verification baseline.

If you need to regenerate for development purposes (e.g., changing the generator):

```bash
cd src/data-generator
python generate.py --seed 20260914 --now 2026-09-14T09:00:00Z --out ../../data/seed
python validate.py --dir ../../data/seed
```

Then verify the backend services still agree with the new ground truth:

```bash
cd src/backend
npm run seed
node scripts/verify-seed.js
```

---

## IBM Bob Integration (Optional)

Bob integration is disabled by default (`BOB_ENABLED=false`). The dashboard is fully functional without Bob; the chat panel (S13) shows a clear fallback message.

To enable Bob (requires credentials):

1. Set in `src/backend/.env`:
   ```
   BOB_ENABLED=true
   BOB_API_URL=<your Bob endpoint URL>
   BOB_API_KEY=<your Bob API key>
   ```
2. Restart the backend (`npm run dev`).
3. The MCP server is invoked by Bob automatically over stdio; it reads `BACKEND_URL` (defaults to `http://localhost:3001`).

**Never commit `BOB_API_KEY` or any credentials to the repository.**

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `docker compose up -d` fails | Port 5433 in use | Change `POSTGRES_HOST_PORT` in `docker-compose.yml` and `DATABASE_URL` in `.env` |
| `npm run migrate` fails with connection error | Database container not yet healthy | Wait 30 s and retry; check `docker compose ps` |
| Backend starts but `verify-seed.js` fails | Seed not loaded | Run `npm run seed` then `node scripts/verify-seed.js` again |
| Frontend shows all sensor-failure banners | Fixture feeds are historical | Run `node scripts/simulate-feed.js` to refresh one shipment |
| Bob chat shows "unavailable" | `BOB_ENABLED=false` (expected default) | Normal behavior; dashboard is fully functional without Bob |
| Backend test suite fails with DB error | `TEST_DATABASE_URL` not reachable | Ensure Docker is running; migrations are auto-applied by the test suite |
