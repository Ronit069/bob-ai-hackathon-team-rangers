# ChainSentinel — Run Audit: What You Must Configure Before the Project Will Run

**Date:** 2026-09-15  
**Environment audited:** macOS arm64, Node 26.7.0, npm 11.19.0, Python 3.14.7  
**Status:** Audit only — no source code was changed.

---

## Summary

| Layer | Ready to run? | Blocker |
|---|---|---|
| Frontend tests (`npm test`) | ✅ Yes — runs now | None |
| Python tests + validator | ✅ Yes — runs now | None |
| Database (PostgreSQL) | ❌ **Blocked** | Docker not installed |
| Backend server (`npm run dev`) | ❌ **Blocked** | No DB to connect to |
| Backend tests (`npm test`) | ❌ **Blocked** | No DB to connect to |
| Frontend dev server (`npm run dev`) | ⚠️ Partial | Starts, but all API calls fail without the backend |
| MCP server (`npm run smoke`) | ❌ **Blocked** | Requires backend at `:3001` |

**The single root cause preventing the project from running is: Docker is not installed on this machine.**  
Everything else is in place.

---

## 1. Docker — Not Installed (Critical Blocker)

### What the project needs

The project uses Docker Compose to run PostgreSQL 16. This is defined in [`docker-compose.yml`](../docker-compose.yml):

```yaml
services:
  db:
    image: postgres:16-alpine
    ports:
      - "${POSTGRES_HOST_PORT:-5433}:5432"
```

### Current state

- `docker` binary: **not found** in `$PATH`
- Docker Desktop: **not installed** in `/Applications/`
- No alternative container runtime found (no Podman, no OrbStack, no Colima)
- No native PostgreSQL installation found (`psql`, `pg_ctl` not present)
- Port 5433: **CLOSED** — no database accepting connections

### Fix

Install Docker Desktop from https://www.docker.com/products/docker-desktop/  
Then run: `docker compose up -d`

**Alternative (no Docker):** Install PostgreSQL 16 natively via Homebrew:
```bash
brew install postgresql@16
brew services start postgresql@16
# Create the database and user manually:
createuser -s bobathon && createdb -O bobathon chain_sentinel
# Then set POSTGRES_HOST_PORT in the connection string to 5432 in src/backend/.env
```

---

## 2. Backend `.env` File — Missing (Soft Blocker)

### What the project needs

The backend reads environment variables from `src/backend/.env` (or `src/.env`).  
This file is **not committed** (correctly — it is git-ignored).

### Current state

- `src/backend/.env`: **does not exist**
- `src/.env`: **does not exist**
- `src/.env.example`: **exists** and contains all required defaults

### Impact

The backend has **hardcoded fallback defaults** for every variable in [`src/backend/src/common/config.js`](../src/backend/src/common/config.js):

```js
databaseUrl: env.DATABASE_URL ?? "postgres://bobathon:bobathon@localhost:5433/chain_sentinel",
bobEnabled:  env.BOB_ENABLED === "true",   // defaults false — correct
```

**This means `.env` is technically optional for the default setup.** The hardcoded defaults match `docker-compose.yml` exactly. No manual `.env` creation is required unless you want to change a port, enable Bob, or use a different database URL.

### Fix (recommended, not required)

```bash
cp src/.env.example src/backend/.env
# Review the file — defaults are correct for standard setup
```

---

## 3. MCP Server `node_modules` — Not Installed

### Current state

`src/mcp-server/node_modules/` does **not exist**.  
The MCP server has one npm dependency: `@modelcontextprotocol/sdk@1.12.0`.

The smoke script (`npm run smoke`) will fail with a module-not-found error.

### Fix

```bash
cd src/mcp-server
npm install
```

This is a one-time step after cloning. It is documented in `docs/setup-guide.md §8`.

---

## 4. Node.js Version

### Current state

- Installed: **Node 26.7.0**
- Required: **≥ 20** (declared in all three `package.json` `engines` fields)

✅ **No action needed.** Node 26 satisfies the `>=20` constraint.

---

## 5. Python — Standard Library Only

### Current state

- Installed: **Python 3.14.7**
- Required: **≥ 3.11** (declared in `Document1_Proposal_and_Technical_Design.md`)
- Data generator: **Python standard library only** — no `requirements.txt`, no pip installs needed

✅ **No action needed.**  
Both `python3 -m unittest discover -s tests -t .` (48/48 ✅) and `python3 validate.py` (PASS ✅) already pass.

---

## 6. Backend and Frontend `node_modules`

### Current state

- `src/backend/node_modules/`: ✅ **exists** — `express`, `pg`, `zod` all present
- `src/frontend/node_modules/`: ✅ **exists** — `vite`, `vitest`, `react`, `recharts` all present
- `src/mcp-server/node_modules/`: ❌ **missing** — needs `npm install`

### Fix

