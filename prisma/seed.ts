/* eslint-disable no-console */
// Seed = reference data (always) + mock demo data (gated).
//
//  • Reference data — permissions, role matrix, Uganda regions/districts — is
//    real config, always upserted.
//  • Mock data — test sub-counties (4 per district), staff, clusters, and
//    4 schools per sub-county with a realistic workflow mix — loads ONLY when
//    ENABLE_MOCK_DATA=true and NODE_ENV !== production. Production is blocked.
//
// Sub-counties are SEEDED TEST FIXTURES (seeded=true) — replace with official
// Uganda sub-county data later without touching components.

import {
  PrismaClient, EdifyRole, SchoolType, SsaIntervention, ActivityType, ActivityStatus,
  ClusterType, ClusterRecordStatus, ProjectCategory, EvidenceKind, PaymentPath, PaymentStatus,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { ROLE_PERMISSIONS } from '../src/common/rbac/permissions';

const prisma = new PrismaClient();
const MOCK = ['1', 'true', 'yes'].includes((process.env.ENABLE_MOCK_DATA ?? '').toLowerCase());
const IS_PROD = process.env.NODE_ENV === 'production';

const GEOGRAPHY: Record<string, string[]> = {
  Northern: ['Gulu', 'Lira', 'Kitgum', 'Pader', 'Agago'],
  Eastern: ['Soroti', 'Arapai', 'Mbale', 'Tororo'],
  Central: ['Kampala', 'Wakiso', 'Mukono', 'Kira'],
  Western: ['Mbarara', 'Kabale', 'Fort Portal'],
};
const SUBCOUNTY_SUFFIXES = ['Central', 'North', 'South', 'East']; // 4 test sub-counties/district
const INTERVENTIONS: SsaIntervention[] = [
  'teaching_and_learning', 'financial_health', 'christlike_behaviour', 'exposure_to_word_of_god',
  'government_requirements', 'leadership', 'education_technology', 'learning_environment',
];

function mulberry32(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rnd = mulberry32(2026);
const NAME_A = ['Bright', 'Hope', 'Grace', 'Faith', 'Sunrise', 'Riverside', 'Unity', 'Victory', 'Mustard Seed', 'Cornerstone', 'New Life', 'Pioneer', 'Excel', 'Trinity', 'Bethel', 'St. Mary', 'St. John', 'Canaan'];
const NAME_B = ['Primary', 'Junior', 'Academy', 'Community School', 'Christian School', 'Preparatory'];
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];

async function seedReference() {
  const keys = new Set<string>();
  for (const p of Object.values(ROLE_PERMISSIONS)) p.forEach((k) => keys.add(k));
  for (const key of keys) await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
  for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
    for (const key of perms) {
      const perm = await prisma.permission.findUniqueOrThrow({ where: { key } });
      await prisma.rolePermission.upsert({ where: { role_permissionId: { role: role as EdifyRole, permissionId: perm.id } }, update: {}, create: { role: role as EdifyRole, permissionId: perm.id } });
    }
  }
  for (const [regionName, districts] of Object.entries(GEOGRAPHY)) {
    const region = await prisma.region.upsert({ where: { name: regionName }, update: {}, create: { name: regionName } });
    for (const d of districts) await prisma.district.upsert({ where: { regionId_name: { regionId: region.id, name: d } }, update: {}, create: { name: d, regionId: region.id } });
  }
  console.log(`✓ reference: ${keys.size} permissions, ${Object.keys(GEOGRAPHY).length} regions, ${Object.values(GEOGRAPHY).flat().length} districts`);
}

function ssaScores(core: boolean) {
  return INTERVENTIONS.map((intervention) => {
    const base = core ? 7.5 + rnd() * 2 : 4 + rnd() * 4.5;
    return { intervention, score: Math.round(Math.min(10, base) * 10) / 10 };
  });
}
const avg = (s: { score: number }[]) => Math.round((s.reduce((a, x) => a + x.score, 0) / s.length) * 10) / 10;

