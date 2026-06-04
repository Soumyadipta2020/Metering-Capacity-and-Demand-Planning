"""Date-only rolling refresh for generated CSV inputs."""
from __future__ import annotations

import calendar
import csv
import json
from datetime import date, datetime, timedelta, UTC
from pathlib import Path

from engine.date_windows import (
    rolling_generation_profile,
    rolling_actual_window,
    parse_iso_date,
    week_start,
)


BASE_DIR = Path(__file__).resolve().parent.parent
INPUTS_DIR = BASE_DIR / "data" / "inputs"

DATE_FIELDS = {
    "master_operations.csv": ["requested_date", "contact_date", "booked_date", "completed_date"],
    "channel_volume.csv": ["contact_date"],
    "booking_journey.csv": ["week_start", "week_end"],
    "engineer_availability.csv": ["avail_date"],
    "capacity_demand.csv": ["week_start"],
    "forecast_baseline_2025.csv": ["forecast_date", "forecast_created_at"],
}

MONTH_YEAR_FILES = {
    "financial_data.csv",
    "field_engineers.csv",
}


def _month_delta(source: date, target: date) -> int:
    return (target.year - source.year) * 12 + (target.month - source.month)


def _add_months_keep_day(day: date, months: int) -> date:
    year = day.year + (day.month - 1 + months) // 12
    month = (day.month - 1 + months) % 12 + 1
    last_day = calendar.monthrange(year, month)[1]
    return date(year, month, min(day.day, last_day))


def _shift_iso(value: str | None, months: int) -> str:
    parsed = parse_iso_date(value)
    if not parsed:
        return value or ""
    return str(_add_months_keep_day(parsed, months))


def _read_rows(path: Path) -> tuple[list[str], list[dict]]:
    with open(path, encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        return list(reader.fieldnames or []), list(reader)


def _write_rows(path: Path, fieldnames: list[str], rows: list[dict]) -> None:
    with open(path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def _first_actual_date() -> date | None:
    path = INPUTS_DIR / "master_operations.csv"
    if not path.exists():
        return None

    _, rows = _read_rows(path)
    actual_dates = [
        parsed
        for row in rows
        if str(row.get("is_forecast", "0")) == "0"
        for parsed in [parse_iso_date(row.get("requested_date"))]
        if parsed
    ]
    return min(actual_dates) if actual_dates else None


def _refresh_calendar_columns(filename: str, row: dict) -> None:
    if filename in {"channel_volume.csv", "engineer_availability.csv"}:
        day = parse_iso_date(row.get("contact_date") or row.get("avail_date"))
        if not day:
            return
        row["year"] = day.year
        row["month"] = day.month
        row["week"] = day.isocalendar().week
        row["day_of_week"] = day.strftime("%A")
        return

    if filename in {"booking_journey.csv", "capacity_demand.csv"}:
        day = parse_iso_date(row.get("week_start"))
        if not day:
            return
        day = week_start(day)
        row["week_start"] = str(day)
        iso = day.isocalendar()
        row["year"] = iso.year
        row["week_number"] = iso.week
        if "week_end" in row:
            row["week_end"] = str(day + timedelta(days=6))
        return

    if filename == "forecast_baseline_2025.csv":
        day = parse_iso_date(row.get("forecast_date"))
        if not day:
            return
        row["year"] = day.year
        created_at = date(day.year, day.month, 1)
        row["forecast_created_at"] = str(created_at)
        row["forecast_name"] = f"{day.strftime('%b %Y')} forecast"


def _shift_year_month(row: dict, months: int) -> None:
    try:
        current = date(int(row["year"]), int(row["month_num"] if "month_num" in row else row["month"]), 1)
    except (KeyError, TypeError, ValueError):
        return

    shifted = _add_months_keep_day(current, months)
    row["year"] = shifted.year
    if "month_num" in row:
        row["month_num"] = shifted.month
        row["month"] = shifted.strftime("%b")
    else:
        row["month"] = shifted.month
        row["month_name"] = shifted.strftime("%B")
        row["quarter"] = f"Q{(shifted.month - 1) // 3 + 1}"


def roll_existing_data_dates(today: date | None = None) -> dict:
    """Shift existing CSV dates to today's rolling window without changing metrics."""
    profile = rolling_generation_profile(today)
    target_start, _ = rolling_actual_window(today)
    source_start = _first_actual_date()
    if not source_start:
        raise FileNotFoundError("master_operations.csv has no actual requested_date values to roll")

    months = _month_delta(source_start, target_start)
    result = {
        "source_actual_start": str(source_start),
        "target_actual_start": str(target_start),
        "month_delta": months,
        "files_updated": [],
    }
    if months == 0:
        _update_manifest(profile)
        result["files_updated"].append("manifest.json")
        return result

    for filename, fields in DATE_FIELDS.items():
        path = INPUTS_DIR / filename
        if not path.exists():
            continue
        fieldnames, rows = _read_rows(path)
        for row in rows:
            for field in fields:
                if field in row:
                    row[field] = _shift_iso(row.get(field), months)
            _refresh_calendar_columns(filename, row)
        _write_rows(path, fieldnames, rows)
        result["files_updated"].append(filename)

    for filename in MONTH_YEAR_FILES:
        path = INPUTS_DIR / filename
        if not path.exists():
            continue
        fieldnames, rows = _read_rows(path)
        for row in rows:
            _shift_year_month(row, months)
        _write_rows(path, fieldnames, rows)
        result["files_updated"].append(filename)

    _update_manifest(profile)
    result["files_updated"].append("manifest.json")
    return result


def _update_manifest(profile: dict) -> None:
    path = INPUTS_DIR / "manifest.json"
    manifest = {}
    if path.exists():
        try:
            manifest = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            manifest = {}

    manifest.update({
        "generated_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "rolling_anchor_month": profile["anchor_month"],
        "actual_period": profile["actual_period"],
        "forecast_period": profile["forecast_period"],
        "period": f"{profile['actual_start']} to {profile['forecast_end']}",
        "date_refresh_mode": "date-only",
    })
    path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
