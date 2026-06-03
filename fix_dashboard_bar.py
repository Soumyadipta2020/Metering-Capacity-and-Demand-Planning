import re

with open('static/js/dashboard.js', 'r', encoding='utf-8') as f:
    text = f.read()

# We need to replace the single bar with overlapping bars.
pattern = re.compile(r'<div class="rc-supplier-bar-bg">\s*<div class="rc-supplier-bar-fill" style="width: \$\{r\.booking_rate\}%; background: var\(--accent\);"></div>\s*</div>')

# Calculation:
# completion_pct_of_requests = (completions / max(requests, 1)) * 100
# booking_pct_of_requests = booking_rate (since it's bookings / requests)

replacement = r"""<div class="rc-supplier-bar-bg" style="position: relative; overflow: hidden; background: rgba(255, 255, 255, 0.08);">
            <!-- Booked bar (total booked out of requests) -->
            <div class="rc-supplier-bar-fill" style="position: absolute; top: 0; left: 0; height: 100%; width: ${r.booking_rate}%; background: #3498db; opacity: 0.4;" title="Booked (${r.booking_rate}%)"></div>
            <!-- Completed bar (total completed out of requests) -->
            <div class="rc-supplier-bar-fill" style="position: absolute; top: 0; left: 0; height: 100%; width: ${(r.completions / Math.max(r.requests, 1)) * 100}%; background: #2ecc71;" title="Completed (${((r.completions / Math.max(r.requests, 1)) * 100).toFixed(1)}%)"></div>
          </div>"""

new_text = re.sub(pattern, replacement, text)

if text != new_text:
    with open('static/js/dashboard.js', 'w', encoding='utf-8') as f:
        f.write(new_text)
    print("dashboard.js updated successfully")
else:
    print("Pattern not found")
