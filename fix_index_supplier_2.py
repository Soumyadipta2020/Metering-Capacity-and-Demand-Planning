import sys

with open('templates/index.html', 'r', encoding='utf-8') as f:
    text = f.read()

target = """        <div class="supplier-lab mb-16">
          <div class="supplier-lab-topline">
            <div>
              <div class="supplier-lab-title">Supplier Behaviour and Contribution Map</div>
              <div class="supplier-lab-subtitle">Shows supplier contribution, booking conversion, visit success, fallout, and unresolved appointment pressure</div>
            </div>
            <div class="supplier-lab-legend">
              <span><i class="legend-dot contribution"></i>Size = contribution</span>
              <span><i class="legend-dot behaviour"></i>Height = behaviour score</span>
              <span><i class="legend-dot fallout"></i>Colour = fallout pressure</span>
            </div>
          </div>
          <div id="supplier-behaviour-grid" class="supplier-ecosystem">
            <div class="loading"><span class="spinner"></span></div>
          </div>
        </div>"""

replacement = """        <!-- Supplier Performance Grid -->
        <div class="recovery-constellation-card mb-16">
          <div class="recovery-constellation-header">
            <div>
              <div class="recovery-constellation-title">🏭 Supplier Grid Info</div>
              <div class="recovery-constellation-subtitle">Shows top 25 supplier contribution, booking conversion, visit success, and fallout (remaining suppliers grouped into Others)</div>
            </div>
          </div>
          <div id="supplier-behaviour-grid" class="supplier-recovery-stage" style="padding: 16px;">
            <div class="loading"><span class="spinner"></span> Loading supplier data...</div>
          </div>
        </div>"""

if target in text:
    text = text.replace(target, replacement)
    with open('templates/index.html', 'w', encoding='utf-8') as f:
        f.write(text)
    print("index.html updated successfully")
else:
    print("target not found in index.html")
