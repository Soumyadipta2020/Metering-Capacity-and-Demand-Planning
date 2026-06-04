/* IMSERV — Single Meter View */

function loadMeterViewDashboard() {
  // No auto-load — waits for agent to enter MPXN
}

function mvTryExample(mpxn) {
  const inp = document.getElementById('mv-mpxn-input');
  if (inp) inp.value = mpxn;
  mvSearch();
}

async function mvSearch() {
  const inp = document.getElementById('mv-mpxn-input');
  const mpxn = inp ? inp.value.trim().replace(/\s/g, '') : '';
  if (!mpxn) { mvShowError('Please enter a Meter Point Number (MPXN)'); return; }

  mvShowError('');
  document.getElementById('mv-results').style.display = 'none';

  const btn = document.querySelector('.mv-search-btn');
  if (btn) { btn.textContent = 'Searching…'; btn.disabled = true; }

  try {
    const res  = await fetch(`/api/meter-view?mpxn=${encodeURIComponent(mpxn)}`);
    const data = await res.json();
    if (!res.ok || data.error) { mvShowError(data.error || 'Meter not found'); return; }
    mvRenderAll(data);
    document.getElementById('mv-results').style.display = 'block';
    document.getElementById('mv-results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch {
    mvShowError('Failed to connect. Please try again.');
  } finally {
    if (btn) { btn.textContent = 'Search Meter'; btn.disabled = false; }
  }
}

function mvShowError(msg) {
  const el = document.getElementById('mv-search-error');
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

// ── Master render ─────────────────────────────────────────────────────────────
function mvRenderAll(d) {
  const mpxnEl = document.getElementById('mv-result-mpxn');
  const jobsEl = document.getElementById('mv-total-jobs');
  if (mpxnEl) mpxnEl.textContent = d.mpxn;
  if (jobsEl) jobsEl.textContent = `${d.total_jobs} job${d.total_jobs !== 1 ? 's' : ''} on record`;

  mvRenderMeterDetails(d.meter_details);
  mvRenderInsights(d.insights);
  mvRenderMopDetails(d.mop_details);
  mvRenderDcDetails(d.dc_details);
  mvRenderContacts(d.last_contacts);
  mvRenderVisits(d.last_visits);
}

// ── Panel renders ─────────────────────────────────────────────────────────────
function mvRenderMeterDetails(m) {
  const el = document.getElementById('mv-meter-details');
  if (!el) return;
  el.innerHTML = `
    ${mvRow('MPXN',              m.mpxn,           true)}
    ${mvRow('MSN',               m.msn)}
    ${mvRow('Meter Type',        m.meter_type)}
    ${mvRow('Fuel Type',         m.fuel_type)}
    ${mvRow('Supplier',          m.supplier)}
    ${mvRow('Region',            m.region)}
    ${mvRow('Patch',             m.patch)}
    ${mvRow('Last Read',         m.last_read + ' kWh')}
    ${mvRow('Last Bill Type',    m.last_bill_type)}
    ${mvRow('Last Bill Date',    mvDate(m.last_bill_date))}
    ${mvRow('Billing Frequency', m.billing_freq)}
    ${mvRow('Payment Type',      m.payment_type)}
  `;
}

function mvRenderInsights(ins) {
  const el = document.getElementById('mv-insights');
  if (!el) return;
  el.innerHTML = `
    ${mvBool('Seal Visible',        ins.seal_visible)}
    ${mvBool('No Seal Tampering',   ins.no_seal_tampering)}
    ${mvBool('No Physical Damage',  ins.no_physical_damage)}
    ${mvBool('No Wiring Issue',     ins.no_wiring_issue)}
    <div class="mv-summary-block">
      <div class="mv-summary-label">Last 3 Visit Summary</div>
      <div class="mv-summary-text">${ins.visit_summary}</div>
    </div>
  `;
}

function mvRenderMopDetails(m) {
  const el = document.getElementById('mv-mop-details');
  if (!el) return;
  const sc = m.last_job_status === 'Completed' ? 'mv-status--ok'
           : m.last_job_status === 'Cancelled'  ? 'mv-status--warn'
           : m.last_job_status === 'Aborted On Day' ? 'mv-status--crit' : '';
  el.innerHTML = `
    ${mvRow('Last Job Date',      mvDate(m.last_job_date))}
    ${mvRow('Last Job Type',      m.last_job_type)}
    <div class="mv-field-row">
      <span class="mv-label">Last Job Status</span>
      <span class="mv-status-pill ${sc}">${m.last_job_status}</span>
    </div>
    ${m.reason !== '—' ? mvRow('Reason', m.reason) : ''}
    ${mvRow('Industry Flows Received', m.flows_received)}
    ${mvRow('Flow Outcome',       m.flow_outcome)}
    ${mvRow('Outstanding Flows',  m.outstanding_flows)}
  `;
}

function mvRenderDcDetails(d) {
  const el = document.getElementById('mv-dc-details');
  if (!el) return;
  el.innerHTML = `
    ${mvRow('Last Visit Date',       mvDate(d.last_visit_date))}
    <div class="mv-field-row">
      <span class="mv-label">Last Visit VNR Status</span>
      <span class="${d.vnr_status ? 'mv-tick' : 'mv-cross'}">${d.vnr_status ? '✓ Read Captured' : '✗ VNR'}</span>
    </div>
    ${mvRow('Last Read Captured',    d.last_read_captured !== '—' ? d.last_read_captured + ' kWh' : '—')}
    ${mvRow('Last Channel',          d.last_channel)}
  `;
}

// ── History tables ────────────────────────────────────────────────────────────
function mvRenderContacts(contacts) {
  const tb = document.getElementById('mv-contacts-body');
  if (!tb) return;
  if (!contacts || !contacts.length) {
    tb.innerHTML = '<tr><td colspan="6" class="mv-empty-td">No contact history found</td></tr>';
    return;
  }
  tb.innerHTML = contacts.map((c, i) => `
    <tr class="${i % 2 ? 'mv-tr--alt' : ''}">
      <td class="mv-td">${mvDate(c.date)}</td>
      <td class="mv-td">${c.channel}</td>
      <td class="mv-td">${c.contacts} contact${c.contacts !== 1 ? 's' : ''}${c.abandoned ? ` <span class="mv-aside">(${c.abandoned} abandoned)</span>` : ''}</td>
      <td class="mv-td"><span class="mv-outcome ${mvOutcomeClass(c.outcome)}">${c.outcome}</span></td>
      <td class="mv-td"><span class="mv-mini ${mvOutcomeClass(c.mop_status)}">${c.mop_status}</span></td>
      <td class="mv-td"><span class="mv-mini ${mvDcClass(c.dc_status)}">${c.dc_status}</span></td>
    </tr>`).join('');
}

function mvRenderVisits(visits) {
  const tb = document.getElementById('mv-visits-body');
  if (!tb) return;
  if (!visits || !visits.length) {
    tb.innerHTML = '<tr><td colspan="7" class="mv-empty-td">No visit history found</td></tr>';
    return;
  }
  tb.innerHTML = visits.map((v, i) => `
    <tr class="${i % 2 ? 'mv-tr--alt' : ''}">
      <td class="mv-td">${mvDate(v.date)}</td>
      <td class="mv-td mv-td--eng">${v.engineer}</td>
      <td class="mv-td">${v.job_type}</td>
      <td class="mv-td"><span class="mv-outcome ${mvOutcomeClass(v.status)}">${v.status}</span></td>
      <td class="mv-td mv-td--reason">${v.reason !== '—' ? v.reason : '<span class="mv-na">—</span>'}</td>
      <td class="mv-td"><span class="mv-mini ${mvOutcomeClass(v.mop_outcome)}">${v.mop_outcome}</span></td>
      <td class="mv-td"><span class="mv-mini ${mvDcClass(v.dc_outcome)}">${v.dc_outcome}</span></td>
    </tr>`).join('');
}

// ── HTML helpers ──────────────────────────────────────────────────────────────
function mvRow(label, value, mono) {
  return `<div class="mv-field-row">
    <span class="mv-label">${label}</span>
    <span class="mv-value${mono ? ' mv-value--mono' : ''}">${value || '—'}</span>
  </div>`;
}

function mvBool(label, val) {
  return `<div class="mv-field-row">
    <span class="mv-label">${label}</span>
    <span class="${val ? 'mv-tick' : 'mv-cross'}">${val ? '✓' : '✗'}</span>
  </div>`;
}

function mvDate(d) {
  if (!d || d === '—') return '—';
  try {
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch { return d; }
}

function mvOutcomeClass(s) {
  if (!s) return '';
  const l = s.toLowerCase();
  if (l === 'completed') return 'mv-ok';
  if (l === 'scheduled' || l === 'booked') return 'mv-neutral';
  if (l === 'cancelled') return 'mv-warn';
  if (l.includes('abort') || l === 'pending') return 'mv-crit';
  return '';
}

function mvDcClass(s) {
  if (!s) return '';
  if (s === 'Read Captured') return 'mv-ok';
  if (s.includes('No Answer')) return 'mv-warn';
  return 'mv-crit';
}

// ── Enter-key shortcut ────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const inp = document.getElementById('mv-mpxn-input');
  if (inp) inp.addEventListener('keydown', e => { if (e.key === 'Enter') mvSearch(); });
});
