"""
SQLite-backed data store for generated IMSERV CSV inputs.

CSV files remain the source of truth. This module builds a local SQLite cache
when CSV mtimes/sizes change, then exposes rows through indexed SELECTs.
"""
from __future__ import annotations

import csv
import json
import os
import sqlite3
import threading
from pathlib import Path
from typing import Iterable

BASE_DIR = Path(__file__).resolve().parent.parent
INPUTS_DIR = BASE_DIR / "data" / "inputs"
DB_PATH = BASE_DIR / "data" / "imserv.db"
SCHEMA_VERSION = 2

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

TABLE_BY_FILE = {
    "master_operations.csv": "master_operations",
    "smart_meter_jobs.csv": "master_operations",
    "suppliers.csv": "suppliers",
    "channel_volume.csv": "channel_volume",
    "booking_journey.csv": "booking_journey",
    "engineers.csv": "engineers",
    "engineer_availability.csv": "engineer_availability",
    "financial_data.csv": "financial_data",
    "capacity_demand.csv": "capacity_demand",
    "field_engineers.csv": "field_engineers",
    "forecast_baseline_2025.csv": "forecast_baseline_2025",
}

INDEXES = [
    ("master_operations", "idx_master_forecast_region_date", ["is_forecast", "region_code", "requested_date"]),
    ("master_operations", "idx_master_forecast_status_region", ["is_forecast", "status", "region_code"]),
    ("master_operations", "idx_master_region_status", ["region_code", "status"]),
    ("master_operations", "idx_master_requested_date", ["requested_date"]),
    ("master_operations", "idx_master_job_ref", ["job_ref"]),
    ("master_operations", "idx_master_cancel_group", ["is_forecast", "status", "region_code", "supplier_name", "cancellation_reason"]),
    ("master_operations", "idx_master_abort_lookup", ["is_forecast", "status", "region_code", "job_ref", "supplier_name", "abort_reason"]),
    ("master_operations", "idx_master_journey_group", ["is_forecast", "region_code", "supplier_name", "status", "booked_date", "primary_channel", "job_type", "contacts_count"]),
    ("channel_volume", "idx_channel_year_region_date", ["year", "region_code", "contact_date"]),
    ("channel_volume", "idx_channel_region_channel", ["region_code", "channel"]),
    ("booking_journey", "idx_journey_region_week", ["region_code", "week_start"]),
    ("engineer_availability", "idx_avail_year_region_date", ["year", "region_code", "avail_date"]),
    ("engineer_availability", "idx_avail_engineer_year", ["engineer_id", "year"]),
    ("engineer_availability", "idx_avail_region_status", ["region_code", "status"]),
    ("capacity_demand", "idx_capacity_year_region_week", ["year", "region_code", "week_number"]),
    ("financial_data", "idx_financial_year_region_month", ["year", "region_code", "month_num"]),
    ("field_engineers", "idx_field_engineers_year_region", ["year", "region_code"]),
    ("forecast_baseline_2025", "idx_forecast_date_region", ["forecast_date", "region_code"]),
]

_BUILD_LOCK = threading.Lock()
_READY_SIGNATURE: str | None = None
_LAST_ERROR_SIGNATURE: str | None = None


def sqlite_enabled() -> bool:
    return os.getenv("IMSERV_SQLITE_ENABLED", "true").lower() not in {"0", "false", "no"}


def _quote_ident(name: str) -> str:
    return '"' + str(name).replace('"', '""') + '"'


def _source_path(filename: str) -> Path:
    if filename == "master_operations.csv":
        master = INPUTS_DIR / filename
        if not master.exists():
            fallback = INPUTS_DIR / "smart_meter_jobs.csv"
            if fallback.exists():
                return fallback
    return INPUTS_DIR / filename


def _source_signature() -> str:
    items = []
    items.append({"schema_version": SCHEMA_VERSION})
    for filename in DATASET_FILES:
        path = _source_path(filename)
        exists = path.exists()
        stat = path.stat() if exists else None
        items.append({
            "file": filename,
            "path": path.name,
            "exists": exists,
            "size": stat.st_size if stat else 0,
            "mtime_ns": stat.st_mtime_ns if stat else 0,
        })
    return json.dumps(items, sort_keys=True, separators=(",", ":"))


def _connect(path: Path = DB_PATH) -> sqlite3.Connection:
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    return conn


def _database_is_fresh(signature: str) -> bool:
    if not DB_PATH.exists():
        return False
    conn = None
    try:
        conn = _connect()
        row = conn.execute(
            "SELECT value FROM _imserv_meta WHERE key = 'source_signature'"
        ).fetchone()
        return bool(row and row["value"] == signature)
    except sqlite3.Error:
        return False
    finally:
        if conn is not None:
            conn.close()


def _table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    try:
        return {row["name"] for row in conn.execute(f"PRAGMA table_info({_quote_ident(table)})")}
    except sqlite3.Error:
        return set()


def _load_csv_table(conn: sqlite3.Connection, filename: str) -> int:
    path = _source_path(filename)
    table = TABLE_BY_FILE[filename]
    conn.execute(f"DROP TABLE IF EXISTS {_quote_ident(table)}")
    if not path.exists():
        return 0

    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames or []
        if not fieldnames:
            return 0

        column_defs = ", ".join(f"{_quote_ident(name)} TEXT" for name in fieldnames)
        conn.execute(f"CREATE TABLE {_quote_ident(table)} ({column_defs})")
        placeholders = ", ".join("?" for _ in fieldnames)
        columns = ", ".join(_quote_ident(name) for name in fieldnames)
        insert_sql = f"INSERT INTO {_quote_ident(table)} ({columns}) VALUES ({placeholders})"

        batch = []
        count = 0
        for row in reader:
            if not any(value and str(value).strip() for value in row.values()):
                continue
            batch.append([row.get(name, "") for name in fieldnames])
            if len(batch) >= 5000:
                conn.executemany(insert_sql, batch)
                count += len(batch)
                batch.clear()
        if batch:
            conn.executemany(insert_sql, batch)
            count += len(batch)
        return count


