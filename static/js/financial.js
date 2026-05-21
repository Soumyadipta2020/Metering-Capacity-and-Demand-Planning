/* IMSERV — Module 5: Financial Scenario Planning */

async function loadFinancialDashboard() {
  const region = IMSERV.getRegion();
  const year   = IMSERV.getYear();
  const qs     = `?region=${region}&year=${year}`;

  const [kpis, forecast] = await Promise.all([
    IMSERV.apiFetch('/api/financial/kpis' + qs),
    IMSERV.apiFetch('/api/financial/forecast-profitability' + (region ? `?region=${region}` : '')),
  ]);

  if (kpis)     renderFinancialKPIs(kpis);
  if (kpis)     renderMonthlyChart(kpis.monthly_trend || []);
  if (kpis)     renderJobTypeChart(kpis.job_type_breakdown || []);
  if (forecast) renderForecastProfit(forecast);
}

function renderFinancialKPIs(kpis) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('fin-kpi-revenue',    IMSERV.fmt.gbpM(kpis.total_revenue_gbp));
  set('fin-kpi-cost',       IMSERV.fmt.gbpM(kpis.total_cost_gbp));
  set('fin-kpi-margin',     IMSERV.fmt.gbpM(kpis.total_margin_gbp));
  set('fin-kpi-margin-pct', IMSERV.fmt.pct(kpis.margin_pct));
  set('fin-kpi-cpp',        IMSERV.fmt.gbp(kpis.avg_cost_per_completion));

  const mpCard = document.getElementById('fin-kpi-margin-pct')?.closest('.kpi-card');
  if (mpCard) {
    mpCard.className = `kpi-card ${kpis.margin_pct > 20 ? 'ok' : (kpis.margin_pct > 12 ? 'warn' : 'crit')}`;
  }
}

function renderMonthlyChart(trend) {
  const ctx = document.getElementById('fin-monthly-chart');
  if (!ctx || !trend.length) return;
  const labels = trend.map(t => t.month.substring(0, 7));
  IMSERV.registerChart('fin-monthly', new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Revenue £',  data: trend.map(t => t.revenue),  backgroundColor: 'rgba(16,185,129,0.55)', yAxisID: 'y'  },
        { label: 'Cost £',     data: trend.map(t => t.cost),     backgroundColor: 'rgba(239,68,68,0.45)', yAxisID: 'y'  },
        { label: 'Margin %',   data: trend.map(t => t.margin_pct),borderColor: IMSERV.colors.accent, type: 'line', fill: false, tension: 0.4, pointRadius: 0, yAxisID: 'y1' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: IMSERV.chartDefaults.plugins,
      scales: {
        ...IMSERV.chartDefaults.scales,
        y:  { ...IMSERV.chartDefaults.scales.y, ticks: { ...IMSERV.chartDefaults.scales.y.ticks, callback: v => '£' + (v/1000).toFixed(0) + 'k' } },
        y1: { ...IMSERV.chartDefaults.scales.y, position: 'right', grid: { display: false },
               ticks: { ...IMSERV.chartDefaults.scales.y.ticks, callback: v => v + '%' } },
      },
    },
  }));
}

function renderJobTypeChart(breakdown) {
  const ctx = document.getElementById('fin-jobtype-chart');
  if (!ctx || !breakdown.length) return;
  const labels = breakdown.map(j => j.job_type.replace('_', ' '));
  IMSERV.registerChart('fin-jobtype', new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Revenue £', data: breakdown.map(j => j.revenue), backgroundColor: 'rgba(0,82,204,0.6)'   },
        { label: 'Cost £',    data: breakdown.map(j => j.cost),    backgroundColor: 'rgba(239,68,68,0.45)' },
        { label: 'Margin £',  data: breakdown.map(j => j.margin),  backgroundColor: 'rgba(16,185,129,0.55)'},
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: IMSERV.chartDefaults.plugins,
      scales: { ...IMSERV.chartDefaults.scales },
    },
  }));
}

