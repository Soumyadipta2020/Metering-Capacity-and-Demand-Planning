/* IMSERV — Long Term 12-Month Capacity & Demand Planning */

const LT = {
  data:          null,
  selectedMonth: 0,
  charts:        {},
};

const _LT_REGIONS   = ['NW', 'SE', 'NE', 'WM', 'EM', 'SW', 'Y'];
const _LT_REG_NAMES = { NW: 'North West', SE: 'South East', NE: 'North East',
                         WM: 'West Midlands', EM: 'East Midlands',
                         SW: 'South West', Y: 'Yorkshire' };
const _LT_COLORS    = ['#6366f1','#22c55e','#f59e0b','#ef4444',
                        '#8b5cf6','#06b6d4','#f97316'];

// ── Load ──────────────────────────────────────────────────────────────────────
async function loadLongTermPlanning(force) {
  if (LT.data && !force) { ltRender(); return; }

  const strip = document.getElementById('lt-kpi-strip');
  if (strip) strip.innerHTML = '<div class="lt-loading"><span class="spinner"></span> Loading 12-month forecast…</div>';

  try {
    const res  = await fetch('/api/longterm/overview');
    LT.data    = await res.json();
    LT.selectedMonth = 0;
    ltRender();
  } catch {
    if (strip) strip.innerHTML = '<div class="lt-error">Failed to load planning data.</div>';
  }
}

function ltSelectedRegions() {
  const region = IMSERV.getRegion();
  if (!region) return null;
  const map = {
    MID: ['WM', 'EM'],
    YRK: ['Y'],
  };
  return map[region] || [region];
}

function ltAggregateRegionSlice(month, regions) {
  return regions.reduce((acc, code) => {
    const r = month.regions?.[code] || {};
    acc.demand += r.demand || 0;
    acc.capacity += r.capacity || 0;
    acc.booked += r.booked || 0;
    acc.avail += r.avail || 0;
    return acc;
  }, { demand: 0, capacity: 0, booked: 0, avail: 0, util: 0 });
}

function ltScaleSlotsToMonth(sourceMonth, totals) {
  const slots = {};
  ['morning', 'afternoon', 'evening'].forEach(slot => {
    const source = sourceMonth.slots?.[slot] || {};
    const demand = sourceMonth.demand ? Math.round(totals.demand * ((source.demand || 0) / sourceMonth.demand)) : 0;
    const capacity = sourceMonth.capacity ? Math.round(totals.capacity * ((source.capacity || 0) / sourceMonth.capacity)) : 0;
    const booked = sourceMonth.booked ? Math.round(totals.booked * ((source.booked || 0) / sourceMonth.booked)) : 0;
    const safeBooked = Math.min(booked, capacity);
    slots[slot] = {
      demand,
      capacity,
      booked: safeBooked,
      avail: Math.max(capacity - safeBooked, 0),
      util: capacity ? Number(((safeBooked / capacity) * 100).toFixed(1)) : 0,
    };
  });
  return slots;
}

// ── Main render ───────────────────────────────────────────────────────────────
function ltRender() {
  if (!LT.data) return;

  const months = ltFilteredMonths();

  ltRenderKPIs(months);
  ltRenderTrendChart(months);
  ltRenderSlotCharts(months);
  ltRenderMonthNav(months);
  ltRenderMonthDetail(LT.selectedMonth, months);
}

// When a region is active, remap each month's top-level demand/capacity/booked/avail/util
// to that region's slice so KPIs and trend chart reflect it.
function ltFilteredMonths() {
  const regions = ltSelectedRegions();
  if (!regions) return LT.data.months;
  return LT.data.months.map(m => {
    const r = ltAggregateRegionSlice(m, regions);
    r.util = r.capacity ? Math.round(r.booked / r.capacity * 100) : 0;
    return {
      ...m,
      demand:   r.demand,
      capacity: r.capacity,
      booked:   r.booked,
      avail:    r.avail,
      util:     r.util,
      slots:    ltScaleSlotsToMonth(m, r),
    };
  });
}

