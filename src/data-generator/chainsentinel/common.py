"""ChainSentinel synthetic data generator — shared constants, policies and helpers.

Python 3.11 standard library only. No ML. All rules mirror the frozen contracts:
  - docs/phase-0/data-contract.md (including Phase 1A amendments A-3/B-1/B-6)
  - docs/phase-0/scope-freeze.md §1.2 (matching, severity ladder B-8, risk weights)
"""

from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone

GENERATOR_VERSION = "1.0.0"

# ---------------------------------------------------------------------------
# Controlled vocabularies (data-contract.md §1.1/§1.2)
# ---------------------------------------------------------------------------
REGION_CODES = [
    "IN-WEST-COAST",
    "AE-JEBEL-ALI",
    "SG-SINGAPORE",
    "CN-EAST-COAST",
    "US-WEST-COAST",
    "EU-ROTTERDAM",
    "US-EAST-COAST",
    "IN-NORTH-ICD",
]

MODES = ["sea", "road", "rail", "air"]

CARGO_TYPES = [
    "vaccine",
    "insulin",
    "fresh_produce",
    "frozen_food",
    "pharma_generic",
    "electronics",
    "apparel",
    "machinery",
    "vaccine_lot_x",
    "perishable_exotic",
]

SHIPMENT_STATUSES = ["planned", "in_transit", "delayed", "delivered", "cancelled"]
DISRUPTION_TYPES = ["weather", "port_strike", "geopolitical", "customs", "infrastructure"]
DISRUPTION_STATUSES = ["scheduled", "active", "resolved"]
ASSET_TYPES = ["truck", "container", "vessel"]
ASSET_STATUSES = ["available", "maintenance", "retired"]
ASSIGNMENT_STATUSES = ["planned", "active", "completed", "cancelled"]

# ---------------------------------------------------------------------------
# Seed policies — [ASSUMPTION] illustrative, configurable, NOT regulatory claims
# ---------------------------------------------------------------------------
POLICY_SEED = {
    "vaccine": {
        "min_c": 2.0,
        "max_c": 8.0,
        "max_excursion_minutes": 15,
        "minor_deviation_c": 1.0,
        "major_deviation_c": 3.0,
        "critical_duration_minutes": 60,
    },
    "insulin": {
        "min_c": 2.0,
        "max_c": 8.0,
        "max_excursion_minutes": 15,
        "minor_deviation_c": 1.0,
        "major_deviation_c": 3.0,
        "critical_duration_minutes": 60,
    },
    "fresh_produce": {
        "min_c": 0.0,
        "max_c": 4.0,
        "max_excursion_minutes": 20,
        "minor_deviation_c": 1.0,
        "major_deviation_c": 3.0,
        "critical_duration_minutes": 90,
    },
    "frozen_food": {
        "min_c": -20.0,
        "max_c": -15.0,
        "max_excursion_minutes": 10,
        "minor_deviation_c": 2.0,
        "major_deviation_c": 5.0,
        "critical_duration_minutes": 45,
    },
    "vaccine_lot_x": {
        "min_c": 2.0,
        "max_c": 8.0,
        "max_excursion_minutes": 15,
        "minor_deviation_c": 1.0,
        "major_deviation_c": 3.0,
        "critical_duration_minutes": 60,
    },
    "perishable_exotic": {
        "min_c": 0.0,
        "max_c": 4.0,
        "max_excursion_minutes": 20,
        "minor_deviation_c": 1.0,
        "major_deviation_c": 3.0,
        "critical_duration_minutes": 90,
    },
}

# B-1 cargo profiles — [ASSUMPTION] illustrative sensitivity weights
CARGO_PROFILE_SEED = [
    {"cargo_type": "vaccine", "display_name": "Vaccines", "is_cold_chain": True, "sensitivity_weight": 0.90, "policy_required": True, "notes": "Illustrative demo sensitivity; not a product-specific claim."},
    {"cargo_type": "insulin", "display_name": "Insulin", "is_cold_chain": True, "sensitivity_weight": 0.90, "policy_required": True, "notes": "Illustrative demo sensitivity; not a product-specific claim."},
    {"cargo_type": "fresh_produce", "display_name": "Fresh produce", "is_cold_chain": True, "sensitivity_weight": 0.60, "policy_required": True, "notes": "Illustrative demo sensitivity; not a product-specific claim."},
    {"cargo_type": "frozen_food", "display_name": "Frozen food", "is_cold_chain": True, "sensitivity_weight": 0.70, "policy_required": True, "notes": "Illustrative demo sensitivity; not a product-specific claim."},
    {"cargo_type": "vaccine_lot_x", "display_name": "Vaccine Lot X", "is_cold_chain": True, "sensitivity_weight": 0.90, "policy_required": True, "notes": "Illustrative demo sensitivity; not a product-specific claim."},
    {"cargo_type": "perishable_exotic", "display_name": "Perishable Exotic", "is_cold_chain": True, "sensitivity_weight": 0.70, "policy_required": True, "notes": "Illustrative demo sensitivity; not a product-specific claim."},
    {"cargo_type": "pharma_generic", "display_name": "Generic pharma", "is_cold_chain": False, "sensitivity_weight": 0.50, "policy_required": False, "notes": None},
    {"cargo_type": "electronics", "display_name": "Electronics", "is_cold_chain": False, "sensitivity_weight": 0.00, "policy_required": False, "notes": None},
    {"cargo_type": "apparel", "display_name": "Apparel", "is_cold_chain": False, "sensitivity_weight": 0.00, "policy_required": False, "notes": None},
    {"cargo_type": "machinery", "display_name": "Machinery", "is_cold_chain": False, "sensitivity_weight": 0.00, "policy_required": False, "notes": None},
]

SENSOR_INTERVAL_MIN = 15
EXCURSION_GROUP_GAP_MIN = 30
REDEPLOY_RADIUS_KM = 150.0
RISK_ALPHA = 0.5
RISK_BETA = 0.5

SEVERITY_WEIGHTS = {"normal": 0.0, "warning": 0.3, "major": 0.6, "critical": 1.0, "unknown_review": 0.5}

DEFAULT_NOW = "2026-09-14T09:00:00Z"


# ---------------------------------------------------------------------------
# Time helpers (all timestamps ISO 8601 UTC with Z)
# ---------------------------------------------------------------------------
def parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def plus_minutes(dt: datetime, minutes: float) -> datetime:
    return dt + timedelta(minutes=minutes)


def plus_hours(dt: datetime, hours: float) -> datetime:
    return dt + timedelta(hours=hours)


def minutes_between(start_iso: str, end_iso: str) -> int:
    return round((parse_iso(end_iso) - parse_iso(start_iso)).total_seconds() / 60)


def make_rng(seed: int) -> random.Random:
    """Deterministic RNG: the only randomness source in the generator."""
    return random.Random(seed)
