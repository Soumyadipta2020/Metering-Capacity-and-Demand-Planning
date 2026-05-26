/* IMSERV — Module 1: Bookings to Completions Journey Dashboard */

let _journeyTrendChart = null;

async function loadJourneyDashboard() {
  const region = IMSERV.getRegion();
  const year   = IMSERV.getYear();
  const qs     = `?region=${region}&year=${year}`;

  // Load all first-view data in parallel.
  const [kpis, heatmap, ai, trend, interactions] = await Promise.all([
    IMSERV.apiFetch('/api/journey/kpis' + qs),
    IMSERV.apiFetch('/api/journey/regional-heatmap' + qs),
    IMSERV.apiFetch('/api/ai/dashboard?year=' + year + '&max=8'),
    IMSERV.apiFetch('/api/journey/weekly-trend' + qs),
    IMSERV.apiFetch('/api/journey/interactions' + qs),
  ]);

  if (kpis)    renderJourneyKPIs(kpis);
  if (heatmap) renderRegionalHeatmap(heatmap);
  if (ai?.recommendations) renderAIRecommendations(ai.recommendations);
  if (ai?.summary) document.getElementById('journey-ai-text').textContent = ai.summary || '';

  if (trend) renderJourneyTrend(trend);
  if (interactions) renderCustomerInteractions(interactions);

  // Render funnel (uses KPI data)
  if (kpis) renderFunnel(kpis);
}

function renderCustomerInteractions(data) {
  const routeList = document.getElementById('interaction-map-body');
  const total = document.getElementById('interaction-total');
  const summary = document.getElementById('interaction-type-summary');
  const insight = document.getElementById('interaction-insight');
  if (!routeList || !summary) return;

  const routes = data.routes || [];
  if (total) {
    total.innerHTML = `<strong>${IMSERV.fmt.num(data.total_interactions)}</strong> interactions`;
  }

  if (!routes.length) {
    routeList.innerHTML = '<div class="empty-state"><div class="empty-icon"></div><div class="empty-title">No interaction data available</div></div>';
    summary.innerHTML = '<div class="empty-state"><div class="empty-icon"></div><div class="empty-title">No interaction mix available</div></div>';
    return;
  }

  routeList.innerHTML = routes.map(r => `
    <div class="interaction-route-card">
      <div class="interaction-route-main">
        <div class="interaction-source">
          <strong>${r.source_interaction_channel}</strong>
          <span>${(r.source_channels || []).join(', ')}</span>
        </div>
        <span class="interaction-pill ${r.customer_interaction_type === 'Chat' ? 'chat' : 'voice'}">${r.customer_interaction_type}</span>
      </div>
      <div class="interaction-stage">${r.journey_stage}</div>
      <div class="interaction-route-metrics">
        <div><span>Interactions</span><strong>${IMSERV.fmt.num(r.interactions)}</strong></div>
        <div><span>Bookings</span><strong>${IMSERV.fmt.num(r.bookings)}</strong></div>
        <div><span>Conversion</span><strong>${IMSERV.fmt.pct(r.conversion_pct)}</strong></div>
      </div>
    </div>
  `).join('');

  summary.innerHTML = (data.type_summary || []).map(t => `
    <div class="interaction-type-card ${t.customer_interaction_type === 'Chat' ? 'chat' : 'voice'}">
      <div>
        <div class="interaction-type-name">${t.customer_interaction_type}</div>
        <div class="interaction-type-meta">${IMSERV.fmt.pct(t.share_pct)} of interactions</div>
      </div>
      <div class="interaction-type-values">
        <strong>${IMSERV.fmt.num(t.interactions)}</strong>
        <span>${IMSERV.fmt.num(t.bookings)} bookings</span>
      </div>
    </div>
  `).join('');

  if (insight) {
    const best = data.highest_conversion;
    const top = data.top_route;
    insight.innerHTML = best && top ? `
      <div class="stat-chip">Top source: <strong>${top.source_interaction_channel}</strong></div>
      <div class="stat-chip">Best conversion: <strong>${best.source_interaction_channel} ${IMSERV.fmt.pct(best.conversion_pct)}</strong></div>
    ` : '';
  }
}

