/* IMSERV — Module 4: Field Operations & Engineer Planning */

let _activeOpsTab = 'capacity';

async function loadFieldOpsDashboard() {
  const region = IMSERV.getRegion();
  const year   = IMSERV.getYear();
  const qs     = `?region=${region}&year=${year}`;

  const kpis = await IMSERV.apiFetch('/api/field-ops/kpis' + qs);
  if (kpis) renderFieldOpsKPIs(kpis);

  loadActiveOpsTabData();
}

function renderFieldOpsKPIs(kpis) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('ops-kpi-engineers',   IMSERV.fmt.num(kpis.total_engineers));
  set('ops-kpi-util',        IMSERV.fmt.pct(kpis.avg_utilisation));
  set('ops-kpi-jobs',        IMSERV.fmt.num(kpis.total_jobs_completed));
  set('ops-kpi-productivity',kpis.productivity_jobs_per_day?.toFixed(2) || '—');
  set('ops-kpi-absence',     IMSERV.fmt.pct(kpis.absence_rate));

  // Colour utilisation card
  const utilCard = document.getElementById('ops-kpi-util')?.closest('.kpi-card');
  if (utilCard) {
    const u = kpis.avg_utilisation;
    utilCard.className = `kpi-card ${u > 90 ? 'crit' : (u > 75 ? 'warn' : 'ok')}`;
  }
}

