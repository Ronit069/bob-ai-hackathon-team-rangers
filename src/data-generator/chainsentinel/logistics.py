"""Logistics fixture builder — carriers, routes, segments, shipments, disruptions, fleet.

All values follow docs/phase-0/data-contract.md (incl. A-3 planned/actual times).
Scenario shipments S001..S040 implement the approved edge cases (SCN-001..SCN-023);
fillers S041..S048 complete the demo network.
"""

from __future__ import annotations

from datetime import timedelta

from .common import (
    ASSIGNMENT_STATUSES,
    parse_iso,
    plus_hours,
    plus_minutes,
    iso,
    REGION_CODES,
)

# ---------------------------------------------------------------------------
# Carriers (C01..C09; C09 inactive — used by the carrier-unavailable scenario)
# ---------------------------------------------------------------------------
def build_carriers() -> list[dict]:
    return [
        {"id": "C01", "name": "BlueWave Shipping", "service_regions": ["IN-WEST-COAST", "AE-JEBEL-ALI"], "modes": ["sea"], "capacity_units": 900, "cost_index": 1.05, "reliability_score": 0.94, "status": "active"},
        {"id": "C02", "name": "Gulf Star Logistics", "service_regions": ["IN-WEST-COAST", "AE-JEBEL-ALI"], "modes": ["sea"], "capacity_units": 700, "cost_index": 1.12, "reliability_score": 0.88, "status": "active"},
        {"id": "C03", "name": "NorthSea Lines", "service_regions": ["AE-JEBEL-ALI", "EU-ROTTERDAM"], "modes": ["sea"], "capacity_units": 1100, "cost_index": 0.98, "reliability_score": 0.91, "status": "active"},
        {"id": "C04", "name": "HarborLink Freight", "service_regions": ["SG-SINGAPORE", "EU-ROTTERDAM"], "modes": ["sea"], "capacity_units": 300, "cost_index": 0.92, "reliability_score": 0.83, "status": "active"},
        {"id": "C05", "name": "Pacific Crown Carriers", "service_regions": ["CN-EAST-COAST", "US-WEST-COAST"], "modes": ["sea"], "capacity_units": 1200, "cost_index": 1.01, "reliability_score": 0.92, "status": "active"},
        {"id": "C06", "name": "Merlion Shipping", "service_regions": ["SG-SINGAPORE", "EU-ROTTERDAM"], "modes": ["sea"], "capacity_units": 800, "cost_index": 1.08, "reliability_score": 0.89, "status": "active"},
        {"id": "C07", "name": "Malabar Coastal", "service_regions": ["IN-WEST-COAST", "SG-SINGAPORE"], "modes": ["sea"], "capacity_units": 600, "cost_index": 0.95, "reliability_score": 0.86, "status": "active"},
        {"id": "C08", "name": "Atlantic Bridge", "service_regions": ["US-EAST-COAST", "EU-ROTTERDAM"], "modes": ["sea"], "capacity_units": 1000, "cost_index": 1.03, "reliability_score": 0.90, "status": "active"},
        {"id": "C09", "name": "Legacy Freight Co", "service_regions": ["IN-WEST-COAST", "AE-JEBEL-ALI"], "modes": ["sea"], "capacity_units": 400, "cost_index": 1.20, "reliability_score": 0.70, "status": "inactive"},
    ]


