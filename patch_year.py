import sys

with open('app.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Pattern 1
content = content.replace(
    'rows = [r for r in rows if to_int_fn(r.get("year")) == year and r.get("is_forecast", "0") == "0"]',
    'rows = [r for r in rows if r.get("is_forecast", "0") == "0"]'
)
content = content.replace(
    'rows = [r for r in rows if to_int_fn(r.get("year")) == year and r.get("is_forecast", "0") == "1"]',
    'rows = [r for r in rows if r.get("is_forecast", "0") == "1"]'
)
# Pattern 2
content = content.replace(
    'if job.get("requested_date", "")[:4] != str(year) or job.get("is_forecast", "0") != "0":',
    'if job.get("is_forecast", "0") != "0":'
)
content = content.replace(
    'if job.get("requested_date", "")[:4] != str(year) or job.get("is_forecast", "0") != "1":',
    'if job.get("is_forecast", "0") != "1":'
)

# And one special case in get_decomposition_tree or others:
content = content.replace(
    'and to_int_fn(r.get("year")) == year',
    ''
)

with open('app.py', 'w', encoding='utf-8') as f:
    f.write(content)

print('app.py filtering patched successfully!')
