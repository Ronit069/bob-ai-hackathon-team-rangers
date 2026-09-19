"""Generator tests — normal, boundary, invalid and edge-case data (Python stdlib unittest)."""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from chainsentinel.common import DEFAULT_NOW, parse_iso  # noqa: E402
from chainsentinel.coldchain import build_coldchain  # noqa: E402
from chainsentinel.groundtruth import build_ground_truth, compute_quality, sensor_status  # noqa: E402
from chainsentinel.logistics import SCENARIO_DESCRIPTIONS, build_logistics  # noqa: E402

NOW = parse_iso(DEFAULT_NOW)


def build_all():
    logistics = build_logistics(NOW)
    coldchain = build_coldchain(NOW, logistics["shipments"])
    ground_truth = build_ground_truth(NOW, logistics, coldchain, SCENARIO_DESCRIPTIONS)
    return logistics, coldchain, ground_truth


class GeneratorTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.logistics, cls.coldchain, cls.gt = build_all()
        cls.shipments = {s["id"]: s for s in cls.logistics["shipments"]}
        cls.matching = {row["shipment_id"]: row for row in cls.gt["matching"]}
        cls.excursions = {}
        for excursion in cls.gt["excursions"]:
            cls.excursions.setdefault(excursion["shipment_id"], []).append(excursion)
        cls.readings = {}
        for reading in cls.coldchain["sensor_readings"]:
            cls.readings.setdefault(reading["shipment_id"], []).append(reading)

    # -- determinism and volume -------------------------------------------------
    def test_determinism_same_seed_same_output(self):
        logistics_b, coldchain_b, gt_b = build_all()
        first = json.dumps([self.logistics["shipments"], self.coldchain["sensor_readings"], self.gt["excursions"]], sort_keys=True)
        second = json.dumps([logistics_b["shipments"], coldchain_b["sensor_readings"], gt_b["excursions"]], sort_keys=True)
        self.assertEqual(first, second)

    def test_counts_within_approved_ranges(self):
        self.assertIn(len(self.logistics["carriers"]), range(8, 11))
        self.assertIn(len(self.logistics["route_segments"]), range(12, 19))
        self.assertIn(len(self.logistics["shipments"]), range(40, 61))
        self.assertIn(len(self.logistics["fleet"][0]), range(20, 31))
        self.assertEqual(len(self.coldchain["temperature_policies"]), 6)
        self.assertEqual(len(self.coldchain["cargo_profiles"]), 10)

    # -- matching ---------------------------------------------------------------
    def test_matching_statuses_for_scenario_shipments(self):
        self.assertEqual(self.matching["S001"]["impact_status"], "critical")
        self.assertEqual(self.matching["S002"]["impact_status"], "blocked")
        self.assertEqual(self.matching["S003"]["impact_status"], "critical")
        self.assertEqual(self.matching["S009"]["impact_status"], "delayed")  # inclusive boundary
        self.assertEqual(self.matching["S010"]["impact_status"], "unknown_review")  # defect route
        self.assertEqual(self.matching["S011"]["impact_status"], "at_risk")  # open-ended disruption

    def test_matching_excludes_delivered_and_passed(self):
        self.assertNotIn("S007", self.matching)  # delivered
        self.assertNotIn("S008", self.matching)  # segment passed before disruption (A-1)

    def test_matching_multiple_disruptions(self):
        matched = self.matching["S001"]["matched_disruptions"]
        self.assertEqual(len(matched), 2)
        self.assertEqual({m["disruption_id"] for m in matched}, {"D01", "D04"})

    def test_matching_unknown_review_reason(self):
        self.assertEqual(self.matching["S010"]["match_reason"], "route_data_missing")

    # -- excursions -------------------------------------------------------------
    def test_normal_and_boundary_readings_produce_no_excursion(self):
        self.assertNotIn("S021", self.excursions)
        self.assertNotIn("S022", self.excursions)

    def test_short_excursion_is_warning(self):
        self.assertEqual(len(self.excursions["S025"]), 1)
        self.assertEqual(self.excursions["S025"][0]["severity"], "warning")
        self.assertEqual(self.excursions["S025"][0]["duration_min"], 0)

    def test_prolonged_excursion_is_major(self):
        excursion = self.excursions["S026"][0]
        self.assertEqual(excursion["severity"], "major")
        self.assertEqual(excursion["duration_min"], 45)
        self.assertEqual(excursion["peak_deviation_c"], 2.4)

    def test_repeated_excursions_two_records(self):
        self.assertEqual(len(self.excursions["S027"]), 2)

    def test_missing_readings_unknown_review(self):
        excursion = self.excursions["S028"][0]
        self.assertEqual(excursion["data_quality"], "missing_readings")
        self.assertEqual(excursion["severity"], "unknown_review")

    def test_sensor_failure_status(self):
        quality = compute_quality(self.readings["S031"])
        status = sensor_status(quality, NOW)
        self.assertEqual(status["status"], "failed")

    def test_implausible_sole_breach_unknown_review(self):
        excursion = self.excursions["S036"][0]
        self.assertEqual(excursion["data_quality"], "implausible")
        self.assertEqual(excursion["severity"], "unknown_review")

    def test_long_small_magnitude_is_critical_b8(self):
        excursion = self.excursions["S038"][0]
        self.assertEqual(excursion["severity"], "critical")
        self.assertEqual(excursion["severity_rationale"], "duration>critical")

    def test_unknown_policy_review_flag(self):
        self.assertNotIn("S032", self.gt.get("review_flags", {}))
        self.assertNotIn("S033", self.gt.get("review_flags", {}))

    def test_delivered_post_delivery_excluded(self):
        self.assertNotIn("S035", self.excursions)

    def test_duplicate_reading_present_and_deduped(self):
        keys = [(r["sensor_id"], r["timestamp"]) for r in self.readings["S029"]]
        self.assertGreater(len(keys), len(set(keys)))
        self.assertNotIn("S029", self.excursions)  # duplicates deduped, no false breach

    def test_out_of_order_emission_detected(self):
        timestamps = [r["timestamp"] for r in self.readings["S030"]]
        self.assertNotEqual(timestamps, sorted(timestamps))
        quality = compute_quality(self.readings["S030"])
        self.assertTrue(quality["out_of_order"])

    def test_grouping_boundary_merge_and_split(self):
        self.assertEqual(len(self.excursions["S037"]), 3)

    # -- fleet ------------------------------------------------------------------
    def test_fleet_exclusions(self):
        reasons = {item["asset_id"]: item["reason"] for item in self.gt["fleet"]["excluded"]}
        self.assertEqual(reasons["A002"], "reserved")
        self.assertEqual(reasons["A007"], "missing_availability_timestamp")
        self.assertEqual(reasons["A008"], "maintenance")
        self.assertEqual(reasons["A009"], "retired")

    def test_redeployment_incompatible_asset_rejected(self):
        rejected = {item["asset_id"]: item["rejected_reason"] for item in self.gt["redeployment"]["S015"]["rejected"]}
        self.assertEqual(rejected["A003"], "incompatible_non_refrigerated")
        candidates = [c["asset_id"] for c in self.gt["redeployment"]["S015"]["data"]]
        self.assertNotIn("A003", candidates)
        self.assertIn("A017", candidates)

    def test_redeployment_no_compatible_asset(self):
        self.assertEqual(self.gt["redeployment"]["S017"]["data"], [])

    def test_redeployment_radius_boundary(self):
        rejected = {item["asset_id"]: item["rejected_reason"] for item in self.gt["redeployment"]["S016"]["rejected"]}
        self.assertEqual(rejected["A004"], "outside_radius")
        candidates = [c["asset_id"] for c in self.gt["redeployment"]["S016"]["data"]]
        self.assertIn("A005", candidates)  # ~145 km, within 150 km radius

    def test_contention_between_two_shipments(self):
        top = lambda shipment: [c["asset_id"] for c in self.gt["redeployment"][shipment]["data"][:3]]  # noqa: E731
        overlap = set(top("S018")) & set(top("S019"))
        self.assertTrue(overlap)

    # -- alternatives -----------------------------------------------------------
    def test_no_feasible_route(self):
        alternative = self.gt["alternatives"]["S004"]
        self.assertEqual(alternative["data"], [])
        self.assertEqual(alternative["no_option_reason"], "no_feasible_route")
        reasons = {item["route_id"]: item["rejected_reason"] for item in alternative["rejected"]}
        self.assertEqual(reasons["R002"], "disrupted_region_overlap")

    def test_insufficient_capacity_rejected(self):
        reasons = {item["route_id"]: item["rejected_reason"] for item in self.gt["alternatives"]["S005"]["rejected"]}
        self.assertEqual(reasons["R006"], "insufficient_capacity")

    def test_carrier_inactive_rejected(self):
        carriers = {item["carrier_id"]: item["rejected_reason"] for item in self.gt["alternatives"]["S006"]["carrier_alternatives"]["rejected"]}
        self.assertEqual(carriers["C09"], "carrier_inactive")

    def test_single_feasible_alternate_ranked(self):
        data = self.gt["alternatives"]["S040"]["data"]
        self.assertEqual([item["route_id"] for item in data], ["R006"])

    # -- risk -------------------------------------------------------------------
    def test_combined_risk_for_scenario_shipment(self):
        risk = self.gt["risk"]["S039"]
        self.assertEqual(risk["coldchain_risk"], 0.6)
        self.assertAlmostEqual(risk["combined_score"], round(0.5 * risk["disruption_risk"] + 0.5 * 0.6, 3))

    def test_scenario_coverage(self):
        for scenario_id in SCENARIO_DESCRIPTIONS:
            self.assertIn(scenario_id, self.gt["scenarios"])


if __name__ == "__main__":
    unittest.main()
