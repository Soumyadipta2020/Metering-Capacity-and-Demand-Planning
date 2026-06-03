import re

with open('static/js/dashboard.js', 'r', encoding='utf-8') as f:
    text = f.read()

# We need to rewrite renderDecompositionTree and drawDecompLines
new_funcs = """
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
"""

# Replace the old functions
pattern = re.compile(r'function renderDecompositionTree\(data, container\) \{.*?(?=\n// Redraw lines on window resize or scroll)', re.DOTALL)
new_text = re.sub(pattern, new_funcs + '\n', text)

with open('static/js/dashboard.js', 'w', encoding='utf-8') as f:
    f.write(new_text)

print("dashboard.js updated successfully")
