"""Deterministic ground truth — Python mirrors of the frozen JS rules.

Mirrors (same inputs -> same outputs):
  - src/backend/src/logistics/matching.service.js      (R1, A-1/A-2)
  - src/backend/src/logistics/alternatives.service.js  (R2, A-8)
  - src/backend/src/logistics/fleet.service.js         (R3, A-7)
  - src/backend/src/coldchain/excursion.service.js     (R5/R6, B-3/B-6/B-8)
  - src/backend/src/risk/risk.service.js               (P2)

No ML. No invented rules: every formula below is copied from the frozen contracts.
"""

from __future__ import annotations

import math

from .common import (
    EXCURSION_GROUP_GAP_MIN,
    REDEPLOY_RADIUS_KM,
    RISK_ALPHA,
    RISK_BETA,
    SENSOR_INTERVAL_MIN,
    SEVERITY_WEIGHTS,
    iso,
    minutes_between,
    parse_iso,
)

STATUS_RANK = {"critical": 5, "blocked": 4, "delayed": 3, "unknown_review": 2, "at_risk": 1, "unaffected": 0}
ACTIVE_STATUSES = {"planned", "in_transit", "delayed"}
SEVERITY_RANK = {"critical": 4, "major": 3, "warning": 2, "unknown_review": 1}
IMPLAUSIBLE_MIN_C = -40.0
IMPLAUSIBLE_MAX_C = 60.0

# ---------------------------------------------------------------------------
# Matching (R1)
# ---------------------------------------------------------------------------
def is_disruption_active(disruption: dict, now) -> bool:
    if disruption["status"] != "active":
        return False
    start = parse_iso(disruption["start_time"])
    end = parse_iso(disruption["end_time"]) if disruption["end_time"] else None
    return start <= now and (end is None or end >= now)


def planned_window(shipment: dict, segments: list[dict], segment: dict):
    if not shipment.get("planned_departure"):
        return None
    departure = parse_iso(shipment["planned_departure"])
    offset_hours = sum(s["planned_duration_hours"] for s in segments if s["seq"] < segment["seq"])
    start = departure.timestamp() + offset_hours * 3600
    end = start + segment["planned_duration_hours"] * 3600
    from datetime import datetime, timezone
    return (
        datetime.fromtimestamp(start, tz=timezone.utc),
        datetime.fromtimestamp(end, tz=timezone.utc),
    )


def relative_position(shipment: dict, segments: list[dict], segment: dict) -> str:
    if shipment.get("current_segment_id") == segment["id"]:
        return "ON"
    if not shipment.get("current_segment_id"):
        return "UNKNOWN"
    current = next((s for s in segments if s["id"] == shipment["current_segment_id"]), None)
    if current is None:
        return "UNKNOWN"
    if current["seq"] > segment["seq"]:
        return "PAST"
    if current["seq"] < segment["seq"]:
        return "BEFORE"
    return "UNKNOWN"


def classify_match(shipment: dict, segments: list[dict], segment: dict, disruption: dict, now) -> dict:
    window = planned_window(shipment, segments, segment)
    position = relative_position(shipment, segments, segment)
    if position == "UNKNOWN" and window:
        position = "BEFORE" if now < window[0] else ("ON" if now <= window[1] else "PAST")

    d_start = parse_iso(disruption["start_time"])
    d_end = parse_iso(disruption["end_time"]) if disruption["end_time"] else None
    severity = disruption["severity"]
    base = {
        "segment_id": segment["id"],
        "disruption_id": disruption["id"],
        "severity": severity,
        "timing_basis": "planned" if window else "unknown",
    }

    if position == "ON":
        return {**base, "status": "critical" if severity >= 4 else "blocked", "reason": "currently_in_affected_segment"}
    if position == "PAST":
        if window and window[1] < d_start:
            return {**base, "status": "unaffected", "reason": "segment_passed_before_disruption"}
        return {**base, "status": "delayed", "reason": "traversed_during_disruption"}
    if position == "BEFORE":
        if not window:
            return {**base, "status": "at_risk", "reason": "timing_unknown"}
        if d_end and window[0] > d_end:
            return {**base, "status": "unaffected", "reason": "arrival_after_disruption_end"}
        if d_end and window[0] <= d_end:
            return {**base, "status": "delayed", "reason": "planned_arrival_during_disruption"}
        return {**base, "status": "at_risk", "reason": "disruption_end_unknown"}
    return {**base, "status": "unknown_review", "reason": "position_unknown"}


