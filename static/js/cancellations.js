/* IMSERV — Module 3: Cancellations & Aborts */

async function loadCancellationsDashboard() {
  const region = IMSERV.getRegion();
  const year   = IMSERV.getYear();
  const qs     = `?region=${region}&year=${year}`;

  const [kpis, rootCauses, trends, heatmap, rebook] = await Promise.all([
    IMSERV.apiFetch('/api/cancellations/kpis'        + qs),
    IMSERV.apiFetch('/api/cancellations/root-causes' + qs),
    IMSERV.apiFetch('/api/cancellations/trends'      + (region ? `?region=${region}` : '')),
    IMSERV.apiFetch('/api/cancellations/heatmap'     + `?year=${year}`),
    IMSERV.apiFetch('/api/cancellations/rebooking'   + qs),
  ]);

  if (kpis)       renderCancelKPIs(kpis);
  if (rootCauses) renderParetoChart(rootCauses);
  if (rootCauses) renderCategoryChart(rootCauses);
  if (trends)     renderCancelTrend(trends);
  if (heatmap)    renderCancelRegional(heatmap);
  if (rebook)     renderRebooking(rebook);

  await loadCancellationRisk();
}

function renderCancelKPIs(kpis) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('can-kpi-total',       IMSERV.fmt.num(kpis.cancellations));
  set('can-kpi-rate',        IMSERV.fmt.pct(kpis.cancel_rate_pct));
  set('can-kpi-aborts',      IMSERV.fmt.num(kpis.aborts));
  set('can-kpi-abort-rate',  IMSERV.fmt.pct(kpis.abort_rate_pct));
}

function renderParetoChart(data) {
  const ctx = document.getElementById('pareto-chart');
  if (!ctx || !data.pareto) return;
  const top8  = data.pareto.slice(0, 8);
  const labels = top8.map(d => d.reason.length > 20 ? d.reason.substring(0, 18) + '…' : d.reason);
  IMSERV.registerChart('pareto', new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Count', data: top8.map(d => d.count), backgroundColor: 'rgba(239,68,68,0.65)', yAxisID: 'y' },
        { label: 'Cumulative %', data: top8.map(d => d.cumulative_pct), type: 'line',
          borderColor: IMSERV.colors.warn, fill: false, tension: 0.3, pointRadius: 3, yAxisID: 'y1' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: IMSERV.chartDefaults.plugins,
      scales: {
        ...IMSERV.chartDefaults.scales,
        y:  { ...IMSERV.chartDefaults.scales.y, position: 'left' },
        y1: { ...IMSERV.chartDefaults.scales.y, position: 'right', min: 0, max: 100,
               grid: { display: false },
               ticks: { ...IMSERV.chartDefaults.scales.y.ticks, callback: v => v + '%' } },
      },
    },
  }));
}

function renderCategoryChart(data) {
  const ctx = document.getElementById('category-chart');
  if (!ctx || !data.categories) return;
  const cats = data.categories;
  const colours = ['#EF4444','#F59E0B','#3B82F6','#10B981','#8B5CF6'];
  IMSERV.registerChart('category', new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: cats.map(c => c.category),
      datasets: [{
        data: cats.map(c => c.count),
        backgroundColor: colours.slice(0, cats.length),
        borderColor: '#0E1829', borderWidth: 2,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        ...IMSERV.chartDefaults.plugins,
        legend: { position: 'right', labels: { color: '#8B9DC3', font: { size: 11 } } },
      },
    },
  }));
}

