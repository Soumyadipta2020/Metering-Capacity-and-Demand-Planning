import os

def strip_year_filters(folder):
    for f in os.listdir(folder):
        if not f.endswith('.py'): continue
        path = os.path.join(folder, f)
        with open(path, 'r', encoding='utf-8') as file:
            content = file.read()
        
        # We want to remove things like `to_int_fn(row.get("year")) == year and `
        # or `int(row.get("year", 0)) == year`
        # Let's do it safely by matching the exact strings from our searches
        
        # Common patterns:
        content = content.replace('to_int_fn(row.get("year")) == year and ', '')
        content = content.replace('int(row.get("year", 0)) == year and ', '')
        content = content.replace('int(r.get("year", 0)) == year and ', '')
        content = content.replace('to_int_fn(r.get("year")) == year and ', '')
        content = content.replace('and to_int_fn(r.get("year")) == year', '')
        content = content.replace('and int(row.get("year", 0)) == year', '')
        content = content.replace('and int(r.get("year", 0)) == year', '')
        
        content = content.replace('row.get("year", "") == str(year) and ', '')
        content = content.replace('r.get("year", "") == str(year) and ', '')
        content = content.replace('and row.get("year", "") == str(year)', '')
        content = content.replace('and r.get("year", "") == str(year)', '')

        # "if row.get("year") != str(year): continue"
        content = content.replace('if row.get("year") != str(year):\n                continue', '')
        content = content.replace('if r.get("year") != str(year):\n                continue', '')
        content = content.replace('if to_int_fn(row.get("year")) != year:\n                continue', '')
        content = content.replace('if int(row.get("year", 0)) != year:\n                continue', '')

        with open(path, 'w', encoding='utf-8') as file:
            file.write(content)

strip_year_filters('engine')
print('Finished stripping year filters from engine/')
