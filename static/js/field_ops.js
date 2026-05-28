/* IMSERV — Module 4: Field Operations & Engineer Planning */

let _activeOpsTab = 'capacity';
const RESOURCE_OPT_STORAGE_KEY = 'imserv-resource-optimisation';
let _lastOptimisationResult = null;
let _appliedOptimisation = null;

async function loadFieldOpsDashboard() {
  restoreAppliedOptimisation();
  updateOptimisationButtons();
  const region = IMSERV.getRegion();
  const year   = IMSERV.getYear();
  const qs     = `?region=${region}&year=${year}`;
  IMSERV.setLoading(['capacity-matrix-chart', 'patch-plan-body', 'understaff-chart'], true);

  try {
    const kpis = await IMSERV.apiFetch('/api/field-ops/kpis' + qs);
    if (kpis) renderFieldOpsKPIs(kpis);

    await loadActiveOpsTabData();
  } finally {
    IMSERV.setLoading(['capacity-matrix-chart', 'patch-plan-body', 'understaff-chart'], false);
  }
}

function renderFieldOpsKPIs(kpis) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('ops-kpi-engineers',   IMSERV.fmt.num(kpis.total_engineers));
  set('ops-kpi-util',        IMSERV.fmt.pct(kpis.avg_utilisation));
  set('ops-kpi-jobs',        IMSERV.fmt.num(kpis.total_jobs_completed));
  set('ops-kpi-productivity',kpis.productivity_jobs_per_day?.toFixed(2) || '—');
  set('ops-kpi-absence',     IMSERV.fmt.pct(kpis.absence_rate));
  applyOptimisationToKPIs();

  // Colour utilisation card
  const utilCard = document.getElementById('ops-kpi-util')?.closest('.kpi-card');
  if (utilCard) {
    const u = Number((document.getElementById('ops-kpi-util')?.textContent || '').replace('%', '')) || kpis.avg_utilisation;
    utilCard.className = `kpi-card ${u > 90 ? 'crit' : (u > 75 ? 'warn' : 'ok')}`;
  }
}