# ---------------------------------------------------------------------------
# Routes and segments (16 segments across 8 routes; R071 is a deliberate defect route)
# ---------------------------------------------------------------------------
ROUTE_DEFS = [
    {
        "id": "R001", "carrier_id": "C01", "origin_node": "INMUM", "destination_node": "AEJEA",
        "cost": 84000, "segments": [
            {"id": "SEG-001", "seq": 1, "name": "SEA-1 Mumbai–Jebel Ali", "region": "IN-WEST-COAST", "mode": "sea", "hours": 96, "capacity": 220, "cost": 14000, "origin": "INMUM", "destination": "AEJEA", "dest": (25.0128, 55.0614)},
            {"id": "SEG-002", "seq": 2, "name": "SEA-2 Jebel Ali–Rotterdam", "region": "AE-JEBEL-ALI", "mode": "sea", "hours": 48, "capacity": 220, "cost": 9000, "origin": "AEJEA", "destination": "NLRTM", "dest": (51.9244, 4.4777)},
        ],
    },
    {
        "id": "R002", "carrier_id": "C02", "origin_node": "INMUM", "destination_node": "AEJEA",
        "cost": 91000, "segments": [
            {"id": "SEG-003", "seq": 1, "name": "SEA-3 Mumbai–Jebel Ali (slow)", "region": "IN-WEST-COAST", "mode": "sea", "hours": 72, "capacity": 180, "cost": 15000, "origin": "INMUM", "destination": "AEJEA", "dest": (25.0128, 55.0614)},
            {"id": "SEG-004", "seq": 2, "name": "SEA-4 Jebel Ali–Rotterdam (slow)", "region": "AE-JEBEL-ALI", "mode": "sea", "hours": 36, "capacity": 180, "cost": 8000, "origin": "AEJEA", "destination": "NLRTM", "dest": (51.9244, 4.4777)},
        ],
    },
    {
        "id": "R003", "carrier_id": "C03", "origin_node": "AEJEA", "destination_node": "NLRTM",
        "cost": 120000, "segments": [
            {"id": "SEG-005", "seq": 1, "name": "SEA-5 Jebel Ali–Suez", "region": "AE-JEBEL-ALI", "mode": "sea", "hours": 120, "capacity": 260, "cost": 22000, "origin": "AEJEA", "destination": "EGSUZ", "dest": (30.0170, 32.5800)},
            {"id": "SEG-006", "seq": 2, "name": "SEA-6 Suez–Rotterdam", "region": "EU-ROTTERDAM", "mode": "sea", "hours": 96, "capacity": 260, "cost": 18000, "origin": "EGSUZ", "destination": "NLRTM", "dest": (51.9244, 4.4777)},
        ],
    },
    {
        "id": "R004", "carrier_id": "C05", "origin_node": "CNSHA", "destination_node": "USLAX",
        "cost": 96000, "segments": [
            {"id": "SEG-007", "seq": 1, "name": "SEA-7 Shanghai–Pacific", "region": "CN-EAST-COAST", "mode": "sea", "hours": 72, "capacity": 240, "cost": 16000, "origin": "CNSHA", "destination": "PACMID", "dest": (31.2304, 121.4737)},
            {"id": "SEG-008", "seq": 2, "name": "SEA-8 Pacific–Los Angeles", "region": "US-WEST-COAST", "mode": "sea", "hours": 120, "capacity": 240, "cost": 20000, "origin": "PACMID", "destination": "USLAX", "dest": (33.7395, -118.2610)},
        ],
    },
    {
        "id": "R005", "carrier_id": "C06", "origin_node": "SGSIN", "destination_node": "NLRTM",
        "cost": 96000, "segments": [
            {"id": "SEG-009", "seq": 1, "name": "SEA-9 Singapore–Malacca", "region": "SG-SINGAPORE", "mode": "sea", "hours": 48, "capacity": 200, "cost": 12000, "origin": "SGSIN", "destination": "MYPKG", "dest": (1.2905, 103.8520)},
            {"id": "SEG-010", "seq": 2, "name": "SEA-10 Malacca–Rotterdam", "region": "EU-ROTTERDAM", "mode": "sea", "hours": 240, "capacity": 200, "cost": 30000, "origin": "MYPKG", "destination": "NLRTM", "dest": (51.9244, 4.4777)},
        ],
    },
    {
        "id": "R006", "carrier_id": "C04", "origin_node": "SGSIN", "destination_node": "NLRTM",
        "cost": 88000, "segments": [
            {"id": "SEG-011", "seq": 1, "name": "SEA-11 Singapore–Malacca (light)", "region": "SG-SINGAPORE", "mode": "sea", "hours": 60, "capacity": 8, "cost": 11000, "origin": "SGSIN", "destination": "MYPKG", "dest": (1.2905, 103.8520)},
            {"id": "SEG-012", "seq": 2, "name": "SEA-12 Malacca–Rotterdam (light)", "region": "EU-ROTTERDAM", "mode": "sea", "hours": 240, "capacity": 8, "cost": 28000, "origin": "MYPKG", "destination": "NLRTM", "dest": (51.9244, 4.4777)},
        ],
    },
    {
        "id": "R007", "carrier_id": "C07", "origin_node": "INNSA", "destination_node": "SGSIN",
        "cost": 62000, "segments": [
            {"id": "SEG-013", "seq": 1, "name": "SEA-13 Nhava Sheva–Malacca", "region": "IN-WEST-COAST", "mode": "sea", "hours": 60, "capacity": 160, "cost": 10000, "origin": "INNSA", "destination": "MYPKG", "dest": (1.2905, 103.8520)},
            {"id": "SEG-014", "seq": 2, "name": "SEA-14 Malacca–Singapore", "region": "SG-SINGAPORE", "mode": "sea", "hours": 84, "capacity": 160, "cost": 9000, "origin": "MYPKG", "destination": "SGSIN", "dest": (1.2905, 103.8520)},
        ],
    },
    {
        "id": "R008", "carrier_id": "C08", "origin_node": "USNYC", "destination_node": "NLRTM",
        "cost": 105000, "segments": [
            {"id": "SEG-015", "seq": 1, "name": "SEA-15 New York–Atlantic", "region": "US-EAST-COAST", "mode": "sea", "hours": 100, "capacity": 280, "cost": 24000, "origin": "USNYC", "destination": "ATLMID", "dest": (40.7128, -74.0060)},
            {"id": "SEG-016", "seq": 2, "name": "SEA-16 Atlantic–Rotterdam", "region": "EU-ROTTERDAM", "mode": "sea", "hours": 150, "capacity": 280, "cost": 26000, "origin": "ATLMID", "destination": "NLRTM", "dest": (51.9244, 4.4777)},
        ],
    },
    # Deliberate defect route for SCN-005 (missing route data). Tagged in the validator.
    {"id": "R071", "carrier_id": "C08", "origin_node": "USNYC", "destination_node": "NLRTM", "cost": 99000, "segments": [], "defect": True},
]


