import re

with open('static/js/dashboard.js', 'r', encoding='utf-8') as f:
    text = f.read()

pattern = re.compile(r'<div class="rc-supplier-card" style="flex: 1 1 calc\(25% - 16px\); min-width: 250px;">')
replacement = r'<div class="rc-supplier-card">'

new_text = re.sub(pattern, replacement, text)

if text != new_text:
    with open('static/js/dashboard.js', 'w', encoding='utf-8') as f:
        f.write(new_text)
    print("Inline flex style removed successfully")
else:
    print("Pattern not found")
