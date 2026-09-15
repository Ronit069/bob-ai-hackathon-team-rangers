import { nextEntityId } from "../common/ids.js";
import { fromPgError } from "../common/errors.js";

const toDate = (value) => (value == null ? null : new Date(value));

// ---------------------------------------------------------------------------
// Cargo profiles (B-1)
// ---------------------------------------------------------------------------
export async function insertCargoProfile(db, profile) {
  try {
    const { rows } = await db.query(
      `INSERT INTO cargo_profile (cargo_type, display_name, is_cold_chain, sensitivity_weight, policy_required, notes)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [
        profile.cargo_type,
        profile.display_name,
        profile.is_cold_chain,
        profile.sensitivity_weight,
        profile.policy_required,
        profile.notes ?? null,
      ],
    );
    return rows[0];
  } catch (error) {
    throw fromPgError(error);
  }
}

export async function getCargoProfile(db, cargoType) {
  const { rows } = await db.query("SELECT * FROM cargo_profile WHERE cargo_type = $1", [cargoType]);
  return rows[0] ?? null;
}

export async function listCargoProfiles(db) {
  const { rows } = await db.query("SELECT * FROM cargo_profile ORDER BY cargo_type");
  return rows;
}

// ---------------------------------------------------------------------------
// Temperature policies
// ---------------------------------------------------------------------------
export async function insertTemperaturePolicy(db, policy) {
  try {
    const { rows } = await db.query(
      `INSERT INTO temperature_policy (id, cargo_type, min_c, max_c, max_excursion_minutes,
                                       minor_deviation_c, major_deviation_c, critical_duration_minutes,
                                       version, effective_from, updated_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, COALESCE($12, now())) RETURNING *`,
      [
        policy.id,
        policy.cargo_type,
        policy.min_c,
        policy.max_c,
        policy.max_excursion_minutes,
        policy.minor_deviation_c,
        policy.major_deviation_c,
        policy.critical_duration_minutes,
        policy.version,
        toDate(policy.effective_from),
        policy.updated_by,
        policy.updated_at ? toDate(policy.updated_at) : null,
      ],
    );
    return rows[0];
  } catch (error) {
    throw fromPgError(error);
  }
}

export async function getTemperaturePolicy(db, id) {
  const { rows } = await db.query("SELECT * FROM temperature_policy WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function getLatestPolicyForCargo(db, cargoType) {
  const { rows } = await db.query(
    `SELECT * FROM temperature_policy
     WHERE cargo_type = $1
     ORDER BY version DESC
     LIMIT 1`,
    [cargoType],
  );
  return rows[0] ?? null;
}

export async function listTemperaturePolicies(db, { includeHistory = false } = {}) {
  const { rows } = await db.query(
    includeHistory
      ? "SELECT * FROM temperature_policy ORDER BY cargo_type, version DESC"
      : `SELECT DISTINCT ON (cargo_type) * FROM temperature_policy ORDER BY cargo_type, version DESC`,
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Sensor readings
// ---------------------------------------------------------------------------
export async function insertSensorReading(db, reading) {
  try {
    const { rows } = await db.query(
      `INSERT INTO sensor_reading (id, shipment_id, sensor_id, timestamp, temperature_c, humidity_pct, source, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8, now())) RETURNING *`,
      [
        reading.id,
        reading.shipment_id,
        reading.sensor_id,
        toDate(reading.timestamp),
        reading.temperature_c,
        reading.humidity_pct ?? null,
        reading.source,
        reading.created_at ? toDate(reading.created_at) : null,
      ],
    );
    return rows[0];
  } catch (error) {
    throw fromPgError(error);
  }
}

// Batch insert (endpoint 12): multi-row VALUES in chunks.
export async function insertSensorReadingsBatch(db, readings, batchSize = 200) {
  const columnCount = 8;
  let inserted = 0;
  for (let start = 0; start < readings.length; start += batchSize) {
    const batch = readings.slice(start, start + batchSize);
    const placeholders = [];
    const params = [];
    batch.forEach((reading, index) => {
      const base = index * columnCount;
      placeholders.push(
        `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},COALESCE($${base + 8}, now()))`,
      );
      params.push(
        reading.id,
        reading.shipment_id,
        reading.sensor_id,
        toDate(reading.timestamp),
        reading.temperature_c,
        reading.humidity_pct ?? null,
        reading.source,
        reading.created_at ? toDate(reading.created_at) : null,
      );
    });
    try {
      await db.query(
        `INSERT INTO sensor_reading (id, shipment_id, sensor_id, timestamp, temperature_c, humidity_pct, source, created_at)
         VALUES ${placeholders.join(",")}`,
        params,
      );
      inserted += batch.length;
    } catch (error) {
      throw fromPgError(error);
    }
  }
  return inserted;
}

// Latest reading per shipment (alerts / sensor health composition).
export async function listLatestReadingsByShipment(db) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (shipment_id) *
     FROM sensor_reading
     ORDER BY shipment_id, timestamp DESC`,
  );
  return rows;
}

