/**
 * Online Testing — seed REALISTIC in-flight workflow data + ensure every test role
 * can log in.
 *
 * The Phase-1 `reset` wipes all workflow records for a clean slate, and `trim:users`
 * deactivates HR / Partner / ProjectCoordinator. That leaves testers unable to (a)
 * log in as those three roles, or (b) see the execution/money pipeline populated.
 * This script fixes both, idempotently, against the EXISTING seeded reference data
 * (700 SSA-complete schools, staff, partners, cost catalogue, geography):
 *
 *   1. Ensures hr@ / partner@ / coordinator@edify.org exist, are ACTIVE, and are
 *      correctly linked (coordinator staff profile; partner → Partner.userId FK).
 *   2. Seeds a focused set of REAL Activity / Evidence / Payment / FundRequest /
 *      Leave records spanning the pipeline states (scheduled → in-progress →
 *      evidence → awaiting-IA → IA-verified → payment/accountability → completed),
 *      plus partner-delivered work, monthly fund requests in the approval chain,
 *      and an approved HR leave that conflicts with a planned activity.
 *
 * Every record is a real DB row that flows through the actual backend pipeline —
 * no frontend-only mock. Re-runnable: workflow seeding is skipped when activities
 * already exist (run `reset` first to re-seed), unless FORCE_WORKFLOW_SEED=true.
 *
 *   npm run seed:online-test-workflows
 *   FORCE_WORKFLOW_SEED=true npm run seed:online-test-workflows   # re-seed workflows
 */
import { PrismaClient, Prisma, SsaIntervention, EvidenceKind, EvidenceStatus, PaymentPath, PaymentStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { getOperationalFY, getQuarterForDate } from '../src/common/fy/fy.util';

const prisma = new PrismaClient();

const INTERVENTIONS: SsaIntervention[] = [
  'teaching_and_learning', 'leadership', 'christlike_behaviour',
  'exposure_to_word_of_god', 'education_technology', 'learning_environment',
];
const pick = <T>(a: T[], i: number): T => a[i % a.length];
const day = (delta: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + delta);
  d.setUTCHours(9, 0, 0, 0);
  return d;
};
const fyOf = (d: Date) => getOperationalFY(d);
const qOf = (d: Date) => getQuarterForDate(d);

async function ensureRoles() {
  const hash = await bcrypt.hash(process.env.DEMO_LOGIN_PASSWORD ?? 'edify', 10);
  const districts = await prisma.district.findMany({ take: 1, select: { id: true } });
  const districtId = districts[0]?.id;

  // HR — reactivate (created by the base seed, deactivated by trim:users).
  await prisma.user.upsert({
    where: { email: 'hr@edify.org' },
    update: { isActive: true, roles: ['HumanResources'], activeRole: 'HumanResources' },
    create: { email: 'hr@edify.org', name: 'Hellen Auma', passwordHash: hash, roles: ['HumanResources'], activeRole: 'HumanResources', isActive: true },
  });

  // ProjectCoordinator — recreate (trim hard-deletes users with no audit history)
  // + give a staff profile so coordinator activities show in My Plan.
  const coordUser = await prisma.user.upsert({
    where: { email: 'coordinator@edify.org' },
    update: { isActive: true, roles: ['ProjectCoordinator'], activeRole: 'ProjectCoordinator' },
    create: { email: 'coordinator@edify.org', name: 'Allan Ssentongo', passwordHash: hash, roles: ['ProjectCoordinator'], activeRole: 'ProjectCoordinator', isActive: true },
  });
  await prisma.staffProfile.upsert({
    where: { userId: coordUser.id },
    update: { onboardingState: 'active' },
    create: { userId: coordUser.id, onboardingState: 'active', ...(districtId ? { primaryDistrictId: districtId } : {}) },
  });

  // Partner field officer — reactivate + link to the first active Partner org via
  // the canonical Partner.userId FK (so the session resolves to that org's work).
  const partnerUser = await prisma.user.upsert({
    where: { email: 'partner@edify.org' },
    update: { isActive: true, roles: ['PartnerFieldOfficer'], activeRole: 'PartnerFieldOfficer' },
    create: { email: 'partner@edify.org', name: 'Literacy Uganda Officer', passwordHash: hash, roles: ['PartnerFieldOfficer'], activeRole: 'PartnerFieldOfficer', isActive: true },
  });
  const firstPartner = await prisma.partner.findFirst({ where: { activeStatus: true }, select: { id: true } });
  if (firstPartner) {
    await prisma.partner.update({ where: { id: firstPartner.id }, data: { userId: partnerUser.id } }).catch(() => undefined);
  }

  console.log('  ✓ roles ensured active: HR, Partner (linked), ProjectCoordinator');
  return { coordUserId: coordUser.id };
}

