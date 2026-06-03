import re

with open('static/js/dashboard.js', 'r', encoding='utf-8') as f:
    text = f.read()

pattern = re.compile(r'<div class="rc-supplier-volume".*?</div>\s*</div>\s*<div class="rc-supplier-main-metric">\s*<div class="rc-supplier-main-metric-label">\s*<span>Booking Rate</span>\s*<span>\$\{r\.booking_rate\}%</span>\s*</div>\s*<div class="rc-supplier-bar-bg">\s*<div class="rc-supplier-bar-fill" style="width: \$\{r\.booking_rate\}%; background: var\(--accent\);"></div>\s*</div>\s*</div>\s*<div class="rc-supplier-secondary-metrics">\s*<div class="rc-supplier-sec-metric">\s*<span>Success Rate</span>\s*<strong style="color: \$\{successColor\}">\$\{r\.visit_success_rate\}%</strong>\s*</div>\s*<div class="rc-supplier-sec-metric" style="text-align: right;">\s*<span>Fallout Rate</span>\s*<strong style="color: \$\{falloutColor\}">\$\{r\.fallout_rate\}%</strong>\s*</div>\s*</div>')

replacement = r"""<div class="rc-supplier-volume" title="Total Requests">Requests: ${IMSERV.fmt.num(r.requests)}</div>
        </div>
        <div class="rc-supplier-main-metric">
          <div class="rc-supplier-main-metric-label">
            <span>Booked</span>
            <span>${IMSERV.fmt.num(r.bookings)}</span>
          </div>
          <div class="rc-supplier-bar-bg">
            <div class="rc-supplier-bar-fill" style="width: ${r.booking_rate}%; background: var(--accent);"></div>
          </div>
        </div>
        <div class="rc-supplier-secondary-metrics">
          <div class="rc-supplier-sec-metric">
            <span>Successful Completions</span>
            <strong>${IMSERV.fmt.num(r.completions)}</strong>
          </div>
          <div class="rc-supplier-sec-metric" style="text-align: right;">
            <span>Success Rate</span>
            <strong style="color: ${successColor}">${r.visit_success_rate}%</strong>
          </div>
        </div>"""

new_text = re.sub(pattern, replacement, text)

if text != new_text:
    with open('static/js/dashboard.js', 'w', encoding='utf-8') as f:
        f.write(new_text)
    print("dashboard.js metrics updated successfully")
else:
    print("Pattern not found in dashboard.js")
