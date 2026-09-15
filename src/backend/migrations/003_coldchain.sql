-- 003_coldchain.sql
-- Cold-chain entities (data-contract.md §9–§11 + Phase 1A amendments B-1/B-6).

-- ---------------------------------------------------------------------------
-- cargo_profile (B-1, approved Phase 1A)
-- ---------------------------------------------------------------------------
CREATE TABLE cargo_profile (
  cargo_type        text PRIMARY KEY CHECK (length(trim(cargo_type)) > 0),
  display_name      text NOT NULL CHECK (length(trim(display_name)) > 0),
  is_cold_chain     boolean NOT NULL,
  sensitivity_weight numeric(3,2) NOT NULL CHECK (sensitivity_weight BETWEEN 0.00 AND 1.00),
  policy_required   boolean NOT NULL,
  notes             text
);

-- ---------------------------------------------------------------------------
-- temperature_policy (§10) — versioned, configurable
-- ---------------------------------------------------------------------------
CREATE TABLE temperature_policy (
  id                        text PRIMARY KEY CHECK (id ~ '^TP-[A-Z0-9_]+$'),
  cargo_type                text NOT NULL,
  min_c                     numeric(5,1) NOT NULL,
  max_c                     numeric(5,1) NOT NULL,
  max_excursion_minutes     integer NOT NULL CHECK (max_excursion_minutes >= 0),
  minor_deviation_c         numeric(4,1) NOT NULL CHECK (minor_deviation_c > 0),
  major_deviation_c         numeric(4,1) NOT NULL CHECK (major_deviation_c > minor_deviation_c),
  critical_duration_minutes integer NOT NULL CHECK (critical_duration_minutes > 0),
  version                   integer NOT NULL CHECK (version >= 1),
  effective_from            timestamptz NOT NULL,
  updated_by                text NOT NULL,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT policy_range CHECK (min_c < max_c),
  CONSTRAINT policy_durations CHECK (critical_duration_minutes > max_excursion_minutes),
  CONSTRAINT policy_cargo_version_unique UNIQUE (cargo_type, version)
);

-- ---------------------------------------------------------------------------
-- sensor_reading (§9)
-- Temperature range is NOT a hard constraint: implausible values are stored and
-- flagged (B-6). Future timestamps are rejected at the service/API layer.
-- ---------------------------------------------------------------------------
CREATE TABLE sensor_reading (
  id            text PRIMARY KEY CHECK (id ~ '^SR-[0-9]{6}$'),
  shipment_id   text NOT NULL REFERENCES shipment (id),
  sensor_id     text NOT NULL CHECK (sensor_id ~ '^SEN-[0-9]{3}$'),
  timestamp     timestamptz NOT NULL,
  temperature_c numeric(5,1) NOT NULL,
  humidity_pct  numeric(5,2) CHECK (humidity_pct IS NULL OR humidity_pct BETWEEN 0 AND 100),
  source        text NOT NULL CHECK (source IN ('simulated', 'manual')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- temperature_excursion (§11 + B-5 post_delivery + B-6 data_quality enum)
-- ---------------------------------------------------------------------------
CREATE TABLE temperature_excursion (
  id                 text PRIMARY KEY CHECK (id ~ '^EX-[0-9]{4}$'),
  shipment_id        text NOT NULL REFERENCES shipment (id),
  policy_id          text REFERENCES temperature_policy (id),
  start_time         timestamptz NOT NULL,
  end_time           timestamptz,
  peak_deviation_c   numeric(4,1) NOT NULL CHECK (peak_deviation_c >= 0),
  duration_min       integer NOT NULL CHECK (duration_min >= 0),
  severity           text NOT NULL CHECK (severity IN ('warning', 'major', 'critical', 'unknown_review')),
  severity_rationale text NOT NULL CHECK (length(trim(severity_rationale)) > 0),
  data_quality       text NOT NULL CHECK (data_quality IN (
                       'complete', 'missing_readings', 'sensor_failure', 'out_of_order', 'implausible')),
  detected_at        timestamptz NOT NULL DEFAULT now(),
  status             text NOT NULL CHECK (status IN ('open', 'acknowledged', 'closed')),
  post_delivery      boolean NOT NULL DEFAULT false,
  CONSTRAINT excursion_window CHECK (end_time IS NULL OR end_time >= start_time)
);
