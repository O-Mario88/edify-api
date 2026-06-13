/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────
// CLEAN SCHOOL-DIRECTORY TEST SEED  (npm run seed:school-directory-test)
// ─────────────────────────────────────────────────────────────────────────
//
// This is NOT the demo-decoration seed (prisma/seed.ts). Its purpose is
// WORKFLOW TRUTH TESTING: start from a clean School Directory + minimal SSA
// readiness, then let a tester drive the REAL workflow forward (create
// clusters → assign schools → plan activities → cost them → request funds →
// execute → verify → pay). Nothing downstream is faked.
//
// What it creates:
//   • Reference: RBAC permission matrix + Uganda regions/districts/sub-counties.
//   • 6 test users (CCEO, PL, IA, CD, Accountant, + optional Partner) and an
//     Admin support login. Password: "edify".
//   • Exactly 200 schools (all Client, all UNCLUSTERED):
//       – 100 owned by Test CCEO, 100 owned by Test PL (owner uploaded WITH the
//         school — no separate owner-assignment workflow).
//       – 190 with a complete current-FY SSA (8 interventions, two intentionally
//         weak so the recommendation engine has something to recommend).
//       – 10 with NO SSA, split 5 under the CCEO and 5 under the PL.
//   • CD-approved cost catalogue (configuration, needed for later costing tests).
//
// What it does NOT create (must come from real workflow actions in the app):
//   activities, plans, schedules, budgets, fund requests, partner assignments,
//   evidence, Salesforce IDs, IA verifications, payments, accountability,
//   debriefs, completed logs, projects, MSC stories, exam results, or
//   hand-written notifications/messages.
//
// Safety: blocked in production; requires CONFIRM_SEED=true.
//   CONFIRM_SEED=true npm run seed:school-directory-test
//
// Idempotent: a full purge runs first, so re-running yields identical state.
//
// SCHEMA NOTES (where the product spec and the Prisma schema diverge):
//   • The spec's 8th SSA intervention "Enrollment" has no enum member; the
//     schema's eighth is `education_technology`. We seed the schema's real 8
//     enum values (the backend recommendation service reads those). The other
//     seven map cleanly: Christ-like Behaviour→christlike_behaviour, Exposure
//     to the Word of God→exposure_to_word_of_god, Leadership Best
//     Practice→leadership, Teaching Environment→teaching_and_learning, Learning
//     Environment→learning_environment, Government
//     Requirements→government_requirements, Fees/Budget/Accounts→financial_health.
//   • SsaCollectorType has no `school_during_sit`; staff-collected SSA is the
//     auto-verified path, so seeded SSA uses collectorType `staff`.
//   • CostSetting has no approvedByRole/isActive/effectiveFrom/currency columns;
//     CD provenance is recorded via createdBy + fy. Amounts are UGX by product
//     convention.

import {
  PrismaClient,
  EdifyRole,
  SchoolType,
  SsaStatus,
  ClusterStatus,
  PlanningReadiness,
  SsaIntervention,
  VerificationStatus,
  SsaCollectorType,
  AccountOwnerStatus,
  Prisma,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { ROLE_PERMISSIONS } from '../src/common/rbac/permissions';

const prisma = new PrismaClient();

const IS_PROD = process.env.NODE_ENV === 'production';
const CONFIRMED = (process.env.CONFIRM_SEED ?? '').toLowerCase() === 'true';

// ── Deterministic PRNG (so scores/names are reproducible run-to-run) ──
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260610);
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
const chunk = <T>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

// ── Geography (reference config) ──────────────────────────────────────
const GEOGRAPHY: Record<string, string[]> = {
  Northern: ['Gulu', 'Lira', 'Kitgum', 'Pader'],
  Eastern: ['Soroti', 'Mbale', 'Tororo'],
  Central: ['Kampala', 'Wakiso', 'Mukono', 'Kira'],
  Western: ['Mbarara', 'Kabale', 'Fort Portal'],
};
const SUBCOUNTY_SUFFIXES = ['Central', 'North', 'South', 'East'];

