#!/usr/bin/env python3
"""
Extract SIMPLIFIED district boundary geometry from the COD-AB geodatabase into a
compact GeoJSON the analytics map renders as an SVG choropleth. Real boundaries,
keyed by the official adm2 pcode + name — no raster, no fake shapes.

Heavy Douglas-Peucker simplification (tolerance in degrees) keeps the file small
and the map fast while preserving recognisable district outlines for a country
view. Output: districts.geojson (FeatureCollection) + a bbox for projection.
"""
import json, sys
from pyogrio.raw import read
from shapely import from_wkb, set_precision
from shapely.geometry import mapping

GDB = sys.argv[1] if len(sys.argv) > 1 else "uga_admin_boundaries.gdb"
TOLERANCE = 0.01  # ~1.1 km — clean country-level outlines, tiny file

res = read(GDB, layer="uga_admin2", read_geometry=True)
# pyogrio.raw.read → (meta, fids, geometry_wkb_array, field_data)
meta = res[0]
geometries = res[2]
field_data = res[3]
cols = list(meta["fields"])
name_i = cols.index("adm2_ref_name") if "adm2_ref_name" in cols else cols.index("adm2_name")
pcode_i = cols.index("adm2_pcode")
reg_i = cols.index("adm1_name")

features = []
minx = miny = 1e9
maxx = maxy = -1e9
for i, wkb in enumerate(geometries):
    geom = from_wkb(wkb)
    geom = geom.simplify(TOLERANCE, preserve_topology=True)
    geom = set_precision(geom, 0.001)  # round coords → smaller file
    if geom.is_empty:
        continue
    b = geom.bounds
    minx, miny = min(minx, b[0]), min(miny, b[1])
    maxx, maxy = max(maxx, b[2]), max(maxy, b[3])
    features.append({
        "type": "Feature",
        "properties": {
            "pcode": field_data[pcode_i][i],
            "name": field_data[name_i][i],
            "region": field_data[reg_i][i],
        },
        "geometry": mapping(geom),
    })

fc = {
    "type": "FeatureCollection",
    "source": "COD-AB uga_admin2 (simplified, tolerance=%.3f deg)" % TOLERANCE,
    "bbox": [round(minx, 4), round(miny, 4), round(maxx, 4), round(maxy, 4)],
    "features": features,
}
with open("districts.geojson", "w") as f:
    json.dump(fc, f, separators=(",", ":"))

import os
print(f"WROTE districts.geojson — {len(features)} districts, bbox={fc['bbox']}")
print(f"  size: {os.path.getsize('districts.geojson')//1024} KB")
