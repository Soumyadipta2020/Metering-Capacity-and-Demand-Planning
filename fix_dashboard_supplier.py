import re

with open('static/js/dashboard.js', 'r', encoding='utf-8') as f:
    text = f.read()

# Replace top_n=18 with top_n=25
text = text.replace("top_n=18", "top_n=25")

# Replace renderSupplierBehaviour
pattern = re.compile(r'function renderSupplierBehaviour\(data\) \{.*?\}\n\nfunction updateAiTriggerState', re.DOTALL)

replacement = """function renderSupplierBehaviour(data) {
  const container = document.getElementById('supplier-behaviour-grid');
  if (!container) return;

  const suppliers = data?.suppliers || [];
  if (!suppliers.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-title">No supplier data available</div></div>';
    return;
  }

  const cardsHtml = suppliers.map((r, i) => {
    // If it's the last element and named "Others", don't show a rank number
    const isOthers = r.supplier_name === "Others";
    const rankStr = isOthers ? "—" : `#${i + 1}`;
    
    // Style logic
    const successColor = r.visit_success_rate >= 70 ? '#028178' : r.visit_success_rate >= 50 ? '#F4D25A' : '#FB8281';
    const falloutColor = r.fallout_rate <= 15 ? '#028178' : r.fallout_rate <= 25 ? '#F4D25A' : '#FB8281';

    return `
      <div class="rc-supplier-card" style="flex: 1 1 calc(25% - 16px); min-width: 250px;">
        <div class="rc-supplier-header">
          <div class="rc-supplier-rank">${rankStr}</div>
          <div class="rc-supplier-name" title="${journeyEscapeHtml(r.supplier_name)}">${journeyEscapeHtml(r.supplier_name)}</div>
          <div class="rc-supplier-volume" title="Bookings / Requests">${IMSERV.fmt.num(r.bookings)} / ${IMSERV.fmt.num(r.requests)}</div>
        </div>
        <div class="rc-supplier-main-metric">
          <div class="rc-supplier-main-metric-label">
            <span>Booking Rate</span>
            <span>${r.booking_rate}%</span>
          </div>
          <div class="rc-supplier-bar-bg">
            <div class="rc-supplier-bar-fill" style="width: ${r.booking_rate}%; background: var(--accent);"></div>
          </div>
        </div>
        <div class="rc-supplier-secondary-metrics">
          <div class="rc-supplier-sec-metric">
            <span>Success Rate</span>
            <strong style="color: ${successColor}">${r.visit_success_rate}%</strong>
          </div>
          <div class="rc-supplier-sec-metric" style="text-align: right;">
            <span>Fallout Rate</span>
            <strong style="color: ${falloutColor}">${r.fallout_rate}%</strong>
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div style="display: flex; flex-wrap: wrap; gap: 16px;">
      ${cardsHtml}
    </div>
  `;
}

function updateAiTriggerState"""

new_text = re.sub(pattern, replacement, text)

if text != new_text:
    with open('static/js/dashboard.js', 'w', encoding='utf-8') as f:
        f.write(new_text)
    print("dashboard.js updated successfully")
else:
    print("dashboard.js not updated")
