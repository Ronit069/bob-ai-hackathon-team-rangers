import { nextEntityId } from "../common/ids.js";
import { fromPgError } from "../common/errors.js";

// Append-only: there is intentionally no UPDATE or DELETE function in this module.
export async function appendAuditRecord(db, record) {
  try {
    const id = record.id ?? (await nextEntityId(db, "auditRecord"));
    const { rows } = await db.query(
      `INSERT INTO audit_record (id, entity_type, entity_id, action, actor, timestamp, details)
       VALUES ($1,$2,$3,$4,$5, COALESCE($6, now()), COALESCE($7, '{}'::jsonb)) RETURNING *`,
      [
        id,
        record.entity_type,
        record.entity_id,
        record.action,
        record.actor,
        record.timestamp ? new Date(record.timestamp) : null,
        record.details === undefined || record.details === null
          ? null
          : JSON.stringify(record.details),
      ],
    );
    return rows[0];
  } catch (error) {
    throw fromPgError(error);
  }
}

export async function listAuditRecords(db, { entity_type, entity_id, limit = 100, order = "desc" } = {}) {
  // `order` is enum-validated by the API layer before reaching this repository.
  const direction = order === "asc" ? "ASC" : "DESC";
  const { rows } = await db.query(
    `SELECT * FROM audit_record
     WHERE ($1::text IS NULL OR entity_type = $1)
       AND ($2::text IS NULL OR entity_id = $2)
     ORDER BY timestamp ${direction}, id ${direction}
     LIMIT $3`,
    [entity_type ?? null, entity_id ?? null, limit],
  );
  return rows;
}

export { nextEntityId };
