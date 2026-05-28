/* IMSERV — Module 2: Contact Centre Forecasting */

let _forecastChart = null;
let _activeForecastTab = 'forecast';
let _lastForecastData = null;

async function loadForecastingDashboard() {
  const region = IMSERV.getRegion();
  const year   = IMSERV.getYear();
  const qs     = `?region=${region}&year=${year}`;

  const [kpis, funnel] = await Promise.all([
    IMSERV.apiFetch('/api/forecasting/channel-kpis' + qs),
    IMSERV.apiFetch('/api/forecasting/funnel' + qs),
  ]);

  if (kpis) renderForecastKPIs(kpis, funnel);

  loadActiveForecastTabData();
}

function renderForecastKPIs(kpis, funnel) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const f = funnel?.funnel || {};
  const visits = f.visits ?? Math.max((f.bookings ?? kpis.total_bookings ?? 0) - (f.cancellations ?? 0), 0);
  const contactToVisitRate = kpis.total_volume ? (visits / kpis.total_volume) * 100 : kpis.conversion_rate;
  set('fc-kpi-volume',     IMSERV.fmt.num(kpis.total_volume));
  set('fc-kpi-bookings',   IMSERV.fmt.num(visits));
  set('fc-kpi-conversion', IMSERV.fmt.pct(contactToVisitRate));
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
  const qs = `?region=${region}&channel=${channel}&weeks=52`;

  const data = await IMSERV.apiFetch('/api/forecasting/forecast' + qs);
  if (!data) return;
  _lastForecastData = data;

  renderForecastChart(data);
  renderModelAccuracy(data.model_accuracy || {});

  // Load cancellation trend and risk prediction below the forecast model comparisons
  const cancelTrends = await IMSERV.apiFetch('/api/cancellations/trends' + (region ? `?region=${region}` : ''));
  if (cancelTrends && typeof renderCancelTrend === 'function') {
    renderCancelTrend(cancelTrends);
  }
  if (typeof loadCancellationRisk === 'function') {
    loadCancellationRisk();
  }
}

function onForecastModelChange() {
  if (_lastForecastData) {
    renderForecastChart(_lastForecastData);
  } else {
    loadForecast();
  }
}

