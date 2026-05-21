"""
IMSERV Platform — Synthetic Dataset Generator
Generates realistic enterprise-grade smart meter operational data for 2024–2026.
Run directly: python engine/data_generator.py
"""
import os
import csv
import json
import random
import math
from datetime import date, timedelta, datetime
from pathlib import Path

# ─────────────────────────────────────────────────────────────────────────────
RANDOM_SEED = 42
random.seed(RANDOM_SEED)

BASE_DIR   = Path(__file__).resolve().parent.parent
INPUTS_DIR = BASE_DIR / "data" / "inputs"
INPUTS_DIR.mkdir(parents=True, exist_ok=True)

# ─── Domain Constants ─────────────────────────────────────────────────────────

REGIONS = {
    "NW":  {"name": "North West",  "base_jobs": 420, "engineers": 38, "patches": 6},
    "NE":  {"name": "North East",  "base_jobs": 310, "engineers": 28, "patches": 5},
    "MID": {"name": "Midlands",    "base_jobs": 510, "engineers": 46, "patches": 7},
    "SE":  {"name": "South East",  "base_jobs": 580, "engineers": 52, "patches": 8},
    "SW":  {"name": "South West",  "base_jobs": 270, "engineers": 24, "patches": 4},
    "WAL": {"name": "Wales",       "base_jobs": 220, "engineers": 20, "patches": 3},
    "SCO": {"name": "Scotland",    "base_jobs": 290, "engineers": 26, "patches": 4},
    "YRK": {"name": "Yorkshire",   "base_jobs": 380, "engineers": 34, "patches": 5},
}

METER_TYPES    = ["SMETS1", "SMETS2", "SMETS2_GAS", "IHD"]
METER_WEIGHTS  = [0.18, 0.45, 0.28, 0.09]

JOB_TYPES       = ["NEW_INSTALL", "EXCHANGE", "REPAIR", "REMOVAL"]
JOB_TYPE_WEIGHTS= [0.35, 0.40, 0.18, 0.07]

CHANNELS        = ["Phone", "Web", "App", "SMS", "IVR", "Agent Callback"]
CHANNEL_WEIGHTS = [0.38, 0.25, 0.18, 0.08, 0.07, 0.04]

CANCEL_REASONS  = [
    "Customer not home", "No access to meter", "Wrong meter type",
    "Safety concern", "Customer refused", "Equipment fault",
    "Rescheduled by customer", "Work order error",
]
ABORT_REASONS   = [
    "No access", "Safety hazard", "Faulty meter location", "Customer unavailable",
    "Health & safety concern", "Parts not available",
]

EMPLOYMENT_TYPES = ["Permanent", "Contract", "Agency"]
EMP_WEIGHTS      = [0.70, 0.20, 0.10]

REVENUE_MAP = {"NEW_INSTALL": 185.0, "EXCHANGE": 165.0, "REPAIR": 120.0, "REMOVAL": 90.0}
COST_MAP    = {"NEW_INSTALL":  95.0, "EXCHANGE":  82.0, "REPAIR":  65.0, "REMOVAL": 48.0}
ABORT_COST  = 38.0

# ─── Helper Utilities ─────────────────────────────────────────────────────────

def date_range(start: date, end: date):
    """Yield each date from start to end inclusive."""
    d = start
    while d <= end:
        yield d
        d += timedelta(days=1)


def week_of_year(d: date) -> int:
    return d.isocalendar()[1]


def seasonal_factor(d: date, amplitude: float = 0.20, peak_week: int = 28) -> float:
    """Sinusoidal seasonal factor — peaks in summer (week 28), troughs in winter."""
    w = week_of_year(d)
    return 1.0 + amplitude * math.sin(2 * math.pi * (w - peak_week) / 52)


def day_of_week_factor(d: date) -> float:
    """Monday–Friday operational ramp; weekends much lower."""
    factors = {0: 1.05, 1: 1.10, 2: 1.08, 3: 1.06, 4: 0.95, 5: 0.45, 6: 0.25}
    return factors[d.weekday()]


