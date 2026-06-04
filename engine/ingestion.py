"""
IMSERV Platform — Data Ingestion Layer
Loads and caches CSV datasets; provides typed accessor functions.
Mirrors DAA-Project's lazy-loading cache pattern.
"""
import csv
import os
from pathlib import Path

# ─────────────────────────────────────────────────────────────────────────────
BASE_DIR   = Path(__file__).resolve().parent.parent
INPUTS_DIR = BASE_DIR / "data" / "inputs"

# ─── Module-level caches (data + file signature) ─────────────────────────────
_JOBS_CACHE              = None;  _JOBS_SIG              = None
_CHANNEL_CACHE           = None;  _CHANNEL_SIG           = None
_JOURNEY_CACHE           = None;  _JOURNEY_SIG           = None
_ENGINEERS_CACHE         = None;  _ENGINEERS_SIG         = None
_AVAILABILITY_CACHE      = None;  _AVAILABILITY_SIG      = None
_FINANCIAL_CACHE         = None;  _FINANCIAL_SIG         = None
_CAPACITY_CACHE          = None;  _CAPACITY_SIG          = None
_FORECAST_BASELINE_CACHE = None;  _FORECAST_BASELINE_SIG = None

DATASET_FILES = [
    "master_operations.csv",
    "suppliers.csv",
    "channel_volume.csv",
    "booking_journey.csv",
    "engineers.csv",
    "engineer_availability.csv",
    "financial_data.csv",
    "capacity_demand.csv",
    "field_engineers.csv",
    "forecast_baseline_2025.csv",
]
_DATA_HEALTH_CACHE = {}

def _cache_large_datasets() -> bool:
    """Keep large CSVs uncached by default on constrained hosts like Render."""
    return os.getenv("IMSERV_CACHE_LARGE_DATASETS", "").lower() == "true"


def _file_sig(filename: str) -> tuple:
    """Return (mtime_ns, size) for a file so caches auto-invalidate on change."""
    path = INPUTS_DIR / filename
    try:
        s = path.stat()
        return (s.st_mtime_ns, s.st_size)
    except OSError:
        return (0, 0)


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


