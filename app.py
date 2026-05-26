"""
IMSERV Smart Meter Field Planning & Utility Operations Platform
Flask application — extends DAA-Project architecture patterns.

Modules:
  1. Bookings to Completions Journey  — executive funnel dashboard
  2. Contact Centre Forecasting       — multi-model channel forecasting
  3. Cancellations & Aborts          — root cause + AI prediction
  4. Field Operations & Engineer Planning — scheduling + optimisation
  5. Financial Scenario Planning      — cost/revenue simulation
"""
import os
import json
from pathlib import Path
from datetime import date, datetime

from flask import Flask, jsonify, render_template, request
from flask_cors import CORS
from dotenv import load_dotenv

# ─── Environment ─────────────────────────────────────────────────────────────
load_dotenv()

BASE_DIR = Path(__file__).resolve().parent

# ─── Flask App ────────────────────────────────────────────────────────────────
app = Flask(__name__, template_folder="templates", static_folder="static")
app.secret_key = os.getenv("SECRET_KEY", "imserv-dev-secret-2026")
CORS(app)
_DATA_READY = False

# ─── After-request: no-cache for all /api/* routes (mirrors DAA pattern) ─────
@app.after_request
def add_api_no_cache_headers(response):
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"]        = "no-cache"
    return response


# ─── Lazy Engine Imports (avoids startup cost if data not yet generated) ─────
def _get_forecasting_engine():
    from engine.forecasting_engine import (
        forecast_channel_volume, get_channel_kpis, get_booking_conversion_funnel
    )
    return forecast_channel_volume, get_channel_kpis, get_booking_conversion_funnel

def _get_cancellation_engine():
    from engine.cancellation_engine import (
        get_cancellation_kpis, get_cancellation_root_causes,
        get_cancellation_trends, get_regional_cancellation_heatmap,
        predict_cancellation_risk, get_rebooking_analytics
    )
    return (get_cancellation_kpis, get_cancellation_root_causes,
            get_cancellation_trends, get_regional_cancellation_heatmap,
            predict_cancellation_risk, get_rebooking_analytics)

def _get_field_ops_engine():
    from engine.field_ops_engine import (
        get_field_ops_kpis, get_region_capacity_matrix, get_patch_level_plan,
        get_engineer_performance, predict_understaffing, optimise_workforce_allocation
    )
    return (get_field_ops_kpis, get_region_capacity_matrix, get_patch_level_plan,
            get_engineer_performance, predict_understaffing, optimise_workforce_allocation)

def _get_financial_engine():
    from engine.financial_engine import (
        get_financial_kpis, run_scenario, compare_scenarios, get_forecast_profitability
    )
    return get_financial_kpis, run_scenario, compare_scenarios, get_forecast_profitability

def _get_ai_engine():
    from engine.ai_recommendations import get_all_recommendations, get_natural_language_summary
    return get_all_recommendations, get_natural_language_summary

def _get_ingestion():
    from engine.ingestion import get_booking_journey, data_health, to_int, to_float, safe_pct
    return get_booking_journey, data_health, to_int, to_float, safe_pct


# ─────────────────────────────────────────────────────────────────────────────
# FRONTEND VIEWS
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")


