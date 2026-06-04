"""
IMSERV Smart Meter Appointment Planning & Utility Operations Platform
Flask application — extends DAA-Project architecture patterns.

Modules:
  1. Appointment Journey              — executive funnel dashboard
  2. Contact Centre Forecasting       — multi-model channel forecasting
  3. Appointment Fallout             — root cause + AI prediction
  4. Field Operations & Engineer Planning — scheduling + optimisation
  5. Financial Scenario Planning      — cost/revenue simulation
"""
import os
import json
import threading
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path
from datetime import date, datetime, timedelta

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
SUPPORTED_YEARS = {2025, 2026}

def _request_year(default: int = 2025) -> int:
    """Return a supported dashboard year; stale years fall back to 2025."""
    try:
        year = int(request.args.get("year", default))
    except (TypeError, ValueError):
        return default
    return year if year in SUPPORTED_YEARS else default

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
        get_engineer_performance, predict_understaffing, optimise_workforce_allocation,
        get_capacity_forecast_2026
    )
    return (get_field_ops_kpis, get_region_capacity_matrix, get_patch_level_plan,
            get_engineer_performance, predict_understaffing, optimise_workforce_allocation,
            get_capacity_forecast_2026)

def _get_financial_engine():
    from engine.financial_engine import (
        get_financial_kpis, run_scenario, compare_scenarios, get_forecast_profitability
    )
    return get_financial_kpis, run_scenario, compare_scenarios, get_forecast_profitability

def _get_ai_engine():
    from engine.ai_recommendations import get_all_recommendations, get_natural_language_summary
    return get_all_recommendations, get_natural_language_summary

def _ai_enabled() -> bool:
    return os.getenv("ENABLE_AI_RECOMMENDATIONS", "true").lower() == "true"

def _disabled_ai_payload(max_results: int = 20) -> dict:
    return {
        "recommendations": [],
        "total_count": 0,
        "critical_count": 0,
        "high_count": 0,
        "medium_count": 0,
        "action_required_count": 0,
        "disabled": True,
        "message": "AI recommendations are disabled on this deployment.",
    }

def _compact_chat_messages(messages: list[dict], limit: int = 10) -> list[dict]:
    """Keep a small, safe conversation window for the LLM request."""
    compact = []
    for msg in (messages or [])[-limit:]:
        role = msg.get("role") if isinstance(msg, dict) else ""
        content = msg.get("content") if isinstance(msg, dict) else ""
        if role not in {"user", "assistant"} or not isinstance(content, str):
            continue
        content = content.strip()
        if content:
            compact.append({"role": role, "content": content[:1800]})
    return compact

def _chatbot_context(region: str | None, year: int, view: str | None) -> str:
    """Build a compact app snapshot so the chatbot can answer app-specific questions."""
    lines = [
        "IMSERV Smart Meter Appointment Planning & Utility Operations Platform.",
        "Modules: Appointment Journey, Contact Attempt Forecast, Risk & Recovery, Resource Planning, Scenario Impact.",
        f"Current view: {view or 'unknown'}. Region filter: {region or 'All Regions'}. Year: {year}.",
    ]

    try:
        get_journey, _, to_int_fn, _, safe_pct_fn, _ = _get_ingestion()
        rows = [
            r for r in get_journey()
            if (not region or r.get("region_code") == region)
            
            and r.get("is_forecast", "0") == "0"
        ]
        requests_total = sum(to_int_fn(r.get("total_requests")) for r in rows)
        bookings_total = sum(to_int_fn(r.get("total_bookings")) for r in rows)
        cancellations_total = sum(to_int_fn(r.get("total_cancellations")) for r in rows)
        aborts_total = sum(to_int_fn(r.get("total_aborts")) for r in rows)
        completions_total = sum(to_int_fn(r.get("total_completions")) for r in rows)
        visits_total = max(bookings_total - cancellations_total, 0)
        lines.append(
            "Appointment journey snapshot: "
            f"{requests_total:,} appointments booked, {visits_total:,} total visits, "
            f"{cancellations_total:,} D-1 cancellations, {aborts_total:,} same-day aborts, "
            f"{completions_total:,} executed successfully, "
            f"{safe_pct_fn(completions_total, requests_total):.1f}% success rate."
        )
    except Exception as exc:
        lines.append(f"Appointment journey snapshot unavailable: {exc}")

    try:
        get_kpis, _, _, get_forecast = _get_financial_engine()
        financial = get_kpis(region, 2026)
        forecast = get_forecast(region)
        margin = financial.get("gross_margin_pct")
        revenue = financial.get("total_revenue")
        cost = financial.get("total_cost")
        if revenue is not None and cost is not None:
            lines.append(
                "Financial snapshot: "
                f"GBP {float(revenue):,.0f} revenue, GBP {float(cost):,.0f} cost"
                + (f", {float(margin):.1f}% gross margin." if margin is not None else ".")
            )
        if forecast and isinstance(forecast, dict):
            lines.append("Scenario planning uses appointments booked, success rate, D-1 cancellation rate, same-day abort rate, revenue uplift, cost change, and engineer count.")
    except Exception as exc:
        lines.append(f"Financial snapshot unavailable: {exc}")

    try:
        get_kpis, _, _, _, _, _, _ = _get_field_ops_engine()
        ops = get_kpis(region, 2026)
        if ops:
            engineers = ops.get("total_engineers") or ops.get("engineers")
            utilisation = ops.get("avg_utilisation") or ops.get("avg_utilisation_pct")
            completed = ops.get("jobs_completed") or ops.get("total_jobs_completed")
            lines.append(
                "Resource snapshot: "
                f"{engineers if engineers is not None else 'unknown'} engineers, "
                f"{completed if completed is not None else 'unknown'} executed appointments, "
                f"{utilisation if utilisation is not None else 'unknown'} average utilisation."
            )
    except Exception as exc:
        lines.append(f"Resource snapshot unavailable: {exc}")

    try:
        if _ai_enabled():
            get_recs, get_summary = _get_ai_engine()
            recs = get_recs(year, 5)
            summary = get_summary(year, recs)
            lines.append(f"Operational AI summary: {summary}")
    except Exception:
        pass

    return "\n".join(lines)[:5000]

