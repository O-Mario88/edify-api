#!/usr/bin/env python3
"""
Extract the official Uganda COD-AB administrative boundaries into a clean,
version-controlled JSON backbone — the geography source of truth.

Reads uga_admin_boundaries.gdb (HDX / OCHA COD-AB) and emits geography.json with
the REAL hierarchy actually present in the file (no invented levels):

  Country (admin0)  →  Region (admin1, 4)  →  District (admin2, 135)
                    →  County (admin3, 208) →  Sub-county (admin4, 1520)

There are NO parishes and NO sub-regions in COD-AB — those are handled as
controlled layers elsewhere, never fabricated here. Geometry is dropped; we keep
pcodes, parent pcodes, ref names, centroids (center_lat/lon) and area_sqkm.
"""
import json, sys, hashlib
from pyogrio import read_info
from pyogrio.raw import read

GDB = sys.argv[1] if len(sys.argv) > 1 else "uga_admin_boundaries.gdb"

def rows(layer):
    res = read(GDB, layer=layer, read_geometry=False)
    meta = res[0]
    field_data = res[-1]
    cols = list(meta["fields"])
    n = len(field_data[0]) if field_data else 0
    out = []
    for i in range(n):
        out.append({c: field_data[j][i] for j, c in enumerate(cols)})
    return out

def clean(v):
    if v is None:
        return None
    if hasattr(v, "item"):
        v = v.item()
    if isinstance(v, float):
        return round(v, 6)
    return v

def name(r, lvl):
    # ref_name is the canonical OCHA reference spelling; fall back to admN_name
    return r.get(f"adm{lvl}_ref_name") or r.get(f"adm{lvl}_name")

# admin0 — country
c = rows("uga_admin0")[0]
country = {
    "name": name(c, 0), "iso2": clean(c.get("iso2")), "iso3": clean(c.get("iso3")),
    "pcode": clean(c.get("adm0_pcode")), "centroidLat": clean(c.get("center_lat")),
    "centroidLng": clean(c.get("center_lon")),
}

def extract(layer, lvl, parent_lvl):
    out = []
    for r in rows(layer):
        out.append({
            "name": name(r, lvl),
            "pcode": clean(r.get(f"adm{lvl}_pcode")),
            "parentPcode": clean(r.get(f"adm{parent_lvl}_pcode")),
            "parentName": name(r, parent_lvl),
            "centroidLat": clean(r.get("center_lat")),
            "centroidLng": clean(r.get("center_lon")),
            "areaSqKm": clean(r.get("area_sqkm")),
        })
    out.sort(key=lambda x: (x["pcode"] or ""))
    return out

regions = extract("uga_admin1", 1, 0)
districts = extract("uga_admin2", 2, 1)
counties = extract("uga_admin3", 3, 2)
subcounties = extract("uga_admin4", 4, 3)

data = {
    "source": "HDX/OCHA COD-AB Uganda administrative boundaries (uga_admin_boundaries.gdb)",
    "sourceUrl": "https://data.humdata.org/dataset/6d6d1495-196b-49d0-86b9-dc9022cde8e7",
    "datasetId": "6d6d1495-196b-49d0-86b9-dc9022cde8e7",
    "resourceId": "ca93a625-4749-4bb0-a6c4-7eec58c2ca84",
    "sourceLastModified": "2026-01-26T16:27:55.500130",
    "crs": "EPSG:4326",
    "levels": {"country": 1, "region": len(regions), "district": len(districts),
               "county": len(counties), "subCounty": len(subcounties), "parish": 0},
    "parishesPresent": False,
    "subRegionsPresent": False,
    "country": country,
    "regions": regions,
    "districts": districts,
    "counties": counties,
    "subCounties": subcounties,
}

payload = json.dumps(data, ensure_ascii=False, indent=2)
data["checksum"] = hashlib.sha256(payload.encode()).hexdigest()
with open("geography.json", "w") as f:
    json.dump(data, f, ensure_ascii=False, indent=2)

print("WROTE geography.json")
print(f"  regions={len(regions)} districts={len(districts)} counties={len(counties)} subCounties={len(subcounties)} parishes=0")
print(f"  region names: {[r['name'] for r in regions]}")
print(f"  sample district: {districts[0]['name']} ({districts[0]['pcode']}) region={districts[0]['parentName']}")
# integrity: every child's parent pcode must resolve
dpc = {d['pcode'] for d in districts}
cpc = {c['pcode'] for c in counties}
rpc = {r['pcode'] for r in regions}
orphan_d = [d['name'] for d in districts if d['parentPcode'] not in rpc]
orphan_c = [c['name'] for c in counties if c['parentPcode'] not in dpc]
orphan_s = [s['name'] for s in subcounties if s['parentPcode'] not in cpc]
print(f"  orphans: districts={len(orphan_d)} counties={len(orphan_c)} subCounties={len(orphan_s)}")
dup = len(dpc) != len(districts)
print(f"  duplicate district pcodes: {dup}")
