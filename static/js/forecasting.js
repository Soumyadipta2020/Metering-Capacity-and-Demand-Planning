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

  if (kpis) renderForecastKPIs(kpis, funnel);
  if (kpis) renderChannelBreakdown(kpis);
  if (funnel) renderFunnelMetrics(funnel);

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
          label: 'Historical Request Contacts',
          data: [...histValues, ...histPad],
          borderColor: IMSERV.colors.info,
          backgroundColor: 'rgba(59,130,246,0.08)',
          fill: true, tension: 0.4, pointRadius: 0, borderWidth: 2,
        },
        {
          label: 'P50 Demand Forecast',
          data: [...forecastPad, ...data.p50],
          borderColor: IMSERV.colors.accent,
          backgroundColor: 'rgba(0,184,217,0.10)',
          fill: false, tension: 0.4, pointRadius: 0, borderWidth: 2.5, borderDash: [6,3],
        },
        {
          label: 'P90 High Demand',
          data: [...forecastPad, ...data.p90],
          borderColor: 'rgba(245,158,11,0.5)',
          backgroundColor: 'rgba(245,158,11,0.06)',
          fill: '+1', tension: 0.4, pointRadius: 0, borderWidth: 1, borderDash: [3,3],
        },
        {
          label: 'P10 Low Demand',
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
  const requests = f.requests || 0;
  const visits = f.visits ?? Math.max((f.bookings || 0) - (f.cancellations || 0), 0);
  const successfulVisits = f.post_abort_visits ?? Math.max(visits - (f.aborts || 0), 0);
  const completions = f.completions || 0;
  const notCompleted = f.not_completed_after_successful_visit ?? Math.max(successfulVisits - completions, 0);
  const reasons = (funnel.not_completed_reasons || []).slice(0, 4);
  const reasonHtml = reasons.length ? reasons.map(r => `
    <div style="display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; align-items:center;">
      <span style="font-size:11px; color:var(--text-secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${r.reason}</span>
      <strong style="font-size:12px; color:var(--text-primary);">${IMSERV.fmt.num(r.count)}</strong>
      <div style="grid-column:1 / -1; height:4px; border-radius:999px; background:rgba(255,255,255,0.06); overflow:hidden;">
        <div style="height:100%; width:${Math.max(4, Math.min(100, r.pct || 0))}%; background:rgba(56,189,248,0.75);"></div>
      </div>
    </div>
  `).join('') : '<div style="font-size:11px; color:var(--text-muted);">No unresolved successful visits</div>';

  body.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:14px; padding: 10px 0;">
      <!-- Main Funnel Path -->
      <div style="display:grid; grid-template-columns:1fr .65fr 1fr 1fr 1.08fr; gap:4px; min-height:88px; position:relative;">
        
        <!-- Requests -->
        <div style="background: linear-gradient(135deg, rgba(59,130,246,0.05), rgba(59,130,246,0.15)); border: 1px solid rgba(59,130,246,0.2); border-radius: 8px 0 0 8px; display:flex; flex-direction:column; justify-content:center; align-items:center; position:relative; min-width:0;">
          <div style="font-size:12px; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; font-weight:600;">Requests</div>
          <div style="font-size:26px; font-weight:800; color:var(--info);">${IMSERV.fmt.num(requests)}</div>
          <div style="position:absolute; right:-12px; top:50%; transform:translateY(-50%); width:0; height:0; border-top: 16px solid transparent; border-bottom: 16px solid transparent; border-left: 12px solid rgba(59,130,246,0.3); z-index:2;"></div>
        </div>

        <!-- Contacts -->
        <div style="background: linear-gradient(135deg, rgba(59,130,246,0.08), rgba(59,130,246,0.16)); border: 1px solid rgba(59,130,246,0.28); display:flex; flex-direction:column; justify-content:center; align-items:center; position:relative; min-width:0;">
          <div style="font-size:12px; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; font-weight:600;">Contacts</div>
          <div style="font-size:22px; font-weight:800; color:var(--info);">${IMSERV.fmt.num(f.contacts)}</div>
          <div style="position:absolute; right:-12px; top:50%; transform:translateY(-50%); width:0; height:0; border-top: 16px solid transparent; border-bottom: 16px solid transparent; border-left: 12px solid rgba(59,130,246,0.4); z-index:2;"></div>
        </div>

        <!-- Visits -->
        <div style="background: linear-gradient(135deg, rgba(16,185,129,0.05), rgba(16,185,129,0.15)); border: 1px solid rgba(16,185,129,0.2); display:flex; flex-direction:column; justify-content:center; align-items:center; position:relative; min-width:0;">
          <div style="font-size:12px; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; font-weight:600;">Visits</div>
          <div style="font-size:26px; font-weight:800; color:var(--ok);">${IMSERV.fmt.num(visits)}</div>
          <div style="position:absolute; right:-12px; top:50%; transform:translateY(-50%); width:0; height:0; border-top: 16px solid transparent; border-bottom: 16px solid transparent; border-left: 12px solid rgba(16,185,129,0.3); z-index:2;"></div>
        </div>

        <!-- Successful Visits -->
        <div style="background: linear-gradient(135deg, rgba(16,185,129,0.10), rgba(16,185,129,0.20)); border: 1px solid rgba(16,185,129,0.32); display:flex; flex-direction:column; justify-content:center; align-items:center; position:relative; min-width:0;">
          <div style="font-size:12px; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; font-weight:600;">Successful Visits</div>
          <div style="font-size:26px; font-weight:800; color:var(--ok);">${IMSERV.fmt.num(successfulVisits)}</div>
          <div style="position:absolute; right:-12px; top:50%; transform:translateY(-50%); width:0; height:0; border-top: 16px solid transparent; border-bottom: 16px solid transparent; border-left: 12px solid rgba(16,185,129,0.4); z-index:2;"></div>
        </div>

        <!-- Completions -->
        <div style="background: linear-gradient(135deg, rgba(16,185,129,0.15), rgba(16,185,129,0.25)); border: 1px solid rgba(16,185,129,0.4); border-radius: 0 8px 8px 0; display:flex; flex-direction:column; justify-content:center; align-items:center; box-shadow: inset 0 0 12px rgba(16,185,129,0.1); min-width:0;">
          <div style="font-size:12px; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; font-weight:600;">Successful Completions</div>
          <div style="font-size:26px; font-weight:800; color:var(--ok);">${IMSERV.fmt.num(completions)}</div>
        </div>

      </div>

      <!-- Falloff branches -->
      <div style="display:grid; grid-template-columns:1fr .65fr 1fr 1fr 1.08fr; gap:12px; align-items:start;">
        <div></div>
        <div>
          <div style="height:18px; width:50%; border-right:2px dashed rgba(239,68,68,0.35); border-bottom:2px dashed rgba(239,68,68,0.35); border-bottom-right-radius:10px; margin-top:-8px;"></div>
          <div style="background: rgba(239, 68, 68, 0.05); border: 1px solid rgba(239, 68, 68, 0.15); border-left: 4px solid var(--crit); padding: 12px 14px; border-radius: 8px;">
            <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; font-weight:700; letter-spacing: 0.5px;">Cancellations</div>
            <div style="font-size:20px; font-weight:800; color:var(--crit); margin-top:2px;">${IMSERV.fmt.num(f.cancellations)}</div>
          </div>
        </div>
        <div>
          <div style="height:18px; width:50%; border-right:2px dashed rgba(245,158,11,0.45); border-bottom:2px dashed rgba(245,158,11,0.45); border-bottom-right-radius:10px; margin-top:-8px;"></div>
          <div style="background: rgba(245, 158, 11, 0.05); border: 1px solid rgba(245, 158, 11, 0.15); border-left: 4px solid var(--warn); padding: 12px 14px; border-radius: 8px;">
            <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; font-weight:700; letter-spacing: 0.5px;">Aborts</div>
            <div style="font-size:20px; font-weight:800; color:var(--warn); margin-top:2px;">${IMSERV.fmt.num(f.aborts)}</div>
          </div>
        </div>
        <div style="grid-column:4 / 6;">
          <div style="height:18px; width:28%; border-right:2px dashed rgba(56,189,248,0.38); border-bottom:2px dashed rgba(56,189,248,0.38); border-bottom-right-radius:10px; margin-top:-8px;"></div>
          <div style="background: rgba(56, 189, 248, 0.05); border: 1px solid rgba(56, 189, 248, 0.15); border-left: 4px solid var(--info); padding: 12px 14px; border-radius: 8px;">
            <div style="display:flex; justify-content:space-between; gap:12px; align-items:baseline;">
              <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; font-weight:700; letter-spacing: 0.5px;">Not Completed</div>
              <div style="font-size:20px; font-weight:800; color:var(--info);">${IMSERV.fmt.num(notCompleted)}</div>
            </div>
            <div style="display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px; margin-top:10px;">
              ${reasonHtml}
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="mt-8" style="border-top: 1px solid rgba(255,255,255,0.05); padding-top: 16px; display:flex; gap: 16px; justify-content:center; flex-wrap:wrap;">
      <div class="stat-chip" style="font-size: 13px; padding: 6px 14px; background: rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05);">Visit Rate: <strong style="color:var(--text-primary); margin-left:4px;">${IMSERV.fmt.pct(funnel.visit_rate)}</strong></div>
      <div class="stat-chip" style="font-size: 13px; padding: 6px 14px; background: rgba(16,185,129,0.05); border:1px solid rgba(16,185,129,0.1);">Completion Rate: <strong style="color:var(--ok); margin-left:4px;">${IMSERV.fmt.pct(funnel.completion_rate)}</strong></div>
      <div class="stat-chip" style="font-size: 13px; padding: 6px 14px; background: rgba(16,185,129,0.05); border:1px solid rgba(16,185,129,0.1);">Visit Success: <strong style="color:var(--ok); margin-left:4px;">${IMSERV.fmt.pct(funnel.visit_success_rate)}</strong></div>
      <div class="stat-chip" style="font-size: 13px; padding: 6px 14px; background: rgba(56,189,248,0.05); border:1px solid rgba(56,189,248,0.1);">Completion Gap: <strong style="color:var(--info); margin-left:4px;">${IMSERV.fmt.num(notCompleted)}</strong></div>
      <div class="stat-chip" style="font-size: 13px; padding: 6px 14px; background: rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05);">Avg Contacts: <strong style="color:var(--text-primary); margin-left:4px;">${funnel.avg_contacts_per_customer}</strong></div>
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
  const container = document.getElementById('channel-comparison-grid');
  if (!container) return;
  const channels = kpis.channel_breakdown || [];
  if (!channels.length) {
     container.innerHTML = '<div class="empty-state"><div class="empty-title">No data available</div></div>';
     return;
  }

  const sorted = [...channels].sort((a, b) => b.volume - a.volume);
  const maxVolume = Math.max(...sorted.map(c => c.volume), 1);
  const maxBookings = Math.max(...sorted.map(c => c.bookings), 1);
  const totalVolume = sorted.reduce((sum, c) => sum + c.volume, 0);
  const totalBookings = sorted.reduce((sum, c) => sum + c.bookings, 0);
  const totalAbandoned = sorted.reduce((sum, c) => sum + c.abandon_pct * c.volume / 100, 0);
  const blendedConversion = totalVolume ? (totalBookings / totalVolume) * 100 : 0;
  const blendedAbandon = totalVolume ? (totalAbandoned / totalVolume) * 100 : 0;

  const positions = [
    { x: 18, y: 46 },
    { x: 33, y: 18 },
    { x: 68, y: 18 },
    { x: 82, y: 48 },
    { x: 66, y: 76 },
    { x: 31, y: 77 },
  ];
  const accent = ['#38bdf8', '#22c55e', '#a78bfa', '#f59e0b', '#fb7185', '#14b8a6'];

  const escapeHtml = (value) => String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const channelCode = (name) => {
    const clean = name.replace(/[^A-Za-z ]/g, '').trim();
    if (clean.toLowerCase() === 'agent callback') return 'CB';
    return clean.split(/\s+/).map(part => part[0]).join('').slice(0, 3).toUpperCase();
  };

  const ribbons = sorted.map((c, idx) => {
    const pos = positions[idx % positions.length];
    const stroke = Math.max(1.2, Math.min(4.2, 1.2 + (c.bookings / maxBookings) * 3));
    const mx = (pos.x + 50) / 2;
    const my = (pos.y + 48) / 2;
    const bend = idx % 2 === 0 ? -8 : 8;
    return `
      <path
        class="channel-ribbon"
        d="M ${pos.x} ${pos.y} Q ${mx} ${my + bend} 50 48"
        style="--flow-color:${accent[idx % accent.length]}; --flow-width:${stroke};"
      />
    `;
  }).join('');

  const nodes = sorted.map((c, idx) => {
    const pos = positions[idx % positions.length];
    const size = Math.round(84 + (c.volume / maxVolume) * 76);
    const conversion = Math.max(0, Math.min(100, c.conversion_pct || 0));
    const abandon = Math.max(0, Math.min(100, c.abandon_pct || 0));
    const share = totalVolume ? (c.volume / totalVolume) * 100 : 0;
    const colour = accent[idx % accent.length];
    const safeName = escapeHtml(c.channel);

    return `
      <button
        class="channel-orb"
        style="--x:${pos.x}%; --y:${pos.y}%; --size:${size}px; --channel-color:${colour}; --conversion:${conversion * 3.6}deg; --abandon:${Math.max(10, abandon * 3.6)}deg;"
        title="${safeName}: ${IMSERV.fmt.num(c.volume)} interactions, ${IMSERV.fmt.pct(conversion)} conversion"
        aria-label="${safeName} channel signal"
      >
        <span class="channel-orb-ring"></span>
        <span class="channel-orb-core">
          <span class="channel-orb-code">${channelCode(c.channel)}</span>
          <span class="channel-orb-name">${safeName}</span>
          <span class="channel-orb-volume">${IMSERV.fmt.num(c.volume)}</span>
        </span>
        <span class="channel-orb-marker" title="${IMSERV.fmt.pct(abandon)} abandoned"></span>
        <span class="channel-orb-metrics">
          <strong>${IMSERV.fmt.pct(conversion)}</strong>
          <em>${IMSERV.fmt.num(c.bookings)} bookings</em>
          <small>${share.toFixed(1)}% of volume</small>
        </span>
      </button>
    `;
  }).join('');

  const insight = sorted[0];
  const bestConversion = [...sorted].sort((a, b) => b.conversion_pct - a.conversion_pct)[0];
  const mostAbandoned = [...sorted].sort((a, b) => b.abandon_pct - a.abandon_pct)[0];

  container.innerHTML = `
    <div class="channel-map-stage">
      <svg class="channel-ribbons" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        ${ribbons}
      </svg>

      <div class="booking-core">
        <div class="booking-core-ring"></div>
        <div class="booking-core-label">Bookings Core</div>
        <div class="booking-core-value">${IMSERV.fmt.num(totalBookings)}</div>
        <div class="booking-core-sub">${IMSERV.fmt.pct(blendedConversion)} conversion</div>
      </div>

      ${nodes}
    </div>

    <div class="channel-storyline">
      <div class="channel-story-pill dominant">
        <span>Dominant intake</span>
        <strong>${escapeHtml(insight.channel)}</strong>
        <em>${IMSERV.fmt.num(insight.volume)} interactions</em>
      </div>
      <div class="channel-story-pill efficient">
        <span>Most efficient</span>
        <strong>${escapeHtml(bestConversion.channel)}</strong>
        <em>${IMSERV.fmt.pct(bestConversion.conversion_pct)} conversion</em>
      </div>
      <div class="channel-story-pill friction">
        <span>Highest friction</span>
        <strong>${escapeHtml(mostAbandoned.channel)}</strong>
        <em>${IMSERV.fmt.pct(mostAbandoned.abandon_pct)} abandoned</em>
      </div>
      <div class="channel-story-pill">
        <span>Blended abandon</span>
        <strong>${IMSERV.fmt.pct(blendedAbandon)}</strong>
        <em>across channels</em>
      </div>
    </div>
  `;
}
