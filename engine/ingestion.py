"""
IMSERV Platform — Data Ingestion Layer
Loads and caches CSV datasets; provides typed accessor functions.
Mirrors DAA-Project's lazy-loading cache pattern.
"""
import csv
import json
import os
from pathlib import Path
from datetime import date, datetime

# ─────────────────────────────────────────────────────────────────────────────
BASE_DIR   = Path(__file__).resolve().parent.parent
INPUTS_DIR = BASE_DIR / "data" / "inputs"

# ─── Module-level caches (populated on first access) ──────────────────────────
_JOBS_CACHE              = None
_CHANNEL_CACHE           = None
_JOURNEY_CACHE           = None
_ENGINEERS_CACHE         = None
_AVAILABILITY_CACHE      = None
_FINANCIAL_CACHE         = None
_CAPACITY_CACHE          = None

DATASET_FILES = [
    "master_operations.csv",
    "smart_meter_jobs.csv",
    "channel_volume.csv",
    "booking_journey.csv",
    "engineers.csv",
    "engineer_availability.csv",
    "financial_data.csv",
    "capacity_demand.csv",
]
_DATA_HEALTH_CACHE = {}


def _load_csv(filename: str) -> list:
    """Load a CSV from inputs directory, filter empty rows."""
    path = INPUTS_DIR / filename
    if not path.exists():
        _DATA_HEALTH_CACHE[filename] = {"exists": False, "rows": 0, "size_bytes": 0}
        return []
    with open(path, encoding="utf-8-sig") as f:
        rows = [r for r in csv.DictReader(f) if any(v and v.strip() for v in r.values())]
    _DATA_HEALTH_CACHE[filename] = {
        "exists": True,
        "rows": len(rows),
        "size_bytes": path.stat().st_size,
    }
    return rows


# ─── Public Accessors ─────────────────────────────────────────────────────────

def get_jobs(force_reload: bool = False) -> list:
    global _JOBS_CACHE
    if _JOBS_CACHE is None or force_reload:
        master_path = INPUTS_DIR / "master_operations.csv"
        _JOBS_CACHE = _load_csv("master_operations.csv" if master_path.exists() else "smart_meter_jobs.csv")
    return _JOBS_CACHE


def get_channel_volume(force_reload: bool = False) -> list:
    global _CHANNEL_CACHE
    if _CHANNEL_CACHE is None or force_reload:
        _CHANNEL_CACHE = _load_csv("channel_volume.csv")
    return _CHANNEL_CACHE


def get_booking_journey(force_reload: bool = False) -> list:
    global _JOURNEY_CACHE
    if _JOURNEY_CACHE is None or force_reload:
        _JOURNEY_CACHE = _load_csv("booking_journey.csv")
    return _JOURNEY_CACHE


def get_engineers(force_reload: bool = False) -> list:
    global _ENGINEERS_CACHE
    if _ENGINEERS_CACHE is None or force_reload:
        _ENGINEERS_CACHE = _load_csv("engineers.csv")
    return _ENGINEERS_CACHE


def get_engineer_availability(force_reload: bool = False) -> list:
    global _AVAILABILITY_CACHE
    if _AVAILABILITY_CACHE is None or force_reload:
        _AVAILABILITY_CACHE = _load_csv("engineer_availability.csv")
    return _AVAILABILITY_CACHE


def get_financial_data(force_reload: bool = False) -> list:
    global _FINANCIAL_CACHE
    if _FINANCIAL_CACHE is None or force_reload:
        _FINANCIAL_CACHE = _load_csv("financial_data.csv")
    return _FINANCIAL_CACHE


def get_capacity_demand(force_reload: bool = False) -> list:
    global _CAPACITY_CACHE
    if _CAPACITY_CACHE is None or force_reload:
        _CAPACITY_CACHE = _load_csv("capacity_demand.csv")
    return _CAPACITY_CACHE


def preload_all_data(force_reload: bool = False) -> dict:
    """Warm all CSV caches so first user requests do not pay parsing cost."""
    return {
        "master_operations.csv": len(get_jobs(force_reload)),
        "smart_meter_jobs.csv": len(get_jobs(force_reload)),
        "channel_volume.csv": len(get_channel_volume(force_reload)),
        "booking_journey.csv": len(get_booking_journey(force_reload)),
        "engineers.csv": len(get_engineers(force_reload)),
        "engineer_availability.csv": len(get_engineer_availability(force_reload)),
        "financial_data.csv": len(get_financial_data(force_reload)),
        "capacity_demand.csv": len(get_capacity_demand(force_reload)),
    }


# ─── Filter Helpers ───────────────────────────────────────────────────────────

def filter_by(rows: list, **kwargs) -> list:
    """Filter rows by exact field match. Case-insensitive for string values."""
    result = rows
    for key, val in kwargs.items():
        if val is None:
            continue
        val_str = str(val).lower()
        result = [r for r in result if str(r.get(key, "")).lower() == val_str]
    return result


def filter_date_range(rows: list, date_field: str, start: str, end: str) -> list:
    """Filter rows where date_field falls within [start, end] (ISO strings)."""
    return [
        r for r in rows
        if start <= r.get(date_field, "")[:10] <= end
    ]


def to_int(val, default: int = 0) -> int:
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return default


def to_float(val, default: float = 0.0) -> float:
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


def safe_pct(numerator, denominator, decimals: int = 1) -> float:
    if not denominator:
        return 0.0
    return round(numerator / denominator * 100, decimals)


# ─── Data Health Check ───────────────────────────────────────────────────────

def data_health() -> dict:
    """Return file presence plus cached row counts without scanning CSVs."""
    result = {}
    for f in DATASET_FILES:
        path = INPUTS_DIR / f
        exists = path.exists()
        cached = _DATA_HEALTH_CACHE.get(f, {})
        result[f] = {
            "exists": exists,
            "rows": cached.get("rows"),
            "size_bytes": path.stat().st_size if exists else 0,
        }
    return result
