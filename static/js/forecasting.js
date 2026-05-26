/* IMSERV — Module 2: Contact Centre Forecasting */

let _forecastChart = null;
let _activeForecastTab = 'overview';

async function loadForecastingDashboard() {
  const region = IMSERV.getRegion();
  const year   = IMSERV.getYear();
  const qs     = `?region=${region}&year=${year}`;

  const [kpis, funnel] = await Promise.all([
    IMSERV.apiFetch('/api/forecasting/channel-kpis' + qs),
    IMSERV.apiFetch('/api/forecasting/funnel' + qs),
  ]);

  if (kpis) renderForecastKPIs(kpis);
  if (kpis) renderChannelBreakdown(kpis);
  if (funnel) renderFunnelMetrics(funnel);

  loadActiveForecastTabData();
}

function renderForecastKPIs(kpis) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('fc-kpi-volume',     IMSERV.fmt.num(kpis.total_volume));
  set('fc-kpi-bookings',   IMSERV.fmt.num(kpis.total_bookings));
  set('fc-kpi-conversion', IMSERV.fmt.pct(kpis.conversion_rate));
  set('fc-kpi-abandon',    IMSERV.fmt.pct(kpis.abandon_rate));
}

function renderChannelBreakdown(kpis) {
  const channels = kpis.channel_breakdown || [];

  // Doughnut chart
  const ctx = document.getElementById('channel-breakdown-chart');
  if (ctx && channels.length) {
    const colours = ['#0052CC','#00B8D9','#10B981','#F59E0B','#EF4444','#8B5CF6'];
    IMSERV.registerChart('channel-breakdown', new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: channels.map(c => c.channel),
        datasets: [{
          data: channels.map(c => c.volume),
          backgroundColor: colours.slice(0, channels.length),
          borderColor: '#0E1829',
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          ...IMSERV.chartDefaults.plugins,
          legend: { position: 'right', labels: { color: '#8B9DC3', font: { size: 11 }, padding: 10 } },
        },
      },
    }));
  }

  // Table
  const tbody = document.getElementById('channel-table-body');
  if (tbody) {
    tbody.innerHTML = channels.map(c => `
      <tr>
        <td><strong>${c.channel}</strong></td>
        <td>${IMSERV.fmt.num(c.volume)}</td>
        <td>${IMSERV.fmt.num(c.bookings)}</td>
        <td><strong class="text-ok">${IMSERV.fmt.pct(c.conversion_pct)}</strong></td>
        <td><span class="text-warn">${IMSERV.fmt.pct(c.abandon_pct)}</span></td>
      </tr>
    `).join('');
  }
}

async function loadForecast() {
  const region  = IMSERV.getRegion();
  const channel = document.getElementById('forecast-channel-filter')?.value || '';
  const qs = `?region=${region}&channel=${channel}&weeks=26`;

  const data = await IMSERV.apiFetch('/api/forecasting/forecast' + qs);
  if (!data) return;

  renderForecastChart(data);
  renderModelAccuracy(data.model_accuracy || {});
  renderModelComparison(data);
}

