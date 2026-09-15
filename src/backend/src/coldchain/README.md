# coldchain/ — Member 2 module (M2)

Owner: Member 2. Placeholder in Phase 1A.

Planned contents (Phases 3–4):
- Sensor ingestion (`POST /api/sensor-readings`, batch ≤ 500, partial rejection).
- Quality checks: dedupe, reorder, gaps (> 30 min), sensor failure (≥ 60 min), implausible (−40..60 °C).
- Excursion detection: boundary-inclusive thresholds, grouping (B-3), duration/peak, delivery cutoff (B-5).
- Severity classification (B-8 ladder): warning / major / critical / unknown_review with rationale.
- Temperature policy management (versioned + audited).
- Alerts (excursions + sensor failures) and review lifecycle (`PATCH /api/excursions/:id`, B-7).
- Cold-chain risk contribution (severity weights, nested factors RC-3).

Contracts: `docs/phase-0/member-2-coldchain-api.md`, `docs/phase-0/api-contract.md` §3.12–3.17, §7.
