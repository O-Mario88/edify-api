#!/usr/bin/env python3
"""
Extract SIMPLIFIED sub-county (COD-AB admin4) boundaries → subcounties.geojson,
each tagged with its parent DISTRICT pcode (adm2) so the map can reveal
sub-county detail when the user zooms into a district (Google-Maps style LOD).
Lazily loaded by the frontend only when zoomed in.
"""
import json, sys, os
from pyogrio.raw import read
from shapely import from_wkb, set_precision
from shapely.geometry import mapping

GDB = sys.argv[1] if len(sys.argv) > 1 else "uga_admin_boundaries.gdb"
TOL = 0.006  # ~0.6 km — finer than districts (sub-counties are smaller)

res = read(GDB, layer="uga_admin4", read_geometry=True)
meta, geoms, fields = res[0], res[2], res[3]
cols = list(meta["fields"])
name_i = cols.index("adm4_ref_name") if "adm4_ref_name" in cols else cols.index("adm4_name")
pcode_i = cols.index("adm4_pcode")
dist_i = cols.index("adm2_pcode")

features = []
for i, wkb in enumerate(geoms):
    g = from_wkb(wkb).simplify(TOL, preserve_topology=True)
    g = set_precision(g, 0.001)
    if g.is_empty:
        continue
    features.append({
        "type": "Feature",
        "properties": {"pcode": fields[pcode_i][i], "name": fields[name_i][i], "district": fields[dist_i][i]},
        "geometry": mapping(g),
    })

fc = {"type": "FeatureCollection", "source": "COD-AB uga_admin4 (simplified %.3f deg)" % TOL, "features": features}
with open("subcounties.geojson", "w") as f:
    json.dump(fc, f, separators=(",", ":"))
print(f"WROTE subcounties.geojson — {len(features)} sub-counties, size {os.path.getsize('subcounties.geojson')//1024} KB")
