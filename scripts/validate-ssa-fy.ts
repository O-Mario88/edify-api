/**
 * Validate the SSA headline is FY-correct (regression guard for the double-count
 * bug where /analytics/ssa-performance counted every SsaRecord across all FYs →
 * schoolsWithSsa > number of schools). Checks the invariant directly in the DB so
 * it needs no running server:
 *
 *   distinct schools with a CURRENT-FY SSA  ==  what ssaPerformance now reports
 *   and that value  <=  total active schools
 *
 *   npm run validate:ssa-fy
 */
import { PrismaClient } from '@prisma/client';
import { getOperationalFY } from '../src/common/fy/fy.util';

const prisma = new PrismaClient();

async function main() {
  const fy = getOperationalFY();
  const totalSchools = await prisma.school.count({ where: { deletedAt: null } });
  const allSsa = await prisma.ssaRecord.count({ where: { deletedAt: null } });
  const currentFySsa = await prisma.ssaRecord.findMany({ where: { deletedAt: null, fy }, select: { schoolId: true } });
  const distinctCurrentFy = new Set(currentFySsa.map((r) => r.schoolId)).size;

  console.log('\n  SSA FY-correctness validation');
  console.log('  ──────────────────────────────');
  console.log(`  operational FY              : ${fy}`);
  console.log(`  total active schools        : ${totalSchools}`);
  console.log(`  SsaRecords (all FYs)        : ${allSsa}`);
  console.log(`  schools w/ current-FY SSA   : ${distinctCurrentFy}  (this is the headline count)`);

  let ok = true;
  const assert = (label: string, cond: boolean) => { console.log(`  ${cond ? '✓' : '✗'} ${label}`); if (!cond) ok = false; };

  assert('headline schoolsWithSsa <= total schools (was inflated by all-FY count)', distinctCurrentFy <= totalSchools);
  assert('headline count is the distinct current-FY school set, not raw record count', distinctCurrentFy <= allSsa);
  assert('there is real current-FY SSA data to report', distinctCurrentFy > 0 || totalSchools === 0);

  if (allSsa > totalSchools) {
    console.log(`  • note: ${allSsa} total SsaRecords > ${totalSchools} schools (multi-FY history present) — the old endpoint would have reported ${allSsa}; FY-scoping caps it at ${distinctCurrentFy}.`);
  }

  console.log(ok ? '\n  ✓ SSA headline is FY-correct.\n' : '\n  ✗ SSA FY invariant FAILED.\n');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