def _confidence(status: str, timing_basis: str) -> str:
    if status == "unknown_review" or timing_basis == "unknown":
        return "low"
    if status in {"critical", "blocked", "delayed"}:
        return "high"
    return "medium"


def match_shipments(shipments, routes_by_id, segments_by_route, disruptions, now) -> list[dict]:
    active = [d for d in disruptions if is_disruption_active(d, now)]
    region_index: dict[str, list[dict]] = {}
    for disruption in active:
        region_index.setdefault(disruption["region_code"], []).append(disruption)

    rows: list[dict] = []
    for shipment in shipments:
        if shipment["status"] not in ACTIVE_STATUSES:
            continue
        route = routes_by_id.get(shipment["route_id"])
        segments = segments_by_route.get(shipment["route_id"], []) if route else []
        if route is None or not segments:
            rows.append({
                "shipment_id": shipment["id"],
                "impact_status": "unknown_review",
                "match_reason": "route_data_missing",
                "matched_segment_ids": [],
                "matched_disruptions": [],
                "timing_basis": "unknown",
                "confidence": "low",
            })
            continue

        matches = []
        for segment in segments:
            for disruption in region_index.get(segment["region_code"], []):
                matches.append(classify_match(shipment, segments, segment, disruption, now))
        if not matches:
            continue
        worst = max(matches, key=lambda m: STATUS_RANK[m["status"]])
        if worst["status"] == "unaffected":
            continue
        rows.append({
            "shipment_id": shipment["id"],
            "impact_status": worst["status"],
            "match_reason": f"route {shipment['route_id']} segment {worst['segment_id']} matches disruption {worst['disruption_id']}; {worst['reason']}",
            "matched_segment_ids": sorted({m["segment_id"] for m in matches if m["status"] != "unaffected"}),
            "matched_disruptions": [
                {"disruption_id": m["disruption_id"], "severity": m["severity"], "status": m["status"], "reason": m["reason"]}
                for m in matches
                if m["status"] != "unaffected"
            ],
            "timing_basis": worst["timing_basis"],
            "confidence": _confidence(worst["status"], worst["timing_basis"]),
        })

    # Impact scores (frozen formula)
    values = [row["shipment_id"] for row in rows]
    by_id = {s["id"]: s for s in shipments}
    cargo_values = [by_id[sid]["cargo_value_usd"] for sid in values]
    urgency_raw = []
    for sid in values:
        hours = (parse_iso(by_id[sid]["deadline"]) - now).total_seconds() / 3600
        urgency_raw.append(min(1.0, max(0.0, 1 - hours / 168)))

    def minmax(items):
        lo, hi = min(items), max(items)
        return lambda v: 0.5 if hi == lo else (v - lo) / (hi - lo)

    cargo_norm = minmax(cargo_values)
    urgency_norm = minmax(urgency_raw)
    for index, row in enumerate(rows):
        cargo = cargo_norm(cargo_values[index])
        urgency = urgency_norm(urgency_raw[index])
        cold = 1.0 if by_id[row["shipment_id"]]["is_cold_chain"] else 0.0
        score = 0.4 * cargo + 0.4 * urgency + 0.2 * cold
        row["impact_score"] = round(score, 3)
        row["impact_factors"] = {
            "cargo_value_norm": round(cargo, 3),
            "deadline_urgency_norm": round(urgency, 3),
            "is_cold_chain": bool(cold),
        }

    rows.sort(key=lambda r: (-r["impact_score"], -STATUS_RANK[r["impact_status"]], parse_iso(by_id[r["shipment_id"]]["deadline"]), r["shipment_id"]))
    return rows


# ---------------------------------------------------------------------------
# Excursions (R5/R6)
# ---------------------------------------------------------------------------
def is_breach(temperature: float, policy: dict) -> bool:
    return temperature < policy["min_c"] or temperature > policy["max_c"]


def normalize_readings(readings: list[dict]):
    seen = set()
    deduped = []
    duplicates = 0
    for reading in readings:
        key = (reading["sensor_id"], reading["timestamp"])
        if key in seen:
            duplicates += 1
            continue
        seen.add(key)
        deduped.append(reading)
    out_of_order = any(
        parse_iso(deduped[i]["timestamp"]) < parse_iso(deduped[i - 1]["timestamp"]) for i in range(1, len(deduped))
    )
    deduped.sort(key=lambda r: r["timestamp"])
    return deduped, duplicates, out_of_order