def iter_csv(filename: str):
    """Yield non-empty CSV rows without materializing the whole file."""
    path = INPUTS_DIR / filename
    if not path.exists():
        _DATA_HEALTH_CACHE[filename] = {"exists": False, "rows": 0, "size_bytes": 0}
        return

    count = 0
    with open(path, encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            if any(v and v.strip() for v in row.values()):
                count += 1
                yield row

    _DATA_HEALTH_CACHE[filename] = {
        "exists": True,
        "rows": count,
        "size_bytes": path.stat().st_size,
    }


def _count_csv_rows(filename: str) -> int:
    """Count CSV rows without materializing them as dictionaries."""
    path = INPUTS_DIR / filename
    if not path.exists():
        _DATA_HEALTH_CACHE[filename] = {"exists": False, "rows": 0, "size_bytes": 0}
        return 0
    with open(path, encoding="utf-8-sig") as f:
        count = max(sum(1 for _ in f) - 1, 0)
    _DATA_HEALTH_CACHE[filename] = {
        "exists": True,
        "rows": count,
        "size_bytes": path.stat().st_size,
    }
    return count


def _record_health(filename: str, rows: int | None = None) -> None:
    path = INPUTS_DIR / filename
    if filename == "master_operations.csv" and not path.exists():
        fallback = INPUTS_DIR / "smart_meter_jobs.csv"
        if fallback.exists():
            path = fallback
    _DATA_HEALTH_CACHE[filename] = {
        "exists": path.exists(),
        "rows": rows,
        "size_bytes": path.stat().st_size if path.exists() else 0,
    }


def _sqlite_load_rows(filename: str):
    try:
        from engine.sqlite_store import load_rows
        rows = load_rows(filename)
    except Exception as exc:
        print(f"IMSERV: SQLite load unavailable for {filename}; using CSV ({exc})")
        return None
    if rows is not None:
        _record_health(filename, len(rows))
    return rows


def _sqlite_iter_rows(filename: str, where_sql: str = "", params=(), columns=None):
    try:
        from engine.sqlite_store import iter_rows
        return iter_rows(filename, where_sql, params, columns)
    except Exception as exc:
        print(f"IMSERV: SQLite stream unavailable for {filename}; using CSV ({exc})")
        return None


def _sqlite_count_rows(filename: str):
    try:
        from engine.sqlite_store import count_rows
        count = count_rows(filename)
    except Exception:
        return None
    if count is not None:
        _record_health(filename, count)
    return count


def _load_table(filename: str) -> list:
    rows = _sqlite_load_rows(filename)
    if rows is not None:
        return rows
    return _load_csv(filename)


def _iter_table(filename: str):
    rows = _sqlite_iter_rows(filename)
    if rows is not None:
        count = 0
        for row in rows:
            count += 1
            yield row
        _record_health(filename, count)
        return
    yield from iter_csv(filename)


def _count_rows(filename: str) -> int:
    count = _sqlite_count_rows(filename)
    if count is not None:
        return count
    return _count_csv_rows(filename)


# ─── Public Accessors ─────────────────────────────────────────────────────────

def get_jobs(force_reload: bool = False) -> list:
    global _JOBS_CACHE
    master_path = INPUTS_DIR / "master_operations.csv"
    filename = "master_operations.csv" if master_path.exists() else "smart_meter_jobs.csv"
    if not _cache_large_datasets():
        return _load_table(filename)
    if _JOBS_CACHE is None or force_reload:
        _JOBS_CACHE = _load_table(filename)
    return _JOBS_CACHE


def iter_jobs():
    """Stream the job ledger row-by-row for memory-constrained routes."""
    master_path = INPUTS_DIR / "master_operations.csv"
    filename = "master_operations.csv" if master_path.exists() else "smart_meter_jobs.csv"
    yield from _iter_table(filename)


def iter_jobs_filtered(
    region_code: str = None,
    actual_only: bool = None,
    start: str = None,
    end: str = None,
    columns: list[str] | tuple[str, ...] | None = None,
):
    """Stream job rows using SQLite indexes when available, with CSV fallback."""
    master_path = INPUTS_DIR / "master_operations.csv"
    filename = "master_operations.csv" if master_path.exists() else "smart_meter_jobs.csv"
    where = []
    params = []
    if actual_only:
        where.append("is_forecast = ?")
        params.append("0")
    if region_code:
        where.append("region_code = ?")
        params.append(region_code)
    if start:
        where.append("requested_date >= ?")
        params.append(start)
    if end:
        where.append("requested_date <= ?")
        params.append(end)

    rows = _sqlite_iter_rows(filename, " AND ".join(where), params, columns)
    if rows is not None:
        count = 0
        for row in rows:
            count += 1
            yield row
        _record_health(filename, count)
        return

    for row in iter_csv(filename):
        if actual_only and row.get("is_forecast", "0") != "0":
            continue
        if region_code and row.get("region_code") != region_code:
            continue
        if start and row.get("requested_date", "")[:10] < start:
            continue
        if end and row.get("requested_date", "")[:10] > end:
            continue
        if columns:
            yield {column: row.get(column, "") for column in columns}
        else:
            yield row


def get_channel_volume(force_reload: bool = False) -> list:
    global _CHANNEL_CACHE, _CHANNEL_SIG
    sig = _file_sig("channel_volume.csv")
    if _CHANNEL_CACHE is None or force_reload or sig != _CHANNEL_SIG:
        _CHANNEL_CACHE = _load_table("channel_volume.csv")
        _CHANNEL_SIG = sig
    return _CHANNEL_CACHE


def iter_channel_volume():
    """Stream channel volume rows for lightweight first-page routes."""
    yield from _iter_table("channel_volume.csv")


def get_booking_journey(force_reload: bool = False) -> list:
    global _JOURNEY_CACHE, _JOURNEY_SIG
    sig = _file_sig("booking_journey.csv")
    if _JOURNEY_CACHE is None or force_reload or sig != _JOURNEY_SIG:
        _JOURNEY_CACHE = _load_table("booking_journey.csv")
        _JOURNEY_SIG = sig
    return _JOURNEY_CACHE


def get_engineers(force_reload: bool = False) -> list:
    global _ENGINEERS_CACHE, _ENGINEERS_SIG
    sig = _file_sig("engineers.csv")
    if _ENGINEERS_CACHE is None or force_reload or sig != _ENGINEERS_SIG:
        _ENGINEERS_CACHE = _load_table("engineers.csv")
        _ENGINEERS_SIG = sig
    return _ENGINEERS_CACHE


def get_engineer_availability(force_reload: bool = False) -> list:
    global _AVAILABILITY_CACHE, _AVAILABILITY_SIG
    if not _cache_large_datasets():
        return _load_table("engineer_availability.csv")
    sig = _file_sig("engineer_availability.csv")
    if _AVAILABILITY_CACHE is None or force_reload or sig != _AVAILABILITY_SIG:
        _AVAILABILITY_CACHE = _load_table("engineer_availability.csv")
        _AVAILABILITY_SIG = sig
    return _AVAILABILITY_CACHE


def iter_engineer_availability():
    """Stream engineer availability without creating a large list of dicts."""
    yield from _iter_table("engineer_availability.csv")


def iter_engineer_availability_filtered(
    region_code: str = None,
    year: int | str = None,
    years: list[int] | tuple[int, ...] | None = None,
    status: str = None,
    columns: list[str] | tuple[str, ...] | None = None,
):
    """Stream availability rows with indexed year/region/status filters."""
    where = []
    params = []
    if year is not None:
        where.append("year = ?")
        params.append(str(year))
    elif years:
        placeholders = ", ".join("?" for _ in years)
        where.append(f"year IN ({placeholders})")
        params.extend(str(y) for y in years)
    if region_code:
        where.append("region_code = ?")
        params.append(region_code)
    if status:
        where.append("status = ?")
        params.append(status)

    rows = _sqlite_iter_rows("engineer_availability.csv", " AND ".join(where), params, columns)
    if rows is not None:
        count = 0
        for row in rows:
            count += 1
            yield row
        _record_health("engineer_availability.csv", count)
        return

    allowed_years = {str(y) for y in years} if years else None
    for row in iter_csv("engineer_availability.csv"):
        if year is not None and row.get("year") != str(year):
            continue
        if allowed_years and row.get("year") not in allowed_years:
            continue
        if region_code and row.get("region_code") != region_code:
            continue
        if status and row.get("status") != status:
            continue
        if columns:
            yield {column: row.get(column, "") for column in columns}
        else:
            yield row


def get_financial_data(force_reload: bool = False) -> list:
    global _FINANCIAL_CACHE, _FINANCIAL_SIG
    sig = _file_sig("financial_data.csv")
    if _FINANCIAL_CACHE is None or force_reload or sig != _FINANCIAL_SIG:
        _FINANCIAL_CACHE = _load_table("financial_data.csv")
        _FINANCIAL_SIG = sig
    return _FINANCIAL_CACHE


def get_capacity_demand(force_reload: bool = False) -> list:
    global _CAPACITY_CACHE, _CAPACITY_SIG
    sig = _file_sig("capacity_demand.csv")
    if _CAPACITY_CACHE is None or force_reload or sig != _CAPACITY_SIG:
        _CAPACITY_CACHE = _load_table("capacity_demand.csv")
        _CAPACITY_SIG = sig
    return _CAPACITY_CACHE


def get_forecast_baseline_2025(force_reload: bool = False) -> list:
    global _FORECAST_BASELINE_CACHE, _FORECAST_BASELINE_SIG
    sig = _file_sig("forecast_baseline_2025.csv")
    if _FORECAST_BASELINE_CACHE is None or force_reload or sig != _FORECAST_BASELINE_SIG:
        _FORECAST_BASELINE_CACHE = _load_table("forecast_baseline_2025.csv")
        _FORECAST_BASELINE_SIG = sig
    return _FORECAST_BASELINE_CACHE


def preload_all_data(force_reload: bool = False) -> dict:
    """Warm CSV caches. Large datasets are counted, not cached, by default."""
    large_counts = {}
    if not _cache_large_datasets():
        large_counts = {
            "master_operations.csv": _count_rows("master_operations.csv"),
            "engineer_availability.csv": _count_rows("engineer_availability.csv"),
        }
    else:
        large_counts = {
            "master_operations.csv": len(get_jobs(force_reload)),
            "engineer_availability.csv": len(get_engineer_availability(force_reload)),
        }

    return {
        **large_counts,
        "channel_volume.csv": len(get_channel_volume(force_reload)),
        "booking_journey.csv": len(get_booking_journey(force_reload)),
        "engineers.csv": len(get_engineers(force_reload)),
        "financial_data.csv": len(get_financial_data(force_reload)),
        "capacity_demand.csv": len(get_capacity_demand(force_reload)),
        "forecast_baseline_2025.csv": len(get_forecast_baseline_2025(force_reload)),
    }


def clear_data_caches() -> dict:
    """Drop in-memory CSV caches so constrained instances can reclaim RAM."""
    global _JOBS_CACHE, _CHANNEL_CACHE, _JOURNEY_CACHE, _ENGINEERS_CACHE
    global _AVAILABILITY_CACHE, _FINANCIAL_CACHE, _CAPACITY_CACHE
    global _FORECAST_BASELINE_CACHE

    _JOBS_CACHE = None
    _CHANNEL_CACHE = None
    _JOURNEY_CACHE = None
    _ENGINEERS_CACHE = None
    _AVAILABILITY_CACHE = None
    _FINANCIAL_CACHE = None
    _CAPACITY_CACHE = None
    _FORECAST_BASELINE_CACHE = None
    return data_health()


def build_sqlite_store(force: bool = True) -> bool:
    """Build or rebuild the local SQLite cache from CSV source files."""
    from engine.sqlite_store import build_sqlite_store as _build
    return _build(force=force)


def sqlite_store_status() -> dict:
    """Return SQLite cache status for diagnostics."""
    from engine.sqlite_store import status as _status
    return _status()


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