async function loadCapacityMatrix() {
  const year = IMSERV.getYear();
  IMSERV.setLoading('capacity-matrix-chart', true);
  const data = await IMSERV.apiFetch('/api/field-ops/capacity-matrix?year=' + year);
  if (!data) {
    IMSERV.setLoading('capacity-matrix-chart', false);
    return;
  }

  const ctx = document.getElementById('capacity-matrix-chart');
  if (!ctx) {
    IMSERV.setLoading('capacity-matrix-chart', false);
    return;
  }

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
  const optimisedRegions = getAppliedRegionalMap();
  const capVals = regions.map(r => {
    const after = optimisedRegions[r];
    return after ? Math.round(after.capacity_after / Math.max(after.weeks || byRegion[r].count, 1)) : Math.round(byRegion[r].cap / byRegion[r].count);
  });
  const demVals = regions.map(r => {
    const after = optimisedRegions[r];
    return after ? Math.round(after.demand_jobs / Math.max(after.weeks || byRegion[r].count, 1)) : Math.round(byRegion[r].dem / byRegion[r].count);
  });
  const utilVals= regions.map((r, i) => {
    const after = optimisedRegions[r];
    return after ? after.utilisation_after : parseFloat((demVals[i] / Math.max(capVals[i], 1) * 100).toFixed(1));
  });

  IMSERV.destroyChart('capacity-matrix');
  IMSERV.registerChart('capacity-matrix', new Chart(ctx, {
    type: 'bar',
    data: {
      labels: regions,
      datasets: [
        { label: 'Avg Weekly Engineer Capacity', data: capVals, backgroundColor: 'rgba(0,82,204,0.55)',   yAxisID: 'y'  },
        { label: 'Avg Weekly Meter Job Demand',  data: demVals, backgroundColor: 'rgba(0,184,217,0.55)',  yAxisID: 'y'  },
        { label: 'Utilisation %',       data: utilVals,borderColor: IMSERV.colors.warn, type: 'line', fill: false, tension: 0.3, pointRadius: 4, yAxisID: 'y1' },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: IMSERV.chartDefaults.plugins,
      scales: {
        ...IMSERV.chartDefaults.scales,
        y:  { ...IMSERV.chartDefaults.scales.y, position: 'left',  title: { display: true, text: 'Smart meter jobs / week', color: '#4A5568' } },
        y1: { ...IMSERV.chartDefaults.scales.y, position: 'right', grid: { display: false },
               ticks: { ...IMSERV.chartDefaults.scales.y.ticks, callback: v => v + '%' },
               min: 0, max: 120 },
      },
    },
  }));
  IMSERV.setLoading('capacity-matrix-chart', false);
}

async function loadPatchPlan() {
  const region = document.getElementById('patch-region-filter')?.value || 'NW';
  const year   = IMSERV.getYear();
  IMSERV.setLoading('patch-plan-body', true);
  const data   = await IMSERV.apiFetch(`/api/field-ops/patch-plan?region=${region}&year=${year}`);
  const body   = document.getElementById('patch-plan-body');
  if (!body || !data) {
    IMSERV.setLoading('patch-plan-body', false);
    return;
  }

  if (!data.length) {
    body.innerHTML = '<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-title">No patch data available</div></div>';
    IMSERV.setLoading('patch-plan-body', false);
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
        <div class="stat-chip" style="flex-shrink:0">Meter demand: ${IMSERV.fmt.num(p.demand_jobs)}</div>
        <div class="stat-chip" style="flex-shrink:0">Engineer capacity: ${IMSERV.fmt.num(p.capacity_jobs)}</div>
      </div>
    `;
  }).join('');
  IMSERV.setLoading('patch-plan-body', false);
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
  IMSERV.setLoading('understaff-chart', true);
  const data   = await IMSERV.apiFetch(`/api/field-ops/understaffing-forecast?region=${region}&weeks=8`);
  if (!data) {
    IMSERV.setLoading('understaff-chart', false);
    return;
  }

  // Chart
  const ctx = document.getElementById('understaff-chart');
  if (ctx) {
    IMSERV.destroyChart('understaff');
    IMSERV.registerChart('understaff', new Chart(ctx, {
      type: 'line',
      data: {
        labels: data.map(d => 'W' + d.week_number),
        datasets: [
          { label: 'Utilisation %', data: data.map(d => d.utilisation_pct), borderColor: IMSERV.colors.accent, fill: false, tension: 0.4, pointRadius: 4 },
          { label: 'Engineer Capacity', data: data.map(d => d.capacity_jobs),   borderColor: IMSERV.colors.ok,    yAxisID: 'y2', fill: false, tension: 0.3, pointRadius: 0, borderDash: [4,3] },
          { label: 'Meter Job Demand',  data: data.map(d => d.demand_forecast), borderColor: IMSERV.colors.crit,  yAxisID: 'y2', fill: false, tension: 0.3, pointRadius: 0 },
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
  IMSERV.setLoading('understaff-chart', false);

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

function updateOptimiseRange(rangeId, valId, suffix) {
  const range = document.getElementById(rangeId);
  const valEl = document.getElementById(valId);
  if (range && valEl) valEl.textContent = range.value + (suffix || '');
  const implementBtn = document.getElementById('optimise-implement-btn');
  if (_lastOptimisationResult && !_appliedOptimisation && implementBtn) {
    implementBtn.disabled = true;
  }
  const label = document.getElementById('optimise-state-label');
  if (label && !_appliedOptimisation) label.textContent = 'Parameters changed; run optimisation to refresh the plan';
}

function getOptimiseParams() {
  const val = (id, fallback) => Number(document.getElementById(id)?.value || fallback);
  const maxMove = val('opt-max-move', 5);
  const minMove = Math.min(val('opt-min-move', 1), maxMove);
  const minMoveInput = document.getElementById('opt-min-move');
  if (minMoveInput && Number(minMoveInput.value) !== minMove) {
    minMoveInput.value = minMove;
    updateOptimiseRange('opt-min-move', 'opt-min-move-val', '');
  }
  return {
    target: val('opt-target', 78),
    tolerance: val('opt-tolerance', 2),
    max_move: maxMove,
    min_move: minMove,
    max_dist: val('opt-max-dist', 50),
  };
}

function optimisationQuery(params) {
  const qs = new URLSearchParams({
    year: IMSERV.getYear(),
    target: params.target,
    tolerance: params.tolerance,
    max_move: params.max_move,
    min_move: params.min_move,
    max_dist: params.max_dist,
  });
  return qs.toString();
}

function restoreAppliedOptimisation() {
  try {
    const raw = localStorage.getItem(RESOURCE_OPT_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    _appliedOptimisation = parsed?.year === IMSERV.getYear() ? parsed.result : null;
  } catch (e) {
    _appliedOptimisation = null;
  }
}

function persistAppliedOptimisation(result) {
  _appliedOptimisation = result;
  localStorage.setItem(RESOURCE_OPT_STORAGE_KEY, JSON.stringify({
    year: IMSERV.getYear(),
    result,
  }));
}

function clearAppliedOptimisation() {
  _appliedOptimisation = null;
  localStorage.removeItem(RESOURCE_OPT_STORAGE_KEY);
}

function getAppliedRegionalMap() {
  const map = {};
  (_appliedOptimisation?.regional_before_after || []).forEach(r => {
    map[r.region_code] = r;
  });
  return map;
}

function applyOptimisationToKPIs() {
  if (!_appliedOptimisation) return;
  const utilEl = document.getElementById('ops-kpi-util');
  const engineerEl = document.getElementById('ops-kpi-engineers');
  if (!utilEl) return;
  const region = IMSERV.getRegion();
  const regionalMap = getAppliedRegionalMap();
  const regionAfter = region ? regionalMap[region] : null;
  const utilAfter = regionAfter ? regionAfter.utilisation_after : _appliedOptimisation.avg_utilisation_after;
  if (utilAfter != null) utilEl.textContent = IMSERV.fmt.pct(utilAfter);
  if (engineerEl && regionAfter?.engineers_after != null) {
    engineerEl.textContent = IMSERV.fmt.num(regionAfter.engineers_after);
  }
}

function updateOptimisationButtons() {
  const implementBtn = document.getElementById('optimise-implement-btn');
  const revertBtn = document.getElementById('optimise-revert-btn');
  const label = document.getElementById('optimise-state-label');
  if (implementBtn) {
    implementBtn.disabled = !_lastOptimisationResult || !!_appliedOptimisation || !(_lastOptimisationResult.recommendations || []).length;
  }
  if (revertBtn) {
    revertBtn.style.display = _appliedOptimisation ? 'inline-flex' : 'none';
  }
  if (label) {
    if (_appliedOptimisation) {
      label.textContent = `Applied: ${_appliedOptimisation.total_engineers_moved || 0} engineers moved`;
      label.className = 'text-ok fs-11';
    } else if (_lastOptimisationResult && !(_lastOptimisationResult.recommendations || []).length) {
      label.textContent = 'No moves available for the current parameters';
      label.className = 'text-muted fs-11';
    } else {
      label.textContent = _lastOptimisationResult ? 'Ready to implement this optimisation' : 'No optimisation applied';
      label.className = 'text-muted fs-11';
    }
  }
}

function renderOptimisationResult(data, applied = false) {
  const body = document.getElementById('optimise-body');
  if (!body || !data) return;

  const recs = data.recommendations || [];
  const statusHtml = applied ? `
    <div class="alert alert-ok mb-12">
      Optimisation implemented. Capacity and utilisation views now show the optimised allocation.
    </div>
  ` : '';

  const recsHtml = recs.map(r => `
    <div class="rec-card High">
      <div class="rec-icon"></div>
      <div class="rec-body">
        <div class="rec-title">Transfer ${r.engineers} engineers: ${r.from_region} to ${r.to_region}</div>
        <div class="rec-desc">${r.rationale}</div>
        <div class="rec-meta">
          <span class="rec-metric">${r.from_region}: ${IMSERV.fmt.pct(r.from_utilisation_before)} to ${IMSERV.fmt.pct(r.from_utilisation_after)}</span>
          <span class="rec-metric">${r.to_region}: ${IMSERV.fmt.pct(r.to_utilisation_before)} to ${IMSERV.fmt.pct(r.to_utilisation_after)}</span>
        </div>
      </div>
    </div>
  `).join('') || '<div class="text-muted fs-12">No rebalancing required with the current parameters. Tighten the action band or adjust the target utilisation to test a more aggressive plan.</div>';

  const rows = (data.regional_before_after || []).map(r => {
    const delta = r.engineers_after - r.engineers_before;
    const deltaCls = delta > 0 ? 'text-ok' : (delta < 0 ? 'text-warn' : 'text-muted');
    return `
      <tr>
        <td><strong>${r.region_code}</strong></td>
        <td>${IMSERV.fmt.pct(r.utilisation_before)}</td>
        <td>${IMSERV.fmt.pct(r.utilisation_after)}</td>
        <td class="${deltaCls}">${delta > 0 ? '+' : ''}${delta}</td>
      </tr>
    `;
  }).join('');

  body.innerHTML = `
    ${statusHtml}
    <div class="grid-3 mb-12">
      <div class="kpi-card ok">
        <div class="kpi-label">Avg Utilisation Before</div>
        <div class="kpi-value">${IMSERV.fmt.pct(data.avg_utilisation_before)}</div>
      </div>
      <div class="kpi-card ok">
        <div class="kpi-label">Avg Utilisation After</div>
        <div class="kpi-value">${IMSERV.fmt.pct(data.avg_utilisation_after)}</div>
      </div>
      <div class="kpi-card info">
        <div class="kpi-label">Balance Gain</div>
        <div class="kpi-value">+${IMSERV.fmt.pct(data.estimated_efficiency_gain_pct)}</div>
      </div>
    </div>
    <div class="d-flex gap-8 mb-12 flex-wrap">
      <span class="stat-chip">Target: <strong>${IMSERV.fmt.pct(data.parameters?.target_utilisation_pct)}</strong></span>
      <span class="stat-chip">Action band: <strong>${IMSERV.fmt.pct(data.parameters?.lower_bound_pct)}-${IMSERV.fmt.pct(data.parameters?.upper_bound_pct)}</strong></span>
      <span class="stat-chip">Engineers moved: <strong>${data.total_engineers_moved || 0}</strong></span>
    </div>
    <div class="grid-5-7 optimise-result-grid">
      <div>
        <div class="fs-12 fw-600 mb-8 text-muted">REGION IMPACT</div>
        <table class="data-table optimise-impact-table">
          <thead><tr><th>Region</th><th>Before</th><th>After</th><th>Engineers</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div>
        <div class="fs-12 fw-600 mb-8 text-muted">REBALANCING RECOMMENDATIONS</div>
        <div class="rec-list">${recsHtml}</div>
      </div>
    </div>
  `;
  IMSERV.hydrateIcons(body);
}

async function loadOptimisation() {
  const params = getOptimiseParams();
  const body = document.getElementById('optimise-body');
  if (body) {
    body.innerHTML = `
      <div class="empty-state">
        <div class="loading"><span class="spinner"></span></div>
        <div class="empty-title mt-16">Running Optimisation...</div>
        <div class="empty-desc">Analysing capacity gaps and calculating optimal workforce rebalancing</div>
      </div>
    `;
  }
  const data = await IMSERV.apiFetch('/api/field-ops/optimise?' + optimisationQuery(params), { force: true });
  if (!data) {
    if (body) {
      body.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon text-crit">⚠️</div>
          <div class="empty-title">Optimisation Failed</div>
          <div class="empty-desc">An error occurred while generating recommendations. Please try again.</div>
        </div>
      `;
    }
    return;
  }
  _lastOptimisationResult = data;
  renderOptimisationResult(data, false);
  updateOptimisationButtons();
}