export async function listReadingsByShipment(db, shipmentId, { from, to } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM sensor_reading
     WHERE shipment_id = $1
       AND ($2::timestamptz IS NULL OR timestamp >= $2)
       AND ($3::timestamptz IS NULL OR timestamp <= $3)
     ORDER BY timestamp ASC`,
    [shipmentId, from ? toDate(from) : null, to ? toDate(to) : null],
  );
  return rows;
}

// Per-shipment reading fingerprint (count + latest timestamp) used by the Phase 6
// evaluation write-throttle: unchanged fingerprints skip re-detection entirely.
export async function listReadingFingerprints(db, shipmentId = null) {
  const { rows } = await db.query(
    `SELECT shipment_id, count(*)::int AS count, max(timestamp) AS last_timestamp
     FROM sensor_reading
     WHERE ($1::text IS NULL OR shipment_id = $1)
     GROUP BY shipment_id`,
    [shipmentId],
  );
  return rows;
}

// Per-shipment persisted-excursion fingerprint. Including it in the throttle key makes
// external resets (e.g. `npm run seed` while the server is running) invalidate the memo,
// so stale skips can never hide wiped or deleted excursion rows.
export async function listExcursionFingerprints(db, shipmentId = null) {
  const { rows } = await db.query(
    `SELECT shipment_id, count(*)::int AS count, max(detected_at) AS last_detected
     FROM temperature_excursion
     WHERE ($1::text IS NULL OR shipment_id = $1)
     GROUP BY shipment_id`,
    [shipmentId],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Temperature excursions
// ---------------------------------------------------------------------------
export async function insertTemperatureExcursion(db, excursion) {
  try {
    const { rows } = await db.query(
      `INSERT INTO temperature_excursion (id, shipment_id, policy_id, start_time, end_time, peak_deviation_c,
                                          duration_min, severity, severity_rationale, data_quality,
                                          detected_at, status, post_delivery)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, COALESCE($11, now()), $12, COALESCE($13, false)) RETURNING *`,
      [
        excursion.id,
        excursion.shipment_id,
        excursion.policy_id ?? null,
        toDate(excursion.start_time),
        excursion.end_time ? toDate(excursion.end_time) : null,
        excursion.peak_deviation_c,
        excursion.duration_min,
        excursion.severity,
        excursion.severity_rationale,
        excursion.data_quality,
        excursion.detected_at ? toDate(excursion.detected_at) : null,
        excursion.status,
        excursion.post_delivery ?? null,
      ],
    );
    return rows[0];
  } catch (error) {
    throw fromPgError(error);
  }
}

export async function getTemperatureExcursion(db, id) {
  const { rows } = await db.query("SELECT * FROM temperature_excursion WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function listExcursions(db, { shipment_id, severity, status, active_only, limit = 200 } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM temperature_excursion
     WHERE ($1::text IS NULL OR shipment_id = $1)
       AND ($2::text IS NULL OR severity = $2)
       AND ($3::text IS NULL OR status = $3)
       AND ($4::boolean IS NOT TRUE OR (status <> 'closed' AND post_delivery = false))
     ORDER BY start_time DESC
     LIMIT $5`,
    [shipment_id ?? null, severity ?? null, status ?? null, active_only ?? null, limit],
  );
  return rows;
}

// Refresh evaluation fields of an existing excursion (status is never touched here).
export async function updateExcursionEvaluation(db, id, excursion) {
  try {
    const { rows } = await db.query(
      `UPDATE temperature_excursion
       SET policy_id = $2,
           end_time = $3,
           peak_deviation_c = $4,
           duration_min = $5,
           severity = $6,
           severity_rationale = $7,
           data_quality = $8,
           post_delivery = $9
       WHERE id = $1
       RETURNING *`,
      [
        id,
        excursion.policy_id ?? null,
        excursion.end_time ? toDate(excursion.end_time) : null,
        excursion.peak_deviation_c,
        excursion.duration_min,
        excursion.severity,
        excursion.severity_rationale,
        excursion.data_quality,
        excursion.post_delivery ?? false,
      ],
    );
    return rows[0] ?? null;
  } catch (error) {
    throw fromPgError(error);
  }
}

export async function updateExcursionStatus(db, id, { status, actor, note }) {
  try {
    const { rows } = await db.query(
      `UPDATE temperature_excursion
       SET status = $2
       WHERE id = $1
       RETURNING *`,
      [id, status],
    );
    return rows[0] ?? null;
  } catch (error) {
    throw fromPgError(error);
  }
}

export { nextEntityId };
