/**
 * geo:import — load the official Uganda COD-AB administrative backbone into
 * Postgres from the extracted geography.json (HDX/OCHA, parsed from
 * uga_admin_boundaries.gdb). NON-DESTRUCTIVE: upserts official records
 * (region/district/county/sub-county) onto the existing tables, adds pcodes +
 * centroids + source, and never deletes schools or their geography links.
 *
 * Imports ONLY what exists in COD-AB. There are NO parishes and NO sub-regions
 * in the source — parishes stay empty (table marked NOT_IN_BOUNDARY_SOURCE), and
 * the Lango sub-region is seeded as a CONTROLLED, VERIFIED mapping layer (the
 * explicit product requirement) — other sub-regions are NOT invented.
 *
 * Run: npm run geo:import
 */
import { PrismaService } from '../src/prisma/prisma.service';
import { normalizeUgandaAdminName } from '../src/common/geography/normalize';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const prisma = new PrismaService();

// The 8 officially-recognised Lango sub-region districts (verified present in
// COD-AB). VERIFIED here because the product explicitly requires it; we do not
// fabricate the rest of Uganda's sub-region map — those would be REVIEW_REQUIRED.
const LANGO_DISTRICTS = ['Lira', 'Apac', 'Oyam', 'Dokolo', 'Kole', 'Alebtong', 'Otuke', 'Kwania'];

async function chunked<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