def gauss_noise(scale: float = 0.06) -> float:
    return 1.0 + random.gauss(0, scale)


def write_csv(filename: str, rows: list, fieldnames: list):
    path = INPUTS_DIR / filename
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
    print(f"  ✓  {filename}  ({len(rows):,} rows)")


# ─── Generator 1: Smart Meter Jobs ───────────────────────────────────────────

def generate_jobs():
    """Job-level records: 2024-01-01 → 2025-12-31 (actuals) + 2026 Q1 forecast."""
    rows = []
    job_counter = 1

    for d in date_range(date(2024, 1, 1), date(2026, 3, 31)):
        is_forecast = d.year == 2026
        sf = seasonal_factor(d)
        dof = day_of_week_factor(d)

        for region_code, rinfo in REGIONS.items():
            # Scale daily job volume
            daily_target = rinfo["base_jobs"] / 22  # ~22 working days/month
            daily_volume = max(0, int(daily_target * sf * dof * gauss_noise(0.08)))

            for _ in range(daily_volume):
                meter = random.choices(METER_TYPES, METER_WEIGHTS)[0]
                jtype = random.choices(JOB_TYPES, JOB_TYPE_WEIGHTS)[0]

                # Status determination
                if is_forecast:
                    status = "Forecast"
                elif d > date.today():
                    status = random.choices(
                        ["Booked", "Cancelled"],
                        weights=[0.80, 0.20]
                    )[0]
                else:
                    r = random.random()
                    if r < 0.68:
                        status = "Completed"
                    elif r < 0.82:
                        status = "Cancelled"
                    elif r < 0.90:
                        status = "Aborted"
                    else:
                        status = "Booked"

                patch = f"{region_code}-P{random.randint(1, rinfo['patches'])}"
                eng_id = f"ENG-{region_code}-{random.randint(1, rinfo['engineers']):03d}"

                cancel_reason = ""
                abort_reason  = ""
                if status == "Cancelled":
                    cancel_reason = random.choice(CANCEL_REASONS)
                elif status == "Aborted":
                    abort_reason = random.choice(ABORT_REASONS)

                completed_date = str(d) if status == "Completed" else ""
                booked_offset  = random.randint(3, 21)
                booked_date    = str(d - timedelta(days=booked_offset)) if status in (
                    "Completed", "Cancelled", "Aborted", "Booked"
                ) else ""

                contacts = random.randint(1, 5) if status != "Forecast" else 0

                rows.append({
                    "job_ref":           f"IMSERV-{d.year}-{job_counter:07d}",
                    "region_code":       region_code,
                    "region_name":       rinfo["name"],
                    "patch_code":        patch,
                    "meter_type":        meter,
                    "job_type":          jtype,
                    "status":            status,
                    "requested_date":    str(d),
                    "booked_date":       booked_date,
                    "completed_date":    completed_date,
                    "engineer_id":       eng_id if status != "Cancelled" else "",
                    "contacts_count":    contacts,
                    "cancellation_reason": cancel_reason,
                    "abort_reason":      abort_reason,
                    "revenue_gbp":       REVENUE_MAP.get(jtype, 0) if status == "Completed" else 0,
                    "cost_gbp":          COST_MAP.get(jtype, 0) if status in ("Completed", "Aborted")
                                         else (ABORT_COST if status == "Aborted" else 0),
                    "is_forecast":       1 if is_forecast else 0,
                })
                job_counter += 1

    write_csv("smart_meter_jobs.csv", rows, list(rows[0].keys()))


# ─── Generator 2: Channel Volume Data ────────────────────────────────────────

