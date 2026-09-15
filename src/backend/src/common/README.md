# common/ — shared backend infrastructure (SH)

Owner: shared. Placeholder in Phase 1A.

Planned contents (Phase 3):
- `config.js` — environment loading and validation (`PORT`, `DATABASE_URL`, `BOB_ENABLED`, `SEED`, `REDEPLOY_RADIUS_KM`, `RISK_ALPHA`, `RISK_BETA`, `SENSOR_INTERVAL_MIN`, `EXCURSION_GROUP_GAP_MINUTES`).
- `db.js` — PostgreSQL pool (`pg`).
- `errors.js` — standard error envelope (`VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT`, `SEMANTIC_ERROR`, `INTERNAL_ERROR`, `BOB_UNAVAILABLE`).
- `validate.js` — shared `zod` schemas for IDs, enums, timestamps.
- `logging.js` — structured request logging (technical logs, separate from the business audit trail).
