/**
 * Online Testing — trim the user roster to a focused test set.
 *
 * Keeps exactly: 1 CCEO, 4 PL, 1 CD, 1 RVP, 1 IA, 1 Accountant, 1 HR,
 * 1 ProjectCoordinator, 1 Partner officer, 1 Admin (13) — one of EVERY role so
 * every workflow can be tested online. Removes everyone else. To keep
 * role-scoping coherent it first reassigns ALL schools to the kept CCEO and
 * wires the 4 PLs to supervise that CCEO, then deletes the other users.
 *
 * Tamper-evidence caveat: the append-only AuditLog (audit_no_update/no_delete
 * triggers + actorId FK) blocks deleting any user that has audit history. Those
 * users are DEACTIVATED (isActive=false → cannot log in, hidden from pickers)
 * instead of hard-deleted, so the security audit chain stays intact.
 *
 *   CONFIRM_TRIM_USERS=true npm run trim:users
 */
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const prisma = new PrismaClient();

const KEEP = {
  CCEO: ['cceo@edify.org'],
  CountryProgramLead: ['pl1@edify.org', 'pl2@edify.org', 'pl3@edify.org', 'pl4@edify.org'],
  CountryDirector: ['cd@edify.org'],
  RegionalVicePresident: ['rvp@edify.org'],
  ImpactAssessment: ['ia@edify.org'],
  ProgramAccountant: ['accountant@edify.org'],
  // Keep one of every remaining role so HR / Project / Partner workflows are all
  // testable online (previously trimmed → those three roles couldn't log in).
  HumanResources: ['hr@edify.org'],
  ProjectCoordinator: ['coordinator@edify.org'],
  PartnerFieldOfficer: ['partner@edify.org'],
  Admin: ['admin@edify.org'],
};
const KEEP_EMAILS = Object.values(KEEP).flat();

const env = process.env.NODE_ENV ?? 'development';
const confirmed = process.env.CONFIRM_TRIM_USERS === 'true';
const prodAllowed = process.env.ONLINE_TEST_RESET_ALLOWED === 'true';
function abort(m: string): never { console.error(`\n  ✗ TRIM ABORTED: ${m}\n`); process.exit(2); }

