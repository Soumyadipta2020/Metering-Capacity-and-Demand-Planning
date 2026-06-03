import re

with open('app.py', 'r', encoding='utf-8') as f:
    text = f.read()

# We need to find the journey_suppliers endpoint logic where it returns jsonify
pattern = re.compile(r'        return jsonify\(\{\n            "suppliers": suppliers\[:max\(top_n, 1\)\],.*?\n        \}\)', re.DOTALL)

replacement = """        top_limit = max(top_n, 1)
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
        })"""

new_text = re.sub(pattern, replacement, text)
if text != new_text:
    with open('app.py', 'w', encoding='utf-8') as f:
        f.write(new_text)
    print("app.py updated successfully")
else:
    print("app.py not updated")