def compute_quality(readings: list[dict], interval_min: int = SENSOR_INTERVAL_MIN):
    ordered, duplicates, out_of_order = normalize_readings(readings)
    gaps, failures, implausible = [], [], []
    for i in range(1, len(ordered)):
        delta = minutes_between(ordered[i - 1]["timestamp"], ordered[i]["timestamp"])
        if delta >= interval_min * 4:
            failures.append({"since": ordered[i - 1]["timestamp"], "until": ordered[i]["timestamp"], "minutes": delta})
        elif delta > interval_min * 2:
            gaps.append({"after": ordered[i - 1]["timestamp"], "before": ordered[i]["timestamp"], "minutes": delta})
    for reading in ordered:
        if reading["temperature_c"] < IMPLAUSIBLE_MIN_C or reading["temperature_c"] > IMPLAUSIBLE_MAX_C:
            implausible.append(reading["id"])
    return {
        "readings": ordered,
        "duplicates": duplicates,
        "out_of_order": out_of_order,
        "gaps": gaps,
        "failures": failures,
        "implausible": implausible,
    }


def sensor_status(quality: dict, now, interval_min: int = SENSOR_INTERVAL_MIN) -> dict:
    if not quality["readings"]:
        return {"sensor_id": None, "status": "unknown", "last_reading_at": None, "minutes_since_last": None, "readings_count": 0, "gap_count": len(quality["gaps"]), "failure_since": None}
    last = quality["readings"][-1]
    minutes = round((now - parse_iso(last["timestamp"])).total_seconds() / 60)
    status = "failed" if minutes >= interval_min * 4 else ("delayed" if minutes > interval_min * 2 else "reporting")
    return {
        "sensor_id": last["sensor_id"],
        "status": status,
        "last_reading_at": last["timestamp"],
        "minutes_since_last": minutes,
        "readings_count": len(quality["readings"]),
        "gap_count": len(quality["gaps"]),
        "failure_since": last["timestamp"] if status == "failed" else None,
    }


def classify_severity(duration_min: int, magnitude: float, policy: dict, data_quality: str) -> dict:
    if data_quality in {"missing_readings", "sensor_failure", "implausible"}:
        return {"severity": "unknown_review", "rationale": f"data_quality:{data_quality}"}
    if duration_min <= policy["max_excursion_minutes"] and magnitude <= policy["minor_deviation_c"]:
        return {"severity": "warning", "rationale": "duration<=tolerance;magnitude<=minor"}
    if magnitude > policy["major_deviation_c"] or duration_min > policy["critical_duration_minutes"]:
        return {"severity": "critical", "rationale": "magnitude>major" if magnitude > policy["major_deviation_c"] else "duration>critical"}
    if magnitude <= policy["major_deviation_c"]:
        return {"severity": "major", "rationale": "duration>tolerance;magnitude<=major"}
    return {"severity": "warning", "rationale": "default"}


def _group_breaches(breaches: list[dict], evaluated: list[dict], group_gap_min: int):
    groups: list[list[dict]] = []
    for breach in breaches:
        if groups:
            previous = groups[-1][-1]
            delta = minutes_between(previous["timestamp"], breach["timestamp"])
            between = [
                r for r in evaluated
                if parse_iso(previous["timestamp"]) < parse_iso(r["timestamp"]) < parse_iso(breach["timestamp"])
            ]
            if delta <= group_gap_min or not between:
                groups[-1].append(breach)
                continue
        groups.append([breach])
    return groups


