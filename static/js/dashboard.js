/* IMSERV — Module 1: Bookings to Completions Journey Dashboard */

let _journeyTrendChart = null;

async function loadJourneyDashboard() {
  const region = IMSERV.getRegion();
  const year   = IMSERV.getYear();
  const qs     = `?region=${region}&year=${year}`;
  refreshJourneyVisualLabels();

  // Keep the first paint light; AI recommendations load after the main dashboard.
  const [kpis, heatmap, trend] = await Promise.all([
    IMSERV.apiFetch('/api/journey/kpis' + qs),
    IMSERV.apiFetch('/api/journey/regional-heatmap' + qs),
    IMSERV.apiFetch('/api/journey/weekly-trend' + qs),
  ]);

  if (kpis)    renderJourneyKPIs(kpis);
  if (heatmap) renderRegionalHeatmap(heatmap);

  if (trend) renderJourneyTrend(trend);

  // Render funnel (uses KPI data)
  if (kpis) renderFunnel(kpis);

  window.setTimeout(async () => {
    const ai = await IMSERV.apiFetch('/api/ai/dashboard?year=' + year + '&max=8');
    if (ai?.recommendations) updateAiTriggerState(ai.recommendations);
    if (ai?.summary) document.getElementById('journey-ai-text').textContent = ai.summary || '';
  }, 250);
}

