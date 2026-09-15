"""Contract validator — checks generated fixtures against data-contract.md and ground truth."""

from __future__ import annotations

import re

from .common import (
    ASSET_STATUSES,
    ASSET_TYPES,
    CARGO_TYPES,
    DISRUPTION_STATUSES,
    DISRUPTION_TYPES,
    MODES,
    POLICY_SEED,
    REGION_CODES,
    SHIPMENT_STATUSES,
    parse_iso,
)
from .groundtruth import build_ground_truth, compute_quality, detect_excursions, match_shipments

ID_PATTERNS = {
    "carrier": re.compile(r"^C\d{2}$"),
    "route": re.compile(r"^R\d{3}$"),
    "segment": re.compile(r"^SEG-\d{3}$"),
    "shipment": re.compile(r"^S\d{3}$"),
    "disruption": re.compile(r"^D\d{2}$"),
    "asset": re.compile(r"^A\d{3}$"),
    "assignment": re.compile(r"^AA-\d{4}$"),
    "reading": re.compile(r"^SR-\d{6}$"),
    "policy": re.compile(r"^TP-[A-Z0-9_]+$"),
}

ISO_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")


def _check_iso(value, label, errors):
    if value is None:
        return
    if not isinstance(value, str) or not ISO_PATTERN.match(value):
        errors.append(f"{label}: not ISO-8601 UTC with Z ({value!r})")
    else:
        try:
            parse_iso(value)
        except ValueError:
            errors.append(f"{label}: unparseable timestamp ({value!r})")