def generate_channel_volume():
    """Daily contact centre volumes per channel and region: 2024–2026."""
    rows = []
    for d in date_range(date(2024, 1, 1), date(2026, 12, 31)):
        is_forecast = d.year == 2026
        sf  = seasonal_factor(d, amplitude=0.18, peak_week=26)
        dof = day_of_week_factor(d)

        for region_code, rinfo in REGIONS.items():
            # Base daily contacts ~ 3.5× engineer headcount
            base = rinfo["engineers"] * 3.5

            for channel, cw in zip(CHANNELS, CHANNEL_WEIGHTS):
                vol = max(0, int(base * cw * sf * dof * gauss_noise(0.10)))

                # Bookings come from contacts (conversion varies by channel)
                conv_rate = {
                    "Phone": 0.42, "Web": 0.31, "App": 0.35,
                    "SMS": 0.18, "IVR": 0.12, "Agent Callback": 0.55,
                }.get(channel, 0.25)

                bookings     = int(vol * conv_rate * gauss_noise(0.05))
                cancellations= int(bookings * random.uniform(0.08, 0.22))
                abandoned    = int(vol * random.uniform(0.05, 0.18))
                aht          = round(random.uniform(4.5, 12.5), 2)

                rows.append({
                    "contact_date":    str(d),
                    "year":            d.year,
                    "month":           d.month,
                    "week":            week_of_year(d),
                    "day_of_week":     d.strftime("%A"),
                    "region_code":     region_code,
                    "region_name":     rinfo["name"],
                    "channel":         channel,
                    "volume":          vol,
                    "bookings":        bookings,
                    "cancellations":   cancellations,
                    "abandoned":       abandoned,
                    "avg_handle_mins": aht,
                    "is_forecast":     1 if is_forecast else 0,
                })

    write_csv("channel_volume.csv", rows, list(rows[0].keys()))


# ─── Generator 3: Booking Journey Data ───────────────────────────────────────

def generate_booking_journey():
    """Weekly funnel snapshots: Requests → Contacts → Bookings → Completions."""
    rows = []
    start = date(2024, 1, 1)
    end   = date(2026, 12, 31)
    d = start

    while d <= end:
        week_end = d + timedelta(days=6)
        is_forecast = d.year == 2026
        sf  = seasonal_factor(d, amplitude=0.22, peak_week=27)
        noise = gauss_noise(0.06)

        for region_code, rinfo in REGIONS.items():
            base_requests = rinfo["base_jobs"] * sf * noise

            requests      = int(base_requests)
            contacts      = int(requests * random.uniform(1.4, 2.2))  # multiple contacts per request
            bookings      = int(requests * random.uniform(0.70, 0.85))
            cancellations = int(bookings  * random.uniform(0.10, 0.22))
            aborts        = int((bookings - cancellations) * random.uniform(0.05, 0.12))
            completions   = int(bookings - cancellations - aborts)
            completion_rate = round(completions / max(requests, 1) * 100, 1)
            avg_contacts    = round(contacts / max(requests, 1), 2)

            rows.append({
                "week_start":       str(d),
                "week_end":         str(week_end),
                "year":             d.year,
                "week_number":      week_of_year(d),
                "region_code":      region_code,
                "region_name":      rinfo["name"],
                "total_requests":   requests,
                "total_contacts":   contacts,
                "avg_contacts_per_customer": avg_contacts,
                "total_bookings":   bookings,
                "total_cancellations": cancellations,
                "total_aborts":     aborts,
                "total_completions": completions,
                "completion_rate_pct": completion_rate,
                "is_forecast":      1 if is_forecast else 0,
            })

        d += timedelta(days=7)

    write_csv("booking_journey.csv", rows, list(rows[0].keys()))


# ─── Generator 4: Engineer Availability ──────────────────────────────────────