function renderForecastChart(data) {
  const ctx = document.getElementById('forecast-chart');
  if (!ctx) return;

  // Trim history to last 26 weeks for readability
  const hLen = Math.min(26, (data.history_labels || []).length);
  const histLabels = (data.history_labels || []).slice(-hLen);
  const histValues = (data.history_values  || []).slice(-hLen);

  const allLabels   = [...histLabels, ...data.labels];
  const histPad     = Array(data.labels.length).fill(null);
  const forecastPad = Array(histLabels.length).fill(null);

  IMSERV.registerChart('forecast', new Chart(ctx, {
    type: 'line',
    data: {
      labels: allLabels,
      datasets: [
        {
          label: 'Historical',
          data: [...histValues, ...histPad],
          borderColor: IMSERV.colors.info,
          backgroundColor: 'rgba(59,130,246,0.08)',
          fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2,
        },
        {
          label: 'P50 Forecast',
          data: [...forecastPad, ...data.p50],
          borderColor: IMSERV.colors.accent,
          backgroundColor: 'rgba(0,184,217,0.10)',
          fill: false, tension: 0.4, pointRadius: 0, borderWidth: 2.5, borderDash: [6,3],
        },
        {
          label: 'P90',
          data: [...forecastPad, ...data.p90],
          borderColor: 'rgba(245,158,11,0.5)',
          backgroundColor: 'rgba(245,158,11,0.06)',
          fill: '+1', tension: 0.4, pointRadius: 0, borderWidth: 1, borderDash: [3,3],
        },
        {
          label: 'P10',
          data: [...forecastPad, ...data.p10],
          borderColor: 'rgba(245,158,11,0.5)',
          backgroundColor: 'rgba(245,158,11,0.06)',
          fill: false, tension: 0.4, pointRadius: 0, borderWidth: 1, borderDash: [3,3],
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: IMSERV.chartDefaults.plugins,
      scales: {
        ...IMSERV.chartDefaults.scales,
        x: { ...IMSERV.chartDefaults.scales.x, ticks: { ...IMSERV.chartDefaults.scales.x.ticks, maxTicksLimit: 16 } },
      },
    },
  }));
}

function renderModelAccuracy(accuracy) {
  const tbody = document.getElementById('model-accuracy-body');
  if (!tbody) return;
  const models = Object.keys(accuracy);
  if (!models.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-muted">No accuracy data</td></tr>';
    return;
  }
  tbody.innerHTML = models.map(m => {
    const d = accuracy[m];
    return `
      <tr>
        <td><strong>${m}</strong></td>
        <td>${d.mae?.toFixed(1) || '—'}</td>
        <td>${d.rmse?.toFixed(1) || '—'}</td>
        <td><span class="${d.mape < 6 ? 'text-ok' : (d.mape < 10 ? 'text-warn' : 'text-crit')}">${d.mape?.toFixed(2) || '—'}%</span></td>
      </tr>
    `;
  }).join('');
}

function renderModelComparison(data) {
  const ctx = document.getElementById('model-comparison-chart');
  if (!ctx || !data.model_forecasts) return;
  const modelColors = { Prophet: '#0052CC', ARIMA: '#10B981', XGBoost: '#F59E0B', LightGBM: '#8B5CF6' };
  const datasets = Object.entries(data.model_forecasts).map(([m, vals]) => ({
    label: m,
    data: vals.slice(0, 26),
    borderColor: modelColors[m] || IMSERV.colors.accent,
    fill: false, tension: 0.4, pointRadius: 0, borderWidth: 1.5,
  }));
  IMSERV.registerChart('model-comparison', new Chart(ctx, {
    type: 'line',
    data: { labels: data.labels.slice(0, 26), datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: IMSERV.chartDefaults.plugins,
      scales: IMSERV.chartDefaults.scales,
    },
  }));
}

function renderFunnelMetrics(funnel) {
  const body = document.getElementById('funnel-metrics-body');
  if (!body || !funnel) return;
  const f = funnel.funnel || {};
  body.innerHTML = `
    <div class="kpi-grid" style="grid-template-columns:1fr 1fr;gap:10px;margin-bottom:0">
      <div class="kpi-card info"><div class="kpi-label">Requests</div><div class="kpi-value large">${IMSERV.fmt.num(f.requests)}</div><div class="kpi-icon">📋</div></div>
      <div class="kpi-card info"><div class="kpi-label">Contacts</div><div class="kpi-value large">${IMSERV.fmt.num(f.contacts)}</div><div class="kpi-icon">📞</div></div>
      <div class="kpi-card ok"><div class="kpi-label">Bookings</div><div class="kpi-value large">${IMSERV.fmt.num(f.bookings)}</div><div class="kpi-icon">📅</div></div>
      <div class="kpi-card ok"><div class="kpi-label">Completions</div><div class="kpi-value large">${IMSERV.fmt.num(f.completions)}</div><div class="kpi-icon">✅</div></div>
      <div class="kpi-card warn"><div class="kpi-label">Cancellations</div><div class="kpi-value large">${IMSERV.fmt.num(f.cancellations)}</div><div class="kpi-icon">❌</div></div>
      <div class="kpi-card warn"><div class="kpi-label">Aborts</div><div class="kpi-value large">${IMSERV.fmt.num(f.aborts)}</div><div class="kpi-icon">🚫</div></div>
    </div>
    <div class="mt-12">
      <div class="stat-chip">Booking Rate: <strong>${IMSERV.fmt.pct(funnel.booking_rate)}</strong></div>
      <span style="width:8px;display:inline-block"></span>
      <div class="stat-chip">Completion Rate: <strong>${IMSERV.fmt.pct(funnel.completion_rate)}</strong></div>
      <span style="width:8px;display:inline-block"></span>
      <div class="stat-chip">Avg Contacts: <strong>${funnel.avg_contacts_per_customer}</strong></div>
    </div>
  `;
}

async function loadConversionTrend() {
  const region = IMSERV.getRegion();
  const year   = IMSERV.getYear();
  const funnel = await IMSERV.apiFetch('/api/forecasting/funnel?region=' + region + '&year=' + year);
  if (!funnel) return;

  const ctx = document.getElementById('conversion-trend-chart');
  if (!ctx) return;

  const trend = funnel.weekly_trend || [];
  const labels  = trend.map(t => t.week.substring(0, 10));
  const bk = trend.map(t => t.bookings);
  const cp = trend.map(t => t.completions);
  const cr = trend.map(t => t.completion_rate);

  IMSERV.registerChart('conversion-trend', new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Bookings',    data: bk, backgroundColor: 'rgba(0,82,204,0.5)',  yAxisID: 'y' },
        { label: 'Completions', data: cp, backgroundColor: 'rgba(16,185,129,0.5)',yAxisID: 'y' },
        { label: 'Completion %',data: cr, borderColor: IMSERV.colors.accent, type: 'line', fill: false, tension: 0.4, pointRadius: 0, yAxisID: 'y1' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: IMSERV.chartDefaults.plugins,
      scales: {
        ...IMSERV.chartDefaults.scales,
        y:  { ...IMSERV.chartDefaults.scales.y, position: 'left' },
        y1: { ...IMSERV.chartDefaults.scales.y, position: 'right', grid: { display: false },
               ticks: { ...IMSERV.chartDefaults.scales.y.ticks, callback: v => v + '%' } },
      },
    },
  }));
}

