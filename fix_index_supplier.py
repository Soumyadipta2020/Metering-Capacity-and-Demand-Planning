import re

with open('templates/index.html', 'r', encoding='utf-8') as f:
    text = f.read()

pattern = re.compile(r'        <!-- Supplier Behaviour -->\n        <div class="card mb-16">.*?</div>\n          </div>\n        </div>', re.DOTALL)

replacement = """        <!-- Supplier Performance Grid -->
        <div class="card mb-16">
          <div class="card-header">
            <div>
              <div class="card-title">🏭 Supplier Performance Grid</div>
              <div class="card-subtitle">Shows top 25 supplier contribution, booking conversion, visit success, and fallout (remaining suppliers grouped into Others)</div>
            </div>
          </div>
          <div class="card-body" style="padding: 16px;">
            <div id="supplier-behaviour-grid" class="supplier-performance-stage">
              <div class="loading"><span class="spinner"></span> Loading...</div>
            </div>
          </div>
        </div>"""

new_text = re.sub(pattern, replacement, text)

if text != new_text:
    with open('templates/index.html', 'w', encoding='utf-8') as f:
        f.write(new_text)
    print("index.html updated successfully")
else:
    print("Failed to update index.html")
