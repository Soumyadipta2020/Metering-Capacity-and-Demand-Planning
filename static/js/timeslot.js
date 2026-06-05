/* ── Time-Slot Analysis Dashboard ─────────────────────────── */

let _tsFilterType  = 'all';
let _tsFilterValue = '';
let _tsAgentData   = null;
let _tsLoaded      = false;
let _tsWindow      = null;

const TS_SLOTS = ['Morning', 'Afternoon', 'Evening'];
const TS_DAYS  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

const TS_SLOT_COLORS = {
  Morning:   { bg: 'rgba(251,191,36,0.12)',  accent: '#f59e0b', text: '#d97706' },
  Afternoon: { bg: 'rgba(59,130,246,0.12)',  accent: '#3b82f6', text: '#2563eb' },
  Evening:   { bg: 'rgba(139,92,246,0.12)',  accent: '#8b5cf6', text: '#7c3aed' },
};
const TS_SLOT_ICONS = { Morning: '🌅', Afternoon: '☀️', Evening: '🌆' };

const TS_MONTHS = [
  ['1','January'],['2','February'],['3','March'],['4','April'],
  ['5','May'],['6','June'],['7','July'],['8','August'],
  ['9','September'],['10','October'],['11','November'],['12','December'],
];

const TS_RATE_COL = v => v >= 80 ? '#10b981' : v >= 60 ? '#f59e0b' : '#ef4444';

function tsIsDarkTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark';
}

// Returns [bgColor, textColor] — discrete 6-tier palette matching UK map tier colours
function heatColor(pct) {
  if (tsIsDarkTheme()) {
    const darkTiers = [
      { bg: 'rgba(248,113,113,0.50)', col: '#fff1f2' },
      { bg: 'rgba(252,165,165,0.46)', col: '#fff1f2' },
      { bg: 'rgba(245,158, 11,0.48)', col: '#fffbeb' },
      { bg: 'rgba(250,204, 21,0.46)', col: '#fffbeb' },
      { bg: 'rgba( 52,211,153,0.40)', col: '#ecfdf5' },
      { bg: 'rgba( 34,197, 94,0.46)', col: '#f0fdf4' },
    ];
    const idx = Math.min(5, Math.floor(pct * 6));
    return [darkTiers[idx].bg, darkTiers[idx].col];
  }

  const tiers = [
    { bg: 'rgba(183, 28,  28, 0.45)', col: '#7f0000' },  // tier6 — dark red   (worst)
    { bg: 'rgba(229,115, 115, 0.45)', col: '#7f0000' },  // tier5 — light red
    { bg: 'rgba(200,150,  12, 0.45)', col: '#7f4000' },  // tier4 — amber
    { bg: 'rgba(253,216,  53, 0.50)', col: '#6b5000' },  // tier3 — yellow
    { bg: 'rgba( 82,190, 128, 0.45)', col: '#0a3d1f' },  // tier2 — medium green
    { bg: 'rgba( 27, 94,  53, 0.45)', col: '#0a2e18' },  // tier1 — dark green  (best)
  ];
  const idx = Math.min(5, Math.floor(pct * 6));
  return [tiers[idx].bg, tiers[idx].col];
}

