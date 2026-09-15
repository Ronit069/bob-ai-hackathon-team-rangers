# audit/ — append-only audit + decisions (shared)

Owner: shared. Placeholder in Phase 1A.

Planned contents (Phase 3):
- Append-only `audit_record` writes (no UPDATE/DELETE path anywhere).
- `GET /api/audit` (entity filters, newest first).
- `POST /api/recommendations/:id/decision` (single transition `pending → accepted|rejected|modified`, `409` on repeat).
- `PATCH /api/excursions/:id` review transitions (`open → acknowledged → closed`, B-7).

Recorded actions: created, updated, activated, deactivated, ingested, policy_updated, decided_accepted, decided_rejected, decided_modified, acknowledged, closed.
Contract: `docs/phase-0/api-contract.md` §3.21–3.22, §7 (B-7).
