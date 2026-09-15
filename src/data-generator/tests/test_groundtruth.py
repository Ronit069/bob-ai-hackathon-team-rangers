"""Ground-truth formula tests — deterministic, explainable, frozen rules only."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from chainsentinel.common import DEFAULT_NOW, parse_iso  # noqa: E402
from chainsentinel.groundtruth import (  # noqa: E402
    classify_severity,
    coldchain_risk,
    combined_score,
    compute_quality,
    detect_excursions,
    match_shipments,
    normalize_readings,
)
from chainsentinel.common import POLICY_SEED  # noqa: E402

POLICY = {
    "id": "TP-VACCINE",
    "cargo_type": "vaccine",
    **POLICY_SEED["vaccine"],
}


def reading(offset_min, temperature, sensor="SEN-900"):
    from chainsentinel.common import iso, plus_minutes

    now = parse_iso(DEFAULT_NOW)
    return {
        "id": f"SR-{abs(offset_min):06d}",
        "shipment_id": "S900",
        "sensor_id": sensor,
        "timestamp": iso(plus_minutes(now, offset_min)),
        "temperature_c": temperature,
        "source": "simulated",
    }


class GroundTruthTest(unittest.TestCase):
    def test_impact_score_formula_is_frozen(self):
        # Two-shipment example: cargo/value norms collapse to 1/0, urgency to 1/0.
        now = parse_iso(DEFAULT_NOW)
        from chainsentinel.common import iso, plus_hours

        shipments = [
            {"id": "S001", "route_id": "R001", "cargo_type": "vaccine", "is_cold_chain": True, "cargo_value_usd": 520000, "volume_units": 12, "deadline": iso(plus_hours(now, 18)), "status": "in_transit", "current_segment_id": "SEG-001", "planned_departure": iso(plus_hours(now, -72)), "planned_arrival": iso(plus_hours(now, 72))},
            {"id": "S002", "route_id": "R001", "cargo_type": "apparel", "is_cold_chain": False, "cargo_value_usd": 20000, "volume_units": 12, "deadline": iso(plus_hours(now, 120)), "status": "in_transit", "current_segment_id": "SEG-001", "planned_departure": iso(plus_hours(now, -72)), "planned_arrival": iso(plus_hours(now, 72))},
        ]
        routes = {"R001": {"id": "R001", "origin_node": "A", "destination_node": "B", "carrier_id": "C01", "status": "active"}}
        segments = {"R001": [{"id": "SEG-001", "route_id": "R001", "seq": 1, "region_code": "IN-WEST-COAST", "planned_duration_hours": 96, "capacity_units": 100}]}
        disruptions = [{"id": "D01", "region_code": "IN-WEST-COAST", "start_time": iso(plus_hours(now, -3)), "end_time": iso(plus_hours(now, 69)), "severity": 3, "status": "active"}]
        rows = match_shipments(shipments, routes, segments, disruptions, now)
        self.assertEqual(rows[0]["shipment_id"], "S001")
        self.assertEqual(rows[0]["impact_score"], 1.0)
        self.assertEqual(rows[1]["impact_score"], 0.0)

    def test_severity_ladder_branches(self):
        self.assertEqual(classify_severity(0, 0.8, POLICY, "complete")["severity"], "warning")
        self.assertEqual(classify_severity(45, 2.4, POLICY, "complete")["severity"], "major")
        self.assertEqual(classify_severity(15, 3.5, POLICY, "complete")["severity"], "critical")
        self.assertEqual(classify_severity(75, 1.2, POLICY, "complete")["severity"], "critical")
        self.assertEqual(classify_severity(10, 0.5, POLICY, "missing_readings")["severity"], "unknown_review")

    def test_boundary_readings_within_limits(self):
        result = detect_excursions(
            {"id": "S900"},
            [reading(-60, 2.0), reading(-45, 8.0), reading(-30, 5.0)],
            POLICY,
            None,
            parse_iso(DEFAULT_NOW),
        )
        self.assertEqual(result["excursions"], [])

    def test_grouping_merges_30_minutes_and_splits_45(self):
        merged = detect_excursions(
            {"id": "S900"},
            [reading(-60, 9.0), reading(-45, 7.0), reading(-30, 9.0), reading(-15, 7.0)],
            POLICY,
            None,
            parse_iso(DEFAULT_NOW),
        )
        self.assertEqual(len(merged["excursions"]), 1)
        self.assertEqual(merged["excursions"][0]["duration_min"], 30)

        split = detect_excursions(
            {"id": "S900"},
            [reading(-60, 9.0), reading(-45, 7.0), reading(-30, 7.0), reading(-15, 9.0), reading(0, 7.0)],
            POLICY,
            None,
            parse_iso(DEFAULT_NOW),
        )
        self.assertEqual(len(split["excursions"]), 2)

    def test_data_gap_merges_breaches_conservatively(self):
        # 45-minute hole between two breaching readings: one excursion, missing_readings.
        result = detect_excursions(
            {"id": "S900"},
            [reading(-120, 9.4), reading(-75, 9.1), reading(-60, 7.0)],
            POLICY,
            None,
            parse_iso(DEFAULT_NOW),
        )
        self.assertEqual(len(result["excursions"]), 1)
        self.assertEqual(result["excursions"][0]["data_quality"], "missing_readings")

    def test_normalize_dedupes_and_flags_order(self):
        readings = [reading(-30, 5.0), reading(-45, 5.1), reading(-30, 5.0)]
        ordered, duplicates, out_of_order = normalize_readings(readings)
        self.assertEqual(duplicates, 1)
        self.assertTrue(out_of_order)
        self.assertEqual(len(ordered), 2)

    def test_quality_flags(self):
        quality = compute_quality([reading(-120, 5.0), reading(-60, 5.0), reading(0, 5.0)])
        self.assertEqual(len(quality["gaps"]), 0)
        self.assertEqual(len(quality["failures"]), 2)  # two 60-minute holes, each >= 4x interval

        short = compute_quality([reading(-60, 5.0), reading(-15, 5.0)])
        self.assertEqual(len(short["gaps"]), 1)  # 45-minute hole: gap, not failure
        self.assertEqual(len(short["failures"]), 0)

    def test_coldchain_risk_weights_and_worst_wins(self):
        self.assertEqual(coldchain_risk([], [])["risk_score"], 0.0)
        self.assertEqual(coldchain_risk([{"severity": "warning", "status": "open"}], [])["risk_score"], 0.3)
        worst = coldchain_risk(
            [{"severity": "warning", "status": "open"}, {"severity": "critical", "status": "open"}], []
        )
        self.assertEqual(worst["risk_score"], 1.0)
        self.assertEqual(coldchain_risk([], ["policy_missing"])["risk_score"], 0.5)

    def test_combined_score_arithmetic(self):
        self.assertEqual(combined_score(0.78, 0.3), 0.54)
        self.assertEqual(combined_score(0.4, 1.0), 0.7)
        self.assertEqual(combined_score(0.856, 0.6), 0.728)


if __name__ == "__main__":
    unittest.main()
