-- 002_logistics.sql
-- Logistics entities (data-contract.md §2–§8 + Phase 1A amendments A-3/A-7).
-- Region vocabulary is fixed by data-contract.md §1.1.

-- ---------------------------------------------------------------------------
-- carrier (§5)
-- ---------------------------------------------------------------------------
CREATE TABLE carrier (
  id                text PRIMARY KEY CHECK (id ~ '^C[0-9]{2}$'),
  name              text NOT NULL CHECK (length(trim(name)) > 0),
  service_regions   text[] NOT NULL CHECK (cardinality(service_regions) >= 1),
  modes             text[] NOT NULL CHECK (cardinality(modes) >= 1),
  capacity_units    integer NOT NULL CHECK (capacity_units > 0),
  cost_index        numeric(4,2) NOT NULL CHECK (cost_index BETWEEN 0.50 AND 2.00),
  reliability_score numeric(3,2) NOT NULL CHECK (reliability_score BETWEEN 0.00 AND 1.00),
  status            text NOT NULL CHECK (status IN ('active', 'inactive')),
  CONSTRAINT carrier_regions_vocabulary CHECK (
    service_regions <@ ARRAY['IN-WEST-COAST','AE-JEBEL-ALI','SG-SINGAPORE','CN-EAST-COAST',
                             'US-WEST-COAST','EU-ROTTERDAM','US-EAST-COAST','IN-NORTH-ICD']::text[]
  ),
  CONSTRAINT carrier_modes_vocabulary CHECK (
    modes <@ ARRAY['sea','road','rail','air']::text[]
  )
);

-- ---------------------------------------------------------------------------
-- route (§3)
-- ---------------------------------------------------------------------------
CREATE TABLE route (
  id                     text PRIMARY KEY CHECK (id ~ '^R[0-9]{3}$'),
  origin_node            text NOT NULL CHECK (length(trim(origin_node)) > 0),
  destination_node       text NOT NULL CHECK (length(trim(destination_node)) > 0),
  carrier_id             text NOT NULL REFERENCES carrier (id),
  status                 text NOT NULL CHECK (status IN ('active', 'inactive')),
  total_distance_km      numeric(10,1) NOT NULL CHECK (total_distance_km > 0),
  planned_duration_hours numeric(6,1) NOT NULL CHECK (planned_duration_hours > 0),
  planned_cost_usd       integer NOT NULL CHECK (planned_cost_usd > 0),
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT route_nodes_differ CHECK (destination_node <> origin_node)
);

-- ---------------------------------------------------------------------------
-- route_segment (§4)
-- ---------------------------------------------------------------------------
CREATE TABLE route_segment (
  id                     text PRIMARY KEY CHECK (id ~ '^SEG-[0-9]{3}$'),
  route_id               text NOT NULL REFERENCES route (id),
  seq                    integer NOT NULL CHECK (seq >= 1),
  name                   text NOT NULL CHECK (length(trim(name)) > 0),
  region_code            text NOT NULL CHECK (region_code IN (
                           'IN-WEST-COAST','AE-JEBEL-ALI','SG-SINGAPORE','CN-EAST-COAST',
                           'US-WEST-COAST','EU-ROTTERDAM','US-EAST-COAST','IN-NORTH-ICD')),
  mode                   text NOT NULL CHECK (mode IN ('sea', 'road', 'rail', 'air')),
  origin_node            text NOT NULL,
  destination_node       text NOT NULL,
  distance_km            numeric(10,1) NOT NULL CHECK (distance_km > 0),
  planned_duration_hours numeric(6,1) NOT NULL CHECK (planned_duration_hours > 0),
  capacity_units         integer NOT NULL CHECK (capacity_units > 0),
  cost_usd               integer NOT NULL CHECK (cost_usd > 0),
  dest_lat               numeric(9,6) NOT NULL CHECK (dest_lat BETWEEN -90 AND 90),
  dest_lon               numeric(9,6) NOT NULL CHECK (dest_lon BETWEEN -180 AND 180),
  CONSTRAINT route_segment_seq_unique UNIQUE (route_id, seq),
  CONSTRAINT route_segment_id_route_unique UNIQUE (id, route_id)
);

