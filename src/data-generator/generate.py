#!/usr/bin/env python3
"""Generate deterministic ChainSentinel seed fixtures and ground truth.

Usage:
    python generate.py [--seed 20260914] [--now 2026-09-14T09:00:00Z] [--out ../../data/seed]

Reproducibility: identical --seed and --now produce byte-identical fixtures.
Python 3.11 standard library only. No ML.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from chainsentinel.common import DEFAULT_NOW, GENERATOR_VERSION, parse_iso  # noqa: E402
from chainsentinel.coldchain import build_coldchain  # noqa: E402
from chainsentinel.groundtruth import build_ground_truth  # noqa: E402
from chainsentinel.logistics import SCENARIO_DESCRIPTIONS, build_logistics  # noqa: E402
from chainsentinel.validator import validate_fixtures  # noqa: E402

DEFAULT_OUT = Path(__file__).resolve().parents[2] / "data" / "seed"


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate ChainSentinel seed fixtures")
    parser.add_argument("--seed", type=int, default=20260914, help="deterministic random seed")
    parser.add_argument("--now", default=DEFAULT_NOW, help="time anchor for all fixtures (ISO 8601 UTC)")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="output directory")
    args = parser.parse_args()

    now = parse_iso(args.now)
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    logistics = build_logistics(now)
    coldchain = build_coldchain(now, logistics["shipments"])
    ground_truth = build_ground_truth(now, logistics, coldchain, SCENARIO_DESCRIPTIONS)

    errors = validate_fixtures(now, logistics, coldchain, ground_truth, SCENARIO_DESCRIPTIONS)
    if errors:
        print("VALIDATION FAILED:")
        for error in errors:
            print(f"  - {error}")
        return 1

    assets, assignments = logistics["fleet"]
    meta = {"generator_version": GENERATOR_VERSION, "seed": args.seed, "now": args.now, "deterministic": True}

    write_json(out_dir / "logistics.json", {
        "meta": meta,
        "carriers": logistics["carriers"],
        "routes": logistics["routes"],
        "route_segments": logistics["route_segments"],
        "shipments": logistics["shipments"],
        "disruptions": logistics["disruptions"],
        "fleet_assets": assets,
        "asset_assignments": assignments,
    })
    write_json(out_dir / "coldchain.json", {
        "meta": meta,
        "cargo_profiles": coldchain["cargo_profiles"],
        "temperature_policies": coldchain["temperature_policies"],
        "sensor_readings": coldchain["sensor_readings"],
    })
    write_json(out_dir / "ground_truth.json", {
        "meta": meta,
        **ground_truth,
    })

    print(f"seed={args.seed} now={args.now}")
    print(f"output: {out_dir}")
    print(f"carriers={len(logistics['carriers'])} routes={len(logistics['routes'])} "
          f"segments={len(logistics['route_segments'])} shipments={len(logistics['shipments'])} "
          f"disruptions={len(logistics['disruptions'])} assets={len(assets)} assignments={len(assignments)}")
    print(f"policies={len(coldchain['temperature_policies'])} profiles={len(coldchain['cargo_profiles'])} "
          f"readings={len(coldchain['sensor_readings'])}")
    print(f"matching_rows={len(ground_truth['matching'])} excursions={len(ground_truth['excursions'])} "
          f"scenarios={len(ground_truth['scenarios'])}")
    print("validation: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