// ── KPI Strip ─────────────────────────────────────────────────────────────────
function ltRenderKPIs(months) {
  const strip = document.getElementById('lt-kpi-strip');
  if (!strip) return;

  const totalDemand = months.reduce((s, m) => s + m.demand, 0);
  const totalCap    = months.reduce((s, m) => s + m.capacity, 0);
  const totalBooked = months.reduce((s, m) => s + m.booked, 0);
  const avgUtil     = totalCap ? Math.round(totalBooked / totalCap * 100) : 0;
  const peakM       = months.reduce((a, b) => b.util > a.util ? b : a, months[0]);
  const shortfall   = months.filter(m => m.demand > m.capacity).length;
  const totalGap    = totalBooked > 0 ? totalDemand - totalBooked : 0;

  const kpis = [
    {
      label: 'Annual Demand',
      value: totalDemand.toLocaleString(),
      icon: '📊',
      cls: 'info',
      sub: '12-month total job requests',
    },
    {
      label: 'Total Capacity',
      value: totalCap.toLocaleString(),
      icon: '👷',
      cls: 'ok',
      sub: 'Available engineer slots',
    },
    {
      label: 'Avg Utilisation',
      value: avgUtil + '%',
      icon: '⚡',
      cls: avgUtil >= 88 ? 'warn' : avgUtil >= 70 ? 'ok' : 'info',
      sub: 'Booked / total capacity',
    },
    {
      label: 'Peak Month',
      value: peakM ? peakM.short : '—',
      icon: '📈',
      cls: 'warn',
      sub: peakM ? `${peakM.util}% utilisation` : '—',
    },
    {
      label: 'Demand Gap',
      value: totalGap > 0 ? '+' + totalGap.toLocaleString() : '0',
      icon: totalGap > 0 ? '⚠️' : '✅',
      cls: totalGap > 0 ? 'warn' : 'ok',
      sub: shortfall > 0 ? `${shortfall} months demand > capacity` : 'All months within capacity',
    },
  ];

  strip.innerHTML = kpis.map(k => `
    <div class="lt-kpi lt-kpi--${k.cls}">
      <div class="lt-kpi-icon">${k.icon}</div>
      <div class="lt-kpi-body">
        <div class="lt-kpi-val">${k.value}</div>
        <div class="lt-kpi-label">${k.label}</div>
        <div class="lt-kpi-sub">${k.sub}</div>
      </div>
    </div>
  `).join('');
}

// ── Theme helpers ─────────────────────────────────────────────────────────────
function ltIsDark() {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}
function ltChartColors() {
  const dark = ltIsDark();
  return {
    grid: dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)',
    text: dark ? '#a0a8b8' : '#6b7280',
  };
}
function ltDestroyChart(key) {
  if (LT.charts[key]) { LT.charts[key].destroy(); LT.charts[key] = null; }
}

// ── Trend Chart — 12 months demand / capacity / booked / utilisation ──────────
function ltRenderTrendChart(months) {
  const ctx = document.getElementById('lt-trend-chart');
  if (!ctx) return;
  ltDestroyChart('trend');

  const { grid, text } = ltChartColors();
  const labels   = months.map(m => m.label || `${m.short} ${m.year || ''}`.trim());
  const capacity = months.map(m => m.capacity);
  const booked   = months.map(m => m.booked);
  const demand   = months.map(m => m.demand);
  const util     = months.map(m => m.util);

  LT.charts.trend = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Total Capacity',
          data: capacity,
          backgroundColor: 'rgba(99,102,241,0.18)',
          borderColor: 'rgba(99,102,241,0.55)',
          borderWidth: 1.5,
          order: 4,
        },
        {
          label: 'Booked',
          data: booked,
          backgroundColor: 'rgba(34,197,94,0.50)',
          borderColor: 'rgba(34,197,94,0.85)',
          borderWidth: 1,
          order: 3,
        },
        {
          label: 'Demand',
          data: demand,
          type: 'line',
          borderColor: '#f59e0b',
          backgroundColor: 'rgba(245,158,11,0.10)',
          borderWidth: 2.5,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: '#f59e0b',
          tension: 0.35,
          fill: false,
          order: 2,
          yAxisID: 'y',
        },
        {
          label: 'Utilisation %',
          data: util,
          type: 'line',
          borderColor: '#ef4444',
          backgroundColor: 'transparent',
          borderWidth: 2,
          borderDash: [5, 4],
          pointRadius: 3,
          tension: 0.35,
          fill: false,
          order: 1,
          yAxisID: 'y2',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: text, usePointStyle: true, pointStyleWidth: 14, boxHeight: 8, padding: 16 },
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            label(ctx) {
              const v = ctx.raw;
              return ctx.dataset.label === 'Utilisation %'
                ? ` ${ctx.dataset.label}: ${v}%`
                : ` ${ctx.dataset.label}: ${Number(v).toLocaleString()}`;
            },
          },
        },
      },
      scales: {
        x:  { grid: { color: grid }, ticks: { color: text } },
        y: {
          position: 'left',
          grid: { color: grid },
          ticks: { color: text, callback: v => Number(v).toLocaleString() },
          title: { display: true, text: 'Slots / Jobs', color: text, font: { size: 11 } },
        },
        y2: {
          position: 'right',
          min: 0, max: 110,
          grid: { drawOnChartArea: false },
          ticks: { color: '#ef4444', callback: v => v + '%' },
          title: { display: true, text: 'Utilisation %', color: '#ef4444', font: { size: 11 } },
        },
      },
    },
  });
}