-- ---------------------------------------------------------------------------
-- shipment (§2 + A-3 planned/actual times)
-- ---------------------------------------------------------------------------
CREATE TABLE shipment (
  id                 text PRIMARY KEY CHECK (id ~ '^S[0-9]{3}$'),
  route_id           text NOT NULL REFERENCES route (id),
  cargo_type         text NOT NULL CHECK (length(trim(cargo_type)) > 0),
  is_cold_chain      boolean NOT NULL,
  cargo_value_usd    integer NOT NULL CHECK (cargo_value_usd >= 0),
  volume_units       integer NOT NULL CHECK (volume_units > 0),
  deadline           timestamptz NOT NULL,
  status             text NOT NULL CHECK (status IN ('planned', 'in_transit', 'delayed', 'delivered', 'cancelled')),
  current_segment_id text,
  planned_departure  timestamptz NOT NULL,
  planned_arrival    timestamptz NOT NULL,
  actual_departure   timestamptz,
  actual_arrival     timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipment_planned_window CHECK (planned_arrival > planned_departure),
  CONSTRAINT shipment_deadline_after_creation CHECK (deadline > created_at),
  CONSTRAINT shipment_actual_window CHECK (
    actual_arrival IS NULL OR actual_departure IS NULL OR actual_arrival > actual_departure
  ),
  CONSTRAINT shipment_delivered_requires_actual_arrival CHECK (
    status <> 'delivered' OR actual_arrival IS NOT NULL
  ),
  -- current_segment_id (when present) must belong to the shipment's route
  CONSTRAINT shipment_current_segment_fk FOREIGN KEY (current_segment_id, route_id)
    REFERENCES route_segment (id, route_id)
);

-- ---------------------------------------------------------------------------
-- disruption (§6)
-- ---------------------------------------------------------------------------
CREATE TABLE disruption (
  id          text PRIMARY KEY CHECK (id ~ '^D[0-9]{2}$'),
  type        text NOT NULL CHECK (type IN ('weather', 'port_strike', 'geopolitical', 'customs', 'infrastructure')),
  region_code text NOT NULL CHECK (region_code IN (
                'IN-WEST-COAST','AE-JEBEL-ALI','SG-SINGAPORE','CN-EAST-COAST',
                'US-WEST-COAST','EU-ROTTERDAM','US-EAST-COAST','IN-NORTH-ICD')),
  start_time  timestamptz NOT NULL,
  end_time    timestamptz,
  severity    integer NOT NULL CHECK (severity BETWEEN 1 AND 5),
  status      text NOT NULL CHECK (status IN ('scheduled', 'active', 'resolved')),
  description text NOT NULL CHECK (length(trim(description)) > 0),
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT disruption_window CHECK (end_time IS NULL OR end_time > start_time)
);

-- ---------------------------------------------------------------------------
-- fleet_asset (§7 + A-7)
-- ---------------------------------------------------------------------------
CREATE TABLE fleet_asset (
  id                  text PRIMARY KEY CHECK (id ~ '^A[0-9]{3}$'),
  type                text NOT NULL CHECK (type IN ('truck', 'container', 'vessel')),
  capacity_units      integer NOT NULL CHECK (capacity_units > 0),
  refrigerated        boolean NOT NULL,
  current_lat         numeric(9,6) NOT NULL CHECK (current_lat BETWEEN -90 AND 90),
  current_lon         numeric(9,6) NOT NULL CHECK (current_lon BETWEEN -180 AND 180),
  current_region_code text NOT NULL CHECK (current_region_code IN (
                        'IN-WEST-COAST','AE-JEBEL-ALI','SG-SINGAPORE','CN-EAST-COAST',
                        'US-WEST-COAST','EU-ROTTERDAM','US-EAST-COAST','IN-NORTH-ICD')),
  status              text NOT NULL CHECK (status IN ('available', 'maintenance', 'retired')),
  -- Intentionally NOT enforcing available_since NOT NULL: deliberate defect fixtures
  -- (missing_availability_timestamp) are required by LT-22; the service flags them.
  available_since     timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- asset_assignment (§8)
-- Overlapping assignments are intentionally allowed (conflict fixture LT-23);
-- conflicts are detected and flagged, never silently resolved.
-- ---------------------------------------------------------------------------
CREATE TABLE asset_assignment (
  id          text PRIMARY KEY CHECK (id ~ '^AA-[0-9]{4}$'),
  asset_id    text NOT NULL REFERENCES fleet_asset (id),
  shipment_id text NOT NULL REFERENCES shipment (id),
  start_time  timestamptz NOT NULL,
  end_time    timestamptz NOT NULL,
  reserved    boolean NOT NULL,
  status      text NOT NULL CHECK (status IN ('planned', 'active', 'completed', 'cancelled')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asset_assignment_window CHECK (end_time > start_time)
);