async function loadCapacityMatrix() {
  const year = IMSERV.getYear();
  const data = await IMSERV.apiFetch('/api/field-ops/capacity-matrix?year=' + year);
  if (!data) return;

  const ctx = document.getElementById('capacity-matrix-chart');
  if (!ctx) return;

  // Aggregate by region
  const byRegion = {};
  data.forEach(r => {
    if (!byRegion[r.region_code]) {
      byRegion[r.region_code] = { cap: 0, dem: 0, count: 0 };
    }
    byRegion[r.region_code].cap   += r.capacity_jobs;
    byRegion[r.region_code].dem   += r.demand_jobs;
    byRegion[r.region_code].count += 1;
  });

  const regions = Object.keys(byRegion);
  const capVals = regions.map(r => Math.round(byRegion[r].cap / byRegion[r].count));
  const demVals = regions.map(r => Math.round(byRegion[r].dem / byRegion[r].count));
  const utilVals= regions.map((r, i) => parseFloat((demVals[i] / Math.max(capVals[i], 1) * 100).toFixed(1)));

  IMSERV.registerChart('capacity-matrix', new Chart(ctx, {
    type: 'bar',
    data: {
      labels: regions,
      datasets: [
        { label: 'Avg Weekly Capacity', data: capVals, backgroundColor: 'rgba(0,82,204,0.55)',   yAxisID: 'y'  },
        { label: 'Avg Weekly Demand',   data: demVals, backgroundColor: 'rgba(0,184,217,0.55)',  yAxisID: 'y'  },
        { label: 'Utilisation %',       data: utilVals,borderColor: IMSERV.colors.warn, type: 'line', fill: false, tension: 0.3, pointRadius: 4, yAxisID: 'y1' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: IMSERV.chartDefaults.plugins,
      scales: {
        ...IMSERV.chartDefaults.scales,
        y:  { ...IMSERV.chartDefaults.scales.y, position: 'left',  title: { display: true, text: 'Jobs / Week', color: '#4A5568' } },
        y1: { ...IMSERV.chartDefaults.scales.y, position: 'right', grid: { display: false },
               ticks: { ...IMSERV.chartDefaults.scales.y.ticks, callback: v => v + '%' },
               min: 0, max: 120 },
      },
    },
  }));
}

async function loadPatchPlan() {
  const region = document.getElementById('patch-region-filter')?.value || 'NW';
  const year   = IMSERV.getYear();
  const data   = await IMSERV.apiFetch(`/api/field-ops/patch-plan?region=${region}&year=${year}`);
  const body   = document.getElementById('patch-plan-body');
  if (!body || !data) return;

  if (!data.length) {
    body.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-title">No patch data available</div></div>';
    return;
  }

  body.innerHTML = data.map(p => {
    const rag = p.rag.toLowerCase();
    const aiFlag = p.ai_flag ? `<div class="alert alert-${p.ai_flag.type === 'understaffing' ? 'crit' : 'info'} mt-8">${p.ai_flag.message}</div>` : '';
    return `
      <div class="patch-card">
        <div class="patch-code">${p.patch_code}</div>
        <div style="flex:1">
          <div class="utilisation-bar-wrap">
            <div class="utilisation-bar ${rag}" style="width:${Math.min(100, p.utilisation_pct)}%"></div>
          </div>
          ${aiFlag}
        </div>
        <div class="utilisation-pct ${p.utilisation_pct > 90 ? 'text-crit' : (p.utilisation_pct > 75 ? 'text-warn' : 'text-ok')}">${p.utilisation_pct}%</div>
        <span class="rag ${p.rag}" style="flex-shrink:0">${p.rag}</span>
        <div class="stat-chip" style="flex-shrink:0">Demand: ${IMSERV.fmt.num(p.demand_jobs)}</div>
        <div class="stat-chip" style="flex-shrink:0">Capacity: ${IMSERV.fmt.num(p.capacity_jobs)}</div>
      </div>
    `;
  }).join('');
}

async function loadEngineerPerformance() {
  const region = IMSERV.getRegion();
  const year   = IMSERV.getYear();
  const data   = await IMSERV.apiFetch(`/api/field-ops/engineer-performance?region=${region}&year=${year}&top_n=20`);
  const tbody  = document.getElementById('engineer-perf-body');
  if (!tbody || !data) return;

  tbody.innerHTML = data.map(e => `
    <tr>
      <td><strong>${e.engineer_id}</strong></td>
      <td>${e.region_code}</td>
      <td>${e.patch_code}</td>
      <td><span class="stat-chip">${e.employment_type}</span></td>
      <td>${e.working_days}</td>
      <td>${IMSERV.fmt.num(e.jobs_completed)}</td>
      <td>${e.avg_daily_jobs}</td>
      <td>
        <div style="display:flex;align-items:center;gap:6px">
          <div class="utilisation-bar-wrap" style="width:80px">
            <div class="utilisation-bar ${e.achievement_pct > 90 ? 'green' : (e.achievement_pct > 70 ? 'amber' : 'red')}" style="width:${Math.min(100,e.achievement_pct)}%"></div>
          </div>
          <span class="${e.achievement_pct > 90 ? 'text-ok' : (e.achievement_pct > 70 ? 'text-warn' : 'text-crit')}">${IMSERV.fmt.pct(e.achievement_pct)}</span>
        </div>
      </td>
    </tr>
  `).join('');
}

async function loadUnderstaffing() {
  const region = document.getElementById('understaff-region')?.value || 'NW';
  const data   = await IMSERV.apiFetch(`/api/field-ops/understaffing-forecast?region=${region}&weeks=8`);
  if (!data) return;

  // Chart
  const ctx = document.getElementById('understaff-chart');
  if (ctx) {
    IMSERV.registerChart('understaff', new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.map(d => 'W' + d.week_number),
        datasets: [
          { label: 'Utilisation %', data: data.map(d => d.utilisation_pct), borderColor: IMSERV.colors.accent, fill: false, tension: 0.4, pointRadius: 4 },
          { label: 'Capacity',      data: data.map(d => d.capacity_jobs),   borderColor: IMSERV.colors.ok,    yAxisID: 'y2', fill: false, tension: 0.3, pointRadius: 0, borderDash: [4,3] },
          { label: 'Demand',        data: data.map(d => d.demand_forecast), borderColor: IMSERV.colors.crit,  yAxisID: 'y2', fill: false, tension: 0.3, pointRadius: 0 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: IMSERV.chartDefaults.plugins,
        scales: {
          ...IMSERV.chartDefaults.scales,
          y:  { ...IMSERV.chartDefaults.scales.y, max: 120, ticks: { ...IMSERV.chartDefaults.scales.y.ticks, callback: v => v + '%' } },
          y2: { ...IMSERV.chartDefaults.scales.y, position: 'right', display: false },
        },
      },
    }));
  }

  // Table
  const tbody = document.getElementById('understaff-table-body');
  if (tbody) {
    tbody.innerHTML = data.map(d => `
      <tr>
        <td>W${d.week_number}</td>
        <td>${IMSERV.fmt.num(d.capacity_jobs)}</td>
        <td>${IMSERV.fmt.num(d.demand_forecast)}</td>
        <td><span class="${d.gap >= 0 ? 'text-ok' : 'text-crit'}">${d.gap >= 0 ? '+' : ''}${IMSERV.fmt.num(d.gap)}</span></td>
        <td><strong class="${d.utilisation_pct > 90 ? 'text-crit' : (d.utilisation_pct > 75 ? 'text-warn' : 'text-ok')}">${IMSERV.fmt.pct(d.utilisation_pct)}</strong></td>
        <td><span class="priority ${d.risk_level}">${d.risk_level}</span></td>
        <td class="text-muted fs-11">${d.recommendation || '—'}</td>
      </tr>
    `).join('');
  }
}

async function loadOptimisation() {
  const year   = IMSERV.getYear();
  const data   = await IMSERV.apiFetch('/api/field-ops/optimise?year=' + year);
  const body   = document.getElementById('optimise-body');
  if (!body || !data) return;

  const recsHtml = (data.recommendations || []).map(r => `
    <div class="rec-card High">
      <div class="rec-icon">🔄</div>
      <div class="rec-body">
        <div class="rec-title">Transfer ${r.engineers} engineers: ${r.from_region} → ${r.to_region}</div>
        <div class="rec-desc">${r.rationale}</div>
      </div>
    </div>
  `).join('') || '<div class="text-muted fs-12">No rebalancing required — all regions within target utilisation.</div>';

  body.innerHTML = `
    <div class="grid-2 mb-12">
      <div class="kpi-card ok">
        <div class="kpi-label">Avg Utilisation Before</div>
        <div class="kpi-value">${IMSERV.fmt.pct(data.avg_utilisation_before)}</div>
      </div>
      <div class="kpi-card ok">
        <div class="kpi-label">Efficiency Gain Potential</div>
        <div class="kpi-value">+${data.estimated_efficiency_gain_pct}%</div>
      </div>
    </div>
    <div class="fs-12 fw-600 mb-8 text-muted">REBALANCING RECOMMENDATIONS</div>
    <div class="rec-list">${recsHtml}</div>
  `;
}

function switchOpsTab(name, el) {
  _activeOpsTab = name;
  document.querySelectorAll('.ops-tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('#view-field-ops .tab-item').forEach(t => t.classList.remove('active'));
  const panel = document.getElementById('opstab-' + name);
  if (panel) panel.classList.add('active');
  if (el) el.classList.add('active');

  requestAnimationFrame(loadActiveOpsTabData);
}

function loadActiveOpsTabData() {
  if (_activeOpsTab === 'capacity') {
    loadCapacityMatrix();
  } else if (_activeOpsTab === 'patch') {
    loadPatchPlan();
  } else if (_activeOpsTab === 'engineers') {
    loadEngineerPerformance();
  } else if (_activeOpsTab === 'forecast') {
    loadUnderstaffing();
  }
}
