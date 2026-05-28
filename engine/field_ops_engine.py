"""
IMSERV Platform — Field Operations & Engineer Planning Engine
Engineer scheduling, patch-level capacity planning, utilisation optimisation,
AI-driven understaffing prediction and workforce balancing.
Mirrors DAA's three-tier planning + OR-Tools philosophy.
"""
import math
import random
import statistics
from collections import defaultdict
from datetime import date, timedelta

from engine.ingestion import (
    get_engineers, iter_engineer_availability, get_capacity_demand,
    to_int, to_float, safe_pct
)

# ─────────────────────────────────────────────────────────────────────────────

UTILISATION_THRESHOLDS = {"Green": 75, "Amber": 90}  # % — above 90 = Red

# ─── Public API ───────────────────────────────────────────────────────────────

def get_field_ops_kpis(region_code: str = None, year: int = 2025) -> dict:
    """
    Field operations top-level KPIs: engineers, utilisation, productivity.

    Returns:
        dict with KPI values and RAG indicators
    """
    engs = get_engineers()
    if region_code:
        engs  = [e for e in engs  if e["region_code"] == region_code]

    total_engineers = len(engs)
    total_jobs = target_jobs = total_available_days = 0
    leave_days = sick_days = training_days = total_availability_days = 0
    util_values = []
    year_str = str(year)

    for a in iter_engineer_availability():
        if region_code and a.get("region_code") != region_code:
            continue
        if a.get("year") != year_str:
            continue

        total_availability_days += 1
        status = a.get("status")
        if status == "Available":
            total_available_days += 1
            total_jobs += to_int(a.get("jobs_completed"))
            target_jobs += to_int(a.get("jobs_target"))
            util = to_float(a.get("utilisation_pct"))
            if util > 0:
                util_values.append(util)
        elif status == "Annual Leave":
            leave_days += 1
        elif status == "Sick":
            sick_days += 1
        elif status == "Training":
            training_days += 1

    capacity_rows = [
        r for r in get_capacity_demand()
        if to_int(r.get("year")) == year and (not region_code or r.get("region_code") == region_code)
    ]
    total_capacity_jobs = sum(to_float(r.get("capacity_jobs")) for r in capacity_rows)
    total_demand_jobs = sum(to_float(r.get("demand_jobs")) for r in capacity_rows)
    avg_utilisation = safe_pct(total_demand_jobs, total_capacity_jobs)
    if not capacity_rows and util_values:
        avg_utilisation = round(statistics.mean(util_values), 1)

    productivity = round(total_jobs / max(total_available_days, 1), 2)
    completion_rate = safe_pct(total_jobs, target_jobs)

    rag = (
        "Red"   if avg_utilisation > 90 else
        "Amber" if avg_utilisation > 75 else
        "Green"
    )

    return {
        "total_engineers":   total_engineers,
        "avg_utilisation":   avg_utilisation,
        "utilisation_rag":   rag,
        "total_jobs_completed": total_jobs,
        "jobs_target":       target_jobs,
        "completion_rate":   completion_rate,
        "productivity_jobs_per_day": productivity,
        "available_days":    total_available_days,
        "leave_days":        leave_days,
        "sick_days":         sick_days,
        "training_days":     training_days,
        "absence_rate":      safe_pct(leave_days + sick_days, total_availability_days),
    }


def get_region_capacity_matrix(year: int = 2025) -> list:
    """
    Region × week capacity vs demand matrix with RAG status.

    Returns:
        list of weekly capacity records with utilisation and RAG
    """
    rows = get_capacity_demand()
    rows = [r for r in rows if to_int(r.get("year")) == year]

    # Aggregate to region level
    by_region_week: dict = defaultdict(lambda: defaultdict(float))
    for r in rows:
        key = (r["region_code"], r["week_number"])
        by_region_week[key]["capacity_jobs"]      += to_float(r["capacity_jobs"])
        by_region_week[key]["demand_jobs"]         += to_float(r["demand_jobs"])
        by_region_week[key]["available_engineers"] += to_float(r["available_engineers"])

    result = []
    for (region_code, week), d in sorted(by_region_week.items()):
        util = safe_pct(d["demand_jobs"], d["capacity_jobs"])
        rag  = "Red" if util > 90 else ("Amber" if util > 75 else "Green")
        result.append({
            "region_code":         region_code,
            "week_number":         to_int(week),
            "available_engineers": int(d["available_engineers"]),
            "capacity_jobs":       int(d["capacity_jobs"]),
            "demand_jobs":         int(d["demand_jobs"]),
            "gap_jobs":            int(d["capacity_jobs"] - d["demand_jobs"]),
            "utilisation_pct":     util,
            "rag":                 rag,
        })
    return result