async function seedWorkflows(coordUserId: string) {
  const existing = await prisma.activity.count();
  if (existing > 0 && process.env.FORCE_WORKFLOW_SEED !== 'true') {
    console.log(`  • ${existing} activities already exist — skipping workflow seed (run \`reset\` then re-run, or set FORCE_WORKFLOW_SEED=true).`);
    return;
  }
  if (existing > 0) {
    console.log(`  • FORCE_WORKFLOW_SEED — wiping ${existing} existing activities + dependent workflow rows first.`);
    await prisma.paymentActionLog.deleteMany({});
    await prisma.paymentRequest.deleteMany({});
    await prisma.activityCompletionVerification.deleteMany({});
    await prisma.evidenceRecord.deleteMany({});
    await prisma.activity.deleteMany({});
    await prisma.fundRequest.deleteMany({});
    await prisma.leave.deleteMany({});
  }

  // Reference data (real rows).
  const cceo = await prisma.user.findUnique({ where: { email: 'cceo@edify.org' }, select: { id: true, staffProfile: { select: { id: true } } } });
  const coord = await prisma.staffProfile.findUnique({ where: { userId: coordUserId }, select: { id: true } });
  const partner = await prisma.partner.findFirst({ where: { activeStatus: true }, select: { id: true } });
  const cceoStaffId = cceo?.staffProfile?.id;
  if (!cceoStaffId) throw new Error('cceo@edify.org has no staff profile — run the base seed first.');

  // SSA-complete schools (the planning gate requires currentFySsaStatus=done).
  const schools = await prisma.school.findMany({
    where: { deletedAt: null, currentFySsaStatus: 'done' },
    select: { id: true, schoolId: true, schoolType: true },
    take: 60,
  });
  if (schools.length < 20) throw new Error(`Only ${schools.length} SSA-complete schools — run the base seed/reset first.`);
  let idx = 0;
  const nextSchool = () => schools[idx++ % schools.length];
  const fy = getOperationalFY();
  const sfV = (i: number) => `SV-OT${String(1000 + i)}`;
  const sfT = (i: number) => `TS-OT${String(2000 + i)}`;

  type Scn = {
    over: Prisma.ActivityUncheckedCreateInput;
    evidence?: { kind: EvidenceKind; status: EvidenceStatus; partner: boolean }[];
    verifySfId?: string;
    payment?: { path: PaymentPath; amount: number; status: PaymentStatus };
  };
  const base = (o: Partial<Prisma.ActivityUncheckedCreateInput> & { scheduledDate?: Date }): Prisma.ActivityUncheckedCreateInput => {
    const sched = o.scheduledDate;
    return {
      activityType: 'school_visit', fy: sched ? fyOf(sched) : fy, quarter: sched ? qOf(sched) : 'Q1',
      deliveryType: 'staff', status: 'planned', ...o,
    } as Prisma.ActivityUncheckedCreateInput;
  };

  const scn: Scn[] = [];
  // A) Scheduled staff visits → My Plan (due today / this week / this month).
  for (const d of [0, 2, 5, 12]) {
    const s = nextSchool();
    scn.push({ over: base({ activityType: 'school_visit', schoolId: s.id, responsibleStaffId: cceoStaffId, status: 'scheduled', scheduledDate: day(d), plannedMonth: 6, purposeIntervention: pick(INTERVENTIONS, idx) }) });
  }
  // B) In-progress staff training.
  { const s = nextSchool(); scn.push({ over: base({ activityType: 'school_improvement_training', schoolId: s.id, responsibleStaffId: cceoStaffId, status: 'in_progress', scheduledDate: day(-1), plannedMonth: 6, purposeIntervention: pick(INTERVENTIONS, idx) }) }); }
  // C) Partner assigned + partner scheduled.
  if (partner) {
    for (let i = 0; i < 2; i++) { const s = nextSchool(); scn.push({ over: base({ activityType: 'school_visit', schoolId: s.id, responsibleStaffId: cceoStaffId, assignedPartnerId: partner.id, deliveryType: 'partner', status: 'assigned_to_partner', plannedMonth: 7, purposeIntervention: pick(INTERVENTIONS, idx) }) }); }
    for (let i = 0; i < 2; i++) { const s = nextSchool(); scn.push({ over: base({ activityType: i === 0 ? 'training' : 'school_visit', schoolId: s.id, responsibleStaffId: cceoStaffId, assignedPartnerId: partner.id, deliveryType: 'partner', status: 'partner_scheduled', scheduledDate: day(6 + i * 3), plannedMonth: 6, purposeIntervention: pick(INTERVENTIONS, idx) }) }); }
    // D) Partner evidence uploaded (awaiting staff confirm).
    for (let i = 0; i < 2; i++) { const s = nextSchool(); scn.push({ over: base({ activityType: 'school_visit', schoolId: s.id, responsibleStaffId: cceoStaffId, assignedPartnerId: partner.id, deliveryType: 'partner', status: 'evidence_uploaded', evidenceStatus: 'uploaded', scheduledDate: day(-3), plannedMonth: 6, purposeIntervention: pick(INTERVENTIONS, idx) }), evidence: [{ kind: 'visit_form', status: 'uploaded', partner: true }] }); }
  }
  // E) Staff awaiting IA → IA queue.
  for (let i = 0; i < 4; i++) { const s = nextSchool(); const training = i % 2 === 0; const sf = training ? sfT(i) : sfV(i); scn.push({ over: base({ activityType: training ? 'school_improvement_training' : 'school_visit', schoolId: s.id, responsibleStaffId: cceoStaffId, status: 'awaiting_ia_verification', evidenceStatus: 'accepted', salesforceActivityId: sf, salesforceActivityType: training ? 'training' : 'visit', teachersAttended: training ? 18 : null, leadersAttended: training ? 4 : null, scheduledDate: day(-6 - i), plannedMonth: 6, purposeIntervention: pick(INTERVENTIONS, idx) }), evidence: [{ kind: training ? 'attendance_form' : 'visit_form', status: 'accepted', partner: false }], verifySfId: sf }); }
  // F) IA-verified → accountant queue (staff netsuite accountability + partner payment).
  for (let i = 0; i < 3; i++) { const s = nextSchool(); const sf = sfT(100 + i); scn.push({ over: base({ activityType: 'school_improvement_training', schoolId: s.id, responsibleStaffId: cceoStaffId, status: 'ia_verified', evidenceStatus: 'accepted', iaVerificationStatus: 'confirmed', iaConfirmedAt: day(-2), iaConfirmedBy: 'seed-ia', paymentStatus: 'netsuite_accountability', salesforceActivityId: sf, salesforceActivityType: 'training', teachersAttended: 16, leadersAttended: 4, scheduledDate: day(-10 - i), plannedMonth: 5, purposeIntervention: pick(INTERVENTIONS, idx) }), evidence: [{ kind: 'attendance_form', status: 'accepted', partner: false }], payment: { path: 'staff', amount: 50000, status: 'netsuite_accountability' }, verifySfId: sf }); }
  if (partner) for (let i = 0; i < 3; i++) { const s = nextSchool(); const sf = sfT(200 + i); scn.push({ over: base({ activityType: 'training', schoolId: s.id, responsibleStaffId: cceoStaffId, assignedPartnerId: partner.id, deliveryType: 'partner', status: 'ia_verified', evidenceStatus: 'accepted', iaVerificationStatus: 'confirmed', iaConfirmedAt: day(-2), iaConfirmedBy: 'seed-ia', paymentStatus: 'ia_confirmed', salesforceActivityId: sf, salesforceActivityType: 'training', teachersAttended: 22, leadersAttended: 5, scheduledDate: day(-12 - i), plannedMonth: 5, purposeIntervention: pick(INTERVENTIONS, idx) }), evidence: [{ kind: 'attendance_form', status: 'accepted', partner: true }], payment: { path: 'partner', amount: 120000, status: 'ia_confirmed' }, verifySfId: sf }); }
  // G) Coordinator's own scheduled project activity → Coordinator My Plan.
  if (coord) { const s = schools.find((x) => x.schoolType === 'core') ?? schools[0]; scn.push({ over: base({ activityType: 'project_activity', schoolId: s.id, responsibleStaffId: coord.id, status: 'scheduled', scheduledDate: day(8), plannedMonth: 6, purposeIntervention: 'education_technology' }) }); }

  let created = 0;
  for (const s of scn) {
    const a = await prisma.activity.create({ data: s.over });
    created++;
    for (const e of s.evidence ?? []) {
      const isPhoto = e.kind === 'photo';
      await prisma.evidenceRecord.create({ data: { activityId: a.id, kind: e.kind, uri: isPhoto ? 'seed/sample.png' : 'seed/sample.pdf', mimeType: isPhoto ? 'image/png' : 'application/pdf', originalName: isPhoto ? `${e.kind}.png` : `${e.kind}.pdf`, uploadedBy: e.partner ? 'seed-partner' : 'seed-staff', status: e.status, reviewedBy: e.status === 'accepted' ? 'seed-staff' : undefined, reviewedAt: e.status === 'accepted' ? day(-2) : undefined } });
    }
    if (s.verifySfId) await prisma.activityCompletionVerification.create({ data: { activityId: a.id, salesforceId: s.verifySfId, enteredBy: 'seed-staff', status: 'confirmed', iaActorId: 'seed-ia', iaActionAt: day(-2) } }).catch(() => undefined);
    if (s.payment) { const pr = await prisma.paymentRequest.create({ data: { activityId: a.id, path: s.payment.path, amount: s.payment.amount, status: s.payment.status } }); await prisma.paymentActionLog.create({ data: { paymentRequestId: pr.id, action: 'ia_confirmed', actorId: 'seed-ia' } }).catch(() => undefined); }
  }

  // H) Monthly fund requests in the approval chain (submitted / approved / returned).
  const cd = await prisma.user.findUnique({ where: { email: 'cd@edify.org' }, select: { id: true } });
  const fundStates: { status: 'submitted' | 'approved' | 'returned'; amount: number; activities: number; note?: string }[] = [
    { status: 'submitted', amount: 1_850_000, activities: 14 },
    { status: 'approved', amount: 2_400_000, activities: 19 },
    { status: 'returned', amount: 980_000, activities: 7, note: 'Split the cluster-meeting line by sub-county before resubmitting.' },
  ];
  for (const f of fundStates) {
    await prisma.fundRequest.create({
      data: {
        fy, period: 'monthly', periodKey: `${fy}-M6`, scope: 'team',
        submittedByUserId: cceo!.id, submittedByRole: 'CCEO',
        totalAmount: f.amount, activityCount: f.activities, status: f.status,
        ...(f.status !== 'submitted' && cd ? { reviewedByUserId: cd.id, reviewedAt: day(-1), reviewNote: f.note } : {}),
      },
    });
  }

  // I) HR leave — approved leave that conflicts with a planned activity window.
  await prisma.leave.create({ data: { staffProfileId: cceoStaffId, type: 'annual', startDate: day(2).toISOString().slice(0, 10), endDate: day(5).toISOString().slice(0, 10), days: 4, reason: 'Family event', status: 'approved' } });

  console.log(`  ✓ workflows seeded: ${created} activities, ${fundStates.length} fund requests, 1 approved leave`);
  const counts = await prisma.activity.groupBy({ by: ['status'], _count: true });
  console.log(`    states: ${counts.map((c) => `${c.status}=${c._count}`).join(', ')}`);
}

async function main() {
  console.log('\n  ════════════════════════════════════════════════════════');
  console.log('  ✦  ONLINE TEST — seed roles + in-flight workflows');
  console.log('  ════════════════════════════════════════════════════════\n');
  const { coordUserId } = await ensureRoles();
  await seedWorkflows(coordUserId);
  console.log('\n  ✓ Done. All test roles can log in (password "edify"); pipeline pages now show live data.\n');
}

main()
  .catch((e) => { console.error('\n  ✗ seed-online-test-workflows failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