async function seedMock() {
  const hash = await bcrypt.hash('edify', 10);
  const baseUsers: { email: string; name: string; role: EdifyRole }[] = [
    { email: 'admin@edify.org', name: 'Edify Admin', role: 'Admin' },
    { email: 'cd@edify.org', name: 'Sarah Okello', role: 'CountryDirector' },
    { email: 'ia@edify.org', name: 'Grace Alimo', role: 'ImpactAssessment' },
    { email: 'rvp@edify.org', name: 'Robert Vance', role: 'RegionalVicePresident' },
    { email: 'accountant@edify.org', name: 'Moses Tindi', role: 'ProgramAccountant' },
    { email: 'hr@edify.org', name: 'Hellen Auma', role: 'HumanResources' },
  ];
  for (const u of baseUsers) await prisma.user.upsert({ where: { email: u.email }, update: {}, create: { email: u.email, name: u.name, passwordHash: hash, roles: [u.role], activeRole: u.role } });

  const districts = await prisma.district.findMany({ include: { region: true } });

  // Sub-counties — 4 seeded test fixtures per district.
  const subCounties: { id: string; name: string; districtId: string; regionId: string }[] = [];
  for (const d of districts) {
    for (const suffix of SUBCOUNTY_SUFFIXES) {
      const name = `${d.name} ${suffix}`;
      const sc = await prisma.subCounty.upsert({ where: { districtId_name: { districtId: d.id, name } }, update: { seeded: true }, create: { name, districtId: d.id, seeded: true } });
      subCounties.push({ id: sc.id, name, districtId: d.id, regionId: d.regionId });
    }
  }

  // Supervisors + CCEO owners.
  const pls = [];
  for (let i = 1; i <= 3; i++) {
    const u = await prisma.user.upsert({ where: { email: `pl${i}@edify.org` }, update: {}, create: { email: `pl${i}@edify.org`, name: `Program Lead ${i}`, passwordHash: hash, roles: ['CountryProgramLead'], activeRole: 'CountryProgramLead' } });
    pls.push(await prisma.staffProfile.upsert({ where: { userId: u.id }, update: {}, create: { userId: u.id, onboardingState: 'active', primaryDistrictId: districts[i % districts.length].id } }));
  }
  const cceos = [];
  const cceoNames = ['Paul Chinyama', 'Daniel Mwangi', 'Grace Nansubuga', 'Peter Ochieng', 'Sarah Khan', 'Sarah Namutebi', 'James Okot', 'Mary Akello', 'John Tabu', 'Esther Lamwaka', 'David Oloya', 'Ruth Adong'];
  for (let i = 0; i < cceoNames.length; i++) {
    const email = i === 0 ? 'cceo@edify.org' : `cceo${i}@edify.org`;
    const u = await prisma.user.upsert({ where: { email }, update: {}, create: { email, name: cceoNames[i], passwordHash: hash, roles: ['CCEO'], activeRole: 'CCEO' } });
    const sp = await prisma.staffProfile.upsert({ where: { userId: u.id }, update: {}, create: { userId: u.id, onboardingState: 'active', primaryDistrictId: districts[i % districts.length].id } });
    await prisma.staffSupervisorAssignment.upsert({ where: { superviseeId_supervisorId: { superviseeId: sp.id, supervisorId: pls[i % pls.length].id } }, update: {}, create: { superviseeId: sp.id, supervisorId: pls[i % pls.length].id } });
    cceos.push(sp);
  }

  // 4 schools per sub-county. ~66% of sub-counties get a cluster (so a third stay
  // cluster-less for the create-cluster flow); clustered sub-counties leave 1 of 4
  // schools unclustered for the assign-to-existing flow.
  let gi = 0, created = 0, coreCount = 0, ssaCount = 0, clustered = 0, activityCount = 0, clusterCount = 0;
  for (let sci = 0; sci < subCounties.length; sci++) {
    const sc = subCounties[sci];
    const hasCluster = sci % 3 !== 0; // ~66%
    let clusterId: string | undefined;
    if (hasCluster) {
      // Idempotent: one active cluster per sub-county.
      const existing = await prisma.cluster.findFirst({ where: { subCountyId: sc.id, deletedAt: null } });
      const cl = existing ?? await prisma.cluster.create({ data: { name: `${sc.name} Cluster`, regionId: sc.regionId, districtId: sc.districtId, subCountyId: sc.id, subCountyName: sc.name, clusterType: ClusterType.mixed, status: ClusterRecordStatus.active } });
      clusterId = cl.id;
      if (!existing) clusterCount++;
    }

    for (let s = 0; s < 4; s++, gi++) {
      const type: SchoolType = gi % 5 === 0 ? SchoolType.core : gi % 5 === 1 ? SchoolType.potential_core : SchoolType.client;
      const isCore = type === 'core';
      // Cluster: if sub-county has a cluster, clustered unless it's the last of 4.
      const isClustered = hasCluster && s < 3;
      // SSA: core always; SIT-done-but-SSA-missing for some; otherwise ~70%.
      const sitOnly = !isCore && gi % 9 === 0;
      const hasSsa = isCore || (!sitOnly && gi % 10 < 7);
      const schoolId = String(50000 + gi);
      if (await prisma.school.findUnique({ where: { schoolId } })) continue;
      const owner = cceos[gi % cceos.length];

      const school = await prisma.school.create({
        data: {
          schoolId, name: `${pick(NAME_A)} ${pick(NAME_B)}`,
          regionId: sc.regionId, districtId: sc.districtId, subCountyId: sc.id,
          schoolType: type, enrollment: 120 + Math.floor(rnd() * 600),
          accountOwnerId: owner.id, accountOwnerNameRaw: cceoNames[gi % cceoNames.length], accountOwnerStatus: 'matched',
          clusterId: isClustered ? clusterId : null,
          clusterStatus: isClustered ? 'clustered' : 'unclustered',
          currentFySsaStatus: hasSsa ? 'done' : (sitOnly ? 'scheduled' : 'not_done'),
          planningReadiness: isClustered && hasSsa ? 'ready' : isClustered ? 'limited' : 'locked',
          schoolPhone: `+25670${String(2000000 + gi).slice(-7)}`,
          createdByIa: true,
        },
      });
      await prisma.staffSchoolAssignment.upsert({ where: { staffId_schoolId: { staffId: owner.id, schoolId: school.id } }, update: {}, create: { staffId: owner.id, schoolId: school.id } });
      if (isClustered && clusterId) await prisma.schoolClusterAssignment.upsert({ where: { schoolId_clusterId: { schoolId: school.id, clusterId } }, update: {}, create: { schoolId: school.id, clusterId, assignedBy: 'mock_seed' } });
      created++;
      if (isCore) coreCount++;
      if (isClustered) clustered++;

      if (hasSsa) {
        const scores = ssaScores(isCore);
        await prisma.ssaRecord.create({ data: { schoolId: school.id, dateOfSsa: new Date(Date.UTC(2026, 0, 1 + (gi % 90))), fy: '2026', quarter: 'Q2', newEnrollment: school.enrollment, averageScore: avg(scores), uploadedBy: 'mock_seed', verificationStatus: isCore ? 'confirmed' : 'pending', scores: { create: scores } } });
        await prisma.schoolEnrollmentHistory.upsert({ where: { schoolId_fy: { schoolId: school.id, fy: '2026' } }, update: {}, create: { schoolId: school.id, fy: '2026', enrollment: school.enrollment! } });
        ssaCount++;
      }

      // Core schools get a 4-visit + 4-training package with mixed partner status.
      if (isCore) {
        const partnerDelivered = gi % 2 === 0;
        for (const at of ['core_visit', 'core_training'] as ActivityType[]) {
          for (let n = 1; n <= 4; n++) {
            const done = n <= (1 + Math.floor(rnd() * 4));
            await prisma.activity.create({ data: {
              activityType: at, schoolId: school.id, fy: '2026', quarter: 'Q2', responsibleStaffId: owner.id,
              deliveryType: partnerDelivered ? 'partner' : 'staff',
              status: done ? ActivityStatus.completed : (partnerDelivered ? ActivityStatus.assigned_to_partner : ActivityStatus.not_planned),
              purposeIntervention: INTERVENTIONS[(n - 1) % INTERVENTIONS.length],
              salesforceActivityId: done ? (at === 'core_visit' ? `SV-${schoolId}${n}` : `TS-${schoolId}${n}`) : null,
              salesforceActivityType: at === 'core_visit' ? 'visit' : 'training',
              iaVerificationStatus: done ? 'confirmed' : 'pending', iaConfirmedAt: done ? new Date() : null,
              evidenceStatus: done ? 'accepted' : (partnerDelivered ? 'uploaded' : 'none'),
            } });
            activityCount++;
          }
        }
      }
    }
  }

  console.log(`✓ mock: ${subCounties.length} sub-counties, ${clusterCount} clusters`);
  console.log(`✓ mock: ${created} schools (${coreCount} core, ${clustered} clustered, ${created - clustered} unclustered), ${ssaCount} SSA, ${activityCount} core activities`);
  console.log(`✓ mock: ${cceos.length} CCEOs, ${pls.length} PLs; all passwords "edify"`);
}

