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

  priorityIcon: (p) => ({ Critical: '🔴', High: '🟠', Medium: '🔵', Low: '🟢' })[p] || '⚪',
};

// Apply initial theme icon
(function () {
  const t = localStorage.getItem('imserv-theme') || 'dark';
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = t === 'dark' ? '🌙' : '☀️';
})();