def build_routes_and_segments() -> tuple[list[dict], list[dict], dict]:
    """Returns (routes, segments, segments_by_route)."""
    routes: list[dict] = []
    segments: list[dict] = []
    segments_by_route: dict[str, list[dict]] = {}

    for definition in ROUTE_DEFS:
        # The defect route R071 intentionally has no segments; keep its own metrics plausible
        # so the row still satisfies the database constraints (the defect is the missing segments).
        total_hours = sum(seg["hours"] for seg in definition["segments"]) or 48
        total_km = sum(1800 if seg["mode"] == "sea" else 400 for seg in definition["segments"]) or 3600
        route_record = {
            "id": definition["id"],
            "origin_node": definition["origin_node"],
            "destination_node": definition["destination_node"],
            "carrier_id": definition["carrier_id"],
            "status": "active",
            "total_distance_km": round(total_km, 1),
            "planned_duration_hours": round(total_hours, 1),
            "planned_cost_usd": definition["cost"],
            "created_at": "2026-08-01T00:00:00Z",
        }
        if definition.get("defect"):
            route_record["defect"] = True  # deliberate defect fixture (SCN-005); ignored by the seed loader
        routes.append(route_record)
        route_segments = []
        for seg in definition["segments"]:
            record = {
                "id": seg["id"],
                "route_id": definition["id"],
                "seq": seg["seq"],
                "name": seg["name"],
                "region_code": seg["region"],
                "mode": seg["mode"],
                "origin_node": seg["origin"],
                "destination_node": seg["destination"],
                "distance_km": round(1800.0 if seg["mode"] == "sea" else 400.0, 1),
                "planned_duration_hours": float(seg["hours"]),
                "capacity_units": seg["capacity"],
                "cost_usd": seg["cost"],
                "dest_lat": seg["dest"][0],
                "dest_lon": seg["dest"][1],
            }
            route_segments.append(record)
            segments.append(record)
        segments_by_route[definition["id"]] = route_segments

    return routes, segments, segments_by_route


# ---------------------------------------------------------------------------
# Disruptions (5; D01/D02/D04 active, D03 scheduled, D05 resolved)
# ---------------------------------------------------------------------------
def build_disruptions(now) -> list[dict]:
    return [
        {"id": "D01", "type": "port_strike", "region_code": "IN-WEST-COAST", "start_time": iso(plus_hours(now, -3)), "end_time": iso(plus_hours(now, 69)), "severity": 4, "status": "active", "description": "Dock workers strike at Mumbai port; berth operations suspended.", "created_by": "operator-1"},
        {"id": "D02", "type": "weather", "region_code": "US-WEST-COAST", "start_time": iso(plus_hours(now, -12)), "end_time": None, "severity": 3, "status": "active", "description": "Storm system disrupting Los Angeles port approaches; expected duration unknown.", "created_by": "operator-1"},
        {"id": "D03", "type": "customs", "region_code": "EU-ROTTERDAM", "start_time": iso(plus_hours(now, 144)), "end_time": iso(plus_hours(now, 192)), "severity": 2, "status": "scheduled", "description": "Planned customs system maintenance window at Rotterdam.", "created_by": "operator-1"},
        {"id": "D04", "type": "geopolitical", "region_code": "AE-JEBEL-ALI", "start_time": iso(plus_hours(now, -9)), "end_time": iso(plus_hours(now, 39)), "severity": 2, "status": "active", "description": "Regional tension causing inspection delays at Jebel Ali.", "created_by": "operator-1"},
        {"id": "D05", "type": "weather", "region_code": "CN-EAST-COAST", "start_time": iso(plus_hours(now, -240)), "end_time": iso(plus_hours(now, -120)), "severity": 3, "status": "resolved", "description": "Typhoon warning lifted; Shanghai operations resumed.", "created_by": "operator-1"},
    ]