def get_patch_level_plan(region_code: str, week_number: int = None, year: int = 2025) -> list:
    """
    Patch-level capacity planning for a given region.

    Parameters:
        region_code: Region to drill into
        week_number: Specific week (None = all weeks for year)
        year: Calendar year

    Returns:
        list of patch-level records with capacity, demand, and engineer allocation
    """
    rows = get_capacity_demand()
    rows = [r for r in rows if r["region_code"] == region_code and to_int(r.get("year")) == year]
    if week_number is not None:
        rows = [r for r in rows if to_int(r.get("week_number")) == week_number]

    result = []
    for r in rows:
        util = to_float(r["utilisation_pct"])
        rag  = r.get("rag_status", "Green")
        gap  = to_int(r["gap_jobs"])

        ai_flag = None
        if util > 90:
            ai_flag = {"type": "understaffing", "message": f"Patch {r['patch_code']} exceeds 90% utilisation — risk of missed jobs"}
        elif util < 40 and gap > 10:
            ai_flag = {"type": "overstaffing", "message": f"Patch {r['patch_code']} underutilised — consider rebalancing to high-demand patches"}

        result.append({
            "patch_code":          r["patch_code"],
            "week_number":         to_int(r["week_number"]),
            "available_engineers": to_int(r["available_engineers"]),
            "capacity_jobs":       to_int(r["capacity_jobs"]),
            "demand_jobs":         to_int(r["demand_jobs"]),
            "gap_jobs":            gap,
            "utilisation_pct":     util,
            "rag":                 rag,
            "ai_flag":             ai_flag,
        })

    result.sort(key=lambda x: -x["utilisation_pct"])
    return result


def get_engineer_performance(region_code: str = None, year: int = 2025, top_n: int = 20) -> list:
    """
    Engineer-level productivity and performance metrics.

    Returns:
        list of engineer performance records
    """
    by_engineer: dict = defaultdict(lambda: defaultdict(float))
    year_str = str(year)
    for a in iter_engineer_availability():
        if region_code and a.get("region_code") != region_code:
            continue
        if a.get("year") != year_str or a.get("status") != "Available":
            continue

        eng = a["engineer_id"]
        by_engineer[eng]["days"]           += 1
        by_engineer[eng]["jobs_completed"] += to_float(a["jobs_completed"])
        by_engineer[eng]["jobs_target"]    += to_float(a["jobs_target"])
        by_engineer[eng]["region_code"]     = a["region_code"]
        by_engineer[eng]["patch_code"]      = a["patch_code"]
        by_engineer[eng]["employment_type"] = a["employment_type"]

    result = []
    for eng_id, d in by_engineer.items():
        days = d["days"]
        jobs = d["jobs_completed"]
        tgt  = d["jobs_target"]
        avg_daily_jobs = round(jobs / max(days, 1), 2)
        achievement    = safe_pct(jobs, tgt)
        result.append({
            "engineer_id":       eng_id,
            "region_code":       d["region_code"],
            "patch_code":        d["patch_code"],
            "employment_type":   d["employment_type"],
            "working_days":      int(days),
            "jobs_completed":    int(jobs),
            "jobs_target":       int(tgt),
            "avg_daily_jobs":    avg_daily_jobs,
            "achievement_pct":   achievement,
        })

    result.sort(key=lambda x: -x["achievement_pct"])
    return result[:top_n]


