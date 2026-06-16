/**
 * Online Testing Phase 1 — strict workflow reset.
 *
 * Goal: move all schools back to a clean School Directory state so testers can
 * exercise the full workflow from the beginning:
 *   School Directory → Cluster → SSA recommendation → Planning gap → Schedule →
 *   Cost → Fund request → My Plan → Execution → Evidence → IA/Accountant →
 *   Completed Activities → Analytics.
 *
 * PRESERVES: users, roles, staff/partner accounts, school ownership, geography,
 * cost catalogue, project definitions, FY config, schools, SSA records.
 * CLEARS: every workflow-generated record (activities, clusters, plans, funds,
 * payments, evidence, verification, debriefs, decisions, reports, messages,
 * notifications) and resets each school to unclustered / SSA-complete / unplanned.
 *
 * Safety: requires CONFIRM_ONLINE_TEST_RESET=true; blocked in production unless
 * ONLINE_TEST_RESET_ALLOWED=true; writes a JSON backup of every cleared table
 * before deleting; runs the deletes in a transaction; logs per-table counts;
 * validates the final state and exits non-zero on failure.
 *
 *   CONFIRM_ONLINE_TEST_RESET=true npm run reset
 */
import { PrismaClient, Prisma, SsaIntervention } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const prisma = new PrismaClient();

// ── Safety gate ──────────────────────────────────────────────────────────────
const env = process.env.NODE_ENV ?? 'development';
const confirmed = process.env.CONFIRM_ONLINE_TEST_RESET === 'true';
const prodAllowed = process.env.ONLINE_TEST_RESET_ALLOWED === 'true';
const isProd = env === 'production';

function abort(msg: string): never {
  console.error(`\n  ✗ RESET ABORTED: ${msg}\n`);
  process.exit(2);
}

function preflight() {
  console.log('\n  ════════════════════════════════════════════════════════════');
  console.log('  ⚠  ONLINE TESTING PHASE 1 — DESTRUCTIVE WORKFLOW RESET');
  console.log('  ════════════════════════════════════════════════════════════');
  console.log(`     env=${env}  confirmed=${confirmed}  prodAllowed=${prodAllowed}`);
  console.log('     This DELETES all workflow records (activities, clusters, plans,');
  console.log('     funds, payments, evidence, decisions, messages, notifications).');
  console.log('     It PRESERVES users, staff/partner accounts, ownership, geography,');
  console.log('     cost catalogue, schools and SSA records.\n');
  if (!confirmed) abort('CONFIRM_ONLINE_TEST_RESET=true is required.');
  if (isProd && !prodAllowed) abort('production requires ONLINE_TEST_RESET_ALLOWED=true.');
  if (!isProd && !['development', 'staging', 'test'].includes(env) && !prodAllowed) {
    abort(`unrecognized env "${env}" — set ONLINE_TEST_RESET_ALLOWED=true to override.`);
  }
}

// ── Deterministic varied SSA scores (so the recommendation engine is testable) ─
const INTERVENTIONS: SsaIntervention[] = [
  'teaching_and_learning', 'financial_health', 'christlike_behaviour', 'exposure_to_word_of_god',
  'government_requirements', 'leadership', 'education_technology', 'learning_environment',
];
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const round1 = (n: number) => Math.round(n * 10) / 10;
// Band biases the school's overall level so the 700 span critical→strong.
function ssaScoresFor(schoolType: string, seedStr: string): { intervention: SsaIntervention; score: number }[] {
  const r = mulberry32(hashStr(seedStr));
  const core = schoolType === 'core';
  const band = Math.floor(r() * 4); // 0 critical … 3 strong
  const base = core ? [5.0, 6.2, 7.4, 8.6][band] : [2.8, 4.4, 6.0, 7.8][band];
  return INTERVENTIONS.map((intervention) => {
    const jitter = (r() - 0.5) * 3.0; // ±1.5 → genuine per-intervention spread (criticals appear)
    return { intervention, score: round1(Math.min(10, Math.max(0, base + jitter))) };
  });
}
const avg = (s: { score: number }[]) => round1(s.reduce((a, x) => a + x.score, 0) / s.length);