# ---------------------------------------------------------------------------
# Shipments
# ---------------------------------------------------------------------------
def _shipment_times(route_segments: list[dict], current_segment_id: str | None, seg_start):
    if current_segment_id is None or not route_segments:
        return None, None
    current = next(seg for seg in route_segments if seg["id"] == current_segment_id)
    hours_before = sum(seg["planned_duration_hours"] for seg in route_segments if seg["seq"] < current["seq"])
    departure = seg_start - timedelta(hours=hours_before)
    total_hours = sum(seg["planned_duration_hours"] for seg in route_segments)
    return departure, departure + timedelta(hours=total_hours)


# (id, route, current_segment, current-segment start offset minutes from now, cargo, cold, value, volume, deadline offset hours, status, tags)
LOGISTICS_SCENARIOS = [
    ("S001", "R001", "SEG-001", -4320, "electronics", False, 310000, 20, 96, "in_transit", ["SCN-001", "SCN-004"]),
    ("S002", "R001", "SEG-002", -720, "machinery", False, 180000, 24, 120, "in_transit", ["SCN-001"]),
    ("S003", "R007", "SEG-013", -1440, "apparel", False, 95000, 30, 72, "in_transit", ["SCN-001"]),
    ("S004", "R001", "SEG-001", -4320, "electronics", False, 260000, 18, 96, "in_transit", ["SCN-011"]),
    ("S005", "R005", "SEG-009", -720, "machinery", False, 150000, 12, 200, "in_transit", ["SCN-012"]),
    ("S006", "R001", "SEG-001", -4320, "apparel", False, 88000, 16, 96, "in_transit", ["SCN-013"]),
    ("S007", "R008", "SEG-016", -3600, "electronics", False, 210000, 22, -48, "delivered", ["SCN-007"]),
    ("S008", "R007", "SEG-014", -3600, "machinery", False, 130000, 26, 72, "in_transit", ["SCN-008"]),
    ("S009", "R007", "SEG-014", -180, "apparel", False, 76000, 14, 72, "in_transit", ["SCN-010"]),
    ("S010", "R071", None, None, "machinery", False, 140000, 20, 120, "in_transit", ["SCN-005"]),
    ("S011", "R004", "SEG-007", -4260, "electronics", False, 240000, 28, 144, "in_transit", ["SCN-006"]),
    ("S012", "R003", "SEG-006", -1200, "machinery", False, 120000, 20, 160, "in_transit", []),
    ("S013", "R005", "SEG-009", -720, "apparel", False, 60000, 10, 200, "in_transit", ["SCN-016"]),
    ("S014", "R005", "SEG-009", -720, "machinery", False, 65000, 10, 200, "in_transit", ["SCN-017"]),
    ("S015", "R005", "SEG-009", -720, "vaccine", True, 420000, 10, 36, "in_transit", ["SCN-018"]),
    ("S016", "R005", "SEG-009", -720, "apparel", False, 58000, 8, 200, "in_transit", ["SCN-019"]),
    ("S017", "R008", "SEG-016", -3600, "insulin", True, 380000, 10, 48, "in_transit", ["SCN-020"]),
    ("S018", "R005", "SEG-009", -720, "machinery", False, 62000, 8, 200, "in_transit", ["SCN-021"]),
    ("S019", "R005", "SEG-009", -720, "apparel", False, 59000, 8, 200, "in_transit", ["SCN-021"]),
    ("S020", "R005", "SEG-009", -720, "electronics", False, 72000, 10, 200, "in_transit", ["SCN-023"]),
]

