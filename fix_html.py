import sys

with open('templates/index.html', 'r', encoding='utf-8') as f:
    text = f.read()

target = """        <!-- Channel Comparison -->
        <div class="channel-lab mb-16">
          <div class="channel-lab-topline">
            <div>
              <div class="channel-lab-title">Smart Meter Contact Attempt Channel Signal Map</div>
              <div class="channel-lab-subtitle">Shows contact attempts, appointments booked, total-visit conversion and appointment contribution by channel</div>
            </div>
            <div class="channel-lab-legend">
              <span><i class="legend-dot volume"></i>Bubble size = contact attempts</span>
              <span><i class="legend-dot conversion"></i>Ring = appointments booked to total visits</span>
              <span><i class="legend-dot abandon"></i>Marker = abandon</span>
            </div>
          </div>
          <div id="channel-comparison-grid" class="channel-ecosystem">
            <div class="loading"><span class="spinner"></span></div>
          </div>
        </div>"""

replacement = """        <!-- Decomposition Tree -->
        <div class="channel-lab mb-16">
          <div class="channel-lab-topline">
            <div>
              <div class="channel-lab-title">Smart Meter Appointment Journey Decomposition Tree</div>
              <div class="channel-lab-subtitle">Shows the full flow of customer data from dialler load through to executed visits by channel</div>
            </div>
          </div>
          <div id="decomposition-tree-container" class="decomp-tree-container">
            <div class="loading"><span class="spinner"></span></div>
          </div>
        </div>"""

if target in text:
    new_text = text.replace(target, replacement)
    with open('templates/index.html', 'w', encoding='utf-8') as f:
        f.write(new_text)
    print("Successfully replaced HTML")
else:
    print("Target not found!")