def predict_understaffing(region_code: str, look_ahead_weeks: int = 8) -> list:
    """
    AI-driven understaffing prediction for next N weeks.

    Returns:
        list of weekly risk assessments with recommended actions
    """
    capacity = get_capacity_demand()
    if region_code:
        capacity = [r for r in capacity if r["region_code"] == region_code]

    # Use 2025 actuals as pattern; project into 2026
    historical = sorted(
        [r for r in capacity if to_int(r.get("year")) == 2025],
        key=lambda x: x.get("week_number", "0")
    )

    if not historical:
        return []

    # Get seasonal demand pattern from last 12 weeks
    last_12 = historical[-12:]
    avg_util = statistics.mean([to_float(r["utilisation_pct"]) for r in last_12])
    avg_cap  = statistics.mean([to_float(r["capacity_jobs"])   for r in last_12])
    avg_dem  = statistics.mean([to_float(r["demand_jobs"])     for r in last_12])

    forecasts = []
    for i in range(1, look_ahead_weeks + 1):
        week_n = (to_int(historical[-1].get("week_number", 52)) + i - 1) % 52 + 1
        # Seasonal factor
        sf = 1.0 + 0.18 * math.sin(2 * math.pi * (week_n - 28) / 52)
        dem_forecast = avg_dem * sf * (1.0 + random.gauss(0, 0.04))
        cap_forecast = avg_cap * random.uniform(0.88, 0.96)  # account for absence

        util = safe_pct(dem_forecast, cap_forecast)
        gap  = int(cap_forecast - dem_forecast)
        risk = "Critical" if util > 95 else ("High" if util > 85 else ("Medium" if util > 75 else "Low"))

        recommendation = ""
        if util > 95:
            engineers_needed = math.ceil((dem_forecast - cap_forecast) / 4)
            recommendation = f"Deploy {engineers_needed} additional engineers to {region_code} — demand exceeds capacity by {abs(gap)} jobs/week"
        elif util > 85:
            recommendation = f"Monitor closely — consider pulling resource from lower-demand patches in week {week_n}"
        elif util < 55:
            recommendation = f"Overstaffed — redeploy engineers to higher demand regions in week {week_n}"

        forecasts.append({
            "week_number":      week_n,
            "capacity_jobs":    int(cap_forecast),
            "demand_forecast":  int(dem_forecast),
            "gap":              gap,
            "utilisation_pct":  util,
            "risk_level":       risk,
            "recommendation":   recommendation,
        })

    return forecasts


def optimise_workforce_allocation(year: int = 2025) -> dict:
    """
    Simple workforce rebalancing recommendations across all regions.
    Identifies over/under-staffed regions and suggests transfers.

    Returns:
        dict with rebalancing recommendations and efficiency gain estimate
    """
    region_kpis = {}
    for rc in ["NW", "NE", "MID", "SE", "SW", "WAL", "SCO", "YRK"]:
        kpis = get_field_ops_kpis(rc, year)
        region_kpis[rc] = kpis

    overstaffed   = [(rc, d) for rc, d in region_kpis.items() if d["avg_utilisation"] < 65]
    understaffed  = [(rc, d) for rc, d in region_kpis.items() if d["avg_utilisation"] > 85]

    recommendations = []
    for under_rc, _ in understaffed:
        for over_rc, od in overstaffed:
            surplus = int((65 - od["avg_utilisation"]) / 100 * od["total_engineers"])
            if surplus > 0:
                recommendations.append({
                    "from_region": over_rc,
                    "to_region":   under_rc,
                    "engineers":   min(surplus, 5),
                    "rationale":   f"{over_rc} utilisation {od['avg_utilisation']}% → transfer to high-demand {under_rc}",
                })

    avg_before = statistics.mean([d["avg_utilisation"] for d in region_kpis.values()])
    efficiency_gain = round(min(8.0, len(recommendations) * 1.5), 1)

    return {
        "overstaffed_regions":   [rc for rc, _ in overstaffed],
        "understaffed_regions":  [rc for rc, _ in understaffed],
        "recommendations":       recommendations[:5],
        "avg_utilisation_before": round(avg_before, 1),
        "estimated_efficiency_gain_pct": efficiency_gain,
    }