function renderJourneyKPIs(kpis) {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  set('kpi-requests',         IMSERV.fmt.num(kpis.total_requests));
  set('kpi-contacts',         IMSERV.fmt.num(kpis.total_contacts));
  set('kpi-avg-contacts',     kpis.avg_contacts_per_customer?.toFixed(2) || '—');
  set('kpi-bookings',         IMSERV.fmt.num(kpis.total_bookings));
  set('kpi-cancellations',    IMSERV.fmt.num(kpis.total_cancellations));
  set('kpi-aborts',           IMSERV.fmt.num(kpis.total_aborts));
  set('kpi-completions',      IMSERV.fmt.num(kpis.total_completions));
  set('kpi-completion-rate',  IMSERV.fmt.pct(kpis.completion_rate));

  // Colour the completion rate card
  const crCard = document.querySelector('#view-journey .kpi-card.ok:last-child');
  if (crCard && kpis.completion_rate) {
    crCard.className = `kpi-card ${kpis.completion_rate >= 65 ? 'ok' : (kpis.completion_rate >= 55 ? 'warn' : 'crit')}`;
  }
}

function renderFunnel(kpis) {
  const steps = [
    { label: 'Total Requests',    key: 'requests',     cls: 'requests',      val: kpis.total_requests },
    { label: 'Customer Contacts', key: 'contacts',     cls: 'contacts',      val: kpis.total_contacts },
    { label: 'Bookings',          key: 'bookings',     cls: 'bookings',      val: kpis.total_bookings },
    { label: 'Cancellations',     key: 'cancellations',cls: 'cancellations', val: kpis.total_cancellations },
    { label: 'Aborts',            key: 'aborts',       cls: 'aborts',        val: kpis.total_aborts },
    { label: 'Completions',       key: 'completions',  cls: 'completions',   val: kpis.total_completions },
  ];

  const maxVal = Math.max(...steps.map(s => s.val || 0));
  const container = document.getElementById('funnel-chart');
  if (!container) return;

  container.innerHTML = steps.map(s => {
    const pct = maxVal > 0 ? Math.max(10, Math.round((s.val / maxVal) * 100)) : 10;
    return `
      <div class="funnel-step">
        <div class="funnel-label">${s.label}</div>
        <div class="funnel-bar-wrap">
          <div class="funnel-bar ${s.cls}" style="width:${pct}%">
            ${IMSERV.fmt.num(s.val)}
          </div>
        </div>
        <div class="funnel-value">${IMSERV.fmt.num(s.val)}</div>
      </div>
    `;
  }).join('');
}

function renderJourneyTrend(data) {
  const ctx = document.getElementById('journey-trend-chart');
  if (!ctx) return;

  // Limit to last 52 weeks for performance
  const limit = 52;
  const labels       = data.labels.slice(-limit);
  const completions  = data.completions.slice(-limit);
  const bookings     = data.bookings.slice(-limit);
  const cancellations= data.cancellations.slice(-limit);
  const aborts       = data.aborts.slice(-limit);

  IMSERV.registerChart('journey-trend', new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Completions',   data: completions,  borderColor: IMSERV.colors.ok,   backgroundColor: 'rgba(16,185,129,0.08)', tension: 0.4, fill: true,  pointRadius: 0, borderWidth: 2 },
        { label: 'Bookings',      data: bookings,     borderColor: IMSERV.colors.info,  backgroundColor: 'transparent',          tension: 0.4, fill: false, pointRadius: 0, borderWidth: 1.5 },
        { label: 'Cancellations', data: cancellations,borderColor: IMSERV.colors.crit,  backgroundColor: 'transparent',          tension: 0.4, fill: false, pointRadius: 0, borderWidth: 1.5 },
        { label: 'Aborts',        data: aborts,       borderColor: IMSERV.colors.warn,  backgroundColor: 'transparent',          tension: 0.4, fill: false, pointRadius: 0, borderWidth: 1, borderDash: [4,3] },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: IMSERV.chartDefaults.plugins,
      scales: IMSERV.chartDefaults.scales,
    },
  }));
}