function refreshJourneyVisualLabels() {
  const updates = [
    ['Smart Meter Request to Completion Funnel', 'Smart Meter Request to Completion Funnel', 'Shows how incoming requests progress through contacts, visits, cancellations, aborts and successful completions'],
    ['Weekly Smart Meter Demand and Completion Trend', 'Weekly Smart Meter Demand and Completion Trend', 'Compares weekly visits, completed jobs, cancellations and aborts'],
    ['Regional Demand and Completion Status', 'Regional Demand and Completion Status', 'Shows request volume, completion rate and regional RAG status'],
  ];

  document.querySelectorAll('#view-journey .card-title').forEach(title => {
    const match = updates.find(([oldTitle]) => title.textContent.includes(oldTitle));
    if (!match) return;
    title.textContent = match[1];
    delete title.dataset.iconReady;
    const subtitle = title.closest('.card-header')?.querySelector('.card-subtitle');
    if (subtitle) subtitle.textContent = match[2];
  });
  IMSERV.hydrateIcons(document.getElementById('view-journey'));
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
  set('kpi-bookings',         IMSERV.fmt.num(kpis.total_visits ?? Math.max((kpis.total_bookings || 0) - (kpis.total_cancellations || 0), 0)));
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
    { label: 'Total Requests',    key: 'requests',      cls: 'requests',      val: kpis.total_requests },
    { label: 'Customer Contacts', key: 'contacts',      cls: 'contacts',      val: kpis.total_contacts },
    { label: 'Visits',            key: 'visits',        cls: 'visits',        val: kpis.total_visits ?? Math.max((kpis.total_bookings || 0) - (kpis.total_cancellations || 0), 0) },
    { label: 'Cancellations',     key: 'cancellations', cls: 'cancellations', val: kpis.total_cancellations },
    { label: 'Aborts',            key: 'aborts',        cls: 'aborts',        val: kpis.total_aborts },
    { label: 'Completions',       key: 'completions',   cls: 'completions',   val: kpis.total_completions },
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
  IMSERV.destroyChart('journey-trend');
  const container = document.getElementById('journey-trend-chart');
  if (!container) return;

  // Limit to last 52 weeks for performance
  const limit = 52;
  const labels       = data.labels.slice(-limit);
  const completions  = data.completions.slice(-limit);
  const visits       = (data.visits || data.bookings || []).slice(-limit);
  const cancellations= data.cancellations.slice(-limit);
  const aborts       = data.aborts.slice(-limit);

  if (!labels.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon"></div><div class="empty-title">No weekly rhythm available</div></div>';
    return;
  }

  const last = labels.length - 1;
  const recentCompletion = completions[last] || 0;
  const recentVisit = visits[last] || 0;
  const recentLoss = (cancellations[last] || 0) + (aborts[last] || 0);
  const bestIndex = completions.indexOf(Math.max(...completions, 1));
  const periods = [
    { name: 'Q1', range: [0, 13] },
    { name: 'Q2', range: [13, 26] },
    { name: 'Q3', range: [26, 39] },
    { name: 'Q4', range: [39, 52] },
  ].map(p => {
    const [start, end] = p.range;
    const slice = labels.slice(start, end);
    const c = completions.slice(start, end).reduce((a, b) => a + b, 0);
    const b = visits.slice(start, end).reduce((a, v) => a + v, 0);
    const loss = cancellations.slice(start, end).reduce((a, v) => a + v, 0) + aborts.slice(start, end).reduce((a, v) => a + v, 0);
    const yieldPct = b ? (c / b) * 100 : 0;
    const lossPct = b ? (loss / b) * 100 : 0;
    return { ...p, weeks: slice.length, completions: c, visits: b, losses: loss, yieldPct, lossPct };
  }).filter(p => p.weeks);
  const strongest = periods.reduce((best, p) => p.yieldPct > best.yieldPct ? p : best, periods[0]);
  const hottest = periods.reduce((best, p) => p.lossPct > best.lossPct ? p : best, periods[0]);

  const periodHtml = periods.map(p => {
    const tone = p.lossPct > 28 ? 'hot' : (p.lossPct > 20 ? 'warm' : 'cool');
    const completionAngle = Math.min(360, p.yieldPct * 3.6);
    const lossAngle = Math.min(360, p.lossPct * 3.6);
    return `
      <div class="season-pulse ${tone}" style="--completion:${completionAngle}deg; --loss:${lossAngle}deg;">
        <div class="season-orb">
          <div class="season-ring">
            <strong>${p.name}</strong>
          </div>
          <span class="season-ring-value">${IMSERV.fmt.pct(p.yieldPct)}</span>
        </div>
        <div class="season-copy">
          <span>${p.weeks} weeks</span>
          <strong>${IMSERV.fmt.num(p.completions)}</strong>
          <em>${IMSERV.fmt.num(p.losses)} losses</em>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="season-stage">
      <div class="season-summary">
        <span>Latest week</span>
        <strong>${IMSERV.fmt.num(recentCompletion)}</strong>
        <em>${IMSERV.fmt.num(recentVisit)} visits</em>
      </div>
      <div class="season-pulse-grid">${periodHtml}</div>
    </div>
    <div class="rhythm-readouts">
      <div><span>Strongest quarter</span><strong>${strongest.name} at ${IMSERV.fmt.pct(strongest.yieldPct)}</strong></div>
      <div><span>Highest loss quarter</span><strong>${hottest.name} at ${IMSERV.fmt.pct(hottest.lossPct)}</strong></div>
      <div><span>Latest loss volume</span><strong>${IMSERV.fmt.num(recentLoss)}</strong></div>
    </div>
  `;
}

function renderRegionalHeatmapLegacy(data) {
  const container = document.getElementById('regional-heatmap-grid');
  if (!container) return;
  if (data && data.length) {
    container.innerHTML = data.map(r => {
      const tone = r.rag === 'Red' ? 'red' : (r.rag === 'Amber' ? 'amber' : 'green');
      const lossTotal = (r.cancellations || 0) + (r.aborts || 0);
      const lossRate = Math.min(100, lossTotal / Math.max(r.requests || 0, 1) * 100);
      const completionRate = Math.min(100, Math.max(0, r.completion_rate || 0));
      const orbitOffset = Math.max(4, Math.min(32, lossRate * 1.15));

      return `
        <div class="regional-radar-card ${tone}">
          <div class="regional-radar-orb" style="--completion:${completionRate * 3.6}deg; --loss:${lossRate * 3.6}deg; --drift:${orbitOffset}px;">
            <span class="regional-loss-spark cancel"></span>
            <span class="regional-loss-spark abort"></span>
            <strong>${IMSERV.fmt.pct(r.completion_rate)}</strong>
            <em>${r.region_code}</em>
          </div>
          <div class="regional-radar-copy">
            <div class="regional-radar-topline">
              <strong>${r.region_name || r.region_code}</strong>
              <span class="rag ${r.rag}">${r.rag}</span>
            </div>
            <div class="regional-radar-metrics">
              <span><b>${IMSERV.fmt.num(r.completions)}</b> completions</span>
              <span><b>${IMSERV.fmt.num(r.requests)}</b> requests</span>
              <span><b>${IMSERV.fmt.num(lossTotal)}</b> losses</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
    return;
  }
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

function renderRegionalHeatmap(data) {
  const container = document.getElementById('regional-heatmap-grid');
  if (!container) return;
  if (!data || !data.length) {
    container.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1;"><div class="empty-icon"></div><div class="empty-title">No data available</div></div>';
    return;
  }

  const rows = [...data].sort((a, b) => b.completion_rate - a.completion_rate);
  const totalRequests = rows.reduce((sum, r) => sum + (r.requests || 0), 0);
  const totalCompletions = rows.reduce((sum, r) => sum + (r.completions || 0), 0);
  const totalLosses = rows.reduce((sum, r) => sum + (r.cancellations || 0) + (r.aborts || 0), 0);
  const averageCompletion = totalRequests ? (totalCompletions / totalRequests) * 100 : 0;
  const strongest = rows[0];
  const watch = rows[rows.length - 1];
  const busiest = rows.reduce((best, r) => (r.requests || 0) > (best.requests || 0) ? r : best, rows[0]);
  const maxRequests = Math.max(...rows.map(r => r.requests || 0), 1);

  const nodes = rows.map((r, index) => {
    const tone = r.rag === 'Red' ? 'red' : (r.rag === 'Amber' ? 'amber' : 'green');
    const lossTotal = (r.cancellations || 0) + (r.aborts || 0);
    const angle = -105 + (index / Math.max(rows.length - 1, 1)) * 210;
    const radius = 35 + ((r.requests || 0) / maxRequests) * 12;
    const x = 50 + radius * Math.cos(angle * Math.PI / 180);
    const y = 52 + radius * 0.52 * Math.sin(angle * Math.PI / 180);
    const size = 42 + ((r.requests || 0) / maxRequests) * 26;

    return `
      <button class="region-star ${tone}" style="--x:${x}%; --y:${y}%; --s:${size}px;" title="${r.region_name || r.region_code}: ${IMSERV.fmt.pct(r.completion_rate)} completion, ${IMSERV.fmt.num(lossTotal)} losses">
        <strong>${r.region_code}</strong>
        <span>${IMSERV.fmt.pct(r.completion_rate)}</span>
      </button>
    `;
  }).join('');

  const focus = [
    { label: 'Strongest', region: strongest, metric: IMSERV.fmt.pct(strongest.completion_rate) },
    { label: 'Needs focus', region: watch, metric: IMSERV.fmt.pct(watch.completion_rate) },
    { label: 'Highest demand', region: busiest, metric: IMSERV.fmt.num(busiest.requests) },
  ].map(item => `
    <div class="region-focus-item">
      <span>${item.label}</span>
      <strong>${item.region.region_name || item.region.region_code}</strong>
      <em>${item.metric}</em>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="regional-constellation">
      <div class="region-orbit-field">
        <div class="region-orbit one"></div>
        <div class="region-orbit two"></div>
        <div class="region-orbit-core">
          <span>Network avg</span>
          <strong>${IMSERV.fmt.pct(averageCompletion)}</strong>
          <em>${IMSERV.fmt.num(totalLosses)} losses</em>
        </div>
        ${nodes}
      </div>
      <div class="region-focus-panel">
        ${focus}
      </div>
    </div>
  `;
}

function updateAiTriggerState(data) {
  const button = document.getElementById('ai-trigger');
  if (!button) return;

  const recommendations = data.recommendations || [];
  const hasRed = (data.critical_count || 0) > 0 || recommendations.some(r => r.priority === 'Critical');
  const hasYellow = (data.high_count || 0) > 0 || recommendations.some(r => r.priority === 'High');
  const tone = hasRed ? 'crit' : (hasYellow ? 'warn' : 'ok');

  button.classList.remove('crit', 'warn', 'ok');
  button.classList.add(tone);
  button.title = hasRed
    ? 'AI Insights: critical recommendations'
    : hasYellow
      ? 'AI Insights: high-priority recommendations'
      : 'AI Insights: stable';
}
