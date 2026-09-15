#!/usr/bin/env python3
"""Validate existing ChainSentinel seed fixtures against the frozen contracts.

Usage:
    python validate.py [--dir ../../data/seed]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from chainsentinel.common import parse_iso  # noqa: E402
from chainsentinel.logistics import SCENARIO_DESCRIPTIONS  # noqa: E402
from chainsentinel.validator import validate_fixtures  # noqa: E402

DEFAULT_DIR = Path(__file__).resolve().parents[2] / "data" / "seed"


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate ChainSentinel seed fixtures")
    parser.add_argument("--dir", default=str(DEFAULT_DIR), help="fixture directory")
    args = parser.parse_args()

    directory = Path(args.dir)
    logistics_raw = load(directory / "logistics.json")
    coldchain = load(directory / "coldchain.json")
    ground_truth = load(directory / "ground_truth.json")

    segments_by_route: dict[str, list[dict]] = {}
    for segment in logistics_raw["route_segments"]:
        segments_by_route.setdefault(segment["route_id"], []).append(segment)

    logistics = {
        "carriers": logistics_raw["carriers"],
        "routes": logistics_raw["routes"],
        "route_segments": logistics_raw["route_segments"],
        "segments_by_route": segments_by_route,
        "shipments": logistics_raw["shipments"],
        "disruptions": logistics_raw["disruptions"],
        "fleet": (logistics_raw["fleet_assets"], logistics_raw["asset_assignments"]),
    }

    now = parse_iso(ground_truth["meta"]["now"])
    errors = validate_fixtures(now, logistics, coldchain, ground_truth, SCENARIO_DESCRIPTIONS)

    if errors:
        print("VALIDATION FAILED:")
        for error in errors:
            print(f"  - {error}")
        return 1

    print(f"validation: PASS ({directory})")
    print(f"scenarios={len(ground_truth['scenarios'])} matching={len(ground_truth['matching'])} "
          f"excursions={len(ground_truth['excursions'])} readings={len(coldchain['sensor_readings'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