async function main() {
  const dataPath = path.resolve(__dirname, '../geo-data/geography.json');
  if (!fs.existsSync(dataPath)) {
    console.error(`Boundary data not found at ${dataPath}. Run the extractor first (geo-data/extract-codab.py).`);
    process.exit(1);
  }
  const raw = fs.readFileSync(dataPath, 'utf-8');
  const checksum = crypto.createHash('sha256').update(raw).digest('hex');
  const geo = JSON.parse(raw);
  const warnings: string[] = [];

  console.log(`Importing COD-AB: ${geo.levels.region} regions, ${geo.levels.district} districts, ${geo.levels.county} counties, ${geo.levels.subCounty} sub-counties, ${geo.levels.parish} parishes.`);
  if (!geo.parishesPresent) warnings.push('COD-AB contains no parishes — Parish table left empty (NOT_IN_BOUNDARY_SOURCE).');
  if (!geo.subRegionsPresent) warnings.push('COD-AB contains no sub-regions — only the Lango controlled mapping was seeded (VERIFIED).');

  // 1) Regions (upsert by name; attach pcode/source/centroid).
  const regionByPcode = new Map<string, string>();
  for (const r of geo.regions) {
    const rec = await prisma.region.upsert({
      where: { name: r.name },
      update: { pcode: r.pcode, source: 'COD-AB', latitude: r.centroidLat, longitude: r.centroidLng },
      create: { name: r.name, pcode: r.pcode, source: 'COD-AB', latitude: r.centroidLat, longitude: r.centroidLng },
    });
    regionByPcode.set(r.pcode, rec.id);
  }
  console.log(`  regions: ${geo.regions.length} upserted`);

  // 2) Districts (upsert by [regionId, name]).
  const districtByPcode = new Map<string, string>();
  for (const d of geo.districts) {
    const regionId = regionByPcode.get(d.parentPcode);
    if (!regionId) { warnings.push(`district ${d.name}: region pcode ${d.parentPcode} unresolved`); continue; }
    const rec = await prisma.district.upsert({
      where: { regionId_name: { regionId, name: d.name } },
      update: { pcode: d.pcode, source: 'COD-AB', latitude: d.centroidLat, longitude: d.centroidLng },
      create: { name: d.name, regionId, pcode: d.pcode, source: 'COD-AB', latitude: d.centroidLat, longitude: d.centroidLng },
    });
    districtByPcode.set(d.pcode, rec.id);
  }
  console.log(`  districts: ${districtByPcode.size} upserted`);

  // 3) Counties (upsert by [districtId, name]). Track county pcode → district id
  //    so sub-counties (whose parent is a county) resolve their district cleanly.
  const countyByPcode = new Map<string, string>();
  const countyPcodeToDistrictId = new Map<string, string>();
  for (const c of geo.counties) {
    const districtId = districtByPcode.get(c.parentPcode);
    if (!districtId) { warnings.push(`county ${c.name}: district pcode ${c.parentPcode} unresolved`); continue; }
    const rec = await prisma.county.upsert({
      where: { districtId_name: { districtId, name: c.name } },
      update: { pcode: c.pcode, source: 'COD-AB', latitude: c.centroidLat, longitude: c.centroidLng, normalizedName: normalizeUgandaAdminName(c.name) },
      create: { name: c.name, normalizedName: normalizeUgandaAdminName(c.name), districtId, pcode: c.pcode, source: 'COD-AB', latitude: c.centroidLat, longitude: c.centroidLng },
    });
    countyByPcode.set(c.pcode, rec.id);
    countyPcodeToDistrictId.set(c.pcode, districtId);
  }
  console.log(`  counties: ${countyByPcode.size} upserted`);

  // 4) Sub-counties (upsert by [districtId, name]; link county). Chunked for speed.
  let scCount = 0;
  await chunked(geo.subCounties, 40, async (s: any) => {
    const countyId = countyByPcode.get(s.parentPcode);
    const districtId = countyPcodeToDistrictId.get(s.parentPcode);
    if (!districtId) { warnings.push(`subcounty ${s.name}: district unresolved (parent ${s.parentPcode})`); return; }
    await prisma.subCounty.upsert({
      where: { districtId_name: { districtId, name: s.name } },
      update: { pcode: s.pcode, source: 'COD-AB', countyId: countyId ?? undefined, latitude: s.centroidLat, longitude: s.centroidLng, seeded: false },
      create: { name: s.name, districtId, countyId: countyId ?? undefined, pcode: s.pcode, source: 'COD-AB', latitude: s.centroidLat, longitude: s.centroidLng, seeded: false },
    });
    scCount++;
  });
  console.log(`  sub-counties: ${scCount} upserted`);

  // 5) Lango sub-region — CONTROLLED, VERIFIED. Lango is in the Northern region.
  const northern = geo.regions.find((r: any) => r.name === 'Northern');
  const northernId = regionByPcode.get(northern?.pcode);
  const lango = await prisma.subRegion.upsert({
    where: { name: 'Lango' },
    update: { confidence: 'VERIFIED', verifiedBy: 'geo:import', verifiedAt: new Date(), notes: 'Officially recognised Lango sub-region (Northern region). Districts verified present in COD-AB.' },
    create: { name: 'Lango', normalizedName: 'lango', regionId: northernId!, source: 'CONTROLLED', confidence: 'VERIFIED', verifiedBy: 'geo:import', verifiedAt: new Date(), notes: 'Officially recognised Lango sub-region (Northern region).' },
  });
  let langoLinked = 0;
  for (const name of LANGO_DISTRICTS) {
    const d = await prisma.district.findFirst({ where: { name, regionId: northernId! } });
    if (d) { await prisma.district.update({ where: { id: d.id }, data: { subRegionId: lango.id } }); langoLinked++; }
    else warnings.push(`Lango district ${name} not found`);
  }
  console.log(`  sub-region Lango: VERIFIED, ${langoLinked}/${LANGO_DISTRICTS.length} districts linked`);

  // 6) Audit record.
  await prisma.boundaryImportRun.create({
    data: {
      sourceName: geo.source,
      sourceUrl: geo.sourceUrl,
      sourceLastModified: geo.sourceLastModified,
      importedBy: 'geo:import',
      levelCounts: geo.levels,
      checksum,
      status: warnings.some((w) => w.includes('unresolved')) ? 'PARTIAL' : 'SUCCESS',
      warnings: warnings.length ? warnings : undefined,
    },
  });

  console.log(`\nDONE. BoundaryImportRun recorded (checksum ${checksum.slice(0, 12)}…).`);
  if (warnings.length) { console.log('Warnings:'); warnings.forEach((w) => console.log('  - ' + w)); }
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