def generate_engineer_availability():
    """Daily engineer availability and performance: 2024–2025."""
    engineers_rows = []
    avail_rows     = []
    emp_counter    = 1

    # Build engineer master
    engineers = {}
    for region_code, rinfo in REGIONS.items():
        for i in range(1, rinfo["engineers"] + 1):
            eng_id = f"ENG-{region_code}-{i:03d}"
            patch  = f"{region_code}-P{((i - 1) % rinfo['patches']) + 1}"
            emp_type = random.choices(EMPLOYMENT_TYPES, EMP_WEIGHTS)[0]
            engineers[eng_id] = {
                "engineer_id":    eng_id,
                "name":           f"Engineer {emp_counter:04d}",
                "region_code":    region_code,
                "region_name":    rinfo["name"],
                "patch_code":     patch,
                "employment_type": emp_type,
                "target_jobs_day": random.randint(3, 5),
            }
            engineers_rows.append(engineers[eng_id])
            emp_counter += 1

    # Build daily availability
    leave_types = ["Available", "Annual Leave", "Sick", "Training", "Unavailable"]
    leave_weights = [0.82, 0.09, 0.04, 0.03, 0.02]

    for d in date_range(date(2024, 1, 1), date(2025, 12, 31)):
        dof = day_of_week_factor(d)
        is_weekend = d.weekday() >= 5

        for eng_id, einfo in engineers.items():
            if is_weekend and random.random() > 0.15:
                # Most engineers off weekends
                status = "Unavailable"
                jobs_comp = 0
                utilisation = 0.0
            else:
                status = random.choices(leave_types, leave_weights)[0]
                if status == "Available":
                    target = einfo["target_jobs_day"]
                    sf = seasonal_factor(d, amplitude=0.12, peak_week=28)
                    jobs_comp = max(0, int(target * sf * dof * gauss_noise(0.12)))
                    jobs_comp = min(jobs_comp, target + 1)
                    utilisation = round(jobs_comp / max(target, 1) * 100, 1)
                else:
                    jobs_comp   = 0
                    utilisation = 0.0

            avail_rows.append({
                "engineer_id":     eng_id,
                "region_code":     einfo["region_code"],
                "region_name":     einfo["region_name"],
                "patch_code":      einfo["patch_code"],
                "employment_type": einfo["employment_type"],
                "avail_date":      str(d),
                "year":            d.year,
                "month":           d.month,
                "week":            week_of_year(d),
                "day_of_week":     d.strftime("%A"),
                "status":          status,
                "jobs_completed":  jobs_comp,
                "jobs_target":     einfo["target_jobs_day"],
                "utilisation_pct": utilisation,
            })

    write_csv("engineers.csv", engineers_rows, list(engineers_rows[0].keys()))
    write_csv("engineer_availability.csv", avail_rows, list(avail_rows[0].keys()))


# ─── Generator 5: Financial Cost Data ────────────────────────────────────────

def generate_financial_data():
    """Monthly financial summary by region and job type: 2024–2025 + 2026 forecast."""
    rows = []

    for year in [2024, 2025, 2026]:
        for month in range(1, 13):
            if year == 2026 and month > 6:
                break  # Only generate H1 2026 forecast

            is_forecast = year == 2026
            d = date(year, month, 1)
            sf = seasonal_factor(d, amplitude=0.20, peak_week=28)

            for region_code, rinfo in REGIONS.items():
                for jtype in JOB_TYPES:
                    jweight = JOB_TYPE_WEIGHTS[JOB_TYPES.index(jtype)]
                    base_vol = int(rinfo["base_jobs"] * jweight * sf * gauss_noise(0.08))

                    completions   = int(base_vol * random.uniform(0.64, 0.74))
                    cancellations = int(base_vol * random.uniform(0.10, 0.20))
                    aborts        = int(base_vol * random.uniform(0.05, 0.12))

                    rev_per_job = REVENUE_MAP[jtype] * (1.0 if not is_forecast else 1.04)
                    cost_per_job= COST_MAP[jtype]    * (1.0 if not is_forecast else 1.06)

                    revenue   = round(completions * rev_per_job, 2)
                    direct_cost = round(completions * cost_per_job + aborts * ABORT_COST, 2)
                    overhead    = round(direct_cost * 0.22, 2)
                    total_cost  = round(direct_cost + overhead, 2)
                    margin      = round(revenue - total_cost, 2)
                    margin_pct  = round(margin / max(revenue, 1) * 100, 2)
                    cpp         = round(total_cost / max(completions, 1), 2)

                    rows.append({
                        "year":           year,
                        "month":          month,
                        "month_name":     d.strftime("%B"),
                        "quarter":        f"Q{(month - 1) // 3 + 1}",
                        "region_code":    region_code,
                        "region_name":    rinfo["name"],
                        "job_type":       jtype,
                        "total_requests": base_vol,
                        "completions":    completions,
                        "cancellations":  cancellations,
                        "aborts":         aborts,
                        "revenue_gbp":    revenue,
                        "direct_cost_gbp": direct_cost,
                        "overhead_gbp":   overhead,
                        "total_cost_gbp": total_cost,
                        "margin_gbp":     margin,
                        "margin_pct":     margin_pct,
                        "cost_per_completion": cpp,
                        "is_forecast":    1 if is_forecast else 0,
                    })

    write_csv("financial_data.csv", rows, list(rows[0].keys()))


