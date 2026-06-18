/**
 * Online Testing — validate that all test roles can log in and the in-flight
 * workflow data exists across the pipeline. Exits non-zero on any failure so it
 * can gate CI / a pre-test checklist.
 *
 *   npm run validate:online-test-workflows
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
let failures = 0;
function check(label: string, ok: boolean, detail: string | number) {
  console.log(`  ${ok ? '✓' : '✗'}  ${label}  →  ${detail}`);
  if (!ok) failures++;
}

async function main() {
  console.log('\n  Online Testing — workflow + role validation');
  console.log('  ───────────────────────────────────────────');

  // Roles
  const roleEmails = ['cceo@edify.org', 'pl1@edify.org', 'cd@edify.org', 'rvp@edify.org', 'ia@edify.org', 'accountant@edify.org', 'hr@edify.org', 'partner@edify.org', 'coordinator@edify.org', 'admin@edify.org'];
  for (const email of roleEmails) {
    const u = await prisma.user.findUnique({ where: { email }, select: { isActive: true } });
    check(`role login active: ${email}`, !!u && u.isActive, u ? (u.isActive ? 'active' : 'INACTIVE') : 'MISSING');
  }
  const partnerLinked = await prisma.partner.count({ where: { userId: { not: null } } });
  check('partner user linked to a Partner org (Partner.userId)', partnerLinked > 0, partnerLinked);
  const coord = await prisma.user.findUnique({ where: { email: 'coordinator@edify.org' }, select: { staffProfile: { select: { id: true } } } });
  check('coordinator has a staff profile', !!coord?.staffProfile, coord?.staffProfile ? 'yes' : 'no');

  // In-flight workflow data
  const totalAct = await prisma.activity.count();
  check('activities seeded (>0)', totalAct > 0, totalAct);
  const scheduled = await prisma.activity.count({ where: { status: 'scheduled' } });
  check('My Plan has scheduled activities', scheduled > 0, scheduled);
  const awaitingIa = await prisma.activity.count({ where: { status: 'awaiting_ia_verification' } });
  check('IA queue has items (awaiting_ia_verification)', awaitingIa > 0, awaitingIa);
  const iaVerified = await prisma.activity.count({ where: { status: 'ia_verified' } });
  check('accountant queue has items (ia_verified)', iaVerified > 0, iaVerified);
  const partnerWork = await prisma.activity.count({ where: { deliveryType: 'partner' } });
  check('partner-delivered activities exist', partnerWork > 0, partnerWork);
  const evidence = await prisma.evidenceRecord.count();
  check('evidence records exist', evidence > 0, evidence);
  const payments = await prisma.paymentRequest.count();
  check('payment requests exist', payments > 0, payments);

  // Money safety invariant: NO ia_verified activity may have a 'paid' payment
  // status without IA confirmation (the gate must hold even in seeded data).
  const unsafePay = await prisma.activity.count({ where: { paymentStatus: 'paid', iaVerificationStatus: { not: 'confirmed' } } });
  check('no paid activity bypassed IA verification', unsafePay === 0, unsafePay);

  // Fund-request approval chain
  for (const status of ['submitted', 'approved', 'returned'] as const) {
    const n = await prisma.fundRequest.count({ where: { status, period: 'monthly' } });
    check(`monthly fund request in '${status}'`, n > 0, n);
  }

  // HR leave
  const leave = await prisma.leave.count({ where: { status: 'approved' } });
  check('approved HR leave exists', leave > 0, leave);

  console.log('  ───────────────────────────────────────────');
  if (failures === 0) console.log('\n  ✓ READY — all test roles + in-flight workflows present.\n');
  else console.log(`\n  ✗ ${failures} check(s) failed — run \`npm run seed:online-test-workflows\`.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
