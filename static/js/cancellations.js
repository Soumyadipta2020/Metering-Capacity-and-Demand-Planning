/* IMSERV - Module 3: Cancellations & Aborts */

async function loadCancellationsDashboard() {
  const region = IMSERV.getRegion();
  const year = IMSERV.getYear();
  const qs = `?region=${region}&year=${year}`;

  const [kpis, rootCauses, trends, heatmap, rebook] = await Promise.all([
    IMSERV.apiFetch('/api/cancellations/kpis' + qs),
    IMSERV.apiFetch('/api/cancellations/root-causes' + qs),
    IMSERV.apiFetch('/api/cancellations/trends' + (region ? `?region=${region}` : '')),
    IMSERV.apiFetch('/api/cancellations/heatmap' + `?year=${year}`),
    IMSERV.apiFetch('/api/cancellations/rebooking' + qs),
  ]);

  if (kpis) renderCancelKPIs(kpis);
  if (rootCauses) renderParetoChart(rootCauses);
  if (rootCauses) renderCategoryChart(rootCauses);
  if (trends) renderCancelTrend(trends);
  if (heatmap) renderCancelRegional(heatmap);
  if (rebook) renderRebooking(rebook);

  await loadCancellationRisk();
}

function renderCancelKPIs(kpis) {
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  set('can-kpi-total', IMSERV.fmt.num(kpis.cancellations));
  set('can-kpi-rate', IMSERV.fmt.pct(kpis.cancel_rate_pct));
  set('can-kpi-aborts', IMSERV.fmt.num(kpis.aborts));
  set('can-kpi-abort-rate', IMSERV.fmt.pct(kpis.abort_rate_pct));
}

function cancelEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderParetoChart(data) {
  const container = document.getElementById('pareto-chart');
  if (!container || !data.pareto) return;

  const top = data.pareto.slice(0, 8);
  if (!top.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-title">No root causes available</div></div>';
    return;
  }

  const maxCount = Math.max(...top.map(d => d.count), 1);
  const drivers = top.map((r, idx) => {
    const pressure = Math.min(100, Math.max(0, r.cumulative_pct || 0));
    const influence = r.count / maxCount * 100;
    return `
      <div class="cause-driver ${idx === 0 ? 'primary' : ''}" style="--pressure:${pressure * 3.6}deg; --influence:${influence}%; --delay:${idx * 55}ms;">
        <div class="cause-rank">${idx + 1}</div>
        <div class="cause-driver-ring"></div>
        <div class="cause-driver-main">
          <span>${cancelEscape(r.reason)}</span>
          <em>${cancelEscape(r.category)}</em>
          <i><b style="width:${influence}%"></b></i>
        </div>
        <div class="cause-driver-metric">
          <strong>${IMSERV.fmt.num(r.count)}</strong>
          <small>${IMSERV.fmt.pct(r.pct)}</small>
        </div>
      </div>
    `;
  }).join('');

  const paretoPath = top.map((r, idx) => {
    const x = 8 + idx * (84 / Math.max(top.length - 1, 1));
    const y = 92 - Math.min(86, r.cumulative_pct * 0.86);
    return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');

  container.innerHTML = `
    <div class="cause-stage">
      <div class="cause-focus">
        <div class="cause-core">
          <span>Total Events</span>
          <strong>${IMSERV.fmt.num(data.total_events || 0)}</strong>
          <em>${cancelEscape(data.top_category || 'Root causes')}</em>
        </div>
        <svg class="pareto-strip" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path class="pareto-pressure-path" d="${paretoPath}" />
        </svg>
      </div>
      <div class="cause-driver-grid">
        ${drivers}
      </div>
    </div>
    <div class="cause-summary-strip">
      <div>
        <span>Largest driver</span>
        <strong>${cancelEscape(top[0].reason)}</strong>
      </div>
      <div>
        <span>Share of root causes</span>
        <strong>${IMSERV.fmt.pct(top[0].pct)}</strong>
      </div>
      <div>
        <span>Top 8 cumulative</span>
        <strong>${IMSERV.fmt.pct(top[top.length - 1].cumulative_pct)}</strong>
      </div>
    </div>
  `;
}

function renderCategoryChart(data) {
  const container = document.getElementById('category-chart');
  if (!container || !data.categories) return;

  const cats = [...data.categories].sort((a, b) => b.count - a.count);
  if (!cats.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-title">No category data available</div></div>';
    return;
  }

  const colours = ['#ef4444', '#f59e0b', '#3b82f6', '#10b981', '#8b5cf6', '#14b8a6'];
  const total = cats.reduce((sum, c) => sum + c.count, 0) || 1;
  const max = Math.max(...cats.map(c => c.count), 1);
  const cells = cats.map((c, idx) => {
    const share = c.count / total * 100;
    const intensity = 0.38 + (c.count / max) * 0.62;
    return `
      <div class="category-cell" style="--cat-color:${colours[idx % colours.length]}; --share:${share * 3.6}deg; --intensity:${intensity};">
        <div class="category-cell-ring"></div>
        <div class="category-cell-body">
          <span>${cancelEscape(c.category)}</span>
          <strong>${IMSERV.fmt.num(c.count)}</strong>
          <em>${IMSERV.fmt.pct(c.pct)}</em>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="category-lens-stage">
      <div class="category-total-lens">
        <span>Families</span>
        <strong>${cats.length}</strong>
        <em>${IMSERV.fmt.num(total)} events</em>
      </div>
      <div class="category-cell-grid">
        ${cells}
      </div>
    </div>
  `;
}

function renderCancelTrend(data) {
  const container = document.getElementById('cancel-trend-chart');
  if (!container) return;

  const actuals = (data.monthly_trend || []).slice(-18);
  const forecast = (data.forecast || []).slice(0, 6);
  const all = [...actuals, ...forecast];
  if (!all.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-title">No trend data available</div></div>';
    return;
  }

  const values = all.map(t => t.cancel_rate);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(max - min, 0.1);
  const point = (v, idx, len) => {
    const x = 6 + idx * (88 / Math.max(len - 1, 1));
    const y = 86 - ((v - min) / spread) * 66;
    return { x, y };
  };
  const pathFrom = points => points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(' ');

  const actualPoints = actuals.map((t, i) => point(t.cancel_rate, i, all.length));
  const forecastPoints = forecast.map((t, i) => point(t.cancel_rate, actuals.length + i, all.length));
  const actualPath = pathFrom(actualPoints);
  const forecastPath = pathFrom(
    forecastPoints.length && actualPoints.length
      ? [actualPoints[actualPoints.length - 1], ...forecastPoints]
      : forecastPoints
  );
  const fillPath = actualPoints.length
    ? `${actualPath} L ${actualPoints[actualPoints.length - 1].x.toFixed(2)} 92 L ${actualPoints[0].x.toFixed(2)} 92 Z`
    : '';

  const nodes = all.map((t, idx) => {
    const p = point(t.cancel_rate, idx, all.length);
    const isForecast = idx >= actuals.length;
    return `<span class="pulse-node ${isForecast ? 'forecast' : ''}" style="--x:${p.x}%; --y:${p.y}%;" title="${cancelEscape(t.month)} ${IMSERV.fmt.pct(t.cancel_rate)}"></span>`;
  }).join('');

  const latest = actuals[actuals.length - 1] || all[all.length - 1];
  const lastForecast = forecast[forecast.length - 1];
  const drift = lastForecast ? lastForecast.cancel_rate - latest.cancel_rate : 0;
  const driftLabel = drift < -0.2 ? 'Cooling' : (drift > 0.2 ? 'Heating' : 'Stable');

  container.innerHTML = `
    <div class="pulse-stage">
      <svg class="pulse-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        ${fillPath ? `<path class="pulse-fill" d="${fillPath}" />` : ''}
        <path class="pulse-path actual" d="${actualPath}" />
        <path class="pulse-path forecast" d="${forecastPath}" />
      </svg>
      ${nodes}
      <div class="pulse-readout">
        <span>Latest Actual</span>
        <strong>${IMSERV.fmt.pct(latest.cancel_rate)}</strong>
        <em>${cancelEscape(latest.month)}</em>
      </div>
      <div class="pulse-forecast-badge ${driftLabel.toLowerCase()}">
        <span>Forecast drift</span>
        <strong>${driftLabel}</strong>
        <em>${drift >= 0 ? '+' : ''}${drift.toFixed(2)} pts</em>
      </div>
    </div>
  `;
}

function renderCancelRegional(data) {
  const container = document.getElementById('cancel-regional-chart');
  if (!container || !data || !data.length) return;

  const sorted = [...data].sort((a, b) => (b.cancel_rate + b.abort_rate) - (a.cancel_rate + a.abort_rate));
  const maxLoss = Math.max(...sorted.map(r => r.cancel_rate + r.abort_rate), 1);
  const cells = sorted.map((r, idx) => {
    const loss = r.cancel_rate + r.abort_rate;
    const heat = Math.min(1, loss / maxLoss);
    const cancelDeg = Math.min(360, r.cancel_rate * 10);
    const abortDeg = Math.min(360, r.abort_rate * 10);
    return `
      <div class="region-risk-tile ${String(r.rag || 'green').toLowerCase()}" style="--heat:${heat}; --cancel:${cancelDeg}deg; --abort:${abortDeg}deg;">
        <div class="region-risk-orbit">
          <span class="region-cancel-ring"></span>
          <span class="region-abort-ring"></span>
          <strong>${cancelEscape(r.region_code)}</strong>
        </div>
        <div class="region-risk-copy">
          <span>Loss Pressure</span>
          <strong>${IMSERV.fmt.pct(loss)}</strong>
          <em><b>${IMSERV.fmt.pct(r.cancel_rate)}</b> cancel</em>
          <em><b>${IMSERV.fmt.pct(r.abort_rate)}</b> abort</em>
        </div>
        <small>#${idx + 1}</small>
      </div>
    `;
  }).join('');

  container.innerHTML = `<div class="regional-risk-grid">${cells}</div>`;
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

  const trendColor = data.trend_direction === 'Rising' ? 'var(--crit)' : 'var(--ok)';
  const trendIcon = data.trend_direction === 'Rising' ? 'Up' : 'Down';

  const driversHtml = (data.drivers || []).map(d => {
    const dotColor = d.impact === 'Critical' ? 'var(--crit)' : (d.impact === 'High' ? 'var(--warn)' : 'var(--ok)');
    return `
      <div style="background:var(--bg-card); border:1px solid var(--border); border-radius:20px; padding:6px 12px; font-size:12px; color:var(--text-secondary); display:flex; align-items:center; gap:6px; box-shadow: 0 2px 8px rgba(0,0,0,0.2);">
        <span style="width:8px; height:8px; border-radius:50%; background:${dotColor};"></span>
        ${cancelEscape(d.driver)} <strong style="color:var(--text-primary)">${cancelEscape(d.value)}</strong>
      </div>
    `;
  }).join('') || '<span style="color:var(--text-muted); font-size:12px;">None identified</span>';

  panel.innerHTML = `
    <div style="display:flex; flex-wrap:wrap; gap: 30px; align-items: stretch; background: var(--bg-surface); padding: 24px; border-radius: var(--radius-md); border: 1px solid var(--border);">
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-width: 160px; border-right: 1px solid rgba(255,255,255,0.05); padding-right: 30px;">
        <div style="position:relative; width: 140px; height: 140px; border-radius: 50%; background: conic-gradient(${gaugeColor} ${data.risk_score}%, var(--bg-card) 0); display:flex; align-items:center; justify-content:center; box-shadow: 0 0 30px ${shadowColor}; margin-bottom: 16px;">
           <div style="position:absolute; width: 120px; height: 120px; background: var(--bg-surface); border-radius: 50%; display:flex; flex-direction:column; align-items:center; justify-content:center;">
              <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; font-weight:600; letter-spacing:1px;">Score</div>
              <div style="font-size:36px; font-weight:800; color:var(--text-primary); line-height:1; margin-top:2px;">${data.risk_score}</div>
           </div>
        </div>
        <div style="font-size:18px; font-weight:700; color:${gaugeColor}; text-transform:uppercase; letter-spacing:1px;">${cancelEscape(data.risk_level)}</div>
      </div>

      <div style="display:flex; flex-direction:column; justify-content:center; min-width: 180px; border-right: 1px solid rgba(255,255,255,0.05); padding-right: 30px; gap: 24px;">
        <div>
          <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; font-weight:600; letter-spacing:1px; margin-bottom:6px;">Cancel Rate</div>
          <div style="font-size:32px; font-weight:700; color:var(--text-primary);">${IMSERV.fmt.pct(data.cancel_rate)}</div>
        </div>
        <div>
          <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; font-weight:600; letter-spacing:1px; margin-bottom:6px;">Trend</div>
          <div style="font-size:28px; font-weight:700; color:${trendColor}; display:flex; align-items:center; gap:8px;">${cancelEscape(data.trend_direction)} <span style="font-size:13px; border:1px solid currentColor; border-radius:999px; padding:2px 6px;">${trendIcon}</span></div>
        </div>
      </div>

      <div style="flex:1; display:flex; flex-direction:column; gap: 16px; justify-content:center; min-width: 250px;">
        <div style="background: rgba(0, 184, 217, 0.08); border-left: 3px solid var(--brand-accent); padding: 12px 16px; border-radius: 0 8px 8px 0;">
          <div style="font-size:11px; color:var(--brand-accent); text-transform:uppercase; font-weight:700; letter-spacing:1px; margin-bottom:6px;">AI Recommendation</div>
          <div style="font-size:13px; color:var(--text-primary); line-height:1.5;">${cancelEscape(data.recommendations?.[0] || 'Maintain current operational strategies.')}</div>
        </div>
        <div>
          <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; font-weight:600; letter-spacing:1px; margin-bottom:8px;">Primary Risk Drivers</div>
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
      <td><strong>${cancelEscape(r.region_code)}</strong></td>
      <td>${IMSERV.fmt.pct(r.rebook_rate_pct)}</td>
      <td>${r.avg_rebook_lag_days} days</td>
      <td><span class="${r.rebook_success_pct > 60 ? 'text-ok' : 'text-warn'}">${IMSERV.fmt.pct(r.rebook_success_pct)}</span></td>
    </tr>
  `).join('');
}