# ─────────────────────────────────────────────────────────────────────────────
# MODULE 1 — BOOKINGS TO COMPLETIONS JOURNEY
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/journey/kpis")
def journey_kpis():
    """Top-level funnel KPIs for the executive dashboard."""
    region = request.args.get("region")
    year   = int(request.args.get("year", 2025))
    try:
        get_journey, _, to_int_fn, to_float_fn, safe_pct_fn = _get_ingestion()
        rows = get_journey()
        if region:
            rows = [r for r in rows if r["region_code"] == region]
        rows = [r for r in rows if to_int_fn(r.get("year")) == year and r.get("is_forecast", "0") == "0"]

        total_requests      = sum(to_int_fn(r["total_requests"])      for r in rows)
        total_contacts      = sum(to_int_fn(r["total_contacts"])       for r in rows)
        total_bookings      = sum(to_int_fn(r["total_bookings"])       for r in rows)
        total_cancellations = sum(to_int_fn(r["total_cancellations"])  for r in rows)
        total_aborts        = sum(to_int_fn(r["total_aborts"])         for r in rows)
        total_completions   = sum(to_int_fn(r["total_completions"])    for r in rows)
        avg_contacts        = round(total_contacts / max(total_requests, 1), 2)
        completion_rate     = safe_pct_fn(total_completions, total_requests)

        return jsonify({
            "total_requests":        total_requests,
            "total_contacts":        total_contacts,
            "avg_contacts_per_customer": avg_contacts,
            "total_bookings":        total_bookings,
            "total_cancellations":   total_cancellations,
            "total_aborts":          total_aborts,
            "total_completions":     total_completions,
            "completion_rate":       completion_rate,
            "booking_rate":          safe_pct_fn(total_bookings, total_requests),
            "cancellation_rate":     safe_pct_fn(total_cancellations, total_bookings),
            "abort_rate":            safe_pct_fn(total_aborts, total_bookings - total_cancellations),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/journey/weekly-trend")
def journey_weekly_trend():
    """Weekly completion rate trend for line chart."""
    region = request.args.get("region")
    year   = int(request.args.get("year", 2025))
    try:
        get_journey, _, to_int_fn, to_float_fn, _ = _get_ingestion()
        rows = get_journey()
        if region:
            rows = [r for r in rows if r["region_code"] == region]
        rows = [r for r in rows if to_int_fn(r.get("year")) == year and r.get("is_forecast", "0") == "0"]
        rows = sorted(rows, key=lambda x: x.get("week_start", ""))

        weekly = {}
        for r in rows:
            wk = r.get("week_start", "")[:10]
            if wk not in weekly:
                weekly[wk] = {"requests": 0, "bookings": 0, "completions": 0, "cancellations": 0, "aborts": 0}
            weekly[wk]["requests"]     += to_int_fn(r["total_requests"])
            weekly[wk]["bookings"]     += to_int_fn(r["total_bookings"])
            weekly[wk]["completions"]  += to_int_fn(r["total_completions"])
            weekly[wk]["cancellations"]+= to_int_fn(r["total_cancellations"])
            weekly[wk]["aborts"]       += to_int_fn(r["total_aborts"])

        labels, requests, bookings, completions, cancellations, aborts = [], [], [], [], [], []
        for wk in sorted(weekly.keys()):
            d = weekly[wk]
            labels.append(wk)
            requests.append(d["requests"])
            bookings.append(d["bookings"])
            completions.append(d["completions"])
            cancellations.append(d["cancellations"])
            aborts.append(d["aborts"])

        return jsonify({
            "labels":        labels,
            "requests":      requests,
            "bookings":      bookings,
            "completions":   completions,
            "cancellations": cancellations,
            "aborts":        aborts,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/journey/regional-heatmap")
def journey_regional_heatmap():
    """Regional completion rate heatmap data."""
    year = int(request.args.get("year", 2025))
    try:
        get_journey, _, to_int_fn, to_float_fn, safe_pct_fn = _get_ingestion()
        rows = get_journey()
        rows = [r for r in rows if to_int_fn(r.get("year")) == year and r.get("is_forecast", "0") == "0"]

        by_region = {}
        for r in rows:
            rc = r["region_code"]
            if rc not in by_region:
                by_region[rc] = {"requests": 0, "completions": 0, "cancellations": 0, "aborts": 0, "region_name": r.get("region_name", rc)}
            by_region[rc]["requests"]     += to_int_fn(r["total_requests"])
            by_region[rc]["completions"]  += to_int_fn(r["total_completions"])
            by_region[rc]["cancellations"]+= to_int_fn(r["total_cancellations"])
            by_region[rc]["aborts"]       += to_int_fn(r["total_aborts"])

        result = []
        for rc, d in by_region.items():
            cr = safe_pct_fn(d["completions"], d["requests"])
            rag = "Green" if cr >= 65 else ("Amber" if cr >= 55 else "Red")
            result.append({
                "region_code":    rc,
                "region_name":    d["region_name"],
                "requests":       d["requests"],
                "completions":    d["completions"],
                "cancellations":  d["cancellations"],
                "aborts":         d["aborts"],
                "completion_rate":cr,
                "rag":            rag,
            })
        result.sort(key=lambda x: -x["completion_rate"])
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─────────────────────────────────────────────────────────────────────────────
# MODULE 2 — CONTACT CENTRE FORECASTING
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/forecasting/channel-kpis")
def forecasting_channel_kpis():
    region = request.args.get("region")
    year   = int(request.args.get("year", 2025))
    try:
        _, get_kpis, _ = _get_forecasting_engine()
        return jsonify(get_kpis(region, year))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/forecasting/forecast")
def forecasting_forecast():
    region  = request.args.get("region")
    channel = request.args.get("channel")
    weeks   = int(request.args.get("weeks", 26))
    models  = request.args.getlist("models") or None
    try:
        forecast_fn, _, _ = _get_forecasting_engine()
        return jsonify(forecast_fn(region, channel, weeks, models))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/forecasting/funnel")
def forecasting_funnel():
    region = request.args.get("region")
    year   = int(request.args.get("year", 2025))
    try:
        _, _, get_funnel = _get_forecasting_engine()
        return jsonify(get_funnel(region, year))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─────────────────────────────────────────────────────────────────────────────
# MODULE 3 — CANCELLATIONS & ABORTS
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/cancellations/kpis")
def cancellations_kpis():
    region = request.args.get("region")
    year   = int(request.args.get("year", 2025))
    try:
        get_kpis, *_ = _get_cancellation_engine()
        return jsonify(get_kpis(region, year))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/cancellations/root-causes")
def cancellations_root_causes():
    region        = request.args.get("region")
    year          = int(request.args.get("year", 2025))
    include_aborts= request.args.get("include_aborts", "true").lower() == "true"
    try:
        _, get_rc, *_ = _get_cancellation_engine()
        return jsonify(get_rc(region, year, include_aborts))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/cancellations/trends")
def cancellations_trends():
    region = request.args.get("region")
    try:
        _, _, get_trends, *_ = _get_cancellation_engine()
        return jsonify(get_trends(region))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/cancellations/heatmap")
def cancellations_heatmap():
    year = int(request.args.get("year", 2025))
    try:
        _, _, _, get_heatmap, *_ = _get_cancellation_engine()
        return jsonify(get_heatmap(year))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/cancellations/predict")
def cancellations_predict():
    region = request.args.get("region", "NW")
    try:
        _, _, _, _, predict, _ = _get_cancellation_engine()
        return jsonify(predict(region))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/cancellations/rebooking")
def cancellations_rebooking():
    region = request.args.get("region")
    year   = int(request.args.get("year", 2025))
    try:
        *_, get_rebook = _get_cancellation_engine()
        return jsonify(get_rebook(region, year))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─────────────────────────────────────────────────────────────────────────────
# MODULE 4 — FIELD OPERATIONS & ENGINEER PLANNING
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/field-ops/kpis")
def field_ops_kpis():
    region = request.args.get("region")
    year   = int(request.args.get("year", 2025))
    try:
        get_kpis, *_ = _get_field_ops_engine()
        return jsonify(get_kpis(region, year))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/field-ops/capacity-matrix")
def field_ops_capacity_matrix():
    year = int(request.args.get("year", 2025))
    try:
        _, get_matrix, *_ = _get_field_ops_engine()
        return jsonify(get_matrix(year))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/field-ops/patch-plan")
def field_ops_patch_plan():
    region = request.args.get("region", "NW")
    week   = request.args.get("week")
    year   = int(request.args.get("year", 2025))
    try:
        _, _, get_patch, *_ = _get_field_ops_engine()
        week_int = int(week) if week else None
        return jsonify(get_patch(region, week_int, year))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/field-ops/engineer-performance")
def field_ops_engineer_performance():
    region = request.args.get("region")
    year   = int(request.args.get("year", 2025))
    top_n  = int(request.args.get("top_n", 20))
    try:
        _, _, _, get_perf, *_ = _get_field_ops_engine()
        return jsonify(get_perf(region, year, top_n))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/field-ops/understaffing-forecast")
def field_ops_understaffing():
    region = request.args.get("region", "NW")
    weeks  = int(request.args.get("weeks", 8))
    try:
        _, _, _, _, predict, _ = _get_field_ops_engine()
        return jsonify(predict(region, weeks))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/field-ops/optimise")
def field_ops_optimise():
    year = int(request.args.get("year", 2025))
    try:
        _, _, _, _, _, optimise = _get_field_ops_engine()
        return jsonify(optimise(year))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─────────────────────────────────────────────────────────────────────────────
# MODULE 5 — FINANCIAL SCENARIO PLANNING
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/financial/kpis")
def financial_kpis():
    region = request.args.get("region")
    year   = int(request.args.get("year", 2025))
    try:
        get_kpis, *_ = _get_financial_engine()
        return jsonify(get_kpis(region, year))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/financial/scenario", methods=["POST"])
def financial_scenario():
    """Run a named financial scenario. Accepts JSON body with scenario parameters."""
    try:
        payload = request.get_json(force=True) or {}
        _, run_sc, _, _ = _get_financial_engine()
        result = run_sc(
            scenario_name          = payload.get("scenario_name", "Custom Scenario"),
            job_volume             = int(payload.get("job_volume", 50000)),
            completion_rate_pct    = float(payload.get("completion_rate_pct", 68.0)),
            cancel_rate_pct        = float(payload.get("cancel_rate_pct", 15.0)),
            abort_rate_pct         = float(payload.get("abort_rate_pct", 8.0)),
            revenue_uplift_pct     = float(payload.get("revenue_uplift_pct", 0.0)),
            cost_uplift_pct        = float(payload.get("cost_uplift_pct", 0.0)),
            engineer_count         = int(payload.get("engineer_count", 300)),
            productivity_jobs_per_day= float(payload.get("productivity_jobs_per_day", 4.0)),
            region_code            = payload.get("region_code"),
        )
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/financial/compare-scenarios", methods=["POST"])
def financial_compare():
    """Compare multiple scenarios. Accepts JSON body: {scenarios: [...]}."""
    try:
        payload   = request.get_json(force=True) or {}
        scenarios = payload.get("scenarios", [])
        if not scenarios:
            return jsonify({"error": "No scenarios provided"}), 400
        _, _, compare, _ = _get_financial_engine()
        return jsonify(compare(scenarios))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/financial/forecast-profitability")
def financial_forecast():
    region = request.args.get("region")
    try:
        _, _, _, get_forecast = _get_financial_engine()
        return jsonify(get_forecast(region))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─────────────────────────────────────────────────────────────────────────────
# AI RECOMMENDATIONS
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/ai/recommendations")
def ai_recommendations():
    year        = int(request.args.get("year", 2025))
    max_results = int(request.args.get("max", 20))
    try:
        get_recs, _ = _get_ai_engine()
        return jsonify(get_recs(year, max_results))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/ai/summary")
def ai_summary():
    year = int(request.args.get("year", 2025))
    try:
        _, get_summary = _get_ai_engine()
        return jsonify({"summary": get_summary(year)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/ai/dashboard")
def ai_dashboard():
    year        = int(request.args.get("year", 2025))
    max_results = int(request.args.get("max", 20))
    try:
        get_recs, get_summary = _get_ai_engine()
        recs = get_recs(year, max_results)
        return jsonify({
            "recommendations": recs,
            "summary": get_summary(year, recs),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─────────────────────────────────────────────────────────────────────────────
# SYSTEM / UTILITY
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/health")
def health():
    """Health check endpoint for Render.com and Docker."""
    from engine.ingestion import data_health
    dh = data_health()
    all_ok = all(v["exists"] for v in dh.values())
    return jsonify({
        "status":     "ok" if all_ok else "degraded",
        "data_health":dh,
        "timestamp":  datetime.utcnow().isoformat() + "Z",
        "version":    "1.0.0",
    }), 200 if all_ok else 206


@app.route("/api/data/reload")
def data_reload():
    """Force reload all data caches (useful after data regeneration)."""
    from engine.ingestion import preload_all_data
    counts = preload_all_data(force_reload=True)
    return jsonify({"status": "ok", "message": "All data caches reloaded", "rows": counts})


@app.route("/api/data/generate")
def data_generate():
    """Trigger synthetic data generation (dev/reset use only)."""
    try:
        from engine.data_generator import generate_all
        from engine.ingestion import preload_all_data
        generate_all()
        counts = preload_all_data(force_reload=True)
        return jsonify({"status": "ok", "message": "Datasets regenerated successfully", "rows": counts})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/regions")
def get_regions():
    return jsonify([
        {"code": "NW",  "name": "North West"},
        {"code": "NE",  "name": "North East"},
        {"code": "MID", "name": "Midlands"},
        {"code": "SE",  "name": "South East"},
        {"code": "SW",  "name": "South West"},
        {"code": "WAL", "name": "Wales"},
        {"code": "SCO", "name": "Scotland"},
        {"code": "YRK", "name": "Yorkshire"},
    ])


# ─── Startup: generate data if missing ───────────────────────────────────────
def _ensure_data():
    """Generate synthetic datasets on first run if not present."""
    global _DATA_READY
    if _DATA_READY:
        return

    manifest = BASE_DIR / "data" / "inputs" / "manifest.json"
    if not manifest.exists():
        print("IMSERV: No data found — generating synthetic datasets...")
        try:
            from engine.data_generator import generate_all
            generate_all()
        except Exception as e:
            print(f"IMSERV: Data generation failed: {e}")
    
    print("IMSERV: Pre-loading data caches into memory to ensure fast initial load...")
    try:
        from engine.ingestion import preload_all_data
        counts = preload_all_data()
        print(f"IMSERV: Data caches pre-loaded: {counts}")
        _DATA_READY = True
    except Exception as e:
        print(f"IMSERV: Failed to preload caches: {e}")


# ─────────────────────────────────────────────────────────────────────────────

_ensure_data()

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    debug = os.getenv("FLASK_ENV", "development") == "development"
    print(f"\nIMSERV Platform running on http://localhost:{port}\n")
    app.run(host="0.0.0.0", port=port, debug=debug)
