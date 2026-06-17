/**
 * geo:verify — validate the official geography backbone. Exits non-zero on any
 * structural failure. Checks the levels imported, parent-child integrity, the
 * Lango sub-region mapping, pcode uniqueness, and that no school points at an
 * invalid district/sub-county combination.
 *
 * Run: npm run geo:verify
 */
import { PrismaService } from '../src/prisma/prisma.service';

const prisma = new PrismaService();
const LANGO = ['Lira', 'Apac', 'Oyam', 'Dokolo', 'Kole', 'Alebtong', 'Otuke', 'Kwania'];

async function main() {
  const fails: string[] = [];
  const ok = (c: boolean, msg: string) => { console.log(`  ${c ? '✓' : '✗'} ${msg}`); if (!c) fails.push(msg); };

  console.log('Geography backbone verification:');

  const [regions, districts, counties, subCounties, parishes] = await Promise.all([
    prisma.region.count(), prisma.district.count(), prisma.county.count(),
    prisma.subCounty.count(), prisma.parish.count(),
  ]);
  ok(regions === 4, `regions = ${regions} (expected 4)`);
  ok(districts === 135, `districts = ${districts} (expected 135 COD-AB)`);
  ok(counties > 0, `counties imported = ${counties}`);
  ok(subCounties > 0, `sub-counties present = ${subCounties}`);

  const districtsWithPcode = await prisma.district.count({ where: { pcode: { not: null }, source: 'COD-AB' } });
  ok(districtsWithPcode === 135, `districts with COD-AB pcode = ${districtsWithPcode}`);

  // Parent-child integrity: every district's region resolves; every county's
  // district resolves; every official sub-county's county (where set) resolves.
  const badDistrictRegion = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `select count(*) n from "District" d left join "Region" r on r.id = d."regionId" where r.id is null`,
  );
  ok(Number(badDistrictRegion[0].n) === 0, `districts whose region resolves (${districts - Number(badDistrictRegion[0].n)}/${districts})`);
  const badCountyDistrict = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `select count(*) n from "County" c left join "District" d on d.id = c."districtId" where d.id is null`,
  );
  ok(Number(badCountyDistrict[0].n) === 0, `counties whose district resolves (${counties - Number(badCountyDistrict[0].n)}/${counties})`);
  const badScCounty = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `select count(*) n from "SubCounty" s where s."countyId" is not null and not exists (select 1 from "County" c where c.id = s."countyId")`,
  );
  ok(Number(badScCounty[0].n) === 0, `sub-counties whose county (where set) resolves`);

  // Sub-region: Lango exists, VERIFIED, with all required districts.
  const lango = await prisma.subRegion.findUnique({ where: { name: 'Lango' }, include: { districts: true } });
  ok(!!lango, 'Lango sub-region exists');
  ok(lango?.confidence === 'VERIFIED', `Lango confidence = ${lango?.confidence}`);
  const langoNames = new Set((lango?.districts ?? []).map((d) => d.name));
  const missingLango = LANGO.filter((n) => !langoNames.has(n));
  ok(missingLango.length === 0, `Lango districts present (${langoNames.size}/${LANGO.length})${missingLango.length ? ' missing: ' + missingLango.join(', ') : ''}`);

  // No duplicate district pcodes.
  const dupPcodes = await prisma.$queryRawUnsafe<{ pcode: string; n: bigint }[]>(
    `select pcode, count(*) n from "District" where pcode is not null group by pcode having count(*) > 1`,
  );
  ok(dupPcodes.length === 0, `duplicate district pcodes = ${dupPcodes.length}`);

  // No school points at a sub-county outside its district.
  const badSchoolGeo = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `select count(*) n from "School" s join "SubCounty" sc on sc.id = s."subCountyId"
     where s."subCountyId" is not null and sc."districtId" <> s."districtId"`,
  );
  ok(Number(badSchoolGeo[0].n) === 0, `schools with sub-county outside their district = ${badSchoolGeo[0].n}`);

  // An import was recorded.
  const lastImport = await prisma.boundaryImportRun.findFirst({ orderBy: { importedAt: 'desc' } });
  ok(!!lastImport, `boundary import recorded (status ${lastImport?.status})`);

  console.log(parishes === 0
    ? '  ℹ parishes = 0 (none in COD-AB — correct; awaiting an official parish source)'
    : `  ℹ parishes = ${parishes} (pre-existing seed fixtures — not from COD-AB)`);

  await prisma.$disconnect();
  if (fails.length) { console.error(`\nFAILED: ${fails.length} check(s).`); process.exit(1); }
  console.log('\nAll geography checks passed.');
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