const NAME_A = ['Bright', 'Hope', 'Grace', 'Faith', 'Sunrise', 'Riverside', 'Unity', 'Victory', 'Mustard Seed', 'Cornerstone', 'New Life', 'Pioneer', 'Excel', 'Trinity', 'Bethel', 'St. Mary', 'St. John', 'Canaan', 'Greenhill', 'Kings', 'Light', 'Harvest', 'Rock', 'Living Water'];
const NAME_B = ['Primary School', 'Junior School', 'Academy', 'Community School', 'Christian School', 'Preparatory School', 'Parents School'];
const CONTACTS = ['Rev. Samuel Okello', 'Mrs. Grace Auma', 'Mr. Peter Wanyama', 'Ms. Sarah Nakato', 'Pr. John Tabu', 'Mrs. Ruth Adong', 'Mr. Moses Kato', 'Ms. Esther Lamwaka'];

// ── SSA: the schema's real 8 interventions + the 4 rotated weak-pairs ──
const INTERVENTIONS: SsaIntervention[] = [
  'teaching_and_learning',
  'financial_health',
  'christlike_behaviour',
  'exposure_to_word_of_god',
  'government_requirements',
  'leadership',
  'education_technology',
  'learning_environment',
];
const WEAK_PAIRS: [SsaIntervention, SsaIntervention][] = [
  ['teaching_and_learning', 'learning_environment'],
  ['financial_health', 'education_technology'],
  ['christlike_behaviour', 'exposure_to_word_of_god'],
  ['leadership', 'government_requirements'],
];

function ssaScoresWithWeakPair(pair: [SsaIntervention, SsaIntervention]) {
  const weak = new Set<SsaIntervention>(pair);
  return INTERVENTIONS.map((intervention) => {
    const score = weak.has(intervention)
      ? Math.round((2.5 + rnd() * 2.0) * 10) / 10 // 2.5–4.5 → the two weakest
      : Math.round((6.5 + rnd() * 2.5) * 10) / 10; // 6.5–9.0 → solid
    return { intervention, score };
  });
}
const avg = (s: { score: number }[]) =>
  Math.round((s.reduce((a, x) => a + x.score, 0) / s.length) * 10) / 10;

// ── Scale ─────────────────────────────────────────────────────────────
const TOTAL_SCHOOLS = 200;
const CCEO_SCHOOLS = 100;
const PL_SCHOOLS = 100;
const MISSING_SSA_TOTAL = 10; // 5 under CCEO + 5 under PL

// ── Comprehensive purge (child → parent, FK-safe). Wipes ALL domain,
//    workflow, directory, staff, and user rows so a re-run is deterministic.
//    Keeps NOTHING but is followed immediately by reference + fixture seeding.
async function purgeEverything() {
  // Payments / verification / evidence
  await prisma.paymentDisbursement.deleteMany();
  await prisma.paymentActionLog.deleteMany();
  await prisma.paymentRequest.deleteMany();
  await prisma.activityCompletionVerification.deleteMany();
  await prisma.evidenceRecord.deleteMany();
  // Budgets / plans / fund requests
  await prisma.activityBudgetLine.deleteMany();
  await prisma.annualPlanActivity.deleteMany();
  await prisma.budgetApproval.deleteMany();
  await prisma.budgetVersion.deleteMany();
  await prisma.monthlyFundRequest.deleteMany();
  await prisma.fundRequest.deleteMany();
  await prisma.annualPlan.deleteMany();
  // Debriefs
  await prisma.dailyDebriefRecipient.deleteMany();
  await prisma.dailyDebrief.deleteMany();
  // Impact / exams / stories
  await prisma.mostSignificantChangeStory.deleteMany();
  await prisma.examResultCollection.deleteMany();
  // Projects
  await prisma.projectImpactSnapshot.deleteMany();
  await prisma.projectPartnerAssignment.deleteMany();
  await prisma.projectSchoolAssignment.deleteMany();
  // Activities (after everything that references them)
  await prisma.activity.deleteMany();
  await prisma.project.deleteMany();
  // SSA
  await prisma.ssaScore.deleteMany();
  await prisma.ssaRecord.deleteMany();
  // School-linked
  await prisma.schoolEnrollmentHistory.deleteMany();
  await prisma.schoolClusterAssignment.deleteMany();
  await prisma.schoolDuplicateCandidate.deleteMany();
  await prisma.schoolAccountOwnerUploadMap.deleteMany();
  // Comms
  await prisma.message.deleteMany();
  await prisma.messageThread.deleteMany();
  await prisma.notification.deleteMany();
  // Staff linkage + targets + capacity + audit
  await prisma.assignmentAudit.deleteMany();
  await prisma.staffSchoolAssignment.deleteMany();
  await prisma.staffSupervisorAssignment.deleteMany();
  await prisma.staffGeographyAssignment.deleteMany();
  await prisma.staffSupportCapacity.deleteMany();
  await prisma.staffTargetProfile.deleteMany();
  await prisma.targetSetting.deleteMany();
  // Directory + clusters
  await prisma.school.deleteMany();
  await prisma.cluster.deleteMany();
  await prisma.uploadBatch.deleteMany();
  // Config + partners
  await prisma.costSetting.deleteMany();
  await prisma.partner.deleteMany();
  // Staff profiles, then users (after notifications/messages/audit are gone)
  await prisma.staffProfile.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();
  console.log('✓ purged all workflow + directory + staff + user rows');
}