# ─── Generator 6: Capacity & Demand Summary ──────────────────────────────────

def generate_capacity_data():
    """Weekly capacity vs demand by region: engineer supply vs job demand."""
    rows = []
    d = date(2024, 1, 1)

    while d <= date(2026, 12, 31):
        is_forecast = d.year == 2026
        sf = seasonal_factor(d, amplitude=0.22, peak_week=28)

        for region_code, rinfo in REGIONS.items():
            for patch_idx in range(1, rinfo["patches"] + 1):
                patch_code = f"{region_code}-P{patch_idx}"
                # Engineers per patch (roughly equal split)
                engs_per_patch = max(1, rinfo["engineers"] // rinfo["patches"])
                available_engs = int(engs_per_patch * random.uniform(0.72, 0.95))
                capacity_jobs  = available_engs * 4  # ~4 jobs/engineer/day

                demand_jobs = int(
                    (rinfo["base_jobs"] / rinfo["patches"]) / 5 * sf * gauss_noise(0.10)
                )
                gap         = capacity_jobs - demand_jobs
                utilisation = round(demand_jobs / max(capacity_jobs, 1) * 100, 1)
                rag         = "Green" if utilisation < 75 else ("Amber" if utilisation < 90 else "Red")

                rows.append({
                    "week_start":       str(d),
                    "year":             d.year,
                    "week_number":      week_of_year(d),
                    "region_code":      region_code,
                    "region_name":      rinfo["name"],
                    "patch_code":       patch_code,
                    "available_engineers": available_engs,
                    "capacity_jobs":    capacity_jobs,
                    "demand_jobs":      demand_jobs,
                    "gap_jobs":         gap,
                    "utilisation_pct":  utilisation,
                    "rag_status":       rag,
                    "is_forecast":      1 if is_forecast else 0,
                })

        d += timedelta(days=7)

    write_csv("capacity_demand.csv", rows, list(rows[0].keys()))


# ─── Main Entry Point ─────────────────────────────────────────────────────────

def generate_all():
    print("\nIMSERV — Generating synthetic datasets...\n")
    generate_channel_volume()
    generate_booking_journey()
    generate_engineer_availability()
    generate_financial_data()
    generate_capacity_data()
    # Jobs last (largest file)
    generate_jobs()

    # Write generation manifest
    manifest = {
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "files": [
            "channel_volume.csv",
            "booking_journey.csv",
            "engineers.csv",
            "engineer_availability.csv",
            "financial_data.csv",
            "capacity_demand.csv",
            "smart_meter_jobs.csv",
        ],
        "period": "2024-01-01 to 2026-03-31 (actuals + forecast)",
        "regions": list(REGIONS.keys()),
    }
    with open(INPUTS_DIR / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2)
    print(f"\n  ✓  manifest.json")
    print("\nAll datasets generated successfully.\n")


if __name__ == "__main__":
    generate_all()
