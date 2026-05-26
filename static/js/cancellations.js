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
  // Sort categories by count descending for better horizontal bar visual
  const sortedCats = [...cats].sort((a, b) => b.count - a.count);
  const colours = ['#EF4444','#F59E0B','#3B82F6','#10B981','#8B5CF6'];
  
  IMSERV.registerChart('category', new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sortedCats.map(c => c.category),
      datasets: [{
        label: 'Count',
        data: sortedCats.map(c => c.count),
        backgroundColor: colours.slice(0, sortedCats.length).map(c => c + 'B3'),
        borderColor: colours.slice(0, sortedCats.length),
        borderWidth: 1,
        borderRadius: 4,
      }],
    },
    options: {
      indexAxis: 'y', // Makes it horizontal
      responsive: true, maintainAspectRatio: false,
      plugins: {
        ...IMSERV.chartDefaults.plugins,
        legend: { display: false }, // Hide legend since y-axis has labels
      },
      scales: {
        ...IMSERV.chartDefaults.scales,
        x: { ...IMSERV.chartDefaults.scales.y, grid: { color: 'rgba(255,255,255,0.05)' } },
        y: { ...IMSERV.chartDefaults.scales.x, grid: { display: false } },
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
  const ctx = document.getElementById('cancel-regional-chart');
  if (!ctx || !data || !data.length) return;

  IMSERV.registerChart('cancel-regional', new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(r => r.region_code),
      datasets: [
        { label: 'Cancel Rate %', data: data.map(r => r.cancel_rate), backgroundColor: 'rgba(239,68,68,0.7)', borderRadius: 4 },
        { label: 'Abort Rate %', data: data.map(r => r.abort_rate), backgroundColor: 'rgba(245,158,11,0.7)', borderRadius: 4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: IMSERV.chartDefaults.plugins,
      scales: {
        ...IMSERV.chartDefaults.scales,
        x: { ...IMSERV.chartDefaults.scales.x, stacked: true },
        y: { ...IMSERV.chartDefaults.scales.y, stacked: true, ticks: { ...IMSERV.chartDefaults.scales.y.ticks, callback: v => v + '%' } },
      },
    },
  }));
}

async function loadCancellationRisk() {
  const region = document.getElementById('cancel-predict-region')?.value || 'NW';
  const data = await IMSERV.apiFetch('/api/cancellations/predict?region=' + region);
  const panel = document.getElementById('cancel-risk-panel');
  if (!panel || !data) return;

  let gaugeColor = 'var(--ok)';
  let shadowColor = 'rgba(16, 185, 129, 0.2)';
  if (data.risk_level === 'Critical') {
    gaugeColor = 'var(--crit)';
    shadowColor = 'rgba(239, 68, 68, 0.2)';
  } else if (data.risk_level === 'High') {
    gaugeColor = 'var(--warn)';
    shadowColor = 'rgba(245, 158, 11, 0.2)';
  }
  
  let trendColor = data.trend_direction === 'Rising' ? 'var(--crit)' : 'var(--ok)';
  let trendIcon = data.trend_direction === 'Rising' ? '↗' : '↘';

  const driversHtml = (data.drivers || []).map(d => {
    const dotColor = d.impact === 'Critical' ? 'var(--crit)' : (d.impact === 'High' ? 'var(--warn)' : 'var(--ok)');
    return `
      <div style="background:var(--bg-card); border:1px solid var(--border); border-radius:20px; padding:6px 12px; font-size:12px; color:var(--text-secondary); display:flex; align-items:center; gap:6px; box-shadow: 0 2px 8px rgba(0,0,0,0.2);">
        <span style="width:8px; height:8px; border-radius:50%; background:${dotColor};"></span>
        ${d.driver} <strong style="color:var(--text-primary)">${d.value}</strong>
      </div>
    `;
  }).join('') || '<span style="color:var(--text-muted); font-size:12px;">None identified</span>';

  panel.innerHTML = `
    <div style="display:flex; flex-wrap:wrap; gap: 30px; align-items: stretch; background: var(--bg-surface); padding: 24px; border-radius: var(--radius-md); border: 1px solid var(--border);">
      
      <!-- Left: The Gauge -->
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-width: 160px; border-right: 1px solid rgba(255,255,255,0.05); padding-right: 30px;">
        <div style="position:relative; width: 140px; height: 140px; border-radius: 50%; background: conic-gradient(${gaugeColor} ${data.risk_score}%, var(--bg-card) 0); display:flex; align-items:center; justify-content:center; box-shadow: 0 0 30px ${shadowColor}; margin-bottom: 16px;">
           <div style="position:absolute; width: 120px; height: 120px; background: var(--bg-surface); border-radius: 50%; display:flex; flex-direction:column; align-items:center; justify-content:center;">
              <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; font-weight:600; letter-spacing:1px;">Score</div>
              <div style="font-size:36px; font-weight:800; color:var(--text-primary); line-height:1; margin-top:2px;">${data.risk_score}</div>
           </div>
        </div>
        <div style="font-size:18px; font-weight:700; color:${gaugeColor}; text-transform:uppercase; letter-spacing:1px;">${data.risk_level}</div>
      </div>

      <!-- Middle: Key Metrics -->
      <div style="display:flex; flex-direction:column; justify-content:center; min-width: 180px; border-right: 1px solid rgba(255,255,255,0.05); padding-right: 30px; gap: 24px;">
        <div>
          <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; font-weight:600; letter-spacing:1px; margin-bottom:6px;">Cancel Rate</div>
          <div style="font-size:32px; font-weight:700; color:var(--text-primary);">${IMSERV.fmt.pct(data.cancel_rate)}</div>
        </div>
        <div>
          <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; font-weight:600; letter-spacing:1px; margin-bottom:6px;">Trend</div>
          <div style="font-size:32px; font-weight:700; color:${trendColor}; display:flex; align-items:center; gap:8px;">${data.trend_direction} <span style="font-size:24px;">${trendIcon}</span></div>
        </div>
      </div>

      <!-- Right: Insights & Drivers -->
      <div style="flex:1; display:flex; flex-direction:column; gap: 16px; justify-content:center; min-width: 250px;">
        <div style="background: rgba(0, 184, 217, 0.08); border-left: 3px solid var(--brand-accent); padding: 12px 16px; border-radius: 0 8px 8px 0;">
          <div style="font-size:11px; color:var(--brand-accent); text-transform:uppercase; font-weight:700; letter-spacing:1px; margin-bottom:6px;">💡 AI Recommendation</div>
          <div style="font-size:13px; color:var(--text-primary); line-height:1.5;">${data.recommendations[0] || 'Maintain current operational strategies.'}</div>
        </div>
        <div>
          <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; font-weight:600; letter-spacing:1px; margin-bottom:8px;">⚠️ Primary Risk Drivers</div>
          <div style="display:flex; flex-wrap:wrap; gap:8px;">
            ${driversHtml}
          </div>
        </div>
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