function implementOptimisation() {
  if (!_lastOptimisationResult || !(_lastOptimisationResult.recommendations || []).length) return;
  persistAppliedOptimisation(_lastOptimisationResult);
  renderOptimisationResult(_lastOptimisationResult, true);
  applyOptimisationToKPIs();
  updateOptimisationButtons();
  if (_activeOpsTab === 'capacity') loadCapacityMatrix();
}

function revertOptimisation() {
  clearAppliedOptimisation();
  _lastOptimisationResult = null;
  const body = document.getElementById('optimise-body');
  if (body) {
    body.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon"></div>
        <div class="empty-title">Optimisation reverted</div>
        <div class="empty-desc">Original allocation restored. Run optimisation to generate a new plan.</div>
      </div>
    `;
    IMSERV.hydrateIcons(body);
  }
  updateOptimisationButtons();
  loadFieldOpsDashboard();
}

function switchOpsTab(name, el) {
  _activeOpsTab = name;
  document.querySelectorAll('.ops-tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('#view-field-ops .tab-item').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#field-ops-subnav .nav-subitem').forEach(t => t.classList.remove('active'));
  const panel = document.getElementById('opstab-' + name);
  if (panel) panel.classList.add('active');
  if (el) el.classList.add('active');
  if (typeof activateSidebarSubnav === 'function') activateSidebarSubnav('field-ops', name);

  requestAnimationFrame(loadActiveOpsTabData);
}

function switchOpsSidebarTab(name, el) {
  if (_currentView !== 'field-ops') {
    switchView('field-ops', document.querySelector('.nav-item[data-view="field-ops"]'));
  }
  switchOpsTab(name, el);
}

function loadActiveOpsTabData() {
  if (_activeOpsTab === 'capacity') {
    return loadCapacityMatrix();
  } else if (_activeOpsTab === 'patch') {
    return loadPatchPlan();
  } else if (_activeOpsTab === 'engineers') {
    return loadEngineerPerformance();
  } else if (_activeOpsTab === 'forecast') {
    return loadUnderstaffing();
  } else if (_activeOpsTab === 'optimise') {
    if (_appliedOptimisation) {
      renderOptimisationResult(_appliedOptimisation, true);
      updateOptimisationButtons();
    }
  }
  return Promise.resolve();
}
