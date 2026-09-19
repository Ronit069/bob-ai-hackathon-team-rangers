# 🚀 ChainSentinel — Supply Chain Disruption Assistant & Fleet Utilisation Optimizer

---

## 👥 Team

| Field | Value |
|---|---|
| **Team Name** | Rangers And |
| **Track** | AI |
| **Team Lead** | Ronit Padia - (24ce069@charusat.edu.in) |
| **Members** | Dhruv Parmar, Anshkumar Darji, Jashkumar Baldha |

---

## 🎯 Problem Statement

Mid-size freight operators lose visibility during supply-chain disruptions because disruption impact, fleet idle capacity, and cold-chain sensor integrity are tracked in separate tools. A port strike, weather event, or geopolitical crisis cascades across hundreds of shipments — but identifying which shipments are affected, which assets are idle and compatible, and whether cold-chain cargo is at risk requires hours of manual cross-referencing. By the time a temperature excursion is found, the cargo may already be a write-off.

---

## 💡 Solution

ChainSentinel is a Bob-powered logistics control tower that turns a declared disruption into a ranked, explainable, human-approved action plan. It unifies affected-shipment detection, route and carrier alternatives, fleet redeployment, and cold-chain monitoring into one dashboard, merged into a single combined disruption + cold-chain priority score. A grounded IBM Bob assistant answers operator questions through backend tool calls with raw evidence always visible, and every recommendation requires human approval recorded in an append-only audit trail.

---

## ✨ Key Features

- **Disruption management:** create, activate, and resolve disruptions with real-time affected-shipment detection and match reasons.
- **Ranked route and carrier alternatives:** transparent scoring, capacity checks, factor breakdowns, and rejected-alternative explanations.
- **Fleet redeployment:** idle detection (availability, reservations, compatibility rules) and ranked redeployment candidate scoring.
- **Cold-chain monitoring:** sensor ingestion with data-quality flags (gaps, duplicates, out-of-order, implausible) and per-shipment sensor health.
- **Excursion detection:** temperature excursion detection and severity classification (Warning / Major / Critical / Unknown-Review) against configurable temperature policies.
- **Combined priority score:** `combined_score = 0.5 × disruption_risk + 0.5 × coldchain_risk` produces one ranked worklist across both domains.
- **Human-approval lifecycle:** pending → accepted / rejected / modified, with an append-only audit trail for every decision.
- **Grounded Bob assistant:** 11 read-only MCP tools with evidence shown alongside every answer; the dashboard is fully functional when Bob is unavailable.
- **AI Incident Commander (Feature 2):** the configured LLM (Granite/watsonx, Gemini or Groq) investigates via the frozen read-only MCP tools and generates the grounded incident brief; proposals stop at human approval, unknown or ambiguous requests ask for clarification instead of guessing, and everything degrades safely to the deterministic engine when no provider is available.

---

## 🛠️ Tech Stack

| Category | Technologies |
|---|---|
| **Languages** | JavaScript (ESM), Python 3.11, SQL |
| **Frameworks** | Node.js 20 + Express 4, React 18 + Vite 5, React Router 6, Recharts, zod |
| **IBM Technologies** | IBM Bob (MCP stdio tool server — 11 read-only tools + grounded LLM chat) · IBM Granite on watsonx.ai (`ibm/granite-4-h-small`; IAM-token auth, grounding-checked output) |
| **Databases** | PostgreSQL 16 (Docker Compose) |
| **Other** | Docker, pg (no ORM), plain CSS, Node/Python standard-library test runners |

---

## 📁 Repository Structure

```
├── src/                  # All source code
│   ├── backend/          # Node.js 20 + Express 4 API (28 endpoints, 147 tests)
│   ├── frontend/         # React 18 + Vite 5 dashboard (14 screens, 49 tests)
│   ├── mcp-server/       # Node.js stdio MCP adapter (11 read-only tools)
│   └── data-generator/   # Python 3.11 fixture generator + validator (48 tests)
├── docs/                 # Written documentation
│   ├── problem-statement.md
│   ├── solution-overview.md
│   ├── architecture.md
│   └── setup-guide.md
├── data/seed/            # Pre-generated fixtures + ground truth (frozen, deterministic)
├── demo/                 # Demo artifacts
│   ├── screenshots/      # App screenshots
│   └── demo-video-link.txt  # Link to demo video
├── presentation/         # Slide deck
├── docker-compose.yml    # Local PostgreSQL 16
└── submission.yaml       # Structured submission metadata
```

---

## ⚡ How to Run

```bash
# 1. Clone the repo
git clone https://github.com/Ronit069/bob-ai-hackathon-team-rangers.git
cd bob-ai-hackathon-team-rangers

# 2. Install dependencies and start the database
docker compose up -d
cp src/.env.example src/backend/.env
cd src/backend
npm install
npm run migrate
npm run seed

# 3. Configure environment
# Defaults work out of the box. Edit src/backend/.env only if port 5433 is taken (see docs/setup-guide.md).

# 4. Run the project (two terminals)
cd src/backend && npm run dev     # backend on :3001
cd src/frontend && npm run dev    # dashboard on http://localhost:5173
```

---

## 🖥️ Demo

| Artifact | Link |
|---|---|
| 📹 Demo Video | [See demo/demo-video-link.txt](demo/demo-video-link.txt) |
| 🌐 Live Demo | [See demo/live-demo-url.txt](demo/live-demo-url.txt) |
| 🖼️ Screenshots | [See demo/screenshots/](demo/screenshots/) |
| 📊 Presentation | [See presentation/slides.pdf](presentation/) |

---

## ⚠️ Known Limitations

- **Synthetic data only.** No real shipment, carrier, sensor, or regulatory dataset is used or claimed.
- **No ML.** All logic is deterministic rules and transparent weighted scoring. ML is explicitly deferred.
- **Policy thresholds are illustrative.** Temperature policy values are configurable placeholders, not regulatory benchmarks.
- **Bob grounding reduces but does not eliminate hallucination risk.** Tool-only answers and visible evidence mitigate this, but live Bob behavior requires active credentials to verify fully.
- **Single trusted operator.** No authentication, authorization, or multi-tenant isolation.
- **Local-only deployment.** No cloud hosting or public URL.
- **Sensor feeds age out.** After the fixture anchor (+6 h), cold shipments show sensor-failure banners. Run `node scripts/simulate-feed.js` to refresh, or `npm run seed` to reset.
- **Region-code matching.** Disruption–shipment matching uses string region codes, not geographic polygons.
- **Post-delivery excursion records (F3) deferred.** Post-delivery breach exclusion is implemented and tested; the stored history record (`post_delivery: true`) is not yet emitted.

---

## 🏅 What We're Most Proud Of

- **Combined disruption + cold-chain priority engine** — the `combined_score` oracle (S039 = 0.728) is asserted identically across REST, MCP tool, stdio server, and grounding smoke.
- **Explainable recommendations with rejected alternatives** — every score is decomposable into factors on screen; every rejected option shows the constraint that failed.
- **Grounded Bob evidence** — raw tool JSON always visible beside answers; any mismatch is immediately visible to the operator.
- **Cross-language ground truth** — 48 Python ground-truth scenarios verified against the JS services by `verify-seed.js`; the oracle is reproducible with a fixed seed.
- **Full state coverage in the frontend** — every screen handles loading, empty, validation error, unexpected error, 503 Bob fallback, unknown/review, not-actionable, and conflict states.

---