def detect_excursions(shipment: dict, readings: list[dict], policy: dict | None, delivery_cutoff=None, now=None, config: dict | None = None) -> dict:
    config = config or {}
    interval = config.get("sensorIntervalMin", SENSOR_INTERVAL_MIN)
    group_gap = config.get("excursionGroupGapMinutes", EXCURSION_GROUP_GAP_MIN)
    quality = compute_quality(readings, interval)
    status = sensor_status(quality, now, interval)

    if policy is None:
        return {"excursions": [], "review_flags": ["policy_missing"], "quality": quality, "sensor_status": status}

    evaluated = [r for r in quality["readings"] if delivery_cutoff is None or parse_iso(r["timestamp"]) <= delivery_cutoff]
    breaches = [r for r in evaluated if is_breach(r["temperature_c"], policy)]
    if not breaches:
        return {"excursions": [], "review_flags": [], "quality": quality, "sensor_status": status}

    groups = _group_breaches(breaches, evaluated, group_gap)
    implausible = set(quality["implausible"])
    excursions = []
    for group in groups:
        start, end = group[0]["timestamp"], group[-1]["timestamp"]
        duration = minutes_between(start, end)
        magnitude = 0.0
        for reading in group:
            if reading["temperature_c"] < policy["min_c"]:
                magnitude = max(magnitude, policy["min_c"] - reading["temperature_c"])
            else:
                magnitude = max(magnitude, reading["temperature_c"] - policy["max_c"])

        gap_inside = any(
            parse_iso(g["after"]) >= parse_iso(start) and parse_iso(g["before"]) <= parse_iso(end) for g in quality["gaps"]
        )
        failure_overlap = any(
            parse_iso(f["since"]) <= parse_iso(end) and parse_iso(f["until"]) >= parse_iso(start) for f in quality["failures"]
        )
        implausible_sole = all(r["id"] in implausible for r in group)

        if implausible_sole:
            data_quality = "implausible"
        elif gap_inside:
            data_quality = "missing_readings"
        elif failure_overlap:
            data_quality = "sensor_failure"
        elif quality["out_of_order"]:
            data_quality = "out_of_order"
        else:
            data_quality = "complete"

        recovered = any(
            parse_iso(r["timestamp"]) > parse_iso(end) and not is_breach(r["temperature_c"], policy) for r in evaluated
        )
        classification = classify_severity(duration, magnitude, policy, data_quality)
        excursions.append({
            "shipment_id": shipment["id"],
            "policy_id": policy["id"],
            "start_time": start,
            "end_time": end if recovered else None,
            "duration_min": duration,
            "peak_deviation_c": round(magnitude, 1),
            "severity": classification["severity"],
            "severity_rationale": classification["rationale"],
            "data_quality": data_quality,
            "status": "open",
            "post_delivery": bool(delivery_cutoff and parse_iso(start) > delivery_cutoff),
        })
    return {"excursions": excursions, "review_flags": [], "quality": quality, "sensor_status": status}


# ---------------------------------------------------------------------------
# Fleet (R3)
# ---------------------------------------------------------------------------
def haversine_km(lat1, lon1, lat2, lon2) -> float:
    radius = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lon / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


def idle_assets(assets: list[dict], assignments: list[dict], now) -> dict:
    by_asset: dict[str, list[dict]] = {}
    for assignment in assignments:
        by_asset.setdefault(assignment["asset_id"], []).append(assignment)

    data, excluded = [], []
    for asset in assets:
        asset_assignments = by_asset.get(asset["id"], [])
        if asset["status"] == "maintenance":
            excluded.append({"asset_id": asset["id"], "reason": "maintenance"})
            continue
        if asset["status"] == "retired":
            excluded.append({"asset_id": asset["id"], "reason": "retired"})
            continue
        active = next(
            (a for a in asset_assignments
             if a["status"] == "active" and parse_iso(a["start_time"]) <= now < parse_iso(a["end_time"])),
            None,
        )
        if active:
            excluded.append({"asset_id": asset["id"], "reason": "currently_assigned", "until": active["end_time"]})
            continue
        future = next((a for a in asset_assignments if parse_iso(a["end_time"]) >= now and a["status"] != "cancelled"), None)
        if future:
            excluded.append({
                "asset_id": asset["id"],
                "reason": "reserved" if future["reserved"] else "unprotected_future_assignment",
                "until": future["start_time"],
            })
            continue
        if not asset.get("available_since"):
            excluded.append({"asset_id": asset["id"], "reason": "missing_availability_timestamp"})
            continue
        data.append({
            "asset": asset,
            "idle_minutes": round((now - parse_iso(asset["available_since"])).total_seconds() / 60),
            "idle_since": asset["available_since"],
        })
    data.sort(key=lambda item: (-item["idle_minutes"], item["asset"]["id"]))
    return {"data": data, "excluded": excluded}


