"""
IMSERV Platform — Financial Scenario Planning Engine
Interactive simulation: job volume, meter type, region, engineer allocation,
productivity assumptions → operational cost, revenue, margin, cost-per-job.
Mirrors DAA's Monte Carlo simulation architecture.
"""
import math
import random
import statistics
from collections import defaultdict

from engine.ingestion import (
    get_financial_data, to_int, to_float, safe_pct
)

# ─────────────────────────────────────────────────────────────────────────────

REVENUE_MAP  = {"NEW_INSTALL": 185.0, "EXCHANGE": 165.0, "REPAIR": 120.0, "REMOVAL": 90.0}
COST_MAP     = {"NEW_INSTALL":  95.0, "EXCHANGE":  82.0, "REPAIR":  65.0, "REMOVAL": 48.0}
ABORT_COST   = 38.0
OVERHEAD_PCT = 0.22   # 22% overhead on direct cost

JOB_TYPE_WEIGHTS = {"NEW_INSTALL": 0.35, "EXCHANGE": 0.40, "REPAIR": 0.18, "REMOVAL": 0.07}

# ─── Core Calculations ────────────────────────────────────────────────────────

def _calculate_financials(
    job_volume: int,
    completion_rate: float,
    cancel_rate: float,
    abort_rate: float,
    revenue_uplift: float = 1.0,
    cost_uplift: float = 1.0,
    job_mix: dict = None,
) -> dict:
    """Core financial calculation given volume and rate assumptions."""
    if job_mix is None:
        job_mix = JOB_TYPE_WEIGHTS

    completions   = int(job_volume * completion_rate)
    cancellations = int(job_volume * cancel_rate)
    aborts        = int(job_volume * abort_rate)

    revenue    = 0.0
    direct_cost = 0.0

    for jtype, weight in job_mix.items():
        vol = int(completions * weight)
        revenue     += vol * REVENUE_MAP.get(jtype, 150.0) * revenue_uplift
        direct_cost += vol * COST_MAP.get(jtype, 80.0)    * cost_uplift

    direct_cost += aborts * ABORT_COST * cost_uplift
    overhead    = direct_cost * OVERHEAD_PCT
    total_cost  = direct_cost + overhead
    margin      = revenue - total_cost
    margin_pct  = safe_pct(margin, revenue, decimals=2)
    cpp         = round(total_cost / max(completions, 1), 2)

    return {
        "job_volume":       job_volume,
        "completions":      completions,
        "cancellations":    cancellations,
        "aborts":           aborts,
        "revenue_gbp":      round(revenue, 2),
        "direct_cost_gbp":  round(direct_cost, 2),
        "overhead_gbp":     round(overhead, 2),
        "total_cost_gbp":   round(total_cost, 2),
        "margin_gbp":       round(margin, 2),
        "margin_pct":       margin_pct,
        "cost_per_completion": cpp,
    }


# ─── Public API ───────────────────────────────────────────────────────────────

