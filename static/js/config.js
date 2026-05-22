/* IMSERV — Client-side configuration and shared utilities */
const IMSERV = {
  version: '1.0.0',
  charts: {},   // registered Chart.js instances

  // Brand colours — mirror CSS variables for Chart.js
  colors: {
    primary:   '#0052CC',
    accent:    '#00B8D9',
    orange:    '#FF8B00',
    ok:        '#10B981',
    warn:      '#F59E0B',
    crit:      '#EF4444',
    info:      '#3B82F6',
    muted:     '#4A5568',
    text:      '#E8F0FE',
  },

  chartDefaults: {
    color: '#E8F0FE',
    font: { family: 'Inter, sans-serif', size: 11 },
    plugins: {
      legend: { labels: { color: '#8B9DC3', font: { size: 11 } } },
      tooltip: {
        backgroundColor: '#0E1829',
        borderColor: 'rgba(0,184,217,0.3)',
        borderWidth: 1,
        titleColor: '#E8F0FE',
        bodyColor: '#8B9DC3',
        padding: 10,
      },
    },
    scales: {
      x: {
        grid:  { color: 'rgba(255,255,255,0.05)' },
        ticks: { color: '#4A5568', font: { size: 10 } },
      },
      y: {
        grid:  { color: 'rgba(255,255,255,0.05)' },
        ticks: { color: '#4A5568', font: { size: 10 } },
      },
    },
  },

  // Format helpers
  fmt: {
    num:  (v) => v == null ? '—' : Number(v).toLocaleString('en-GB'),
    pct:  (v) => v == null ? '—' : Number(v).toFixed(1) + '%',
    gbp:  (v) => v == null ? '—' : '£' + Number(v).toLocaleString('en-GB', { maximumFractionDigits: 0 }),
    gbpK: (v) => v == null ? '—' : '£' + (Number(v) / 1000).toFixed(0) + 'k',
    gbpM: (v) => v == null ? '—' : '£' + (Number(v) / 1_000_000).toFixed(2) + 'M',
  },

  getRegion: () => document.getElementById('global-region')?.value || '',
  getYear:   () => parseInt(document.getElementById('global-year')?.value || '2025', 10),

  registerChart(key, instance) {
    if (this.charts[key]) { this.charts[key].destroy(); }
    this.charts[key] = instance;
  },

  destroyChart(key) {
    if (this.charts[key]) {
      this.charts[key].destroy();
      delete this.charts[key];
    }
  },

  async apiFetch(url) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return await resp.json();
    } catch (e) {
      console.error('API error:', url, e);
      return null;
    }
  },

  ragClass: (rag) => rag === 'Green' ? 'ok' : (rag === 'Amber' ? 'warn' : 'crit'),

  priorityIcon: () => '',
};

// Apply initial theme icon
(function () {
  const t = localStorage.getItem('imserv-theme') || 'dark';
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = t === 'dark' ? 'Dark' : 'Light';
})();