def redeployment_candidates(shipment: dict, segments: list[dict], idle: dict, now, radius_km=REDEPLOY_RADIUS_KM) -> dict:
    current = next((s for s in segments if s["id"] == shipment.get("current_segment_id")), None)
    target_segment = current or (segments[0] if segments else None)
    if target_segment is None:
        return {"data": [], "rejected": [], "excluded": idle["excluded"], "count": 0}
    target = (target_segment["dest_lat"], target_segment["dest_lon"])
    approximate = current is None

    data, rejected = [], []
    for item in idle["data"]:
        asset = item["asset"]
        if asset["capacity_units"] < shipment["volume_units"]:
            rejected.append({"asset_id": asset["id"], "rejected_reason": "insufficient_capacity"})
            continue
        if shipment["is_cold_chain"] and not asset["refrigerated"]:
            rejected.append({"asset_id": asset["id"], "rejected_reason": "incompatible_non_refrigerated"})
            continue
        distance = haversine_km(asset["current_lat"], asset["current_lon"], target[0], target[1])
        if distance > radius_km:
            rejected.append({"asset_id": asset["id"], "rejected_reason": "outside_radius", "details": {"distance_km": round(distance, 1)}})
            continue
        proximity = 1 - min(distance, radius_km) / radius_km
        idle_score = min(item["idle_minutes"], 1440) / 1440
        capacity_fit = min(1.0, asset["capacity_units"] / shipment["volume_units"])
        score = 0.45 * proximity + 0.35 * idle_score + 0.2 * capacity_fit
        data.append({
            "asset_id": asset["id"],
            "score": round(score, 3),
            "factors": {
                "distance_km": round(distance, 1),
                "idle_minutes": item["idle_minutes"],
                "capacity_fit": round(capacity_fit, 3),
                "target_approximate": approximate,
            },
        })
    data.sort(key=lambda item: (-item["score"], item["factors"]["distance_km"], -item["factors"]["idle_minutes"], item["asset_id"]))
    return {"data": data, "rejected": rejected, "excluded": idle["excluded"], "count": len(data)}


# ---------------------------------------------------------------------------
# Alternatives (R2)
# ---------------------------------------------------------------------------
def _route_capacity(segments: list[dict]) -> int:
    return min(s["capacity_units"] for s in segments)


def route_alternatives(shipment, current_route, routes, segments_by_route, carriers_by_id, triggering_regions, other_disruptions) -> dict:
    feasible, rejected = [], []
    same_od = [r for r in routes if r["origin_node"] == current_route["origin_node"] and r["destination_node"] == current_route["destination_node"]]

    for route in same_od:
        segments = segments_by_route.get(route["id"], [])
        carrier = carriers_by_id.get(route["carrier_id"])
        reason = None
        if route["status"] != "active":
            reason = "route_inactive"
        elif carrier is None or carrier["status"] != "active":
            reason = "carrier_inactive"
        elif route["id"] == current_route["id"]:
            reason = "same_as_current"
        elif not segments:
            reason = "missing_segments"
        elif any(s["region_code"] in triggering_regions for s in segments):
            reason = "disrupted_region_overlap"
        elif any(not s.get("capacity_units") or s["capacity_units"] <= 0 for s in segments):
            reason = "missing_capacity_data"
        elif _route_capacity(segments) < shipment["volume_units"]:
            reason = "insufficient_capacity"
        if reason:
            rejected.append({"route_id": route["id"], "rejected_reason": reason})
            continue
        feasible.append(route)

    if not feasible:
        return {"data": [], "rejected": rejected, "no_option_reason": "no_feasible_route"}

    costs = [r["planned_cost_usd"] for r in feasible]
    durations = [r["planned_duration_hours"] for r in feasible]

    def normalize(value, values):
        lo, hi = min(values), max(values)
        return 0.5 if hi == lo else (value - lo) / (hi - lo)

    scored = []
    for route in feasible:
        segments = segments_by_route[route["id"]]
        capacity = _route_capacity(segments)
        margin = (capacity - shipment["volume_units"]) / capacity
        risk_hours = sum(
            (d["severity"] / 5) * s["planned_duration_hours"]
            for s in segments for d in other_disruptions if s["region_code"] == d["region_code"]
        )
        residual = min(1.0, risk_hours / route["planned_duration_hours"])
        score = (
            0.35 * (1 - normalize(route["planned_cost_usd"], costs))
            + 0.35 * (1 - normalize(route["planned_duration_hours"], durations))
            + 0.20 * margin
            - 0.10 * residual
        )
        scored.append({
            "route_id": route["id"],
            "score": round(min(1.0, max(0.0, score)), 3),
            "capacity_margin": round(margin, 3),
            "residual_risk": round(residual, 3),
        })
    scored.sort(key=lambda item: (-item["score"], item["route_id"]))
    return {"data": scored, "rejected": rejected, "no_option_reason": None}


