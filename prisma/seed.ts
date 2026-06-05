/* eslint-disable no-console */
// Seed = reference data (always) + mock demo data (gated).
//
//  • Reference data — permissions, role→permission matrix, Uganda geography —
//    is real configuration and is always upserted (idempotent).
//  • Mock demo data — staff, clusters, 100 schools (70 client + 30 core),
//    SSA records, and core activities — loads ONLY when ENABLE_MOCK_DATA=true
//    and NODE_ENV !== production. Production is blocked.

import { PrismaClient, EdifyRole, SchoolType, SsaIntervention, ActivityType, ActivityStatus } from '@prisma/client';
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

const INTERVENTIONS: SsaIntervention[] = [
  'teaching_and_learning', 'financial_health', 'christlike_behaviour', 'exposure_to_word_of_god',
  'government_requirements', 'leadership', 'education_technology', 'learning_environment',
];

// Deterministic PRNG so reseeds are stable.
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(42);
const pick = <T>(arr: T[]) => arr[Math.floor(rnd() * arr.length)];
const NAME_A = ['Bright', 'Hope', 'Grace', 'Faith', 'Sunrise', 'Riverside', 'Unity', 'Victory', 'Mustard Seed', 'Cornerstone', 'New Life', 'Pioneer', 'Excel', 'Trinity', 'Bethel'];
const NAME_B = ['Primary', 'Junior', 'Academy', 'Community School', 'Christian School', 'Preparatory'];

async function seedReference() {
  const allKeys = new Set<string>();
  for (const perms of Object.values(ROLE_PERMISSIONS)) perms.forEach((p) => allKeys.add(p));
  for (const key of allKeys) await prisma.permission.upsert({ where: { key }, update: {}, create: { key } });
  for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
    for (const key of perms) {
      const perm = await prisma.permission.findUniqueOrThrow({ where: { key } });
      await prisma.rolePermission.upsert({
        where: { role_permissionId: { role: role as EdifyRole, permissionId: perm.id } },
        update: {}, create: { role: role as EdifyRole, permissionId: perm.id },
      });
    }
  }
  console.log(`✓ reference: ${allKeys.size} permissions across ${Object.keys(ROLE_PERMISSIONS).length} roles`);

  for (const [regionName, districts] of Object.entries(GEOGRAPHY)) {
    const region = await prisma.region.upsert({ where: { name: regionName }, update: {}, create: { name: regionName } });
    for (const d of districts) {
      await prisma.district.upsert({ where: { regionId_name: { regionId: region.id, name: d } }, update: {}, create: { name: d, regionId: region.id } });
    }
  }
  console.log(`✓ reference: geography seeded (${Object.keys(GEOGRAPHY).length} regions)`);
}

function ssaScoresFor(core: boolean) {
  // Core (and core candidates) score high; clients vary.
  return INTERVENTIONS.map((intervention) => {
    const base = core ? 7.5 + rnd() * 2 : 4 + rnd() * 4.5;
    return { intervention, score: Math.round(Math.min(10, base) * 10) / 10 };
  });
}
const avg = (scores: { score: number }[]) => Math.round((scores.reduce((s, x) => s + x.score, 0) / scores.length) * 10) / 10;