// ── Reference: RBAC matrix + geography (always upserted) ──────────────
async function seedReference() {
  const keys = new Set<string>();
  for (const p of Object.values(ROLE_PERMISSIONS)) p.forEach((k) => keys.add(k));
  for (const key of keys) {
    await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
  }
  for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
    for (const key of perms) {
      const perm = await prisma.permission.findUniqueOrThrow({ where: { key } });
      await prisma.rolePermission.upsert({
        where: { role_permissionId: { role: role as EdifyRole, permissionId: perm.id } },
        update: {},
        create: { role: role as EdifyRole, permissionId: perm.id },
      });
    }
  }
  for (const [regionName, districts] of Object.entries(GEOGRAPHY)) {
    const region = await prisma.region.upsert({ where: { name: regionName }, update: {}, create: { name: regionName } });
    for (const d of districts) {
      await prisma.district.upsert({
        where: { regionId_name: { regionId: region.id, name: d } },
        update: {},
        create: { name: d, regionId: region.id },
      });
    }
  }
  console.log(`✓ reference: ${keys.size} permissions, ${Object.keys(GEOGRAPHY).length} regions, ${Object.values(GEOGRAPHY).flat().length} districts`);
}

async function main() {
  if (IS_PROD) {
    console.error('✗ NODE_ENV=production — this seed is for development/staging only. Aborting.');
    process.exit(1);
  }
  if (!CONFIRMED) {
    console.error('✗ Refusing to run without confirmation. This PURGES all data.');
    console.error('  Re-run with:  CONFIRM_SEED=true npm run seed:school-directory-test');
    process.exit(1);
  }

  console.log('— Clean School-Directory test seed —');
  await purgeEverything();
  await seedReference();

  const hash = await bcrypt.hash('edify', 10);
  const districts = await prisma.district.findMany({ include: { region: true } });

  // Sub-counties — 4 seeded fixtures per district.
  const subCounties: { id: string; name: string; districtId: string; regionId: string; districtName: string }[] = [];
  for (const d of districts) {
    for (const suffix of SUBCOUNTY_SUFFIXES) {
      const name = `${d.name} ${suffix}`;
      const sc = await prisma.subCounty.upsert({
        where: { districtId_name: { districtId: d.id, name } },
        update: { seeded: true },
        create: { name, districtId: d.id, seeded: true },
      });
      subCounties.push({ id: sc.id, name, districtId: d.id, regionId: d.regionId, districtName: d.name });
    }
  }

  // ── Users ───────────────────────────────────────────────────────────
  const mkUser = (email: string, name: string, role: EdifyRole) =>
    prisma.user.create({ data: { email, name, passwordHash: hash, roles: [role], activeRole: role } });

  const admin = await mkUser('admin@edify.org', 'Edify Admin', 'Admin');
  const cd = await mkUser('test.cd@edify.org', 'Test CD', 'CountryDirector');
  const ia = await mkUser('test.ia@edify.org', 'Test IA', 'ImpactAssessment');
  const accountant = await mkUser('test.accountant@edify.org', 'Test Accountant', 'ProgramAccountant');
  const plUser = await mkUser('test.pl@edify.org', 'Test Program Leader', 'CountryProgramLead');
  const cceoUser = await mkUser('test.cceo@edify.org', 'Test CCEO', 'CCEO');
  // Optional partner identity — master record only, NO work assigned.
  const partnerUser = await mkUser('test.partner@edify.org', 'Test Partner', 'PartnerAdmin');
  await prisma.partner.create({ data: { name: 'Test Partner Organisation', regionName: 'Central', trainsOn: ['Teacher Coaching'] } });

  // Staff profiles for the two owners (CCEO + PL) and the supervision link.
  const plProfile = await prisma.staffProfile.create({ data: { userId: plUser.id, onboardingState: 'active', primaryDistrictId: districts[0].id } });
  const cceoProfile = await prisma.staffProfile.create({ data: { userId: cceoUser.id, onboardingState: 'active', primaryDistrictId: districts[0].id } });
  await prisma.staffSupervisorAssignment.create({ data: { superviseeId: cceoProfile.id, supervisorId: plProfile.id } });
  void admin; void cd; void ia; void accountant; void partnerUser;

  // ── 200 schools (all Client, all UNCLUSTERED) ─────────────────────────
  // Ownership: first 100 → CCEO, next 100 → PL.
  // Missing SSA: schools at index 0–4 (CCEO) and 100–104 (PL) → 5 + 5.
  type Row = Prisma.SchoolCreateManyInput & { _ssaWeakPair?: [SsaIntervention, SsaIntervention] };
  const rows: Row[] = [];
  for (let i = 0; i < TOTAL_SCHOOLS; i++) {
    const onCceo = i < CCEO_SCHOOLS;
    const owner = onCceo ? cceoProfile : plProfile;
    const ownerName = onCceo ? 'Test CCEO' : 'Test Program Leader';
    const localIdx = onCceo ? i : i - CCEO_SCHOOLS;
    const missingSsa = localIdx < MISSING_SSA_TOTAL / 2; // first 5 of each owner
    const sc = subCounties[i % subCounties.length];
    const enrollment = 120 + Math.floor(rnd() * 680);
    const weakPair = WEAK_PAIRS[i % WEAK_PAIRS.length];

    rows.push({
      schoolId: String(70000 + i),
      name: `${pick(NAME_A)} ${pick(NAME_B)}`,
      regionId: sc.regionId,
      districtId: sc.districtId,
      subCountyId: sc.id,
      shippingAddress: `P.O. Box ${100 + i}, ${sc.districtName}`,
      schoolPhone: `+25670${String(3000000 + i).slice(-7)}`,
      primaryContactName: pick(CONTACTS),
      primaryContactPhone: `+25677${String(4000000 + i).slice(-7)}`,
      enrollment,
      schoolType: SchoolType.client,
      accountOwnerId: owner.id,
      accountOwnerNameRaw: ownerName,
      accountOwnerStatus: AccountOwnerStatus.matched,
      clusterId: null,
      clusterStatus: ClusterStatus.unclustered,
      currentFySsaStatus: missingSsa ? SsaStatus.not_done : SsaStatus.done,
      // No SSA → locked (Schedule SSA/SIT). SSA done but unclustered → limited
      // (SSA complete, cluster required). Nothing is `ready` until clustered.
      planningReadiness: missingSsa ? PlanningReadiness.locked : PlanningReadiness.limited,
      createdByIa: true,
      _ssaWeakPair: missingSsa ? undefined : weakPair,
    });
  }

  await prisma.school.createMany({ data: rows.map(({ _ssaWeakPair, ...s }) => s) });
  const dbSchools = await prisma.school.findMany({ select: { id: true, schoolId: true, enrollment: true } });
  const byExt = new Map(dbSchools.map((s) => [s.schoolId, s]));

  // Portfolio assignments (owner uploaded WITH the school).
  await Promise.all(
    chunk(
      rows.map((r) => ({ staffId: r.accountOwnerId!, schoolId: byExt.get(r.schoolId)!.id })),
      500,
    ).map((c) => prisma.staffSchoolAssignment.createMany({ data: c, skipDuplicates: true })),
  );

  // ── SSA records for the 190 schools that have one ────────────────────
  let ssaCount = 0;
  const ssaJobs: (() => Promise<unknown>)[] = [];
  for (const r of rows) {
    if (!r._ssaWeakPair) continue;
    const school = byExt.get(r.schoolId)!;
    const scores = ssaScoresWithWeakPair(r._ssaWeakPair);
    ssaJobs.push(() =>
      prisma.ssaRecord.create({
        data: {
          schoolId: school.id,
          dateOfSsa: new Date(Date.UTC(2025, 9, 1 + (Number(r.schoolId) % 80))),
          fy: '2026',
          quarter: 'Q1',
          newEnrollment: school.enrollment,
          averageScore: avg(scores),
          uploadedBy: ia.id,
          collectorType: SsaCollectorType.staff,
          verificationSource: 'staff_self_verified',
          collectedByUserId: cceoUser.id,
          verificationStatus: VerificationStatus.confirmed,
          verifiedByUserId: ia.id,
          verifiedAt: new Date(),
          scores: { create: scores },
        },
      }),
    );
    ssaCount++;
  }
  for (const c of chunk(ssaJobs, 40)) await Promise.all(c.map((fn) => fn()));

  // ── CD-approved cost catalogue (configuration for later costing tests) ─
  const COSTS: { key: string; label: string; unitCost: number }[] = [
    { key: 'staff_visit_transport_primary', label: 'Staff visit transport (primary district)', unitCost: 50000 },
    { key: 'staff_visit_transport_secondary', label: 'Staff visit transport (secondary district)', unitCost: 30000 },
    { key: 'breakfast', label: 'Breakfast', unitCost: 8000 },
    { key: 'lunch', label: 'Lunch', unitCost: 15000 },
    { key: 'dinner', label: 'Dinner', unitCost: 12000 },
    { key: 'accommodation', label: 'Accommodation (per night)', unitCost: 80000 },
    { key: 'partner_visit_lump_sum', label: 'Partner visit rate (lump sum)', unitCost: 120000 },
    { key: 'training_session_fee', label: 'Training session cost', unitCost: 200000 },
    { key: 'venue', label: 'Venue cost', unitCost: 150000 },
    { key: 'meals_per_participant', label: 'Meal per participant', unitCost: 12000 },
    { key: 'mobilisation_per_participant', label: 'Mobilisation per participant', unitCost: 10000 },
    { key: 'cluster_meeting_cost', label: 'Cluster meeting cost (per participant)', unitCost: 18000 },
  ];
  for (const c of COSTS) {
    await prisma.costSetting.create({ data: { ...c, fy: '2026', createdBy: cd.id } });
  }

  // ── Summary ──────────────────────────────────────────────────────────
  const withSsa = rows.filter((r) => r._ssaWeakPair).length;
  const cceoMissing = rows.slice(0, CCEO_SCHOOLS).filter((r) => !r._ssaWeakPair).length;
  const plMissing = rows.slice(CCEO_SCHOOLS).filter((r) => !r._ssaWeakPair).length;
  console.log('');
  console.log('Seed complete:');
  console.log(`  • CCEO schools:           ${CCEO_SCHOOLS}  (test.cceo@edify.org)`);
  console.log(`  • PL schools:             ${PL_SCHOOLS}  (test.pl@edify.org)`);
  console.log(`  • Schools with SSA:       ${withSsa}`);
  console.log(`  • Schools missing SSA:    ${TOTAL_SCHOOLS - withSsa}  (CCEO ${cceoMissing} / PL ${plMissing})`);
  console.log(`  • Clusters created:       0  (test cluster creation + assignment workflow)`);
  console.log(`  • Cost catalogue items:   ${COSTS.length}`);
  console.log(`  • Activities created:     0`);
  console.log(`  • Fund requests created:  0`);
  console.log(`  • Partner assignments:    0`);
  console.log(`  • Evidence records:       0`);
  console.log(`  • Payments created:       0`);
  console.log('');
  console.log('  Logins (password "edify"):  test.cceo@ · test.pl@ · test.ia@ · test.cd@ · test.accountant@ · test.partner@ · admin@edify.org');
  void ssaCount;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