function tsFormatMonth(value) {
  const d = new Date(`${value}-01T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' }).format(d);
}

function tsLocalWindowFallback() {
  const today = new Date();
  const current = new Date(today.getFullYear(), today.getMonth(), 1);
  const start = new Date(current.getFullYear(), current.getMonth() - 12, 1);
  const end = new Date(current.getFullYear(), current.getMonth(), 0);
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const months = [];
  for (let i = 0; i < 12; i += 1) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push({ value, label: tsFormatMonth(value) });
  }
  const weeks = [];
  const cursor = new Date(start);
  cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));
  while (cursor <= end) {
    const value = iso(cursor);
    weeks.push({ value, label: `Week of ${new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(cursor)}` });
    cursor.setDate(cursor.getDate() + 7);
  }
  return {
    start: iso(start),
    end: iso(end),
    label: `${tsFormatMonth(months[0].value)} - ${tsFormatMonth(months[months.length - 1].value)}`,
    months,
    weeks,
    default_day: iso(start),
  };
}

function tsApplyWindowChrome() {
  const label = _tsWindow?.label || 'Rolling actuals';
  const allBtn = document.querySelector('.ts-period-btn[data-ftype="all"]');
  if (allBtn) allBtn.textContent = `All ${label}`;

  const dateInput = document.getElementById('ts-picker-date');
  if (dateInput && _tsWindow) {
    dateInput.min = _tsWindow.start;
    dateInput.max = _tsWindow.end;
    if (!dateInput.value) dateInput.value = _tsWindow.default_day || _tsWindow.start;
  }

  const active = document.getElementById('ts-active-label');
  if (active && _tsFilterType === 'all') active.textContent = `Showing: ${label}`;
}

async function tsEnsureWindow() {
  if (_tsWindow) return _tsWindow;
  try {
    _tsWindow = await IMSERV.apiFetch('/api/data/actual-window', { force: true });
  } catch (err) {
    console.warn('Timeslot actual window metadata unavailable', err);
  }
  if (!_tsWindow?.start) _tsWindow = tsLocalWindowFallback();
  tsApplyWindowChrome();
  return _tsWindow;
}

function tsQs() {
  const region = IMSERV.getRegion();
  let qs = `filter_type=${_tsFilterType}&filter_value=${encodeURIComponent(_tsFilterValue)}`;
  if (region) qs += `&region=${region}`;
  return qs;
}

async function loadTimeslotDashboard(force = false) {
  if (_tsLoaded && !force) return;
  _tsLoaded = true;
  await tsEnsureWindow();

  tsSetLoading();
  try {
    const dashboard = await IMSERV.apiFetch('/api/timeslot/dashboard?' + tsQs(), { force });
    const chData = dashboard?.channel_booking;
    const bizData = dashboard?.business_type;
    const attData = dashboard?.attempts_overview;
    const agData = dashboard?.agent_view;
    if (chData)  renderTsChannelGrid(chData);
    if (bizData) renderTsBizWrap(bizData);
    if (attData) renderTsAttemptsGrid(attData);
    if (agData)  { _tsAgentData = agData; renderTsAgentGrid(agData); }
  } catch (e) {
    console.error('Timeslot load error', e);
  }
}

window.addEventListener('imserv:themechange', () => {
  if (_tsLoaded && document.getElementById('view-timeslot')?.classList.contains('active')) {
    loadTimeslotDashboard(true);
  }
});

function tsSetLoading() {
  ['ts-channel-grid','ts-biz-wrap','ts-attempts-grid','ts-agent-grid'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<div class="loading"><span class="spinner"></span></div>';
  });
}

/* ── Filter controls ───────────────────────────────────────── */

window.tsSetFilter = async function(ftype, fval) {
  await tsEnsureWindow();
  _tsFilterType  = ftype;
  _tsFilterValue = fval;
  _tsLoaded = false;

  document.querySelectorAll('.ts-period-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.ftype === ftype);
  });
  const wrap = document.getElementById('ts-picker-wrap');
  if (wrap) wrap.style.display = 'none';
  const sel = document.getElementById('ts-picker-select');
  const dateInput = document.getElementById('ts-picker-date');
  if (sel) sel.style.display = '';
  if (dateInput) dateInput.style.display = 'none';

  const lbl = document.getElementById('ts-active-label');
  if (lbl) lbl.textContent = `Showing: ${_tsWindow?.label || 'Rolling actuals'}`;

  loadTimeslotDashboard(true);
};

window.tsOpenPicker = async function(ftype) {
  await tsEnsureWindow();
  _tsFilterType = ftype;
  document.querySelectorAll('.ts-period-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.ftype === ftype);
  });

  const wrap   = document.getElementById('ts-picker-wrap');
  const sel    = document.getElementById('ts-picker-select');
  const dateInput = document.getElementById('ts-picker-date');
  if (!wrap || !sel || !dateInput) return;

  sel.innerHTML = '';
  sel.style.display = ftype === 'day' ? 'none' : '';
  dateInput.style.display = ftype === 'day' ? '' : 'none';

  if (ftype === 'month') {
    (_tsWindow?.months || []).forEach(({ value, label }) => {
      const o = document.createElement('option');
      o.value = value; o.textContent = label; sel.appendChild(o);
    });
  } else if (ftype === 'week') {
    (_tsWindow?.weeks || []).forEach(({ value, label }) => {
      const o = document.createElement('option');
      o.value = value; o.textContent = label; sel.appendChild(o);
    });
  } else if (ftype === 'day') {
    const current = /^\d{4}-\d{2}-\d{2}$/.test(_tsFilterValue)
      ? _tsFilterValue
      : (_tsWindow?.default_day || _tsWindow?.start || '');
    dateInput.value = current;
  }
  wrap.style.display = '';
  tsApplyPicker();
};

window.tsApplyPicker = function() {
  const sel = document.getElementById('ts-picker-select');
  const dateInput = document.getElementById('ts-picker-date');
  if (!sel || !dateInput) return;
  _tsFilterValue = _tsFilterType === 'day' ? dateInput.value : sel.value;
  _tsLoaded = false;

  const lbl = document.getElementById('ts-active-label');
  if (lbl) {
    const txt = _tsFilterType === 'month'
      ? (_tsWindow?.months || []).find(m => m.value === _tsFilterValue)?.label || tsFormatMonth(_tsFilterValue)
      : _tsFilterType === 'week'
        ? (_tsWindow?.weeks || []).find(w => w.value === _tsFilterValue)?.label || `Week of ${_tsFilterValue}`
        : _tsFilterValue;
    lbl.textContent = `Showing: ${txt}`;
  }
  loadTimeslotDashboard(true);
};


/* ── 1. Channel Booking Grid ───────────────────────────────── */

function renderTsChannelGrid(data) {
  const container = document.getElementById('ts-channel-grid');
  if (!container) return;

  const fmt = IMSERV.fmt.num;
  const allChannels = [...new Set(TS_SLOTS.flatMap(s => (data[s] || []).map(r => r.channel)))];

  const html = TS_SLOTS.map(slot => {
    const rows = data[slot] || [];
    const col  = TS_SLOT_COLORS[slot];
    const maxAtt = Math.max(...rows.map(r => r.attempts), 1);

    const rowsHtml = rows.map(r => {
      const barW = (r.attempts / maxAtt * 100).toFixed(1);
      const bkW  = Math.min(r.booking_rate, 100);
      return `
        <div class="ts-ch-row">
          <span class="ts-ch-name">${r.channel}</span>
          <div class="ts-ch-bars">
            <div class="ts-ch-bar-wrap" title="Attempts: ${fmt(r.attempts)}">
              <div class="ts-ch-bar ts-ch-bar--att" style="width:${barW}%;background:${col.accent};opacity:0.35;"></div>
              <div class="ts-ch-bar ts-ch-bar--bk"  style="width:${bkW * barW / 100}%;background:${col.accent};"></div>
            </div>
          </div>
          <div class="ts-ch-meta">
            <span class="ts-ch-num">${fmt(r.attempts)}</span>
            <span class="ts-ch-rate" style="color:${TS_RATE_COL(r.booking_rate)};">${r.booking_rate}%</span>
          </div>
        </div>`;
    }).join('');

    const total    = rows.reduce((s, r) => s + r.attempts, 0);
    const totalBk  = rows.reduce((s, r) => s + r.bookings, 0);
    const totalRate = total > 0 ? (totalBk / total * 100).toFixed(1) : '—';

    return `
      <div class="ts-slot-panel" style="--slot-accent:${col.accent};--slot-bg:${col.bg};">
        <div class="ts-slot-hd">
          <span class="ts-slot-icon">${TS_SLOT_ICONS[slot]}</span>
          <span class="ts-slot-name">${slot}</span>
          <span class="ts-slot-total">${fmt(total)} attempts · <strong style="color:${TS_RATE_COL(parseFloat(totalRate))};">${totalRate}% booked</strong></span>
        </div>
        <div class="ts-ch-legend">
          <span class="ts-ch-leg-item"><span class="ts-ch-leg-dot" style="background:${col.accent};opacity:0.35;"></span>Attempts</span>
          <span class="ts-ch-leg-item"><span class="ts-ch-leg-dot" style="background:${col.accent};"></span>Bookings</span>
        </div>
        <div class="ts-ch-rows">${rowsHtml}</div>
      </div>`;
  }).join('');

  container.innerHTML = `<div class="ts-slots-3">${html}</div>`;
}

/* ── 2. Business Type Grid ─────────────────────────────────── */

function renderTsBizWrap(data) {
  const container = document.getElementById('ts-biz-wrap');
  if (!container) return;

  const fmt = IMSERV.fmt.num;

  // Left: by slot (heatmap table)
  const bySlot = data.by_slot || {};
  const allTypes = [...new Set(TS_SLOTS.flatMap(s => (bySlot[s] || []).map(r => r.type)))];

  const slotHeader = `<th class="ts-biz-th ts-biz-th--type">Business Category</th>` +
    TS_SLOTS.map(s => `<th class="ts-biz-th" colspan="2">${TS_SLOT_ICONS[s]} ${s}</th>`).join('');

  const slotSubheader = `<th></th>` +
    TS_SLOTS.map(() => `<th class="ts-biz-sub">Bookings</th><th class="ts-biz-sub">Rate</th>`).join('');

  const allRatesSlot = allTypes.flatMap(type => TS_SLOTS.map(slot => {
      const row = (bySlot[slot] || []).find(r => r.type === type);
      return row ? row.booking_rate : null;
  })).filter(v => v !== null);
  const maxSlotRate = allRatesSlot.length ? Math.max(...allRatesSlot) : 1;
  const minSlotRate = allRatesSlot.length ? Math.min(...allRatesSlot) : 0;

  const slotRows = allTypes.map(type => {
    const cells = TS_SLOTS.map(slot => {
      const row = (bySlot[slot] || []).find(r => r.type === type);
      const rate = row ? row.booking_rate : 0;
      const bk   = row ? row.bookings : 0;
      
      const pct  = maxSlotRate > minSlotRate ? (rate - minSlotRate) / (maxSlotRate - minSlotRate) : 0;
      const [bg, col] = heatColor(pct);

      return `<td class="ts-biz-td">${fmt(bk)}</td><td class="ts-biz-td ts-biz-td--rate" style="background:${bg};color:${col};">${rate}%</td>`;
    }).join('');
    return `<tr><td class="ts-biz-td ts-biz-td--type">${type}</td>${cells}</tr>`;
  }).join('');

  // Right: by day (heatmap table)
  const byDay = data.by_day || {};
  const dayHeader = `<th class="ts-biz-th ts-biz-th--type">Business Category</th>` +
    TS_DAYS.map(d => `<th class="ts-biz-th">${d}</th>`).join('');

  const allRatesDay = allTypes.flatMap(type => TS_DAYS.map(day => {
      const row = (byDay[day] || []).find(r => r.type === type);
      return row ? row.success_rate : null;
  })).filter(v => v !== null);
  const maxDayRate = allRatesDay.length ? Math.max(...allRatesDay) : 1;
  const minDayRate = allRatesDay.length ? Math.min(...allRatesDay) : 0;

  const dayRows = allTypes.map(type => {
    const cells = TS_DAYS.map(day => {
      const row  = (byDay[day] || []).find(r => r.type === type);
      const rate = row ? row.success_rate : 0;
      
      const pct  = maxDayRate > minDayRate ? (rate - minDayRate) / (maxDayRate - minDayRate) : 0;
      const [bg, col] = heatColor(pct);

      return `<td class="ts-biz-td ts-biz-td--rate" style="background:${bg};color:${col};">${rate}%</td>`;
    }).join('');
    return `<tr><td class="ts-biz-td ts-biz-td--type">${type}</td>${cells}</tr>`;
  }).join('');

  // Overall row for each table
  const slotOverall = TS_SLOTS.map(slot => {
    const rows = bySlot[slot] || [];
    const totalAtt = rows.reduce((s,r) => s + r.attempts, 0);
    const totalBk  = rows.reduce((s,r) => s + r.bookings, 0);
    const rate = totalAtt > 0 ? +(totalBk / totalAtt * 100).toFixed(1) : 0;
    return `<td class="ts-biz-td ts-biz-td--total">${fmt(totalBk)}</td><td class="ts-biz-td ts-biz-td--rate ts-biz-td--total" style="color:${TS_RATE_COL(rate)};">${rate}%</td>`;
  }).join('');

  const dayOverall = TS_DAYS.map(day => {
    const rows = byDay[day] || [];
    const totalBk  = rows.reduce((s,r) => s + r.bookings, 0);
    const totalAtt = rows.reduce((s,r) => s + r.attempts, 0);
    const rate = totalAtt > 0 ? +(totalBk / totalAtt * 100).toFixed(1) : 0;
    return `<td class="ts-biz-td ts-biz-td--rate ts-biz-td--total" style="color:${TS_RATE_COL(rate)};">${rate}%</td>`;
  }).join('');

  container.innerHTML = `
    <div class="ts-biz-split">
      <div class="ts-biz-half">
        <div class="ts-biz-half-title">By Time Slot — Booking Rate</div>
        <div class="ts-table-scroll">
          <table class="ts-biz-table">
            <thead>
              <tr>${slotHeader}</tr>
              <tr class="ts-biz-subrow">${slotSubheader}</tr>
            </thead>
            <tbody>
              ${slotRows}
              <tr class="ts-biz-overall-row"><td class="ts-biz-td ts-biz-td--type">Overall</td>${slotOverall}</tr>
            </tbody>
          </table>
        </div>
      </div>
      <div class="ts-biz-half">
        <div class="ts-biz-half-title">By Weekday — Success Rate</div>
        <div class="ts-table-scroll">
          <table class="ts-biz-table">
            <thead><tr>${dayHeader}</tr></thead>
            <tbody>
              ${dayRows}
              <tr class="ts-biz-overall-row"><td class="ts-biz-td ts-biz-td--type">Overall</td>${dayOverall}</tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
}

/* ── 3. Total Attempts vs Bookings ─────────────────────────── */

function renderTsAttemptsGrid(data) {
  const container = document.getElementById('ts-attempts-grid');
  if (!container) return;

  const fmt = IMSERV.fmt.num;
  const maxAtt = Math.max(...TS_SLOTS.map(s => (data[s]?.attempts || 0)), 1);

  const html = TS_SLOTS.map(slot => {
    const d   = data[slot] || {};
    const col = TS_SLOT_COLORS[slot];
    const attW = (d.attempts / maxAtt * 100).toFixed(1);
    const bkW  = d.attempts > 0 ? (d.bookings / d.attempts * 100).toFixed(1) : 0;

    return `
      <div class="ts-att-panel" style="--slot-accent:${col.accent};--slot-bg:${col.bg};">
        <div class="ts-slot-hd">
          <span class="ts-slot-icon">${TS_SLOT_ICONS[slot]}</span>
          <span class="ts-slot-name">${slot}</span>
        </div>
        <div class="ts-att-stats">
          <div class="ts-att-stat">
            <span class="ts-att-lbl">Total Attempts</span>
            <strong class="ts-att-val">${fmt(d.attempts || 0)}</strong>
          </div>
          <div class="ts-att-stat">
            <span class="ts-att-lbl">Total Contacts</span>
            <strong class="ts-att-val">${fmt(d.contacts || 0)}</strong>
          </div>
          <div class="ts-att-stat">
            <span class="ts-att-lbl">Bookings Made</span>
            <strong class="ts-att-val" style="color:${col.text};">${fmt(d.bookings || 0)}</strong>
          </div>
          <div class="ts-att-stat">
            <span class="ts-att-lbl">Booking Rate</span>
            <strong class="ts-att-val" style="color:${TS_RATE_COL(d.booking_rate || 0)};">${d.booking_rate || 0}%</strong>
          </div>
        </div>
        <div class="ts-att-bars">
          <div class="ts-att-bar-row">
            <span class="ts-att-bar-lbl">Attempts</span>
            <div class="ts-att-bar-track">
              <div class="ts-att-bar-fill" style="width:${attW}%;background:${col.accent};opacity:0.4;"></div>
            </div>
          </div>
          <div class="ts-att-bar-row">
            <span class="ts-att-bar-lbl">Booked</span>
            <div class="ts-att-bar-track">
              <div class="ts-att-bar-fill" style="width:${bkW}%;background:${col.accent};"></div>
            </div>
            <span class="ts-att-bar-pct" style="color:${TS_RATE_COL(d.booking_rate||0)};">${d.booking_rate||0}%</span>
          </div>
        </div>
      </div>`;
  }).join('');

  container.innerHTML = `<div class="ts-slots-3">${html}</div>`;
}

/* ── 4. Agent View — unified 3-slot table ──────────────────── */

function renderTsAgentGrid(data) {
  const container = document.getElementById('ts-agent-grid');
  if (!container) return;

  const fmt = IMSERV.fmt.num;

  // Collect all unique agent names preserving rank order (by Morning total as proxy)
  const agentNames = (data['Morning'] || []).map(r => r.agent);

  // Build per-agent lookup: agentName → {Morning, Afternoon, Evening}
  const lookup = {};
  TS_SLOTS.forEach(slot => {
    (data[slot] || []).forEach(r => {
      if (!lookup[r.agent]) lookup[r.agent] = {};
      lookup[r.agent][slot] = r;
    });
  });

  // Re-rank by total attempts across all slots
  const ranked = agentNames
    .map(name => ({
      name,
      total: TS_SLOTS.reduce((s, sl) => s + (lookup[name]?.[sl]?.attempts || 0), 0),
    }))
    .sort((a, b) => b.total - a.total);

  // Column max per slot (for bar scaling)
  const slotMax = {};
  TS_SLOTS.forEach(slot => {
    slotMax[slot] = Math.max(...(data[slot] || []).map(r => r.attempts), 1);
  });

  // Slot header
  const slotHeaders = TS_SLOTS.map(slot => {
    const col = TS_SLOT_COLORS[slot];
    return `<th class="ts-tbl-slot-hd" colspan="3" style="border-bottom:3px solid ${col.accent};">
      ${TS_SLOT_ICONS[slot]} ${slot}
    </th>`;
  }).join('');

  const subHeaders = TS_SLOTS.map(() =>
    `<th class="ts-tbl-sub">Attempts</th><th class="ts-tbl-sub">Bookings</th><th class="ts-tbl-sub">Rate</th>`
  ).join('');

  const rows = ranked.map(({ name, total }, idx) => {
    const cells = TS_SLOTS.map(slot => {
      const col = TS_SLOT_COLORS[slot];
      const d   = lookup[name]?.[slot] || { attempts: 0, bookings: 0, booking_rate: 0 };
      const barW = (d.attempts / slotMax[slot] * 100).toFixed(1);
      const rateColor = TS_RATE_COL(d.booking_rate);
      return `
        <td class="ts-tbl-cell">
          <div class="ts-tbl-bar-wrap">
            <div class="ts-tbl-bar-track">
              <div class="ts-tbl-bar-att" style="width:${barW}%;background:${col.accent};"></div>
              <div class="ts-tbl-bar-bk"  style="width:${(d.booking_rate)}%;background:${col.accent};opacity:0.9;"></div>
            </div>
            <span class="ts-tbl-num">${fmt(d.attempts)}</span>
          </div>
        </td>
        <td class="ts-tbl-cell ts-tbl-cell--bk">${fmt(d.bookings)}</td>
        <td class="ts-tbl-cell ts-tbl-cell--rate" style="color:${rateColor};">${d.booking_rate}%</td>`;
    }).join('');

    const totalBookings = TS_SLOTS.reduce((s, sl) => s + (lookup[name]?.[sl]?.bookings || 0), 0);
    const overallRate   = total > 0 ? (totalBookings / total * 100).toFixed(1) : '0.0';
    const rowClass      = idx % 2 === 0 ? '' : ' ts-tbl-row--alt';

    return `<tr class="ts-tbl-row${rowClass}">
      <td class="ts-tbl-rank">#${idx + 1}</td>
      <td class="ts-tbl-name" title="${name}">${name}</td>
      ${cells}
      <td class="ts-tbl-total">${fmt(total)}</td>
      <td class="ts-tbl-total-rate" style="color:${TS_RATE_COL(parseFloat(overallRate))};">${overallRate}%</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="ts-ag-table-wrap">
      <table class="ts-ag-table">
        <thead>
          <tr>
            <th class="ts-tbl-rank-hd" rowspan="2">#</th>
            <th class="ts-tbl-name-hd" rowspan="2">Agent</th>
            ${slotHeaders}
            <th class="ts-tbl-total-hd" colspan="2">Total</th>
          </tr>
          <tr>${subHeaders}<th class="ts-tbl-sub">Attempts</th><th class="ts-tbl-sub">Rate</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}
