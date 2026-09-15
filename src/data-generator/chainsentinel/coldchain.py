"""Cold-chain fixture builder — cargo profiles, policies, sensor readings.

Reading window: NOW-18 h .. NOW+6 h at 15-minute intervals (97 points) per cold-chain
shipment. Scenario patterns override specific offsets to create the approved edge cases.
"""

from __future__ import annotations

from .common import (
    CARGO_PROFILE_SEED,
    POLICY_SEED,
    SENSOR_INTERVAL_MIN,
    iso,
    plus_minutes,
    parse_iso,
)

WINDOW_START_MIN = -1080  # NOW - 18 h
WINDOW_END_MIN = 360  # NOW + 6 h

# Cold-chain scenario -> (overrides: offset->temperature, drop_offsets, end_offset)
SCENARIO_PATTERNS: dict[str, dict] = {
    "S021": {"overrides": {}, "drop": set(), "end": WINDOW_END_MIN},  # normal
    "S022": {"overrides": {-300: 2.0, -285: 8.0}, "drop": set(), "end": WINDOW_END_MIN},  # boundary
    "S023": {"overrides": {o: 1.4 for o in (-300, -285, -270, -255)}, "drop": set(), "end": WINDOW_END_MIN},
    "S024": {"overrides": {o: 9.4 for o in (-300, -285, -270, -255)}, "drop": set(), "end": WINDOW_END_MIN},
    "S025": {"overrides": {-300: 8.8}, "drop": set(), "end": WINDOW_END_MIN},  # short warning
    "S026": {"overrides": {o: 10.4 for o in (-300, -285, -270, -255)}, "drop": set(), "end": WINDOW_END_MIN},
    "S027": {  # repeated excursions
        "overrides": {**{o: 9.5 for o in (-300, -285, -270, -255, -240)}, **{o: 9.5 for o in (-105, -90, -75, -60, -45)}},
        "drop": set(),
        "end": WINDOW_END_MIN,
    },
    "S028": {  # data gap inside a breach window (drop two readings -> 45-minute hole)
        "overrides": {-120: 9.4, -75: 9.1},
        "drop": {-105, -90},
        "end": WINDOW_END_MIN,
    },
    "S029": {"overrides": {-300: 5.0}, "drop": set(), "end": WINDOW_END_MIN, "duplicate_at": -300},  # duplicate
    "S030": {"overrides": {}, "drop": set(), "end": WINDOW_END_MIN, "scramble": True},  # out-of-order
    "S031": {"overrides": {}, "drop": set(), "end": -75},  # sensor failure (feed stops)
    "S032": {"overrides": {}, "drop": set(), "end": WINDOW_END_MIN},  # unknown policy (cargo type)
    "S033": {"overrides": {}, "drop": set(), "end": WINDOW_END_MIN},  # unknown cargo type
    "S034": {"overrides": {o: 9.5 for o in (-300, -285, -270, -255)}, "drop": set(), "end": WINDOW_END_MIN},
    "S035": {  # delivered: breaches occur after actual_arrival (NOW-60)
        "overrides": {-45: 9.4, -30: 9.4},
        "drop": set(),
        "end": WINDOW_END_MIN,
    },
    "S036": {"overrides": {-300: 65.0}, "drop": set(), "end": WINDOW_END_MIN},  # implausible sole breach
    "S037": {  # grouping boundary: 30-minute merge, then 45-minute split
        "overrides": {-120: 9.0, -90: 9.0, -45: 9.0, 0: 9.0},
        "drop": set(),
        "end": WINDOW_END_MIN,
    },
    "S038": {"overrides": {o: 9.2 for o in range(-300, -224, 15)}, "drop": set(), "end": WINDOW_END_MIN},  # B-8
    "S039": {"overrides": {o: 10.4 for o in (-300, -285, -270, -255)}, "drop": set(), "end": WINDOW_END_MIN},
}

DEFAULT_COLD = {"overrides": {}, "drop": set(), "end": WINDOW_END_MIN}  # S015, S047, S048

