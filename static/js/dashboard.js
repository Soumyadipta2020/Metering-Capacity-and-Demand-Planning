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
    'channel-comparison-grid',
    'supplier-behaviour-grid',
  ];
  IMSERV.setLoading(loadingTargets, true);

  try {
    // Keep the first paint light; AI recommendations load after the main dashboard.
    const [kpis, heatmap, trend, suppliers] = await Promise.all([
      IMSERV.apiFetch('/api/journey/kpis' + qs),
      IMSERV.apiFetch('/api/journey/regional-heatmap' + qs),
      IMSERV.apiFetch('/api/journey/weekly-trend' + qs),
      IMSERV.apiFetch('/api/journey/suppliers' + qs + '&top_n=18'),
    ]);

    if (kpis)    renderJourneyKPIs(kpis);
    if (heatmap) renderRegionalHeatmap(heatmap);

    if (trend) renderJourneyTrend(trend);

    // Render funnel (uses KPI data)
    if (kpis) renderFunnel(kpis);

    if (suppliers) renderSupplierBehaviour(suppliers);

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

  const metric = _regionalSuccessView === 'booked' ? 'booked' : 'requests';
  const metricLabel = metric === 'booked' ? 'Complete vs booked' : 'Complete vs request';
  const denominatorFor = (r) => metric === 'booked' ? (r.bookings ?? r.requests ?? 0) : (r.requests || 0);
  const rateFor = (r) => {
    const denominator = denominatorFor(r);
    return denominator ? ((r.completions || 0) / denominator) * 100 : 0;
  };
  let toneForRate = () => 'good';

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
  toneForRate = (rate) => {
    const scaled = (rate - minSelectedRate) / selectedRateRange;
    if (scaled >= 0.72) return 'strong';
    if (scaled >= 0.48) return 'good';
    if (scaled >= 0.24) return 'watch';
    return 'risk';
  };

  const totalRequests = rows.reduce((sum, r) => sum + (r.requests || 0), 0);
  const totalBookings = rows.reduce((sum, r) => sum + (r.bookings || 0), 0);
  const totalCompletions = rows.reduce((sum, r) => sum + (r.completions || 0), 0);
  const totalLosses = rows.reduce((sum, r) => sum + (r.cancellations || 0) + (r.aborts || 0), 0);
  const totalDenominator = metric === 'booked' ? totalBookings : totalRequests;
  const averageCompletion = totalDenominator ? (totalCompletions / totalDenominator) * 100 : 0;
  const strongest = rows[0];
  const watch = rows[rows.length - 1];
  const busiest = rows.reduce((best, r) => (r.bookings || 0) > (best.bookings || 0) ? r : best, rows[0]);
  const maxBookings = Math.max(...rows.map(r => r.bookings || 0), 1);

  container.innerHTML = '<div class="loading"><span class="spinner"></span> Loading UK map...</div>';

  let geoJson;
  try {
    geoJson = await loadUkBoundaryGeoJson();
  } catch (error) {
    container.innerHTML = '<div class="empty-state" style="grid-column: 1 / -1;"><div class="empty-icon"></div><div class="empty-title">UK map boundaries unavailable</div></div>';
    return;
  }

  const regionByCode = Object.fromEntries(rows.map(row => [row.region_code, row]));
  const projection = createUkProjection(geoJson.features);
  const labelBuckets = {};
  const shapes = geoJson.features.map(feature => {
    const code = boundaryRegionCode(feature);
    const region = code ? regionByCode[code] : null;
    const path = geometryToSvgPath(feature.geometry, projection.project);
    const featurePoints = collectGeoCoordinates(feature.geometry, []);
    if (region && featurePoints.length) {
      const bucket = labelBuckets[code] || (labelBuckets[code] = { x: 0, y: 0, count: 0 });
      const centroid = featurePoints.reduce(
        (sum, point) => [sum[0] + point[0], sum[1] + point[1]],
        [0, 0],
      ).map(total => total / featurePoints.length);
      const [x, y] = projection.project(centroid);
      bucket.x += x;
      bucket.y += y;
      bucket.count += 1;
    }
    if (!region) {
      return `<path class="uk-map-context" d="${path}"></path>`;
    }
    const rate = region.selected_success_rate;
    const tone = toneForRate(rate);
    const lossTotal = (region.cancellations || 0) + (region.aborts || 0);
    const opacity = 0.70 + Math.min(0.24, ((region.bookings || 0) / maxBookings) * 0.24);
    return `
      <path class="uk-region ${tone}" style="--region-opacity:${opacity};" d="${path}">
        <title>${feature.properties.name}, ${region.region_name || region.region_code}: ${IMSERV.fmt.pct(rate)} ${metricLabel.toLowerCase()}, ${IMSERV.fmt.num(region.bookings)} booked, ${IMSERV.fmt.num(lossTotal)} cancelled + aborted</title>
      </path>
    `;
  }).join('');

  const labelOffsets = {
    SCO: { x: 15, y: 40 },
    NW: { x: -2, y: -10 },
    NE: { x: -8, y: 10 },
    YRK: { x: -15, y: 25 },
    MID: { x: -10, y: 10 },
    WAL: { x: 10, y: 20 },
    SW: { x: 20, y: -10 },
    SE: { x: -25, y: -5 },
  };
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

  const focus = [
    { label: 'Strongest', region: strongest, metric: IMSERV.fmt.pct(strongest.selected_success_rate) },
    { label: 'Needs focus', region: watch, metric: IMSERV.fmt.pct(watch.selected_success_rate) },
    { label: 'Highest appointments booked', region: busiest, metric: IMSERV.fmt.num(busiest.bookings) },
  ].map(item => `
    <div class="region-focus-item">
      <span>${item.label}</span>
      <strong>${item.region.region_name || item.region.region_code}</strong>
      <em>${item.metric}</em>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="uk-region-dashboard">
      <div class="uk-map-panel">
        <div class="uk-map-toolbar">
          <div>
            <span>Success view</span>
            <strong>${metricLabel}</strong>
          </div>
          <div class="uk-map-toggle" role="tablist" aria-label="Regional success rate view">
            <button type="button" class="${metric === 'requests' ? 'active' : ''}" data-region-view="requests" role="tab" aria-selected="${metric === 'requests'}">Complete vs request</button>
            <button type="button" class="${metric === 'booked' ? 'active' : ''}" data-region-view="booked" role="tab" aria-selected="${metric === 'booked'}">Complete vs booked</button>
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
            <em>${IMSERV.fmt.num(totalCompletions)} completed / ${IMSERV.fmt.num(totalDenominator)} ${metric === 'booked' ? 'booked' : 'requests'}</em>
          </div>
        </div>
        <div class="uk-map-legend" aria-label="Success rate legend">
          <span><i class="legend-strong"></i>Highest</span>
          <span><i class="legend-good"></i>Above avg</span>
          <span><i class="legend-watch"></i>Below avg</span>
          <span><i class="legend-risk"></i>Lowest</span>
        </div>
      </div>
      <div class="region-focus-panel">
        ${focus}
        <div class="region-focus-item">
          <span>Cancelled + aborted</span>
          <strong>${IMSERV.fmt.num(totalLosses)}</strong>
          <em>${metricLabel}</em>
        </div>
      </div>
    </div>
  `;

  container.querySelectorAll('[data-region-view]').forEach(button => {
    button.addEventListener('click', () => {
      _regionalSuccessView = button.dataset.regionView === 'booked' ? 'booked' : 'requests';
      renderRegionalHeatmap(_lastRegionalHeatmapData);
    });
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

  const totals = data.totals || {};
  const maxRequests = Math.max(...suppliers.map(s => s.requests || 0), 1);
  const maxContribution = Math.max(...suppliers.map(s => s.contribution_pct || 0), 1);
  const maxBookings = Math.max(...suppliers.map(s => s.bookings || 0), 1);

  const minScoreRaw = Math.min(...suppliers.map(s => s.behaviour_score || 0));
  const maxScoreRaw = Math.max(...suppliers.map(s => s.behaviour_score || 0));
  const scorePadding = Math.max(1, (maxScoreRaw - minScoreRaw) * 0.15);
  const scoreMin = Math.max(0, minScoreRaw - scorePadding);
  const scoreMax = Math.min(100, maxScoreRaw + scorePadding);
  const scoreRange = Math.max(scoreMax - scoreMin, 1);

  const toneFor = (s) => {
    if ((s.fallout_rate || 0) >= 28 || (s.behaviour_score || 0) < 60) return 'hot';
    if ((s.fallout_rate || 0) >= 22 || (s.behaviour_score || 0) < 68) return 'warm';
    return 'cool';
  };

  const nodes = suppliers.map((s, idx) => {
    const contribution = Math.max(0, s.contribution_pct || 0);
    const score = Math.max(0, Math.min(100, s.behaviour_score || 0));
    const x = 9 + (contribution / maxContribution) * 82;
    const y = 90 - ((score - scoreMin) / scoreRange) * 76;
    const size = 28 + ((s.requests || 0) / maxRequests) * 34;
    const tone = toneFor(s);
    const name = journeyEscapeHtml(s.supplier_name);
    const initials = name
      .replace(/&amp;/g, '&')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0])
      .join('')
      .toUpperCase();

    return `
      <button
        class="supplier-node ${tone}"
        style="--x:${x}%; --y:${y}%; --s:${size}px; --delay:${idx * 28}ms;"
        title="${name}: ${IMSERV.fmt.num(s.requests)} requests, ${IMSERV.fmt.pct(s.booking_rate)} booked, ${IMSERV.fmt.pct(s.visit_success_rate)} visit success"
      >
        <strong>${initials || 'S'}</strong>
        <span>${IMSERV.fmt.pct(score)}</span>
      </button>
    `;
  }).join('');

  const lanes = suppliers.slice(0, 8).map((s, idx) => {
    const tone = toneFor(s);
    const width = Math.max(8, ((s.requests || 0) / maxRequests) * 100);
    const bookingWidth = Math.max(6, ((s.bookings || 0) / maxBookings) * 100);
    return `
      <div class="supplier-lane ${tone}" style="--rank:${idx + 1};">
        <div class="supplier-lane-name">
          <strong>${journeyEscapeHtml(s.supplier_name)}</strong>
          <span>${journeyEscapeHtml(s.segment)}</span>
        </div>
        <div class="supplier-lane-bars">
          <span class="supplier-request-bar" style="width:${width}%"></span>
          <span class="supplier-booking-bar" style="width:${bookingWidth}%"></span>
        </div>
        <div class="supplier-lane-metrics">
          <span>${IMSERV.fmt.num(s.requests)} requests</span>
          <span>${IMSERV.fmt.pct(s.booking_rate)} booked</span>
          <span>${IMSERV.fmt.pct(s.fallout_rate)} fallout</span>
        </div>
      </div>
    `;
  }).join('');

  const watchlist = (data.watchlist || []).slice(0, 4).map(s => `
    <div class="supplier-watch-item ${toneFor(s)}">
      <span>${journeyEscapeHtml(s.supplier_name)}</span>
      <strong>${IMSERV.fmt.pct(s.fallout_rate)}</strong>
      <em>${IMSERV.fmt.num(s.unresolved)} unresolved, ${IMSERV.fmt.num(s.cancellations + s.aborts)} fallout</em>
    </div>
  `).join('');

  const leaders = (data.leaderboard || []).slice(0, 4).map(s => `
    <div class="supplier-leader-chip">
      <span>${journeyEscapeHtml(s.supplier_name)}</span>
      <strong>${IMSERV.fmt.pct(s.visit_success_rate)}</strong>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="supplier-field">
      <div class="supplier-axis x">Contribution</div>
      <div class="supplier-axis y">Behaviour score</div>
      <div class="supplier-quadrant high">Scale + stable</div>
      <div class="supplier-quadrant watch">High contribution watch</div>
      <div class="supplier-quadrant niche">Efficient niche</div>
      <div class="supplier-quadrant focus">Needs attention</div>
      ${nodes}
    </div>

    <div class="supplier-side-panel">
      <div class="supplier-scoreboard">
        <div>
          <span>Suppliers</span>
          <strong>${IMSERV.fmt.num(data.supplier_count)}</strong>
        </div>
        <div>
          <span>Bookings</span>
          <strong>${IMSERV.fmt.num(totals.bookings)}</strong>
        </div>
        <div>
          <span>Visit Success</span>
          <strong>${IMSERV.fmt.pct(totals.visit_success_rate)}</strong>
        </div>
        <div>
          <span>Fallout</span>
          <strong>${IMSERV.fmt.pct(totals.fallout_rate)}</strong>
        </div>
      </div>
      <div class="supplier-leaders">
        <div class="supplier-panel-label">Success Rate Leaders</div>
        ${leaders}
      </div>
    </div>

    <div class="supplier-lanes">
      <div class="supplier-panel-label">Largest supplier contribution lanes</div>
      ${lanes}
    </div>

    <div class="supplier-watch">
      <div class="supplier-panel-label">Supplier watchlist</div>
      ${watchlist}
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
        title="${safeName}: ${IMSERV.fmt.num(c.volume)} contact attempts, ${IMSERV.fmt.num(c.bookings)} appointments booked, ${IMSERV.fmt.pct(visitSuccess)} to total visits"
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
          <em>total visits</em>
          <small>${bookingShare.toFixed(1)}% of appointments booked</small>
          <small>${share.toFixed(1)}% of contact attempts</small>
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
        <div class="booking-core-label">Appointments Booked Core</div>
        <div class="booking-core-value">${IMSERV.fmt.num(totalBookings)}</div>
        <div class="booking-core-sub">${IMSERV.fmt.pct(blendedVisitSuccess)} to total visits</div>
      </div>

      ${nodes}
    </div>

    <div class="channel-storyline">
      <div class="channel-story-pill dominant">
        <span>Dominant intake</span>
        <strong>${escapeHtml(insight.channel)}</strong>
        <em>${IMSERV.fmt.num(insight.volume)} contact attempts</em>
      </div>
      <div class="channel-story-pill efficient">
        <span>Most efficient</span>
        <strong>${escapeHtml(bestConversion.channel)}</strong>
        <em>${IMSERV.fmt.pct(visitSuccessFor(bestConversion))} to total visits</em>
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
