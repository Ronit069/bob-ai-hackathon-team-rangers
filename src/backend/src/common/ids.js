// Runtime ID generation per the data contract (IDs are prefixed and sequential).
// Prefixes include the dash where the contract requires it (SEG-, AA-, SR-, EX-, REC-, RSK-, AUD-).
export const ID_SPECS = {
  shipment: { prefix: "S", width: 3 },
  route: { prefix: "R", width: 3 },
  routeSegment: { prefix: "SEG-", width: 3 },
  carrier: { prefix: "C", width: 2 },
  disruption: { prefix: "D", width: 2 },
  fleetAsset: { prefix: "A", width: 3 },
  assetAssignment: { prefix: "AA-", width: 4 },
  sensorReading: { prefix: "SR-", width: 6 },
  temperatureExcursion: { prefix: "EX-", width: 4 },
  recommendation: { prefix: "REC-", width: 4 },
  riskAssessment: { prefix: "RSK-", width: 4 },
  auditRecord: { prefix: "AUD-", width: 6 },
};

export async function nextId(db, prefix, width) {
  const { rows } = await db.query(
    `INSERT INTO id_sequence (prefix, last_value)
     VALUES ($1, 1)
     ON CONFLICT (prefix) DO UPDATE SET last_value = id_sequence.last_value + 1
     RETURNING last_value`,
    [prefix],
  );
  return `${prefix}${String(rows[0].last_value).padStart(width, "0")}`;
}

export async function nextEntityId(db, entity) {
  const spec = ID_SPECS[entity];
  if (!spec) throw new Error(`Unknown entity for ID generation: ${entity}`);
  return nextId(db, spec.prefix, spec.width);
}
