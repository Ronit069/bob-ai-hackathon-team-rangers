# logistics/ — Member 1 module (M1)

Owner: Member 1. Placeholder in Phase 1A.

Planned contents (Phases 3–4):
- Disruption CRUD + activation + audit.
- Affected shipment detection (region matching + A-1 planned-window filter + impact status/score).
- Route and carrier alternatives (hard filters H1–H8, weighted score, explanations, rejected lists).
- Fleet state derivation + idle detection (A-7 future-commitment blocking).
- Redeployment candidates (compatibility, haversine radius, contention).
- Recommendation creation (`POST /api/recommendations`, `POST /api/fleet/redeployments/recommend`).

Contracts: `docs/phase-0/member-1-logistics-api.md`, `docs/phase-0/api-contract.md` §3.1–3.11, §7.
