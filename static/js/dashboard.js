/* IMSERV — Module 1: Bookings to Completions Journey Dashboard */

let _journeyTrendChart = null;

async function loadJourneyDashboard() {
  const region = IMSERV.getRegion();
  const year   = IMSERV.getYear();
  const qs     = `?region=${region}&year=${year}`;

  // Load all first-view data in parallel.
  const [kpis, heatmap, ai, trend] = await Promise.all([
    IMSERV.apiFetch('/api/journey/kpis' + qs),
    IMSERV.apiFetch('/api/journey/regional-heatmap' + qs),
    IMSERV.apiFetch('/api/ai/dashboard?year=' + year + '&max=8'),
    IMSERV.apiFetch('/api/journey/weekly-trend' + qs),
  ]);

  if (kpis)    renderJourneyKPIs(kpis);
  if (heatmap) renderRegionalHeatmap(heatmap);
  if (ai?.recommendations) renderAIRecommendations(ai.recommendations);
  if (ai?.summary) document.getElementById('journey-ai-text').textContent = ai.summary || '';

  if (trend) renderJourneyTrend(trend);

  // Render funnel (uses KPI data)
  if (kpis) renderFunnel(kpis);
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
  const tbody = document.getElementById('regional-heatmap-body');
  if (!tbody) return;
  if (!data || !data.length) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">📊</div><div class="empty-title">No data available</div></div></td></tr>';
    return;
  }
  tbody.innerHTML = data.map(r => `
    <tr>
      <td><strong>${r.region_name || r.region_code}</strong></td>
      <td>${IMSERV.fmt.num(r.requests)}</td>
      <td>—</td>
      <td>${IMSERV.fmt.num(r.completions)}</td>
      <td><span class="text-crit">${IMSERV.fmt.num(r.cancellations)}</span></td>
      <td><span class="text-warn">${IMSERV.fmt.num(r.aborts)}</span></td>
      <td><strong>${IMSERV.fmt.pct(r.completion_rate)}</strong></td>
      <td><span class="rag ${r.rag}">${r.rag}</span></td>
    </tr>
  `).join('');
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
          ${r.region_code ? `<span class="stat-chip">📍 ${r.region_code}</span>` : ''}
          ${r.metric_value != null ? `<span class="rec-metric">${r.metric_label}: ${r.metric_value}</span>` : ''}
          ${r.action_required ? '<span class="rag Red">Action Required</span>' : ''}
        </div>
      </div>
    </div>
  `).join('');
}