# Cold-chain scenario shipments (details in coldchain.py; routes/positions here)
COLD_SCENARIOS = [
    ("S021", "R005", "SEG-009", -720, "vaccine", 480000, 10, 96, ["SCN-101"]),
    ("S022", "R005", "SEG-009", -720, "vaccine", 470000, 10, 96, ["SCN-102"]),
    ("S023", "R005", "SEG-009", -720, "vaccine", 460000, 10, 96, ["SCN-103"]),
    ("S024", "R005", "SEG-009", -720, "vaccine", 450000, 10, 96, ["SCN-104"]),
    ("S025", "R005", "SEG-009", -720, "vaccine", 440000, 10, 96, ["SCN-105"]),
    ("S026", "R005", "SEG-009", -720, "vaccine", 430000, 10, 96, ["SCN-106"]),
    ("S027", "R005", "SEG-009", -720, "vaccine", 420000, 10, 96, ["SCN-107"]),
    ("S028", "R005", "SEG-009", -720, "vaccine", 410000, 10, 96, ["SCN-108"]),
    ("S029", "R005", "SEG-009", -720, "vaccine", 400000, 10, 96, ["SCN-109"]),
    ("S030", "R005", "SEG-009", -720, "vaccine", 390000, 10, 96, ["SCN-110"]),
    ("S031", "R005", "SEG-009", -720, "vaccine", 380000, 10, 96, ["SCN-111"]),
    ("S032", "R005", "SEG-009", -720, "vaccine_lot_x", 370000, 10, 96, ["SCN-112"]),
    ("S033", "R005", "SEG-009", -720, "perishable_exotic", 360000, 10, 96, ["SCN-113"]),
    ("S034", "R005", "SEG-009", -720, "vaccine", 350000, 10, 8, ["SCN-114"]),
    ("S035", "R005", "SEG-009", -720, "vaccine", 340000, 10, -1, ["SCN-115"]),
    ("S036", "R005", "SEG-009", -720, "vaccine", 330000, 10, 96, ["SCN-116"]),
    ("S037", "R005", "SEG-009", -720, "vaccine", 320000, 10, 96, ["SCN-117"]),
    ("S038", "R005", "SEG-009", -720, "vaccine", 310000, 10, 96, ["SCN-118"]),
    ("S039", "R001", "SEG-001", -4320, "vaccine", 520000, 12, 96, ["SCN-120"]),
]

FILLER_SHIPMENTS = [
    ("S040", "R005", "SEG-009", -720, "apparel", False, 55000, 6, 200, "in_transit", ["SCN-015"]),
    ("S041", "R003", "SEG-005", -1200, "electronics", False, 175000, 22, 160, "in_transit", []),
    ("S042", "R002", "SEG-003", -1440, "machinery", False, 98000, 18, 120, "in_transit", []),
    ("S043", "R004", "SEG-007", -2160, "apparel", False, 64000, 20, 144, "in_transit", []),
    ("S044", "R008", "SEG-015", -2400, "electronics", False, 205000, 24, 180, "in_transit", []),
    ("S045", "R006", "SEG-011", -600, "machinery", False, 72000, 5, 220, "in_transit", []),
    ("S046", "R003", "SEG-005", -3600, "apparel", False, 52000, 16, 100, "in_transit", []),
    ("S047", "R007", "SEG-013", -2880, "fresh_produce", True, 90000, 14, 60, "in_transit", []),
    ("S048", "R002", "SEG-003", -4800, "frozen_food", True, 110000, 12, 80, "in_transit", []),
]


def build_shipments(now) -> list[dict]:
    _, _, segments_by_route = build_routes_and_segments()
    shipments: list[dict] = []

    def add(shipment_id, route_id, segment_id, offset_min, cargo, cold, value, volume, deadline_offset_h, status, tags):
        route_segments = segments_by_route.get(route_id, [])
        if segment_id is None or not route_segments:
            departure, arrival = None, None
            current = None
        else:
            seg_start = plus_minutes(now, offset_min)
            departure, arrival = _shipment_times(route_segments, segment_id, seg_start)
            current = segment_id

        actual_arrival = None
        actual_departure = None
        if status == "delivered":
            actual_arrival = iso(plus_minutes(now, -1800))
            actual_departure = iso(departure) if departure else None

        # Defect route R071 has no segments: A-3 fields are still required by the
        # contract, so anchor them around now for the unknown_review scenario.
        if departure is None:
            departure = plus_hours(now, -24)
            arrival = plus_hours(now, 24)

        shipments.append({
            "id": shipment_id,
            "route_id": route_id,
            "cargo_type": cargo,
            "is_cold_chain": cold,
            "cargo_value_usd": value,
            "volume_units": volume,
            "deadline": iso(plus_hours(now, deadline_offset_h)),
            "status": status,
            "current_segment_id": current,
            "planned_departure": iso(departure),
            "planned_arrival": iso(arrival),
            "actual_departure": actual_departure,
            "actual_arrival": actual_arrival,
            "created_at": "2026-09-01T08:00:00Z",
            "updated_at": iso(plus_hours(now, -1)),
            "scenario_tags": tags,
        })

    for row in LOGISTICS_SCENARIOS:
        add(*row)
    for shipment_id, route_id, segment_id, offset, cargo, value, volume, deadline, tags in COLD_SCENARIOS:
        add(shipment_id, route_id, segment_id, offset, cargo, True, value, volume, deadline, "in_transit", tags)
    for row in FILLER_SHIPMENTS:
        add(*row)

    # S035 is delivered (post-delivery excursion scenario).
    for shipment in shipments:
        if shipment["id"] == "S035":
            shipment["status"] = "delivered"
            shipment["actual_arrival"] = iso(plus_minutes(now, -60))
            shipment["actual_departure"] = shipment["planned_departure"]
    # S007 delivered with arrival before now.
    for shipment in shipments:
        if shipment["id"] == "S007":
            shipment["actual_arrival"] = iso(plus_minutes(now, -1800))

    return shipments


