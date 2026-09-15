-- 004_shared.sql
-- Shared entities (data-contract.md §12–§14 + RC-3 nested factors).

-- ---------------------------------------------------------------------------
-- recommendation (§12)
-- ---------------------------------------------------------------------------
CREATE TABLE recommendation (
  id                    text PRIMARY KEY CHECK (id ~ '^REC-[0-9]{4}$'),
  type                  text NOT NULL CHECK (type IN ('reroute', 'carrier_change', 'fleet_redeployment')),
  shipment_id           text NOT NULL REFERENCES shipment (id),
  route_id              text REFERENCES route (id),
  carrier_id            text REFERENCES carrier (id),
  asset_id              text REFERENCES fleet_asset (id),
  score                 numeric(4,3) NOT NULL CHECK (score BETWEEN 0 AND 1),
  factors               jsonb NOT NULL,
  constraints_checked   jsonb NOT NULL,
  rejected_alternatives jsonb NOT NULL,
  status                text NOT NULL CHECK (status IN ('pending', 'accepted', 'rejected', 'modified')),
  created_at            timestamptz NOT NULL DEFAULT now(),
  decided_at            timestamptz,
  decided_by            text,
  notes                 text,
  -- Exactly one target per type (data-contract.md §12).
  CONSTRAINT recommendation_target_coherence CHECK (
    (type = 'reroute'           AND route_id   IS NOT NULL AND carrier_id IS NULL     AND asset_id IS NULL) OR
    (type = 'carrier_change'    AND carrier_id IS NOT NULL AND route_id   IS NULL     AND asset_id IS NULL) OR
    (type = 'fleet_redeployment' AND asset_id  IS NOT NULL AND route_id   IS NULL     AND carrier_id IS NULL)
  )
);

-- ---------------------------------------------------------------------------
-- risk_assessment (§13, factors nested per RC-3)
-- ---------------------------------------------------------------------------
CREATE TABLE risk_assessment (
  id              text PRIMARY KEY CHECK (id ~ '^RSK-[0-9]{4}$'),
  shipment_id     text NOT NULL REFERENCES shipment (id),
  disruption_risk numeric(4,3) NOT NULL CHECK (disruption_risk BETWEEN 0 AND 1),
  coldchain_risk  numeric(4,3) NOT NULL CHECK (coldchain_risk BETWEEN 0 AND 1),
  combined_score  numeric(4,3) NOT NULL CHECK (combined_score BETWEEN 0 AND 1),
  factors         jsonb NOT NULL,
  computed_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- audit_record (§14) — append-only (no UPDATE/DELETE path in code)
-- ---------------------------------------------------------------------------
CREATE TABLE audit_record (
  id          text PRIMARY KEY CHECK (id ~ '^AUD-[0-9]{6}$'),
  entity_type text NOT NULL CHECK (entity_type IN (
                'shipment', 'route', 'carrier', 'disruption', 'fleet_asset', 'sensor_reading',
                'temperature_policy', 'temperature_excursion', 'recommendation', 'risk_assessment')),
  entity_id   text NOT NULL,
  action      text NOT NULL CHECK (action IN (
                'created', 'updated', 'activated', 'deactivated', 'ingested', 'policy_updated',
                'decided_accepted', 'decided_rejected', 'decided_modified', 'acknowledged', 'closed')),
  actor       text NOT NULL CHECK (length(trim(actor)) > 0),
  timestamp   timestamptz NOT NULL DEFAULT now(),
  details     jsonb NOT NULL DEFAULT '{}'::jsonb
);
