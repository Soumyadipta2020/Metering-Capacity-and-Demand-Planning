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
from functools import lru_cache

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


def _load_csv(filename: str) -> list:
    """Load a CSV from inputs directory, filter empty rows."""
    path = INPUTS_DIR / filename
    if not path.exists():
        return []
    with open(path, encoding="utf-8-sig") as f:
        return [r for r in csv.DictReader(f) if any(v and v.strip() for v in r.values())]


# ─── Public Accessors ─────────────────────────────────────────────────────────

def get_jobs(force_reload: bool = False) -> list:
    global _JOBS_CACHE
    if _JOBS_CACHE is None or force_reload:
        _JOBS_CACHE = _load_csv("smart_meter_jobs.csv")
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
    """Returns record counts and file presence for all datasets."""
    files = [
        "smart_meter_jobs.csv", "channel_volume.csv", "booking_journey.csv",
        "engineers.csv", "engineer_availability.csv", "financial_data.csv",
        "capacity_demand.csv",
    ]
    result = {}
    for f in files:
        path = INPUTS_DIR / f
        exists = path.exists()
        count = 0
        if exists:
            try:
                with open(path, "r", encoding="utf-8-sig") as file:
                    count = sum(1 for _ in file) - 1 # Subtract 1 for header
            except Exception:
                pass
        result[f] = {"exists": exists, "rows": max(0, count)}
    return result