# ---------------------------------------------------------------------------
# Fleet assets and assignments
# ---------------------------------------------------------------------------
def build_fleet(now) -> tuple[list[dict], list[dict]]:
    assets = [
        # Scenario assets near Singapore (SEG-009 destination)
        {"id": "A001", "type": "truck", "capacity_units": 16, "refrigerated": False, "current_lat": 1.3000, "current_lon": 103.8500, "current_region_code": "SG-SINGAPORE", "status": "available", "available_since": iso(plus_minutes(now, -372))},
        {"id": "A002", "type": "container", "capacity_units": 30, "refrigerated": True, "current_lat": 1.3500, "current_lon": 103.9000, "current_region_code": "SG-SINGAPORE", "status": "available", "available_since": iso(plus_minutes(now, -900))},
        {"id": "A003", "type": "truck", "capacity_units": 18, "refrigerated": False, "current_lat": 1.2800, "current_lon": 103.8000, "current_region_code": "SG-SINGAPORE", "status": "available", "available_since": iso(plus_minutes(now, -500))},
        {"id": "A004", "type": "vessel", "capacity_units": 400, "refrigerated": True, "current_lat": 3.4500, "current_lon": 103.8500, "current_region_code": "SG-SINGAPORE", "status": "available", "available_since": iso(plus_minutes(now, -2000))},
        {"id": "A005", "type": "truck", "capacity_units": 20, "refrigerated": True, "current_lat": 1.3000, "current_lon": 105.1500, "current_region_code": "SG-SINGAPORE", "status": "available", "available_since": iso(plus_minutes(now, -600))},
        {"id": "A006", "type": "truck", "capacity_units": 14, "refrigerated": True, "current_lat": 1.3200, "current_lon": 103.8600, "current_region_code": "SG-SINGAPORE", "status": "available", "available_since": iso(plus_minutes(now, -420))},
        {"id": "A007", "type": "container", "capacity_units": 12, "refrigerated": True, "current_lat": 1.3100, "current_lon": 103.8700, "current_region_code": "SG-SINGAPORE", "status": "available", "available_since": None},
        {"id": "A008", "type": "truck", "capacity_units": 10, "refrigerated": False, "current_lat": 19.0760, "current_lon": 72.8777, "current_region_code": "IN-WEST-COAST", "status": "maintenance", "available_since": None},
        {"id": "A009", "type": "container", "capacity_units": 40, "refrigerated": True, "current_lat": 25.0128, "current_lon": 55.0614, "current_region_code": "AE-JEBEL-ALI", "status": "retired", "available_since": None},
        # Fillers across regions
        {"id": "A010", "type": "truck", "capacity_units": 18, "refrigerated": True, "current_lat": 51.9244, "current_lon": 4.4777, "current_region_code": "EU-ROTTERDAM", "status": "available", "available_since": iso(plus_minutes(now, -240))},
        {"id": "A011", "type": "truck", "capacity_units": 12, "refrigerated": False, "current_lat": 51.9500, "current_lon": 4.5000, "current_region_code": "EU-ROTTERDAM", "status": "available", "available_since": iso(plus_minutes(now, -300))},
        {"id": "A012", "type": "container", "capacity_units": 60, "refrigerated": True, "current_lat": 19.1000, "current_lon": 72.9000, "current_region_code": "IN-WEST-COAST", "status": "available", "available_since": iso(plus_minutes(now, -1000))},
        {"id": "A013", "type": "truck", "capacity_units": 14, "refrigerated": False, "current_lat": 25.0500, "current_lon": 55.1000, "current_region_code": "AE-JEBEL-ALI", "status": "available", "available_since": iso(plus_minutes(now, -700))},
        {"id": "A014", "type": "vessel", "capacity_units": 500, "refrigerated": True, "current_lat": 31.2304, "current_lon": 121.4737, "current_region_code": "CN-EAST-COAST", "status": "available", "available_since": iso(plus_minutes(now, -1500))},
        {"id": "A015", "type": "truck", "capacity_units": 16, "refrigerated": True, "current_lat": 33.7395, "current_lon": -118.2610, "current_region_code": "US-WEST-COAST", "status": "available", "available_since": iso(plus_minutes(now, -800))},
        {"id": "A016", "type": "container", "capacity_units": 24, "refrigerated": False, "current_lat": 40.7128, "current_lon": -74.0060, "current_region_code": "US-EAST-COAST", "status": "available", "available_since": iso(plus_minutes(now, -1100))},
        {"id": "A017", "type": "truck", "capacity_units": 10, "refrigerated": True, "current_lat": 1.3400, "current_lon": 103.8800, "current_region_code": "SG-SINGAPORE", "status": "available", "available_since": iso(plus_minutes(now, -200))},
        {"id": "A018", "type": "truck", "capacity_units": 8, "refrigerated": True, "current_lat": 1.3600, "current_lon": 103.8900, "current_region_code": "SG-SINGAPORE", "status": "available", "available_since": iso(plus_minutes(now, -180))},
        {"id": "A019", "type": "container", "capacity_units": 32, "refrigerated": True, "current_lat": 51.9000, "current_lon": 4.4500, "current_region_code": "EU-ROTTERDAM", "status": "available", "available_since": iso(plus_minutes(now, -950))},
        {"id": "A020", "type": "truck", "capacity_units": 12, "refrigerated": False, "current_lat": 19.0800, "current_lon": 72.8800, "current_region_code": "IN-WEST-COAST", "status": "available", "available_since": iso(plus_minutes(now, -650))},
        {"id": "A021", "type": "truck", "capacity_units": 15, "refrigerated": True, "current_lat": 25.0200, "current_lon": 55.0700, "current_region_code": "AE-JEBEL-ALI", "status": "available", "available_since": iso(plus_minutes(now, -540))},
        {"id": "A022", "type": "container", "capacity_units": 28, "refrigerated": True, "current_lat": 31.2400, "current_lon": 121.4800, "current_region_code": "CN-EAST-COAST", "status": "available", "available_since": iso(plus_minutes(now, -430))},
        {"id": "A023", "type": "vessel", "capacity_units": 600, "refrigerated": True, "current_lat": 1.2500, "current_lon": 103.8200, "current_region_code": "SG-SINGAPORE", "status": "available", "available_since": iso(plus_minutes(now, -2600))},
        {"id": "A024", "type": "truck", "capacity_units": 11, "refrigerated": False, "current_lat": 40.7300, "current_lon": -74.0100, "current_region_code": "US-EAST-COAST", "status": "available", "available_since": iso(plus_minutes(now, -320))},
    ]

    # Windows are deliberately long so the scenario stays valid for the whole demo day
    # (fixtures are anchored at the frozen --now; short windows would expire hours later).
    assignments = [
        # A002 reserved for a future job (SCN-017)
        {"id": "AA-0001", "asset_id": "A002", "shipment_id": "S014", "start_time": iso(plus_hours(now, 36)), "end_time": iso(plus_hours(now, 60)), "reserved": True, "status": "planned"},
        # A006 conflicting overlapping assignments (SCN-023 — data-level conflict)
        {"id": "AA-0002", "asset_id": "A006", "shipment_id": "S020", "start_time": iso(plus_hours(now, 12)), "end_time": iso(plus_hours(now, 36)), "reserved": False, "status": "planned"},
        {"id": "AA-0003", "asset_id": "A006", "shipment_id": "S020", "start_time": iso(plus_hours(now, 24)), "end_time": iso(plus_hours(now, 48)), "reserved": True, "status": "planned"},
        # A010 currently assigned (active)
        {"id": "AA-0004", "asset_id": "A010", "shipment_id": "S041", "start_time": iso(plus_hours(now, -6)), "end_time": iso(plus_hours(now, 30)), "reserved": False, "status": "active"},
        # Completed historical assignment
        {"id": "AA-0005", "asset_id": "A011", "shipment_id": "S042", "start_time": iso(plus_hours(now, -72)), "end_time": iso(plus_hours(now, -48)), "reserved": False, "status": "completed"},
        # Reserved commitments that keep filler assets out of the idle pool
        {"id": "AA-0006", "asset_id": "A019", "shipment_id": "S044", "start_time": iso(plus_hours(now, 24)), "end_time": iso(plus_hours(now, 48)), "reserved": True, "status": "planned"},
        {"id": "AA-0007", "asset_id": "A023", "shipment_id": "S040", "start_time": iso(plus_hours(now, 18)), "end_time": iso(plus_hours(now, 42)), "reserved": True, "status": "planned"},
    ]

    return assets, assignments


