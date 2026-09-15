# risk/ — combined risk engine (shared)

Owner: shared (M1 + M2). Placeholder in Phase 1A.

Planned contents (Phase 4):
- Combined score: `combined_score = α·disruption_risk + β·coldchain_risk` (defaults 0.5/0.5, configurable).
- Snapshot persistence in `risk_assessment` (history retained; latest returned).
- Nested factors (RC-3): `{ disruption: {...}, coldchain: {...}, weights: {...} }`.
- `GET /api/shipments/:id/risk`, `GET /api/risk/overview` (ranked worklist).

Boundary: reads logistics + cold-chain tables; owns only `risk_assessment`; never mutates domain data.
Contract: `docs/phase-0/member-2-combined-risk.md`, `docs/phase-0/api-contract.md` §3.18–3.19.