def carrier_alternatives(shipment, current_route, routes, segments_by_route, carriers, triggering_regions, other_disruptions) -> dict:
    """Mirror of carrierAlternatives: best feasible route per non-current carrier."""
    options, rejected = [], []
    for carrier in carriers:
        if carrier["id"] == current_route["carrier_id"]:
            continue
        if carrier["status"] != "active":
            rejected.append({"carrier_id": carrier["id"], "rejected_reason": "carrier_inactive"})
            continue
        carrier_routes = [r for r in routes if r["carrier_id"] == carrier["id"]]
        result = route_alternatives(
            shipment, current_route, carrier_routes, segments_by_route,
            {carrier["id"]: carrier}, triggering_regions, other_disruptions,
        )
        if not result["data"]:
            rejected.append({"carrier_id": carrier["id"], "rejected_reason": "no_feasible_route"})
            continue
        best = result["data"][0]
        options.append({"carrier_id": carrier["id"], "backing_route_id": best["route_id"], "score": best["score"]})
    options.sort(key=lambda item: (-item["score"], item["carrier_id"]))
    return {"data": options, "rejected": rejected, "no_option_reason": None if options else "no_feasible_carrier"}


# ---------------------------------------------------------------------------
# Risk (P2)
# ---------------------------------------------------------------------------
def coldchain_risk(excursions: list[dict], review_flags: list[str]) -> dict:
    open_excursions = [e for e in excursions if e["status"] != "closed"]
    if open_excursions:
        worst = max(open_excursions, key=lambda e: SEVERITY_RANK[e["severity"]])
        return {
            "risk_score": round(SEVERITY_WEIGHTS[worst["severity"]], 3),
            "severity": worst["severity"],
            "worst_excursion_index": worst.get("index"),
            "excursion_count": len(open_excursions),
        }
    if review_flags:
        return {"risk_score": 0.5, "severity": "unknown_review", "worst_excursion_index": None, "excursion_count": 0}
    return {"risk_score": 0.0, "severity": "normal", "worst_excursion_index": None, "excursion_count": 0}


def combined_score(disruption_risk: float, coldchain_risk_value: float) -> float:
    return round(RISK_ALPHA * disruption_risk + RISK_BETA * coldchain_risk_value, 3)


