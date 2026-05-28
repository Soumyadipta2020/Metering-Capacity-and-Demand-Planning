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


def _clamp_number(value, default, min_value, max_value, cast=float):
    try:
        value = cast(value)
    except (TypeError, ValueError):
        value = default
    return max(min_value, min(max_value, value))


def optimise_workforce_allocation(
    year: int = 2025,
    target_utilisation_pct: float = 80,
    tolerance_pct: float = 4,
    max_engineers_per_move: int = 5,
    min_engineers_per_move: int = 1,
    max_relocation_distance: int = 50,
) -> dict:
    """
    Workforce rebalancing recommendations across all regions.
    Identifies regions outside a user-adjustable target utilisation band and
    suggests engineer transfers without mutating the source datasets.

    Returns:
        dict with rebalancing recommendations and efficiency gain estimate
    """
    target = _clamp_number(target_utilisation_pct, 80, 60, 95, float)
    tolerance = _clamp_number(tolerance_pct, 4, 1, 20, float)
    max_move = int(_clamp_number(max_engineers_per_move, 5, 1, 25, int))
    min_move = int(_clamp_number(min_engineers_per_move, 1, 1, max_move, int))
    lower_bound = max(40.0, target - tolerance)
    upper_bound = min(120.0, target + tolerance)

    region_codes = ["NW", "NE", "MID", "SE", "SW", "WAL", "SCO", "YRK"]
    capacity_rows = get_region_capacity_matrix(year)
    regional_capacity = defaultdict(lambda: {"capacity_jobs": 0.0, "demand_jobs": 0.0, "weeks": set()})
    for row in capacity_rows:
        rc = row["region_code"]
        regional_capacity[rc]["capacity_jobs"] += to_float(row.get("capacity_jobs"))
        regional_capacity[rc]["demand_jobs"] += to_float(row.get("demand_jobs"))
        regional_capacity[rc]["weeks"].add(to_int(row.get("week_number")))

    region_state = {}
    for rc in region_codes:
        kpis = get_field_ops_kpis(rc, year)
        cap = regional_capacity[rc]["capacity_jobs"]
        dem = regional_capacity[rc]["demand_jobs"]
        engineers = kpis["total_engineers"]
        if cap <= 0:
            cap = dem / max(kpis["avg_utilisation"] / 100, 0.01)
        capacity_per_engineer = cap / max(engineers, 1)
        util = safe_pct(dem, cap)
        weeks = len(regional_capacity[rc]["weeks"]) or 52
        region_state[rc] = {
            "region_code": rc,
            "engineers_before": engineers,
            "engineers_after": engineers,
            "capacity_before": cap,
            "capacity_after": cap,
            "demand_jobs": dem,
            "capacity_per_engineer": capacity_per_engineer,
            "utilisation_before": util,
            "utilisation_after": util,
            "weeks": weeks,
        }

    sources = []
    destinations = []
    target_ratio = target / 100

    for rc, state in region_state.items():
        cap = state["capacity_before"]
        dem = state["demand_jobs"]
        cpe = max(state["capacity_per_engineer"], 1)
        util = state["utilisation_before"]

        if util < lower_bound:
            removable_capacity = max(0, cap - (dem / max(target_ratio, 0.01)))
            surplus_engineers = int(removable_capacity // cpe)
            if surplus_engineers >= min_move:
                sources.append({
                    "region_code": rc,
                    "available": surplus_engineers,
                    "utilisation": util,
                })

        if util > upper_bound:
            required_capacity = max(0, (dem / max(target_ratio, 0.01)) - cap)
            needed_engineers = math.ceil(required_capacity / cpe)
            if needed_engineers >= min_move:
                destinations.append({
                    "region_code": rc,
                    "needed": needed_engineers,
                    "utilisation": util,
                })

    sources.sort(key=lambda item: item["utilisation"])
    destinations.sort(key=lambda item: item["utilisation"], reverse=True)

    recommendations = []
    for dest in destinations:
        for src in sources:
            if dest["needed"] < min_move:
                break
            if src["available"] < min_move:
                continue

            engineers = min(src["available"], dest["needed"], max_move)
            if engineers < min_move:
                continue

            src_state = region_state[src["region_code"]]
            dest_state = region_state[dest["region_code"]]
            src_capacity_delta = engineers * src_state["capacity_per_engineer"]
            dest_capacity_delta = engineers * dest_state["capacity_per_engineer"]

            src_before = src_state["utilisation_after"]
            dest_before = dest_state["utilisation_after"]

            src_state["capacity_after"] = max(src_state["capacity_after"] - src_capacity_delta, 1)
            src_state["engineers_after"] -= engineers
            src_state["utilisation_after"] = safe_pct(src_state["demand_jobs"], src_state["capacity_after"])

            dest_state["capacity_after"] += dest_capacity_delta
            dest_state["engineers_after"] += engineers
            dest_state["utilisation_after"] = safe_pct(dest_state["demand_jobs"], dest_state["capacity_after"])

            src["available"] -= engineers
            dest["needed"] -= engineers

            recommendations.append({
                "from_region": src["region_code"],
                "to_region": dest["region_code"],
                "engineers": engineers,
                "from_utilisation_before": round(src_before, 1),
                "from_utilisation_after": src_state["utilisation_after"],
                "to_utilisation_before": round(dest_before, 1),
                "to_utilisation_after": dest_state["utilisation_after"],
                "rationale": (
                    f"{src['region_code']} sits below the {lower_bound:.0f}% lower band; "
                    f"{dest['region_code']} sits above the {upper_bound:.0f}% upper band."
                ),
            })

    before_utils = [state["utilisation_before"] for state in region_state.values()]
    after_utils = [state["utilisation_after"] for state in region_state.values()]
    balance_before = statistics.mean([abs(util - target) for util in before_utils])
    balance_after = statistics.mean([abs(util - target) for util in after_utils])
    efficiency_gain = round(max(0, balance_before - balance_after), 1)

    overstaffed = [
        rc for rc, state in region_state.items()
        if state["utilisation_before"] < lower_bound
    ]
    understaffed = [
        rc for rc, state in region_state.items()
        if state["utilisation_before"] > upper_bound
    ]

    return {
        "parameters": {
            "target_utilisation_pct": target,
            "tolerance_pct": tolerance,
            "lower_bound_pct": round(lower_bound, 1),
            "upper_bound_pct": round(upper_bound, 1),
            "max_engineers_per_move": max_move,
            "min_engineers_per_move": min_move,
            "max_relocation_distance_mi": int(max_relocation_distance),
        },
        "overstaffed_regions": overstaffed,
        "understaffed_regions": understaffed,
        "recommendations": recommendations,
        "regional_before_after": [
            {
                "region_code": rc,
                "engineers_before": state["engineers_before"],
                "engineers_after": state["engineers_after"],
                "capacity_before": int(round(state["capacity_before"])),
                "capacity_after": int(round(state["capacity_after"])),
                "demand_jobs": int(round(state["demand_jobs"])),
                "utilisation_before": round(state["utilisation_before"], 1),
                "utilisation_after": round(state["utilisation_after"], 1),
                "weeks": state["weeks"],
            }
            for rc, state in sorted(region_state.items())
        ],
        "total_engineers_moved": sum(item["engineers"] for item in recommendations),
        "avg_utilisation_before": round(statistics.mean(before_utils), 1),
        "avg_utilisation_after": round(statistics.mean(after_utils), 1),
        "balance_gap_before_pct": round(balance_before, 1),
        "balance_gap_after_pct": round(balance_after, 1),
        "estimated_efficiency_gain_pct": efficiency_gain,
    }