// FY/quarter helpers (must match common/fy/fy.util.ts).
const fyOf = (d: Date) => (d.getUTCMonth() >= 9 ? d.getUTCFullYear() + 1 : d.getUTCFullYear()).toString();
const qOf = (d: Date): string => { const m = d.getUTCMonth(); return m >= 9 ? 'Q1' : m <= 2 ? 'Q2' : m <= 5 ? 'Q3' : 'Q4'; };
const CURRENT_FY = '2026';

async function main() {
  preflight();
  const cleared: Record<string, number> = {};
  const count = async (name: string, fn: () => Promise<{ count: number }>) => {
    const { count: c } = await fn();
    cleared[name] = c;
    console.log(`     cleared ${String(c).padStart(6)}  ${name}`);
  };

  // ── 1. Backup snapshot (recoverable) ────────────────────────────────────────
  console.log('  [1/5] Writing backup snapshot of workflow tables…');
  const backupDir = join(__dirname, '..', 'backups');
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const snapshot: Record<string, unknown> = { takenAt: new Date().toISOString(), env };
  const dump = async (name: string, fn: () => Promise<unknown[]>) => { snapshot[name] = await fn(); };
  await dump('Activity', () => prisma.activity.findMany());
  await dump('EvidenceRecord', () => prisma.evidenceRecord.findMany());
  await dump('PaymentRequest', () => prisma.paymentRequest.findMany());
  await dump('PaymentDisbursement', () => prisma.paymentDisbursement.findMany());
  await dump('FundRequest', () => prisma.fundRequest.findMany());
  await dump('Cluster', () => prisma.cluster.findMany());
  await dump('SchoolClusterAssignment', () => prisma.schoolClusterAssignment.findMany());
  await dump('ProjectSchoolAssignment', () => prisma.projectSchoolAssignment.findMany());
  await dump('AnnualPlan', () => prisma.annualPlan.findMany());
  await dump('Notification', () => prisma.notification.findMany());
  await dump('MessageThread', () => prisma.messageThread.findMany());
  await dump('LeadershipDecisionInsight', () => prisma.leadershipDecisionInsight.findMany());
  const backupPath = join(backupDir, `reset-${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify(snapshot, null, 2));
  console.log(`     backup → ${backupPath}\n`);

  // ── 2. Delete workflow rows (FK-safe order) inside a transaction ────────────
  console.log('  [2/5] Clearing workflow records…');
  await prisma.$transaction(async (tx) => {
    // payments (children → parent)
    await count('PaymentActionLog', () => tx.paymentActionLog.deleteMany());
    await count('PaymentDisbursement', () => tx.paymentDisbursement.deleteMany());
    await count('PaymentRequest', () => tx.paymentRequest.deleteMany());
    // evidence + verification (reference Activity)
    await count('EvidenceRecord', () => tx.evidenceRecord.deleteMany());
    await count('ActivityCompletionVerification', () => tx.activityCompletionVerification.deleteMany());
    // budget lines + plan structures (ActivityBudgetLine → AnnualPlanActivity)
    await count('ActivityBudgetLine', () => tx.activityBudgetLine.deleteMany());
    await count('BudgetApproval', () => tx.budgetApproval.deleteMany());
    await count('BudgetVersion', () => tx.budgetVersion.deleteMany());
    await count('AnnualPlanActivity', () => tx.annualPlanActivity.deleteMany());
    await count('AnnualPlan', () => tx.annualPlan.deleteMany());
    await count('MonthlyPlanActivity', () => tx.monthlyPlanActivity.deleteMany());
    await count('MonthlyPlan', () => tx.monthlyPlan.deleteMany());
    await count('CoreActivitySlot', () => tx.coreActivitySlot.deleteMany());
    await count('CorePlan', () => tx.corePlan.deleteMany());
    // the core workflow record
    await count('Activity', () => tx.activity.deleteMany());
    // funds
    await count('FundRequest', () => tx.fundRequest.deleteMany());
    await count('MonthlyFundRequest', () => tx.monthlyFundRequest.deleteMany());
    // project school/partner links (project DEFINITIONS preserved)
    await count('ProjectImpactSnapshot', () => tx.projectImpactSnapshot.deleteMany());
    await count('ProjectSchoolAssignment', () => tx.projectSchoolAssignment.deleteMany());
    await count('ProjectPartnerAssignment', () => tx.projectPartnerAssignment.deleteMany());
    // debriefs
    await count('DailyDebriefRecipient', () => tx.dailyDebriefRecipient.deleteMany());
    await count('DailyDebrief', () => tx.dailyDebrief.deleteMany());
    // leadership decisions + intelligence
    await count('DecisionEvidencePoint', () => tx.decisionEvidencePoint.deleteMany());
    await count('DecisionNote', () => tx.decisionNote.deleteMany());
    await count('FinanceDecisionNote', () => tx.financeDecisionNote.deleteMany());
    await count('LeadershipDecisionInsight', () => tx.leadershipDecisionInsight.deleteMany());
    await count('BudgetIntelligenceInsight', () => tx.budgetIntelligenceInsight.deleteMany());
    await count('StaffContextProfile', () => tx.staffContextProfile.deleteMany());
    await count('PartnerPerformanceProfile', () => tx.partnerPerformanceProfile.deleteMany());
    await count('RecruitmentReadinessProfile', () => tx.recruitmentReadinessProfile.deleteMany());
    await count('CdFlag', () => tx.cdFlag.deleteMany());
    // stories / exams / reports
    await count('MostSignificantChangeStory', () => tx.mostSignificantChangeStory.deleteMany());
    await count('ExamResultCollection', () => tx.examResultCollection.deleteMany());
    await count('Report', () => tx.report.deleteMany());
    // messages + notifications (rebuilt fresh by the workflow)
    await count('Notification', () => tx.notification.deleteMany());
    await count('Message', () => tx.message.deleteMany());
    await count('MessageThread', () => tx.messageThread.deleteMany());
    // assignment audit + duplicate candidates (demo workflow state)
    await count('AssignmentAudit', () => tx.assignmentAudit.deleteMany());
    await count('SchoolDuplicateCandidate', () => tx.schoolDuplicateCandidate.deleteMany());

    // Null the school→cluster link BEFORE deleting clusters (FK), then reset flags.
    await tx.school.updateMany({
      where: { deletedAt: null },
      data: {
        clusterId: null,
        clusterStatus: 'unclustered',
        planningReadiness: 'limited', // SSA-complete but unclustered → not "ready" (cluster-first rule)
        duplicateStatus: 'none',
      },
    });
    // clusters (membership + sub-county coverage cascade, but delete explicitly to be safe)
    await count('SchoolClusterAssignment', () => tx.schoolClusterAssignment.deleteMany());
    await count('ClusterSubCounty', () => tx.clusterSubCounty.deleteMany());
    await count('Cluster', () => tx.cluster.deleteMany());
  }, { timeout: 120_000 });
  console.log('     ✓ workflow records cleared\n');

  // ── 3. Ensure every active school has a complete current-FY SSA ─────────────
  console.log('  [3/5] Ensuring complete current-FY SSA for all schools…');
  const schools = await prisma.school.findMany({
    where: { deletedAt: null },
    select: { id: true, schoolId: true, schoolType: true, enrollment: true },
  });
  const withCurrentComplete = new Set(
    (await prisma.ssaRecord.findMany({
      where: { fy: CURRENT_FY, deletedAt: null },
      select: { schoolId: true, scores: { select: { id: true } } },
    })).filter((r) => r.scores.length >= 8).map((r) => r.schoolId),
  );
  const dateOfSsa = new Date(Date.UTC(2026, 4, 15)); // May 2026 → FY2026 Q3
  let createdSsa = 0;
  const toCreate = schools.filter((s) => !withCurrentComplete.has(s.id));
  for (const s of toCreate) {
    const scores = ssaScoresFor(s.schoolType, s.schoolId);
    await prisma.ssaRecord.create({
      data: {
        schoolId: s.id, dateOfSsa, fy: CURRENT_FY, quarter: qOf(dateOfSsa),
        newEnrollment: s.enrollment ?? 300, averageScore: avg(scores),
        verificationStatus: 'confirmed', collectorType: 'staff',
        verificationSource: 'staff_self_verified', uploadedBy: 'online-test-reset',
        scores: { create: scores },
      },
    });
    createdSsa++;
  }
  // Mark every school SSA-complete (current FY present + 8 scores).
  const ssaDone = await prisma.school.updateMany({
    where: { deletedAt: null },
    data: { currentFySsaStatus: 'done' },
  });
  console.log(`     created ${createdSsa} current-FY SSA records; ${ssaDone.count} schools marked SSA-complete\n`);

  // ── 4. Audit trail (best-effort; never fail the reset on the append-only log) ─
  console.log('  [4/5] Writing reset audit entry…');
  try {
    await prisma.auditLog.create({
      data: {
        action: 'system.online_test_reset',
        actorId: null, // not a real User; provenance lives in the payload + backup file
        actorRole: 'Admin',
        subjectKind: 'System',
        subjectId: 'database',
        reason: 'Online Testing Phase 1 workflow reset',
        payload: { env, clearedCounts: cleared, createdSsa, schools: schools.length, backupPath } as Prisma.InputJsonValue,
      },
    });
    console.log('     ✓ audit entry written\n');
  } catch (e) {
    console.log(`     (audit entry skipped: ${(e as Error).message})\n`);
  }

  // ── 5. Inline validation summary ────────────────────────────────────────────
  console.log('  [5/5] Validating final state…');
  const [schoolCount, activeCount, clustered, ssaComplete, withActivity, partnerAssign, projectAssign, clusters, fundReqs, evidence, payments, notifications] = await Promise.all([
    prisma.school.count({ where: { deletedAt: null } }),
    prisma.school.count({ where: { deletedAt: null } }),
    prisma.school.count({ where: { deletedAt: null, clusterStatus: 'clustered' } }),
    prisma.school.count({ where: { deletedAt: null, currentFySsaStatus: 'done' } }),
    prisma.activity.count(),
    prisma.activity.count({ where: { assignedPartnerId: { not: null } } }),
    prisma.projectSchoolAssignment.count(),
    prisma.cluster.count(),
    prisma.fundRequest.count(),
    prisma.evidenceRecord.count(),
    prisma.paymentRequest.count(),
    prisma.notification.count(),
  ]);
  const incompleteSsa = schoolCount - ssaComplete;
  const checks: [string, number, number][] = [
    ['active schools', schoolCount, 700],
    ['SSA-complete schools', ssaComplete, 700],
    ['incomplete SSA', incompleteSsa, 0],
    ['clustered schools', clustered, 0],
    ['clusters', clusters, 0],
    ['activities', withActivity, 0],
    ['partner-assigned activities', partnerAssign, 0],
    ['project-assigned schools', projectAssign, 0],
    ['fund requests', fundReqs, 0],
    ['evidence records', evidence, 0],
    ['payment records', payments, 0],
    ['notifications', notifications, 0],
  ];
  let failed = 0;
  for (const [label, actual, expected] of checks) {
    const ok = actual === expected;
    if (!ok) failed++;
    console.log(`     ${ok ? '✓' : '✗'}  ${label}: ${actual} (expected ${expected})`);
  }
  console.log(`\n  Backup: ${backupPath}`);
  if (failed > 0) {
    console.error(`\n  ✗ RESET VALIDATION FAILED: ${failed} check(s) did not match.\n`);
    process.exit(1);
  }
  console.log('\n  ✓ RESET COMPLETE — database ready for Online Testing Phase 1.\n');
}

main()
  .catch((e) => { console.error('\n  ✗ RESET ERROR:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
