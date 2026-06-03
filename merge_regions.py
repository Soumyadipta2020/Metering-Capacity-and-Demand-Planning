import json
from shapely.geometry import shape, mapping
from shapely.ops import unary_union

def get_region_code(props):
    region = props.get('region', '') or ''
    if region == 'Northern Ireland':
        return None
    if 'Wales' in region:
        return 'WAL'
    if region in ['Highlands and Islands', 'North Eastern', 'Eastern', 'South Western']:
        return 'SCO'
    if region == 'North East':
        return 'NE'
    if region == 'North West':
        return 'NW'
    if region == 'Yorkshire and the Humber':
        return 'YRK'
    if region in ['East Midlands', 'West Midlands']:
        return 'MID'
    if region == 'South West':
        return 'SW'
    if region in ['South East', 'Greater London', 'East']:
        return 'SE'
    return None

with open('static/data/gb-all.geo.json', 'r') as f:
    data = json.load(f)

region_polygons = {}
region_names = {
    'WAL': 'Wales',
    'SCO': 'Highlands and Islands',
    'NE': 'North East',
    'NW': 'North West',
    'YRK': 'Yorkshire and the Humber',
    'MID': 'East Midlands',
    'SW': 'South West',
    'SE': 'South East'
}
display_names = {
    'WAL': 'Wales',
    'SCO': 'Scotland',
    'NE': 'North East',
    'NW': 'North West',
    'YRK': 'Yorkshire',
    'MID': 'Midlands',
    'SW': 'South West',
    'SE': 'South East'
}

context_features = []

for feat in data['features']:
    code = get_region_code(feat['properties'])
    if code:
        geom = shape(feat['geometry'])
        if code not in region_polygons:
            region_polygons[code] = []
        region_polygons[code].append(geom)
    else:
        context_features.append(feat)

new_features = []
for code, polys in region_polygons.items():
    merged = unary_union([p.buffer(0) for p in polys])
    rep_point = merged.representative_point()
    new_features.append({
        'type': 'Feature',
        'properties': {
            'region': region_names[code],
            'name': display_names[code],
            'region_code': code,
            'label_lon': rep_point.x,
            'label_lat': rep_point.y
        },
        'geometry': mapping(merged)
    })

new_features.extend(context_features)

new_data = {
    'type': 'FeatureCollection',
    'features': new_features
}

with open('static/data/gb-all.geo.json', 'w') as f:
    json.dump(new_data, f)
print("Merge complete")
