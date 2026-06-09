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
  PrismaClient, Prisma, EdifyRole, SchoolType, SsaIntervention, ActivityType, ActivityStatus,
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
const NAME_A = ['Bright', 'Hope', 'Grace', 'Faith', 'Sunrise', 'Riverside', 'Unity', 'Victory', 'Mustard Seed', 'Cornerstone', 'New Life', 'Pioneer', 'Excel', 'Trinity', 'Bethel', 'St. Mary', 'St. John', 'Canaan', 'Greenhill', 'Kings', 'Light', 'Harvest', 'Rock', 'Living Water'];
const NAME_B = ['Primary', 'Junior', 'Academy', 'Community School', 'Christian School', 'Preparatory', 'Day & Boarding', 'Parents School'];
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];

// Realistic dataset scale (replaces the small demo set).
const TARGET_CORE = 300;
const TARGET_CLIENT = 600;
const TOTAL_SCHOOLS = TARGET_CORE + TARGET_CLIENT; // 900
const NUM_PLS = 4;
const CCEOS_PER_PL = 5; // → 20 CCEOs (coprime with the 1/3 core split, so each
                        //   CCEO gets a realistic MIX of core + client, not all-one)
const PL_OWN_SCHOOLS = 6; // PLs do field work too — a SMALL portfolio (they manage CCEOs)
const CCEO_NAMES = ['Paul Chinyama', 'Grace Nansubuga', 'Peter Ochieng', 'Sarah Khan', 'Sarah Namutebi', 'James Okot', 'Mary Akello', 'John Tabu', 'Esther Lamwaka', 'David Oloya', 'Ruth Adong', 'Moses Wanyama', 'Janet Achieng', 'Tom Ssemwogerere', 'Brenda Atim', 'Isaac Mukasa', 'Lydia Nakato', 'Henry Okello', 'Patience Auma', 'Caleb Kirya', 'Joy Nabwire', 'Simon Etori', 'Faith Among', 'Daniel Komakech'];
const PL_NAMES = ['Daniel Mwangi', 'Aisha Dar', 'Samuel Kato', 'Rachel Apio'];

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

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
  for (const u of baseUsers) await prisma.user.upsert({ where: { email: u.email }, update: { name: u.name }, create: { email: u.email, name: u.name, passwordHash: hash, roles: [u.role], activeRole: u.role } });

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

  // ── Staff: PLs (manage CCEOs + a SMALL own portfolio) + CCEOs ──────
  const pls: { id: string; name: string }[] = [];
  for (let i = 1; i <= NUM_PLS; i++) {
    const name = PL_NAMES[i - 1] ?? `Program Lead ${i}`;
    const u = await prisma.user.upsert({ where: { email: `pl${i}@edify.org` }, update: { name }, create: { email: `pl${i}@edify.org`, name, passwordHash: hash, roles: ['CountryProgramLead'], activeRole: 'CountryProgramLead' } });
    const sp = await prisma.staffProfile.upsert({ where: { userId: u.id }, update: {}, create: { userId: u.id, onboardingState: 'active', primaryDistrictId: districts[i % districts.length].id } });
    pls.push({ id: sp.id, name });
  }
  const cceos: { id: string; name: string }[] = [];
  const NUM_CCEOS = NUM_PLS * CCEOS_PER_PL;
  for (let i = 0; i < NUM_CCEOS; i++) {
    const email = i === 0 ? 'cceo@edify.org' : `cceo${i}@edify.org`;
    const name = CCEO_NAMES[i % CCEO_NAMES.length] + (i >= CCEO_NAMES.length ? ` ${Math.floor(i / CCEO_NAMES.length) + 1}` : '');
    const u = await prisma.user.upsert({ where: { email }, update: { name }, create: { email, name, passwordHash: hash, roles: ['CCEO'], activeRole: 'CCEO' } });
    const sp = await prisma.staffProfile.upsert({ where: { userId: u.id }, update: {}, create: { userId: u.id, onboardingState: 'active', primaryDistrictId: districts[i % districts.length].id } });
    await prisma.staffSupervisorAssignment.create({ data: { superviseeId: sp.id, supervisorId: pls[Math.floor(i / CCEOS_PER_PL)].id } });
    cceos.push({ id: sp.id, name });
  }

  // ── Clusters: one per sub-county, leaving ~25% cluster-less ────────
  const clusterBySc = new Map<string, string>();
  for (let i = 0; i < subCounties.length; i++) {
    if (i % 4 === 0) continue;
    const sc = subCounties[i];
    const cl = await prisma.cluster.create({ data: { name: `${sc.name} Cluster`, regionId: sc.regionId, districtId: sc.districtId, subCountyId: sc.id, subCountyName: sc.name, clusterType: ClusterType.mixed, status: ClusterRecordStatus.active } });
    clusterBySc.set(sc.id, cl.id);
  }

  // ── 900 schools (600 client + 300 core), round-robined across geography ──
  type Owner = { id: string; name: string };
  type Row = { schoolId: string; name: string; regionId: string; districtId: string; subCountyId: string; schoolType: SchoolType; enrollment: number; accountOwnerId: string; accountOwnerNameRaw: string; accountOwnerStatus: 'matched'; clusterId: string | null; clusterStatus: 'clustered' | 'unclustered'; currentFySsaStatus: 'done' | 'not_done'; planningReadiness: 'ready' | 'limited' | 'locked'; schoolPhone: string; createdByIa: boolean };
  const rows: Row[] = [];
  for (let gi = 0; gi < TOTAL_SCHOOLS; gi++) {
    const isCore = gi % 3 === 0; // exactly 1/3 → 300 core, 600 client
    const sc = subCounties[gi % subCounties.length];
    const clusterId = clusterBySc.get(sc.id);
    const isClustered = !!clusterId && gi % 4 !== 0;
    // First PL_OWN×NUM_PLS schools go to PLs (their small field portfolio); the
    // rest to CCEOs round-robin (so CCEOs carry far more than PLs).
    const owner: Owner = gi < NUM_PLS * PL_OWN_SCHOOLS
      ? { id: pls[gi % NUM_PLS].id, name: pls[gi % NUM_PLS].name }
      : { id: cceos[gi % cceos.length].id, name: cceos[gi % cceos.length].name };
    const enrollment = 120 + Math.floor(rnd() * 680);
    const hasSsa = isCore || gi % 10 < 6; // core always; ~60% of client
    rows.push({
      schoolId: String(50000 + gi),
      name: `${pick(NAME_A)} ${pick(NAME_B)}`,
      regionId: sc.regionId, districtId: sc.districtId, subCountyId: sc.id,
      schoolType: isCore ? SchoolType.core : SchoolType.client,
      enrollment,
      accountOwnerId: owner.id, accountOwnerNameRaw: owner.name, accountOwnerStatus: 'matched',
      clusterId: isClustered ? clusterId! : null,
      clusterStatus: isClustered ? 'clustered' : 'unclustered',
      currentFySsaStatus: hasSsa ? 'done' : 'not_done',
      planningReadiness: isClustered && hasSsa ? 'ready' : isClustered ? 'limited' : 'locked',
      schoolPhone: `+25670${String(2000000 + gi).slice(-7)}`,
      createdByIa: true,
    });
  }
  for (const c of chunk(rows, 500)) await prisma.school.createMany({ data: c, skipDuplicates: true });
  const dbSchools = await prisma.school.findMany({ select: { id: true, schoolId: true } });
  const idByExt = new Map(dbSchools.map((s) => [s.schoolId, s.id]));

  // Assignments + cluster memberships + enrollment history (bulk).
  await Promise.all(chunk(rows.map((r) => ({ staffId: r.accountOwnerId, schoolId: idByExt.get(r.schoolId)! })), 500).map((c) => prisma.staffSchoolAssignment.createMany({ data: c, skipDuplicates: true })));
  await Promise.all(chunk(rows.filter((r) => r.clusterId).map((r) => ({ schoolId: idByExt.get(r.schoolId)!, clusterId: r.clusterId!, assignedBy: 'seed' })), 500).map((c) => prisma.schoolClusterAssignment.createMany({ data: c, skipDuplicates: true })));
  await Promise.all(chunk(rows.filter((r) => r.currentFySsaStatus === 'done').map((r) => ({ schoolId: idByExt.get(r.schoolId)!, fy: '2026', enrollment: r.enrollment })), 500).map((c) => prisma.schoolEnrollmentHistory.createMany({ data: c, skipDuplicates: true })));

  // ── SSA: TWO rounds for core (baseline 2025 → follow-up 2026) so improvement
  //    is real; one round for client-with-SSA. Nested scores → individual creates. ──
  const ssaJobs: (() => Promise<unknown>)[] = [];
  let ssaCount = 0;
  for (const r of rows) {
    if (r.currentFySsaStatus !== 'done') continue;
    const id = idByExt.get(r.schoolId)!;
    const isCore = r.schoolType === 'core';
    const baseline = ssaScores(isCore).map((s) => ({ intervention: s.intervention, score: Math.max(1, Math.round((s.score - 1.2) * 10) / 10) }));
    ssaJobs.push(() => prisma.ssaRecord.create({ data: { schoolId: id, dateOfSsa: new Date(Date.UTC(2025, 9, 1 + (Number(r.schoolId) % 80))), fy: '2025', quarter: 'Q1', newEnrollment: r.enrollment, averageScore: avg(baseline), uploadedBy: 'seed', verificationStatus: 'confirmed', scores: { create: baseline } } }));
    ssaCount++;
    if (isCore) {
      const improved = rnd() < 0.7; // 70% of core schools improve round-over-round
      const follow = baseline.map((s) => ({ intervention: s.intervention, score: Math.min(10, Math.max(1, Math.round((s.score + (improved ? 0.6 + rnd() * 1.2 : -(0.3 + rnd() * 0.6))) * 10) / 10)) }));
      ssaJobs.push(() => prisma.ssaRecord.create({ data: { schoolId: id, dateOfSsa: new Date(Date.UTC(2026, 1, 1 + (Number(r.schoolId) % 80))), fy: '2026', quarter: 'Q2', newEnrollment: r.enrollment, averageScore: avg(follow), uploadedBy: 'seed', verificationStatus: 'confirmed', scores: { create: follow } } }));
      ssaCount++;
    }
  }
  for (const c of chunk(ssaJobs, 40)) await Promise.all(c.map((fn) => fn()));

  // ── Activities: core = 4 visits + 4 trainings (trainings carry attendance);
  //    ~1/3 of client schools get a completed visit + training. ──
  const acts: Prisma.ActivityCreateManyInput[] = [];
  for (const r of rows) {
    const id = idByExt.get(r.schoolId)!;
    const n0 = Number(r.schoolId);
    if (r.schoolType === 'core') {
      const partnerDelivered = n0 % 2 === 0;
      for (const at of ['core_visit', 'core_training'] as ActivityType[]) {
        const isTraining = at === 'core_training';
        for (let n = 1; n <= 4; n++) {
          const done = n <= 2 + Math.floor(rnd() * 3); // 2..4 of 4 complete
          acts.push({
            activityType: at, schoolId: id, fy: '2026', quarter: 'Q2', responsibleStaffId: r.accountOwnerId,
            deliveryType: partnerDelivered ? 'partner' : 'staff',
            status: done ? ActivityStatus.completed : (partnerDelivered ? ActivityStatus.assigned_to_partner : ActivityStatus.planned),
            purposeIntervention: INTERVENTIONS[(n - 1) % INTERVENTIONS.length],
            teachersAttended: isTraining && done ? 8 + Math.floor(rnd() * 22) : null,
            leadersAttended: isTraining && done ? 2 + Math.floor(rnd() * 5) : null,
            salesforceActivityId: done ? `${isTraining ? 'TS' : 'SV'}-${r.schoolId}${n}` : null,
            salesforceActivityType: isTraining ? 'training' : 'visit',
            iaVerificationStatus: done ? 'confirmed' : 'pending', iaConfirmedAt: done ? new Date() : null,
            evidenceStatus: done ? 'accepted' : (partnerDelivered ? 'uploaded' : 'none'),
            paymentStatus: done ? PaymentStatus.paid : PaymentStatus.none,
          });
        }
      }
    } else if (r.currentFySsaStatus === 'done' && n0 % 3 === 0) {
      acts.push({ activityType: 'school_visit', schoolId: id, fy: '2026', quarter: 'Q2', responsibleStaffId: r.accountOwnerId, deliveryType: 'staff', status: ActivityStatus.completed, iaVerificationStatus: 'confirmed', iaConfirmedAt: new Date(), evidenceStatus: 'accepted', salesforceActivityId: `SV-${r.schoolId}1`, salesforceActivityType: 'visit', paymentStatus: PaymentStatus.paid });
      acts.push({ activityType: 'school_improvement_training', schoolId: id, fy: '2026', quarter: 'Q2', responsibleStaffId: r.accountOwnerId, deliveryType: 'staff', status: ActivityStatus.completed, iaVerificationStatus: 'confirmed', iaConfirmedAt: new Date(), evidenceStatus: 'accepted', teachersAttended: 6 + Math.floor(rnd() * 16), leadersAttended: 2 + Math.floor(rnd() * 3), salesforceActivityId: `TS-${r.schoolId}1`, salesforceActivityType: 'training', paymentStatus: PaymentStatus.paid });
    }
  }
  for (const c of chunk(acts, 500)) await prisma.activity.createMany({ data: c, skipDuplicates: true });

  const core = rows.filter((r) => r.schoolType === 'core').length;
  const clustered = rows.filter((r) => r.clusterStatus === 'clustered').length;
  console.log(`✓ ${subCounties.length} sub-counties, ${clusterBySc.size} clusters`);
  console.log(`✓ ${rows.length} schools (${core} core, ${rows.length - core} client; ${clustered} clustered), ${ssaCount} SSA records, ${acts.length} activities`);
  console.log(`✓ ${cceos.length} CCEOs, ${pls.length} PLs (each owns ${PL_OWN_SCHOOLS} + supervises ${CCEOS_PER_PL} CCEOs); passwords "edify"`);
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
  // Canonical project portfolio — codes are the cross-surface business IDs the
  // School Directory uses to assign schools (so FE assignment writes hit the
  // backend). Idempotent: matched by code.
  {
    const PROJECTS: { code: string; name: string; category: ProjectCategory; intervention?: SsaIntervention }[] = [
      { code: 'SP-EDTECH', name: 'Education Technology', category: 'pilot', intervention: 'education_technology' },
      { code: 'SP-CCSEL', name: 'Christ-Centered SEL', category: 'selective_limited', intervention: 'christlike_behaviour' },
      { code: 'SP-DIP', name: 'International Diploma in Christ-Centered Education', category: 'selective_limited', intervention: 'teaching_and_learning' },
      { code: 'SP-ECC', name: 'Early Childhood Curriculum', category: 'intervention_specific', intervention: 'learning_environment' },
      { code: 'SP-UCU', name: 'UCU Teacher Upgrading Programs', category: 'selective_limited', intervention: 'teaching_and_learning' },
    ];
    // Re-home the 2 legacy projects that overlap (preserve their impact/partner
    // seed under the canonical code) before upserting the rest.
    await prisma.project.updateMany({ where: { name: 'EdTech Pilot', code: null }, data: { code: 'SP-EDTECH', name: 'Education Technology', category: 'pilot' } });
    await prisma.project.updateMany({ where: { name: 'CC-SEL', code: null }, data: { code: 'SP-CCSEL', name: 'Christ-Centered SEL', category: 'selective_limited' } });
    await prisma.project.updateMany({ where: { name: 'Literacy and Numeracy', code: null }, data: { code: 'SP-DIP', name: 'International Diploma in Christ-Centered Education', category: 'selective_limited', intervention: 'teaching_and_learning' } });
    await prisma.project.updateMany({ where: { name: 'Bible Project', code: null }, data: { code: 'SP-ECC', name: 'Early Childhood Curriculum', category: 'intervention_specific', intervention: 'learning_environment' } });

    const schoolPool = await prisma.school.findMany({ where: { deletedAt: null }, select: { id: true, accountOwnerId: true }, take: 80 });
    let pi = 0;
    for (const p of PROJECTS) {
      const project = await prisma.project.upsert({
        where: { code: p.code },
        create: { code: p.code, name: p.name, category: p.category, intervention: p.intervention },
        update: { name: p.name, category: p.category, intervention: p.intervention },
      });
      // Seed schools/partner/activity/impact only the first time a project is created.
      const already = await prisma.projectSchoolAssignment.count({ where: { projectId: project.id } });
      const slice = schoolPool.slice(pi * 6, pi * 6 + 6); pi++;
      if (already === 0) {
        for (const s of slice) {
          await prisma.projectSchoolAssignment.create({ data: { projectId: project.id, schoolId: s.id } });
        }
        if (partnerIds.length) await prisma.projectPartnerAssignment.create({ data: { projectId: project.id, partnerId: partnerIds[pi % partnerIds.length] } });
        if (slice[0]) {
          for (const at of ['project_activity'] as ActivityType[]) {
            await prisma.activity.create({ data: { activityType: at, schoolId: slice[0].id, projectId: project.id, fy: '2026', quarter: 'Q2', responsibleStaffId: slice[0].accountOwnerId ?? undefined, deliveryType: 'partner', assignedPartnerId: partnerIds[0], status: 'scheduled', purposeIntervention: p.intervention } });
          }
        }
        await prisma.projectImpactSnapshot.create({ data: { projectId: project.id, fy: '2026', metricsJson: { baselineAvg: 5.8, latestAvg: 7.1, change: 1.3, intervention: p.intervention } } });
      }
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

// Purge all operational data so a reseed is a clean rebuild (not a pile-up).
// Keeps reference + auth: User, Permission, RolePermission, Region, District,
// SubCounty. Deletes children → parents to satisfy FKs.
async function purgeOperational() {
  await prisma.paymentDisbursement.deleteMany();
  await prisma.paymentActionLog.deleteMany();
  await prisma.paymentRequest.deleteMany();
  await prisma.activityCompletionVerification.deleteMany();
  await prisma.evidenceRecord.deleteMany();
  await prisma.activityBudgetLine.deleteMany();
  await prisma.annualPlanActivity.deleteMany();
  await prisma.budgetApproval.deleteMany();
  await prisma.budgetVersion.deleteMany();
  await prisma.monthlyFundRequest.deleteMany();
  await prisma.annualPlan.deleteMany();
  await prisma.projectImpactSnapshot.deleteMany();
  await prisma.projectPartnerAssignment.deleteMany();
  await prisma.projectSchoolAssignment.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.project.deleteMany();
  await prisma.ssaScore.deleteMany();
  await prisma.ssaRecord.deleteMany();
  await prisma.schoolEnrollmentHistory.deleteMany();
  await prisma.schoolClusterAssignment.deleteMany();
  await prisma.schoolDuplicateCandidate.deleteMany();
  await prisma.schoolAccountOwnerUploadMap.deleteMany();
  await prisma.message.deleteMany();
  await prisma.messageThread.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.staffSchoolAssignment.deleteMany();
  await prisma.staffSupervisorAssignment.deleteMany();
  await prisma.staffGeographyAssignment.deleteMany();
  await prisma.staffTargetProfile.deleteMany();
  await prisma.school.deleteMany();
  await prisma.cluster.deleteMany();
  await prisma.staffProfile.deleteMany();
  await prisma.costSetting.deleteMany();
  await prisma.uploadBatch.deleteMany();
  await prisma.partner.deleteMany();
  console.log('✓ purged operational data (kept users + geography reference)');
}

async function main() {
  await seedReference();
  if (IS_PROD) { console.log('• production: skipping mock data'); return; }
  if (!MOCK) { console.log('• ENABLE_MOCK_DATA=false: skipping mock data'); return; }
  await purgeOperational();
  await seedMock();
  await seedDomains();
  await seedMessagesAndNotifications();
}
main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
