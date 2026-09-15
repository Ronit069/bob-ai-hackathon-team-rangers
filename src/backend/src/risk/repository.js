import { nextEntityId } from "../common/ids.js";
import { fromPgError } from "../common/errors.js";

const toDate = (value) => (value == null ? null : new Date(value));

export async function insertRiskAssessment(db, assessment) {
  try {
    const { rows } = await db.query(
      `INSERT INTO risk_assessment (id, shipment_id, disruption_risk, coldchain_risk, combined_score, factors, computed_at)
       VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7, now())) RETURNING *`,
      [
        assessment.id,
        assessment.shipment_id,
        assessment.disruption_risk,
        assessment.coldchain_risk,
        assessment.combined_score,
        JSON.stringify(assessment.factors),
        assessment.computed_at ? toDate(assessment.computed_at) : null,
      ],
    );
    return rows[0];
  } catch (error) {
    throw fromPgError(error);
  }
}

export async function getLatestRiskAssessment(db, shipmentId) {
  const { rows } = await db.query(
    `SELECT * FROM risk_assessment
     WHERE shipment_id = $1
     ORDER BY computed_at DESC, id DESC
     LIMIT 1`,
    [shipmentId],
  );
  return rows[0] ?? null;
}

export async function listRiskAssessments(db, { limit = 100 } = {}) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (shipment_id) *
     FROM risk_assessment
     ORDER BY shipment_id, computed_at DESC`,
  );
  return rows.slice(0, limit);
}

export { nextEntityId };