SENSOR_FOR_SHIPMENT = {
    "S015": "SEN-015",
    "S017": "SEN-017",
    "S021": "SEN-021",
    "S022": "SEN-022",
    "S023": "SEN-023",
    "S024": "SEN-024",
    "S025": "SEN-025",
    "S026": "SEN-026",
    "S027": "SEN-027",
    "S028": "SEN-028",
    "S029": "SEN-029",
    "S030": "SEN-030",
    "S031": "SEN-031",
    "S032": "SEN-032",
    "S033": "SEN-033",
    "S034": "SEN-034",
    "S035": "SEN-035",
    "S036": "SEN-036",
    "S037": "SEN-037",
    "S038": "SEN-038",
    "S039": "SEN-039",
    "S047": "SEN-047",
    "S048": "SEN-048",
}


def build_cargo_profiles() -> list[dict]:
    return [dict(row) for row in CARGO_PROFILE_SEED]


def build_temperature_policies() -> list[dict]:
    policies = []
    for cargo_type, values in POLICY_SEED.items():
        policies.append({
            "id": f"TP-{cargo_type.upper()}",
            "cargo_type": cargo_type,
            "min_c": values["min_c"],
            "max_c": values["max_c"],
            "max_excursion_minutes": values["max_excursion_minutes"],
            "minor_deviation_c": values["minor_deviation_c"],
            "major_deviation_c": values["major_deviation_c"],
            "critical_duration_minutes": values["critical_duration_minutes"],
            "version": 1,
            "effective_from": "2026-08-01T00:00:00Z",
            "updated_by": "operator-1",
            "updated_at": "2026-08-01T00:00:00Z",
        })
    return policies


def _normal_temperature(index: int, policy: dict | None) -> float:
    """Deterministic in-range pattern centred on the cargo policy midpoint."""
    if not policy:
        return 5.0
    midpoint = (policy["min_c"] + policy["max_c"]) / 2
    span = policy["max_c"] - policy["min_c"]
    amplitude = min(0.5, span / 4)
    return round(midpoint + ((index % 5) - 2) * (amplitude / 2), 1)


def build_sensor_readings(now, shipments: list[dict]) -> list[dict]:
    readings: list[dict] = []
    counter = 0

    for shipment in shipments:
        if not shipment["is_cold_chain"]:
            continue
        shipment_id = shipment["id"]
        pattern = SCENARIO_PATTERNS.get(shipment_id, DEFAULT_COLD)
        sensor_id = SENSOR_FOR_SHIPMENT[shipment_id]
        cargo_type = shipment["cargo_type"]
        policy = POLICY_SEED.get(cargo_type)

        offsets = [o for o in range(WINDOW_START_MIN, pattern["end"] + 1, SENSOR_INTERVAL_MIN) if o not in pattern["drop"]]
        entries: list[dict] = []
        for index, offset in enumerate(offsets):
            temperature = pattern["overrides"].get(offset)
            if temperature is None:
                temperature = _normal_temperature(index, policy)
            counter += 1
            entries.append({
                "id": f"SR-{counter:06d}",
                "shipment_id": shipment_id,
                "sensor_id": sensor_id,
                "timestamp": iso(plus_minutes(now, offset)),
                "temperature_c": round(float(temperature), 1),
                "humidity_pct": round(55.0 + (index % 7) * 0.5, 2),
                "source": "simulated",
                "created_at": iso(plus_minutes(now, offset + 1)),
            })

        # Duplicate reading: same (sensor_id, timestamp) twice (SCN-109).
        duplicate_at = pattern.get("duplicate_at")
        if duplicate_at is not None:
            original = next(entry for entry in entries if entry["timestamp"] == iso(plus_minutes(now, duplicate_at)))
            counter += 1
            duplicate = dict(original)
            duplicate["id"] = f"SR-{counter:06d}"
            duplicate["created_at"] = iso(plus_minutes(now, duplicate_at + 2))
            entries.append(duplicate)

        # Out-of-order emission: swap two adjacent entries so the array is not chronological (SCN-110).
        if pattern.get("scramble") and len(entries) > 12:
            entries[10], entries[11] = entries[11], entries[10]

        readings.extend(entries)

    return readings


def build_coldchain(now, shipments: list[dict]) -> dict:
    return {
        "cargo_profiles": build_cargo_profiles(),
        "temperature_policies": build_temperature_policies(),
        "sensor_readings": build_sensor_readings(now, shipments),
    }
