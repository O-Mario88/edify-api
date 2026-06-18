/**
 * geo:import:units-2022 — enrich the geography backbone from the Uganda
 * Administrative Units Dataset 2022 (UG-AU-DS-2022), ADDITIVELY:
 *   • create DISTRICTS present in the 2022 dataset but missing from COD-AB
 *     (the 10 new Cities + Terego) with their region, counties, sub-counties;
 *   • create the PARISH layer (COD-AB has none) under matched sub-counties;
 *   • create the VILLAGE layer (admin5).
 *
 * NON-DESTRUCTIVE: the COD-AB backbone (pcodes, centroids, boundary geometry,
 * the 700 school links, clusters) is untouched. Existing districts/sub-counties
 * are matched by normalized name (+ explicit alias); only genuinely-new units
 * are created, tagged source="UG-AU-DS-2022" so provenance is auditable.
 * Idempotent: re-running upserts, never duplicates. Unmatched rows are logged.
 *
 * Run: npm run geo:import:units-2022
 */
import { PrismaService } from '../src/prisma/prisma.service';
import { normalizeUgandaAdminName } from '../src/common/geography/normalize';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const prisma = new PrismaService();
const SOURCE = 'UG-AU-DS-2022';

type DsDistrict = { district: string; data: DsCounty[] };
type DsCounty = { constituency: string; data: DsSub[] };
type DsSub = { subcounty: string; data: DsParish[] };
type DsParish = { parish: string; villages: string[] };

// Districts in the 2022 dataset that are NOT in COD-AB (the new Cities + Terego).
// COD-AB predates the 2020-2022 city/district splits. Region is the city's
// parent-district region (verified against the live backend).
const REGION_OVERRIDE: Record<string, string> = {
  'arua city': 'Northern',
  'fort portal city': 'Western',
  'gulu city': 'Northern',
  'hoima city': 'Western',
  'jinja city': 'Eastern',
  'lira city': 'Northern',
  'masaka city': 'Central',
  'mbale city': 'Eastern',
  'mbarara city': 'Western',
  'soroti city': 'Eastern',
  terego: 'Northern',
};

// Spelling variants of EXISTING districts → the COD-AB normalized name. These are
// NOT new districts; their units attach to the existing district.
const DISTRICT_ALIAS: Record<string, string> = {
  luweero: 'luwero', // dataset "LUWEERO" == COD-AB "Luwero"
};