def _create_indexes(conn: sqlite3.Connection) -> None:
    for table, index_name, columns in INDEXES:
        available = _table_columns(conn, table)
        if not available or any(column not in available for column in columns):
            continue
        col_sql = ", ".join(_quote_ident(column) for column in columns)
        conn.execute(
            f"CREATE INDEX IF NOT EXISTS {_quote_ident(index_name)} "
            f"ON {_quote_ident(table)} ({col_sql})"
        )


def _build_database(signature: str) -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = DB_PATH.with_suffix(".db.tmp")
    if tmp_path.exists():
        tmp_path.unlink()

    conn = sqlite3.connect(tmp_path)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=OFF")
        conn.execute("PRAGMA synchronous=OFF")
        conn.execute("PRAGMA temp_store=MEMORY")
        conn.execute("PRAGMA cache_size=-64000")
        conn.execute("BEGIN")
        conn.execute("CREATE TABLE _imserv_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        counts = {}
        for filename in DATASET_FILES:
            counts[filename] = _load_csv_table(conn, filename)
        _create_indexes(conn)
        conn.execute(
            "INSERT INTO _imserv_meta (key, value) VALUES (?, ?)",
            ("source_signature", signature),
        )
        conn.execute(
            "INSERT INTO _imserv_meta (key, value) VALUES (?, ?)",
            ("row_counts", json.dumps(counts, sort_keys=True)),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    os.replace(tmp_path, DB_PATH)


def ensure_sqlite_store(force: bool = False) -> bool:
    global _READY_SIGNATURE, _LAST_ERROR_SIGNATURE
    if not sqlite_enabled():
        return False

    signature = _source_signature()
    if not force and _READY_SIGNATURE == signature and DB_PATH.exists():
        return True

    with _BUILD_LOCK:
        signature = _source_signature()
        if not force and _READY_SIGNATURE == signature and DB_PATH.exists():
            return True
        if not force and _database_is_fresh(signature):
            _READY_SIGNATURE = signature
            _LAST_ERROR_SIGNATURE = None
            return True
        if not force and _LAST_ERROR_SIGNATURE == signature:
            return False
        try:
            _build_database(signature)
            _READY_SIGNATURE = signature
            _LAST_ERROR_SIGNATURE = None
            return True
        except Exception as exc:
            _LAST_ERROR_SIGNATURE = signature
            print(f"IMSERV: SQLite data store build failed; falling back to CSV ({exc})")
            return False


def build_sqlite_store(force: bool = True) -> bool:
    return ensure_sqlite_store(force=force)


def row_counts() -> dict:
    if not ensure_sqlite_store():
        return {}
    conn = None
    try:
        conn = _connect()
        row = conn.execute("SELECT value FROM _imserv_meta WHERE key = 'row_counts'").fetchone()
        return json.loads(row["value"]) if row else {}
    except (sqlite3.Error, json.JSONDecodeError):
        return {}
    finally:
        if conn is not None:
            conn.close()


def _rows_from_cursor(cursor: sqlite3.Cursor):
    try:
        for row in cursor:
            yield dict(row)
    finally:
        cursor.connection.close()


def iter_rows(
    filename: str,
    where_sql: str = "",
    params: Iterable = (),
    columns: list[str] | tuple[str, ...] | None = None,
):
    if not ensure_sqlite_store():
        return None
    table = TABLE_BY_FILE.get(filename)
    if not table:
        return None
    selected = ", ".join(_quote_ident(column) for column in columns) if columns else "*"
    sql = f"SELECT {selected} FROM {_quote_ident(table)}"
    if where_sql:
        sql += f" WHERE {where_sql}"
    try:
        conn = _connect()
        cursor = conn.execute(sql, tuple(params))
        return _rows_from_cursor(cursor)
    except sqlite3.Error as exc:
        print(f"IMSERV: SQLite read failed for {filename}; falling back to CSV ({exc})")
        return None


def load_rows(filename: str) -> list[dict] | None:
    rows = iter_rows(filename)
    return list(rows) if rows is not None else None


def count_rows(filename: str) -> int | None:
    if not ensure_sqlite_store():
        return None
    table = TABLE_BY_FILE.get(filename)
    if not table:
        return None
    conn = None
    try:
        conn = _connect()
        row = conn.execute(f"SELECT COUNT(*) AS n FROM {_quote_ident(table)}").fetchone()
        return int(row["n"]) if row else 0
    except sqlite3.Error:
        return None
    finally:
        if conn is not None:
            conn.close()


def query_rows(sql: str, params: Iterable = ()) -> list[dict] | None:
    """Run a read-only SQLite query and return dictionaries, or None on fallback."""
    if not ensure_sqlite_store():
        return None
    conn = None
    try:
        conn = _connect()
        return [dict(row) for row in conn.execute(sql, tuple(params))]
    except sqlite3.Error as exc:
        print(f"IMSERV: SQLite query failed; falling back to Python aggregation ({exc})")
        return None
    finally:
        if conn is not None:
            conn.close()


def status() -> dict:
    signature = _source_signature()
    ready = ensure_sqlite_store()
    return {
        "enabled": sqlite_enabled(),
        "ready": ready,
        "path": str(DB_PATH),
        "fresh": ready and _READY_SIGNATURE == signature,
        "size_bytes": DB_PATH.stat().st_size if DB_PATH.exists() else 0,
        "row_counts": row_counts() if ready else {},
    }
