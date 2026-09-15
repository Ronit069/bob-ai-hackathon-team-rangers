# scripts/ — migrate, seed, validate, verify-seed, simulate-feed

| Script | Purpose |
|---|---|
| `migrate.js` | apply numbered SQL migrations in order |
| `seed.js` | load `data/seed/*.json` transactionally (all-or-nothing; truncates by default, `--keep` to append) |
| `validate.js` | fast pre-seed referential check |
| `verify-seed.js` | compare the JS services against the Python ground truth (`matching` + `excursions`) |
| `simulate-feed.js` | demo freshness: post current, in-policy readings for one cold-chain shipment (Phase 6 / F2) |

Rules: seeding is deterministic (fixed `SEED`); the validator must pass before seeding; fixtures and ground truth follow `docs/phase-0/data-contract.md` §15/§17.

## Demo freshness simulator (`simulate-feed.js`)

**Why:** seeded sensor feeds end at the fixture anchor +6 h. After that the frozen
staleness rule (no reading for ≥ 4 × interval) reports every cold shipment as a
sensor failure, which hides the reporting scenarios in the demo UI.

**Run** (backend must be running):

```bash
node scripts/simulate-feed.js                       # default: S030, 90 min, 15-min interval
node scripts/simulate-feed.js --shipment=S030 --minutes=120 --interval=15 --base-url=http://localhost:3001
```

**Effect on demo freshness:**
- Appends current readings through the existing ingestion endpoint (`POST /api/sensor-readings`) — no server or contract change.
- The chosen shipment's sensor status flips to `reporting` and its `sensor_failure` alert clears; other shipments keep their seeded state (including the deliberate S031 failure).
- Temperatures stay inside the shipment's policy band, so **no excursion is created or modified**.
- `data/seed/*` fixtures and ground truth are never touched. To restore the exact baseline (e.g. before `verify-seed.js`), run `npm run seed` — it truncates and reloads.