// Workflow-connected messages + notifications, addressed to real users with
// context + targetRoute (so the inbox/drawer is database-driven, not hardcoded).
async function seedMessagesAndNotifications() {
  const [cd, ia, cceo, accountant, pl] = await Promise.all([
    prisma.user.findUnique({ where: { email: 'cd@edify.org' } }),
    prisma.user.findUnique({ where: { email: 'ia@edify.org' } }),
    prisma.user.findUnique({ where: { email: 'cceo@edify.org' } }),
    prisma.user.findUnique({ where: { email: 'accountant@edify.org' } }),
    prisma.user.findUnique({ where: { email: 'pl1@edify.org' } }),
  ]);
  if (!cd || !ia || !cceo || !accountant || !pl) return;
  const sampleSchool = await prisma.school.findFirst({ where: { clusterStatus: 'unclustered' }, select: { schoolId: true, name: true } });
  const ssaSchool = await prisma.school.findFirst({ where: { currentFySsaStatus: 'not_done', schoolType: 'core' }, select: { schoolId: true, name: true } });

  // Idempotent: clear prior mock_seed notifications/messages so reseeds don't pile up.
  await prisma.notification.deleteMany({ where: { contextType: 'mock_seed' } });

  const notifs = [
    { recipientId: cceo.id, title: 'Add to cluster required', body: `${sampleSchool?.name ?? 'A school'} has no cluster — assign one to unlock planning.`, targetRoute: `/core-schools`, actionRequired: true, priority: 'high' as const, contextId: sampleSchool?.schoolId },
    { recipientId: ia.id, title: 'SSA verification required', body: `Confirm the Salesforce ID for a completed core visit.`, targetRoute: '/data-verification', actionRequired: true, priority: 'high' as const },
    { recipientId: cceo.id, title: 'SSA required', body: `${ssaSchool?.name ?? 'A core school'} is missing its current-FY SSA.`, targetRoute: '/planning', actionRequired: true, priority: 'normal' as const, contextId: ssaSchool?.schoolId },
    { recipientId: accountant.id, title: 'Partner payment ready', body: 'An IA-verified partner training is ready for payment.', targetRoute: '/core-schools/payments', actionRequired: true, priority: 'high' as const },
    { recipientId: pl.id, title: 'CCEO core visit needs sign-off', body: 'A CCEO core visit is awaiting your PL verification.', targetRoute: '/planning/core-schools', actionRequired: true, priority: 'normal' as const },
    { recipientId: cd.id, title: 'Annual budget approval needed', body: 'A regional annual plan was submitted for approval.', targetRoute: '/budget', actionRequired: true, priority: 'normal' as const },
  ];
  for (const n of notifs) await prisma.notification.create({ data: { ...n, contextType: 'mock_seed' } });

  // Messages (threaded), addressed to recipients.
  const thread = await prisma.messageThread.create({ data: { subject: 'Cluster assignment for unclustered schools', contextType: 'mock_seed' } });
  const msgs = [
    { recipientId: cceo.id, senderId: pl.id, body: 'Please cluster your remaining unclustered schools before planning closes.', actionRequired: true, priority: 'high' as const, targetRoute: '/core-schools', category: 'cluster' },
    { recipientId: ia.id, senderId: cd.id, body: 'Prioritise SSA verification for the new core onboarding cohort.', actionRequired: true, priority: 'normal' as const, targetRoute: '/data-verification', category: 'ssa' },
    { recipientId: accountant.id, senderId: ia.id, body: 'Two partner trainings are IA-confirmed and ready for payment.', actionRequired: true, priority: 'normal' as const, targetRoute: '/core-schools/payments', category: 'payment' },
  ];
  for (const m of msgs) await prisma.message.create({ data: { ...m, threadId: thread.id, contextType: 'mock_seed' } });

  console.log(`✓ mock: ${notifs.length} notifications, ${msgs.length} messages (workflow-connected)`);
}