# ---------------------------------------------------------------------------
# Ground truth assembly
# ---------------------------------------------------------------------------
def build_ground_truth(now, logistics: dict, coldchain: dict, scenarios: dict) -> dict:
    shipments = logistics["shipments"]
    routes = logistics["routes"]
    segments_by_route = logistics["segments_by_route"]
    disruptions = logistics["disruptions"]
    assets = logistics["fleet"][0]
    assignments = logistics["fleet"][1]
    carriers_by_id = {c["id"]: c for c in logistics["carriers"]}
    routes_by_id = {r["id"]: r for r in routes}
    shipments_by_id = {s["id"]: s for s in shipments}
    policies = {p["cargo_type"]: p for p in coldchain["temperature_policies"]}
    readings_by_shipment: dict[str, list[dict]] = {}
    for reading in coldchain["sensor_readings"]:
        readings_by_shipment.setdefault(reading["shipment_id"], []).append(reading)

    # Matching
    matching = match_shipments(shipments, routes_by_id, segments_by_route, disruptions, now)

    # Excursions (per cold shipment)
    excursions: list[dict] = []
    review_flags: dict[str, list[str]] = {}
    for shipment in shipments:
        if not shipment["is_cold_chain"]:
            continue
        readings = readings_by_shipment.get(shipment["id"], [])
        policy = policies.get(shipment["cargo_type"])
        cutoff = parse_iso(shipment["actual_arrival"]) if shipment.get("actual_arrival") else None
        result = detect_excursions(shipment, readings, policy, cutoff, now)
        if result["review_flags"]:
            review_flags[shipment["id"]] = result["review_flags"]
        for excursion in result["excursions"]:
            excursion["index"] = len(excursions) + 1
            excursions.append(excursion)

    # Fleet
    idle = idle_assets(assets, assignments, now)
    redeployment = {}
    for shipment_id in ("S009", "S013", "S014", "S015", "S016", "S017", "S018", "S019"):
        shipment = shipments_by_id[shipment_id]
        redeployment[shipment_id] = redeployment_candidates(
            shipment, segments_by_route.get(shipment["route_id"], []), idle, now
        )

    # Alternatives
    active_disruptions = [d for d in disruptions if is_disruption_active(d, now)]
    alternatives = {}
    for shipment_id in ("S004", "S005", "S006", "S040"):
        shipment = shipments_by_id[shipment_id]
        current_route = routes_by_id[shipment["route_id"]]
        segments = segments_by_route.get(shipment["route_id"], [])
        triggering_regions = sorted({
            d["region_code"] for d in active_disruptions
            if any(s["region_code"] == d["region_code"] for s in segments)
        })
        others = [d for d in active_disruptions if d["region_code"] not in triggering_regions]
        alternatives[shipment_id] = route_alternatives(
            shipment, current_route, routes, segments_by_route, carriers_by_id, triggering_regions, others
        )
        if shipment_id == "S006":
            alternatives[shipment_id]["carrier_alternatives"] = carrier_alternatives(
                shipment, current_route, routes, segments_by_route, list(carriers_by_id.values()), triggering_regions, others
            )

    # Risk (cold-chain side + combined for S039)
    risk = {}
    matching_by_shipment = {row["shipment_id"]: row for row in matching}
    for shipment in shipments:
        if not shipment["is_cold_chain"]:
            continue
        own_excursions = [e for e in excursions if e["shipment_id"] == shipment["id"]]
        flags = review_flags.get(shipment["id"], [])
        cold = coldchain_risk(own_excursions, flags)
        entry = {
            "coldchain_risk": cold["risk_score"],
            "severity": cold["severity"],
            "excursion_count": cold["excursion_count"],
            "review_flags": flags,
        }
        match_row = matching_by_shipment.get(shipment["id"])
        if match_row:
            disruption_risk = match_row["impact_score"]
            entry["disruption_risk"] = disruption_risk
            entry["combined_score"] = combined_score(disruption_risk, cold["risk_score"])
        risk[shipment["id"]] = entry

    # Scenario map
    scenario_map = {}
    for scenario_id, description in scenarios.items():
        expected: dict = {}
        if scenario_id in ("SCN-001", "SCN-002", "SCN-004", "SCN-005", "SCN-006", "SCN-007", "SCN-008", "SCN-010"):
            expected["matching"] = matching
        if scenario_id == "SCN-003":
            expected["active_disruptions"] = [d["id"] for d in active_disruptions]
        if scenario_id == "SCN-011":
            expected["alternatives"] = {"shipment_id": "S004", **alternatives["S004"]}
        if scenario_id == "SCN-012":
            expected["alternatives"] = {"shipment_id": "S005", **alternatives["S005"]}
        if scenario_id == "SCN-013":
            expected["alternatives"] = {"shipment_id": "S006", **alternatives["S006"]}
        if scenario_id == "SCN-015":
            expected["alternatives"] = {"shipment_id": "S040", **alternatives["S040"]}
        if scenario_id in ("SCN-016", "SCN-017", "SCN-018", "SCN-019", "SCN-020", "SCN-021"):
            target = {"SCN-016": "S013", "SCN-017": "S014", "SCN-018": "S015", "SCN-019": "S016", "SCN-020": "S017", "SCN-021": "S009"}[scenario_id]
            expected["redeployment"] = {"shipment_id": target, **redeployment[target]}
        if scenario_id == "SCN-022":
            expected["idle_excluded"] = [item for item in idle["excluded"] if item["asset_id"] == "A007"]
        if scenario_id == "SCN-023":
            expected["asset_assignments"] = [a for a in assignments if a["asset_id"] == "A006"]
        if scenario_id.startswith("SCN-1"):
            if scenario_id == "SCN-120":
                expected["risk"] = {"S039": risk["S039"]}
                expected["excursions"] = [e for e in excursions if e["shipment_id"] == "S039"]
            else:
                expected["excursions"] = excursions
        scenario_map[scenario_id] = {"description": description, "expected": expected}

    return {
        "matching": matching,
        "excursions": excursions,
        "review_flags": review_flags,
        "fleet": idle,
        "redeployment": redeployment,
        "alternatives": alternatives,
        "risk": risk,
        "scenarios": scenario_map,
    }