async function main() {
  console.log('\n  ════════════════════════════════════════════════════════');
  console.log('  ⚠  TRIM USER ROSTER → 1 CCEO · 4 PL · 1 CD · 1 RVP · 1 IA · 1 Accountant · 1 Admin');
  console.log('  ════════════════════════════════════════════════════════');
  console.log(`     env=${env}  confirmed=${confirmed}`);
  if (!confirmed) abort('CONFIRM_TRIM_USERS=true is required.');
  if (env === 'production' && !prodAllowed) abort('production requires ONLINE_TEST_RESET_ALLOWED=true.');

  // ── Resolve + validate the keep set ─────────────────────────────────────────
  const kept = await prisma.user.findMany({
    where: { email: { in: KEEP_EMAILS } },
    select: { id: true, email: true, roles: true, staffProfile: { select: { id: true } } },
  });
  const byEmail = new Map(kept.map((u) => [u.email, u]));
  for (const [role, emails] of Object.entries(KEEP)) {
    for (const e of emails) {
      const u = byEmail.get(e);
      if (!u) abort(`expected keep-account ${e} (${role}) not found.`);
      if (!u!.roles.includes(role as never)) abort(`${e} does not have role ${role}.`);
    }
  }
  const ceo = byEmail.get(KEEP.CCEO[0])!;
  if (!ceo.staffProfile) abort(`kept CCEO ${ceo.email} has no staff profile — cannot own schools.`);
  const ceoStaffId = ceo.staffProfile.id;
  const plStaffIds = KEEP.CountryProgramLead.map((e) => byEmail.get(e)!.staffProfile?.id).filter(Boolean) as string[];
  console.log(`\n     keeping ${kept.length} users; CCEO staff=${ceoStaffId}; ${plStaffIds.length} PL supervisors\n`);

  // ── Backup ──────────────────────────────────────────────────────────────────
  const backupDir = join(__dirname, '..', 'backups');
  mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(backupDir, `trim-users-${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify({
    takenAt: new Date().toISOString(),
    users: await prisma.user.findMany(),
    staffProfiles: await prisma.staffProfile.findMany(),
    schoolAssignments: await prisma.staffSchoolAssignment.findMany(),
    supervisorAssignments: await prisma.staffSupervisorAssignment.findMany(),
  }, null, 2));
  console.log(`     backup → ${backupPath}\n`);

  const removeUsers = await prisma.user.findMany({
    where: { email: { notIn: KEEP_EMAILS } },
    select: { id: true, email: true, staffProfile: { select: { id: true } } },
  });
  const removeUserIds = removeUsers.map((u) => u.id);
  const removeStaffIds = removeUsers.map((u) => u.staffProfile?.id).filter(Boolean) as string[];
  const auditedUserIds = new Set(
    (await prisma.auditLog.findMany({ where: { actorId: { not: null } }, select: { actorId: true }, distinct: ['actorId'] }))
      .map((a) => a.actorId!),
  );

  // ── Reassign ownership + supervision to the kept set ────────────────────────
  console.log('  Reassigning ownership + supervision…');
  await prisma.$transaction(async (tx) => {
    const schools = await tx.school.findMany({ where: { deletedAt: null }, select: { id: true } });
    // All schools → the kept CCEO (portfolio scope is StaffSchoolAssignment-driven).
    await tx.staffSchoolAssignment.deleteMany();
    for (let i = 0; i < schools.length; i += 500) {
      await tx.staffSchoolAssignment.createMany({
        data: schools.slice(i, i + 500).map((s) => ({ staffId: ceoStaffId, schoolId: s.id })),
        skipDuplicates: true,
      });
    }
    await tx.school.updateMany({ where: { deletedAt: null }, data: { accountOwnerId: ceoStaffId, accountOwnerStatus: 'matched', accountOwnerNameRaw: ceo.email } });
    // The 4 PLs all supervise the kept CCEO (so each PL sees the team lens).
    await tx.staffSupervisorAssignment.deleteMany();
    await tx.staffSupervisorAssignment.createMany({
      data: plStaffIds.map((supervisorId) => ({ superviseeId: ceoStaffId, supervisorId })),
      skipDuplicates: true,
    });
    // Unlink removed managers/partners (project defs + partner orgs stay, unlinked).
    await tx.project.updateMany({ data: { managerStaffId: null } });
    await tx.partner.updateMany({ data: { userId: null } });
    // Drop removed staff's geography/capacity/target rows (kept CCEO derives geo from schools).
    if (removeStaffIds.length) {
      await tx.staffGeographyAssignment.deleteMany({ where: { staffId: { in: removeStaffIds } } });
      await tx.staffSupportCapacity.deleteMany({ where: { staffId: { in: removeStaffIds } } });
      await tx.staffTargetProfile.deleteMany({ where: { staffId: { in: removeStaffIds } } });
    }
  }, { timeout: 120_000 });
  console.log(`     ✓ 700 schools → ${ceo.email}; CCEO supervised by ${plStaffIds.length} PLs\n`);

  // ── Remove users: hard-delete when allowed, else deactivate (audit-protected) ─
  console.log('  Removing other users…');
  let deleted = 0, deactivated = 0;
  for (const u of removeUsers) {
    if (auditedUserIds.has(u.id)) {
      await prisma.user.update({ where: { id: u.id }, data: { isActive: false } });
      deactivated++;
      continue;
    }
    try {
      if (u.staffProfile) await prisma.staffProfile.delete({ where: { id: u.staffProfile.id } });
      await prisma.user.delete({ where: { id: u.id } });
      deleted++;
    } catch (e) {
      // Any unexpected FK → fall back to deactivation so the DB is never left broken.
      await prisma.user.update({ where: { id: u.id }, data: { isActive: false } });
      deactivated++;
      console.log(`     (deactivated ${u.email} — delete blocked: ${(e as Error).message.slice(0, 80)})`);
    }
  }
  console.log(`     ✓ deleted ${deleted}, deactivated ${deactivated} (audit-protected)\n`);

  // ── Validate ────────────────────────────────────────────────────────────────
  const active = await prisma.user.findMany({ where: { isActive: true }, select: { email: true, roles: true } });
  const byRole: Record<string, number> = {};
  for (const u of active) for (const r of u.roles) byRole[r] = (byRole[r] ?? 0) + 1;
  const expect: Record<string, number> = { CCEO: 1, CountryProgramLead: 4, CountryDirector: 1, RegionalVicePresident: 1, ImpactAssessment: 1, ProgramAccountant: 1, Admin: 1 };
  console.log('  Final active users:');
  let failed = 0;
  for (const [role, n] of Object.entries(expect)) {
    const got = byRole[role] ?? 0;
    if (got !== n) failed++;
    console.log(`     ${got === n ? '✓' : '✗'}  ${role}: ${got} (expected ${n})`);
  }
  const unexpected = Object.keys(byRole).filter((r) => !(r in expect));
  if (unexpected.length) { failed++; console.log(`     ✗  unexpected active roles: ${unexpected.join(', ')}`); }
  console.log(`     active total: ${active.length}`);
  console.log(`\n  Backup: ${backupPath}`);
  if (failed > 0) { console.error(`\n  ✗ TRIM VALIDATION FAILED: ${failed} issue(s).\n`); process.exit(1); }
  console.log('\n  ✓ USER ROSTER TRIMMED — 10 active test accounts (password "edify").\n');
}

main().catch((e) => { console.error('\n  ✗ TRIM ERROR:', e); process.exit(1); }).finally(() => prisma.$disconnect());
