# Demo Screenshots

**SUBMISSION-TIME ITEM:** Capture and add at least 3 screenshots of the running application before the submission deadline. Name them sequentially as listed below.

Screenshots must show the actual running application against real data (not mocked). The submission template guide requires ≥ 3 screenshots.

## Required Captures (≥ 3 minimum; 5 captured, 3 more recommended)

| Filename | Screen | What to show |
|---|---|---|
| `01_Overview.png` | S1 Overview | Risk worklist with S039 at the top (combined score 0.728), active disruptions, alert counts |
| `02_AffectedShipments.png` | S3 Affected Shipments | D01 affected list — S039 critical, match reason, impact score |
| `03_Alternatives.png` | S5 Route/Carrier Comparison | Ranked alternatives with factor breakdown and rejected panel |
| `04_Disruptions.png` | S2 Disruptions | All disruptions — active/scheduled/resolved with the ACTIVE NOW window column |
| `05_BobChat.png` | S13 Bob Chat | Grounded answer with evidence panel (S039 combined risk 0.728) |
| `06-fleet-redeployment.png` | S6/S7 Fleet + Redeployment | Idle assets list; redeployment candidates for S039 |
| `07-coldchain-excursion.png` | S10 Excursion Detail | An open excursion with severity rationale (e.g. major `duration>tolerance`) |
| `08-audit-trail.png` | S14 Audit | Audit trail after a recommendation has been approved |

## How to Capture

With both `npm run dev` (backend `:3001`) and `npm run dev` (frontend `:5173`) running:

1. Run the demo freshness simulator first to clear sensor-failure banners:
   ```bash
   cd src/backend && node scripts/simulate-feed.js
   ```
2. Navigate to each screen and capture using your OS screenshot tool.
3. Add the PNG files to this directory (`demo/screenshots/`).
4. Verify each screenshot shows real data (not a loading or empty state).

## Demo Reset

To restore the exact fixture baseline before re-capturing:

```bash
cd src/backend && npm run seed
```
