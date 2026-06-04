"""Rolling date windows shared by data generation and dashboard APIs."""
from __future__ import annotations

from datetime import date, datetime, timedelta


MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTH_FULL = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def parse_iso_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


def add_months(day: date, months: int) -> date:
    year = day.year + (day.month - 1 + months) // 12
    month = (day.month - 1 + months) % 12 + 1
    return date(year, month, 1)


def month_start(today: date | None = None) -> date:
    today = today or date.today()
    return date(today.year, today.month, 1)


def month_label(year: int, month: int, style: str = "abbr") -> str:
    names = MONTH_FULL if style == "full" else MONTH_ABBR
    return f"{names[month - 1]} {year}"


def rolling_actual_window(today: date | None = None) -> tuple[date, date]:
    """Last 12 completed calendar months, ending on the previous month."""
    current = month_start(today)
    start = add_months(current, -12)
    end = current - timedelta(days=1)
    return start, end


def rolling_forecast_window(today: date | None = None) -> tuple[date, date]:
    """Next 12 calendar months, starting from the current month."""
    current = month_start(today)
    start = current
    end = add_months(start, 12) - timedelta(days=1)
    return start, end


def date_in_range(value: str | None, start: date, end: date) -> bool:
    parsed = parse_iso_date(value)
    return bool(parsed and start <= parsed <= end)


def actual_date_in_window(value: str | None, today: date | None = None) -> bool:
    start, end = rolling_actual_window(today)
    return date_in_range(value, start, end)


def date_ranges_overlap(start_value: str | None, end_value: str | None, start: date, end: date) -> bool:
    parsed_start = parse_iso_date(start_value)
    parsed_end = parse_iso_date(end_value) or parsed_start
    return bool(parsed_start and parsed_end and parsed_start <= end and parsed_end >= start)


def actual_week_overlaps(row: dict, today: date | None = None) -> bool:
    start, end = rolling_actual_window(today)
    week_start_value = row.get("week_start")
    week_end_value = row.get("week_end")
    if not week_end_value:
        parsed_start = parse_iso_date(week_start_value)
        if parsed_start:
            week_end_value = str(parsed_start + timedelta(days=6))
    return date_ranges_overlap(week_start_value, week_end_value, start, end)


def is_actual_flag(value: object) -> bool:
    return str(value or "0") == "0"


def month_options(start: date, end: date) -> list[dict]:
    items = []
    cursor = date(start.year, start.month, 1)
    final = date(end.year, end.month, 1)
    while cursor <= final:
        items.append({
            "value": f"{cursor.year}-{cursor.month:02d}",
            "label": month_label(cursor.year, cursor.month),
            "year": cursor.year,
            "month": cursor.month,
        })
        cursor = add_months(cursor, 1)
    return items


def week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def week_options(start: date, end: date) -> list[dict]:
    items = []
    cursor = week_start(start)
    seen = set()
    while cursor <= end:
        key = str(cursor)
        if key not in seen:
            iso = cursor.isocalendar()
            items.append({
                "value": key,
                "label": f"Week {iso.week} ({cursor.strftime('%d %b %Y')})",
                "year": iso.year,
                "week": iso.week,
                "start": key,
                "end": str(cursor + timedelta(days=6)),
            })
            seen.add(key)
        cursor += timedelta(days=7)
    return items


def actual_window_payload(today: date | None = None) -> dict:
    start, end = rolling_actual_window(today)
    months = month_options(start, end)
    weeks = week_options(start, end)
    return {
        "start": str(start),
        "end": str(end),
        "label": f"{month_label(start.year, start.month)} - {month_label(end.year, end.month)}",
        "months": months,
        "weeks": weeks,
        "default_day": str(start),
    }


def rolling_generation_profile(today: date | None = None) -> dict:
    today = today or date.today()
    actual_start, actual_end = rolling_actual_window(today)
    forecast_start, forecast_end = rolling_forecast_window(today)
    return {
        "anchor_month": month_start(today).strftime("%Y-%m"),
        "actual_start": actual_start,
        "actual_end": actual_end,
        "forecast_start": forecast_start,
        "forecast_end": forecast_end,
        "actual_period": f"{actual_start} to {actual_end}",
        "forecast_period": f"{forecast_start} to {forecast_end}",
        "generated_for": datetime.utcnow().date().isoformat(),
    }
