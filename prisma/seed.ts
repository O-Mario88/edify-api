/* eslint-disable no-console */
// Seed = reference data (always) + mock demo data (gated).
//
//  • Reference data — permissions, role→permission matrix, Uganda geography —
//    is real configuration and is always upserted (idempotent).
//  • Mock demo data — demo users + demo schools — loads ONLY when
//    ENABLE_MOCK_DATA=true and NODE_ENV !== production. Production is blocked.

import { PrismaClient, EdifyRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { ROLE_PERMISSIONS } from '../src/common/rbac/permissions';

const prisma = new PrismaClient();

const MOCK = ['1', 'true', 'yes'].includes((process.env.ENABLE_MOCK_DATA ?? '').toLowerCase());
const IS_PROD = process.env.NODE_ENV === 'production';

// Minimal Uganda geography seed (extend later via the geography module).
const GEOGRAPHY: Record<string, string[]> = {
  Northern: ['Gulu', 'Lira', 'Kitgum', 'Pader', 'Agago'],
  Eastern: ['Soroti', 'Arapai', 'Mbale', 'Tororo'],
  Central: ['Kampala', 'Wakiso', 'Mukono', 'Kira'],
  Western: ['Mbarara', 'Kabale', 'Fort Portal'],
};

async function seedReference() {
  // Permissions + role matrix.
  const allKeys = new Set<string>();
  for (const perms of Object.values(ROLE_PERMISSIONS)) perms.forEach((p) => allKeys.add(p));
  for (const key of allKeys) {
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
  console.log(`✓ reference: ${allKeys.size} permissions across ${Object.keys(ROLE_PERMISSIONS).length} roles`);

  // Geography.
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
  console.log(`✓ reference: geography seeded (${Object.keys(GEOGRAPHY).length} regions)`);
}

async function seedMock() {
  const hash = await bcrypt.hash('edify', 10);
  const users: { email: string; name: string; role: EdifyRole }[] = [
    { email: 'admin@edify.org', name: 'Edify Admin', role: 'Admin' },
    { email: 'cd@edify.org', name: 'Sarah Okello', role: 'CountryDirector' },
    { email: 'ia@edify.org', name: 'Grace Alimo', role: 'ImpactAssessment' },
    { email: 'pl@edify.org', name: 'Paul Lead', role: 'CountryProgramLead' },
    { email: 'cceo@edify.org', name: 'Paul Chinyama', role: 'CCEO' },
    { email: 'accountant@edify.org', name: 'Moses Tindi', role: 'ProgramAccountant' },
  ];
  for (const u of users) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { email: u.email, name: u.name, passwordHash: hash, roles: [u.role], activeRole: u.role },
    });
  }

  // A demo CCEO staff profile to own schools.
  const cceoUser = await prisma.user.findUniqueOrThrow({ where: { email: 'cceo@edify.org' } });
  const wakiso = await prisma.district.findFirstOrThrow({ where: { name: 'Wakiso' } });
  const cceoStaff = await prisma.staffProfile.upsert({
    where: { userId: cceoUser.id },
    update: {},
    create: { userId: cceoUser.id, onboardingState: 'active', primaryDistrictId: wakiso.id },
  });

  // Demo schools uploaded into the directory (owner = Paul Chinyama).
  const demoSchools = [
    { schoolId: '51884', name: 'Wakiso Grace Academy', district: 'Wakiso' },
    { schoolId: '40118', name: 'Soroti Faith Junior', district: 'Soroti' },
    { schoolId: '90050', name: 'Gulu Pece Primary', district: 'Gulu' },
  ];
  for (const s of demoSchools) {
    const district = await prisma.district.findFirstOrThrow({ where: { name: s.district }, include: { region: true } });
    const existing = await prisma.school.findUnique({ where: { schoolId: s.schoolId } });
    if (existing) continue;
    const school = await prisma.school.create({
      data: {
        schoolId: s.schoolId, name: s.name, regionId: district.regionId, districtId: district.id,
        accountOwnerNameRaw: 'Paul Chinyama', accountOwnerId: cceoStaff.id, accountOwnerStatus: 'matched',
        createdByIa: true,
      },
    });
    await prisma.staffSchoolAssignment.upsert({
      where: { staffId_schoolId: { staffId: cceoStaff.id, schoolId: school.id } },
      update: {}, create: { staffId: cceoStaff.id, schoolId: school.id },
    });
  }
  console.log(`✓ mock: ${users.length} users (password "edify"), ${demoSchools.length} demo schools`);
}

async function main() {
  await seedReference();
  if (IS_PROD) {
    console.log('• production: skipping mock data (blocked)');
    return;
  }
  if (!MOCK) {
    console.log('• ENABLE_MOCK_DATA=false: skipping mock data');
    return;
  }
  await seedMock();
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