# ---------------------------------------------------------------------------
# Scenario registry (fixture -> expected outcome documentation)
# ---------------------------------------------------------------------------
SCENARIO_DESCRIPTIONS = {
    "SCN-001": "Disruption intersects routes of multiple shipments (D01, IN-WEST-COAST).",
    "SCN-002": "Disruption region does not intersect the shipment route (lane 6 unaffected).",
    "SCN-003": "Disruption outside its active window (D03 scheduled, D05 resolved).",
    "SCN-004": "One shipment matched by two active disruptions (D01 + D04); worst status wins.",
    "SCN-005": "Missing route data (defect route R071, zero segments) → unknown_review.",
    "SCN-006": "Open-ended disruption ahead of the shipment (D02, end_time null) → at_risk.",
    "SCN-007": "Delivered shipment excluded from matching (S007).",
    "SCN-008": "Segment passed before the disruption started (A-1) → unaffected, excluded.",
    "SCN-009": "Timing-unknown fixture not generatable under A-3 (planned times required); unit-tested in JS.",
    "SCN-010": "Segment window ends exactly at disruption start (inclusive boundary) → delayed.",
    "SCN-011": "No feasible alternate route: all candidates overlap the triggering disruption.",
    "SCN-012": "Alternate route rejected for insufficient capacity (R006, 8 < 12 units).",
    "SCN-013": "Carrier unavailable (C09 inactive) plus a disrupted alternate route.",
    "SCN-014": "Missing capacity data fixture not generatable (capacity_units NOT NULL > 0); unit-tested in JS.",
    "SCN-015": "Deterministic ranking with a single feasible alternate (R006 for S040).",
    "SCN-016": "Idle asset available near the shipment target (A001).",
    "SCN-017": "Reserved asset excluded from idle/redeployment (A002, AA-0001).",
    "SCN-018": "Non-refrigerated asset rejected for cold-chain cargo (A003 for S015).",
    "SCN-019": "Proximity: asset at ~145 km included, asset at ~240 km rejected (A005 vs A004).",
    "SCN-020": "No compatible asset available near the target (S017, Rotterdam).",
    "SCN-021": "Two affected shipments contend for the same asset (S009 and S047 both rank A005 in their top 3).",
    "SCN-022": "Asset missing available_since excluded with reason (A007).",
    "SCN-023": "Conflicting overlapping assignments on one asset (A006, AA-0002/AA-0003).",
    "SCN-101": "Normal readings within policy range → no excursion.",
    "SCN-102": "Readings exactly at min/max boundaries → within limits (inclusive).",
    "SCN-103": "Readings below minimum → excursion.",
    "SCN-104": "Readings above maximum → excursion.",
    "SCN-105": "Short small deviation → warning.",
    "SCN-106": "Sustained moderate deviation → major.",
    "SCN-107": "Repeated excursions separated by observed recovery → two records.",
    "SCN-108": "Data gap inside a breach window → missing_readings → unknown_review.",
    "SCN-109": "Duplicate reading de-duplicated and flagged.",
    "SCN-110": "Out-of-order readings reordered and flagged.",
    "SCN-111": "Sensor failure: feed stops for 75 minutes → failed status.",
    "SCN-112": "Unknown temperature policy (cargo_type vaccine_lot_x) → review required.",
    "SCN-113": "Unknown cargo type (perishable_exotic) → review required.",
    "SCN-114": "Shipment close to delivery (deadline +8 h) with an excursion.",
    "SCN-115": "Delivered shipment with post-delivery breach → excluded from live alerts.",
    "SCN-116": "Implausible reading (65 °C) as sole breach → unknown_review.",
    "SCN-117": "Grouping boundary: 30-minute merge vs 45-minute split.",
    "SCN-118": "Long small-magnitude excursion (75 min) → critical per B-8.",
    "SCN-119": "Policy update reclassification is a runtime action; covered by JS unit tests.",
    "SCN-120": "Combined disruption + cold-chain risk on one shipment (S039).",
    "SCN-121": "Excursion review lifecycle is a runtime action; covered by API tests (Phase 3).",
    "SCN-122": "Evidence consistency is a UI/runtime check (Phase 5).",
    "SCN-123": "Bob grounding is a runtime check (Phase 4).",
    "SCN-124": "Bob unavailable is a runtime check (Phase 4).",
    "SCN-125": "Backend unavailable is a runtime check (Phase 7).",
}


def build_logistics(now) -> dict:
    carriers = build_carriers()
    routes, segments, segments_by_route = build_routes_and_segments()
    return {
        "carriers": carriers,
        "routes": routes,
        "route_segments": segments,
        "segments_by_route": segments_by_route,
        "shipments": build_shipments(now),
        "disruptions": build_disruptions(now),
        "fleet": build_fleet(now),
    }
