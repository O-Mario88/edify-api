/* eslint-disable no-console */
// FINAL DEMO SEED
// ───────────────────────────────────────────────────────────────────────────
// Builds a complete, backend-driven demo dataset so the whole operating
// workflow is testable end-to-end:
//   School Directory → Geography → Clusters → SSA → Planning → My Plan →
//   Execution → Evidence → Salesforce/Netsuite → IA → Accountant → Completed Log.
//
//  • Reference data — permissions, role matrix — always upserted.
//  • Geography — REAL Uganda regions/districts/sub-counties/parishes
//    (prisma/geography-data.ts), replacing the old fabricated fixtures.
//  • Demo data — staff, partners, ~700 schools (every field populated),
//    single- AND multi-sub-county clusters, SSA, and activities seeded in
//    EVERY workflow state so each surface (Planning, My Plan, Partner work,
//    IA queue, Accountant, Completed Log) has live data. Loads only when
//    ENABLE_MOCK_DATA=true and NODE_ENV !== production.
//
// Run: `npm run seed`  (ENABLE_MOCK_DATA=true is set in .env)

import {
  PrismaClient, Prisma, EdifyRole, SchoolType, SsaIntervention, ActivityType, ActivityStatus,
  ClusterType, ClusterRecordStatus, ProjectCategory, EvidenceKind, EvidenceStatus, PaymentPath,
  PaymentStatus, DeliveryType, VerificationStatus,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { ROLE_PERMISSIONS } from '../src/common/rbac/permissions';
import { UGANDA_GEOGRAPHY, DISTRICT_CENTROIDS } from './geography-data';

const prisma = new PrismaClient();
const MOCK = ['1', 'true', 'yes'].includes((process.env.ENABLE_MOCK_DATA ?? '').toLowerCase());
const IS_PROD = process.env.NODE_ENV === 'production';

// ── Deterministic RNG so reseeds are stable ────────────────────────────────
function mulberry32(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rnd = mulberry32(2026);
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
const ri = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

const INTERVENTIONS: SsaIntervention[] = [
  'teaching_and_learning', 'financial_health', 'christlike_behaviour', 'exposure_to_word_of_god',
  'government_requirements', 'leadership', 'education_technology', 'learning_environment',
];
const NAME_A = ['Bright', 'Hope', 'Grace', 'Faith', 'Sunrise', 'Riverside', 'Unity', 'Victory', 'Mustard Seed', 'Cornerstone', 'New Life', 'Pioneer', 'Excel', 'Trinity', 'Bethel', 'St. Mary', 'St. John', 'Canaan', 'Greenhill', 'Kings', 'Light', 'Harvest', 'Rock', 'Living Water', 'Royal', 'Nile', 'Equator', 'Pearl', 'Mountain View', 'Glory'];
const NAME_B = ['Primary School', 'Junior School', 'Academy', 'Community School', 'Christian School', 'Preparatory School', 'Day & Boarding', 'Parents School', 'Infant School'];
const CONTACT_FIRST = ['Joseph', 'Mary', 'Robert', 'Agnes', 'Samuel', 'Florence', 'David', 'Joyce', 'Emmanuel', 'Betty', 'Patrick', 'Sarah', 'Geoffrey', 'Esther', 'Moses', 'Rebecca', 'Daniel', 'Susan', 'Isaac', 'Grace'];
const CONTACT_LAST = ['Okello', 'Nakato', 'Mugisha', 'Auma', 'Ssali', 'Apio', 'Kato', 'Namuli', 'Wanyama', 'Achan', 'Tumwine', 'Nabukenya', 'Opio', 'Akello', 'Byaruhanga', 'Nansubuga', 'Ochieng', 'Atim', 'Mukasa', 'Adong'];

const CCEO_NAMES = ['Paul Chinyama', 'Grace Nansubuga', 'Peter Ochieng', 'Sarah Khan', 'Sarah Namutebi', 'James Okot', 'Mary Akello', 'John Tabu', 'Esther Lamwaka', 'David Oloya', 'Ruth Adong', 'Moses Wanyama', 'Janet Achieng', 'Tom Ssemwogerere', 'Brenda Atim', 'Isaac Mukasa', 'Lydia Nakato', 'Henry Okello', 'Patience Auma', 'Caleb Kirya', 'Joy Nabwire', 'Simon Etori', 'Faith Among', 'Daniel Komakech'];
const PL_NAMES = ['Daniel Mwangi', 'Aisha Dar', 'Samuel Kato', 'Rachel Apio'];

// ── Scale ──────────────────────────────────────────────────────────────────
const TOTAL_SCHOOLS = 700;
const NUM_PLS = 4;
const CCEOS_PER_PL = 5; // → 20 CCEOs
const PL_OWN_SCHOOLS = 6;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
const ssaScores = (core: boolean) => INTERVENTIONS.map((intervention) => {
  const base = core ? 7.2 + rnd() * 2.4 : 3.5 + rnd() * 4.5;
  return { intervention, score: Math.round(Math.min(10, base) * 10) / 10 };
});
const avg = (s: { score: number }[]) => Math.round((s.reduce((a, x) => a + x.score, 0) / s.length) * 10) / 10;

// ── Reference: permissions + role matrix ───────────────────────────────────
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
  console.log(`✓ reference: ${keys.size} permissions, role matrix`);
}

type ScRow = { id: string; name: string; districtId: string; districtName: string; regionId: string; regionName: string; parishIds: string[] };

// ── Geography: rebuild REAL Uganda geography (runs after purge) ─────────────
async function seedGeography(): Promise<ScRow[]> {
  // After purge there are no school/cluster refs, so we can rebuild cleanly.
  await prisma.parish.deleteMany();
  await prisma.subCounty.deleteMany();

  const datasetDistricts = new Set<string>();
  for (const r of UGANDA_GEOGRAPHY) for (const d of r.districts) datasetDistricts.add(`${r.name}::${d.name}`);

  const subCounties: ScRow[] = [];
  for (const region of UGANDA_GEOGRAPHY) {
    const reg = await prisma.region.upsert({ where: { name: region.name }, update: {}, create: { name: region.name } });
    for (const district of region.districts) {
      const cc = DISTRICT_CENTROIDS[district.name];
      const dist = await prisma.district.upsert({
        where: { regionId_name: { regionId: reg.id, name: district.name } },
        update: { regionId: reg.id, latitude: cc?.lat, longitude: cc?.lng },
        create: { name: district.name, regionId: reg.id, latitude: cc?.lat, longitude: cc?.lng },
      });
      for (const sc of district.subCounties) {
        const sub = await prisma.subCounty.create({ data: { name: sc.name, districtId: dist.id, seeded: false } });
        const parishIds: string[] = [];
        for (const p of sc.parishes) {
          const par = await prisma.parish.create({ data: { name: p, subCountyId: sub.id } });
          parishIds.push(par.id);
        }
        subCounties.push({ id: sub.id, name: sc.name, districtId: dist.id, districtName: district.name, regionId: reg.id, regionName: region.name, parishIds });
      }
    }
  }
  // Remove stray districts from old fixtures (no FK refs remain after purge).
  const allDistricts = await prisma.district.findMany({ include: { region: true } });
  for (const d of allDistricts) {
    if (!datasetDistricts.has(`${d.region.name}::${d.name}`)) {
      await prisma.district.delete({ where: { id: d.id } }).catch(() => undefined);
    }
  }
  const regions = await prisma.region.count();
  const districts = await prisma.district.count();
  console.log(`✓ geography: ${regions} regions, ${districts} districts, ${subCounties.length} sub-counties, ${subCounties.reduce((a, s) => a + s.parishIds.length, 0)} parishes`);
  return subCounties;
}

type Staff = { id: string; userId: string; name: string };

// ── Staff + partner users ──────────────────────────────────────────────────
async function seedStaff(districtIds: string[]) {
  // Demo password is env-overridable for a per-event secret (defaults to 'edify'
  // for local dev). MUST stay in lockstep with the FE runtime store + the bridge
  // (edify-web: DEMO_LOGIN_PASSWORD) — reseed after changing it.
  const hash = await bcrypt.hash(process.env.DEMO_LOGIN_PASSWORD ?? 'edify', 10);
  const baseUsers: { email: string; name: string; role: EdifyRole }[] = [
    { email: 'admin@edify.org', name: 'Edify Admin', role: 'Admin' },
    { email: 'cd@edify.org', name: 'Sarah Okello', role: 'CountryDirector' },
    { email: 'ia@edify.org', name: 'Grace Alimo', role: 'ImpactAssessment' },
    { email: 'rvp@edify.org', name: 'Robert Vance', role: 'RegionalVicePresident' },
    { email: 'accountant@edify.org', name: 'Moses Tindi', role: 'ProgramAccountant' },
    { email: 'hr@edify.org', name: 'Hellen Auma', role: 'HumanResources' },
    { email: 'coordinator@edify.org', name: 'Allan Ssentongo', role: 'ProjectCoordinator' },
    { email: 'partner@edify.org', name: 'Literacy Uganda Officer', role: 'PartnerFieldOfficer' },
  ];
  // The privileged admin account is not seeded in production unless explicitly
  // enabled (mirrors the FE ENABLE_DEMO_ADMIN gate) — so a forged admin cookie
  // can't mint a backend admin token in a hosted test.
  const adminEnabled = process.env.ENABLE_DEMO_ADMIN === 'true' || process.env.NODE_ENV !== 'production';
  for (const u of baseUsers) {
    if (u.email === 'admin@edify.org' && !adminEnabled) continue;
    await prisma.user.upsert({ where: { email: u.email }, update: { name: u.name, roles: [u.role], activeRole: u.role }, create: { email: u.email, name: u.name, passwordHash: hash, roles: [u.role], activeRole: u.role } });
  }

  // Project Coordinator gets a staff profile (so coordinator activities show in My Plan).
  const coordUser = await prisma.user.findUniqueOrThrow({ where: { email: 'coordinator@edify.org' } });
  const coordProfile = await prisma.staffProfile.upsert({ where: { userId: coordUser.id }, update: {}, create: { userId: coordUser.id, onboardingState: 'active', primaryDistrictId: districtIds[0] } });
  const coord: Staff = { id: coordProfile.id, userId: coordUser.id, name: coordUser.name };

  const pls: Staff[] = [];
  for (let i = 1; i <= NUM_PLS; i++) {
    const name = PL_NAMES[i - 1] ?? `Program Lead ${i}`;
    const u = await prisma.user.upsert({ where: { email: `pl${i}@edify.org` }, update: { name }, create: { email: `pl${i}@edify.org`, name, passwordHash: hash, roles: ['CountryProgramLead'], activeRole: 'CountryProgramLead' } });
    const sp = await prisma.staffProfile.upsert({ where: { userId: u.id }, update: {}, create: { userId: u.id, onboardingState: 'active', primaryDistrictId: districtIds[i % districtIds.length] } });
    pls.push({ id: sp.id, userId: u.id, name });
  }
  const cceos: Staff[] = [];
  const NUM_CCEOS = NUM_PLS * CCEOS_PER_PL;
  for (let i = 0; i < NUM_CCEOS; i++) {
    const email = i === 0 ? 'cceo@edify.org' : `cceo${i}@edify.org`;
    const name = CCEO_NAMES[i % CCEO_NAMES.length] + (i >= CCEO_NAMES.length ? ` ${Math.floor(i / CCEO_NAMES.length) + 1}` : '');
    const u = await prisma.user.upsert({ where: { email }, update: { name }, create: { email, name, passwordHash: hash, roles: ['CCEO'], activeRole: 'CCEO' } });
    const sp = await prisma.staffProfile.upsert({ where: { userId: u.id }, update: {}, create: { userId: u.id, onboardingState: 'active', primaryDistrictId: districtIds[i % districtIds.length] } });
    await prisma.staffSupervisorAssignment.create({ data: { superviseeId: sp.id, supervisorId: pls[Math.floor(i / CCEOS_PER_PL)].id } });
    cceos.push({ id: sp.id, userId: u.id, name });
  }
  console.log(`✓ staff: ${cceos.length} CCEOs, ${pls.length} PLs, 1 ProjectCoordinator, +8 role users (password "edify")`);
  return { pls, cceos, coord };
}

// ── Clusters: single + multi-sub-county, ~60% sub-county coverage ───────────
type ClusterRec = { id: string; districtId: string; subCountyIds: string[]; subCountyNames: string[] };
async function seedClusters(subCounties: ScRow[]): Promise<{ byPrimarySub: Map<string, ClusterRec>; coverageBySub: Map<string, ClusterRec> }> {
  const byDistrict = new Map<string, ScRow[]>();
  for (const sc of subCounties) {
    const arr = byDistrict.get(sc.districtId) ?? [];
    arr.push(sc); byDistrict.set(sc.districtId, arr);
  }
  const byPrimarySub = new Map<string, ClusterRec>();
  const coverageBySub = new Map<string, ClusterRec>();
  let leaderIdx = 0;
  const leaderPhone = () => `+25677${String(3000000 + leaderIdx++).slice(-7)}`;

  const makeCluster = async (district: ScRow[], covered: ScRow[], name: string) => {
    const primary = covered[0];
    const leaderName = `${pick(CONTACT_FIRST)} ${pick(CONTACT_LAST)}`;
    const cl = await prisma.cluster.create({
      data: {
        name, regionId: primary.regionId, districtId: primary.districtId,
        subCountyId: primary.id, subCountyName: primary.name,
        clusterType: ClusterType.mixed, status: ClusterRecordStatus.active,
        clusterLeaderName: leaderName, clusterLeaderPhone: leaderPhone(),
        coveredSubCounties: { create: covered.map((s) => ({ subCountyId: s.id })) },
      },
    });
    const rec: ClusterRec = { id: cl.id, districtId: primary.districtId, subCountyIds: covered.map((s) => s.id), subCountyNames: covered.map((s) => s.name) };
    byPrimarySub.set(primary.id, rec);
    for (const s of covered) coverageBySub.set(s.id, rec);
    return rec;
  };

  for (const [, subs] of byDistrict) {
    const districtName = subs[0].districtName;
    // Showcase the spec example: Lira gets a MULTI-sub-county cluster covering
    // its first three sub-counties (Adekokwok, Agali, Barr), leaving the rest
    // for single clusters / unclustered (so the demo can create + assign live).
    if (districtName === 'Lira' && subs.length >= 4) {
      await makeCluster(subs, subs.slice(0, 3), 'Lira North Cluster'); // Adekokwok + Agali + Barr
      await makeCluster(subs, [subs[3]], `${subs[3].name} Cluster`); // Ogur — single
      // subs[4] (Amach) intentionally left unclustered for the live demo.
      continue;
    }
    // Other districts: cluster ~60% of sub-counties (single), leave the rest open.
    const clusterCount = Math.max(1, Math.round(subs.length * 0.6));
    for (let i = 0; i < clusterCount; i++) {
      await makeCluster(subs, [subs[i]], `${subs[i].name} Cluster`);
    }
  }
  console.log(`✓ clusters: ${byPrimarySub.size} active (incl. 1 multi-sub-county "Lira North Cluster"); ${coverageBySub.size} sub-counties covered`);
  return { byPrimarySub, coverageBySub };
}

type SchoolRow = {
  ext: string; dbId: string; name: string; schoolType: SchoolType;
  regionId: string; districtId: string; districtName: string; subCountyId: string; subCountyName: string; parishId: string;
  ownerId: string; clusterId: string | null; clustered: boolean; ssaDone: boolean;
};

// ── 700 schools, every field populated ─────────────────────────────────────
async function seedSchools(subCounties: ScRow[], owners: Staff[], coverageBySub: Map<string, ClusterRec>): Promise<SchoolRow[]> {
  type Create = Prisma.SchoolCreateManyInput & { _ownerId: string; _clusterId: string | null; _clustered: boolean; _ssaDone: boolean; _districtName: string; _subCountyName: string; _ext: string };
  const creates: Create[] = [];
  for (let gi = 0; gi < TOTAL_SCHOOLS; gi++) {
    const isCore = gi % 3 === 0;
    const sc = subCounties[gi % subCounties.length];
    const parishId = sc.parishIds[gi % sc.parishIds.length];
    const owner = owners[gi % owners.length];
    const cluster = coverageBySub.get(sc.id) ?? null;
    // 80% of schools in a covered sub-county are assigned; 20% left eligible-but-
    // unassigned so the demo can assign them. Uncovered sub-counties → unclustered.
    const clustered = !!cluster && gi % 5 !== 0;
    const ssaDone = isCore ? gi % 10 !== 0 : gi % 10 < 6; // core ~90%, client ~60%
    const ext = String(50000 + gi);
    const contact = `${pick(CONTACT_FIRST)} ${pick(CONTACT_LAST)}`;
    const village = `${sc.name}`;
    creates.push({
      schoolId: ext,
      name: `${pick(NAME_A)} ${pick(NAME_B)}`,
      regionId: sc.regionId, districtId: sc.districtId, subCountyId: sc.id, parishId,
      shippingAddress: `Plot ${ri(1, 240)}, ${village}, ${sc.name}, ${sc.districtName}`,
      schoolPhone: `+25670${String(2000000 + gi).slice(-7)}`,
      primaryContactName: contact,
      primaryContactPhone: `+25675${String(4000000 + gi).slice(-7)}`,
      enrollment: ri(120, 800),
      schoolType: isCore ? SchoolType.core : SchoolType.client,
      accountOwnerId: owner.id, accountOwnerNameRaw: owner.name, accountOwnerStatus: 'matched',
      clusterId: clustered ? cluster!.id : null,
      clusterStatus: clustered ? 'clustered' : 'unclustered',
      currentFySsaStatus: ssaDone ? 'done' : 'not_done',
      planningReadiness: clustered && ssaDone ? 'ready' : clustered || ssaDone ? 'limited' : 'locked',
      createdByIa: true,
      _ownerId: owner.id, _clusterId: clustered ? cluster!.id : null, _clustered: clustered,
      _ssaDone: ssaDone, _districtName: sc.districtName, _subCountyName: sc.name, _ext: ext,
    });
  }
  const bare = creates.map(({ _ownerId, _clusterId, _clustered, _ssaDone, _districtName, _subCountyName, _ext, ...rest }) => rest);
  for (const c of chunk(bare, 500)) await prisma.school.createMany({ data: c, skipDuplicates: true });
  const dbSchools = await prisma.school.findMany({ select: { id: true, schoolId: true } });
  const idByExt = new Map(dbSchools.map((s) => [s.schoolId, s.id]));

  // Portfolio assignments + cluster memberships + enrollment history.
  const portfolio = creates.map((r) => ({ staffId: r._ownerId, schoolId: idByExt.get(r._ext)! }));
  for (const c of chunk(portfolio, 500)) await prisma.staffSchoolAssignment.createMany({ data: c, skipDuplicates: true });
  const memberships = creates.filter((r) => r._clusterId).map((r) => ({ schoolId: idByExt.get(r._ext)!, clusterId: r._clusterId!, assignedBy: 'seed' }));
  for (const c of chunk(memberships, 500)) await prisma.schoolClusterAssignment.createMany({ data: c, skipDuplicates: true });
  const enrol = creates.filter((r) => r._ssaDone).map((r) => ({ schoolId: idByExt.get(r._ext)!, fy: '2026', enrollment: (r.enrollment as number) ?? 300 }));
  for (const c of chunk(enrol, 500)) await prisma.schoolEnrollmentHistory.createMany({ data: c, skipDuplicates: true });

  const rows: SchoolRow[] = creates.map((r) => ({
    ext: r._ext, dbId: idByExt.get(r._ext)!, name: r.name, schoolType: r.schoolType as SchoolType,
    regionId: r.regionId, districtId: r.districtId, districtName: r._districtName,
    subCountyId: r.subCountyId!, subCountyName: r._subCountyName, parishId: r.parishId!,
    ownerId: r._ownerId, clusterId: r._clusterId, clustered: r._clustered, ssaDone: r._ssaDone,
  }));
  const core = rows.filter((r) => r.schoolType === 'core').length;
  const clustered = rows.filter((r) => r.clustered).length;
  console.log(`✓ ${rows.length} schools (${core} core, ${rows.length - core} client; ${clustered} clustered, ${rows.length - clustered} unclustered)`);
  return rows;
}

// ── SSA: baseline (2025) + follow-up (2026 for core) ───────────────────────
async function seedSsa(rows: SchoolRow[]) {
  const jobs: (() => Promise<unknown>)[] = [];
  let count = 0;
  for (const r of rows) {
    if (!r.ssaDone) continue;
    const isCore = r.schoolType === 'core';
    const baseline = ssaScores(isCore).map((s) => ({ intervention: s.intervention, score: Math.max(1, Math.round((s.score - 1.2) * 10) / 10) }));
    // Baseline SSA must sit in the PREVIOUS operational FY (FY2025 = Oct 2024→Sep
    // 2025) so the year-over-year impact comparison has a real prior-FY record.
    // Feb 2025 → FY2025 Q2. (Oct 2025 would be FY2026 Q1 and break the comparison.)
    jobs.push(() => prisma.ssaRecord.create({ data: { schoolId: r.dbId, dateOfSsa: new Date(Date.UTC(2025, 1, 1 + (Number(r.ext) % 80))), fy: '2025', quarter: 'Q2', newEnrollment: ri(120, 800), averageScore: avg(baseline), uploadedBy: 'seed', verificationStatus: 'confirmed', scores: { create: baseline } } }));
    count++;
    if (isCore) {
      const improved = rnd() < 0.72;
      const follow = baseline.map((s) => ({ intervention: s.intervention, score: Math.min(10, Math.max(1, Math.round((s.score + (improved ? 0.6 + rnd() * 1.2 : -(0.3 + rnd() * 0.6))) * 10) / 10)) }));
      jobs.push(() => prisma.ssaRecord.create({ data: { schoolId: r.dbId, dateOfSsa: new Date(Date.UTC(2026, 1, 1 + (Number(r.ext) % 80))), fy: '2026', quarter: 'Q2', newEnrollment: ri(120, 800), averageScore: avg(follow), uploadedBy: 'seed', verificationStatus: 'confirmed', scores: { create: follow } } }));
      count++;
    }
  }
  for (const c of chunk(jobs, 40)) await Promise.all(c.map((fn) => fn()));
  console.log(`✓ ${count} SSA records (baseline + follow-up)`);
}

// ── Sample evidence files on disk (so seeded attachments are openable) ──────
function writeSampleEvidence(): { pdf: string; png: string } {
  const dir = resolve(process.env.EVIDENCE_STORAGE_DIR ?? 'uploads/evidence');
  mkdirSync(dir, { recursive: true });
  const pdf = 'sample-evidence.pdf';
  const pdfBody = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 360 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 92>>stream
BT /F1 18 Tf 30 140 Td (Edify Demo Evidence) Tj 0 -30 Td /F1 12 Tf (School visit / attendance form) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF`;
  writeFileSync(resolve(dir, pdf), pdfBody, 'latin1');
  const png = 'sample-evidence.png';
  writeFileSync(resolve(dir, png), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64'));
  return { pdf, png };
}

// Guarantee the demo CCEO (cceo@edify.org) owns at least `need` distinct
// ready (clustered + SSA-done) schools, reassigning some if necessary, so every
// workflow-state scenario lands on its OWN school.
async function ensureDemoPortfolio(rows: SchoolRow[], demoCceo: Staff, need: number): Promise<SchoolRow[]> {
  const ready = rows.filter((r) => r.clustered && r.ssaDone);
  const owned = ready.filter((r) => r.ownerId === demoCceo.id);
  if (owned.length >= need) return owned;
  const extra = ready.filter((r) => r.ownerId !== demoCceo.id).slice(0, need - owned.length);
  for (const r of extra) {
    await prisma.school.update({ where: { id: r.dbId }, data: { accountOwnerId: demoCceo.id, accountOwnerNameRaw: demoCceo.name } });
    await prisma.staffSchoolAssignment.upsert({ where: { staffId_schoolId: { staffId: demoCceo.id, schoolId: r.dbId } }, update: {}, create: { staffId: demoCceo.id, schoolId: r.dbId } }).catch(() => undefined);
    r.ownerId = demoCceo.id;
  }
  return [...owned, ...extra];
}

// Give the demo CCEO BOTH cluster scenarios: a few unclustered schools that sit
// in a COVERED sub-county (so the directory drawer shows an eligible cluster to
// "assign to"), alongside the unclustered-in-uncovered ones ("create a cluster").
async function relaxDemoClusters(demoCceoId: string) {
  const covered = await prisma.clusterSubCounty.findMany({
    where: { cluster: { status: 'active', deletedAt: null } }, select: { subCountyId: true },
  });
  const coveredIds = [...new Set(covered.map((c) => c.subCountyId))];
  const clustered = await prisma.school.findMany({
    where: { accountOwnerId: demoCceoId, clusterStatus: 'clustered', deletedAt: null, subCountyId: { in: coveredIds }, activities: { none: {} } },
    select: { id: true }, take: 5,
  });
  for (const s of clustered) {
    await prisma.schoolClusterAssignment.deleteMany({ where: { schoolId: s.id } });
    await prisma.school.update({ where: { id: s.id }, data: { clusterId: null, clusterStatus: 'unclustered', planningReadiness: 'limited' } });
  }
  console.log(`✓ demo: ${clustered.length} CCEO schools left unclustered-but-eligible (covered sub-county) for the assign-cluster demo`);
}

// ── Activities: seed EVERY workflow state ──────────────────────────────────
// Scenario activities are created individually (so we can link evidence /
// payments / verifications by id, with NO placeholder tags showing in the UI);
// historical completed work is bulk-inserted.
async function seedActivities(rows: SchoolRow[], cceos: Staff[], coord: Staff, partnerIds: string[], sample: { pdf: string; png: string }) {
  const demoCceo = cceos[0]; // cceo@edify.org
  const partner = partnerIds[0];
  const today = new Date('2026-06-12T08:00:00Z');
  const day = (delta: number) => { const d = new Date(today); d.setUTCDate(d.getUTCDate() + delta); return d; };
  // Period is DERIVED from the date (operational FY = Oct→Sep), never hardcoded,
  // so seeded quarter/fy can never disagree with scheduledDate. Mirrors
  // src/common/fy/fy.util.ts exactly.
  const fyOf = (d: Date) => (d.getUTCMonth() >= 9 ? d.getUTCFullYear() + 1 : d.getUTCFullYear()).toString();
  const qOf = (d: Date): string => { const m = d.getUTCMonth(); return m >= 9 ? 'Q1' : m <= 2 ? 'Q2' : m <= 5 ? 'Q3' : 'Q4'; };
  const sfV = (r: SchoolRow, n = 1) => `SV-${r.ext}${n}`;
  const sfT = (r: SchoolRow, n = 1) => `TS-${r.ext}${n}`;

  const portfolio = await ensureDemoPortfolio(rows, demoCceo, 34);
  let p = 0;
  const next = () => portfolio[Math.min(p++, portfolio.length - 1)];

  type Over = Partial<Prisma.ActivityCreateInput> & {
    schoolDbId?: string | null; clusterId?: string | null; responsibleStaffId?: string; assignedPartnerId?: string;
  };
  type Scenario = {
    over: Over; evidence?: { kind: EvidenceKind; status: EvidenceStatus; partner: boolean }[];
    payment?: { path: PaymentPath; status: PaymentStatus; amount: number }; verifySfId?: string;
  };
  const scenarios: Scenario[] = [];
  const baseOver = (o: Over): Over => {
    const when = o.scheduledDate ? new Date(o.scheduledDate) : today;
    return {
      activityType: 'school_visit', fy: fyOf(when), quarter: qOf(when), deliveryType: DeliveryType.staff,
      status: ActivityStatus.planned, evidenceStatus: EvidenceStatus.none, iaVerificationStatus: VerificationStatus.pending,
      paymentStatus: PaymentStatus.none, ...o,
    };
  };

  // 1) Staff SCHEDULED visits → My Plan (Due Today / This Week / This Month)
  for (const delta of [0, 2, 4, 12]) {
    const r = next();
    scenarios.push({ over: baseOver({ activityType: 'school_visit', schoolDbId: r.dbId, responsibleStaffId: demoCceo.id, status: 'scheduled', scheduledDate: day(delta), plannedMonth: 6, purposeIntervention: pick(INTERVENTIONS) }) });
  }
  // 2) Staff IN PROGRESS → My Plan
  { const r = next(); scenarios.push({ over: baseOver({ activityType: 'school_improvement_training', schoolDbId: r.dbId, responsibleStaffId: demoCceo.id, status: 'in_progress', scheduledDate: day(-1), plannedMonth: 6, purposeIntervention: pick(INTERVENTIONS) }) }); }
  // 3) Partner ASSIGNED (awaiting partner schedule) → Partner Planning + staff monitor
  for (let i = 0; i < 3; i++) { const r = next(); scenarios.push({ over: baseOver({ activityType: 'school_visit', schoolDbId: r.dbId, responsibleStaffId: demoCceo.id, assignedPartnerId: partner, deliveryType: 'partner', status: 'assigned_to_partner', plannedMonth: 7, purposeIntervention: pick(INTERVENTIONS) }) }); }
  // 4) Partner SCHEDULED → Partner My Plan + staff monitor card
  for (let i = 0; i < 3; i++) { const r = next(); scenarios.push({ over: baseOver({ activityType: i === 0 ? 'training' : 'school_visit', schoolDbId: r.dbId, responsibleStaffId: demoCceo.id, assignedPartnerId: partner, deliveryType: 'partner', status: 'partner_scheduled', scheduledDate: day(6 + i * 3), plannedMonth: 6, purposeIntervention: pick(INTERVENTIONS) }) }); }
  // 5) Partner EVIDENCE UPLOADED (awaiting staff confirm) → staff partner-evidence review
  for (let i = 0; i < 3; i++) { const r = next(); scenarios.push({ over: baseOver({ activityType: 'school_visit', schoolDbId: r.dbId, responsibleStaffId: demoCceo.id, assignedPartnerId: partner, deliveryType: 'partner', status: 'evidence_uploaded', evidenceStatus: 'uploaded', scheduledDate: day(-3), plannedMonth: 6, purposeIntervention: pick(INTERVENTIONS) }), evidence: [{ kind: 'visit_form', status: 'uploaded', partner: true }, { kind: 'photo', status: 'uploaded', partner: true }] }); }
  // 6) Staff AWAITING IA → IA queue
  for (let i = 0; i < 5; i++) { const r = next(); const training = i % 2 === 0; scenarios.push({ over: baseOver({ activityType: training ? 'school_improvement_training' : 'school_visit', schoolDbId: r.dbId, responsibleStaffId: demoCceo.id, status: 'awaiting_ia_verification', evidenceStatus: 'accepted', salesforceActivityId: training ? sfT(r) : sfV(r), salesforceActivityType: training ? 'training' : 'visit', teachersAttended: training ? ri(8, 30) : null, leadersAttended: training ? ri(2, 6) : null, scheduledDate: day(-6 - i), plannedMonth: 6, purposeIntervention: pick(INTERVENTIONS) }), evidence: [{ kind: training ? 'attendance_form' : 'visit_form', status: 'accepted', partner: false }], verifySfId: training ? sfT(r) : sfV(r) }); }
  // 7) Partner AWAITING IA (staff already confirmed evidence) → IA queue
  for (let i = 0; i < 3; i++) { const r = next(); scenarios.push({ over: baseOver({ activityType: 'training', schoolDbId: r.dbId, responsibleStaffId: demoCceo.id, assignedPartnerId: partner, deliveryType: 'partner', status: 'awaiting_ia_verification', evidenceStatus: 'accepted', salesforceActivityId: sfT(r), salesforceActivityType: 'training', teachersAttended: ri(10, 28), leadersAttended: ri(2, 5), scheduledDate: day(-8 - i), plannedMonth: 6, purposeIntervention: pick(INTERVENTIONS) }), evidence: [{ kind: 'attendance_form', status: 'accepted', partner: true }], verifySfId: sfT(r) }); }
  // 8) Staff IA-VERIFIED → accountant accountability (Netsuite) + completed log
  for (let i = 0; i < 4; i++) { const r = next(); scenarios.push({ over: baseOver({ activityType: 'school_improvement_training', schoolDbId: r.dbId, responsibleStaffId: demoCceo.id, status: 'ia_verified', evidenceStatus: 'accepted', iaVerificationStatus: 'confirmed', iaConfirmedAt: day(-2), iaConfirmedBy: 'seed-ia', paymentStatus: 'netsuite_accountability', salesforceActivityId: sfT(r), salesforceActivityType: 'training', teachersAttended: ri(8, 26), leadersAttended: ri(2, 5), scheduledDate: day(-10 - i), plannedMonth: 5, purposeIntervention: pick(INTERVENTIONS) }), evidence: [{ kind: 'attendance_form', status: 'accepted', partner: false }], payment: { path: 'staff', status: 'netsuite_accountability', amount: 50000 }, verifySfId: sfT(r) }); }
  // 9) Partner IA-VERIFIED → accountant PAYMENT queue + completed log
  for (let i = 0; i < 4; i++) { const r = next(); scenarios.push({ over: baseOver({ activityType: 'training', schoolDbId: r.dbId, responsibleStaffId: demoCceo.id, assignedPartnerId: partner, deliveryType: 'partner', status: 'ia_verified', evidenceStatus: 'accepted', iaVerificationStatus: 'confirmed', iaConfirmedAt: day(-2), iaConfirmedBy: 'seed-ia', paymentStatus: 'ia_confirmed', salesforceActivityId: sfT(r), salesforceActivityType: 'training', teachersAttended: ri(10, 30), leadersAttended: ri(2, 6), scheduledDate: day(-12 - i), plannedMonth: 5, purposeIntervention: pick(INTERVENTIONS) }), evidence: [{ kind: 'attendance_form', status: 'accepted', partner: true }], payment: { path: 'partner', status: 'ia_confirmed', amount: 120000 }, verifySfId: sfT(r) }); }
  // 10) Cluster meeting awaiting IA (cluster activity for IA + cluster planning)
  { const clustered = portfolio.find((r) => r.clusterId); if (clustered?.clusterId) scenarios.push({ over: baseOver({ activityType: 'cluster_meeting', clusterId: clustered.clusterId, responsibleStaffId: demoCceo.id, status: 'awaiting_ia_verification', evidenceStatus: 'accepted', clusterSlot: 'first_meeting', salesforceActivityId: `TS-CL${clustered.ext}`, salesforceActivityType: 'training', teachersAttended: ri(20, 50), leadersAttended: ri(8, 16), scheduledDate: day(-4), plannedMonth: 6 }), evidence: [{ kind: 'attendance_form', status: 'accepted', partner: false }, { kind: 'meeting_minutes', status: 'accepted', partner: false }] }); }
  // 11) Coordinator's own scheduled project activity → Coordinator My Plan
  { const r = rows.find((x) => x.schoolType === 'core' && x.ssaDone) ?? rows[0]; scenarios.push({ over: baseOver({ activityType: 'project_activity', schoolDbId: r.dbId, responsibleStaffId: coord.id, status: 'scheduled', scheduledDate: day(8), plannedMonth: 6, purposeIntervention: 'education_technology' }) }); }

  // Create each scenario activity, then link its evidence / payment / verification.
  for (const s of scenarios) {
    const { schoolDbId, clusterId, responsibleStaffId, assignedPartnerId, ...rest } = s.over;
    const a = await prisma.activity.create({
      data: {
        ...(rest as Prisma.ActivityCreateInput),
        ...(schoolDbId ? { school: { connect: { id: schoolDbId } } } : {}),
        ...(clusterId ? { cluster: { connect: { id: clusterId } } } : {}),
        ...(responsibleStaffId ? { responsibleStaff: { connect: { id: responsibleStaffId } } } : {}),
        ...(assignedPartnerId ? { assignedPartner: { connect: { id: assignedPartnerId } } } : {}),
      },
    });
    for (const e of s.evidence ?? []) {
      const isPhoto = e.kind === 'photo';
      await prisma.evidenceRecord.create({ data: { activityId: a.id, kind: e.kind, uri: isPhoto ? sample.png : sample.pdf,
        // Carry the same metadata a real upload sets, so the IA's viewer serves
        // the correct MIME (inline preview) instead of octet-stream force-download.
        mimeType: isPhoto ? 'image/png' : 'application/pdf', originalName: isPhoto ? `${e.kind}.png` : `${e.kind}.pdf`,
        uploadedBy: e.partner ? 'seed-partner' : 'seed-staff', status: e.status, reviewedBy: e.status === 'accepted' ? 'seed-staff' : undefined, reviewedAt: e.status === 'accepted' ? day(-2) : undefined } });
    }
    if (s.verifySfId) await prisma.activityCompletionVerification.create({ data: { activityId: a.id, salesforceId: s.verifySfId, enteredBy: 'seed-staff', status: 'confirmed', iaActorId: 'seed-ia', iaActionAt: day(-2) } }).catch(() => undefined);
    if (s.payment) { const pr = await prisma.paymentRequest.create({ data: { activityId: a.id, path: s.payment.path, amount: s.payment.amount, status: s.payment.status } }); await prisma.paymentActionLog.create({ data: { paymentRequestId: pr.id, action: 'ia_confirmed', actorId: 'seed-ia' } }); }
  }

  // 12) Bulk historical COMPLETED across ~half the core schools → Completed Log
  //     + analytics. Many core/client schools intentionally have NO current
  //     activity → Planning gaps to schedule live.
  const bulk: Prisma.ActivityCreateManyInput[] = [];
  for (const r of rows) {
    if (r.schoolType !== 'core' || Number(r.ext) % 2 !== 0) continue;
    const partnerDelivered = Number(r.ext) % 4 === 0;
    for (let n = 1; n <= 2; n++) {
      const training = n === 2;
      const sched = day(-30 - n);
      bulk.push({
        activityType: training ? 'core_training' : 'core_visit', schoolId: r.dbId, responsibleStaffId: r.ownerId,
        assignedPartnerId: partnerDelivered ? partner : null, deliveryType: partnerDelivered ? 'partner' : 'staff',
        fy: fyOf(sched), quarter: qOf(sched), status: 'completed', evidenceStatus: 'accepted', iaVerificationStatus: 'confirmed', iaConfirmedAt: day(-30),
        salesforceActivityId: training ? sfT(r, n) : sfV(r, n), salesforceActivityType: training ? 'training' : 'visit',
        teachersAttended: training ? ri(8, 28) : null, leadersAttended: training ? ri(2, 5) : null,
        paymentStatus: partnerDelivered ? 'paid' : 'closed', scheduledDate: sched, plannedMonth: 4,
        purposeIntervention: INTERVENTIONS[(n - 1) % INTERVENTIONS.length],
      });
    }
  }
  for (const c of chunk(bulk, 500)) await prisma.activity.createMany({ data: c, skipDuplicates: true });

  const counts = await prisma.activity.groupBy({ by: ['status'], _count: true });
  console.log(`✓ ${scenarios.length + bulk.length} activities across states: ${counts.map((c) => `${c.status}=${c._count}`).join(', ')}`);
}

// ── Partners + cost catalogue + projects ───────────────────────────────────
async function seedDomains(rows: SchoolRow[], coord: Staff): Promise<string[]> {
  const allDistrictNames = [...new Set(rows.map((r) => r.districtName))];

  const PARTNERS = [
    { name: 'Literacy Training Uganda', regionName: 'Central', trainsOn: ['Early Grade Reading', 'Teacher Coaching'], expertiseAreas: ['teaching_and_learning'] },
    { name: 'Bright Future Education', regionName: 'Northern', trainsOn: ['Numeracy Foundations', 'Leadership'], expertiseAreas: ['leadership'] },
    { name: 'World Vision', regionName: 'Eastern', trainsOn: ['Christlike Behaviour', 'Child Protection'], expertiseAreas: ['christlike_behaviour'] },
    { name: 'EdTech Partners', regionName: 'Western', trainsOn: ['Education Technology'], expertiseAreas: ['education_technology'] },
    { name: 'Bible Society UG', regionName: 'Central', trainsOn: ['Exposure to the Word of God'], expertiseAreas: ['exposure_to_word_of_god'] },
  ];
  let partnerIds: string[] = [];
  if ((await prisma.partner.count()) === 0) {
    for (const pr of PARTNERS) {
      const c = await prisma.partner.create({ data: { name: pr.name, regionName: pr.regionName, trainsOn: pr.trainsOn, expertiseAreas: pr.expertiseAreas, coverageDistricts: allDistrictNames.slice(0, 8), isCertified: true, certificationStatus: 'certified', activeStatus: true, contractStatus: 'active', contactPerson: `${pick(CONTACT_FIRST)} ${pick(CONTACT_LAST)}`, phone: `+25670${ri(1000000, 9999999)}` } });
      partnerIds.push(c.id);
    }
  } else {
    partnerIds = (await prisma.partner.findMany({ select: { id: true } })).map((p) => p.id);
    // Ensure existing partners are active + certified for the demo.
    await prisma.partner.updateMany({ data: { isCertified: true, activeStatus: true } });
  }

  // Round-trip link: the partner field officer (partner@edify.org) authenticates
  // AS the first active partner, so the session resolves to this org's work via
  // the canonical Partner.userId FK — not only the demo role-bridge fallback.
  if (partnerIds.length) {
    const partnerUser = await prisma.user.findUnique({ where: { email: 'partner@edify.org' }, select: { id: true } });
    if (partnerUser) {
      await prisma.partner.update({ where: { id: partnerIds[0] }, data: { userId: partnerUser.id } }).catch(() => undefined);
    }
  }

  if ((await prisma.costSetting.count()) === 0) {
    const COSTS = [
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
    for (const c of COSTS) await prisma.costSetting.create({ data: { ...c, fy: '2026', createdBy: 'seed' } });
  }

  // Special projects — schools assigned FROM the directory (real School rows).
  const PROJECTS: { code: string; name: string; category: ProjectCategory; intervention?: SsaIntervention }[] = [
    { code: 'SP-EDTECH', name: 'Education Technology', category: 'pilot', intervention: 'education_technology' },
    { code: 'SP-CCSEL', name: 'Christ-Centered SEL', category: 'selective_limited', intervention: 'christlike_behaviour' },
    { code: 'SP-DIP', name: 'International Diploma in Christ-Centered Education', category: 'selective_limited', intervention: 'teaching_and_learning' },
    { code: 'SP-ECC', name: 'Early Childhood Curriculum', category: 'intervention_specific', intervention: 'learning_environment' },
    { code: 'SP-UCU', name: 'UCU Teacher Upgrading Programs', category: 'selective_limited', intervention: 'teaching_and_learning' },
  ];
  const projectPool = rows.filter((r) => r.ssaDone).slice(0, 60);
  let pi = 0;
  for (const p of PROJECTS) {
    const project = await prisma.project.upsert({ where: { code: p.code }, create: { code: p.code, name: p.name, category: p.category, intervention: p.intervention, managerStaffId: coord.id }, update: { name: p.name, category: p.category, intervention: p.intervention, managerStaffId: coord.id } });
    const slice = projectPool.slice(pi * 6, pi * 6 + 6); pi++;
    if ((await prisma.projectSchoolAssignment.count({ where: { projectId: project.id } })) === 0) {
      for (const s of slice) await prisma.projectSchoolAssignment.create({ data: { projectId: project.id, schoolId: s.dbId } });
      if (partnerIds.length) await prisma.projectPartnerAssignment.create({ data: { projectId: project.id, partnerId: partnerIds[pi % partnerIds.length] } }).catch(() => undefined);
      await prisma.projectImpactSnapshot.create({ data: { projectId: project.id, fy: '2026', metricsJson: { baselineAvg: 5.8, latestAvg: 7.1, change: 1.3, intervention: p.intervention } } });
    }
  }

  // Annual plan + budget (so the budget surface has data).
  if ((await prisma.annualPlan.count()) === 0) {
    const plan = await prisma.annualPlan.create({ data: { fy: '2026', status: 'submitted' } });
    for (const q of ['Q1', 'Q2', 'Q3', 'Q4']) {
      const apa = await prisma.annualPlanActivity.create({ data: { annualPlanId: plan.id, activityType: 'school_visit', quarter: q, month: 1 } });
      await prisma.activityBudgetLine.create({ data: { annualPlanActivityId: apa.id, costSettingKey: 'staff_visit_transport_primary', quantity: 10, unitCost: 50000, amount: 500000 } });
    }
    const bv = await prisma.budgetVersion.create({ data: { annualPlanId: plan.id, version: 1, total: 2000000 } });
    await prisma.budgetApproval.create({ data: { budgetVersionId: bv.id, approverId: 'seed', decision: 'approved' } });
    await prisma.monthlyFundRequest.create({ data: { fy: '2026', month: 6, amount: 500000, status: 'submitted' } });
  }

  const [partners, projects, evidence, payments, costs] = await Promise.all([
    prisma.partner.count(), prisma.project.count(), prisma.evidenceRecord.count(), prisma.paymentRequest.count(), prisma.costSetting.count(),
  ]);
  console.log(`✓ ${partners} partners (active+certified), ${projects} projects, ${evidence} evidence, ${payments} payments, ${costs} cost settings`);
  return partnerIds;
}

// ── Workflow-connected notifications + messages ────────────────────────────
async function seedMessagesAndNotifications() {
  const [cd, ia, cceo, accountant, pl] = await Promise.all([
    prisma.user.findUnique({ where: { email: 'cd@edify.org' } }),
    prisma.user.findUnique({ where: { email: 'ia@edify.org' } }),
    prisma.user.findUnique({ where: { email: 'cceo@edify.org' } }),
    prisma.user.findUnique({ where: { email: 'accountant@edify.org' } }),
    prisma.user.findUnique({ where: { email: 'pl1@edify.org' } }),
  ]);
  if (!cd || !ia || !cceo || !accountant || !pl) return;
  const unclustered = await prisma.school.findFirst({ where: { clusterStatus: 'unclustered' }, select: { schoolId: true, name: true } });
  const ssaSchool = await prisma.school.findFirst({ where: { currentFySsaStatus: 'not_done', schoolType: 'core' }, select: { schoolId: true, name: true } });
  await prisma.notification.deleteMany({ where: { contextType: 'mock_seed' } });
  const notifs = [
    { recipientId: cceo.id, title: 'Add to cluster required', body: `${unclustered?.name ?? 'A school'} has no cluster — assign one to unlock planning.`, targetRoute: '/schools', actionRequired: true, priority: 'high' as const, contextId: unclustered?.schoolId },
    { recipientId: ia.id, title: 'IA verification queue', body: 'Completed visits and trainings are awaiting your verification.', targetRoute: '/data-verification', actionRequired: true, priority: 'high' as const },
    { recipientId: cceo.id, title: 'SSA required', body: `${ssaSchool?.name ?? 'A core school'} is missing its current-FY SSA.`, targetRoute: '/planning', actionRequired: true, priority: 'normal' as const, contextId: ssaSchool?.schoolId },
    { recipientId: accountant.id, title: 'Partner payment ready', body: 'IA-verified partner trainings are ready for payment.', targetRoute: '/dashboards/accountant', actionRequired: true, priority: 'high' as const },
    { recipientId: pl.id, title: 'Team plan summary', body: 'Your CCEOs have scheduled new activities this week.', targetRoute: '/team-plan', actionRequired: false, priority: 'normal' as const },
    { recipientId: cd.id, title: 'Annual budget approval needed', body: 'A regional annual plan was submitted for approval.', targetRoute: '/budget', actionRequired: true, priority: 'normal' as const },
  ];
  for (const n of notifs) await prisma.notification.create({ data: { ...n, contextType: 'mock_seed' } });
  await prisma.message.deleteMany({ where: { contextType: 'mock_seed' } });
  await prisma.messageThread.deleteMany({ where: { contextType: 'mock_seed' } });
  const thread = await prisma.messageThread.create({ data: { subject: 'Cluster assignment for unclustered schools', contextType: 'mock_seed' } });
  const msgs = [
    { recipientId: cceo.id, senderId: pl.id, body: 'Please cluster your remaining unclustered schools before planning closes.', actionRequired: true, priority: 'high' as const, targetRoute: '/schools', category: 'cluster' },
    { recipientId: ia.id, senderId: cd.id, body: 'Prioritise verification for the completed core cohort.', actionRequired: true, priority: 'normal' as const, targetRoute: '/data-verification', category: 'ssa' },
    { recipientId: accountant.id, senderId: ia.id, body: 'Partner trainings are IA-confirmed and ready for payment.', actionRequired: true, priority: 'normal' as const, targetRoute: '/dashboards/accountant', category: 'payment' },
  ];
  for (const m of msgs) await prisma.message.create({ data: { ...m, threadId: thread.id, contextType: 'mock_seed' } });
  console.log(`✓ ${notifs.length} notifications, ${msgs.length} messages (workflow-connected)`);
}

// ── Purge operational data (keep users + reference) ────────────────────────
async function purgeOperational() {
  // Truncate every operational table (FK order handled by CASCADE), keeping
  // users + the permission/geography reference data. Dynamic so newly-added
  // tables (Leave, CdFlag, FundRequest, DailyDebrief, decision/budget-intel,
  // payment, core-plan, …) are always purged — the old hand-ordered deleteMany
  // list silently broke re-seed every time a table was added (Leave FK error).
  const KEEP = new Set([
    'User', 'Permission', 'RolePermission',
    'Region', 'District', 'SubCounty', 'Parish',
    '_prisma_migrations',
  ]);
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `;
  const targets = rows.map((r) => r.tablename).filter((t) => !KEEP.has(t));
  if (targets.length) {
    const list = targets.map((t) => `"public"."${t}"`).join(', ');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }
  console.log(`✓ purged ${targets.length} operational tables (kept users + reference)`);
}

async function main() {
  await seedReference();
  // Demo data (users + schools + operational rows) is normally withheld in
  // production. A demo / online-test deployment needs it so the edify-web bridge
  // has accounts to authenticate as and the dashboards have content — opt in
  // EXPLICITLY with ALLOW_DEMO_SEED_IN_PROD=true (deliberate, off by default).
  const demoAllowed = MOCK || (IS_PROD && process.env.ALLOW_DEMO_SEED_IN_PROD === 'true');
  if (!demoAllowed) {
    console.log(IS_PROD
      ? '• production: skipping demo data (set ALLOW_DEMO_SEED_IN_PROD=true to seed a demo/online-test deployment)'
      : '• ENABLE_MOCK_DATA=false: skipping demo data');
    return;
  }
  if (IS_PROD) console.log('• ALLOW_DEMO_SEED_IN_PROD=true → seeding demo data into a PRODUCTION database (demo/online-test deployment).');
  await purgeOperational();
  const subCounties = await seedGeography();
  const districtIds = [...new Set(subCounties.map((s) => s.districtId))];
  const { pls, cceos, coord } = await seedStaff(districtIds);
  // PLs carry a SMALL field portfolio (the first PL_OWN_SCHOOLS×NUM_PLS schools);
  // every other school round-robins across CCEOs so each CCEO holds a realistic
  // mix of core + client (CCEOs carry far more than PLs).
  const plQuota = NUM_PLS * PL_OWN_SCHOOLS;
  const owners: Staff[] = Array.from({ length: TOTAL_SCHOOLS }, (_, gi) =>
    gi < plQuota ? pls[gi % NUM_PLS] : cceos[(gi - plQuota) % cceos.length]);
  const { coverageBySub } = await seedClusters(subCounties);
  const rows = await seedSchools(subCounties, owners, coverageBySub);
  await seedSsa(rows);
  const sample = writeSampleEvidence();
  const partnerIds = await seedDomains(rows, coord);
  await seedActivities(rows, cceos, coord, partnerIds, sample);
  await relaxDemoClusters(cceos[0].id);
  await seedMessagesAndNotifications();
  console.log('\n✅ Final demo seed complete.');
}
main().then(() => prisma.$disconnect()).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
