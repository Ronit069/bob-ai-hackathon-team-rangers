import { nextEntityId } from "../common/ids.js";
import { fromPgError } from "../common/errors.js";

// Recommendation lifecycle data access (shared P4). No UPDATE/DELETE beyond the
// single pending -> decided transition; audit records are written by the caller.

const toDate = (value) => (value == null ? null : new Date(value));

export async function insertRecommendation(db, recommendation) {
  try {
    const { rows } = await db.query(
      `INSERT INTO recommendation (id, type, shipment_id, route_id, carrier_id, asset_id,
                                   score, factors, constraints_checked, rejected_alternatives,
                                   status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, COALESCE($12, now())) RETURNING *`,
      [
        recommendation.id,
        recommendation.type,
        recommendation.shipment_id,
        recommendation.route_id ?? null,
        recommendation.carrier_id ?? null,
        recommendation.asset_id ?? null,
        recommendation.score,
        // jsonb params must be JSON strings: node-postgres would otherwise encode
        // JS arrays as Postgres array literals (invalid jsonb).
        JSON.stringify(recommendation.factors),
        JSON.stringify(recommendation.constraints_checked),
        JSON.stringify(recommendation.rejected_alternatives),
        recommendation.status,
        recommendation.created_at ? toDate(recommendation.created_at) : null,
      ],
    );
    return rows[0];
  } catch (error) {
    throw fromPgError(error);
  }
}

export async function getRecommendation(db, id) {
  const { rows } = await db.query("SELECT * FROM recommendation WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function listRecommendations(db, { shipment_id, status, type, limit = 200 } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM recommendation
     WHERE ($1::text IS NULL OR shipment_id = $1)
       AND ($2::text IS NULL OR status = $2)
       AND ($3::text IS NULL OR type = $3)
     ORDER BY created_at DESC, id DESC
     LIMIT $4`,
    [shipment_id ?? null, status ?? null, type ?? null, limit],
  );
  return rows;
}

// Single state transition; returns null when the recommendation is not pending.
export async function updateRecommendationDecision(db, id, { status, actor, notes }) {
  try {
    const { rows } = await db.query(
      `UPDATE recommendation
       SET status = $2, decided_at = now(), decided_by = $3, notes = COALESCE($4, notes)
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [id, status, actor, notes ?? null],
    );
    return rows[0] ?? null;
  } catch (error) {
    throw fromPgError(error);
  }
}

// Duplicate guard for endpoints 24/25: same shipment + type + target still pending.
export async function findPendingDuplicate(db, { shipment_id, type, route_id, carrier_id, asset_id }) {
  const { rows } = await db.query(
    `SELECT * FROM recommendation
     WHERE shipment_id = $1 AND type = $2 AND status = 'pending'
       AND route_id IS NOT DISTINCT FROM $3
       AND carrier_id IS NOT DISTINCT FROM $4
       AND asset_id IS NOT DISTINCT FROM $5
     LIMIT 1`,
    [shipment_id, type, route_id ?? null, carrier_id ?? null, asset_id ?? null],
  );
  return rows[0] ?? null;
}

export { nextEntityId };
