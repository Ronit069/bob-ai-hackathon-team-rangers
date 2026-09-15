"""Validator tests — valid fixtures pass; corrupted fixtures are rejected."""

from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from chainsentinel.common import DEFAULT_NOW, parse_iso  # noqa: E402
from chainsentinel.coldchain import build_coldchain  # noqa: E402
from chainsentinel.groundtruth import build_ground_truth  # noqa: E402
from chainsentinel.logistics import SCENARIO_DESCRIPTIONS, build_logistics  # noqa: E402
from chainsentinel.validator import validate_fixtures  # noqa: E402

NOW = parse_iso(DEFAULT_NOW)


class ValidatorTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.logistics = build_logistics(NOW)
        cls.coldchain = build_coldchain(NOW, cls.logistics["shipments"])
        cls.gt = build_ground_truth(NOW, cls.logistics, cls.coldchain, SCENARIO_DESCRIPTIONS)

    def validate(self, logistics=None, coldchain=None, ground_truth=None):
        return validate_fixtures(
            NOW,
            logistics or self.logistics,
            coldchain or self.coldchain,
            ground_truth or self.gt,
            SCENARIO_DESCRIPTIONS,
        )

    def test_valid_fixtures_pass(self):
        self.assertEqual(self.validate(), [])

    def test_unknown_region_fails(self):
        logistics = copy.deepcopy(self.logistics)
        logistics["route_segments"][0]["region_code"] = "ATLANTIS"
        errors = self.validate(logistics=logistics)
        self.assertTrue(any("unknown region" in error for error in errors))

    def test_dangling_foreign_key_fails(self):
        logistics = copy.deepcopy(self.logistics)
        logistics["shipments"][0]["route_id"] = "R999"
        errors = self.validate(logistics=logistics)
        self.assertTrue(any("route R999 missing" in error for error in errors))

    def test_short_route_fails(self):
        logistics = copy.deepcopy(self.logistics)
        removed = logistics["route_segments"].pop(0)
        errors = self.validate(logistics=logistics)
        self.assertTrue(any("fewer than 2 segments" in error for error in errors))

    def test_duplicate_ids_fail(self):
        logistics = copy.deepcopy(self.logistics)
        logistics["shipments"][1]["id"] = logistics["shipments"][0]["id"]
        errors = self.validate(logistics=logistics)
        self.assertTrue(any("duplicated" in error for error in errors))

    def test_missing_scenario_fails(self):
        ground_truth = copy.deepcopy(self.gt)
        ground_truth["scenarios"].pop("SCN-101")
        errors = self.validate(ground_truth=ground_truth)
        self.assertTrue(any("SCN-101: missing from ground truth" in error for error in errors))

    def test_ground_truth_excursion_mismatch_fails(self):
        ground_truth = copy.deepcopy(self.gt)
        ground_truth["excursions"][0]["severity"] = "critical"
        errors = self.validate(ground_truth=ground_truth)
        self.assertTrue(any("excursions differ from recomputation" in error for error in errors))

    def test_policy_without_ordered_thresholds_fails(self):
        coldchain = copy.deepcopy(self.coldchain)
        coldchain["temperature_policies"][0]["min_c"] = 9.0
        errors = self.validate(coldchain=coldchain)
        self.assertTrue(any("not ordered" in error for error in errors))

    def test_delivered_without_actual_arrival_fails(self):
        logistics = copy.deepcopy(self.logistics)
        for shipment in logistics["shipments"]:
            if shipment["id"] == "S035":
                shipment["actual_arrival"] = None
        errors = self.validate(logistics=logistics)
        self.assertTrue(any("delivered without actual_arrival" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
