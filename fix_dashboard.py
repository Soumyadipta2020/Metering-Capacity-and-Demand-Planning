import re

with open('static/js/dashboard.js', 'r', encoding='utf-8') as f:
    text = f.read()

# Replace the call
text = text.replace('loadChannelComparison();', 'loadDecompositionTree();')
# Also remove any other calls if any
# Find the function definition
func_pattern = re.compile(r'async function loadChannelComparison\(\) \{.*?\n\}', re.DOTALL)
text = re.sub(func_pattern, '', text)

# Add the new function
new_func = """
async function loadDecompositionTree() {
  const container = document.getElementById('decomposition-tree-container');
  if (!container) return;
  container.innerHTML = '<div class="loading"><span class="spinner"></span></div>';

  try {
    const res = await fetch(`/api/journey/decomposition-tree?region=${STATE.selectedRegion}&year=${STATE.selectedYear}`);
    if (!res.ok) throw new Error('Failed to load decomposition tree');
    const data = await res.json();
    renderDecompositionTree(data, container);
  } catch (err) {
    container.innerHTML = `<div class="error-msg">${err.message}</div>`;
  }
}

function renderDecompositionTree(data, container) {
  container.innerHTML = '';
  
  // We will build columns
  // Col 1: Customer Data Loaded
  // Col 2: Booked / Not Booked
  // Col 3: Channels (Booked)
  // Col 4: Visited / Cancelled (for each channel)
  // Col 5: Successful / Aborted (for each visited)
  // Col 6: Executed / Unresolved (for each successful)

  const fmt = (val) => val.toLocaleString();
  const pct = (val, maxVal) => maxVal > 0 ? ((val/maxVal)*100).toFixed(1) + '%' : '0%';

  let html = `<svg class="decomp-svg-layer" id="decomp-lines"></svg>`;

  function makeNode(id, title, value, maxVal, colorClass, subTitle="") {
    const p = maxVal ? (value / maxVal) * 100 : 0;
    return `
      <div class="decomp-node" id="${id}">
        <div class="decomp-node-header">${title}</div>
        <div class="decomp-node-value">${fmt(value)}</div>
        <div class="decomp-node-sub">${subTitle}</div>
        <div class="decomp-bar-container">
          <div class="decomp-bar ${colorClass}" style="width: ${p}%"></div>
        </div>
      </div>
    `;
  }

  // Col 1
  html += `<div class="decomp-col" id="col-1">
    ${makeNode('node-total', 'Customer Data Loaded', data.total_loaded, data.total_loaded, 'blue', '100%')}
  </div>`;

  // Col 2
  html += `<div class="decomp-col" id="col-2">
    ${makeNode('node-booked', 'Appointments Booked', data.booked, data.total_loaded, 'blue', pct(data.booked, data.total_loaded))}
    ${makeNode('node-notbooked', 'Not Booked', data.not_booked, data.total_loaded, 'amber', pct(data.not_booked, data.total_loaded))}
  </div>`;

  // Channels
  let col3 = '<div class="decomp-col" id="col-3">';
  let col4 = '<div class="decomp-col" id="col-4">';
  let col5 = '<div class="decomp-col" id="col-5">';
  let col6 = '<div class="decomp-col" id="col-6">';

  data.channels.forEach((ch, idx) => {
    const chId = `ch-${idx}`;
    col3 += makeNode(`node-${chId}`, `Channel: ${ch.channel}`, ch.booked, data.booked, 'blue', pct(ch.booked, data.booked));
    
    col4 += makeNode(`node-${chId}-visited`, `Visited (${ch.channel})`, ch.visited, ch.booked, 'blue', pct(ch.visited, ch.booked));
    col4 += makeNode(`node-${chId}-cancel`, `Cancelled (${ch.channel})`, ch.cancelled, ch.booked, 'red', pct(ch.cancelled, ch.booked));

    col5 += makeNode(`node-${chId}-success`, `Successful Visit`, ch.successful_visit, ch.visited, 'green', pct(ch.successful_visit, ch.visited));
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
  setTimeout(() => drawDecompLines(data), 50);
}

function drawDecompLines(data) {
  const svg = document.getElementById('decomp-lines');
  const container = document.getElementById('decomposition-tree-container');
  if (!svg || !container) return;
  
  const rectC = container.getBoundingClientRect();
  svg.innerHTML = '';

  function connect(id1, id2) {
    const el1 = document.getElementById(id1);
    const el2 = document.getElementById(id2);
    if (!el1 || !el2) return;
    
    const r1 = el1.getBoundingClientRect();
    const r2 = el2.getBoundingClientRect();

    const x1 = r1.right - rectC.left + container.scrollLeft;
    const y1 = r1.top + r1.height/2 - rectC.top + container.scrollTop;
    const x2 = r2.left - rectC.left + container.scrollLeft;
    const y2 = r2.top + r2.height/2 - rectC.top + container.scrollTop;

    // Bezier curve
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const cpX1 = x1 + (x2 - x1) / 2;
    const cpX2 = x1 + (x2 - x1) / 2;
    
    path.setAttribute("d", `M ${x1} ${y1} C ${cpX1} ${y1}, ${cpX2} ${y2}, ${x2} ${y2}`);
    svg.appendChild(path);
  }

  connect('node-total', 'node-booked');
  connect('node-total', 'node-notbooked');

  data.channels.forEach((ch, idx) => {
    const chId = `ch-${idx}`;
    connect('node-booked', `node-${chId}`);
    connect(`node-${chId}`, `node-${chId}-visited`);
    connect(`node-${chId}`, `node-${chId}-cancel`);
    
    connect(`node-${chId}-visited`, `node-${chId}-success`);
    connect(`node-${chId}-visited`, `node-${chId}-abort`);

    connect(`node-${chId}-success`, `node-${chId}-executed`);
    connect(`node-${chId}-success`, `node-${chId}-unresolved`);
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
"""

text += new_func

with open('static/js/dashboard.js', 'w', encoding='utf-8') as f:
    f.write(text)
