/* IMSERV — Main Application Controller
   Handles view switching, global state, and SPA navigation.
   Mirrors DAA's view-switching pattern via data-view attributes.
*/

const VIEW_CONFIG = {
  'journey':      { title: 'Bookings to Completions Journey',     breadcrumb: 'IMSERV / Overview / Journey Dashboard',       loader: loadJourneyDashboard },
  'forecasting':  { title: 'Contact Centre Forecasting',           breadcrumb: 'IMSERV / Contact Centre / Forecasting',        loader: loadForecastingDashboard },
  'cancellations':{ title: 'Cancellations & Aborts',               breadcrumb: 'IMSERV / Operations / Cancellations',          loader: loadCancellationsDashboard },
  'field-ops':    { title: 'Field Operations & Engineer Planning',  breadcrumb: 'IMSERV / Operations / Field Planning',         loader: loadFieldOpsDashboard },
  'financial':    { title: 'Financial Scenario Planning',           breadcrumb: 'IMSERV / Finance / Scenario Planning',         loader: loadFinancialDashboard },
};

let _currentView = 'journey';

function switchView(viewName, navEl) {
  // Deactivate all views
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  // Activate target
  const view = document.getElementById('view-' + viewName);
  if (view) view.classList.add('active');
  if (navEl) navEl.classList.add('active');

  // Update header
  const config = VIEW_CONFIG[viewName];
  if (config) {
    const titleEl = document.getElementById('page-title');
    const breadEl = document.getElementById('page-breadcrumb');
    if (titleEl) titleEl.textContent = config.title;
    if (breadEl) breadEl.textContent = config.breadcrumb;
  }

  _currentView = viewName;

  // Load data for this view
  if (config && config.loader) {
    config.loader();
  }
}

function onRegionChange() {
  refreshCurrentView();
}

function onYearChange() {
  refreshCurrentView();
}

function refreshCurrentView() {
  const config = VIEW_CONFIG[_currentView];
  if (config && config.loader) {
    config.loader();
  }
}

function exportCurrentView() {
  const links = {
    'journey':       '/api/journey/kpis',
    'forecasting':   '/api/forecasting/channel-kpis',
    'cancellations': '/api/cancellations/kpis',
    'field-ops':     '/api/field-ops/kpis',
    'financial':     '/api/financial/kpis',
  };
  const url = links[_currentView];
  if (url) window.open(url + '?format=csv', '_blank');
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.classList.toggle('collapsed');
}

function openAiPanel() {
  const overlay = document.getElementById('ai-modal');
  if (!overlay) return;
  overlay.classList.add('open');
  loadAiModal();
}

function closeAiPanel() {
  const overlay = document.getElementById('ai-modal');
  if (overlay) overlay.classList.remove('open');
}

async function loadAiModal() {
  const body = document.getElementById('ai-modal-body');
  if (!body) return;
  body.innerHTML = '<div class="loading"><span class="spinner"></span> Generating AI insights...</div>';

  const year = IMSERV.getYear();
  const [recs, summary] = await Promise.all([
    IMSERV.apiFetch('/api/ai/recommendations?year=' + year + '&max=15'),
    IMSERV.apiFetch('/api/ai/summary?year=' + year),
  ]);

  if (!recs) {
    body.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><div class="empty-title">Could not load recommendations</div></div>';
    return;
  }

  const summaryHtml = summary ? `
    <div class="ai-summary-bar mb-16">
      <div class="ai-icon">🤖</div>
      <div class="ai-text">${summary.summary}</div>
    </div>
  ` : '';

  const recsHtml = (recs.recommendations || []).map(r => `
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

  body.innerHTML = summaryHtml + `
    <div class="d-flex gap-8 mb-12 flex-wrap">
      <span class="stat-chip">🔴 Critical: <strong>${recs.critical_count}</strong></span>
      <span class="stat-chip">🟠 High: <strong>${recs.high_count}</strong></span>
      <span class="stat-chip">⚡ Action Required: <strong>${recs.action_required_count}</strong></span>
    </div>
    <div class="rec-list">${recsHtml}</div>
  `;
}

// Close modal on overlay click
document.getElementById('ai-modal')?.addEventListener('click', function (e) {
  if (e.target === this) closeAiPanel();
});

// ─── Initialise on DOM ready ─────────────────────────────────
document.addEventListener('DOMContentLoaded', async function () {
  // Health check
  const health = await IMSERV.apiFetch('/api/health');
  if (health && health.status === 'degraded') {
    console.warn('IMSERV: Data health degraded — triggering generation...');
    await IMSERV.apiFetch('/api/data/generate');
  }

  // Load initial view
  loadJourneyDashboard();
});