function renderCancelTrend(data) {
  const ctx = document.getElementById('cancel-trend-chart');
  if (!ctx) return;
  const actuals  = (data.monthly_trend  || []).slice(-18);
  const forecast = (data.forecast       || []).slice(0, 6);
  const allMonths = [...actuals.map(t => t.month), ...forecast.map(t => t.month)];
  const actualCR  = [...actuals.map(t => t.cancel_rate), ...Array(forecast.length).fill(null)];
  const forecastCR= [...Array(actuals.length).fill(null), ...forecast.map(t => t.cancel_rate)];

  IMSERV.registerChart('cancel-trend', new Chart(ctx, {
    type: 'line',
    data: {
      labels: allMonths,
      datasets: [
        { label: 'Cancellation Rate %', data: actualCR,   borderColor: IMSERV.colors.crit, backgroundColor: 'rgba(239,68,68,0.08)', fill: true, tension: 0.4, pointRadius: 0 },
        { label: 'Forecast',            data: forecastCR, borderColor: IMSERV.colors.warn, fill: false, tension: 0.4, pointRadius: 3, borderDash: [5,4] },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: IMSERV.chartDefaults.plugins,
      scales: {
        ...IMSERV.chartDefaults.scales,
        y: { ...IMSERV.chartDefaults.scales.y, ticks: { ...IMSERV.chartDefaults.scales.y.ticks, callback: v => v + '%' } },
      },
    },
  }));
}

function renderCancelRegional(data) {
  const tbody = document.getElementById('cancel-regional-body');
  if (!tbody) return;
  tbody.innerHTML = (data || []).map(r => `
    <tr>
      <td><strong>${r.region_code}</strong></td>
      <td><span class="${r.cancel_rate > 18 ? 'text-crit' : (r.cancel_rate > 14 ? 'text-warn' : 'text-ok')}">${IMSERV.fmt.pct(r.cancel_rate)}</span></td>
      <td>${IMSERV.fmt.pct(r.abort_rate)}</td>
      <td><span class="rag ${r.rag}">${r.rag}</span></td>
    </tr>
  `).join('');
}

async function loadCancellationRisk() {
  const region = document.getElementById('cancel-predict-region')?.value || 'NW';
  const data = await IMSERV.apiFetch('/api/cancellations/predict?region=' + region);
  const panel = document.getElementById('cancel-risk-panel');
  if (!panel || !data) return;

  const driverHtml = (data.drivers || []).map(d => `
    <div class="rec-card ${d.impact}">
      <div class="rec-icon">⚠️</div>
      <div class="rec-body">
        <div class="rec-title">${d.driver}</div>
        <div class="rec-meta"><span class="priority ${d.impact}">${d.impact}</span><span class="rec-metric">Value: ${d.value}</span></div>
      </div>
    </div>
  `).join('') || '<div class="text-muted fs-12">No significant risk drivers identified.</div>';

  const recHtml = (data.recommendations || []).map(r => `
    <div class="alert alert-info mt-8">💡 ${r}</div>
  `).join('');

  panel.innerHTML = `
    <div class="grid-2">
      <div>
        <div class="kpi-grid" style="grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
          <div class="kpi-card ${data.risk_level === 'Critical' ? 'crit' : (data.risk_level === 'High' ? 'warn' : 'ok')}">
            <div class="kpi-label">Risk Score</div>
            <div class="kpi-value">${data.risk_score}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Risk Level</div>
            <div class="kpi-value" style="font-size:18px">${data.risk_level}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Cancel Rate</div>
            <div class="kpi-value large">${IMSERV.fmt.pct(data.cancel_rate)}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-label">Trend</div>
            <div class="kpi-value large ${data.trend_direction === 'Rising' ? 'text-crit' : 'text-ok'}">${data.trend_direction}</div>
          </div>
        </div>
        ${recHtml}
      </div>
      <div>
        <div class="fs-12 fw-600 mb-8 text-muted">RISK DRIVERS</div>
        <div class="rec-list">${driverHtml}</div>
      </div>
    </div>
  `;
}

function renderRebooking(data) {
  const tbody = document.getElementById('rebook-table-body');
  if (!tbody) return;
  tbody.innerHTML = (data.rebook_data || []).map(r => `
    <tr>
      <td><strong>${r.region_code}</strong></td>
      <td>${IMSERV.fmt.pct(r.rebook_rate_pct)}</td>
      <td>${r.avg_rebook_lag_days} days</td>
      <td><span class="${r.rebook_success_pct > 60 ? 'text-ok' : 'text-warn'}">${IMSERV.fmt.pct(r.rebook_success_pct)}</span></td>
    </tr>
  `).join('');
}
