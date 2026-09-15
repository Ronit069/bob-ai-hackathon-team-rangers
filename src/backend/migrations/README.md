# migrations/ — numbered SQL migrations

Phase 1A placeholder. No migrations written yet (Phase 2).

Rules (ADR-003 / data-contract §16):
- One numbered `.sql` file per change: `001_init_logistics.sql`, `002_init_coldchain.sql`, …
- Additive changes only during the MVP; schema changes require a contract update + both members' approval.
- Applied by `npm run migrate` in filename order; never edit an applied migration — add a new one.
- Schema source of truth: `docs/phase-0/data-contract.md` (including §17 Phase 1A amendments A-3/B-1/B-6/RC-3).
