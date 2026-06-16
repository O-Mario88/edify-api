/**
 * Online Testing Phase 1 — readiness validation.
 *
 * Asserts the database is in the clean state required for Phase 1 testing.
 * Exits non-zero on any failure so it can gate CI / a pre-test check.
 *
 *   npm run validate
 */
import { PrismaClient, SsaIntervention } from '@prisma/client';

const prisma = new PrismaClient();
const CURRENT_FY = '2026';

type Check = { label: string; actual: number | string | boolean; expected: number | string | boolean; ok: boolean };

async function main() {
  const checks: Check[] = [];
  const assert = (label: string, actual: number | string | boolean, expected: number | string | boolean) =>
    checks.push({ label, actual, expected, ok: actual === expected });

  // ── Counts ──────────────────────────────────────────────────────────────────
  const active = await prisma.school.count({ where: { deletedAt: null } });
  assert('active schools = 700', active, 700);

  // current-FY complete SSA (8 scores) per school
  const currentSsa = await prisma.ssaRecord.findMany({
    where: { fy: CURRENT_FY, deletedAt: null },
    select: { schoolId: true, scores: { select: { intervention: true } } },
  });
  const completeBySchool = new Set(currentSsa.filter((r) => new Set(r.scores.map((s) => s.intervention)).size >= 8).map((r) => r.schoolId));
  assert('schools with complete current-FY SSA = 700', completeBySchool.size, 700);
  assert('schools flagged SSA-complete = 700', await prisma.school.count({ where: { deletedAt: null, currentFySsaStatus: 'done' } }), 700);
  assert('schools with incomplete/missing SSA flag = 0', await prisma.school.count({ where: { deletedAt: null, currentFySsaStatus: { not: 'done' } } }), 0);

  assert('clustered schools = 0', await prisma.school.count({ where: { deletedAt: null, clusterStatus: 'clustered' } }), 0);
  assert('schools with a clusterId = 0', await prisma.school.count({ where: { deletedAt: null, clusterId: { not: null } } }), 0);
  assert('clusters = 0', await prisma.cluster.count(), 0);
  assert('project-assigned schools = 0', await prisma.projectSchoolAssignment.count(), 0);
  assert('activities (planned/scheduled/completed) = 0', await prisma.activity.count(), 0);
  assert('partner-assigned activities = 0', await prisma.activity.count({ where: { assignedPartnerId: { not: null } } }), 0);
  assert('annual plans = 0', await prisma.annualPlan.count(), 0);
  assert('monthly plans = 0', await prisma.monthlyPlan.count(), 0);
  assert('fund requests = 0', await prisma.fundRequest.count(), 0);
  assert('budget lines = 0', await prisma.activityBudgetLine.count(), 0);
  assert('evidence records = 0', await prisma.evidenceRecord.count(), 0);
  assert('IA verification records = 0', await prisma.activityCompletionVerification.count(), 0);
  assert('payment requests = 0', await prisma.paymentRequest.count(), 0);
  assert('payment disbursements = 0', await prisma.paymentDisbursement.count(), 0);
  assert('daily debriefs = 0', await prisma.dailyDebrief.count(), 0);
  assert('notifications = 0', await prisma.notification.count(), 0);
  assert('message threads = 0', await prisma.messageThread.count(), 0);

  // ── Preserved records still present ─────────────────────────────────────────
  assert('users preserved (> 0)', (await prisma.user.count()) > 0, true);
  assert('staff profiles preserved (> 0)', (await prisma.staffProfile.count()) > 0, true);
  assert('school ownership preserved (owners assigned > 0)', (await prisma.school.count({ where: { deletedAt: null, accountOwnerId: { not: null } } })) > 0, true);
  assert('cost catalogue preserved (> 0)', (await prisma.costSetting.count()) > 0, true);
  assert('partners preserved (> 0)', (await prisma.partner.count()) > 0, true);
  assert('geography preserved (districts > 0)', (await prisma.district.count()) > 0, true);
  assert('project definitions preserved (> 0)', (await prisma.project.count()) > 0, true);
  assert('previous-FY SSA preserved (> 0)', (await prisma.ssaRecord.count({ where: { fy: { not: CURRENT_FY } } })) > 0, true);

  // ── SSA recommendation testability — two weakest interventions computable ────
  const sample = await prisma.school.findMany({
    where: { deletedAt: null }, take: 5,
    select: { schoolId: true, name: true, schoolType: true },
  });
  let weakestOk = 0;
  for (const s of sample) {
    const rec = await prisma.ssaRecord.findFirst({
      where: { school: { schoolId: s.schoolId }, fy: CURRENT_FY, deletedAt: null },
      orderBy: { dateOfSsa: 'desc' },
      select: { scores: { select: { intervention: true, score: true } } },
    });
    if (rec && rec.scores.length >= 8) {
      const weakest = [...rec.scores].sort((a, b) => a.score - b.score).slice(0, 2);
      if (weakest.length === 2 && weakest[0].score <= weakest[1].score) weakestOk++;
    }
  }
  assert('two-weakest interventions computable on sampled schools', weakestOk, sample.length);

  // ── Distribution / variety (not all identical) ──────────────────────────────
  const regions = await prisma.school.groupBy({ by: ['regionId'], where: { deletedAt: null }, _count: true });
  assert('schools span multiple regions (>= 2)', regions.length >= 2, true);
  const districts = await prisma.school.groupBy({ by: ['districtId'], where: { deletedAt: null }, _count: true });
  assert('schools span multiple districts (>= 5)', districts.length >= 5, true);
  // Every school must have an active account owner (role-scoped testing depends
  // on it). The roster may legitimately be a single CCEO, so we assert coverage
  // (all schools owned by an ACTIVE user), not a multi-owner spread.
  const owned = await prisma.school.count({ where: { deletedAt: null, accountOwnerId: { not: null } } });
  const activeOwned = await prisma.school.count({ where: { deletedAt: null, accountOwner: { user: { isActive: true } } } });
  assert('every school has an account owner', owned, active);
  assert('every school owner is an active user', activeOwned, active);
  const types = await prisma.school.groupBy({ by: ['schoolType'], where: { deletedAt: null }, _count: true });
  assert('schools include both Client and Core types', types.length >= 2, true);

  // SSA variety: distinct average scores across schools (engine must distinguish struggling/strong)
  const avgs = await prisma.ssaRecord.findMany({ where: { fy: CURRENT_FY, deletedAt: null }, select: { averageScore: true } });
  const distinctAvgs = new Set(avgs.map((a) => Math.round((a.averageScore ?? 0))));
  const hasCritical = avgs.some((a) => (a.averageScore ?? 10) < 5);
  const hasStrong = avgs.some((a) => (a.averageScore ?? 0) >= 8);
  assert('SSA averages are varied (>= 4 distinct bands)', distinctAvgs.size >= 4, true);
  assert('SSA includes a critical (< 5) example', hasCritical, true);
  assert('SSA includes a strong (>= 8) example', hasStrong, true);

  // ── Report ──────────────────────────────────────────────────────────────────
  console.log('\n  Online Testing Phase 1 — Validation');
  console.log('  ───────────────────────────────────');
  let failed = 0;
  for (const c of checks) {
    if (!c.ok) failed++;
    console.log(`  ${c.ok ? '✓' : '✗'}  ${c.label}  →  ${c.actual}${c.ok ? '' : `  (expected ${c.expected})`}`);
  }
  console.log(`\n  ${checks.length - failed}/${checks.length} checks passed.`);
  if (failed > 0) {
    console.error(`\n  ✗ NOT READY: ${failed} check(s) failed.\n`);
    process.exit(1);
  }
  console.log('\n  ✓ READY for Online Testing Phase 1.\n');
}

main()
  .catch((e) => { console.error('\n  ✗ VALIDATION ERROR:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
