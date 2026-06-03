import re

with open('static/js/dashboard.js', 'r', encoding='utf-8') as f:
    text = f.read()

pattern = re.compile(r'  container\.innerHTML = `\n    <div style="display: flex; flex-wrap: wrap; gap: 16px;">\n      \$\{cardsHtml\}\n    </div>\n  `;')

replacement = r"""  container.innerHTML = cardsHtml;"""

new_text = re.sub(pattern, replacement, text)

if text != new_text:
    with open('static/js/dashboard.js', 'w', encoding='utf-8') as f:
        f.write(new_text)
    print("dashboard.js updated successfully")
else:
    print("Failed to find pattern in dashboard.js")