Only the MCP server needs `npm install`. Backend and frontend are already installed.

---

## 7. IBM Bob Integration — Disabled by Default (Expected)

### Current state

`BOB_ENABLED` defaults to `false`. The backend and dashboard are **fully functional** without Bob credentials. The chat panel (screen S13) shows a clear "Bob unavailable" fallback message.

✅ **No action needed for the demo.**

To enable Bob (optional, requires credentials):

```bash
# In src/backend/.env:
BOB_ENABLED=true
BOB_API_URL=<your endpoint>
BOB_API_KEY=<your key>
```

---

## 8. Sensor Feed Staleness

### Current state

The seeded sensor readings end at anchor timestamp `2026-09-14T09:00:00Z`. When the frontend runs, cold-chain shipments will show **sensor-failure banners** because the latest reading is more than 2 sensor intervals (30 min) in the past.

This is **expected, documented behavior** — not a bug.

### Fix (demo only)

After the backend is running:

```bash
cd src/backend
node scripts/simulate-feed.js
# Posts fresh in-policy readings for S030 over 90 minutes
# Run npm run seed to restore the frozen baseline afterward
```

---

## 9. Port Conflicts

### Default ports used

| Service | Port | Check |
|---|---|---|
| PostgreSQL (Docker) | 5433 | `nc -z localhost 5433` |
| Backend (Express) | 3001 | `nc -z localhost 3001` |
| Frontend (Vite) | 5173 | `nc -z localhost 5173` |

### Current state

- Port 5433: **CLOSED** ✅ (no conflict)
- Port 3001: **CLOSED** ✅ (no conflict)
- Port 5173: **OPEN** ⚠️ — a **different project's** Vite server (`Practical_7/Frontend`) is currently running on this port. This will conflict when ChainSentinel's frontend starts.

### Fix

Stop the other Vite server before starting ChainSentinel's frontend.  
Alternatively, change the ChainSentinel frontend port in [`src/frontend/vite.config.js`](../src/frontend/vite.config.js):

```js
server: {
  port: 5174,  // change from 5173
  ...
}
```

---

## 10. What Works Right Now (No DB Needed)

| Check | Command | Result |
|---|---|---|
| Python tests | `cd src/data-generator && python3 -m unittest discover -s tests -t .` | **48/48 ✅** |
| Contract validator | `cd src/data-generator && python3 validate.py` | **PASS ✅** |
| Frontend tests | `cd src/frontend && npm test` | **49/49 ✅** |

---

## 11. Complete Setup Sequence (After Docker Is Installed)

```bash
# 1. Start the database
docker compose up -d
# Wait until: docker compose ps  →  db  ...  healthy

# 2. Backend: migrate and seed
cd src/backend
npm run migrate
npm run seed
node scripts/verify-seed.js
# Expected: matching PASS 15/15 · excursions PASS 14/14

# 3. Start the backend (keep this terminal open)
npm run dev
# Expected: ChainSentinel backend listening on 3001 (Phase 3)

# 4. Verify backend health
curl http://localhost:3001/api/health
# Expected: {"status":"ok","database":"up","bob":"disabled",...}

# 5. Start the frontend (new terminal)
cd src/frontend
npm run dev
# Open: http://localhost:5173

# 6. (Optional) Install and smoke-test the MCP server
cd src/mcp-server
npm install
npm run smoke
# Expected: 7/7 checks pass

# 7. (Optional) Refresh sensor feeds for demo
cd src/backend
node scripts/simulate-feed.js
```

---

## 12. Audit Verdict

| Item | Status | Action required |
|---|---|---|
| Docker | ❌ Not installed | **Install Docker Desktop** (or Homebrew PostgreSQL) |
| `src/backend/.env` | ⚠️ Missing (optional) | `cp src/.env.example src/backend/.env` (recommended) |
| `src/mcp-server/node_modules` | ❌ Missing | `cd src/mcp-server && npm install` |
| Node.js version | ✅ 26.7.0 (≥20) | None |
| Python version | ✅ 3.14.7 (≥3.11) | None |
| Backend `node_modules` | ✅ Installed | None |
| Frontend `node_modules` | ✅ Installed | None |
| Port 5433 | ✅ Free | None |
| Port 3001 | ✅ Free | None |
| Port 5173 | ⚠️ In use (other project) | Kill other Vite process before starting frontend |
| Bob credentials | ✅ Not needed (`BOB_ENABLED=false`) | None for demo |
| Python tests | ✅ Pass now | None |
| Frontend tests | ✅ Pass now | None |

**Only 3 actions are required to get the full project running:**

1. 🔴 **Install Docker** (or native PostgreSQL) — the root blocker
2. 🟡 **`cd src/mcp-server && npm install`** — needed for MCP smoke only
3. 🟡 **Kill the port-5173 conflict** before starting the frontend

No source code changes are needed.
