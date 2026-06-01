/* IMSERV — Module 1: Bookings to Completions Journey Dashboard */

let _journeyTrendChart = null;

async function loadJourneyDashboard() {
  const region = IMSERV.getRegion();
  const year   = IMSERV.getYear();
  const qs     = `?region=${region}&year=${year}`;
  refreshJourneyVisualLabels();
  const loadingTargets = [
    'funnel-chart',
    'journey-trend-chart',
    'funnel-metrics-body',
    'regional-heatmap-grid',
    'channel-comparison-grid',
  ];
  IMSERV.setLoading(loadingTargets, true);

  try {
    // Keep the first paint light; AI recommendations load after the main dashboard.
    const [kpis, heatmap, trend, funnel] = await Promise.all([
      IMSERV.apiFetch('/api/journey/kpis' + qs),
      IMSERV.apiFetch('/api/journey/regional-heatmap' + qs),
      IMSERV.apiFetch('/api/journey/weekly-trend' + qs),
      IMSERV.apiFetch('/api/forecasting/funnel' + qs),
    ]);

    if (kpis)    renderJourneyKPIs(kpis);
    if (heatmap) renderRegionalHeatmap(heatmap);

    if (trend) renderJourneyTrend(trend);

    // Render funnel (uses KPI data)
    if (kpis) renderFunnel(kpis);

    if (funnel) renderFunnelMetrics(funnel);

    await loadChannelComparison(false);
  } finally {
    IMSERV.setLoading(loadingTargets, false);
  }

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
        <div style="height:100%; width:${Math.max(4, Math.min(100, r.pct || 0))}%; background:rgba(2,194,183,0.75);"></div>
      </div>
    </div>
  `).join('') : '<div style="font-size:11px; color:var(--text-muted);">No unresolved successful visits</div>';

  body.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:14px; padding: 10px 0;">
      <!-- Main Funnel Path -->
      <div style="display:grid; grid-template-columns:1fr .65fr 1fr 1fr 1.08fr; gap:4px; min-height:88px; position:relative;">
        
        <!-- Requests -->
        <div style="background: linear-gradient(135deg, rgba(2,194,183,0.05), rgba(2,194,183,0.15)); border: 1px solid rgba(2,194,183,0.2); border-radius: 8px 0 0 8px; display:flex; flex-direction:column; justify-content:center; align-items:center; position:relative; min-width:0;">
          <div style="font-size:12px; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; font-weight:600;">Requests</div>
          <div style="font-size:26px; font-weight:800; color:var(--info);">${IMSERV.fmt.num(requests)}</div>
          <div style="position:absolute; right:-12px; top:50%; transform:translateY(-50%); width:0; height:0; border-top: 16px solid transparent; border-bottom: 16px solid transparent; border-left: 12px solid rgba(2,194,183,0.3); z-index:2;"></div>
        </div>

        <!-- Contacts -->
        <div style="background: linear-gradient(135deg, rgba(2,194,183,0.08), rgba(2,194,183,0.16)); border: 1px solid rgba(2,194,183,0.28); display:flex; flex-direction:column; justify-content:center; align-items:center; position:relative; min-width:0;">
          <div style="font-size:12px; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; font-weight:600;">Contacts</div>
          <div style="font-size:22px; font-weight:800; color:var(--info);">${IMSERV.fmt.num(f.contacts)}</div>
          <div style="position:absolute; right:-12px; top:50%; transform:translateY(-50%); width:0; height:0; border-top: 16px solid transparent; border-bottom: 16px solid transparent; border-left: 12px solid rgba(2,194,183,0.4); z-index:2;"></div>
        </div>

        <!-- Visits -->
        <div style="background: linear-gradient(135deg, rgba(2,129,120,0.05), rgba(2,129,120,0.15)); border: 1px solid rgba(2,129,120,0.2); display:flex; flex-direction:column; justify-content:center; align-items:center; position:relative; min-width:0;">
          <div style="font-size:12px; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; font-weight:600;">Visits</div>
          <div style="font-size:26px; font-weight:800; color:var(--ok);">${IMSERV.fmt.num(visits)}</div>
          <div style="position:absolute; right:-12px; top:50%; transform:translateY(-50%); width:0; height:0; border-top: 16px solid transparent; border-bottom: 16px solid transparent; border-left: 12px solid rgba(2,129,120,0.3); z-index:2;"></div>
        </div>

        <!-- Successful Visits -->
        <div style="background: linear-gradient(135deg, rgba(2,129,120,0.10), rgba(2,129,120,0.20)); border: 1px solid rgba(2,129,120,0.32); display:flex; flex-direction:column; justify-content:center; align-items:center; position:relative; min-width:0;">
          <div style="font-size:12px; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; font-weight:600;">Successful Visits</div>
          <div style="font-size:26px; font-weight:800; color:var(--ok);">${IMSERV.fmt.num(successfulVisits)}</div>
          <div style="position:absolute; right:-12px; top:50%; transform:translateY(-50%); width:0; height:0; border-top: 16px solid transparent; border-bottom: 16px solid transparent; border-left: 12px solid rgba(2,129,120,0.4); z-index:2;"></div>
        </div>

        <!-- Completions -->
        <div style="background: linear-gradient(135deg, rgba(2,129,120,0.15), rgba(2,129,120,0.25)); border: 1px solid rgba(2,129,120,0.4); border-radius: 0 8px 8px 0; display:flex; flex-direction:column; justify-content:center; align-items:center; box-shadow: inset 0 0 12px rgba(2,129,120,0.1); min-width:0;">
          <div style="font-size:12px; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; font-weight:600;">Successful Completions</div>
          <div style="font-size:26px; font-weight:800; color:var(--ok);">${IMSERV.fmt.num(completions)}</div>
        </div>

      </div>

      <!-- Falloff branches -->
      <div style="display:grid; grid-template-columns:1fr .65fr 1fr 1fr 1.08fr; gap:12px; align-items:start;">
        <div></div>
        <div>
          <div style="height:18px; width:50%; border-right:2px dashed rgba(251,130,129,0.35); border-bottom:2px dashed rgba(251,130,129,0.35); border-bottom-right-radius:10px; margin-top:-8px;"></div>
          <div style="background: rgba(251, 130, 129, 0.05); border: 1px solid rgba(251, 130, 129, 0.15); border-left: 4px solid var(--crit); padding: 12px 14px; border-radius: 8px;">
            <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; font-weight:700; letter-spacing: 0.5px;">Cancellations</div>
            <div style="font-size:20px; font-weight:800; color:var(--crit); margin-top:2px;">${IMSERV.fmt.num(f.cancellations)}</div>
          </div>
        </div>
        <div>
          <div style="height:18px; width:50%; border-right:2px dashed rgba(244,210,90,0.45); border-bottom:2px dashed rgba(244,210,90,0.45); border-bottom-right-radius:10px; margin-top:-8px;"></div>
          <div style="background: rgba(244, 210, 90, 0.05); border: 1px solid rgba(244, 210, 90, 0.15); border-left: 4px solid var(--warn); padding: 12px 14px; border-radius: 8px;">
            <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; font-weight:700; letter-spacing: 0.5px;">Aborts</div>
            <div style="font-size:20px; font-weight:800; color:var(--warn); margin-top:2px;">${IMSERV.fmt.num(f.aborts)}</div>
          </div>
        </div>
        <div style="grid-column:4 / 6;">
          <div style="height:18px; width:28%; border-right:2px dashed rgba(2,194,183,0.38); border-bottom:2px dashed rgba(2,194,183,0.38); border-bottom-right-radius:10px; margin-top:-8px;"></div>
          <div style="background: rgba(2, 194, 183, 0.05); border: 1px solid rgba(2, 194, 183, 0.15); border-left: 4px solid var(--info); padding: 12px 14px; border-radius: 8px;">
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

    <div class="mt-8" style="border-top: 1px solid var(--border); padding-top: 16px; display:flex; gap: 16px; justify-content:center; flex-wrap:wrap;">
      <div class="stat-chip" style="font-size: 13px; padding: 6px 14px; background: var(--bg-card); border:1px solid var(--border);">Visit Rate: <strong style="color:var(--text-primary); margin-left:4px;">${IMSERV.fmt.pct(funnel.visit_rate)}</strong></div>
      <div class="stat-chip" style="font-size: 13px; padding: 6px 14px; background: rgba(2,129,120,0.05); border:1px solid rgba(2,129,120,0.1);">Completion Rate: <strong style="color:var(--ok); margin-left:4px;">${IMSERV.fmt.pct(funnel.completion_rate)}</strong></div>
      <div class="stat-chip" style="font-size: 13px; padding: 6px 14px; background: rgba(2,129,120,0.05); border:1px solid rgba(2,129,120,0.1);">Visit Success: <strong style="color:var(--ok); margin-left:4px;">${IMSERV.fmt.pct(funnel.visit_success_rate)}</strong></div>
      <div class="stat-chip" style="font-size: 13px; padding: 6px 14px; background: rgba(2,194,183,0.05); border:1px solid rgba(2,194,183,0.1);">Completion Gap: <strong style="color:var(--info); margin-left:4px;">${IMSERV.fmt.num(notCompleted)}</strong></div>
      <div class="stat-chip" style="font-size: 13px; padding: 6px 14px; background: var(--bg-card); border:1px solid var(--border);">Avg Contacts: <strong style="color:var(--text-primary); margin-left:4px;">${funnel.avg_contacts_per_customer}</strong></div>
    </div>
  `;
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
    const bgColor = isRed ? 'rgba(251, 130, 129, 0.05)' : (isAmber ? 'rgba(244, 210, 90, 0.05)' : 'rgba(2, 129, 120, 0.05)');

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

async function loadChannelComparison(showLoading = true) {
  const region = IMSERV.getRegion();
  const year   = IMSERV.getYear();
  if (showLoading) IMSERV.setLoading('channel-comparison-grid', true);
  const kpis = await IMSERV.apiFetch('/api/forecasting/channel-kpis?region=' + region + '&year=' + year);
  if (!kpis) {
    if (showLoading) IMSERV.setLoading('channel-comparison-grid', false);
    return;
  }
  const container = document.getElementById('channel-comparison-grid');
  if (!container) {
    if (showLoading) IMSERV.setLoading('channel-comparison-grid', false);
    return;
  }
  const channels = kpis.channel_breakdown || [];
  if (!channels.length) {
     container.innerHTML = '<div class="empty-state"><div class="empty-title">No data available</div></div>';
     if (showLoading) IMSERV.setLoading('channel-comparison-grid', false);
     return;
  }

  const sorted = [...channels].sort((a, b) => b.volume - a.volume);
  const maxVolume = Math.max(...sorted.map(c => c.volume), 1);
  const maxBookings = Math.max(...sorted.map(c => c.bookings), 1);
  const totalVolume = sorted.reduce((sum, c) => sum + c.volume, 0);
  const totalBookings = sorted.reduce((sum, c) => sum + c.bookings, 0);
  const totalSuccessfulVisits = sorted.reduce((sum, c) => sum + (c.successful_visits ?? Math.max((c.bookings || 0) - (c.cancellations || 0), 0)), 0);
  const totalAbandoned = sorted.reduce((sum, c) => sum + c.abandon_pct * c.volume / 100, 0);
  const blendedVisitSuccess = totalBookings ? (totalSuccessfulVisits / totalBookings) * 100 : 0;
  const blendedAbandon = totalVolume ? (totalAbandoned / totalVolume) * 100 : 0;
  const successfulVisitsFor = (c) => c.successful_visits ?? Math.max((c.bookings || 0) - (c.cancellations || 0), 0);
  const visitSuccessFor = (c) => Math.max(0, Math.min(100, c.visit_success_pct ?? (c.bookings ? (successfulVisitsFor(c) / c.bookings) * 100 : 0)));

  const positions = [
    { x: 18, y: 46 },
    { x: 33, y: 18 },
    { x: 68, y: 18 },
    { x: 82, y: 48 },
    { x: 66, y: 76 },
    { x: 31, y: 77 },
  ];
  const accent = ['#02C2B7', '#028178', '#4A6B7C', '#F4D25A', '#FB8281', '#4AC5BB'];

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
    const successfulVisits = successfulVisitsFor(c);
    const visitSuccess = visitSuccessFor(c);
    const abandon = Math.max(0, Math.min(100, c.abandon_pct || 0));
    const share = totalVolume ? (c.volume / totalVolume) * 100 : 0;
    const bookingShare = totalBookings ? (c.bookings / totalBookings) * 100 : 0;
    const colour = accent[idx % accent.length];
    const safeName = escapeHtml(c.channel);

    return `
      <button
        class="channel-orb"
        style="--x:${pos.x}%; --y:${pos.y}%; --size:${size}px; --channel-color:${colour}; --conversion:${visitSuccess * 3.6}deg; --abandon:${Math.max(10, abandon * 3.6)}deg;"
        title="${safeName}: ${IMSERV.fmt.num(c.volume)} customer touchpoints, ${IMSERV.fmt.num(c.bookings)} bookings, ${IMSERV.fmt.pct(visitSuccess)} to successful visits"
        aria-label="${safeName} channel signal"
      >
        <span class="channel-orb-ring"></span>
        <span class="channel-orb-core">
          <span class="channel-orb-code">${channelCode(c.channel)}</span>
          <span class="channel-orb-name">${safeName}</span>
          <span class="channel-orb-volume">${IMSERV.fmt.num(c.bookings)}</span>
          <span class="channel-orb-success">${IMSERV.fmt.pct(visitSuccess)}</span>
        </span>
        <span class="channel-orb-marker" title="${IMSERV.fmt.pct(abandon)} abandoned"></span>
        <span class="channel-orb-metrics">
          <strong>${IMSERV.fmt.num(successfulVisits)}</strong>
          <em>successful visits</em>
          <small>${bookingShare.toFixed(1)}% of bookings</small>
          <small>${share.toFixed(1)}% of touchpoints</small>
        </span>
      </button>
    `;
  }).join('');

  const insight = sorted[0];
  const bestConversion = [...sorted].sort((a, b) => visitSuccessFor(b) - visitSuccessFor(a))[0];
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
        <div class="booking-core-sub">${IMSERV.fmt.pct(blendedVisitSuccess)} to visits</div>
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
        <em>${IMSERV.fmt.pct(visitSuccessFor(bestConversion))} to successful visits</em>
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
  if (showLoading) IMSERV.setLoading('channel-comparison-grid', false);
}