// All remaining domains so the whole workflow is testable: partners, cost
// settings, special projects (+ assignments/activities/impact), evidence,
// payments/accountability, annual plan + budget, Salesforce verifications.
// Each domain is guarded (seeds only when empty) so reseeds stay idempotent.
async function seedDomains() {
  // ── Partners ──────────────────────────────────────────────────────
  const PARTNERS = [
    { name: 'Literacy Training Uganda', regionName: 'Central', trainsOn: ['Early Grade Reading', 'Teacher Coaching'] },
    { name: 'Bright Future Education', regionName: 'Northern', trainsOn: ['Numeracy Foundations', 'Leadership'] },
    { name: 'World Vision', regionName: 'Eastern', trainsOn: ['Christlike Behaviour', 'Child Protection'] },
    { name: 'EdTech Partners', regionName: 'Western', trainsOn: ['Education Technology'] },
    { name: 'Bible Society UG', regionName: 'Central', trainsOn: ['Exposure to the Word of God'] },
  ];
  let partnerIds: string[] = [];
  if ((await prisma.partner.count()) === 0) {
    for (const p of PARTNERS) { const c = await prisma.partner.create({ data: p }); partnerIds.push(c.id); }
  } else {
    partnerIds = (await prisma.partner.findMany({ select: { id: true } })).map((p) => p.id);
  }

  // ── Cost settings (CD-defined) ────────────────────────────────────
  if ((await prisma.costSetting.count()) === 0) {
    const COSTS: { key: string; label: string; unitCost: number }[] = [
      { key: 'staff_visit_transport_primary', label: 'Staff visit transport (primary)', unitCost: 50000 },
      { key: 'staff_visit_transport_secondary', label: 'Staff visit transport (secondary)', unitCost: 30000 },
      { key: 'lunch', label: 'Lunch', unitCost: 15000 },
      { key: 'partner_visit_lump_sum', label: 'Partner visit lump sum', unitCost: 120000 },
      { key: 'training_session_fee', label: 'Training session fee', unitCost: 200000 },
      { key: 'venue', label: 'Venue', unitCost: 150000 },
      { key: 'meals_per_participant', label: 'Meals per participant', unitCost: 12000 },
      { key: 'cluster_meeting_cost', label: 'Cluster meeting cost', unitCost: 300000 },
      { key: 'admin_stationery', label: 'Admin — stationery', unitCost: 80000 },
    ];
    for (const c of COSTS) await prisma.costSetting.create({ data: { ...c, fy: '2026', createdBy: 'mock_seed' } });
  }

  // ── Special projects + assignments + activities + impact ──────────
  if ((await prisma.project.count()) === 0) {
    const PROJECTS: { name: string; category: ProjectCategory; intervention?: SsaIntervention }[] = [
      { name: 'Literacy and Numeracy', category: 'intervention_specific', intervention: 'teaching_and_learning' },
      { name: 'EdTech Pilot', category: 'pilot', intervention: 'education_technology' },
      { name: 'Bible Project', category: 'selective_limited', intervention: 'exposure_to_word_of_god' },
      { name: 'CC-SEL', category: 'intervention_specific', intervention: 'christlike_behaviour' },
    ];
    const schoolPool = await prisma.school.findMany({ where: { deletedAt: null }, select: { id: true, accountOwnerId: true }, take: 80 });
    let pi = 0;
    for (const p of PROJECTS) {
      const project = await prisma.project.create({ data: { name: p.name, category: p.category, intervention: p.intervention } });
      // assign 6 distinct schools per project (non-overlapping slices)
      const slice = schoolPool.slice(pi * 6, pi * 6 + 6); pi++;
      for (const s of slice) {
        await prisma.projectSchoolAssignment.create({ data: { projectId: project.id, schoolId: s.id } });
      }
      // 1 partner per project
      if (partnerIds.length) await prisma.projectPartnerAssignment.create({ data: { projectId: project.id, partnerId: partnerIds[pi % partnerIds.length] } });
      // 2 project activities on the first assigned school
      if (slice[0]) {
        for (const at of ['project_activity'] as ActivityType[]) {
          await prisma.activity.create({ data: { activityType: at, schoolId: slice[0].id, projectId: project.id, fy: '2026', quarter: 'Q2', responsibleStaffId: slice[0].accountOwnerId ?? undefined, deliveryType: 'partner', assignedPartnerId: partnerIds[0], status: 'scheduled', purposeIntervention: p.intervention } });
        }
      }
      await prisma.projectImpactSnapshot.create({ data: { projectId: project.id, fy: '2026', metricsJson: { baselineAvg: 5.8, latestAvg: 7.1, change: 1.3, intervention: p.intervention } } });
    }
  }

  // ── Evidence on completed activities ──────────────────────────────
  if ((await prisma.evidenceRecord.count()) === 0) {
    const acts = await prisma.activity.findMany({ where: { status: 'completed' }, select: { id: true, deliveryType: true }, take: 40 });
    const kinds: EvidenceKind[] = ['visit_form', 'attendance_form', 'meeting_minutes', 'photo'];
    let i = 0;
    for (const a of acts) {
      const status = a.deliveryType === 'partner' ? (i % 5 === 0 ? 'returned' : 'accepted') : 'accepted';
      await prisma.evidenceRecord.create({ data: { activityId: a.id, kind: kinds[i % kinds.length], uri: `https://evidence.local/${a.id}.pdf`, uploadedBy: 'mock_seed', status, reviewedBy: status === 'accepted' ? 'mock_seed' : undefined, reviewedAt: status === 'accepted' ? new Date() : undefined } });
      i++;
    }
  }

  // ── Salesforce verifications + payments/accountability ────────────
  if ((await prisma.paymentRequest.count()) === 0) {
    const verified = await prisma.activity.findMany({ where: { iaVerificationStatus: 'confirmed', salesforceActivityId: { not: null } }, select: { id: true, deliveryType: true, assignedPartnerId: true, salesforceActivityId: true }, take: 60 });
    let i = 0;
    for (const a of verified) {
      // verification record
      await prisma.activityCompletionVerification.upsert({
        where: { activityId: a.id }, update: {},
        create: { activityId: a.id, salesforceId: a.salesforceActivityId!, enteredBy: 'mock_seed', status: 'confirmed', iaActorId: 'mock_seed', iaActionAt: new Date() },
      }).catch(() => undefined);
      // payment (partner) or accountability (staff)
      const isPartner = a.deliveryType === 'partner' && !!a.assignedPartnerId;
      const statuses: PaymentStatus[] = isPartner
        ? ['ia_confirmed', 'pl_approved', 'accountant_cleared', 'paid']
        : ['netsuite_accountability', 'closed'];
      const status = statuses[i % statuses.length];
      const pr = await prisma.paymentRequest.create({ data: { activityId: a.id, path: isPartner ? PaymentPath.partner : PaymentPath.staff, amount: isPartner ? 120000 : 50000, status, netsuiteExpenseId: !isPartner ? `NS-${1000 + i}` : undefined } });
      await prisma.paymentActionLog.create({ data: { paymentRequestId: pr.id, action: 'ia_confirmed', actorId: 'mock_seed' } });
      if (status === 'paid') await prisma.paymentDisbursement.create({ data: { paymentRequestId: pr.id, amount: 120000, clearedBy: 'mock_seed', reference: `PAY-${2000 + i}` } });
      i++;
    }
  }

  // ── Annual plan + budget ──────────────────────────────────────────
  if ((await prisma.annualPlan.count()) === 0) {
    const plan = await prisma.annualPlan.create({ data: { fy: '2026', status: 'submitted' } });
    for (const q of ['Q1', 'Q2', 'Q3', 'Q4']) {
      const apa = await prisma.annualPlanActivity.create({ data: { annualPlanId: plan.id, activityType: 'school_visit', quarter: q, month: 1 } });
      await prisma.activityBudgetLine.create({ data: { annualPlanActivityId: apa.id, costSettingKey: 'staff_visit_transport_primary', quantity: 10, unitCost: 50000, amount: 500000 } });
    }
    const bv = await prisma.budgetVersion.create({ data: { annualPlanId: plan.id, version: 1, total: 2000000 } });
    await prisma.budgetApproval.create({ data: { budgetVersionId: bv.id, approverId: 'mock_seed', decision: 'approved' } });
    await prisma.monthlyFundRequest.create({ data: { fy: '2026', month: 2, amount: 500000, status: 'submitted' } });
  }

  const [partners, projects, evidence, payments, plans, costs] = await Promise.all([
    prisma.partner.count(), prisma.project.count(), prisma.evidenceRecord.count(),
    prisma.paymentRequest.count(), prisma.annualPlan.count(), prisma.costSetting.count(),
  ]);
  console.log(`✓ mock: ${partners} partners, ${projects} projects, ${evidence} evidence, ${payments} payments, ${plans} annual plans, ${costs} cost settings`);
}

async function main() {
  await seedReference();
  if (IS_PROD) { console.log('• production: skipping mock data'); return; }
  if (!MOCK) { console.log('• ENABLE_MOCK_DATA=false: skipping mock data'); return; }
  await seedMock();
  await seedDomains();
  await seedMessagesAndNotifications();
}
main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