function renderRegionalHeatmap(data) {
  const container = document.getElementById('regional-heatmap-grid');
  if (!container) return;
  if (!data || !data.length) {
    container.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1;"><div class="empty-icon">📊</div><div class="empty-title">No data available</div></div>';
    return;
  }

  container.innerHTML = data.map(r => {
    const isRed = r.rag === 'Red';
    const isAmber = r.rag === 'Amber';
    const borderColor = isRed ? 'var(--crit)' : (isAmber ? 'var(--warn)' : 'var(--ok)');
    const bgColor = isRed ? 'rgba(239, 68, 68, 0.05)' : (isAmber ? 'rgba(245, 158, 11, 0.05)' : 'rgba(16, 185, 129, 0.05)');

    return `
      <div style="background: var(--bg-card); border: 1px solid var(--border); border-top: 4px solid ${borderColor}; border-radius: var(--radius-md); padding: 18px; position: relative; box-shadow: 0 4px 12px rgba(0,0,0,0.1); transition: transform 0.2s;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 16px;">
           <div style="font-size: 16px; font-weight: 700; color: var(--text-primary);">${r.region_name || r.region_code}</div>
           <div class="rag ${r.rag}">${r.rag}</div>
        </div>
        
        <div style="display:flex; gap: 15px; align-items:center; margin-bottom: 20px; background: ${bgColor}; padding: 12px; border-radius: 8px;">
           <div style="flex:1;">
              <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; font-weight:600; letter-spacing:0.5px;">Completion Rate</div>
              <div style="font-size:28px; font-weight:800; color:var(--text-primary); line-height:1.2;">${IMSERV.fmt.pct(r.completion_rate)}</div>
              <div style="height:6px; background:rgba(255,255,255,0.1); border-radius:3px; margin-top:8px; overflow:hidden;">
                 <div style="height:100%; width:${r.completion_rate}%; background:${borderColor}; border-radius:3px;"></div>
              </div>
           </div>
        </div>
        
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
           <div style="background:var(--bg-surface); padding:10px; border-radius:6px; border: 1px solid var(--border);">
              <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; font-weight:600;">Requests</div>
              <div style="font-size:15px; font-weight:700; color:var(--text-primary);">${IMSERV.fmt.num(r.requests)}</div>
           </div>
           <div style="background:var(--bg-surface); padding:10px; border-radius:6px; border: 1px solid var(--border);">
              <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; font-weight:600;">Completions</div>
              <div style="font-size:15px; font-weight:700; color:var(--ok);">${IMSERV.fmt.num(r.completions)}</div>
           </div>
           <div style="background:var(--bg-surface); padding:10px; border-radius:6px; border: 1px solid var(--border);">
              <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; font-weight:600;">Cancellations</div>
              <div style="font-size:15px; font-weight:700; color:var(--crit);">${IMSERV.fmt.num(r.cancellations)}</div>
           </div>
           <div style="background:var(--bg-surface); padding:10px; border-radius:6px; border: 1px solid var(--border);">
              <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; font-weight:600;">Aborts</div>
              <div style="font-size:15px; font-weight:700; color:var(--warn);">${IMSERV.fmt.num(r.aborts)}</div>
           </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderAIRecommendations(data) {
  const list = document.getElementById('ai-rec-list');
  const counts = document.getElementById('rec-counts');
  if (!list) return;

  if (counts) {
    counts.innerHTML = `<strong style="color:var(--crit)">${data.critical_count} Critical</strong> &nbsp; <strong style="color:var(--warn)">${data.high_count} High</strong> &nbsp; ${data.total_count} total`;
  }

  if (!data.recommendations || !data.recommendations.length) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">✅</div><div class="empty-title">No critical alerts detected</div></div>';
    return;
  }

  list.innerHTML = data.recommendations.slice(0, 8).map(r => `
    <div class="rec-card ${r.priority}">
      <div class="rec-icon">${IMSERV.priorityIcon(r.priority)}</div>
      <div class="rec-body">
        <div class="rec-title">${r.title}</div>
        <div class="rec-desc">${r.body}</div>
        <div class="rec-meta">
          <span class="priority ${r.priority}">${r.priority}</span>
          ${r.region_code ? '<span class="stat-chip">📍 ' + r.region_code + '</span>' : ''}
          ${r.metric_value != null ? '<span class="rec-metric">' + r.metric_label + ': ' + r.metric_value + '</span>' : ''}
          ${r.action_required ? '<span class="rag Red">Action Required</span>' : ''}
        </div>
      </div>
    </div>
  `).join('');
}