function renderForecastChart(data) {
  const ctx = document.getElementById('forecast-chart');
  if (!ctx) return;

  const modelSelect = document.getElementById('forecast-model-filter');
  const modelForecasts = data.model_forecasts || {};
  const modelColors = { Prophet: '#0052CC', ARIMA: '#10B981', XGBoost: '#F59E0B', LightGBM: '#8B5CF6' };
  const selectedModel = modelSelect?.value || '';
  if (modelSelect) {
    const current = modelSelect.value;
    const options = ['<option value="">Ensemble P50</option>']
      .concat(Object.keys(modelForecasts).map(m => `<option value="${m}">${m}</option>`));
    modelSelect.innerHTML = options.join('');
    modelSelect.value = modelForecasts[current] ? current : '';
  }
  const activeModel = modelSelect?.value || '';
  const centralForecast = activeModel && modelForecasts[activeModel]
    ? modelForecasts[activeModel].slice(0, data.labels.length)
    : data.p50;
  const centralLabel = activeModel ? `${activeModel} Demand Forecast` : 'P50 Demand Forecast';
  const centralColor = activeModel ? (modelColors[activeModel] || IMSERV.colors.accent) : IMSERV.colors.accent;

  const horizon = Math.min(52, data.labels?.length || centralForecast.length || 0);
  const weekLabels = Array.from({ length: horizon }, (_, i) => `W${i + 1}`);
  const actual2025 = (data.history_values || []).slice(0, horizon);
  const forecast2026 = centralForecast.slice(0, horizon);
  const p10Band = activeModel
    ? forecast2026.map(v => Math.round(v * 0.8))
    : (data.p10 || []).slice(0, horizon);
  const p90Band = activeModel
    ? forecast2026.map(v => Math.round(v * 1.2))
    : (data.p90 || []).slice(0, horizon);

  IMSERV.destroyChart?.('forecast');
  IMSERV.registerChart('forecast', new Chart(ctx, {
    type: 'line',
    data: {
      labels: weekLabels,
      datasets: [
        {
          label: '2025 Actual Request Contacts',
          data: actual2025,
          borderColor: '#14B8A6',
          backgroundColor: 'rgba(20,184,166,0.08)',
          fill: false,
          tension: 0.4,
          pointRadius: 0,
          borderWidth: 2.5,
        },
        {
          label: activeModel ? `2026 ${activeModel} Forecast` : '2026 Ensemble Forecast (P50)',
          data: forecast2026,
          borderColor: centralColor,
          backgroundColor: 'rgba(0,184,217,0.10)',
          fill: false,
          tension: 0.4,
          pointRadius: 0,
          borderWidth: activeModel ? 2.75 : 2.5,
          borderDash: activeModel ? [] : [6,3],
        },
        {
          label: 'P90 Optimistic',
          data: p90Band,
          borderColor: 'rgba(245,158,11,0.5)',
          backgroundColor: 'rgba(245,158,11,0.06)',
          fill: '+1', tension: 0.4, pointRadius: 0, borderWidth: 1, borderDash: [3,3],
        },
        {
          label: 'P10 Conservative',
          data: p10Band,
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
        x: { ...IMSERV.chartDefaults.scales.x, ticks: { ...IMSERV.chartDefaults.scales.x.ticks, maxTicksLimit: 13 } },
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

function renderModelAccuracyVisual(accuracy) {
  const container = document.getElementById('model-accuracy-body');
  if (!container) return false;
  const rows = Object.entries(accuracy || {})
    .map(([model, d]) => ({ model, ...d }))
    .sort((a, b) => (a.mape ?? 999) - (b.mape ?? 999));

  if (!rows.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-title">No accuracy data</div></div>';
    return true;
  }

  const maxMae = Math.max(...rows.map(d => d.mae || 0), 1);
  const maxRmse = Math.max(...rows.map(d => d.rmse || 0), 1);
  container.innerHTML = rows.map((d, idx) => {
    const accuracyPct = Math.max(0, 100 - (d.mape || 0));
    const tone = d.mape < 6 ? 'strong' : (d.mape < 10 ? 'steady' : 'risk');
    const barColor = tone === 'strong' ? '#10B981' : tone === 'steady' ? '#F59E0B' : '#EF4444';
    const maePct = Math.max(4, (d.mae || 0) / maxMae * 100);
    const rmsePct = Math.max(4, (d.rmse || 0) / maxRmse * 100);
    const label = tone === 'strong' ? 'Best fit' : tone === 'steady' ? 'Planning fit' : 'Watch variance';
    return `
      <div class="model-accuracy-row ${tone}" style="--accuracy:${accuracyPct}%; --mae:${maePct}%; --rmse:${rmsePct}%; --model-color:${barColor};">
        <div class="model-accuracy-main">
          <span class="model-rank">#${idx + 1}</span>
          <div>
            <strong>${d.model}</strong>
            <em>${label}</em>
          </div>
          <b>${accuracyPct.toFixed(1)}%</b>
        </div>
        <div class="model-accuracy-bar"><i></i></div>
        <div class="model-accuracy-metrics">
          <span>MAE <strong>${d.mae?.toFixed(1) || '-'}</strong><i class="mae"></i></span>
          <span>RMSE <strong>${d.rmse?.toFixed(1) || '-'}</strong><i class="rmse"></i></span>
          <span>MAPE <strong>${d.mape?.toFixed(2) || '-'}%</strong></span>
        </div>
      </div>
    `;
  }).join('');
  return true;
}

const _renderModelAccuracyTable = renderModelAccuracy;
renderModelAccuracy = function renderModelAccuracy(accuracy) {
  if (!renderModelAccuracyVisual(accuracy)) _renderModelAccuracyTable(accuracy);
};

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



async function loadConversionTrend() {
  const region = IMSERV.getRegion();
  const year   = IMSERV.getYear();
  const funnel = await IMSERV.apiFetch('/api/forecasting/funnel?region=' + region + '&year=' + year);
  if (!funnel) return;

  const ctx = document.getElementById('conversion-trend-chart');
  if (!ctx) return;

  const trend = funnel.weekly_trend || [];
  const labels  = trend.map(t => t.week.substring(0, 10));
  const visits = trend.map(t => t.visits ?? Math.max((t.bookings || 0) - (t.cancellations || 0), 0));
  const cp = trend.map(t => t.completions);
  const cr = trend.map(t => t.completion_rate);

  IMSERV.registerChart('conversion-trend', new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Visits',                 data: visits, backgroundColor: 'rgba(0,82,204,0.5)',  yAxisID: 'y' },
        { label: 'Successful Completions', data: cp,     backgroundColor: 'rgba(16,185,129,0.5)',yAxisID: 'y' },
        { label: 'Completion Rate %',      data: cr,     borderColor: IMSERV.colors.accent, type: 'line', fill: false, tension: 0.4, pointRadius: 0, yAxisID: 'y1' },
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
  document.querySelectorAll('#forecasting-subnav .nav-subitem').forEach(t => t.classList.remove('active'));
  const panel = document.getElementById('ftab-' + name);
  if (panel) panel.classList.add('active');
  if (el) el.classList.add('active');
  if (typeof activateSidebarSubnav === 'function') activateSidebarSubnav('forecasting', name);
  requestAnimationFrame(loadActiveForecastTabData);
}

function switchForecastSidebarTab(name, el) {
  if (_currentView !== 'forecasting') {
    switchView('forecasting', document.querySelector('.nav-item[data-view="forecasting"]'));
  }
  switchForecastTab(name, el);
}

function loadActiveForecastTabData() {
  loadForecast();
}
