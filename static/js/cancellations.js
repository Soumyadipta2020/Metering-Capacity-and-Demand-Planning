/* IMSERV - Module 3: Cancellations & Aborts */

async function loadCancellationsDashboard() {
  const region = IMSERV.getRegion();
  const year = IMSERV.getYear();
  const qs = `?region=${region}&year=${year}`;

  const [kpis, rootCauses, rebook] = await Promise.all([
    IMSERV.apiFetch('/api/cancellations/kpis' + qs),
    IMSERV.apiFetch('/api/cancellations/root-causes' + qs),
    IMSERV.apiFetch('/api/cancellations/rebooking' + qs),
  ]);

  if (kpis) renderCancelKPIs(kpis);
  if (rootCauses) renderParetoChart(rootCauses);
  if (rootCauses) renderCategoryChart(rootCauses);
  if (rebook) renderRebooking(rebook);
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
  if (!container) return;
  renderReasonBreakdown(container, data.cancellation_reasons || [], data.total_cancellations || 0, {
    empty: 'No cancellation reasons available',
    totalLabel: 'Total cancellations',
    tone: 'cancel',
  });
}

function renderCategoryChart(data) {
  const container = document.getElementById('category-chart');
  if (!container) return;
  renderReasonBreakdown(container, data.abort_reasons || [], data.total_aborts || 0, {
    empty: 'No abort reasons available',
    totalLabel: 'Total aborts',
    tone: 'abort',
  });
}

function renderReasonBreakdown(container, rows, total, config) {
  const top = rows.slice(0, 8);

  if (!top.length) {
    container.innerHTML = `<div class="empty-state"><div class="empty-title">${cancelEscape(config.empty)}</div></div>`;
    return;
  }

  const maxCount = Math.max(...top.map(d => d.count), 1);
  const topShare = top[0]?.pct || 0;
  const rowsHtml = top.map((r, idx) => {
    const influence = Math.max(3, r.count / maxCount * 100);
    return `
      <div class="reason-breakdown-row ${idx === 0 ? 'primary' : ''}" style="--influence:${influence}%; --delay:${idx * 45}ms;">
        <div class="cause-rank">${idx + 1}</div>
        <div class="reason-breakdown-main">
          <span>${cancelEscape(r.reason)}</span>
          <em>${cancelEscape(r.category)}</em>
          <i><b></b></i>
        </div>
        <div class="reason-breakdown-metric">
          <strong>${IMSERV.fmt.num(r.count)}</strong>
          <small>${IMSERV.fmt.pct(r.pct)}</small>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="reason-breakdown ${config.tone}">
      <div class="reason-breakdown-total">
        <span>${cancelEscape(config.totalLabel)}</span>
        <strong>${IMSERV.fmt.num(total)}</strong>
        <em>${IMSERV.fmt.num(top.length)} reasons shown</em>
      </div>
      <div class="reason-breakdown-list">
        ${rowsHtml}
      </div>
    </div>
    <div class="cause-summary-strip">
      <div><span>Top reason</span><strong>${cancelEscape(top[0].reason)}</strong></div>
      <div><span>Top reason rate</span><strong>${IMSERV.fmt.pct(topShare)}</strong></div>
      <div><span>Shown volume</span><strong>${IMSERV.fmt.num(top.reduce((sum, r) => sum + r.count, 0))}</strong></div>
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
          <span>Cancellation/abort pressure</span>
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
  const region = IMSERV.getRegion();
  const data = await IMSERV.apiFetch('/api/cancellations/predict' + (region ? `?region=${region}` : ''));
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
  const scopeLabel = data.region_code === 'ALL' ? 'All regions' : `${cancelEscape(data.region_code)} region`;

  panel.innerHTML = `
    <div class="risk-prediction-card">
      <div class="risk-gauge-block">
        <div class="risk-gauge" style="--risk-color:${gaugeColor}; --risk-score:${data.risk_score}%; --risk-shadow:${shadowColor};">
          <div>
            <span>Score</span>
            <strong>${data.risk_score}</strong>
          </div>
        </div>
        <strong class="risk-level" style="color:${gaugeColor};">${cancelEscape(data.risk_level)}</strong>
        <span class="risk-scope">${scopeLabel}</span>
      </div>

      <div class="risk-prediction-detail">
        <div class="risk-metric-grid">
          <div><span>Cancel Rate</span><strong>${IMSERV.fmt.pct(data.cancel_rate)}</strong></div>
          <div><span>Abort Rate</span><strong>${IMSERV.fmt.pct(data.abort_rate)}</strong></div>
          <div><span>Trend</span><strong style="color:${trendColor};">${cancelEscape(data.trend_direction)} <small>${trendIcon}</small></strong></div>
        </div>
        <div class="risk-recommendation">
          <span>AI Recommendation</span>
          <strong>${cancelEscape(data.recommendations?.[0] || 'Maintain current operational strategies.')}</strong>
        </div>
        <div class="risk-drivers">
          <span>Primary Risk Drivers</span>
          <div>
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