def get_financial_kpis(region_code: str = None, year: int = 2025) -> dict:
    """
    Aggregated financial KPIs from historical data.

    Returns:
        dict with revenue, cost, margin, and profitability metrics
    """
    rows = get_financial_data()
    if region_code:
        rows = [r for r in rows if r["region_code"] == region_code]
    rows = [r for r in rows if to_int(r.get("year")) == year]

    total_revenue   = sum(to_float(r["revenue_gbp"])        for r in rows)
    total_cost      = sum(to_float(r["total_cost_gbp"])     for r in rows)
    total_margin    = sum(to_float(r["margin_gbp"])         for r in rows)
    total_jobs      = sum(to_int(r["completions"])          for r in rows)
    total_requests  = sum(to_int(r["total_requests"])       for r in rows)

    avg_cpp         = round(total_cost    / max(total_jobs, 1), 2)
    avg_margin_pct  = safe_pct(total_margin, total_revenue, decimals=2)

    # Monthly trend
    monthly: dict = defaultdict(lambda: defaultdict(float))
    for r in rows:
        ym = f"{r.get('year')}-{int(r.get('month', 1)):02d}"
        monthly[ym]["revenue"]     += to_float(r["revenue_gbp"])
        monthly[ym]["cost"]        += to_float(r["total_cost_gbp"])
        monthly[ym]["margin"]      += to_float(r["margin_gbp"])
        monthly[ym]["completions"] += to_float(r["completions"])

    monthly_trend = []
    for ym in sorted(monthly.keys()):
        d = monthly[ym]
        monthly_trend.append({
            "month":       ym,
            "revenue":     round(d["revenue"], 2),
            "cost":        round(d["cost"], 2),
            "margin":      round(d["margin"], 2),
            "margin_pct":  safe_pct(d["margin"], d["revenue"], decimals=1),
            "completions": int(d["completions"]),
        })

    # By job type
    by_type: dict = defaultdict(lambda: defaultdict(float))
    for r in rows:
        jt = r["job_type"]
        by_type[jt]["revenue"]     += to_float(r["revenue_gbp"])
        by_type[jt]["cost"]        += to_float(r["total_cost_gbp"])
        by_type[jt]["completions"] += to_float(r["completions"])

    job_type_breakdown = []
    for jt, d in by_type.items():
        job_type_breakdown.append({
            "job_type":    jt,
            "revenue":     round(d["revenue"], 2),
            "cost":        round(d["cost"], 2),
            "margin":      round(d["revenue"] - d["cost"], 2),
            "margin_pct":  safe_pct(d["revenue"] - d["cost"], d["revenue"], decimals=1),
            "completions": int(d["completions"]),
            "cpp":         round(d["cost"] / max(d["completions"], 1), 2),
        })
    job_type_breakdown.sort(key=lambda x: -x["revenue"])

    return {
        "total_revenue_gbp":  round(total_revenue, 2),
        "total_cost_gbp":     round(total_cost, 2),
        "total_margin_gbp":   round(total_margin, 2),
        "margin_pct":         avg_margin_pct,
        "total_completions":  total_jobs,
        "avg_cost_per_completion": avg_cpp,
        "monthly_trend":      monthly_trend,
        "job_type_breakdown": job_type_breakdown,
    }


def run_scenario(
    scenario_name: str,
    job_volume: int,
    completion_rate_pct: float = 68.0,
    cancel_rate_pct: float = 15.0,
    abort_rate_pct: float = 8.0,
    revenue_uplift_pct: float = 0.0,
    cost_uplift_pct: float = 0.0,
    engineer_count: int = 300,
    productivity_jobs_per_day: float = 4.0,
    region_code: str = None,
) -> dict:
    """
    Run a named financial scenario simulation.

    Parameters:
        scenario_name: Label for this scenario
        job_volume: Total jobs in period
        completion_rate_pct: % of jobs completed
        cancel_rate_pct: % cancelled
        abort_rate_pct: % aborted
        revenue_uplift_pct: Revenue price change (%)
        cost_uplift_pct: Cost change (%)
        engineer_count: FTE engineers
        productivity_jobs_per_day: Average jobs per engineer per day

    Returns:
        dict with full P&L, efficiency metrics, and waterfall data
    """
    cr  = completion_rate_pct / 100
    can = cancel_rate_pct     / 100
    ab  = abort_rate_pct      / 100
    ru  = 1 + revenue_uplift_pct / 100
    cu  = 1 + cost_uplift_pct    / 100

    result = _calculate_financials(
        job_volume=job_volume,
        completion_rate=cr,
        cancel_rate=can,
        abort_rate=ab,
        revenue_uplift=ru,
        cost_uplift=cu,
    )
    result["scenario_name"] = scenario_name
    result["engineer_count"] = engineer_count
    result["productivity"]   = productivity_jobs_per_day

    # Capacity check
    working_days  = 230  # approximate annual
    capacity_jobs = int(engineer_count * productivity_jobs_per_day * working_days)
    result["capacity_jobs"] = capacity_jobs
    result["capacity_gap"]  = capacity_jobs - result["completions"]
    result["capacity_rag"]  = (
        "Red"   if result["completions"] > capacity_jobs else
        "Amber" if result["completions"] > capacity_jobs * 0.90 else
        "Green"
    )

    # Waterfall data for chart
    base = _calculate_financials(
        job_volume=job_volume, completion_rate=0.68,
        cancel_rate=0.15, abort_rate=0.08
    )
    result["waterfall"] = [
        {"label": "Base Revenue",        "value":  base["revenue_gbp"],     "type": "base"},
        {"label": "Revenue Change",       "value":  result["revenue_gbp"] - base["revenue_gbp"], "type": "delta"},
        {"label": "Direct Cost",          "value": -result["direct_cost_gbp"], "type": "cost"},
        {"label": "Overhead",             "value": -result["overhead_gbp"],    "type": "cost"},
        {"label": "Net Margin",           "value":  result["margin_gbp"],      "type": "total"},
    ]

    return result


