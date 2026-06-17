/**
 * geo:map-schools — resolve every school's geography to the official COD-AB
 * records via the deterministic matcher. PRESERVES the original uploaded text
 * (never overwrites it), sets the resolved official ids + sub-region, records a
 * match status + confidence, and routes low-confidence / unmatched rows to the
 * geography review queue (geographyMatchStatus). Idempotent + non-destructive.
 *
 * Run: npm run geo:map-schools
 */
import { PrismaService } from '../src/prisma/prisma.service';
import { normalizeUgandaAdminName, matchAdminName, type GeoCandidate } from '../src/common/geography/normalize';

const prisma = new PrismaService();

async function main() {
  // Official candidate sets.
  const districts = await prisma.district.findMany({ where: { source: 'COD-AB' }, select: { id: true, name: true, subRegionId: true } });
  const districtCands: GeoCandidate[] = districts.map((d) => ({ id: d.id, name: d.name, normalizedName: normalizeUgandaAdminName(d.name) }));
  const subRegionByDistrict = new Map(districts.map((d) => [d.id, d.subRegionId]));

  const subCounties = await prisma.subCounty.findMany({ where: { source: 'COD-AB' }, select: { id: true, name: true, districtId: true, countyId: true } });
  const scByDistrict = new Map<string, GeoCandidate[]>();
  const countyOfSc = new Map<string, string | null>();
  for (const s of subCounties) {
    const arr = scByDistrict.get(s.districtId) ?? [];
    arr.push({ id: s.id, name: s.name, normalizedName: normalizeUgandaAdminName(s.name) });
    scByDistrict.set(s.districtId, arr);
    countyOfSc.set(s.id, s.countyId);
  }

  // District aliases (normalizedAlias → districtId).
  const aliasRows = await prisma.geographyAlias.findMany({ where: { adminLevel: 'district' } });
  const districtAliases = new Map(aliasRows.map((a) => [a.normalizedAlias, a.adminId]));

  const schools = await prisma.school.findMany({
    select: { id: true, districtId: true, subCountyId: true, uploadedDistrictText: true, uploadedSubCountyText: true,
              district: { select: { name: true } }, subCounty: { select: { name: true } } },
  });

  const tally: Record<string, number> = { EXACT: 0, ALIAS: 0, FUZZY_HIGH: 0, FUZZY_LOW_REVIEW_REQUIRED: 0, UNMATCHED: 0 };
  let reviewQueue = 0;

  for (const s of schools) {
    // The "uploaded" district text is preserved; seed schools carry their seed
    // district name as the uploaded proxy on first run.
    const uploadedDistrict = s.uploadedDistrictText ?? s.district?.name ?? null;
    const uploadedSc = s.uploadedSubCountyText ?? s.subCounty?.name ?? null;

    const dMatch = matchAdminName(uploadedDistrict, districtCands, districtAliases);
    const warnings: string[] = [...dMatch.warnings];
    const data: Record<string, unknown> = {
      uploadedDistrictText: uploadedDistrict,
      uploadedSubCountyText: uploadedSc,
      geographyMatchStatus: dMatch.status,
      geographyMatchConfidence: dMatch.confidence,
    };

    if (dMatch.matchedId) {
      data.districtId = dMatch.matchedId;
      data.subRegionId = subRegionByDistrict.get(dMatch.matchedId) ?? null;
      // Sub-county only WITHIN the matched district.
      if (uploadedSc) {
        const scMatch = matchAdminName(uploadedSc, scByDistrict.get(dMatch.matchedId) ?? []);
        warnings.push(...scMatch.warnings);
        if (scMatch.matchedId) {
          data.subCountyId = scMatch.matchedId;
          data.countyId = countyOfSc.get(scMatch.matchedId) ?? null;
          // The overall status is the weaker of district/sub-county confidence.
          if (scMatch.status === 'FUZZY_LOW_REVIEW_REQUIRED' || scMatch.status === 'UNMATCHED') {
            data.geographyMatchStatus = 'FUZZY_LOW_REVIEW_REQUIRED';
          }
        } else {
          data.geographyMatchStatus = 'FUZZY_LOW_REVIEW_REQUIRED';
        }
      }
    }

    const status = data.geographyMatchStatus as string;
    tally[status] = (tally[status] ?? 0) + 1;
    if (status === 'FUZZY_LOW_REVIEW_REQUIRED' || status === 'UNMATCHED') reviewQueue++;
    if (warnings.length) data.geographyMatchWarnings = warnings;

    await prisma.school.update({ where: { id: s.id }, data });
  }

  console.log(`Mapped ${schools.length} schools to official geography:`);
  for (const [k, v] of Object.entries(tally)) if (v) console.log(`  ${k}: ${v}`);
  console.log(`  → geography review queue: ${reviewQueue}`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