Object.assign(IMSERV, {
  iconSvg(name) {
    const icons = {
      activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
      alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
      barChart: '<path d="M4 19V9"/><path d="M12 19V5"/><path d="M20 19v-7"/>',
      beaker: '<path d="M10 2v7.5L4.2 19a2 2 0 0 0 1.7 3h12.2a2 2 0 0 0 1.7-3L14 9.5V2"/><path d="M8 2h8"/><path d="M7.5 16h9"/>',
      bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4"/><path d="M8 13h.01"/><path d="M16 13h.01"/><path d="M9 17h6"/>',
      calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
      check: '<path d="M21 12a9 9 0 1 1-5.3-8.2"/><path d="m9 12 2 2 6-7"/>',
      clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M8 12h8"/><path d="M8 16h6"/>',
      download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
      folder: '<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
      map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Z"/><path d="M9 3v15"/><path d="M15 6v15"/>',
      moon: '<path d="M21 14.5A8.5 8.5 0 0 1 9.5 3a7 7 0 1 0 11.5 11.5Z"/>',
      percent: '<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2"/><circle cx="17" cy="17" r="2"/>',
      phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1A19.5 19.5 0 0 1 5.2 13 19.8 19.8 0 0 1 2 4.3 2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L7.8 9.7a16 16 0 0 0 6.5 6.5l1.3-1.3a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 1.9Z"/>',
      refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>',
      settings: '<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V22a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1A2 2 0 1 1 4.2 18l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 8A2 2 0 1 1 7 5.2l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.6V4a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1A2 2 0 1 1 19.8 8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.6 1h.1a2 2 0 1 1 0 4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
      shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-5"/>',
      sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.3 17.7-1.4 1.4"/><path d="m19.1 4.9-1.4 1.4"/>',
      target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
      trendingDown: '<path d="m22 17-8.5-8.5-5 5L2 7"/><path d="M16 17h6v-6"/>',
      trendingUp: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
      trophy: '<path d="M8 21h8"/><path d="M12 17v4"/><path d="M7 4h10v4a5 5 0 0 1-10 0Z"/><path d="M7 6H4a2 2 0 0 0 2 4h1"/><path d="M17 6h3a2 2 0 0 1-2 4h-1"/>',
      user: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>',
      users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
      wallet: '<path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2"/><path d="M3 7h17a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-4a3 3 0 0 1 0-6h4"/>',
      wrench: '<path d="M14.7 6.3a4 4 0 0 0-5 5L3 18v3h3l6.7-6.7a4 4 0 0 0 5-5l-2.9 2.9-2-2 2.9-2.9Z"/>',
      xCircle: '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
      zap: '<path d="M13 2 3 14h8l-1 8 11-14h-8Z"/>',
    };
    const body = icons[name] || icons.activity;
    return `<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
  },

  iconForLabel(label = '') {
    const t = label.toLowerCase();
    if (t.includes('request')) return 'clipboard';
    if (t.includes('contact') || t.includes('volume') || t.includes('phone')) return 'phone';
    if (t.includes('customer')) return 'user';
    if (t.includes('booking')) return 'calendar';
    if (t.includes('cancel')) return 'alert';
    if (t.includes('abort') || t.includes('abandon')) return 'xCircle';
    if (t.includes('completion') || t.includes('completed') || t.includes('jobs completed')) return 'check';
    if (t.includes('conversion') || t.includes('margin by') || t.includes('funnel')) return 'target';
    if (t.includes('engineer')) return 'wrench';
    if (t.includes('utilisation') || t.includes('productivity') || t.includes('efficiency')) return 'activity';
    if (t.includes('absence')) return 'shield';
    if (t.includes('revenue') || t.includes('gross') || t.includes('profit')) return 'trendingUp';
    if (t.includes('cost')) return 'wallet';
    if (t.includes('margin %') || t.includes('rate') || t.includes('%')) return 'percent';
    if (t.includes('heatmap') || t.includes('regional') || t.includes('patch')) return 'map';
    if (t.includes('ai') || t.includes('recommendation') || t.includes('prediction')) return 'bot';
    if (t.includes('scenario') || t.includes('config') || t.includes('builder')) return 'settings';
    if (t.includes('accuracy') || t.includes('model')) return 'beaker';
    if (t.includes('trend') || t.includes('forecast')) return 'trendingUp';
    if (t.includes('category')) return 'folder';
    if (t.includes('rebooking')) return 'refresh';
    if (t.includes('performance') || t.includes('top')) return 'trophy';
    return 'barChart';
  },

  setElementIcon(el, name) {
    if (!el) return;
    el.innerHTML = this.iconSvg(name);
    el.classList.add('modern-icon');
    el.dataset.iconReady = 'true';
  },

  hydrateIcons(root = document) {
    root.querySelectorAll('.kpi-icon:not([data-icon-ready])').forEach(el => {
      const card = el.closest('.kpi-card');
      const label = card?.querySelector('.kpi-label')?.textContent || '';
      card?.classList.add('has-modern-icon');
      this.setElementIcon(el, this.iconForLabel(label));
    });

    root.querySelectorAll('.nav-icon:not([data-icon-ready])').forEach(el => {
      const view = el.closest('.nav-item')?.dataset.view;
      const icon = el.id === 'theme-icon'
        ? ((document.documentElement.dataset.theme || 'dark') === 'dark' ? 'moon' : 'sun')
        : ({ journey: 'barChart', forecasting: 'trendingUp', cancellations: 'xCircle', 'field-ops': 'wrench', financial: 'wallet' }[view] || 'settings');
      this.setElementIcon(el, icon);
    });

    root.querySelectorAll('.btn-icon:not([data-icon-ready])').forEach(el => {
      const title = (el.getAttribute('title') || '').toLowerCase();
      const icon = title.includes('refresh') ? 'refresh' : title.includes('export') ? 'download' : title.includes('ai') ? 'bot' : 'settings';
      this.setElementIcon(el, icon);
    });

    root.querySelectorAll('.ai-icon:not([data-icon-ready])').forEach(el => this.setElementIcon(el, 'bot'));
    root.querySelectorAll('.rec-icon:not([data-icon-ready])').forEach(el => {
      const priority = Array.from(el.closest('.rec-card')?.classList || []).find(c => ['Critical', 'High', 'Medium', 'Low'].includes(c));
      this.setElementIcon(el, ({ Critical: 'alert', High: 'zap', Medium: 'activity', Low: 'check' }[priority] || 'bot'));
    });
    root.querySelectorAll('.empty-icon:not([data-icon-ready])').forEach(el => this.setElementIcon(el, 'activity'));

    root.querySelectorAll('.card-title:not([data-icon-ready])').forEach(el => {
      const raw = el.textContent.trim();
      const clean = /^[^\x00-\x7F]/.test(raw) ? raw.replace(/^\S+\s+/, '') : raw;
      el.textContent = clean;
      const icon = document.createElement('span');
      icon.className = 'title-icon modern-icon';
      icon.dataset.iconReady = 'true';
      icon.innerHTML = this.iconSvg(this.iconForLabel(clean));
      el.prepend(icon);
      el.dataset.iconReady = 'true';
    });
  },

  priorityIcon() {
    return '';
  },
});

window.IMSERV = IMSERV;

document.addEventListener('DOMContentLoaded', () => {
  IMSERV.hydrateIcons();
  const observer = new MutationObserver(() => {
    window.requestAnimationFrame(() => IMSERV.hydrateIcons());
  });
  observer.observe(document.body, { childList: true, subtree: true });
});