def compare_scenarios(scenarios: list) -> dict:
    """
    Compare multiple named scenarios side-by-side.

    Parameters:
        scenarios: list of scenario param dicts (same keys as run_scenario)

    Returns:
        dict with comparison table, best/worst scenario, and recommendation
    """
    results = []
    for s in scenarios:
        res = run_scenario(**s)
        results.append(res)

    best  = max(results, key=lambda x: x["margin_pct"])
    worst = min(results, key=lambda x: x["margin_pct"])

    return {
        "scenarios":           results,
        "best_scenario":       best["scenario_name"],
        "worst_scenario":      worst["scenario_name"],
        "margin_range":        [worst["margin_pct"], best["margin_pct"]],
        "recommendation": (
            f"Scenario '{best['scenario_name']}' delivers highest margin at "
            f"{best['margin_pct']}% (£{best['margin_gbp']:,.0f}). "
            f"Consider applying its parameters regionally."
        ),
    }


def get_forecast_profitability(region_code: str = None) -> dict:
    """
    2026 forecast profitability based on 2025 actuals + growth assumptions.

    Returns:
        dict with monthly P&L forecast for 2026
    """
    actuals = get_financial_kpis(region_code, year=2025)
    monthly_actuals = actuals["monthly_trend"]

    if not monthly_actuals:
        return {"monthly_forecast": [], "annual_summary": {}}

    growth_rate   = 0.04  # 4% revenue growth
    cost_inflation = 0.06  # 6% cost inflation

    monthly_forecast = []
    for i, m in enumerate(monthly_actuals):
        ym_parts = m["month"].split("-")
        new_month = f"2026-{ym_parts[1]}"
        forecast_rev  = round(m["revenue"]  * (1 + growth_rate), 2)
        forecast_cost = round(m["cost"]     * (1 + cost_inflation), 2)
        forecast_margin = round(forecast_rev - forecast_cost, 2)
        monthly_forecast.append({
            "month":       new_month,
            "revenue":     forecast_rev,
            "cost":        forecast_cost,
            "margin":      forecast_margin,
            "margin_pct":  safe_pct(forecast_margin, forecast_rev, decimals=1),
            "is_forecast": True,
        })

    annual = {
        "revenue":     sum(m["revenue"]  for m in monthly_forecast),
        "cost":        sum(m["cost"]     for m in monthly_forecast),
        "margin":      sum(m["margin"]   for m in monthly_forecast),
        "margin_pct":  safe_pct(
            sum(m["margin"] for m in monthly_forecast),
            sum(m["revenue"] for m in monthly_forecast),
            decimals=2
        ),
    }

    return {
        "monthly_forecast": monthly_forecast,
        "annual_summary":   {k: round(v, 2) for k, v in annual.items()},
        "assumptions": {
            "revenue_growth_pct":   growth_rate * 100,
            "cost_inflation_pct":   cost_inflation * 100,
        },
    }