// ── Regional Demand Chart — horizontal bars, full-year totals ─────────────────
function ltRenderRegionChart() {
  const ctx = document.getElementById('lt-region-chart');
  if (!ctx) return;
  ltDestroyChart('region');

  const { grid, text } = ltChartColors();

  const regionDemand = {};
  const regionBooked = {};
  _LT_REGIONS.forEach(r => { regionDemand[r] = 0; regionBooked[r] = 0; });
  LT.data.months.forEach(m => {
    _LT_REGIONS.forEach(r => {
      regionDemand[r] += (m.regions[r]?.demand || 0);
      regionBooked[r] += (m.regions[r]?.booked || 0);
    });
  });

  // Sort by demand descending
  const sorted = [..._LT_REGIONS].sort((a, b) => regionDemand[b] - regionDemand[a]);
  const colors = sorted.map((_, i) => _LT_COLORS[i % _LT_COLORS.length]);

  // Highlight selected region
  const selectedRegions = ltSelectedRegions();
  const borderW = sorted.map(r => selectedRegions?.includes(r) ? 3 : 1.5);

  LT.charts.region = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(r => `${r} — ${_LT_REG_NAMES[r]}`),
      datasets: [
        {
          label: 'Annual Demand',
          data: sorted.map(r => regionDemand[r]),
          backgroundColor: colors.map(c => c + 'aa'),
          borderColor: colors,
          borderWidth: borderW,
          order: 2,
        },
        {
          label: 'Booked',
          data: sorted.map(r => regionBooked[r]),
          backgroundColor: 'rgba(34,197,94,0.30)',
          borderColor: 'rgba(34,197,94,0.75)',
          borderWidth: 1,
          order: 1,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: text, usePointStyle: true, pointStyleWidth: 12, boxHeight: 8 },
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${Number(ctx.raw).toLocaleString()}`,
          },
        },
      },
      scales: {
        x: { grid: { color: grid }, ticks: { color: text, callback: v => Number(v).toLocaleString() } },
        y: { grid: { color: grid }, ticks: { color: text } },
      },
    },
  });
}

// ── Slot Charts — capacity vs booked per slot across 12 months ────────────────
function ltRenderSlotCharts(months) {
  const SLOT_CFG = [
    { id: 'lt-slot-m-chart', key: 'morning',   utilId: 'lt-util-m', barColor: '#f59e0b', label: 'Morning' },
    { id: 'lt-slot-a-chart', key: 'afternoon',  utilId: 'lt-util-a', barColor: '#22c55e', label: 'Afternoon' },
    { id: 'lt-slot-e-chart', key: 'evening',    utilId: 'lt-util-e', barColor: '#8b5cf6', label: 'Evening' },
  ];

  const { grid, text } = ltChartColors();

  SLOT_CFG.forEach(cfg => {
    const ctx = document.getElementById(cfg.id);
    if (!ctx) return;
    ltDestroyChart(cfg.key);

    const cap    = months.map(m => m.slots?.[cfg.key]?.capacity || 0);
    const booked = months.map(m => m.slots?.[cfg.key]?.booked   || 0);
    const demand = months.map(m => m.slots?.[cfg.key]?.demand   || 0);
    const util   = months.map(m => m.slots?.[cfg.key]?.util     || 0);

    const totalCap    = cap.reduce((s, v) => s + v, 0);
    const totalBooked = booked.reduce((s, v) => s + v, 0);
    const avgUtil     = totalCap ? Math.round(totalBooked / totalCap * 100) : 0;

    const utilEl = document.getElementById(cfg.utilId);
    if (utilEl) {
      utilEl.textContent = avgUtil + '% avg util';
      utilEl.className = 'lt-slot-util ' + (
        avgUtil >= 88 ? 'lt-util--hi' : avgUtil >= 68 ? 'lt-util--mid' : 'lt-util--lo'
      );
    }

    LT.charts[cfg.key] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: months.map(m => m.label || `${m.short} ${m.year || ''}`.trim()),
        datasets: [
          {
            label: 'Capacity',
            data: cap,
            backgroundColor: 'rgba(99,102,241,0.18)',
            borderColor: 'rgba(99,102,241,0.45)',
            borderWidth: 1,
            order: 3,
          },
          {
            label: 'Booked',
            data: booked,
            backgroundColor: cfg.barColor + 'cc',
            borderColor: cfg.barColor,
            borderWidth: 1,
            order: 2,
          },
          {
            label: 'Demand',
            data: demand,
            type: 'line',
            borderColor: cfg.barColor,
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [4, 3],
            pointRadius: 3,
            tension: 0.35,
            fill: false,
            order: 1,
            yAxisID: 'y',
          },
          {
            label: 'Utilisation %',
            data: util,
            type: 'line',
            borderColor: '#ef4444',
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [5, 4],
            pointRadius: 2.5,
            tension: 0.35,
            fill: false,
            order: 0,
            yAxisID: 'y2',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: text, usePointStyle: true, boxHeight: 7, padding: 10 },
          },
          tooltip: {
            mode: 'index',
            intersect: false,
            callbacks: {
              label(ctx) {
                const v = ctx.raw;
                return ctx.dataset.label === 'Utilisation %'
                  ? ` ${ctx.dataset.label}: ${v}%`
                  : ` ${ctx.dataset.label}: ${Number(v).toLocaleString()}`;
              },
            },
          },
        },
        scales: {
          x: { grid: { color: grid }, ticks: { color: text, font: { size: 10 } } },
          y: {
            position: 'left',
            grid: { color: grid },
            ticks: { color: text },
          },
          y2: {
            position: 'right',
            min: 0,
            max: 110,
            grid: { drawOnChartArea: false },
            ticks: { color: '#ef4444', callback: v => v + '%' },
          },
        },
      },
    });
  });
}

// ── Month Navigator ───────────────────────────────────────────────────────────
function ltRenderMonthNav(months = ltFilteredMonths()) {
  const nav = document.getElementById('lt-month-nav');
  if (!nav || !LT.data) return;

  nav.innerHTML = months.map((m, i) => {
    const util    = m.util;
    const pillCls = util >= 88 ? 'lt-mpill--hi' : util >= 70 ? 'lt-mpill--mid' : 'lt-mpill--lo';
    const active  = i === LT.selectedMonth ? ' lt-mpill--active' : '';
    return `<button class="lt-mpill ${pillCls}${active}" onclick="ltSelectMonth(${i})">
      <span class="lt-mpill-mo">${m.short}</span>
      <span class="lt-mpill-yr">${m.year}</span>
      <span class="lt-mpill-util">${util}%</span>
    </button>`;
  }).join('');
}

function ltSelectMonth(idx) {
  LT.selectedMonth = idx;
  document.querySelectorAll('.lt-mpill').forEach((el, i) =>
    el.classList.toggle('lt-mpill--active', i === idx));
  ltRenderMonthDetail(idx);
}

// ── Month Detail — regional + slot breakdown table ────────────────────────────
function ltRenderMonthDetail(idx, filteredMonths = ltFilteredMonths()) {
  const body = document.getElementById('lt-detail-body');
  if (!body || !LT.data) return;

  const rawMonth = LT.data.months[idx];
  const m = filteredMonths[idx];
  if (!rawMonth || !m) return;

  function utilCls(u) {
    return u >= 88 ? 'lt-rag--red' : u >= 70 ? 'lt-rag--amber' : 'lt-rag--green';
  }
  function barRow(booked, cap) {
    const pct = cap > 0 ? Math.min(Math.round(booked / cap * 100), 100) : 0;
    const color = pct >= 88 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#22c55e';
    return `<div class="lt-bar-wrap"><div class="lt-bar" style="width:${pct}%;background:${color}"></div></div>`;
  }

  // Regional rows
  const activeRegions = ltSelectedRegions() || _LT_REGIONS;
  const sortedRegs = [...activeRegions].sort(
    (a, b) => (rawMonth.regions[b]?.demand || 0) - (rawMonth.regions[a]?.demand || 0)
  );
  const regRows = sortedRegs.map(r => {
    const d = rawMonth.regions[r] || {};
    return `<tr>
      <td class="lt-dt-cell lt-dt-reg">
        <span class="rt-region">${r}</span>
        <span class="lt-reg-full">${_LT_REG_NAMES[r]}</span>
      </td>
      <td class="lt-dt-cell lt-dt-num">${(d.demand   ||0).toLocaleString()}</td>
      <td class="lt-dt-cell lt-dt-num">${(d.capacity ||0).toLocaleString()}</td>
      <td class="lt-dt-cell lt-dt-num">${(d.booked   ||0).toLocaleString()}</td>
      <td class="lt-dt-cell lt-dt-bar">${barRow(d.booked||0, d.capacity||1)} ${(d.avail||0).toLocaleString()}</td>
      <td class="lt-dt-cell lt-dt-num"><span class="lt-rag ${utilCls(d.util||0)}">${d.util||0}%</span></td>
    </tr>`;
  }).join('');

  // Slot rows
  const slotCfg = [
    { key: 'morning',   label: '🌅 Morning',   color: '#f59e0b' },
    { key: 'afternoon', label: '☀️ Afternoon',  color: '#22c55e' },
    { key: 'evening',   label: '🌆 Evening',    color: '#8b5cf6' },
  ];
  const slotRows = slotCfg.map(s => {
    const d = m.slots?.[s.key] || {};
    return `<tr>
      <td class="lt-dt-cell lt-dt-reg" style="color:${s.color};font-weight:600">${s.label}</td>
      <td class="lt-dt-cell lt-dt-num">${(d.demand   ||0).toLocaleString()}</td>
      <td class="lt-dt-cell lt-dt-num">${(d.capacity ||0).toLocaleString()}</td>
      <td class="lt-dt-cell lt-dt-num">${(d.booked   ||0).toLocaleString()}</td>
      <td class="lt-dt-cell lt-dt-bar">${barRow(d.booked||0, d.capacity||1)} ${(d.avail||0).toLocaleString()}</td>
      <td class="lt-dt-cell lt-dt-num"><span class="lt-rag ${utilCls(d.util||0)}">${d.util||0}%</span></td>
    </tr>`;
  }).join('');

  const thead = `<thead><tr>
    <th class="lt-dth">Area</th>
    <th class="lt-dth lt-dth-r">Demand</th>
    <th class="lt-dth lt-dth-r">Capacity</th>
    <th class="lt-dth lt-dth-r">Booked</th>
    <th class="lt-dth lt-dth-r">Available</th>
    <th class="lt-dth lt-dth-r">Util%</th>
  </tr></thead>`;

  body.innerHTML = `
    <div class="lt-detail-grid">
      <div class="lt-detail-section">
        <div class="lt-detail-section-hd">🗺 Regional Breakdown — ${m.label}</div>
        <div class="lt-table-wrap">
          <table class="lt-detail-table">${thead}<tbody>${regRows}</tbody></table>
        </div>
      </div>
      <div class="lt-detail-section">
        <div class="lt-detail-section-hd">⏱ Slot Breakdown — ${m.label}
          <span class="lt-detail-wd">· ${m.working_days} working days</span>
        </div>
        <div class="lt-table-wrap">
          <table class="lt-detail-table">${thead}<tbody>${slotRows}</tbody></table>
        </div>
        <div class="lt-summary-strip">
          <div class="lt-ss-item">
            <span class="lt-ss-label">Total Demand</span>
            <span class="lt-ss-val">${m.demand.toLocaleString()}</span>
          </div>
          <div class="lt-ss-item">
            <span class="lt-ss-label">Total Capacity</span>
            <span class="lt-ss-val">${m.capacity.toLocaleString()}</span>
          </div>
          <div class="lt-ss-item">
            <span class="lt-ss-label">Total Booked</span>
            <span class="lt-ss-val">${m.booked.toLocaleString()}</span>
          </div>
          <div class="lt-ss-item">
            <span class="lt-ss-label">Overall Util</span>
            <span class="lt-ss-val lt-rag ${utilCls(m.util)}">${m.util}%</span>
          </div>
        </div>
      </div>
    </div>`;
}
