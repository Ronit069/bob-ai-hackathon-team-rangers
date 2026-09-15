import { nextEntityId } from "../common/ids.js";
import { fromPgError } from "../common/errors.js";

const toDate = (value) => (value == null ? null : new Date(value));

// ---------------------------------------------------------------------------
// Carriers
// ---------------------------------------------------------------------------
export async function insertCarrier(db, carrier) {
  try {
    const { rows } = await db.query(
      `INSERT INTO carrier (id, name, service_regions, modes, capacity_units, cost_index, reliability_score, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        carrier.id,
        carrier.name,
        carrier.service_regions,
        carrier.modes,
        carrier.capacity_units,
        carrier.cost_index,
        carrier.reliability_score,
        carrier.status,
      ],
    );
    return rows[0];
  } catch (error) {
    throw fromPgError(error);
  }
}

export async function getCarrier(db, id) {
  const { rows } = await db.query("SELECT * FROM carrier WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function listCarriers(db, { status, region_code, mode, limit = 100 } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM carrier
     WHERE ($1::text IS NULL OR status = $1)
       AND ($2::text IS NULL OR $2 = ANY(service_regions))
       AND ($3::text IS NULL OR $3 = ANY(modes))
     ORDER BY id
     LIMIT $4`,
    [status ?? null, region_code ?? null, mode ?? null, limit],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
export async function insertRoute(db, route) {
  try {
    const { rows } = await db.query(
      `INSERT INTO route (id, origin_node, destination_node, carrier_id, status,
                          total_distance_km, planned_duration_hours, planned_cost_usd, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9, now())) RETURNING *`,
      [
        route.id,
        route.origin_node,
        route.destination_node,
        route.carrier_id,
        route.status,
        route.total_distance_km,
        route.planned_duration_hours,
        route.planned_cost_usd,
        route.created_at ? toDate(route.created_at) : null,
      ],
    );
    return rows[0];
  } catch (error) {
    throw fromPgError(error);
  }
}

export async function getRoute(db, id) {
  const { rows } = await db.query("SELECT * FROM route WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function listRoutes(db, { status, carrier_id, limit = 200 } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM route
     WHERE ($1::text IS NULL OR status = $1)
       AND ($2::text IS NULL OR carrier_id = $2)
     ORDER BY id
     LIMIT $3`,
    [status ?? null, carrier_id ?? null, limit],
  );
  return rows;
}

export async function listRoutesByOD(db, originNode, destinationNode) {
  const { rows } = await db.query(
    "SELECT * FROM route WHERE origin_node = $1 AND destination_node = $2 ORDER BY id",
    [originNode, destinationNode],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Route segments
// ---------------------------------------------------------------------------
export async function insertRouteSegment(db, segment) {
  try {
    const { rows } = await db.query(
      `INSERT INTO route_segment (id, route_id, seq, name, region_code, mode, origin_node, destination_node,
                                  distance_km, planned_duration_hours, capacity_units, cost_usd, dest_lat, dest_lon)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [
        segment.id,
        segment.route_id,
        segment.seq,
        segment.name,
        segment.region_code,
        segment.mode,
        segment.origin_node,
        segment.destination_node,
        segment.distance_km,
        segment.planned_duration_hours,
        segment.capacity_units,
        segment.cost_usd,
        segment.dest_lat,
        segment.dest_lon,
      ],
    );
    return rows[0];
  } catch (error) {
    throw fromPgError(error);
  }
}

export async function getRouteSegment(db, id) {
  const { rows } = await db.query("SELECT * FROM route_segment WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function listSegmentsByRoute(db, routeId) {
  const { rows } = await db.query("SELECT * FROM route_segment WHERE route_id = $1 ORDER BY seq", [routeId]);
  return rows;
}

export async function listAllSegments(db) {
  const { rows } = await db.query("SELECT * FROM route_segment ORDER BY route_id, seq");
  return rows;
}

// ---------------------------------------------------------------------------
// Shipments
// ---------------------------------------------------------------------------
export async function insertShipment(db, shipment) {
  try {
    const { rows } = await db.query(
      `INSERT INTO shipment (id, route_id, cargo_type, is_cold_chain, cargo_value_usd, volume_units, deadline,
                             status, current_segment_id, planned_departure, planned_arrival,
                             actual_departure, actual_arrival, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, COALESCE($14, now()), COALESCE($15, now()))
       RETURNING *`,
      [
        shipment.id,
        shipment.route_id,
        shipment.cargo_type,
        shipment.is_cold_chain,
        shipment.cargo_value_usd,
        shipment.volume_units,
        toDate(shipment.deadline),
        shipment.status,
        shipment.current_segment_id ?? null,
        toDate(shipment.planned_departure),
        toDate(shipment.planned_arrival),
        shipment.actual_departure ? toDate(shipment.actual_departure) : null,
        shipment.actual_arrival ? toDate(shipment.actual_arrival) : null,
        shipment.created_at ? toDate(shipment.created_at) : null,
        shipment.updated_at ? toDate(shipment.updated_at) : null,
      ],
    );
    return rows[0];
  } catch (error) {
    throw fromPgError(error);
  }
}

export async function getShipment(db, id) {
  const { rows } = await db.query("SELECT * FROM shipment WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function listShipments(db, { status, is_cold_chain, region_code, limit = 200 } = {}) {
  const { rows } = await db.query(
    `SELECT s.* FROM shipment s
     WHERE ($1::text IS NULL OR s.status = $1)
       AND ($2::boolean IS NULL OR s.is_cold_chain = $2)
       AND ($3::text IS NULL OR EXISTS (
             SELECT 1 FROM route_segment rs
             WHERE rs.id = s.current_segment_id AND rs.region_code = $3))
     ORDER BY s.id
     LIMIT $4`,
    [status ?? null, is_cold_chain ?? null, region_code ?? null, limit],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Disruptions
// ---------------------------------------------------------------------------
export async function insertDisruption(db, disruption) {
  try {
    const { rows } = await db.query(
      `INSERT INTO disruption (id, type, region_code, start_time, end_time, severity, status,
                               description, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, COALESCE($10, now())) RETURNING *`,
      [
        disruption.id,
        disruption.type,
        disruption.region_code,
        toDate(disruption.start_time),
        disruption.end_time ? toDate(disruption.end_time) : null,
        disruption.severity,
        disruption.status,
        disruption.description,
        disruption.created_by,
        disruption.created_at ? toDate(disruption.created_at) : null,
      ],
    );
    return rows[0];
  } catch (error) {
    throw fromPgError(error);
  }
}

export async function getDisruption(db, id) {
  const { rows } = await db.query("SELECT * FROM disruption WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function listDisruptions(db, { status, region_code, limit = 100 } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM disruption
     WHERE ($1::text IS NULL OR status = $1)
       AND ($2::text IS NULL OR region_code = $2)
     ORDER BY start_time DESC
     LIMIT $3`,
    [status ?? null, region_code ?? null, limit],
  );
  return rows;
}

export async function listActiveDisruptions(db, now = new Date()) {
  const { rows } = await db.query(
    `SELECT * FROM disruption
     WHERE status = 'active'
       AND start_time <= $1
       AND (end_time IS NULL OR end_time >= $1)
     ORDER BY severity DESC, id`,
    [now],
  );
  return rows;
}

// Partial update (endpoint 4). Only provided fields are changed.
export async function updateDisruption(db, id, patch) {
  try {
    const { rows } = await db.query(
      `UPDATE disruption
       SET status = COALESCE($2, status),
           end_time = COALESCE($3, end_time),
           severity = COALESCE($4, severity),
           description = COALESCE($5, description)
       WHERE id = $1
       RETURNING *`,
      [
        id,
        patch.status ?? null,
        patch.end_time ? toDate(patch.end_time) : null,
        patch.severity ?? null,
        patch.description ?? null,
      ],
    );
    return rows[0] ?? null;
  } catch (error) {
    throw fromPgError(error);
  }
}

// ---------------------------------------------------------------------------
// Fleet assets
// ---------------------------------------------------------------------------
export async function insertFleetAsset(db, asset) {
  try {
    const { rows } = await db.query(
      `INSERT INTO fleet_asset (id, type, capacity_units, refrigerated, current_lat, current_lon,
                                current_region_code, status, available_since, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, COALESCE($10, now())) RETURNING *`,
      [
        asset.id,
        asset.type,
        asset.capacity_units,
        asset.refrigerated,
        asset.current_lat,
        asset.current_lon,
        asset.current_region_code,
        asset.status,
        asset.available_since ? toDate(asset.available_since) : null,
        asset.created_at ? toDate(asset.created_at) : null,
      ],
    );
    return rows[0];
  } catch (error) {
    throw fromPgError(error);
  }
}

export async function getFleetAsset(db, id) {
  const { rows } = await db.query("SELECT * FROM fleet_asset WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export async function listFleetAssets(db, { status, type, region_code, limit = 200 } = {}) {
  const { rows } = await db.query(
    `SELECT * FROM fleet_asset
     WHERE ($1::text IS NULL OR status = $1)
       AND ($2::text IS NULL OR type = $2)
       AND ($3::text IS NULL OR current_region_code = $3)
     ORDER BY id
     LIMIT $4`,
    [status ?? null, type ?? null, region_code ?? null, limit],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Asset assignments
// ---------------------------------------------------------------------------
export async function insertAssetAssignment(db, assignment) {
  try {
    const { rows } = await db.query(
      `INSERT INTO asset_assignment (id, asset_id, shipment_id, start_time, end_time, reserved, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8, now())) RETURNING *`,
      [
        assignment.id,
        assignment.asset_id,
        assignment.shipment_id,
        toDate(assignment.start_time),
        toDate(assignment.end_time),
        assignment.reserved,
        assignment.status,
        assignment.created_at ? toDate(assignment.created_at) : null,
      ],
    );
    return rows[0];
  } catch (error) {
    throw fromPgError(error);
  }
}

export async function listAssignmentsByAsset(db, assetId) {
  const { rows } = await db.query(
    "SELECT * FROM asset_assignment WHERE asset_id = $1 ORDER BY start_time",
    [assetId],
  );
  return rows;
}

export async function listAllAssignments(db) {
  const { rows } = await db.query("SELECT * FROM asset_assignment ORDER BY asset_id, start_time");
  return rows;
}

// ---------------------------------------------------------------------------
// ID helper re-export (runtime records)
// ---------------------------------------------------------------------------
export { nextEntityId };