function renderForecastProfit(data) {
  const ctx = document.getElementById('forecast-profit-chart');
  if (!ctx || !data.monthly_forecast?.length) return;
  const mf = data.monthly_forecast;
  IMSERV.registerChart('forecast-profit', new Chart(ctx, {
    type: 'line',
    data: {
      labels: mf.map(m => m.month),
      datasets: [
        { label: '2026 Revenue £',  data: mf.map(m => m.revenue), borderColor: IMSERV.colors.ok,      fill: false, tension: 0.4, pointRadius: 0, borderDash: [5,3] },
        { label: '2026 Cost £',     data: mf.map(m => m.cost),    borderColor: IMSERV.colors.crit,    fill: false, tension: 0.4, pointRadius: 0, borderDash: [5,3] },
        { label: '2026 Margin %',   data: mf.map(m => m.margin_pct), borderColor: IMSERV.colors.accent, fill: false, tension: 0.4, pointRadius: 3, yAxisID: 'y1' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { ...IMSERV.chartDefaults.plugins },
      scales: {
        ...IMSERV.chartDefaults.scales,
        y:  { ...IMSERV.chartDefaults.scales.y, ticks: { ...IMSERV.chartDefaults.scales.y.ticks, callback: v => '£' + (v/1000).toFixed(0) + 'k' } },
        y1: { ...IMSERV.chartDefaults.scales.y, position: 'right', grid: { display: false },
               ticks: { ...IMSERV.chartDefaults.scales.y.ticks, callback: v => v + '%' } },
      },
    },
  }));
}

function updateRangeVal(rangeId, valId, suffix) {
  const range = document.getElementById(rangeId);
  const valEl = document.getElementById(valId);
  if (range && valEl) valEl.textContent = range.value + (suffix || '');
}

async function runScenario() {
  const payload = {
    scenario_name:          document.getElementById('sc-name')?.value      || 'Scenario',
    job_volume:             parseInt(document.getElementById('sc-volume')?.value || 85000),
    completion_rate_pct:    parseFloat(document.getElementById('sc-completion')?.value || 68),
    cancel_rate_pct:        parseFloat(document.getElementById('sc-cancel')?.value || 15),
    abort_rate_pct:         parseFloat(document.getElementById('sc-abort')?.value || 8),
    revenue_uplift_pct:     parseFloat(document.getElementById('sc-revenue-uplift')?.value || 0),
    cost_uplift_pct:        parseFloat(document.getElementById('sc-cost-uplift')?.value || 0),
    engineer_count:         parseInt(document.getElementById('sc-engineers')?.value || 300),
    productivity_jobs_per_day: 4.0,
    region_code: IMSERV.getRegion() || null,
  };

  const resp = await fetch('/api/financial/scenario', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) return;
  const data = await resp.json();
  renderScenarioResults(data);
}

function renderScenarioResults(data) {
  const panel = document.getElementById('scenario-results');
  if (panel) panel.style.display = 'block';

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  document.getElementById('sc-result-title').textContent = `📊 Scenario: ${data.scenario_name}`;
  set('sc-res-revenue',    IMSERV.fmt.gbpM(data.revenue_gbp));
  set('sc-res-cost',       IMSERV.fmt.gbpM(data.total_cost_gbp));
  set('sc-res-margin',     IMSERV.fmt.gbpM(data.margin_gbp));
  set('sc-res-margin-pct', IMSERV.fmt.pct(data.margin_pct));
  set('sc-res-cpp',        IMSERV.fmt.gbp(data.cost_per_completion));
  set('sc-res-capacity',   data.capacity_rag);

  // Waterfall chart
  const ctx = document.getElementById('waterfall-chart');
  if (ctx && data.waterfall) {
    const wf = data.waterfall;
    const colors = wf.map(b => b.type === 'base' ? 'rgba(0,82,204,0.7)' : (b.type === 'cost' ? 'rgba(239,68,68,0.65)' : (b.value >= 0 ? 'rgba(16,185,129,0.65)' : 'rgba(239,68,68,0.5)')));
    IMSERV.registerChart('waterfall', new Chart(ctx, {
      type: 'bar',
      data: {
        labels: wf.map(b => b.label),
        datasets: [{ data: wf.map(b => Math.abs(b.value)), backgroundColor: colors }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { ...IMSERV.chartDefaults.plugins, legend: { display: false } },
        scales: {
          ...IMSERV.chartDefaults.scales,
          y: { ...IMSERV.chartDefaults.scales.y, ticks: { ...IMSERV.chartDefaults.scales.y.ticks, callback: v => '£' + (v/1000).toFixed(0) + 'k' } },
        },
      },
    }));
  }
}

function resetScenario() {
  const defaults = { 'sc-completion': 68, 'sc-cancel': 15, 'sc-abort': 8, 'sc-revenue-uplift': 0, 'sc-cost-uplift': 0 };
  Object.entries(defaults).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  });
  updateRangeVal('sc-completion', 'sc-completion-val', '%');
  updateRangeVal('sc-cancel',     'sc-cancel-val',     '%');
  updateRangeVal('sc-abort',      'sc-abort-val',      '%');
  updateRangeVal('sc-revenue-uplift', 'sc-rev-val',    '%');
  updateRangeVal('sc-cost-uplift', 'sc-cost-val',      '%');

  const panel = document.getElementById('scenario-results');
  if (panel) panel.style.display = 'none';
}