def validate_fixtures(now, logistics: dict, coldchain: dict, ground_truth: dict, scenario_descriptions: dict) -> list[str]:
    errors: list[str] = []

    carriers = logistics["carriers"]
    routes = logistics["routes"]
    segments = logistics["route_segments"]
    shipments = logistics["shipments"]
    disruptions = logistics["disruptions"]
    assets, assignments = logistics["fleet"]
    profiles = coldchain["cargo_profiles"]
    policies = coldchain["temperature_policies"]
    readings = coldchain["sensor_readings"]

    # --- ID formats and uniqueness -------------------------------------------------
    for entity, rows, key in (
        ("carrier", carriers, "id"),
        ("route", routes, "id"),
        ("segment", segments, "id"),
        ("shipment", shipments, "id"),
        ("disruption", disruptions, "id"),
        ("asset", assets, "id"),
        ("assignment", assignments, "id"),
        ("reading", readings, "id"),
        ("policy", policies, "id"),
    ):
        pattern = ID_PATTERNS[entity]
        seen = set()
        for row in rows:
            value = row[key]
            if not pattern.match(str(value)):
                errors.append(f"{entity} id invalid: {value!r}")
            if value in seen:
                errors.append(f"{entity} id duplicated: {value}")
            seen.add(value)

    # --- Vocabulary and ranges -----------------------------------------------------
    for carrier in carriers:
        if carrier["status"] not in {"active", "inactive"}:
            errors.append(f"carrier {carrier['id']}: invalid status")
        if not set(carrier["service_regions"]) <= set(REGION_CODES):
            errors.append(f"carrier {carrier['id']}: unknown region")
        if not set(carrier["modes"]) <= set(MODES):
            errors.append(f"carrier {carrier['id']}: unknown mode")
        if not 0.0 <= carrier["reliability_score"] <= 1.0:
            errors.append(f"carrier {carrier['id']}: reliability out of range")

    carrier_ids = {c["id"] for c in carriers}
    for route in routes:
        if route["carrier_id"] not in carrier_ids:
            errors.append(f"route {route['id']}: carrier {route['carrier_id']} missing")
        if route["status"] not in {"active", "inactive"}:
            errors.append(f"route {route['id']}: invalid status")

    route_ids = {r["id"] for r in routes}
    segments_by_route: dict[str, list[dict]] = {}
    for segment in segments:
        segments_by_route.setdefault(segment["route_id"], []).append(segment)
        if segment["route_id"] not in route_ids:
            errors.append(f"segment {segment['id']}: route {segment['route_id']} missing")
        if segment["region_code"] not in REGION_CODES:
            errors.append(f"segment {segment['id']}: unknown region")
        if segment["mode"] not in MODES:
            errors.append(f"segment {segment['id']}: unknown mode")
        if segment["capacity_units"] <= 0 or segment["planned_duration_hours"] <= 0:
            errors.append(f"segment {segment['id']}: non-positive capacity/duration")
        if not -90 <= segment["dest_lat"] <= 90 or not -180 <= segment["dest_lon"] <= 180:
            errors.append(f"segment {segment['id']}: coordinates out of range")

    for route in routes:
        route_segments = sorted(segments_by_route.get(route["id"], []), key=lambda s: s["seq"])
        if route.get("defect"):
            continue  # deliberate defect fixture (SCN-005), tagged in the route record
        if len(route_segments) < 2:
            errors.append(f"route {route['id']}: fewer than 2 segments")
        seqs = [s["seq"] for s in route_segments]
        if len(seqs) != len(set(seqs)):
            errors.append(f"route {route['id']}: duplicate segment seq")

    shipment_ids = {s["id"] for s in shipments}
    for shipment in shipments:
        if shipment["status"] not in SHIPMENT_STATUSES:
            errors.append(f"shipment {shipment['id']}: invalid status")
        if shipment["route_id"] not in route_ids:
            errors.append(f"shipment {shipment['id']}: route {shipment['route_id']} missing")
        if shipment["current_segment_id"]:
            route_segment_ids = {s["id"] for s in segments_by_route.get(shipment["route_id"], [])}
            if shipment["current_segment_id"] not in route_segment_ids:
                errors.append(f"shipment {shipment['id']}: current segment not on its route")
        if shipment["volume_units"] <= 0 or shipment["cargo_value_usd"] < 0:
            errors.append(f"shipment {shipment['id']}: invalid volume/value")
        _check_iso(shipment["deadline"], f"shipment {shipment['id']}.deadline", errors)
        _check_iso(shipment["planned_departure"], f"shipment {shipment['id']}.planned_departure", errors)
        _check_iso(shipment["planned_arrival"], f"shipment {shipment['id']}.planned_arrival", errors)
        if shipment["status"] == "delivered" and not shipment.get("actual_arrival"):
            errors.append(f"shipment {shipment['id']}: delivered without actual_arrival")

    for disruption in disruptions:
        if disruption["type"] not in DISRUPTION_TYPES:
            errors.append(f"disruption {disruption['id']}: invalid type")
        if disruption["status"] not in DISRUPTION_STATUSES:
            errors.append(f"disruption {disruption['id']}: invalid status")
        if disruption["region_code"] not in REGION_CODES:
            errors.append(f"disruption {disruption['id']}: unknown region")
        if not 1 <= disruption["severity"] <= 5:
            errors.append(f"disruption {disruption['id']}: severity out of range")
        _check_iso(disruption["start_time"], f"disruption {disruption['id']}.start_time", errors)
        _check_iso(disruption.get("end_time"), f"disruption {disruption['id']}.end_time", errors)

    asset_ids = {a["id"] for a in assets}
    for asset in assets:
        if asset["type"] not in ASSET_TYPES or asset["status"] not in ASSET_STATUSES:
            errors.append(f"asset {asset['id']}: invalid type/status")
        if asset["current_region_code"] not in REGION_CODES:
            errors.append(f"asset {asset['id']}: unknown region")
        if asset["capacity_units"] <= 0:
            errors.append(f"asset {asset['id']}: non-positive capacity")

    for assignment in assignments:
        if assignment["asset_id"] not in asset_ids:
            errors.append(f"assignment {assignment['id']}: asset missing")
        if assignment["shipment_id"] not in shipment_ids:
            errors.append(f"assignment {assignment['id']}: shipment missing")
        _check_iso(assignment["start_time"], f"assignment {assignment['id']}.start_time", errors)
        _check_iso(assignment["end_time"], f"assignment {assignment['id']}.end_time", errors)

    # --- Cold-chain ----------------------------------------------------------------
    profile_types = {p["cargo_type"] for p in profiles}
    if profile_types != set(CARGO_TYPES):
        errors.append("cargo profiles do not match the approved cargo vocabulary")

    policy_types = {p["cargo_type"] for p in policies}
    for policy in policies:
        if not policy["min_c"] < policy["max_c"]:
            errors.append(f"policy {policy['id']}: min/max not ordered")
        if not policy["minor_deviation_c"] < policy["major_deviation_c"]:
            errors.append(f"policy {policy['id']}: deviation thresholds not ordered")
        if not policy["max_excursion_minutes"] < policy["critical_duration_minutes"]:
            errors.append(f"policy {policy['id']}: durations not ordered")

    for shipment in shipments:
        if not shipment["is_cold_chain"]:
            continue
        if shipment["cargo_type"] in CARGO_TYPES and shipment["cargo_type"] in POLICY_SEED:
            if shipment["cargo_type"] not in policy_types:
                errors.append(f"shipment {shipment['id']}: cold-chain cargo without a policy")

    reading_keys = set()
    duplicate_keys = 0
    for reading in readings:
        if reading["shipment_id"] not in shipment_ids:
            errors.append(f"reading {reading['id']}: shipment missing")
        shipment = next(s for s in shipments if s["id"] == reading["shipment_id"])
        if not shipment["is_cold_chain"]:
            errors.append(f"reading {reading['id']}: shipment is not cold-chain")
        _check_iso(reading["timestamp"], f"reading {reading['id']}.timestamp", errors)
        key = (reading["sensor_id"], reading["timestamp"])
        if key in reading_keys:
            duplicate_keys += 1
        reading_keys.add(key)
    if duplicate_keys < 1:
        errors.append("expected at least one deliberate duplicate reading (SCN-109)")

    # --- Scenario coverage and ground-truth consistency -----------------------------
    scenarios = ground_truth.get("scenarios", {})
    for scenario_id in scenario_descriptions:
        if scenario_id not in scenarios:
            errors.append(f"scenario {scenario_id}: missing from ground truth")

    tagged = {tag for shipment in shipments for tag in shipment.get("scenario_tags", [])}
    for tag in tagged:
        if tag not in scenario_descriptions:
            errors.append(f"fixture tag {tag}: unknown scenario")

    # Re-derive matching and excursions and compare with stored ground truth.
    routes_by_id = {r["id"]: r for r in routes}
    recomputed_matching = match_shipments(shipments, routes_by_id, segments_by_route, disruptions, now)
    if len(recomputed_matching) != len(ground_truth["matching"]):
        errors.append("ground truth matching length differs from recomputation")
    else:
        for expected, actual in zip(ground_truth["matching"], recomputed_matching):
            if expected["shipment_id"] != actual["shipment_id"] or expected["impact_status"] != actual["impact_status"]:
                errors.append(f"ground truth matching mismatch for {expected['shipment_id']}")

    readings_by_shipment: dict[str, list[dict]] = {}
    for reading in readings:
        readings_by_shipment.setdefault(reading["shipment_id"], []).append(reading)
    policies_by_cargo = {p["cargo_type"]: p for p in policies}
    recomputed_excursions = []
    for shipment in shipments:
        if not shipment["is_cold_chain"]:
            continue
        policy = policies_by_cargo.get(shipment["cargo_type"])
        cutoff = parse_iso(shipment["actual_arrival"]) if shipment.get("actual_arrival") else None
        result = detect_excursions(shipment, readings_by_shipment.get(shipment["id"], []), policy, cutoff, now)
        for excursion in result["excursions"]:
            recomputed_excursions.append((excursion["shipment_id"], excursion["start_time"], excursion["severity"], excursion["data_quality"]))
    stored_excursions = [(e["shipment_id"], e["start_time"], e["severity"], e["data_quality"]) for e in ground_truth["excursions"]]
    if stored_excursions != recomputed_excursions:
        errors.append("ground truth excursions differ from recomputation")

    # Quality flags must be computed for every cold shipment with readings.
    for shipment in shipments:
        if shipment["is_cold_chain"] and readings_by_shipment.get(shipment["id"]):
            compute_quality(readings_by_shipment[shipment["id"]])

    return errors