async function seedMock() {
  const hash = await bcrypt.hash('edify', 10);

  // Leadership + functional users.
  const baseUsers: { email: string; name: string; role: EdifyRole }[] = [
    { email: 'admin@edify.org', name: 'Edify Admin', role: 'Admin' },
    { email: 'cd@edify.org', name: 'Sarah Okello', role: 'CountryDirector' },
    { email: 'ia@edify.org', name: 'Grace Alimo', role: 'ImpactAssessment' },
    { email: 'rvp@edify.org', name: 'Robert Vance', role: 'RegionalVicePresident' },
    { email: 'accountant@edify.org', name: 'Moses Tindi', role: 'ProgramAccountant' },
    { email: 'hr@edify.org', name: 'Hellen Auma', role: 'HumanResources' },
  ];
  for (const u of baseUsers) {
    await prisma.user.upsert({ where: { email: u.email }, update: {}, create: { email: u.email, name: u.name, passwordHash: hash, roles: [u.role], activeRole: u.role } });
  }

  const districts = await prisma.district.findMany({ include: { region: true } });

  // 2 Program Leads (supervisors) + 8 CCEOs (account owners).
  const plProfiles = [];
  for (let i = 1; i <= 2; i++) {
    const u = await prisma.user.upsert({ where: { email: `pl${i}@edify.org` }, update: {}, create: { email: `pl${i}@edify.org`, name: `Program Lead ${i}`, passwordHash: hash, roles: ['CountryProgramLead'], activeRole: 'CountryProgramLead' } });
    const sp = await prisma.staffProfile.upsert({ where: { userId: u.id }, update: {}, create: { userId: u.id, onboardingState: 'active', primaryDistrictId: districts[i].id } });
    plProfiles.push(sp);
  }
  const cceoProfiles = [];
  for (let i = 1; i <= 8; i++) {
    const u = await prisma.user.upsert({ where: { email: `cceo${i}@edify.org` }, update: {}, create: { email: `cceo${i}@edify.org`, name: `CCEO Officer ${i}`, passwordHash: hash, roles: ['CCEO'], activeRole: 'CCEO' } });
    const sp = await prisma.staffProfile.upsert({ where: { userId: u.id }, update: {}, create: { userId: u.id, onboardingState: 'active', primaryDistrictId: districts[i % districts.length].id } });
    // Supervisor = one of the PLs.
    await prisma.staffSupervisorAssignment.upsert({
      where: { superviseeId_supervisorId: { superviseeId: sp.id, supervisorId: plProfiles[i % plProfiles.length].id } },
      update: {}, create: { superviseeId: sp.id, supervisorId: plProfiles[i % plProfiles.length].id },
    });
    cceoProfiles.push(sp);
  }

  // One named CCEO matching the original demo (Paul Chinyama) for continuity.
  const paulUser = await prisma.user.upsert({ where: { email: 'cceo@edify.org' }, update: {}, create: { email: 'cceo@edify.org', name: 'Paul Chinyama', passwordHash: hash, roles: ['CCEO'], activeRole: 'CCEO' } });
  const paul = await prisma.staffProfile.upsert({ where: { userId: paulUser.id }, update: {}, create: { userId: paulUser.id, onboardingState: 'active', primaryDistrictId: districts[0].id } });
  cceoProfiles.push(paul);

  // Clusters — one per district.
  const clusters = new Map<string, string>();
  for (const d of districts) {
    const c = await prisma.cluster.create({ data: { name: `${d.name} Cluster`, regionId: d.regionId, districtId: d.id } });
    clusters.set(d.id, c.id);
  }

  // 100 schools: 70 client + 30 core, distributed across districts.
  let created = 0, coreCount = 0, ssaCount = 0, activityCount = 0;
  for (let i = 0; i < 100; i++) {
    const isCore = i < 30; // first 30 = core
    const district = districts[i % districts.length];
    const schoolId = String(40000 + i * 137); // deterministic numeric ids
    if (await prisma.school.findUnique({ where: { schoolId } })) continue;

    const owner = cceoProfiles[i % cceoProfiles.length];
    const clustered = rnd() > 0.15; // ~85% clustered
    const hasSsa = isCore || rnd() > 0.25; // core always; ~75% of clients

    const school = await prisma.school.create({
      data: {
        schoolId, name: `${pick(NAME_A)} ${pick(NAME_B)} (${district.name})`,
        regionId: district.regionId, districtId: district.id,
        schoolType: isCore ? SchoolType.core : SchoolType.client,
        enrollment: 120 + Math.floor(rnd() * 600),
        accountOwnerId: owner.id, accountOwnerNameRaw: 'auto', accountOwnerStatus: 'matched',
        clusterId: clustered ? clusters.get(district.id) : null,
        clusterStatus: clustered ? 'clustered' : 'unclustered',
        schoolPhone: `+25670${String(1000000 + i).slice(-7)}`,
        createdByIa: true,
      },
    });
    await prisma.staffSchoolAssignment.upsert({ where: { staffId_schoolId: { staffId: owner.id, schoolId: school.id } }, update: {}, create: { staffId: owner.id, schoolId: school.id } });
    created++;
    if (isCore) coreCount++;

    if (hasSsa) {
      const scores = ssaScoresFor(isCore);
      const ssa = await prisma.ssaRecord.create({
        data: {
          schoolId: school.id, dateOfSsa: new Date(Date.UTC(2026, 0, 1 + (i % 90))), fy: '2026', quarter: 'Q2',
          newEnrollment: school.enrollment, averageScore: avg(scores), uploadedBy: 'ia-seed',
          verificationStatus: isCore ? 'confirmed' : 'pending',
          scores: { create: scores },
        },
      });
      await prisma.school.update({ where: { id: school.id }, data: { currentFySsaStatus: 'done', planningReadiness: clustered ? 'ready' : 'limited' } });
      await prisma.schoolEnrollmentHistory.upsert({ where: { schoolId_fy: { schoolId: school.id, fy: '2026' } }, update: {}, create: { schoolId: school.id, fy: '2026', enrollment: school.enrollment! } });
      void ssa;
      ssaCount++;
    }

    // Core schools get a 4-visit + 4-training package as generic Activities.
    if (isCore) {
      const partnerDelivered = rnd() > 0.6;
      for (const type of ['core_visit', 'core_training'] as ActivityType[]) {
        for (let n = 1; n <= 4; n++) {
          const done = n <= (type === 'core_visit' ? 2 + Math.floor(rnd() * 3) : 1 + Math.floor(rnd() * 3));
          await prisma.activity.create({
            data: {
              activityType: type, schoolId: school.id, fy: '2026', quarter: 'Q2',
              responsibleStaffId: owner.id, deliveryType: partnerDelivered ? 'partner' : 'staff',
              status: done ? ActivityStatus.completed : ActivityStatus.not_planned,
              purposeIntervention: INTERVENTIONS[(n - 1) % INTERVENTIONS.length],
              salesforceActivityId: done ? (type === 'core_visit' ? `SV-${schoolId}${n}` : `TS-${schoolId}${n}`) : null,
              salesforceActivityType: type === 'core_visit' ? 'visit' : 'training',
              iaVerificationStatus: done ? 'confirmed' : 'pending',
              iaConfirmedAt: done ? new Date() : null,
            },
          });
          activityCount++;
        }
      }
    }
  }

  console.log(`✓ mock: ${created} schools (${coreCount} core / ${created - coreCount} client), ${ssaCount} SSA records, ${activityCount} core activities`);
  console.log(`✓ mock: ${cceoProfiles.length} CCEOs, ${plProfiles.length} PLs, ${clusters.size} clusters; all passwords "edify"`);
}

async function main() {
  await seedReference();
  if (IS_PROD) { console.log('• production: skipping mock data (blocked)'); return; }
  if (!MOCK) { console.log('• ENABLE_MOCK_DATA=false: skipping mock data'); return; }
  await seedMock();
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