function switchForecastTab(name, el) {
  _activeForecastTab = name;
  document.querySelectorAll('.forecast-tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('#view-forecasting .tab-item').forEach(t => t.classList.remove('active'));
  const panel = document.getElementById('ftab-' + name);
  if (panel) panel.classList.add('active');
  if (el) el.classList.add('active');
  requestAnimationFrame(loadActiveForecastTabData);
}

function loadActiveForecastTabData() {
  if (_activeForecastTab === 'forecast') {
    loadForecast();
  } else if (_activeForecastTab === 'funnel') {
    loadConversionTrend();
  } else if (_activeForecastTab === 'channels') {
    loadChannelComparison();
  }
}

async function loadChannelComparison() {
  const region = IMSERV.getRegion();
  const year   = IMSERV.getYear();
  const kpis = await IMSERV.apiFetch('/api/forecasting/channel-kpis?region=' + region + '&year=' + year);
  if (!kpis) return;
  const ctx = document.getElementById('channel-comparison-chart');
  if (!ctx) return;
  const channels = kpis.channel_breakdown || [];
  if (!channels.length) return;
  IMSERV.registerChart('channel-comparison', new Chart(ctx, {
    type: 'bar',
    data: {
      labels: channels.map(c => c.channel),
      datasets: [
        { label: 'Volume',     data: channels.map(c => c.volume),   backgroundColor: 'rgba(0,82,204,0.6)'   },
        { label: 'Bookings',   data: channels.map(c => c.bookings), backgroundColor: 'rgba(16,185,129,0.6)' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: IMSERV.chartDefaults.plugins,
      scales: IMSERV.chartDefaults.scales,
    },
  }));
}