def _huggingface_chat(messages: list[dict]) -> str:
    token = (
        os.getenv("HF_TOKEN")
        or os.getenv("HF_API_KEY")
        or os.getenv("HUGGINGFACE_API_TOKEN")
        or os.getenv("HUGGINGFACEHUB_API_TOKEN")
    )
    if not token:
        raise RuntimeError("Missing HF_TOKEN, HF_API_KEY, or HUGGINGFACE_API_TOKEN on the Flask server.")

    base_url = os.getenv("HF_CHAT_BASE_URL") or os.getenv("HUGGINGFACE_CHAT_BASE_URL") or "https://router.huggingface.co/v1"
    endpoint = os.getenv("HF_CHAT_ENDPOINT") or os.getenv("HUGGINGFACE_CHAT_ENDPOINT") or f"{base_url.rstrip('/')}/chat/completions"
    provider = os.getenv("HF_CHAT_PROVIDER") or os.getenv("HUGGINGFACE_CHAT_PROVIDER")
    if not provider and token.startswith("sk_"):
        provider = "novita"
    model = os.getenv("HF_CHAT_MODEL") or os.getenv("HUGGINGFACE_CHAT_MODEL") or "google/gemma-4-31B-it"
    timeout = float(os.getenv("HF_CHAT_TIMEOUT_SECONDS", "45"))
    max_tokens = int(os.getenv("HF_CHAT_MAX_TOKENS", "450"))
    temperature = float(os.getenv("HF_CHAT_TEMPERATURE", "0.35"))

    if provider:
        try:
            from huggingface_hub import InferenceClient
        except ImportError as exc:
            raise RuntimeError("Install huggingface_hub from requirements.txt to use HF_CHAT_PROVIDER.") from exc

        client = InferenceClient(
            provider=provider,
            api_key=token,
            timeout=timeout,
        )
        try:
            completion = client.chat.completions.create(
                model=model,
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature,
            )
        except Exception as exc:
            detail = str(exc)
            if "401" in detail or "Unauthorized" in detail:
                raise RuntimeError(
                    "Hugging Face/Novita rejected the API key. Check that HF_TOKEN contains the full active key, "
                    "that HF_CHAT_PROVIDER matches the key provider, and restart Flask after editing .env."
                ) from exc
            raise RuntimeError(f"Hugging Face provider request failed: {exc}") from exc
        content = completion.choices[0].message.content if completion.choices else None
        if content:
            return str(content).strip()
        raise RuntimeError("Hugging Face provider response did not include assistant content.")

    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": False,
    }
    req = urllib.request.Request(
        endpoint,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        raise RuntimeError(f"Hugging Face endpoint returned HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Could not reach Hugging Face endpoint: {exc.reason}") from exc

    data = json.loads(raw)
    choices = data.get("choices") or []
    if choices:
        message = choices[0].get("message") or {}
        content = message.get("content") or choices[0].get("text")
        if content:
            return content.strip()
    if data.get("generated_text"):
        return str(data["generated_text"]).strip()
    raise RuntimeError("Hugging Face response did not include assistant content.")

def _get_ingestion():
    from engine.ingestion import get_booking_journey, data_health, to_int, to_float, safe_pct, iter_jobs
    return get_booking_journey, data_health, to_int, to_float, safe_pct, iter_jobs


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
    year   = _request_year()
    try:
        get_journey, _, to_int_fn, to_float_fn, safe_pct_fn, iter_jobs_fn = _get_ingestion()
        rows = get_journey()
        if region:
            rows = [r for r in rows if r["region_code"] == region]
        rows = [r for r in rows if r.get("is_forecast", "0") == "0"]

        total_requests      = sum(to_int_fn(r["total_requests"])      for r in rows)
        total_contacts      = sum(to_int_fn(r["total_contacts"])       for r in rows)
        total_bookings      = sum(to_int_fn(r["total_bookings"])       for r in rows)
        total_cancellations = sum(to_int_fn(r["total_cancellations"])  for r in rows)
        total_aborts        = sum(to_int_fn(r["total_aborts"])         for r in rows)
        total_completions   = sum(to_int_fn(r["total_completions"])    for r in rows)
        total_visits        = max(total_bookings - total_cancellations, 0)
        total_after_aborts  = max(total_visits - total_aborts, 0)
        total_not_completed = max(total_after_aborts - total_completions, 0)
        avg_contacts        = round(total_contacts / max(total_requests, 1), 2)
        completion_rate     = safe_pct_fn(total_completions, total_requests)
        reason_labels = {
            "EXCHANGE": "Exchange still booked",
            "NEW_INSTALL": "Install still booked",
            "REPAIR": "Repair follow-up booked",
            "REMOVAL": "Removal still booked",
        }
        not_completed_reasons = Counter()
        for job in iter_jobs_fn():
            if region and job.get("region_code") != region:
                continue
            if job.get("is_forecast", "0") != "0":
                continue
            if job.get("status") == "Booked":
                not_completed_reasons[job.get("job_type") or "Other"] += 1

        reason_breakdown = [
            {
                "reason": reason_labels.get(reason, reason.replace("_", " ").title()),
                "count": count,
                "pct": safe_pct_fn(count, total_not_completed),
            }
            for reason, count in not_completed_reasons.most_common()
        ]
        reason_total = sum(item["count"] for item in reason_breakdown)
        if total_not_completed > reason_total:
            reason_breakdown.append({
                "reason": "Other still booked",
                "count": total_not_completed - reason_total,
                "pct": safe_pct_fn(total_not_completed - reason_total, total_not_completed),
            })

        return jsonify({
            "unique_customers":       total_requests,
            "total_requests":        total_requests,
            "total_contacts":        total_contacts,
            "avg_contacts_per_customer": avg_contacts,
            "total_bookings":        total_bookings,
            "total_visits":          total_visits,
            "total_cancellations":   total_cancellations,
            "total_aborts":          total_aborts,
            "total_post_abort_visits": total_after_aborts,
            "total_not_completed_after_successful_visit": total_not_completed,
            "total_completions":     total_completions,
            "not_completed_reasons": reason_breakdown,
            "completion_rate":       completion_rate,
            "booking_rate":          safe_pct_fn(total_bookings, total_requests),
            "visit_rate":            safe_pct_fn(total_visits, total_requests),
            "post_abort_rate":       safe_pct_fn(total_after_aborts, total_requests),
            "visit_success_rate":    safe_pct_fn(total_completions, total_visits),
            "cancellation_rate":     safe_pct_fn(total_cancellations, total_bookings),
            "abort_rate":            safe_pct_fn(total_aborts, total_bookings - total_cancellations),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/journey/weekly-trend")
def journey_weekly_trend():
    """Weekly completion rate trend for line chart."""
    region = request.args.get("region")
    year   = _request_year()
    try:
        get_journey, _, to_int_fn, to_float_fn, _, _ = _get_ingestion()
        rows = get_journey()
        if region:
            rows = [r for r in rows if r["region_code"] == region]
        rows = [r for r in rows if r.get("is_forecast", "0") == "0"]
        rows = sorted(rows, key=lambda x: x.get("week_start", ""))

        weekly = {}
        for r in rows:
            wk = r.get("week_start", "")[:10]
            if wk not in weekly:
                weekly[wk] = {"requests": 0, "bookings": 0, "visits": 0, "completions": 0, "cancellations": 0, "aborts": 0}
            bookings = to_int_fn(r["total_bookings"])
            cancellations = to_int_fn(r["total_cancellations"])
            weekly[wk]["requests"]     += to_int_fn(r["total_requests"])
            weekly[wk]["bookings"]     += bookings
            weekly[wk]["visits"]       += max(bookings - cancellations, 0)
            weekly[wk]["completions"]  += to_int_fn(r["total_completions"])
            weekly[wk]["cancellations"]+= cancellations
            weekly[wk]["aborts"]       += to_int_fn(r["total_aborts"])

        labels, requests, bookings, visits, completions, cancellations, aborts = [], [], [], [], [], [], []
        for wk in sorted(weekly.keys()):
            d = weekly[wk]
            labels.append(wk)
            requests.append(d["requests"])
            bookings.append(d["bookings"])
            visits.append(d["visits"])
            completions.append(d["completions"])
            cancellations.append(d["cancellations"])
            aborts.append(d["aborts"])

        return jsonify({
            "labels":        labels,
            "requests":      requests,
            "bookings":      bookings,
            "visits":        visits,
            "completions":   completions,
            "cancellations": cancellations,
            "aborts":        aborts,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/journey/suppliers")
def journey_suppliers():
    """Supplier-level contribution and behaviour analytics for the journey tab."""
    region = request.args.get("region")
    year = _request_year()
    top_n = int(request.args.get("top_n", 18))
    try:
        _, _, to_int_fn, _, safe_pct_fn, iter_jobs_fn = _get_ingestion()
        by_supplier = {}
        totals = {
            "requests": 0,
            "contacts": 0,
            "bookings": 0,
            "visits": 0,
            "completions": 0,
            "cancellations": 0,
            "aborts": 0,
            "unbooked": 0,
            "unresolved": 0,
        }

        for job in iter_jobs_fn():
            if region and job.get("region_code") != region:
                continue
            if job.get("is_forecast", "0") != "0":
                continue

            supplier = (job.get("supplier_name") or "Unassigned Supplier").strip()
            bucket = by_supplier.setdefault(supplier, {
                "supplier_name": supplier,
                "requests": 0,
                "contacts": 0,
                "bookings": 0,
                "visits": 0,
                "completions": 0,
                "cancellations": 0,
                "aborts": 0,
                "unbooked": 0,
                "unresolved": 0,
                "channels": Counter(),
                "job_types": Counter(),
            })

            status = job.get("status")
            booked = bool(job.get("booked_date"))
            cancelled = status == "Cancelled"
            aborted = status == "Aborted"
            completed = status == "Completed"
            unresolved = status == "Booked"
            unbooked = not booked and status == "Unbooked"
            visits = 1 if booked and not cancelled else 0
            contacts = to_int_fn(job.get("contacts_count"))

            bucket["requests"] += 1
            bucket["contacts"] += contacts
            bucket["bookings"] += 1 if booked else 0
            bucket["visits"] += visits
            bucket["completions"] += 1 if completed else 0
            bucket["cancellations"] += 1 if cancelled else 0
            bucket["aborts"] += 1 if aborted else 0
            bucket["unbooked"] += 1 if unbooked else 0
            bucket["unresolved"] += 1 if unresolved else 0
            bucket["channels"][job.get("primary_channel") or "Unknown"] += 1
            bucket["job_types"][job.get("job_type") or "Other"] += 1

            totals["requests"] += 1
            totals["contacts"] += contacts
            totals["bookings"] += 1 if booked else 0
            totals["visits"] += visits
            totals["completions"] += 1 if completed else 0
            totals["cancellations"] += 1 if cancelled else 0
            totals["aborts"] += 1 if aborted else 0
            totals["unbooked"] += 1 if unbooked else 0
            totals["unresolved"] += 1 if unresolved else 0

        suppliers = []
        for item in by_supplier.values():
            fallout = item["cancellations"] + item["aborts"] + item["unresolved"]
            booking_rate = safe_pct_fn(item["bookings"], item["requests"])
            visit_success_rate = safe_pct_fn(item["completions"], item["visits"])
            fallout_rate = safe_pct_fn(fallout, item["bookings"])
            contribution_pct = round(item["requests"] / max(totals["requests"], 1) * 100, 2)
            behaviour_score = round(
                (booking_rate * 0.25) + (visit_success_rate * 0.55) - (fallout_rate * 0.20),
                1,
            )

            suppliers.append({
                "supplier_name": item["supplier_name"],
                "requests": item["requests"],
                "contacts": item["contacts"],
                "bookings": item["bookings"],
                "visits": item["visits"],
                "completions": item["completions"],
                "cancellations": item["cancellations"],
                "aborts": item["aborts"],
                "unbooked": item["unbooked"],
                "unresolved": item["unresolved"],
                "contribution_pct": contribution_pct,
                "booking_rate": booking_rate,
                "visit_success_rate": visit_success_rate,
                "fallout_rate": fallout_rate,
                "behaviour_score": behaviour_score,
                "dominant_channel": item["channels"].most_common(1)[0][0] if item["channels"] else "Unknown",
                "dominant_job_type": item["job_types"].most_common(1)[0][0] if item["job_types"] else "Other",
                "segment": "",
            })

        if suppliers:
            avg_score = sum(s["behaviour_score"] for s in suppliers) / len(suppliers)
            sorted_requests = sorted(s["requests"] for s in suppliers)
            median_requests = sorted_requests[len(sorted_requests) // 2]
            for supplier in suppliers:
                high_contribution = supplier["requests"] >= median_requests
                strong_behaviour = supplier["behaviour_score"] >= avg_score
                if high_contribution and strong_behaviour:
                    supplier["segment"] = "Scale and stable"
                elif high_contribution:
                    supplier["segment"] = "High-volume watch"
                elif strong_behaviour:
                    supplier["segment"] = "Efficient niche"
                else:
                    supplier["segment"] = "Needs attention"

        suppliers.sort(key=lambda r: (r["requests"], r["behaviour_score"]), reverse=True)
        leaders = sorted(suppliers, key=lambda r: r["visit_success_rate"], reverse=True)[:5]
        watchlist = sorted(suppliers, key=lambda r: (r["fallout_rate"], r["requests"]), reverse=True)[:5]
        total_fallout = totals["cancellations"] + totals["aborts"] + totals["unresolved"]

        top_limit = max(top_n, 1)
        top_suppliers = suppliers[:top_limit]
        tail_suppliers = suppliers[top_limit:]

        if tail_suppliers:
            others = {
                "supplier_name": "Others",
                "requests": sum(s["requests"] for s in tail_suppliers),
                "contacts": sum(s["contacts"] for s in tail_suppliers),
                "bookings": sum(s["bookings"] for s in tail_suppliers),
                "visits": sum(s["visits"] for s in tail_suppliers),
                "completions": sum(s["completions"] for s in tail_suppliers),
                "cancellations": sum(s["cancellations"] for s in tail_suppliers),
                "aborts": sum(s["aborts"] for s in tail_suppliers),
                "unbooked": sum(s["unbooked"] for s in tail_suppliers),
                "unresolved": sum(s["unresolved"] for s in tail_suppliers),
            }
            fallout = others["cancellations"] + others["aborts"] + others["unresolved"]
            others["booking_rate"] = safe_pct_fn(others["bookings"], others["requests"])
            others["visit_success_rate"] = safe_pct_fn(others["completions"], others["visits"])
            others["fallout_rate"] = safe_pct_fn(fallout, others["bookings"])
            others["contribution_pct"] = round(others["requests"] / max(totals["requests"], 1) * 100, 2)
            others["behaviour_score"] = round(
                (others["booking_rate"] * 0.25) + (others["visit_success_rate"] * 0.55) - (others["fallout_rate"] * 0.20), 1
            )
            top_suppliers.append(others)

        return jsonify({
            "suppliers": top_suppliers,
            "leaderboard": leaders,
            "watchlist": watchlist,
            "totals": {
                **totals,
                "fallout": total_fallout,
                "booking_rate": safe_pct_fn(totals["bookings"], totals["requests"]),
                "visit_success_rate": safe_pct_fn(totals["completions"], totals["visits"]),
                "fallout_rate": safe_pct_fn(total_fallout, totals["bookings"]),
                "behaviour_score": round(
                    (safe_pct_fn(totals["bookings"], totals["requests"]) * 0.25) +
                    (safe_pct_fn(totals["completions"], totals["visits"]) * 0.55) -
                    (safe_pct_fn(total_fallout, totals["bookings"]) * 0.20),
                    1
                )
            },
            "supplier_count": len(suppliers)
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/journey/regional-heatmap")
def journey_regional_heatmap():
    """Regional completion rate heatmap data."""
    year = _request_year()
    try:
        get_journey, _, to_int_fn, to_float_fn, safe_pct_fn, _ = _get_ingestion()
        rows = get_journey()
        rows = [r for r in rows if r.get("is_forecast", "0") == "0"]

        by_region = {}
        for r in rows:
            rc = r["region_code"]
            if rc not in by_region:
                by_region[rc] = {"requests": 0, "bookings": 0, "completions": 0, "cancellations": 0, "aborts": 0, "region_name": r.get("region_name", rc)}
            by_region[rc]["requests"]     += to_int_fn(r["total_requests"])
            by_region[rc]["bookings"]     += to_int_fn(r["total_bookings"])
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
                "bookings":       d["bookings"],
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


@app.route("/api/journey/interactions")
def journey_interactions():
    """Customer interaction source/type mapping for journey analytics."""
    region = request.args.get("region")
    year   = _request_year()
    try:
        from engine.forecasting_engine import get_customer_interaction_map
        return jsonify(get_customer_interaction_map(region, year))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/journey/decomposition-tree")
def journey_decomposition_tree():
    """Build the appointment journey decomposition tree data."""
    region = request.args.get("region")
    year = _request_year()
    try:
        from engine.forecasting_engine import get_decomposition_tree
        return jsonify(get_decomposition_tree(region, year))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─────────────────────────────────────────────────────────────────────────────
# MODULE 2 — CONTACT CENTRE FORECASTING
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/forecasting/channel-kpis")
def forecasting_channel_kpis():
    region = request.args.get("region")
    year   = _request_year()
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
    year   = _request_year()
    try:
        _, _, get_funnel = _get_forecasting_engine()
        return jsonify(get_funnel(region, year))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─────────────────────────────────────────────────────────────────────────────
@app.route("/api/forecasting/planning-target-kpis")
def forecasting_planning_target_kpis():
    region = request.args.get("region")
    year = _request_year()
    try:
        from engine.forecasting_engine import get_planning_target_kpis
        return jsonify(get_planning_target_kpis(region, year))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# MODULE 3 — APPOINTMENT FALLOUT
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/cancellations/kpis")
def cancellations_kpis():
    region = request.args.get("region")
    year   = _request_year()
    try:
        get_kpis, *_ = _get_cancellation_engine()
        return jsonify(get_kpis(region, year))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/cancellations/root-causes")
def cancellations_root_causes():
    region        = request.args.get("region")
    year          = _request_year()
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
    year = _request_year()
    try:
        _, _, _, get_heatmap, *_ = _get_cancellation_engine()
        return jsonify(get_heatmap(year))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/cancellations/predict")
def cancellations_predict():
    region = request.args.get("region") or None
    try:
        _, _, _, _, predict, _ = _get_cancellation_engine()
        return jsonify(predict(region))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/cancellations/rebooking")
def cancellations_rebooking():
    region = request.args.get("region")
    year   = _request_year()
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
    year   = _request_year()
    try:
        get_kpis, *_ = _get_field_ops_engine()
        return jsonify(get_kpis(region, year))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/field-ops/capacity-matrix")
def field_ops_capacity_matrix():
    year = _request_year()
    try:
        _, get_matrix, *_ = _get_field_ops_engine()
        return jsonify(get_matrix(year))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/field-ops/patch-plan")
def field_ops_patch_plan():
    region = request.args.get("region", "NW")
    week   = request.args.get("week")
    year   = _request_year()
    try:
        _, _, get_patch, *_ = _get_field_ops_engine()
        week_int = int(week) if week else None
        return jsonify(get_patch(region, week_int, year))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/field-ops/engineer-performance")
def field_ops_engineer_performance():
    region = request.args.get("region")
    year   = _request_year()
    top_n  = int(request.args.get("top_n", 20))
    try:
        _, _, _, get_perf, *_ = _get_field_ops_engine()
        return jsonify(get_perf(region, year, top_n))
    except Exception as e:
        return jsonify({"error": str(e)}), 500



@app.route("/api/field-ops/capacity-forecast")
def field_ops_capacity_forecast():
    region = request.args.get("region")
    try:
        *_, forecast = _get_field_ops_engine()
        return jsonify(forecast(
            region_code=region,
            target_utilisation_pct=request.args.get("target", 78),
            jobs_per_fte_day=request.args.get("jobs_per_fte_day", 4),
            absence_rate_pct=request.args.get("absence_rate"),
        ))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/field-ops/optimise")
def field_ops_optimise():
    year = _request_year(default=2026)
    try:
        _, _, _, _, _, optimise, *_ = _get_field_ops_engine()
        return jsonify(optimise(
            year=year,
            target_utilisation_pct=request.args.get("target", 72),
            jobs_per_fte_day=request.args.get("jobs_per_fte_day", 4),
            absence_rate_pct=request.args.get("absence_rate", 15),
        ))
    except Exception as e:
        return jsonify({"error": str(e)}), 500




# ─────────────────────────────────────────────────────────────────────────────
# MODULE 5 — FINANCIAL SCENARIO PLANNING
# ─────────────────────────────────────────────────────────────────────────────

@app.route("/api/financial/kpis")
def financial_kpis():
    region = request.args.get("region")
    year   = _request_year()
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
    year        = _request_year()
    max_results = int(request.args.get("max", 20))
    try:
        if not _ai_enabled():
            return jsonify(_disabled_ai_payload(max_results))
        get_recs, _ = _get_ai_engine()
        return jsonify(get_recs(year, max_results))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/ai/summary")
def ai_summary():
    year = _request_year()
    try:
        if not _ai_enabled():
            return jsonify({"summary": "AI recommendations are disabled on this deployment."})
        _, get_summary = _get_ai_engine()
        return jsonify({"summary": get_summary(year)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/ai/dashboard")
def ai_dashboard():
    year        = _request_year()
    max_results = int(request.args.get("max", 20))
    try:
        if not _ai_enabled():
            recs = _disabled_ai_payload(max_results)
            return jsonify({
                "recommendations": recs,
                "summary": recs["message"],
            })
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

@app.route("/api/chatbot/message", methods=["POST"])
def chatbot_message():
    """Proxy chatbot conversations to a Hugging Face OpenAI-compatible LLM endpoint."""
    try:
        payload = request.get_json(force=True) or {}
        user_messages = _compact_chat_messages(payload.get("messages", []))
        if not user_messages or user_messages[-1]["role"] != "user":
            return jsonify({"error": "Send at least one user message."}), 400

        region = payload.get("region") or request.args.get("region") or None
        view = payload.get("view") or request.args.get("view") or None
        try:
            year = int(payload.get("year") or request.args.get("year") or 2025)
        except (TypeError, ValueError):
            year = 2025
        if year not in SUPPORTED_YEARS:
            year = 2025

        context = _chatbot_context(region, year, view)
        system_prompt = (
            "You are the IMSERV app assistant. Help users understand and use this smart meter "
            "operations dashboard. Be concise, practical, and app-specific. Use the provided "
            "snapshot for numbers. If a user asks for a metric not in the snapshot, say where "
            "in the app they can inspect it instead of inventing values.\n\n"
            f"App snapshot:\n{context}"
        )
        messages = [{"role": "system", "content": system_prompt}] + user_messages
        answer = _huggingface_chat(messages)
        return jsonify({"reply": answer})
    except RuntimeError as exc:
        return jsonify({
            "error": str(exc),
            "config_required": "Set HF_TOKEN or HF_API_KEY, plus HF_CHAT_MODEL. Set HF_CHAT_PROVIDER=novita for provider-based Hugging Face examples.",
        }), 502
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


@app.route("/api/chatbot/config")
def chatbot_config():
    """Return non-secret chatbot configuration for deployment diagnostics."""
    token = (
        os.getenv("HF_TOKEN")
        or os.getenv("HF_API_KEY")
        or os.getenv("HUGGINGFACE_API_TOKEN")
        or os.getenv("HUGGINGFACEHUB_API_TOKEN")
        or ""
    )
    provider = os.getenv("HF_CHAT_PROVIDER") or os.getenv("HUGGINGFACE_CHAT_PROVIDER")
    inferred_provider = provider or ("novita" if token.startswith("sk_") else "")
    return jsonify({
        "has_token": bool(token),
        "token_prefix": token[:3] if token else "",
        "token_length": len(token),
        "provider": provider or "",
        "effective_provider": inferred_provider,
        "model": os.getenv("HF_CHAT_MODEL") or os.getenv("HUGGINGFACE_CHAT_MODEL") or "google/gemma-4-31B-it",
        "base_url": os.getenv("HF_CHAT_BASE_URL") or os.getenv("HUGGINGFACE_CHAT_BASE_URL") or "https://router.huggingface.co/v1",
        "endpoint_set": bool(os.getenv("HF_CHAT_ENDPOINT") or os.getenv("HUGGINGFACE_CHAT_ENDPOINT")),
    })


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
    """Clear in-memory data caches so the next request reloads only what it needs."""
    from engine.ingestion import clear_data_caches
    from engine.forecasting_engine import clear_forecast_cache
    health_info = clear_data_caches()
    clear_forecast_cache()
    _clear_timeslot_cache()
    return jsonify({"status": "ok", "message": "Data caches cleared", "data_health": health_info})


@app.route("/api/data/generate")
def data_generate():
    """Trigger synthetic data generation (dev/reset use only)."""
    try:
        if os.getenv("RENDER") and os.getenv("IMSERV_ENABLE_DATA_GENERATE", "").lower() != "true":
            return jsonify({
                "error": "Dataset generation is disabled on Render to stay within memory limits.",
                "hint": "Set IMSERV_ENABLE_DATA_GENERATE=true only for a one-off maintenance run.",
            }), 403
        from engine.data_generator import generate_all
        from engine.ingestion import clear_data_caches
        from engine.forecasting_engine import clear_forecast_cache
        generate_all()
        health_info = clear_data_caches()
        clear_forecast_cache()
        _clear_timeslot_cache()
        return jsonify({"status": "ok", "message": "Datasets regenerated successfully", "data_health": health_info})
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


# ─── Time-Slot Analysis helpers ──────────────────────────────────────────────

import hashlib as _hashlib

_BIZ_CATEGORIES = [
    "Property & Real Estate", "Food & Beverage", "Transport & Automotive",
    "Utilities & Energy", "Community & Non-Profit", "Retail", "Agriculture",
    "Personal Services", "Healthcare & Medical", "Construction & Manufacturing",
    "Education", "Financial Services", "Hospitality & Tourism", "Public Sector",
    "Technology & Electronics", "Logistics & Delivery", "Entertainment & Leisure",
    "General Business", "Uncategorised",
]

_VOICE_AGENTS = [
    "Sarah Mitchell", "James Anderson", "Emma Wilson", "Daniel Thompson",
    "Olivia Clarke", "Matthew Evans", "Sophie Turner", "Ryan Walker",
    "Charlotte Hill", "Benjamin Harris", "Grace Roberts", "Luke Martin",
    "Hannah Baker", "Jack Phillips", "Ava Wright", "Thomas Campbell",
    "Mia Lewis", "Samuel Johnson", "Isla Taylor", "Jake Moore",
    "Amelia Scott", "Ethan White", "Lucy Brown", "Noah Davies",
    "Zoe Hall", "Callum Green", "Freya Adams", "Connor King",
    "Ellie Wood", "Liam Hughes",
]

def _job_hash(job_ref: str, salt: str) -> int:
    """Stable hash of job_ref with a salt so different dimensions are independent."""
    return int(_hashlib.md5((job_ref + salt).encode()).hexdigest()[:8], 16)

def _job_time_slot(job_ref: str) -> str:
    """Deterministic time slot from job_ref hash (no time-of-day in source data)."""
    h = _job_hash(job_ref, "ts") % 10
    if h < 4: return "Morning"    # 08:00–12:00  ~40 %
    if h < 8: return "Afternoon"  # 12:00–17:00  ~40 %
    return "Evening"              # 17:00–21:00  ~20 %

def _job_biz_category(job_ref: str) -> str:
    """Deterministic business category from job_ref hash."""
    return _BIZ_CATEGORIES[_job_hash(job_ref, "bc") % len(_BIZ_CATEGORIES)]

def _job_voice_agent(job_ref: str) -> str:
    """Deterministic voice agent from job_ref hash."""
    return _VOICE_AGENTS[_job_hash(job_ref, "va") % len(_VOICE_AGENTS)]

SLOTS = ["Morning", "Afternoon", "Evening"]
DAYS  = ["Mon", "Tue", "Wed", "Thu", "Fri"]

_TIMESLOT_CACHE = {}
_TIMESLOT_CACHE_LOCK = threading.RLock()
_TIMESLOT_CACHE_MAX = 32

def _timeslot_source_signature() -> tuple:
    """Return a compact signature for invalidating derived time-slot analytics."""
    master = BASE_DIR / "data" / "inputs" / "master_operations.csv"
    path = master if master.exists() else BASE_DIR / "data" / "inputs" / "smart_meter_jobs.csv"
    try:
        stat = path.stat()
        return (str(path), stat.st_mtime_ns, stat.st_size)
    except OSError:
        return (str(path), 0, 0)

def _clear_timeslot_cache() -> None:
    with _TIMESLOT_CACHE_LOCK:
        _TIMESLOT_CACHE.clear()

def _parse_ts_date(value: str):
    try:
        return date.fromisoformat(str(value or "")[:10])
    except (TypeError, ValueError):
        return None

def _ts_filter(requested_date: str, ftype: str, fval: str) -> bool:
    """Return True when the job falls within the requested rolling time window."""
    return _ts_filter_date(_parse_ts_date(requested_date), ftype, fval)

def _ts_filter_date(requested_date, ftype: str, fval: str) -> bool:
    if not requested_date:
        return False
    if not ftype or ftype == "all" or not fval:
        return True
    try:
        if ftype == "month":
            if "-" in str(fval):
                year, month = str(fval).split("-", 1)
                return requested_date.year == int(year) and requested_date.month == int(month)
            return requested_date.month == int(fval)
        if ftype == "week":
            if "-" in str(fval):
                week_start = date.fromisoformat(str(fval)[:10])
                return week_start <= requested_date <= week_start + timedelta(days=6)
            return requested_date.isocalendar()[1] == int(fval)
        if ftype == "day":
            return requested_date == date.fromisoformat(str(fval)[:10])
    except Exception:
        return True
    return True

def _fmt_ts_channel(data: dict, safe_pct_fn) -> dict:
    result = {}
    for slot, channels in data.items():
        result[slot] = []
        for ch, d in sorted(channels.items(), key=lambda x: -x[1]["attempts"]):
            result[slot].append({
                "channel": ch,
                "attempts": d["attempts"],
                "bookings": d["bookings"],
                "booking_rate": safe_pct_fn(d["bookings"], d["attempts"]),
            })
    return result

def _fmt_ts_business(store: dict, safe_pct_fn) -> dict:
    out = {}
    for key, types in store.items():
        rows = []
        for bt, d in sorted(types.items(), key=lambda x: -x[1]["attempts"]):
            rows.append({
                "type": bt,
                "attempts": d["attempts"],
                "bookings": d["bookings"],
                "completions": d["completions"],
                "booking_rate": safe_pct_fn(d["bookings"], d["attempts"]),
                "success_rate": safe_pct_fn(d["completions"], d["bookings"]),
            })
        out[key] = rows
    return out

def _fmt_ts_attempts(data: dict, safe_pct_fn) -> dict:
    return {
        slot: {
            "attempts": d["attempts"],
            "contacts": d["contacts"],
            "bookings": d["bookings"],
            "booking_rate": safe_pct_fn(d["bookings"], d["attempts"]),
            "contact_rate": safe_pct_fn(d["contacts"], d["attempts"]),
        }
        for slot, d in data.items()
    }

def _fmt_ts_agents(agents: dict, safe_pct_fn) -> dict:
    ranked = sorted(
        agents.items(),
        key=lambda x: -sum(x[1][s]["attempts"] for s in SLOTS),
    )
    result = {s: [] for s in SLOTS}
    for agent, slotdata in ranked:
        for slot in SLOTS:
            d = slotdata[slot]
            result[slot].append({
                "agent": agent,
                "attempts": d["attempts"],
                "bookings": d["bookings"],
                "booking_rate": safe_pct_fn(d["bookings"], d["attempts"]),
            })
    for slot in SLOTS:
        result[slot].sort(key=lambda x: -x["attempts"])
    return result

def _get_timeslot_dashboard_data(region: str | None, ftype: str, fval: str) -> dict:
    region_key = region or ""
    ftype = ftype or "all"
    fval = fval or ""
    cache_key = (_timeslot_source_signature(), region_key, ftype, fval)
    with _TIMESLOT_CACHE_LOCK:
        cached = _TIMESLOT_CACHE.get(cache_key)
        if cached is not None:
            return cached

    _, _, to_int_fn, _, safe_pct_fn, iter_jobs_fn = _get_ingestion()
    channel_data = {s: {} for s in SLOTS}
    by_slot = {s: {} for s in SLOTS}
    by_day = {d: {} for d in DAYS}
    attempts = {s: {"attempts": 0, "contacts": 0, "bookings": 0} for s in SLOTS}
    agents = {
        name: {s: {"attempts": 0, "bookings": 0} for s in SLOTS}
        for name in _VOICE_AGENTS
    }

    for job in iter_jobs_fn():
        if job.get("is_forecast", "0") != "0":
            continue
        if region and job.get("region_code") != region:
            continue

        requested = _parse_ts_date(job.get("requested_date", ""))
        if not _ts_filter_date(requested, ftype, fval):
            continue

        job_ref = job.get("job_ref", "")
        slot = _job_time_slot(job_ref)
        booked = bool(job.get("booked_date"))

        channel = job.get("primary_channel") or "Unknown"
        channel_bucket = channel_data[slot].setdefault(channel, {"attempts": 0, "bookings": 0})
        channel_bucket["attempts"] += 1
        if booked:
            channel_bucket["bookings"] += 1

        btype = _job_biz_category(job_ref)
        complete = job.get("status") == "Completed"
        dow = requested.strftime("%a") if requested else None
        for store, key in ((by_slot, slot), (by_day, dow)):
            if key not in store:
                continue
            bucket = store[key].setdefault(btype, {"attempts": 0, "bookings": 0, "completions": 0})
            bucket["attempts"] += 1
            if booked:
                bucket["bookings"] += 1
            if complete:
                bucket["completions"] += 1

        contacts = to_int_fn(job.get("contacts_count"))
        attempts[slot]["attempts"] += 1
        attempts[slot]["contacts"] += contacts
        if booked:
            attempts[slot]["bookings"] += 1

        agent = _job_voice_agent(job_ref)
        agents[agent][slot]["attempts"] += 1
        if booked:
            agents[agent][slot]["bookings"] += 1

    result = {
        "channel_booking": _fmt_ts_channel(channel_data, safe_pct_fn),
        "business_type": {
            "by_slot": _fmt_ts_business(by_slot, safe_pct_fn),
            "by_day": _fmt_ts_business(by_day, safe_pct_fn),
        },
        "attempts_overview": _fmt_ts_attempts(attempts, safe_pct_fn),
        "agent_view": _fmt_ts_agents(agents, safe_pct_fn),
    }

    with _TIMESLOT_CACHE_LOCK:
        if len(_TIMESLOT_CACHE) >= _TIMESLOT_CACHE_MAX:
            _TIMESLOT_CACHE.clear()
        _TIMESLOT_CACHE[cache_key] = result
    return result

@app.route("/api/timeslot/dashboard")
def ts_dashboard():
    """Combined time-slot dashboard payload computed in one CSV pass."""
    try:
        region = request.args.get("region")
        ftype = request.args.get("filter_type", "all")
        fval = request.args.get("filter_value", "")
        return jsonify(_get_timeslot_dashboard_data(region, ftype, fval))
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/timeslot/channel-booking")
def ts_channel_booking():
    """Channel level booking attempts and conversion by time slot."""
    try:
        region  = request.args.get("region")
        ftype   = request.args.get("filter_type", "all")
        fval    = request.args.get("filter_value", "")
        return jsonify(_get_timeslot_dashboard_data(region, ftype, fval)["channel_booking"])
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/timeslot/business-type")
def ts_business_type():
    """Job-type booking and success rates by time slot and by weekday."""
    try:
        region = request.args.get("region")
        ftype  = request.args.get("filter_type", "all")
        fval   = request.args.get("filter_value", "")
        return jsonify(_get_timeslot_dashboard_data(region, ftype, fval)["business_type"])
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/timeslot/attempts-overview")
def ts_attempts_overview():
    """Total contact attempts vs bookings by time slot."""
    try:
        region = request.args.get("region")
        ftype  = request.args.get("filter_type", "all")
        fval   = request.args.get("filter_value", "")
        return jsonify(_get_timeslot_dashboard_data(region, ftype, fval)["attempts_overview"])
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/timeslot/agent-view")
def ts_agent_view():
    """Individual voice agent (30 agents) attempts vs bookings by time slot."""
    try:
        region = request.args.get("region")
        ftype  = request.args.get("filter_type", "all")
        fval   = request.args.get("filter_value", "")
        return jsonify(_get_timeslot_dashboard_data(region, ftype, fval)["agent_view"])
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─── Roster Timeline ─────────────────────────────────────────────────────────

_RT_ENGINEERS = [
    ("ENG001","James Mitchell","NW"),    ("ENG002","Sarah Thompson","NW"),
    ("ENG003","Daniel Williams","NW"),   ("ENG004","Emma Johnson","NW"),
    ("ENG005","Michael Brown","NW"),     ("ENG006","Charlotte Davis","NW"),
    ("ENG007","Robert Wilson","NW"),     ("ENG008","Laura Taylor","NW"),
    ("ENG009","Christopher Anderson","NW"), ("ENG010","Jessica Martinez","NW"),
    ("ENG011","Thomas Jackson","SE"),    ("ENG012","Hannah White","SE"),
    ("ENG013","David Harris","SE"),      ("ENG014","Olivia Martin","SE"),
    ("ENG015","Joseph Thompson","SE"),   ("ENG016","Emily Garcia","SE"),
    ("ENG017","Andrew Robinson","SE"),   ("ENG018","Sophie Clark","NE"),
    ("ENG019","Joshua Lewis","NE"),      ("ENG020","Georgia Lee","NE"),
    ("ENG021","Ryan Walker","NE"),       ("ENG022","Chloe Hall","NE"),
    ("ENG023","Samuel Allen","NE"),      ("ENG024","Amy Wright","NE"),
    ("ENG025","Nathan King","WM"),       ("ENG026","Megan Scott","WM"),
    ("ENG027","Jonathan Green","WM"),    ("ENG028","Lucy Adams","WM"),
    ("ENG029","Benjamin Baker","WM"),    ("ENG030","Rebecca Nelson","WM"),
    ("ENG031","Alexander Carter","EM"),  ("ENG032","Natalie Mitchell","EM"),
    ("ENG033","Dylan Perez","EM"),       ("ENG034","Stephanie Roberts","EM"),
    ("ENG035","George Turner","EM"),     ("ENG036","Abigail Phillips","EM"),
    ("ENG037","Brandon Campbell","SW"),  ("ENG038","Victoria Parker","SW"),
    ("ENG039","Adam Evans","SW"),        ("ENG040","Danielle Edwards","SW"),
    ("ENG041","Ethan Collins","SW"),     ("ENG042","Samantha Stewart","SW"),
    ("ENG043","Callum Morris","Y"),      ("ENG044","Rachael Rogers","Y"),
    ("ENG045","Kyle Reed","Y"),          ("ENG046","Harriet Cook","Y"),
    ("ENG047","Sean Morgan","Y"),        ("ENG048","Fiona Bell","Y"),
    ("ENG049","Aaron Murphy","Y"),       ("ENG050","Zoe Bailey","Y"),
]

_RT_SLOT_CAPS = {
    "Early":    {"morning": 3, "afternoon": 3, "evening": 1},
    "Late":     {"morning": 1, "afternoon": 3, "evening": 3},
    "Full Day": {"morning": 2, "afternoon": 3, "evening": 2},
}
_RT_JOB_TYPES = [
    ("Meter Exchange", 0.48),
    ("New Install", 0.24),
    ("Meter Removal", 0.11),
    ("Repair", 0.10),
    ("Revisit", 0.07),
]
_RT_DAY_NAMES   = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"]
_RT_MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]


@app.route("/api/roster/timeline")
def roster_timeline():
    """21-day forward-looking roster — capacity, booked and available per slot per engineer."""
    from datetime import date, timedelta
    import random as _rnd

    today = date.today()
    days  = [today + timedelta(days=i) for i in range(21)]

    day_headers = []
    for d in days:
        day_headers.append({
            "date":       str(d),
            "weekday":    _RT_DAY_NAMES[d.weekday()],
            "day":        d.day,
            "month":      _RT_MONTH_NAMES[d.month - 1],
            "is_weekend": d.weekday() >= 5,
        })

    result = []
    for eng_id, eng_name, region in _RT_ENGINEERS:
        eng_num = int(eng_id[3:])

        # Stable per-engineer attributes (seeded by eng_num only)
        attr_rng   = _rnd.Random(eng_num * 17 + 3)
        shift      = attr_rng.choice(["Early", "Early", "Late", "Late", "Full Day"])
        base_rate  = attr_rng.uniform(0.50, 0.90)   # inherent booking tendency

        slot_caps  = _RT_SLOT_CAPS[shift]
        slots_list = ["morning", "afternoon", "evening"]

        eng_days     = []
        total_cap    = 0
        total_booked = 0

        for d in days:
            # Per-engineer-per-date seed — deterministic per calendar date
            day_seed = eng_num * 100003 + d.toordinal()
            day_rng  = _rnd.Random(day_seed)

            is_weekend = d.weekday() >= 5
            on_leave   = (not is_weekend) and day_rng.random() < 0.045

            day_data = {"date": str(d)}
            for slot_idx, slot in enumerate(slots_list):
                cap = slot_caps[slot]
                if is_weekend:
                    cap = max(0, cap - 1)

                if on_leave or cap == 0:
                    status = "leave" if (on_leave and cap > 0) else "off"
                    day_data[slot] = {"cap": 0, "booked": 0, "avail": 0, "status": status}
                    continue

                rate   = min(base_rate * day_rng.uniform(0.70, 1.18), 1.0)
                booked = min(int(round(cap * rate)), cap)
                avail  = cap - booked
                pct    = booked / cap

                if pct >= 1.0:   stat = "full"
                elif pct >= 0.67: stat = "high"
                elif pct >= 0.34: stat = "mid"
                else:             stat = "low"

                job_mix = {}
                if booked:
                    job_rng = _rnd.Random(day_seed * 31 + slot_idx * 997)
                    for _ in range(booked):
                        pick = job_rng.random()
                        cursor = 0.0
                        chosen = _RT_JOB_TYPES[-1][0]
                        for job_type, weight in _RT_JOB_TYPES:
                            cursor += weight
                            if pick <= cursor:
                                chosen = job_type
                                break
                        job_mix[chosen] = job_mix.get(chosen, 0) + 1

                day_data[slot] = {
                    "cap": cap, "booked": booked, "avail": avail,
                    "status": stat, "jobs": job_mix,
                }
                total_cap    += cap
                total_booked += booked

            eng_days.append(day_data)

        util = round(total_booked / total_cap * 100, 1) if total_cap else 0.0

        result.append({
            "id":    eng_id,
            "name":  eng_name,
            "region": region,
            "shift": shift,
            "util":  util,
            "days":  eng_days,
        })

    return jsonify({
        "generated": str(today),
        "days":      day_headers,
        "engineers": result,
    })


# ─── Long-Term 12-Month Planning Overview ────────────────────────────────────

@app.route("/api/longterm/overview")
def longterm_overview():
    """12-month forward demand vs capacity overview, starting from current forecast window."""
    import random as _rnd
    import calendar as _cal
    from datetime import date
    from engine.date_windows import rolling_forecast_window

    today = date.today()
    forecast_start, _ = rolling_forecast_window()
    start_year, start_month = forecast_start.year, forecast_start.month

    _REGIONS = ["NW", "SE", "NE", "WM", "EM", "SW", "Y"]
    _REG_W   = {"NW": 0.20, "SE": 0.18, "NE": 0.12, "WM": 0.15,
                "EM": 0.12, "SW": 0.10, "Y": 0.13}
    _MNAMES  = ["Jan","Feb","Mar","Apr","May","Jun",
                "Jul","Aug","Sep","Oct","Nov","Dec"]

    # Engineer shift mix across 50 engineers (fixed for capacity calc)
    # 20 Early, 20 Late, 10 Full Day
    # Morning:   20×3 + 20×1 + 10×2 = 100 slots/day
    # Afternoon: 20×3 + 20×3 + 10×3 = 150 slots/day
    # Evening:   20×1 + 20×3 + 10×2 = 100 slots/day  → total 350/day
    _SLOT_DAY = {"morning": 100, "afternoon": 150, "evening": 100}

    months_data = []

    for i in range(12):
        m = start_month + i
        y = start_year
        while m > 12:
            m -= 12
            y += 1

        _, days_in_month = _cal.monthrange(y, m)
        working_days = sum(
            1 for d in range(1, days_in_month + 1)
            if date(y, m, d).weekday() < 5
        )

        seed = y * 1000 + m * 7 + 42
        rng  = _rnd.Random(seed)

        # Base demand — 72-96 % of total monthly capacity
        total_cap_day = sum(_SLOT_DAY.values())          # 350 slots/day
        total_cap_mo  = total_cap_day * working_days

        demand_pct = rng.uniform(0.72, 0.96)
        # Seasonal: winter peak +10 %, summer slight dip -6 %
        if m in (11, 12, 1, 2):
            demand_pct = min(demand_pct * 1.10, 1.08)
        elif m in (6, 7, 8):
            demand_pct *= 0.94
        base_demand = int(total_cap_mo * demand_pct)

        # Per-slot capacity and demand
        slots = {}
        for slot, day_cap in _SLOT_DAY.items():
            cap    = day_cap * working_days
            # Demand split roughly proportional to capacity
            dem    = int(base_demand * (day_cap / total_cap_day) * rng.uniform(0.90, 1.12))
            booked = min(int(dem * rng.uniform(0.88, 1.02)), cap)
            avail  = cap - booked
            util   = round(booked / cap * 100, 1) if cap else 0.0
            slots[slot] = {
                "demand": dem, "capacity": cap,
                "booked": booked, "avail": avail, "util": util,
            }

        total_booked = sum(s["booked"] for s in slots.values())
        total_avail  = total_cap_mo - total_booked
        util_overall = round(total_booked / total_cap_mo * 100, 1) if total_cap_mo else 0.0

        # Regional breakdown
        regions = {}
        remaining_dem = base_demand
        remaining_cap = total_cap_mo
        for reg in _REGIONS[:-1]:
            w        = _REG_W[reg]
            var      = rng.uniform(0.88, 1.14)
            reg_dem  = int(base_demand * w * var)
            reg_cap  = int(total_cap_mo * w * rng.uniform(0.92, 1.08))
            reg_bk   = min(int(reg_cap * rng.uniform(0.60, 0.95)), reg_cap)
            reg_av   = reg_cap - reg_bk
            reg_util = round(reg_bk / reg_cap * 100, 1) if reg_cap else 0.0
            regions[reg] = {
                "demand": reg_dem, "capacity": reg_cap,
                "booked": reg_bk, "avail": reg_av, "util": reg_util,
            }
            remaining_dem -= reg_dem
            remaining_cap -= reg_cap

        last = _REGIONS[-1]
        last_cap  = max(remaining_cap, int(total_cap_mo * _REG_W[last]))
        last_bk   = min(int(last_cap * rng.uniform(0.60, 0.95)), last_cap)
        regions[last] = {
            "demand": max(remaining_dem, 100),
            "capacity": last_cap,
            "booked": last_bk,
            "avail": last_cap - last_bk,
            "util": round(last_bk / last_cap * 100, 1) if last_cap else 0.0,
        }

        months_data.append({
            "month_key":    f"{y}-{m:02d}",
            "label":        f"{_MNAMES[m - 1]} {y}",
            "short":        _MNAMES[m - 1],
            "year":         y,
            "working_days": working_days,
            "demand":       base_demand,
            "capacity":     total_cap_mo,
            "booked":       total_booked,
            "avail":        total_avail,
            "util":         util_overall,
            "gap":          base_demand - total_booked,
            "slots":        slots,
            "regions":      regions,
        })

    return jsonify({
        "generated": str(today),
        "period":    f"{months_data[0]['label']} — {months_data[-1]['label']}",
        "months":    months_data,
    })


# ─── Single Meter View ───────────────────────────────────────────────────────

_MV_N_METERS   = 50000          # logical meters derived from job_ref hash
_MV_FUEL_TYPES = ["Dual Fuel", "Dual Fuel", "Electricity Only", "Gas Only"]
_MV_BILL_TYPES = ["Actual", "Actual", "Actual", "Estimated"]
_MV_BILL_FREQS = ["Monthly", "Quarterly", "Quarterly", "Annual"]
_MV_PAY_TYPES  = ["Direct Debit", "Direct Debit", "Prepayment", "PAYM", "Online Banking"]
_MV_FLOWS_IN   = ["D0004", "D0010", "D0019", "D0052", "D0268"]
_MV_FLOWS_OUT  = ["D0095", "D0268", "D0004", "None"]
_MV_FLOW_OUTS  = ["Success", "Access Denied", "No Read", "VNR", "Pending"]
_MV_JOB_LABELS = {
    "EXCHANGE":    "Meter Exchange",
    "NEW_INSTALL": "New Installation",
    "REMOVAL":     "Meter Removal",
    "REPAIR":      "Meter Repair",
}


def _mv_job_to_group(job_ref: str) -> int:
    try:
        return int(job_ref.split("-")[-1]) % _MV_N_METERS
    except Exception:
        return -1


def _mv_mpxn_to_group(mpxn: str) -> int:
    try:
        val = int(mpxn.strip())
        gid = val % _MV_N_METERS
        return gid if 0 <= gid < _MV_N_METERS else -1
    except Exception:
        return -1


def _mv_visit_summary(visits: list) -> str:
    if not visits:
        return "No visit history available for this meter."
    ordinals = ["first", "second", "third"]
    parts = []
    for i, v in enumerate(visits[:3]):
        ord_  = ordinals[i]
        status = v.get("status", "")
        cancel = (v.get("cancellation_reason") or "").strip()
        abort  = (v.get("abort_reason")        or "").strip()
        if status == "Completed":
            parts.append(f"successful {ord_} visit")
        elif cancel:
            parts.append(f"unsuccessful {ord_} visit (cancelled — {cancel.lower()})")
        elif abort:
            parts.append(f"unsuccessful {ord_} visit (aborted — {abort.lower()})")
        elif status == "Booked":
            parts.append(f"scheduled but not yet completed {ord_} visit")
        else:
            parts.append(f"inconclusive {ord_} visit")
    if len(parts) == 1:
        return f"The most recent field visit was {parts[0]}."
    elif len(parts) == 2:
        return f"The field visits were {parts[0]} and {parts[1]}."
    return f"The field visits were {parts[0]}, {parts[1]}, and {parts[2]}."


@app.route("/api/meter-view")
def meter_view_api():
    """Return full meter history and attributes for a given MPXN."""
    import random as _rnd
    mpxn = request.args.get("mpxn", "").strip().replace(" ", "")
    if not mpxn:
        return jsonify({"error": "MPXN required"}), 400

    gid = _mv_mpxn_to_group(mpxn)
    if gid < 0:
        return jsonify({"error": "Invalid meter point number"}), 404

    try:
        _, _, _, _, _, iter_jobs_fn = _get_ingestion()
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

    jobs = [
        j for j in iter_jobs_fn()
        if j.get("is_forecast", "0") == "0"
        and _mv_job_to_group(j.get("job_ref", "")) == gid
    ]

    if not jobs:
        return jsonify({"error": "No records found for this meter point number"}), 404

    jobs_sorted = sorted(jobs, key=lambda j: j.get("contact_date", ""), reverse=True)

    rng = _rnd.Random(gid * 13337 + 7)

    # ── Meter Details ────────────────────────────────────────────────────────
    most_recent  = jobs_sorted[0]
    msn_alpha    = "ABCDEFGHJKLMNPQRSTVWXYZ"
    msn          = f"{rng.randint(10,99)}{rng.choice(msn_alpha)}{rng.randint(1000000,9999999)}"
    meter_raw    = most_recent.get("meter_type", "SMETS2")
    meter_label  = {"SMETS2": "Smart (SMETS2)", "SMETS1": "Smart (SMETS1)"}.get(meter_raw, f"Smart ({meter_raw})")
    fuel_type    = rng.choice(_MV_FUEL_TYPES)
    last_read    = round(rng.uniform(100.0, 18000.0), 2)
    bill_type    = rng.choice(_MV_BILL_TYPES)
    bill_freq    = rng.choice(_MV_BILL_FREQS)
    pay_type     = rng.choice(_MV_PAY_TYPES)
    completed_ok = [j for j in jobs_sorted if j.get("status") == "Completed"]
    last_bill_dt = completed_ok[0].get("completed_date") or completed_ok[0].get("contact_date") if completed_ok else "—"

    # ── Insights ─────────────────────────────────────────────────────────────
    seal_visible       = rng.random() > 0.08
    no_seal_tampering  = rng.random() > 0.05
    no_physical_damage = rng.random() > 0.07
    no_wiring_issue    = rng.random() > 0.10

    visits = [j for j in jobs_sorted if j.get("booked_date")][:3]
    visit_summary = _mv_visit_summary(visits)

    # ── MOP Details ──────────────────────────────────────────────────────────
    mop_j        = most_recent
    mop_type     = _MV_JOB_LABELS.get(mop_j.get("job_type", ""), mop_j.get("job_type", "—"))
    mop_status   = {"Completed": "Completed", "Cancelled": "Cancelled",
                    "Aborted": "Aborted On Day", "Booked": "Scheduled",
                    "Unbooked": "Pending"}.get(mop_j.get("status", ""), mop_j.get("status", "—"))
    mop_reason   = (mop_j.get("cancellation_reason") or mop_j.get("abort_reason") or "—").strip() or "—"
    flows_in     = rng.choice(_MV_FLOWS_IN)
    flow_outcome = "Success" if mop_j.get("status") == "Completed" else rng.choice(_MV_FLOW_OUTS[1:])
    out_flows    = rng.choice(_MV_FLOWS_OUT)
    mop_date     = mop_j.get("completed_date") or mop_j.get("booked_date") or mop_j.get("contact_date") or "—"

    # ── DC Details ───────────────────────────────────────────────────────────
    dc_j          = visits[0] if visits else most_recent
    dc_date       = dc_j.get("completed_date") or dc_j.get("booked_date") or dc_j.get("contact_date") or "—"
    dc_read_ok    = dc_j.get("status") == "Completed"
    dc_read_cap   = str(last_read) if dc_read_ok else "—"
    dc_channel    = dc_j.get("primary_channel", "—")

    # ── Last 3 Contacts ──────────────────────────────────────────────────────
    last3_contacts = []
    for j in jobs_sorted[:5]:   # take up to 5, dedupe to 3 meaningful
        stat = j.get("status", "—")
        if stat == "Forecast":
            continue
        dc_stat = "Read Captured" if stat == "Completed" else rng.choice(["VNR - Access Denied", "VNR - No Answer", "Pending"])
        last3_contacts.append({
            "date":       j.get("contact_date", "—"),
            "channel":    j.get("primary_channel", "—"),
            "contacts":   int(j.get("contacts_count", 1) or 1),
            "abandoned":  int(j.get("abandoned_contacts", 0) or 0),
            "outcome":    stat,
            "mop_status": {"Completed": "Completed", "Cancelled": "Cancelled",
                           "Aborted": "Aborted", "Booked": "Scheduled",
                           "Unbooked": "Pending"}.get(stat, stat),
            "dc_status":  dc_stat,
        })
        if len(last3_contacts) == 3:
            break

    # ── Last 3 Visits ────────────────────────────────────────────────────────
    last3_visits = []
    visit_pool = [j for j in jobs_sorted if j.get("booked_date") and j.get("status") not in ("Forecast", "Unbooked")]
    for j in visit_pool[:3]:
        stat   = j.get("status", "—")
        dc_out = "Read Captured" if stat == "Completed" else rng.choice(["VNR - Access Denied", "VNR - No Answer", "Pending"])
        last3_visits.append({
            "date":       j.get("completed_date") or j.get("booked_date") or "—",
            "engineer":   j.get("engineer_id", "—"),
            "job_type":   _MV_JOB_LABELS.get(j.get("job_type", ""), j.get("job_type", "—")),
            "status":     stat,
            "reason":     (j.get("cancellation_reason") or j.get("abort_reason") or "—").strip() or "—",
            "mop_outcome": {"Completed": "Completed", "Cancelled": "Cancelled",
                            "Aborted": "Aborted", "Booked": "Scheduled"}.get(stat, stat),
            "dc_outcome": dc_out,
        })

    return jsonify({
        "mpxn": mpxn,
        "total_jobs": len(jobs),
        "meter_details": {
            "mpxn":           mpxn,
            "msn":            msn,
            "meter_type":     meter_label,
            "fuel_type":      fuel_type,
            "supplier":       most_recent.get("supplier_name", "—"),
            "region":         most_recent.get("region_name", "—"),
            "patch":          most_recent.get("patch_code", "—"),
            "last_read":      last_read,
            "last_bill_type": bill_type,
            "last_bill_date": last_bill_dt,
            "billing_freq":   bill_freq,
            "payment_type":   pay_type,
        },
        "insights": {
            "seal_visible":       seal_visible,
            "no_seal_tampering":  no_seal_tampering,
            "no_physical_damage": no_physical_damage,
            "no_wiring_issue":    no_wiring_issue,
            "visit_summary":      visit_summary,
        },
        "mop_details": {
            "last_job_date":   mop_date,
            "last_job_type":   mop_type,
            "last_job_status": mop_status,
            "reason":          mop_reason,
            "flows_received":  flows_in,
            "flow_outcome":    flow_outcome,
            "outstanding_flows": out_flows,
        },
        "dc_details": {
            "last_visit_date":    dc_date,
            "vnr_status":         dc_read_ok,
            "last_read_captured": dc_read_cap,
            "last_channel":       dc_channel,
        },
        "last_contacts": last3_contacts,
        "last_visits":   last3_visits,
    })


# ─── Field Engineer Scorecard ────────────────────────────────────────────────
@app.route("/api/field-engineers")
def field_engineers_api():
    """Return monthly scorecard data for all 50 field engineers (2025)."""
    import csv as _csv
    path = BASE_DIR / "data" / "inputs" / "field_engineers.csv"
    if not path.exists():
        return jsonify({"error": "field_engineers.csv not found"}), 404
    try:
        engineers: dict = {}
        with open(path, newline="", encoding="utf-8") as f:
            for row in _csv.DictReader(f):
                eid = row["engineer_id"]
                if eid not in engineers:
                    engineers[eid] = {"id": eid, "name": row["engineer_name"], "monthly": []}
                engineers[eid]["monthly"].append({
                    "month":          row["month"],
                    "month_num":      int(row["month_num"]),
                    "working_days":   int(row["working_days"]),
                    "total_allocated": int(row["total_allocated"]),
                    "total_bookings": int(row["total_bookings"]),
                    "success_jobs":   int(row["success_jobs"]),
                    "abort_jobs":     int(row["abort_jobs"]),
                    "cancelled_jobs": int(row["cancelled_jobs"]),
                    "success_rate":   float(row["success_rate"]),
                    "productivity":   float(row["productivity"]),
                    "leaves_taken":   int(row["leaves_taken"]),
                    "avg_jobs_per_day": float(row["avg_jobs_per_day"]),
                })
        return jsonify({"engineers": list(engineers.values())})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─── Startup: automatic rolling-window data check ───────────────────────────

_DATA_READY_ANCHOR = None
_generation_lock = threading.Lock()

def _acquire_generation_lock() -> bool:
    return _generation_lock.acquire(blocking=False)

def _release_generation_lock() -> None:
    try:
        _generation_lock.release()
    except RuntimeError:
        pass

def _auto_generate_data_enabled() -> bool:
    import os
    return (
        os.getenv("IMSERV_AUTO_GENERATE_DATA", "").lower() == "true"
        or (os.getenv("FLASK_ENV", "development") == "development" and not os.getenv("RENDER"))
    )

def _read_data_manifest() -> dict:
    import json
    path = BASE_DIR / "data" / "inputs" / "manifest.json"
    if path.exists():
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}

def _data_window_state(current_anchor: str) -> tuple[bool, bool]:
    input_dir = BASE_DIR / "data" / "inputs"
    required_files = [
        "master_operations.csv",
        "booking_journey.csv",
        "capacity_demand.csv",
        "channel_volume.csv",
        "engineer_availability.csv",
        "engineers.csv",
        "field_engineers.csv",
        "financial_data.csv",
        "forecast_baseline_2025.csv",
        "suppliers.csv"
    ]
    
    for f in required_files:
        if not (input_dir / f).exists():
            print(f"IMSERV: Missing required file {f}.")
            return True, False

    from engine.date_windows import rolling_actual_window, parse_iso_date
    actual_start, _ = rolling_actual_window()

    try:
        import csv as _csv
        
        # Check master_operations.csv strictly
        with open(input_dir / "master_operations.csv", encoding="utf-8-sig", newline="") as f:
            reader = _csv.DictReader(f)
            first_row = next(reader, None)
            if not first_row:
                return True, False
            rd = parse_iso_date(first_row.get("requested_date", ""))
            if rd != actual_start:
                print(f"IMSERV: master_operations.csv first date {rd} != expected {actual_start}. Marking stale.")
                return False, True
                
        # Check booking_journey.csv strictly
        with open(input_dir / "booking_journey.csv", encoding="utf-8-sig", newline="") as f:
            reader = _csv.DictReader(f)
            first_row = next(reader, None)
            if not first_row:
                return True, False
            ws = parse_iso_date(first_row.get("week_start", ""))
            if not ws or abs((ws - actual_start).days) > 7:
                print(f"IMSERV: booking_journey.csv out of sync with {actual_start}. Marking stale.")
                return False, True

    except Exception as e:
        print(f"IMSERV: CSV spot-check error: {e}. Marking stale.")
        return False, True

    return False, False

def _ensure_data() -> None:
    from engine.date_windows import rolling_generation_profile
    profile = rolling_generation_profile()
    current_anchor = profile["anchor_month"]


    print(f"IMSERV: Rolling-window check | anchor={current_anchor} | actuals={profile['actual_period']} | forecast={profile['forecast_period']}")
    missing, stale = _data_window_state(current_anchor)

    if not missing and not stale:
        print("IMSERV: All CSVs are aligned to the current rolling window. Ready.")
        return

    if not _auto_generate_data_enabled():
        reason = "missing" if missing else "out-of-date"
        print(f"IMSERV: Data is {reason} but auto-generation is disabled.")
        return

    if missing:
        print("IMSERV: Data files are missing; date-only refresh cannot run without an existing dataset.")
        return

    reason = "not found" if missing else "out-of-date for current rolling window"
    print(f"IMSERV: Data is {reason}; rolling existing CSV dates now...")

    if not _acquire_generation_lock():
        print("IMSERV: Another worker is rolling data dates. Waiting for it to finish...")
        return

    try:
        missing2, stale2 = _data_window_state(current_anchor)
        if not missing2 and not stale2:
            print("IMSERV: Another worker already finished regeneration. Ready.")
            _DATA_READY        = True
            _DATA_READY_ANCHOR = current_anchor
            return

        from engine.date_roller import roll_existing_data_dates
        roll_result = roll_existing_data_dates()

        try:
            from engine.ingestion import clear_data_caches
            from engine.forecasting_engine import clear_forecast_cache
            clear_data_caches()
            clear_forecast_cache()
            _clear_timeslot_cache()
        except Exception:
            pass

        print(
            "IMSERV: Existing CSV dates rolled successfully "
            f"for anchor {current_anchor} (month_delta={roll_result['month_delta']})."
        )
    except Exception as exc:
        print(f"IMSERV: CSV date roll failed: {exc}")
    finally:
        _release_generation_lock()

@app.before_request
def _ensure_data_before_api_request():
    from flask import request
    if request.path.startswith("/api/"):
        _ensure_data()

@app.route("/api/data/status")
def data_status_api():
    from engine.date_windows import rolling_generation_profile
    from flask import jsonify
    profile = rolling_generation_profile()
    current_anchor = profile["anchor_month"]
    missing, stale = _data_window_state(current_anchor)
    manifest = _read_data_manifest()
    
    return jsonify({
        "status": "ready" if not missing and not stale else ("stale" if stale else "missing"),
        "current_anchor": current_anchor,
        "manifest_anchor": manifest.get("rolling_anchor_month"),
        "auto_generate_enabled": _auto_generate_data_enabled(),
        "windows": profile
    })

# ─────────────────────────────────────────────────────────────────────────────

_ensure_data()

if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    debug = os.getenv("FLASK_ENV", "development") == "development"
    print(f"\nIMSERV Platform running on http://localhost:{port}\n")
    app.run(host="0.0.0.0", port=port, debug=debug)