async function main() {
  const dataPath = path.resolve(__dirname, '../prisma/data/ug-au-ds-2022.json');
  if (!fs.existsSync(dataPath)) {
    console.error(`Dataset not found at ${dataPath}.`);
    process.exit(1);
  }
  const raw = fs.readFileSync(dataPath, 'utf-8');
  const checksum = crypto.createHash('sha256').update(raw).digest('hex');
  const ds = JSON.parse(raw) as { districts: DsDistrict[] };

  const stats = {
    districtsCreated: 0, districtsMatched: 0, districtsUnresolved: 0,
    countiesCreated: 0, subCountiesCreated: 0, subCountiesMatched: 0,
    parishes: 0, villages: 0,
  };
  const unresolved: string[] = [];

  // ── Preload backend geography for fast in-memory matching ──
  const regions = await prisma.region.findMany();
  const regionByName = new Map(regions.map((r) => [r.name.toLowerCase(), r.id]));

  const districts = await prisma.district.findMany({ select: { id: true, name: true, regionId: true } });
  // normalized district name → id (apply aliases so "luweero" → Luwero's id)
  const districtByNorm = new Map<string, string>();
  for (const d of districts) districtByNorm.set(normalizeUgandaAdminName(d.name), d.id);
  for (const [alias, canonical] of Object.entries(DISTRICT_ALIAS)) {
    const id = districtByNorm.get(canonical);
    if (id) districtByNorm.set(alias, id);
  }

  // districtId → (normalized sub-county name → id)
  const subByDistrict = new Map<string, Map<string, string>>();
  const allSubs = await prisma.subCounty.findMany({ select: { id: true, name: true, districtId: true } });
  for (const s of allSubs) {
    let m = subByDistrict.get(s.districtId);
    if (!m) { m = new Map(); subByDistrict.set(s.districtId, m); }
    m.set(normalizeUgandaAdminName(s.name), s.id);
  }

  // districtId → (normalized county name → id) — built lazily as we create/match
  const countyByDistrict = new Map<string, Map<string, string>>();

  let villageBuf: { name: string; parishId: string; source: string }[] = [];
  async function flushVillages(force = false) {
    if (villageBuf.length >= 4000 || (force && villageBuf.length)) {
      const batch = villageBuf;
      villageBuf = [];
      await prisma.village.createMany({ data: batch, skipDuplicates: true });
      stats.villages += batch.length;
    }
  }

  let processed = 0;
  for (const dsD of ds.districts) {
    const dNorm = normalizeUgandaAdminName(dsD.district);
    let districtId = districtByNorm.get(dNorm);

    if (!districtId) {
      // Missing district — create it (Cities / Terego) with its region.
      const regionName = REGION_OVERRIDE[dNorm];
      const regionId = regionName ? regionByName.get(regionName.toLowerCase()) : undefined;
      if (!regionId) {
        stats.districtsUnresolved++;
        unresolved.push(`DISTRICT unresolved (no region mapping): ${dsD.district}`);
        continue;
      }
      const created = await prisma.district.upsert({
        where: { regionId_name: { regionId, name: titleCase(dsD.district) } },
        update: { source: SOURCE },
        create: { name: titleCase(dsD.district), regionId, source: SOURCE },
      });
      districtId = created.id;
      districtByNorm.set(dNorm, districtId);
      stats.districtsCreated++;
    } else {
      stats.districtsMatched++;
    }

    let scMap = subByDistrict.get(districtId);
    if (!scMap) { scMap = new Map(); subByDistrict.set(districtId, scMap); }
    let cMap = countyByDistrict.get(districtId);
    if (!cMap) { cMap = new Map(); countyByDistrict.set(districtId, cMap); }

    for (const dsC of dsD.data) {
      // County (constituency) — upsert.
      const cNorm = normalizeUgandaAdminName(dsC.constituency);
      let countyId = cMap.get(cNorm);
      if (!countyId) {
        const county = await prisma.county.upsert({
          where: { districtId_name: { districtId, name: titleCase(dsC.constituency) } },
          update: {},
          create: { name: titleCase(dsC.constituency), normalizedName: cNorm, districtId, source: SOURCE },
        });
        countyId = county.id;
        cMap.set(cNorm, countyId);
        stats.countiesCreated++;
      }

      for (const dsS of dsC.data) {
        const sNorm = normalizeUgandaAdminName(dsS.subcounty);
        let subCountyId = scMap.get(sNorm);
        if (!subCountyId) {
          const sub = await prisma.subCounty.upsert({
            where: { districtId_name: { districtId, name: titleCase(dsS.subcounty) } },
            update: { countyId },
            create: { name: titleCase(dsS.subcounty), districtId, countyId, source: SOURCE, seeded: false },
          });
          subCountyId = sub.id;
          scMap.set(sNorm, subCountyId);
          stats.subCountiesCreated++;
        } else {
          stats.subCountiesMatched++;
        }

        for (const dsP of dsS.data) {
          const parish = await prisma.parish.upsert({
            where: { subCountyId_name: { subCountyId, name: titleCase(dsP.parish) } },
            update: { source: SOURCE, confidence: 'DATASET_2022' },
            create: { name: titleCase(dsP.parish), subCountyId, source: SOURCE, confidence: 'DATASET_2022' },
          });
          stats.parishes++;
          const seen = new Set<string>();
          for (const v of dsP.villages ?? []) {
            const name = titleCase(v);
            if (!name || seen.has(name)) continue;
            seen.add(name);
            villageBuf.push({ name, parishId: parish.id, source: SOURCE });
          }
          await flushVillages();
        }
      }
    }
    processed++;
    if (processed % 10 === 0) {
      await flushVillages(true);
      console.log(`  …${processed}/${ds.districts.length} districts | parishes ${stats.parishes} | villages ${stats.villages}`);
    }
  }
  await flushVillages(true);

  await prisma.boundaryImportRun.create({
    data: {
      sourceName: SOURCE,
      checksum,
      status: unresolved.length ? 'PARTIAL' : 'SUCCESS',
      importedBy: 'geo:import:units-2022',
      levelCounts: { ...stats },
      warnings: unresolved.length ? unresolved : undefined,
    },
  }).catch((e) => console.warn('BoundaryImportRun log skipped:', e.message));

  console.log('\n=== UG-AU-DS-2022 import complete ===');
  console.log(stats);
  if (unresolved.length) {
    console.log(`\nUnresolved (${unresolved.length}):`);
    unresolved.slice(0, 20).forEach((u) => console.log('  - ' + u));
  }
  await prisma.$disconnect();
}

// Dataset is ALL-CAPS; store as Title Case to match the app's display style.
function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/\b(I{1,3}|Iv|Vi{0,3}|Ix|Xi{0,2})\b/gi, (m) => m.toUpperCase()) // roman numerals (KATEREIGA II)
    .trim();
}

main().catch((e) => { console.error(e); process.exit(1); });
