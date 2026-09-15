-- 005_indexes.sql
-- Minimal indexes required by the approved design (PHASE_1_SYSTEM_DESIGN.md §10):
-- foreign keys and hot lookup paths.

-- Logistics
CREATE INDEX route_carrier_idx              ON route (carrier_id);
CREATE INDEX route_od_idx                   ON route (origin_node, destination_node);
CREATE INDEX route_segment_route_idx        ON route_segment (route_id, seq);
CREATE INDEX shipment_route_idx             ON shipment (route_id);
CREATE INDEX shipment_status_idx            ON shipment (status);
CREATE INDEX shipment_current_segment_idx   ON shipment (current_segment_id);
CREATE INDEX disruption_region_status_idx   ON disruption (region_code, status);
CREATE INDEX fleet_asset_status_idx         ON fleet_asset (status);
CREATE INDEX asset_assignment_asset_end_idx ON asset_assignment (asset_id, end_time);
CREATE INDEX asset_assignment_shipment_idx  ON asset_assignment (shipment_id);

-- Cold-chain
CREATE INDEX temperature_policy_cargo_idx   ON temperature_policy (cargo_type, version);
CREATE INDEX sensor_reading_shipment_ts_idx ON sensor_reading (shipment_id, timestamp);
CREATE INDEX sensor_reading_sensor_ts_idx   ON sensor_reading (sensor_id, timestamp);
CREATE INDEX excursion_shipment_status_idx  ON temperature_excursion (shipment_id, status);
CREATE INDEX excursion_severity_idx         ON temperature_excursion (severity, status);

-- Shared
CREATE INDEX recommendation_shipment_status_idx ON recommendation (shipment_id, status);
CREATE INDEX risk_assessment_shipment_idx       ON risk_assessment (shipment_id, computed_at DESC);
CREATE INDEX audit_entity_idx                   ON audit_record (entity_type, entity_id, timestamp DESC);
