/* IMSERV — Module 1: Appointment Journey Dashboard */

let _journeyTrendChart = null;
let _regionalSuccessView = 'requests';
let _lastRegionalHeatmapData = null;
let _ukBoundaryGeoJsonPromise = null;

async function loadJourneyDashboard() {
  const region = IMSERV.getRegion();
  const year   = IMSERV.getYear();
  const qs     = `?region=${region}&year=${year}`;
  refreshJourneyVisualLabels();
  const loadingTargets = [
    'funnel-chart',
    'journey-trend-chart',
    'regional-heatmap-grid',
    'decomposition-tree-container',
    'supplier-behaviour-grid',
  ];
  IMSERV.setLoading(loadingTargets, true);

  try {
    // Keep the first paint light; AI recommendations load after the main dashboard.
    const [kpis, heatmap, trend, suppliers] = await Promise.all([
      IMSERV.apiFetch('/api/journey/kpis' + qs),
      IMSERV.apiFetch('/api/journey/regional-heatmap' + qs),
      IMSERV.apiFetch('/api/journey/weekly-trend' + qs),
      IMSERV.apiFetch('/api/journey/suppliers' + qs + '&top_n=25'),
    ]);

    if (kpis)    renderJourneyKPIs(kpis);
    if (heatmap) renderRegionalHeatmap(heatmap);

    if (trend) renderJourneyTrend(trend);

    // Render funnel (uses KPI data)
    if (kpis) renderFunnel(kpis);

    if (suppliers) renderSupplierBehaviour(suppliers);

    await loadDecompositionTree();
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
    ['Smart Meter Appointment Journey Funnel', 'Shows customer data loaded into dialler, contact attempts, appointments booked, D-1 cancellations, total visits, same-day aborts and successful execution'],
    ['Weekly Smart Meter Appointment and Success Trend', 'Monthly stacked trend of appointments booked, D-1 cancellations and same-day aborts'],
    ['Regional Appointment and Success Status', 'UK map coloured by selected regional success rate'],
  ];

  document.querySelectorAll('#view-journey .card-title').forEach(title => {
    const match = updates.find(([currentTitle]) => title.textContent.includes(currentTitle));
    if (!match) return;
    title.textContent = match[0];
    delete title.dataset.iconReady;
    const subtitle = title.closest('.card-header')?.querySelector('.card-subtitle');
    if (subtitle) subtitle.textContent = match[1];
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
        <div><span>Appointments Booked</span><strong>${IMSERV.fmt.num(r.bookings)}</strong></div>
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
        <span>${IMSERV.fmt.num(t.bookings)} appointments booked</span>
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
  const uniqueCustomers = kpis.unique_customers
    ?? (kpis.avg_contacts_per_customer ? Math.round((kpis.total_contacts || 0) / kpis.avg_contacts_per_customer) : kpis.total_requests);
  set('kpi-customers',        IMSERV.fmt.num(uniqueCustomers));
  set('kpi-appointments-booked', IMSERV.fmt.num(kpis.total_bookings));
  set('kpi-contacts',         IMSERV.fmt.num(kpis.total_contacts));
  set('kpi-avg-contacts',     kpis.avg_contacts_per_customer?.toFixed(2) || '—');
  set('kpi-bookings',         IMSERV.fmt.num(kpis.total_visits ?? Math.max((kpis.total_bookings || 0) - (kpis.total_cancellations || 0), 0)));
  set('kpi-cancellations',    IMSERV.fmt.num(kpis.total_cancellations));
  set('kpi-aborts',           IMSERV.fmt.num(kpis.total_aborts));
  set('kpi-completions',      IMSERV.fmt.num(kpis.total_completions));
  set('kpi-completion-rate',  IMSERV.fmt.pct(kpis.completion_rate));

  // Colour the completion rate card
  const crCard = document.getElementById('kpi-success-rate-card');
  if (crCard && kpis.completion_rate) {
    crCard.className = `kpi-card ${kpis.completion_rate >= 65 ? 'ok' : (kpis.completion_rate >= 55 ? 'warn' : 'crit')}`;
  }
}

function journeyEscapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderFunnel(kpis) {
  const uniqueCustomers = kpis.unique_customers
    ?? (kpis.avg_contacts_per_customer ? Math.round((kpis.total_contacts || 0) / kpis.avg_contacts_per_customer) : kpis.total_requests);
  const visits = kpis.total_visits ?? Math.max((kpis.total_bookings || 0) - (kpis.total_cancellations || 0), 0);
  const steps = [
    { label: 'Customer Data Loaded Into Dialler', key: 'customers',     cls: 'requests',      val: uniqueCustomers },
    { label: 'Contact Attempts',                  key: 'contacts',      cls: 'contacts',      val: kpis.total_contacts },
    { label: 'Appointments Booked',               key: 'appointments',  cls: 'bookings',      val: kpis.total_bookings },
    { label: 'Appointments Cancelled (D-1)',      key: 'cancelled',     cls: 'cancellations', val: kpis.total_cancellations },
    { label: 'Appointments Aborted On The Day Of Visit', key: 'aborted', cls: 'aborts',        val: kpis.total_aborts },
    { label: 'Total Visits',                      key: 'visits',        cls: 'visits',        val: visits },
    { label: 'Executed Successfully',             key: 'executed',      cls: 'completions',   val: kpis.total_completions },
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
  }).join('') + `
    <div class="d-flex gap-8 mt-12 flex-wrap justify-content-center">
      <span class="stat-chip">Success Rate: <strong>${IMSERV.fmt.pct(kpis.completion_rate)}</strong></span>
      <span class="stat-chip">Average Contacts Per Customer: <strong>${kpis.avg_contacts_per_customer?.toFixed(2) || '—'}</strong></span>
    </div>
  `;
}

function renderJourneyTrend(data) {
  IMSERV.destroyChart('journey-trend');
  const container = document.getElementById('journey-trend-chart');
  if (!container) return;

  const labels = data.labels || [];
  const bookings = data.bookings || [];
  const cancellations = data.cancellations || [];
  const aborts = data.aborts || [];

  if (!labels.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon"></div><div class="empty-title">No appointment trend available</div></div>';
    return;
  }

  const monthFormatter = new Intl.DateTimeFormat('en-GB', { month: 'short' });
  const monthly = new Map();

  labels.forEach((label, idx) => {
    const date = new Date(label);
    if (Number.isNaN(date.getTime())) return;
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    if (!monthly.has(key)) {
      monthly.set(key, {
        label: monthFormatter.format(date),
        bookings: 0,
        cancellations: 0,
        aborts: 0,
      });
    }
    const bucket = monthly.get(key);
    bucket.bookings += Number(bookings[idx]) || 0;
    bucket.cancellations += Number(cancellations[idx]) || 0;
    bucket.aborts += Number(aborts[idx]) || 0;
  });

  const months = Array.from(monthly.values()).slice(-12);
  if (!months.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon"></div><div class="empty-title">No monthly appointment trend available</div></div>';
    return;
  }

  container.innerHTML = `
    <div class="journey-monthly-chart">
      <canvas id="journey-trend-canvas" aria-label="Monthly stacked bar chart of appointments booked, cancelled and aborted"></canvas>
    </div>
  `;

  const ctx = document.getElementById('journey-trend-canvas')?.getContext('2d');
  if (!ctx) return;

  IMSERV.registerChart('journey-trend', new Chart(ctx, {
    type: 'bar',
    data: {
      labels: months.map(m => m.label),
      datasets: [
        {
          label: 'Appointments Booked',
          data: months.map(m => m.bookings),
          backgroundColor: 'rgba(2, 194, 183, 0.72)',
          borderColor: 'rgba(2, 194, 183, 1)',
          borderWidth: 1,
          borderRadius: 4,
          stack: 'appointments',
        },
        {
          label: 'Appointments Cancelled (D-1)',
          data: months.map(m => m.cancellations),
          backgroundColor: 'rgba(251, 130, 129, 0.78)',
          borderColor: 'rgba(251, 130, 129, 1)',
          borderWidth: 1,
          borderRadius: 4,
          stack: 'appointments',
        },
        {
          label: 'Appointments Aborted',
          data: months.map(m => m.aborts),
          backgroundColor: 'rgba(244, 210, 90, 0.82)',
          borderColor: 'rgba(244, 210, 90, 1)',
          borderWidth: 1,
          borderRadius: 4,
          stack: 'appointments',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        ...IMSERV.chartDefaults.plugins,
        tooltip: {
          ...IMSERV.chartDefaults.plugins.tooltip,
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${IMSERV.fmt.num(ctx.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          ...IMSERV.chartDefaults.scales.x,
          stacked: true,
          grid: { display: false },
        },
        y: {
          ...IMSERV.chartDefaults.scales.y,
          stacked: true,
          beginAtZero: true,
          ticks: {
            ...IMSERV.chartDefaults.scales.y.ticks,
            callback: value => IMSERV.fmt.num(value),
          },
        },
      },
    },
  }));
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
              <span><b>${IMSERV.fmt.num(r.completions)}</b> executed successfully</span>
              <span><b>${IMSERV.fmt.num(r.requests)}</b> appointments booked</span>
              <span><b>${IMSERV.fmt.num(lossTotal)}</b> cancelled + aborted</span>
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
              <div style="font-size:11px; color:var(--text-muted); text-transform:uppercase; font-weight:600; letter-spacing:0.5px;">Success Rate</div>
              <div style="font-size:28px; font-weight:800; color:var(--text-primary); line-height:1.2;">${IMSERV.fmt.pct(r.completion_rate)}</div>
              <div style="height:6px; background:rgba(255,255,255,0.1); border-radius:3px; margin-top:8px; overflow:hidden;">
                 <div style="height:100%; width:${r.completion_rate}%; background:${borderColor}; border-radius:3px;"></div>
              </div>
           </div>
        </div>
        
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
           <div style="background:var(--bg-surface); padding:10px; border-radius:6px; border: 1px solid var(--border);">
              <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; font-weight:600;">Appointments Booked</div>
              <div style="font-size:15px; font-weight:700; color:var(--text-primary);">${IMSERV.fmt.num(r.requests)}</div>
           </div>
           <div style="background:var(--bg-surface); padding:10px; border-radius:6px; border: 1px solid var(--border);">
              <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; font-weight:600;">Executed Successfully</div>
              <div style="font-size:15px; font-weight:700; color:var(--ok);">${IMSERV.fmt.num(r.completions)}</div>
           </div>
           <div style="background:var(--bg-surface); padding:10px; border-radius:6px; border: 1px solid var(--border);">
              <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; font-weight:600;">Cancelled (D-1)</div>
              <div style="font-size:15px; font-weight:700; color:var(--crit);">${IMSERV.fmt.num(r.cancellations)}</div>
           </div>
           <div style="background:var(--bg-surface); padding:10px; border-radius:6px; border: 1px solid var(--border);">
              <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; font-weight:600;">Aborted On Day</div>
              <div style="font-size:15px; font-weight:700; color:var(--warn);">${IMSERV.fmt.num(r.aborts)}</div>
           </div>
        </div>
      </div>
    `;
  }).join('');
}

function loadUkBoundaryGeoJson() {
  if (!_ukBoundaryGeoJsonPromise) {
    _ukBoundaryGeoJsonPromise = fetch('/static/data/gb-all.geo.json')
      .then(response => {
        if (!response.ok) throw new Error('UK boundary map failed to load');
        return response.json();
      });
  }
  return _ukBoundaryGeoJsonPromise;
}

function boundaryRegionCode(feature) {
  if (feature?.properties?.region_code) return feature.properties.region_code;
  const region = feature?.properties?.region || '';
  if (region === 'Northern Ireland') return null;
  if (region.includes('Wales')) return 'WAL';
  if (['Highlands and Islands', 'North Eastern', 'Eastern', 'South Western'].includes(region)) return 'SCO';
  if (region === 'North East') return 'NE';
  if (region === 'North West') return 'NW';
  if (region === 'Yorkshire and the Humber') return 'YRK';
  if (region === 'East Midlands' || region === 'West Midlands') return 'MID';
  if (region === 'South West') return 'SW';
  if (['South East', 'Greater London', 'East'].includes(region)) return 'SE';
  return null;
}

function collectGeoCoordinates(geometry, points = []) {
  if (!geometry) return points;
  if (geometry.type === 'Point') {
    points.push(geometry.coordinates);
    return points;
  }
  if (geometry.type === 'Polygon') {
    geometry.coordinates.forEach(ring => ring.forEach(point => points.push(point)));
    return points;
  }
  if (geometry.type === 'MultiPolygon') {
    geometry.coordinates.forEach(poly => poly.forEach(ring => ring.forEach(point => points.push(point))));
  }
  return points;
}

function createUkProjection(features, width = 560, height = 680, padding = 14) {
  const points = features.flatMap(feature => collectGeoCoordinates(feature.geometry, []));
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const project = ([x, y]) => {
    return [
      padding + ((x - minX) / (maxX - minX)) * (width - padding * 2),
      padding + ((maxY - y) / (maxY - minY)) * (height - padding * 2),
    ];
  };

  return { width, height, project };
}

function geometryToSvgPath(geometry, project) {
  const ringToPath = ring => ring.map((point, index) => {
    const [x, y] = project(point);
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ') + ' Z';

  if (geometry.type === 'Polygon') {
    return geometry.coordinates.map(ringToPath).join(' ');
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.flatMap(poly => poly.map(ringToPath)).join(' ');
  }
  return '';
}

async function renderRegionalHeatmap(data) {
  const container = document.getElementById('regional-heatmap-grid');
  if (!container) return;
  if (!data || !data.length) {
    container.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1;"><div class="empty-icon"></div><div class="empty-title">No data available</div></div>';
    return;
  }

  _lastRegionalHeatmapData = data;
  container.innerHTML = '<div class="loading"><span class="spinner"></span> Loading UK map...</div>';

  let geoJson;
  try {
    geoJson = await loadUkBoundaryGeoJson();
  } catch (error) {
    container.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1;"><div class="empty-icon"></div><div class="empty-title">UK map boundaries unavailable</div></div>';
    return;
  }

  const projection = createUkProjection(geoJson.features);

  const generateMapPanel = (metric) => {
    const metricLabel = metric === 'booked' ? 'Success Rate - Completed vs Appointments Booked' : 'Success Rate - Completed vs Requested';
    const denominatorLabel = metric === 'booked' ? 'Appointments Booked' : 'Requested';
    const denominatorFor = (r) => metric === 'booked' ? (r.bookings ?? r.requests ?? 0) : (r.requests || 0);
    const rateFor = (r) => {
      const denominator = denominatorFor(r);
      return denominator ? ((r.completions || 0) / denominator) * 100 : 0;
    };

    const rows = [...data]
      .map(r => ({
        ...r,
        bookings: r.bookings ?? r.requests ?? 0,
        selected_success_rate: rateFor(r),
      }))
      .sort((a, b) => b.selected_success_rate - a.selected_success_rate);

    const selectedRates = rows.map(r => r.selected_success_rate);
    const minSelectedRate = Math.min(...selectedRates);
    const maxSelectedRate = Math.max(...selectedRates);
    const selectedRateRange = Math.max(maxSelectedRate - minSelectedRate, 0.1);
    const toneForRate = (rate) => {
      const scaled = (rate - minSelectedRate) / selectedRateRange;
      if (scaled >= 0.83) return 'tier1';
      if (scaled >= 0.66) return 'tier2';
      if (scaled >= 0.50) return 'tier3';
      if (scaled >= 0.33) return 'tier4';
      if (scaled >= 0.16) return 'tier5';
      return 'tier6';
    };
    const fmtBp = v => v.toFixed(1) + '%';
    const bp1 = minSelectedRate + 0.83 * selectedRateRange;
    const bp2 = minSelectedRate + 0.66 * selectedRateRange;
    const bp3 = minSelectedRate + 0.50 * selectedRateRange;
    const bp4 = minSelectedRate + 0.33 * selectedRateRange;
    const bp5 = minSelectedRate + 0.16 * selectedRateRange;

    const totalRequests = rows.reduce((sum, r) => sum + (r.requests || 0), 0);
    const totalBookings = rows.reduce((sum, r) => sum + (r.bookings || 0), 0);
    const totalCompletions = rows.reduce((sum, r) => sum + (r.completions || 0), 0);
    const totalDenominator = metric === 'booked' ? totalBookings : totalRequests;
    const averageCompletion = totalDenominator ? (totalCompletions / totalDenominator) * 100 : 0;
    const maxBookings = Math.max(...rows.map(r => r.bookings || 0), 1);
    
    const regionByCode = Object.fromEntries(rows.map(row => [row.region_code, row]));
    const labelBuckets = {};

    const shapes = geoJson.features.map(feature => {
      const code = boundaryRegionCode(feature);
      const region = code ? regionByCode[code] : null;
      const path = geometryToSvgPath(feature.geometry, projection.project);
      
      if (region) {
        const bucket = labelBuckets[code] || (labelBuckets[code] = { x: 0, y: 0, count: 0 });
        if (feature.properties.label_lon !== undefined) {
          const [x, y] = projection.project([feature.properties.label_lon, feature.properties.label_lat]);
          bucket.x = x;
          bucket.y = y;
          bucket.count = 1;
        } else {
          const featurePoints = collectGeoCoordinates(feature.geometry, []);
          if (featurePoints.length) {
            const centroid = featurePoints.reduce(
              (sum, point) => [sum[0] + point[0], sum[1] + point[1]],
              [0, 0],
            ).map(total => total / featurePoints.length);
            const [x, y] = projection.project(centroid);
            bucket.x += x;
            bucket.y += y;
            bucket.count += 1;
          }
        }
      }
      
      if (!region) {
        return `<path class="uk-map-context" d="${path}"></path>`;
      }
      const rate = region.selected_success_rate;
      const tone = toneForRate(rate);
      const opacity = 0.78 + Math.min(0.20, ((region.bookings || 0) / maxBookings) * 0.20);
      return `<path class="uk-region ${tone}" style="--region-opacity:${opacity};" d="${path}"
        data-region-name="${(region.region_name || region.region_code).replace(/"/g, '&quot;')}"
        data-rate="${rate.toFixed(2)}"
        data-completed="${region.completions || 0}"
        data-denominator="${denominatorFor(region)}"
        data-denominator-label="${denominatorLabel}"></path>`;
    }).join('');

    const labelOffsets = {};
    
    const labels = Object.entries(labelBuckets).map(([code, bucket]) => {
      const region = regionByCode[code];
      const offset = labelOffsets[code] || { x: 0, y: 0 };
      const x = (bucket.x / bucket.count) + offset.x;
      const y = (bucket.y / bucket.count) + offset.y;
      return `
        <g class="uk-region-label">
          <text x="${x.toFixed(1)}" y="${(y - 7).toFixed(1)}">${code}</text>
          <text class="uk-region-rate" x="${x.toFixed(1)}" y="${(y + 9).toFixed(1)}">${IMSERV.fmt.pct(region.selected_success_rate)}</text>
        </g>
      `;
    }).join('');

    return {
      html: `
        <div class="uk-map-panel">
          <div class="uk-map-toolbar">
            <div>
              <span>Success Rate</span>
              <strong>${metric === 'booked' ? 'Completed vs Appointments Booked' : 'Completed vs Requested'}</strong>
            </div>
          </div>
          <div class="uk-map-stage">
            <svg class="uk-map-svg" viewBox="0 0 ${projection.width} ${projection.height}" role="img" aria-label="UK regional success rate map" preserveAspectRatio="xMidYMid meet">
              ${shapes}
              ${labels}
            </svg>
            <div class="uk-network-card">
              <span>Network average</span>
              <strong>${IMSERV.fmt.pct(averageCompletion)}</strong>
              <em>${IMSERV.fmt.num(totalCompletions)} completed / ${IMSERV.fmt.num(totalDenominator)} ${metric === 'booked' ? 'booked' : 'requested'}</em>
            </div>
            <div class="uk-map-tooltip" hidden></div>
          </div>
          <div class="uk-map-legend" aria-label="Success rate legend">
            <span><i class="legend-tier1"></i>${fmtBp(bp1)} – ${fmtBp(maxSelectedRate)}</span>
            <span><i class="legend-tier2"></i>${fmtBp(bp2)} – ${fmtBp(bp1)}</span>
            <span><i class="legend-tier3"></i>${fmtBp(bp3)} – ${fmtBp(bp2)}</span>
            <span><i class="legend-tier4"></i>${fmtBp(bp4)} – ${fmtBp(bp3)}</span>
            <span><i class="legend-tier5"></i>${fmtBp(bp5)} – ${fmtBp(bp4)}</span>
            <span><i class="legend-tier6"></i>${fmtBp(minSelectedRate)} – ${fmtBp(bp5)}</span>
          </div>
        </div>
      `,
      rows,
      metricLabel,
      totalLosses: rows.reduce((sum, r) => sum + (r.cancellations || 0) + (r.aborts || 0), 0)
    };
  };

  const mapRequest = generateMapPanel('requests');
  const mapBooked = generateMapPanel('booked');

  container.innerHTML = `
    <div class="uk-region-dashboard">
      ${mapRequest.html}
      ${mapBooked.html}
    </div>
  `;

  container.querySelectorAll('.uk-map-stage').forEach(stage => {
    const svg = stage.querySelector('.uk-map-svg');
    const tooltip = stage.querySelector('.uk-map-tooltip');
    if (!svg || !tooltip) return;

    svg.addEventListener('mouseover', (e) => {
      const path = e.target.closest('.uk-region[data-region-name]');
      if (!path) { tooltip.hidden = true; return; }
      const name = path.dataset.regionName;
      const rate = parseFloat(path.dataset.rate);
      const completed = parseInt(path.dataset.completed, 10);
      const denominator = parseInt(path.dataset.denominator, 10);
      const denomLabel = path.dataset.denominatorLabel;
      const toneClass = [...path.classList].find(c => c.startsWith('tier')) || '';
      tooltip.innerHTML = `
        <div class="umt-header">
          <span class="umt-region">${name}</span>
          <span class="umt-badge ${toneClass}">${rate.toFixed(1)}%</span>
        </div>
        <div class="umt-divider"></div>
        <div class="umt-rows">
          <div class="umt-row"><span class="umt-label">Completed</span><strong class="umt-val umt-val--completed">${IMSERV.fmt.num(completed)}</strong></div>
          <div class="umt-row"><span class="umt-label">${denomLabel}</span><strong class="umt-val">${IMSERV.fmt.num(denominator)}</strong></div>
          <div class="umt-row umt-row--rate"><span class="umt-label">Success Rate</span><strong class="umt-val umt-val--rate">${rate.toFixed(1)}%</strong></div>
        </div>
      `;
      tooltip.hidden = false;
    });

    svg.addEventListener('mousemove', (e) => {
      if (tooltip.hidden) return;
      const rect = stage.getBoundingClientRect();
      let x = e.clientX - rect.left + 16;
      let y = e.clientY - rect.top - 16;
      if (x + 210 > rect.width) x = e.clientX - rect.left - 226;
      if (y < 4) y = 4;
      tooltip.style.left = x + 'px';
      tooltip.style.top = y + 'px';
    });

    svg.addEventListener('mouseleave', () => { tooltip.hidden = true; });
  });
}

function renderSupplierBehaviour(data) {
  const container = document.getElementById('supplier-behaviour-grid');
  if (!container) return;

  const suppliers = data?.suppliers || [];
  if (!suppliers.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-title">No supplier data available</div></div>';
    return;
  }

  const cardsHtml = suppliers.map((r, i) => {
    // If it's the last element and named "Others", don't show a rank number
    const isOthers = r.supplier_name === "Others";
    const rankStr = isOthers ? "—" : `#${i + 1}`;
    
    // Style logic
    const successColor = r.visit_success_rate >= 70 ? '#028178' : r.visit_success_rate >= 50 ? '#F4D25A' : '#FB8281';
    const falloutColor = r.fallout_rate <= 15 ? '#028178' : r.fallout_rate <= 25 ? '#F4D25A' : '#FB8281';

    return `
      <div class="rc-supplier-card">
        <div class="rc-supplier-header">
          <div class="rc-supplier-rank">${rankStr}</div>
          <div class="rc-supplier-name" title="${journeyEscapeHtml(r.supplier_name)}">${journeyEscapeHtml(r.supplier_name)}</div>
          <div class="rc-supplier-volume" title="Total Requests">Requests: ${IMSERV.fmt.num(r.requests)}</div>
        </div>
        <div class="rc-supplier-main-metric">
          <div class="rc-supplier-main-metric-label">
            <span>Booked</span>
            <span>${IMSERV.fmt.num(r.bookings)}</span>
          </div>
          <div class="rc-supplier-bar-bg" style="position: relative; overflow: hidden; background: rgba(255, 255, 255, 0.08);">
            <!-- Booked bar (total booked out of requests) -->
            <div class="rc-supplier-bar-fill" style="position: absolute; top: 0; left: 0; height: 100%; width: ${r.booking_rate}%; background: #3498db; opacity: 0.4;" title="Booked (${r.booking_rate}%)"></div>
            <!-- Completed bar (total completed out of requests) -->
            <div class="rc-supplier-bar-fill" style="position: absolute; top: 0; left: 0; height: 100%; width: ${(r.completions / Math.max(r.requests, 1)) * 100}%; background: #2ecc71;" title="Completed (${((r.completions / Math.max(r.requests, 1)) * 100).toFixed(1)}%)"></div>
          </div>
        </div>
        <div class="rc-supplier-secondary-metrics">
          <div class="rc-supplier-sec-metric">
            <span>Successful Completions</span>
            <strong>${IMSERV.fmt.num(r.completions)}</strong>
          </div>
          <div class="rc-supplier-sec-metric" style="text-align: right;">
            <span>Success Rate</span>
            <strong style="color: ${successColor}">${r.visit_success_rate}%</strong>
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = cardsHtml;
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



async function loadDecompositionTree() {
  const container = document.getElementById('decomposition-tree-container');
  if (!container) return;
  container.innerHTML = '<div class="loading"><span class="spinner"></span></div>';

  try {
    const region = IMSERV.getRegion();
    const year = IMSERV.getYear();
    const res = await fetch(`/api/journey/decomposition-tree?region=${region}&year=${year}`);
    if (!res.ok) throw new Error('Failed to load decomposition tree');
    const data = await res.json();
    renderDecompositionTree(data, container);
  } catch (err) {
    container.innerHTML = `<div class="error-msg">${err.message}</div>`;
  }
}


function renderDecompositionTree(data, container) {
  container.innerHTML = '';
  
  const fmt = (val) => val.toLocaleString();
  const pct = (val, maxVal) => maxVal > 0 ? ((val/maxVal)*100).toFixed(1) + '%' : '0%';

  let html = `<svg class="decomp-svg-layer" id="decomp-lines"></svg>`;

  // data-children will hold comma separated IDs of immediate children
  function makeNode(id, title, value, maxVal, colorClass, subTitle="", children=[]) {
    const p = maxVal ? (value / maxVal) * 100 : 0;
    const childrenAttr = children.length > 0 ? `data-children="${children.join(',')}"` : '';
    // Initially hide all nodes except the root
    const isRoot = id === 'node-total';
    const displayStyle = isRoot ? '' : 'style="display: none;"';
    const clickableClass = children.length > 0 ? 'clickable-node' : '';
    
    return `
      <div class="decomp-node ${clickableClass}" id="${id}" ${childrenAttr} ${displayStyle} onclick="toggleDecompNode('${id}')">
        <div class="decomp-node-header">${title}</div>
        <div class="decomp-node-value">${fmt(value)}</div>
        <div class="decomp-node-sub">${subTitle}</div>
        <div class="decomp-bar-container">
          <div class="decomp-bar ${colorClass}" style="width: ${p}%"></div>
        </div>
      </div>
    `;
  }

  const channelNodes = [];
  data.channels.forEach((ch, idx) => { channelNodes.push(`node-ch-${idx}`); });

  // Col 1
  html += `<div class="decomp-col" id="col-1">
    ${makeNode('node-total', 'Customer Data Loaded', data.total_loaded, data.total_loaded, 'blue', '100%', ['node-booked', 'node-notbooked'])}
  </div>`;

  // Col 2
  html += `<div class="decomp-col" id="col-2">
    ${makeNode('node-booked', 'Appointments Booked', data.booked, data.total_loaded, 'blue', pct(data.booked, data.total_loaded), channelNodes)}
    ${makeNode('node-notbooked', 'Not Booked', data.not_booked, data.total_loaded, 'amber', pct(data.not_booked, data.total_loaded))}
  </div>`;

  // Channels
  let col3 = '<div class="decomp-col" id="col-3">';
  let col4 = '<div class="decomp-col" id="col-4">';
  let col5 = '<div class="decomp-col" id="col-5">';
  let col6 = '<div class="decomp-col" id="col-6">';

  data.channels.forEach((ch, idx) => {
    const chId = `ch-${idx}`;
    col3 += makeNode(`node-${chId}`, `Channel: ${ch.channel}`, ch.booked, data.booked, 'blue', pct(ch.booked, data.booked), [`node-${chId}-visited`, `node-${chId}-cancel`]);
    
    col4 += makeNode(`node-${chId}-visited`, `Visited (${ch.channel})`, ch.visited, ch.booked, 'blue', pct(ch.visited, ch.booked), [`node-${chId}-success`, `node-${chId}-abort`]);
    col4 += makeNode(`node-${chId}-cancel`, `Cancelled (${ch.channel})`, ch.cancelled, ch.booked, 'red', pct(ch.cancelled, ch.booked));

    col5 += makeNode(`node-${chId}-success`, `Successful Visit`, ch.successful_visit, ch.visited, 'green', pct(ch.successful_visit, ch.visited), [`node-${chId}-executed`, `node-${chId}-unresolved`]);
    col5 += makeNode(`node-${chId}-abort`, `Aborted`, ch.aborted, ch.visited, 'red', pct(ch.aborted, ch.visited));

    col6 += makeNode(`node-${chId}-executed`, `Executed Successfully`, ch.executed_successfully, ch.successful_visit, 'green', pct(ch.executed_successfully, ch.successful_visit));
    col6 += makeNode(`node-${chId}-unresolved`, `Unresolved`, ch.unresolved, ch.successful_visit, 'amber', pct(ch.unresolved, ch.successful_visit));
  });

  col3 += '</div>';
  col4 += '</div>';
  col5 += '</div>';
  col6 += '</div>';

  html += col3 + col4 + col5 + col6;
  container.innerHTML = html;

  // Draw lines after render
  setTimeout(() => drawDecompLines(), 50);
}

window.toggleDecompNode = function(id) {
  const node = document.getElementById(id);
  if (!node) return;
  const childrenAttr = node.getAttribute('data-children');
  if (!childrenAttr) return; // Leaf node

  const childrenIds = childrenAttr.split(',');
  const firstChild = document.getElementById(childrenIds[0]);
  if (!firstChild) return;

  const isExpanded = firstChild.style.display !== 'none';

  if (isExpanded) {
    // Collapse: hide all descendants
    hideDescendants(id);
    node.classList.remove('expanded');
  } else {
    // Expand: show immediate children
    childrenIds.forEach(cid => {
      const cnode = document.getElementById(cid);
      if (cnode) {
        cnode.style.display = 'flex';
      }
    });
    node.classList.add('expanded');
  }

  // Redraw lines
  drawDecompLines();
};

function hideDescendants(id) {
  const node = document.getElementById(id);
  if (!node) return;
  const childrenAttr = node.getAttribute('data-children');
  if (childrenAttr) {
    const childrenIds = childrenAttr.split(',');
    childrenIds.forEach(cid => {
      const cnode = document.getElementById(cid);
      if (cnode) {
        cnode.style.display = 'none';
        cnode.classList.remove('expanded');
        hideDescendants(cid);
      }
    });
  }
}

function drawDecompLines() {
  const svg = document.getElementById('decomp-lines');
  const container = document.getElementById('decomposition-tree-container');
  if (!svg || !container) return;
  
  const rectC = container.getBoundingClientRect();
  svg.innerHTML = '';

  function connect(id1, id2) {
    const el1 = document.getElementById(id1);
    const el2 = document.getElementById(id2);
    // Only connect if both are visible
    if (!el1 || !el2 || el1.style.display === 'none' || el2.style.display === 'none') return;
    
    const r1 = el1.getBoundingClientRect();
    const r2 = el2.getBoundingClientRect();

    const x1 = r1.right - rectC.left + container.scrollLeft;
    const y1 = r1.top + r1.height/2 - rectC.top + container.scrollTop;
    const x2 = r2.left - rectC.left + container.scrollLeft;
    const y2 = r2.top + r2.height/2 - rectC.top + container.scrollTop;

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const cpX1 = x1 + (x2 - x1) / 2;
    const cpX2 = x1 + (x2 - x1) / 2;
    
    path.setAttribute("d", `M ${x1} ${y1} C ${cpX1} ${y1}, ${cpX2} ${y2}, ${x2} ${y2}`);
    svg.appendChild(path);
  }

  // Iterate over all nodes to draw lines to their visible children
  document.querySelectorAll('.decomp-node').forEach(node => {
    if (node.style.display !== 'none') {
       const childrenAttr = node.getAttribute('data-children');
       if (childrenAttr) {
         childrenAttr.split(',').forEach(cid => {
            connect(node.id, cid);
         });
       }
    }
  });
}


// Redraw lines on window resize or scroll
window.addEventListener('resize', () => {
  const container = document.getElementById('decomposition-tree-container');
  if (container && container.innerHTML.includes('decomp-node')) {
    // Re-fetch data? or just redraw
    // We don't have data globally stored in a clean way in this snippet, 
    // but we can trigger a reload or re-draw. 
    loadDecompositionTree();
  }
});
