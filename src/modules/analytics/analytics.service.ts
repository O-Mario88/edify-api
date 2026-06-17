import { Injectable } from '@nestjs/common';
import { Prisma, SsaIntervention } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ScopeService, UserScope } from '../../common/scope/scope.service';
import { AuthUser } from '../../common/auth/auth-user';
import { getOperationalFY } from '../../common/fy/fy.util';
import { districtStatus } from './geo-status';

// The official 8 SSA interventions (display order + code), mapped from the stored
// SsaIntervention enum. SSA Performance is the average of EACH of these per group
// — never one single score, never a partial set.
const INTERVENTION_META: { key: SsaIntervention; code: string; label: string }[] = [
  { key: 'christlike_behaviour', code: 'CHRIST_LIKE_BEHAVIOR', label: 'Christ-like Behavior' },
  { key: 'exposure_to_word_of_god', code: 'EXPOSURE_TO_WORD_OF_GOD', label: 'Exposure to the Word of God' },
  { key: 'leadership', code: 'LEADERSHIP_BEST_PRACTICE', label: 'Leadership Best Practice' },
  { key: 'teaching_and_learning', code: 'TEACHING_ENVIRONMENT', label: 'Teaching Environment' },
  { key: 'learning_environment', code: 'LEARNING_ENVIRONMENT', label: 'Learning Environment' },
  { key: 'government_requirements', code: 'GOVERNMENT_REQUIREMENTS', label: 'Government Requirements' },
  { key: 'financial_health', code: 'FEES_BUDGET_ACCOUNTS', label: 'Fees / Budget / Accounts' },
  { key: 'education_technology', code: 'ENROLLMENT', label: 'Enrollment' },
];

export type SsaGroupBy = 'region' | 'district' | 'subCounty' | 'cluster' | 'cceo';

// Shared geography filter. The FE filter bar emits a district *name* ("Gulu") and
// a region *key* ("northern") — NOT the backend cuid — so the bridge resolves them
// via Prisma RELATION filters (case-insensitive for region) rather than id lookups.
// `__all__` is the FE "no filter" sentinel and is treated as absent.
export type GeoFilter = { region?: string; district?: string; cluster?: string };
const ALL = '__all__';
const has = (v?: string): v is string => !!v && v !== ALL;
export function geoActive(geo?: GeoFilter): boolean {
  return !!geo && (has(geo.region) || has(geo.district) || has(geo.cluster));
}
// A School where-fragment for the selected geography. Only NARROWS — sets relation
// keys (`district`/`region`) or `clusterId`, never `id`, so it composes safely with
// the role scope (Prisma ANDs them).
export function geoWhere(geo?: GeoFilter): Prisma.SchoolWhereInput {
  const w: Prisma.SchoolWhereInput = {};
  if (!geo) return w;
  if (has(geo.district)) w.district = { name: geo.district };
  if (has(geo.region)) w.region = { name: { equals: geo.region, mode: 'insensitive' } };
  if (has(geo.cluster)) w.clusterId = geo.cluster;
  return w;
}

// "By CCEO" is a supervisory lens — only roles that oversee multiple CCEOs may
// use it. A CCEO grouping by CCEO would just see themselves; RVP is summary-only.
const CCEO_GROUP_ROLES = ['CountryProgramLead', 'CountryDirector', 'ImpactAssessment'];

// Scoped, filter-aware analytics summaries. Every count is constrained by the
// caller's UserScope — never the whole table for a non-country role.
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  private schoolScope(scope: UserScope, geo?: GeoFilter): Prisma.SchoolWhereInput {
    // Aggregate scope: summary-only roles (RVP) get country-wide counts. The
    // optional geography filter is ANDed on top — it can only NARROW the scope
    // (it sets `district`/`region` relation keys, never `id`), so a scoped user
    // passing an out-of-scope district still resolves to 0 rows, never a leak.
    return { deletedAt: null, ...this.scope.aggregateSchoolWhere(scope), ...geoWhere(geo) };
  }

  async dashboardSummary(user: AuthUser, geo?: GeoFilter) {
    const scope = await this.scope.resolveUserScope(user);
    const where = this.schoolScope(scope, geo);
    const [schools, core, ready, unclustered, ssaDone] = await Promise.all([
      this.prisma.school.count({ where }),
      this.prisma.school.count({ where: { ...where, schoolType: 'core' } }),
      this.prisma.school.count({ where: { ...where, planningReadiness: 'ready' } }),
      this.prisma.school.count({ where: { ...where, clusterStatus: 'unclustered' } }),
      this.prisma.school.count({ where: { ...where, currentFySsaStatus: 'done' } }),
    ]);
    return {
      role: scope.activeRole,
      scope: { countryScope: scope.countryScope, schoolsInScope: scope.countryScope ? null : scope.schoolIds.length },
      schools, coreSchools: core, clientSchools: schools - core,
      planningReady: ready, unclustered, ssaDone,
    };
  }

  async schoolDirectorySummary(user: AuthUser, geo?: GeoFilter) {
    const scope = await this.scope.resolveUserScope(user);
    const where = this.schoolScope(scope, geo);
    const [byType, byReadiness, unmatched, dupes] = await Promise.all([
      this.prisma.school.groupBy({ by: ['schoolType'], where, _count: true }),
      this.prisma.school.groupBy({ by: ['planningReadiness'], where, _count: true }),
      this.prisma.school.count({ where: { ...where, accountOwnerStatus: 'unmatched' } }),
      this.prisma.school.count({ where: { ...where, duplicateStatus: 'potential' } }),
    ]);
    return {
      byType: byType.map((g) => ({ schoolType: g.schoolType, count: g._count })),
      byReadiness: byReadiness.map((g) => ({ readiness: g.planningReadiness, count: g._count })),
      unmatchedOwners: unmatched, potentialDuplicates: dupes,
    };
  }

  async ssaPerformance(user: AuthUser, geo?: GeoFilter) {
    const scope = await this.scope.resolveUserScope(user);
    const where = this.schoolScope(scope, geo);
    const schools = await this.prisma.school.findMany({ where, select: { id: true } });
    const schoolIds = schools.map((s) => s.id);
    if (schoolIds.length === 0) return { schoolsWithSsa: 0, overallAverage: 0, byIntervention: [] };

    const records = await this.prisma.ssaRecord.findMany({
      where: { schoolId: { in: schoolIds }, deletedAt: null },
      include: { scores: true },
    });
    const scored = records.filter((r) => r.averageScore != null);
    const overall = scored.length ? Math.round((scored.reduce((s, r) => s + (r.averageScore ?? 0), 0) / scored.length) * 10) / 10 : 0;
    const acc = new Map<string, { sum: number; n: number }>();
    for (const r of records) for (const sc of r.scores) {
      const cur = acc.get(sc.intervention) ?? { sum: 0, n: 0 };
      cur.sum += sc.score; cur.n++; acc.set(sc.intervention, cur);
    }
    return {
      schoolsWithSsa: records.length,
      overallAverage: overall,
      byIntervention: [...acc.entries()].map(([intervention, v]) => ({ intervention, average: Math.round((v.sum / v.n) * 10) / 10 })).sort((a, b) => a.average - b.average),
    };
  }

  async activityPipeline(user: AuthUser, geo?: GeoFilter) {
    const scope = await this.scope.resolveUserScope(user);
    const where = this.schoolScope(scope, geo);
    const schoolIds = (await this.prisma.school.findMany({ where, select: { id: true } })).map((s) => s.id);
    // Country roles normally skip the schoolId filter (whole table), but when a
    // geography filter is active we MUST constrain activities to the geo-narrowed
    // school set — else the pipeline would stay national while the cards narrow.
    const wholeTable = scope.countryScope && !geoActive(geo);
    const actWhere: Prisma.ActivityWhereInput = { deletedAt: null, ...(wholeTable ? {} : { schoolId: { in: schoolIds.length ? schoolIds : ['__none__'] } }) };
    const byStatus = await this.prisma.activity.groupBy({ by: ['status'], where: actWhere, _count: true });
    const byDelivery = await this.prisma.activity.groupBy({ by: ['deliveryType'], where: actWhere, _count: true });
    return {
      total: byStatus.reduce((s, g) => s + g._count, 0),
      byStatus: byStatus.map((g) => ({ status: g.status, count: g._count })),
      byDelivery: byDelivery.map((g) => ({ deliveryType: g.deliveryType, count: g._count })),
    };
  }

  // One combined, role-scoped country/region snapshot for the leadership dashboards
  // (CD / RVP). Every number is a real count/aggregate over the caller's scope —
  // schools, SSA health, the activity pipeline, finance, and team size — so the
  // leadership KPI strip reads live truth instead of fabricated figures.
  async leadershipSummary(user: AuthUser, geo?: GeoFilter) {
    const scope = await this.scope.resolveUserScope(user);
    const where = this.schoolScope(scope, geo);
    const fy = getOperationalFY();
    const schoolIds = (await this.prisma.school.findMany({ where, select: { id: true } })).map((s) => s.id);
    const idsOrNone = schoolIds.length ? schoolIds : ['__none__'];
    const wholeTable = scope.countryScope && !geoActive(geo);
    const actWhere: Prisma.ActivityWhereInput = { deletedAt: null, ...(wholeTable ? {} : { schoolId: { in: idsOrNone } }) };
    const [total, core, unclustered, ssaDone, ssaRecords, byStatus, staffCount, partnerCount, fundReqCount, disb] = await Promise.all([
      this.prisma.school.count({ where }),
      this.prisma.school.count({ where: { ...where, schoolType: 'core' } }),
      this.prisma.school.count({ where: { ...where, clusterStatus: 'unclustered' } }),
      this.prisma.school.count({ where: { ...where, currentFySsaStatus: 'done' } }),
      this.prisma.ssaRecord.findMany({ where: { schoolId: { in: idsOrNone }, deletedAt: null, fy }, select: { averageScore: true, scores: { select: { intervention: true, score: true } } } }),
      this.prisma.activity.groupBy({ by: ['status'], where: actWhere, _count: true }),
      this.prisma.staffProfile.count({ where: { user: { isActive: true } } }),
      this.prisma.partner.count({ where: { activeStatus: true } }),
      this.prisma.fundRequest.count(),
      this.prisma.paymentDisbursement.aggregate({ _sum: { amount: true }, _count: true }),
    ]);
    const scored = ssaRecords.filter((r) => r.averageScore != null);
    const ssaAverage = scored.length ? Math.round((scored.reduce((s, r) => s + (r.averageScore ?? 0), 0) / scored.length) * 10) / 10 : 0;
    const acc = new Map<string, { sum: number; n: number }>();
    for (const r of ssaRecords) for (const sc of r.scores) {
      const cur = acc.get(sc.intervention) ?? { sum: 0, n: 0 };
      cur.sum += sc.score; cur.n++; acc.set(sc.intervention, cur);
    }
    const byIntervention = [...acc.entries()]
      .map(([intervention, v]) => ({ intervention, average: Math.round((v.sum / v.n) * 10) / 10 }))
      .sort((a, b) => a.average - b.average || a.intervention.localeCompare(b.intervention));
    const cnt = (s: string) => byStatus.find((g) => g.status === s)?._count ?? 0;
    return {
      countryScope: scope.countryScope,
      schools: total, coreSchools: core, clientSchools: total - core,
      clustered: total - unclustered, unclustered, ssaDone, ssaPending: total - ssaDone,
      ssaCompletePct: total ? Math.round((ssaDone / total) * 100) : 0,
      ssaAverage, byIntervention, weakestInterventions: byIntervention.slice(0, 2),
      pipeline: {
        planned: cnt('planned'),
        scheduled: cnt('scheduled') + cnt('partner_scheduled') + cnt('assigned_to_partner'),
        inProgress: cnt('in_progress'),
        evidenceUploaded: cnt('evidence_uploaded'),
        awaitingIa: cnt('awaiting_ia_verification'),
        iaVerified: cnt('ia_verified'),
        completed: cnt('completed'),
      },
      activitiesTotal: byStatus.reduce((s, g) => s + g._count, 0),
      staffCount, partnerCount,
      fundRequests: fundReqCount,
      paymentsCleared: disb._count, disbursedTotalUgx: disb._sum.amount ?? 0,
    };
  }

  // Per-district rollup for the Districts directory — real school counts, SSA
  // completion + average, and cluster coverage, scoped to the caller. Replaces the
  // fabricated district mock.
  async districtRollups(user: AuthUser, geo?: GeoFilter) {
    const scope = await this.scope.resolveUserScope(user);
    const where = this.schoolScope(scope, geo);
    const schools = await this.prisma.school.findMany({
      where,
      select: {
        districtId: true,
        district: { select: { name: true } },
        region: { select: { name: true } },
        schoolType: true, clusterStatus: true, currentFySsaStatus: true,
        ssaRecords: { where: { deletedAt: null, fy: getOperationalFY() }, orderBy: { dateOfSsa: 'desc' }, take: 1, select: { averageScore: true } },
      },
    });
    type Acc = { districtId: string; district: string; region: string; schools: number; core: number; clustered: number; ssaDone: number; ssaSum: number; ssaN: number };
    const map = new Map<string, Acc>();
    for (const s of schools) {
      const cur: Acc = map.get(s.districtId) ?? { districtId: s.districtId, district: s.district?.name ?? 'District', region: s.region?.name ?? '', schools: 0, core: 0, clustered: 0, ssaDone: 0, ssaSum: 0, ssaN: 0 };
      cur.schools++;
      if (s.schoolType === 'core') cur.core++;
      if (s.clusterStatus === 'clustered') cur.clustered++;
      if (s.currentFySsaStatus === 'done') cur.ssaDone++;
      const avg = s.ssaRecords[0]?.averageScore;
      if (avg != null) { cur.ssaSum += avg; cur.ssaN++; }
      map.set(s.districtId, cur);
    }
    return {
      districts: [...map.values()].map((d) => ({
        districtId: d.districtId, district: d.district, region: d.region,
        schools: d.schools, coreSchools: d.core, clientSchools: d.schools - d.core,
        clustered: d.clustered, unclustered: d.schools - d.clustered,
        ssaDone: d.ssaDone, ssaPct: d.schools ? Math.round((d.ssaDone / d.schools) * 100) : 0,
        avgSsa: d.ssaN ? Math.round((d.ssaSum / d.ssaN) * 10) / 10 : 0,
      })).sort((a, b) => b.schools - a.schools),
    };
  }

  // Geo-analytics map — per-district leadership metrics keyed by the official
  // COD-AB pcode (so the frontend choropleth joins real boundary geometry to real
  // data), plus sub-region rollups and a national summary. Role-scoped +
  // filter-aware via the shared geo where; every number is a live aggregate.
  async geoMapDistricts(user: AuthUser, geo?: GeoFilter) {
    const scope = await this.scope.resolveUserScope(user);
    const where = this.schoolScope(scope, geo);
    const fy = getOperationalFY();
    const schools = await this.prisma.school.findMany({
      where,
      select: {
        id: true, name: true, districtId: true, clusterId: true, schoolType: true, clusterStatus: true, currentFySsaStatus: true,
        latitude: true, longitude: true,
        district: { select: { name: true, pcode: true, latitude: true, longitude: true, region: { select: { name: true } }, subRegion: { select: { name: true } } } },
        ssaRecords: { where: { deletedAt: null, fy }, orderBy: { dateOfSsa: 'desc' }, take: 1, select: { averageScore: true, scores: { select: { intervention: true, score: true } } } },
      },
    });
    // Exact-coordinate school points → auto-pins on the map. Empty until schools
    // are uploaded/geocoded with coordinates; then they appear automatically.
    const schoolPoints = schools
      .filter((s) => s.latitude != null && s.longitude != null)
      .map((s) => ({ schoolId: s.id, name: s.name, lat: s.latitude!, lng: s.longitude!, type: s.schoolType }));
    type Acc = {
      districtId: string; name: string; pcode: string | null; region: string; subRegion: string | null;
      centroidLat: number | null; centroidLng: number | null;
      schools: number; core: number; clustered: number; ssaDone: number; ssaSum: number; ssaN: number;
      critical: number; schoolIds: string[]; clusterIds: Set<string>;
      intv: Map<string, { sum: number; n: number }>;
    };
    const map = new Map<string, Acc>();
    for (const s of schools) {
      const cur: Acc = map.get(s.districtId) ?? {
        districtId: s.districtId, name: s.district?.name ?? 'District', pcode: s.district?.pcode ?? null,
        region: s.district?.region?.name ?? '', subRegion: s.district?.subRegion?.name ?? null,
        centroidLat: s.district?.latitude ?? null, centroidLng: s.district?.longitude ?? null,
        schools: 0, core: 0, clustered: 0, ssaDone: 0, ssaSum: 0, ssaN: 0, critical: 0, schoolIds: [],
        clusterIds: new Set<string>(), intv: new Map<string, { sum: number; n: number }>(),
      };
      cur.schools++;
      cur.schoolIds.push(s.id);
      if (s.clusterId) cur.clusterIds.add(s.clusterId);
      if (s.schoolType === 'core') cur.core++;
      if (s.clusterStatus === 'clustered') cur.clustered++;
      if (s.currentFySsaStatus === 'done') cur.ssaDone++;
      const rec = s.ssaRecords[0];
      if (rec?.averageScore != null) { cur.ssaSum += rec.averageScore; cur.ssaN++; if (rec.averageScore < 5) cur.critical++; }
      // Per-intervention accumulation → the district's weakest interventions.
      for (const sc of rec?.scores ?? []) {
        const e = cur.intv.get(sc.intervention) ?? { sum: 0, n: 0 };
        e.sum += sc.score; e.n++; cur.intv.set(sc.intervention, e);
      }
      map.set(s.districtId, cur);
    }
    const intvLabel = (k: string) => INTERVENTION_META.find((m) => m.key === k)?.label ?? k;

    // Completed activities per district (one grouped query over the scoped schools).
    const allSchoolIds = schools.map((s) => s.id);
    const completedBySchool = allSchoolIds.length
      ? await this.prisma.activity.groupBy({
          by: ['schoolId'],
          where: { deletedAt: null, status: 'completed', schoolId: { in: allSchoolIds } },
          _count: true,
        })
      : [];
    const completedMap = new Map(completedBySchool.map((g) => [g.schoolId, g._count]));
    const activitiesByDistrict = new Map<string, number>();
    for (const s of schools) {
      const n = completedMap.get(s.id) ?? 0;
      if (n) activitiesByDistrict.set(s.districtId, (activitiesByDistrict.get(s.districtId) ?? 0) + n);
    }

    const districts = [...map.values()].map((d) => {
      const avgSsa = d.ssaN ? Math.round((d.ssaSum / d.ssaN) * 10) / 10 : null;
      // Leadership status — combines weak average with a critical-school share.
      const status = districtStatus(avgSsa, d.schools, d.critical);
      // The 2 interventions the whole district is weakest in (lowest district
      // averages), deterministic tie-break by intervention key.
      const weakestInterventions = [...d.intv.entries()]
        .map(([k, v]) => ({ key: k, label: intvLabel(k), avg: Math.round((v.sum / v.n) * 10) / 10 }))
        .sort((a, b) => a.avg - b.avg || a.key.localeCompare(b.key))
        .slice(0, 2);
      return {
        districtId: d.districtId, pcode: d.pcode, district: d.name, region: d.region, subRegion: d.subRegion,
        centroidLat: d.centroidLat, centroidLng: d.centroidLng,
        schools: d.schools, coreSchools: d.core, clientSchools: d.schools - d.core,
        clustered: d.clustered, unclustered: d.schools - d.clustered, clusters: d.clusterIds.size,
        ssaDone: d.ssaDone, ssaPending: d.schools - d.ssaDone,
        ssaPct: d.schools ? Math.round((d.ssaDone / d.schools) * 100) : 0,
        avgSsa, criticalCount: d.critical,
        activitiesCompleted: activitiesByDistrict.get(d.districtId) ?? 0,
        status, weakestInterventions,
      };
    }).sort((a, b) => b.schools - a.schools);

    // Sub-region rollups (aggregate the districts).
    const srMap = new Map<string, { subRegion: string; region: string; districts: number; schools: number; core: number; clustered: number; ssaSum: number; ssaN: number; critical: number; activities: number }>();
    for (const d of districts) {
      if (!d.subRegion) continue;
      const cur = srMap.get(d.subRegion) ?? { subRegion: d.subRegion, region: d.region, districts: 0, schools: 0, core: 0, clustered: 0, ssaSum: 0, ssaN: 0, critical: 0, activities: 0 };
      cur.districts++; cur.schools += d.schools; cur.core += d.coreSchools; cur.clustered += d.clustered;
      if (d.avgSsa != null) { cur.ssaSum += d.avgSsa; cur.ssaN++; }
      cur.critical += d.criticalCount; cur.activities += d.activitiesCompleted;
      srMap.set(d.subRegion, cur);
    }
    const subRegions = [...srMap.values()].map((s) => ({
      subRegion: s.subRegion, region: s.region, districts: s.districts, schools: s.schools, coreSchools: s.core,
      clustered: s.clustered, avgSsa: s.ssaN ? Math.round((s.ssaSum / s.ssaN) * 10) / 10 : null,
      criticalCount: s.critical, activitiesCompleted: s.activities,
    })).sort((a, b) => b.schools - a.schools);

    const totalSchools = districts.reduce((a, d) => a + d.schools, 0);
    return {
      fy,
      summary: {
        districts: districts.length, subRegions: subRegions.length,
        schools: totalSchools, coreSchools: districts.reduce((a, d) => a + d.coreSchools, 0),
        clustered: districts.reduce((a, d) => a + d.clustered, 0),
        criticalSchools: districts.reduce((a, d) => a + d.criticalCount, 0),
        highRiskDistricts: districts.filter((d) => d.status === 'high_risk').length,
        activitiesCompleted: districts.reduce((a, d) => a + d.activitiesCompleted, 0),
      },
      districts,
      subRegions,
      schoolPoints,
    };
  }

  // Client-school coverage — real counts of client schools, how many have an
  // account owner, and which are below the SSA support threshold (avg < 5) and so
  // most need coverage/support. Replaces the fabricated coverage mock.
  async coverageSummary(user: AuthUser, geo?: GeoFilter) {
    const scope = await this.scope.resolveUserScope(user);
    const where = this.schoolScope(scope, geo);
    const fy = getOperationalFY();
    const clientSchools = await this.prisma.school.findMany({
      where: { ...where, schoolType: 'client' },
      select: {
        schoolId: true, name: true, accountOwnerId: true,
        district: { select: { name: true } },
        accountOwner: { select: { user: { select: { name: true } } } },
        ssaRecords: { where: { deletedAt: null, fy }, orderBy: { dateOfSsa: 'desc' }, take: 1, select: { averageScore: true } },
      },
    });
    const total = clientSchools.length;
    const assigned = clientSchools.filter((s) => s.accountOwnerId).length;
    const scored = clientSchools.map((s) => ({ s, avg: s.ssaRecords[0]?.averageScore ?? null }));
    const below = scored.filter((x) => x.avg != null && x.avg < 5);
    return {
      totalClientSchools: total,
      assigned, unassigned: total - assigned,
      coveragePct: total ? Math.round((assigned / total) * 100) : 0,
      schoolsBelowSsaThreshold: below.length,
      priority: below
        .sort((a, b) => (a.avg ?? 10) - (b.avg ?? 10))
        .slice(0, 25)
        .map((x) => ({
          schoolId: x.s.schoolId, name: x.s.name,
          district: x.s.district?.name ?? '',
          owner: x.s.accountOwner?.user?.name ?? 'Unassigned',
          avgSsa: x.avg,
        })),
    };
  }

  // ── SSA Performance by group (the average of EACH of the 8 interventions) ──
  // Starts from School Directory, joins the latest SSA per school in the FY,
  // scopes by the caller, includes Client + Core by default. Drillable.
  async ssaPerformanceByGroup(user: AuthUser, params: {
    fy?: string; groupBy?: SsaGroupBy; schoolType?: string;
    regionId?: string; districtId?: string; clusterId?: string;
    region?: string; district?: string; cluster?: string;
  }) {
    const scope = await this.scope.resolveUserScope(user);
    const groupBy: SsaGroupBy = params.groupBy ?? 'district';
    const fy = params.fy ?? getOperationalFY();

    const where: Prisma.SchoolWhereInput = { deletedAt: null, ...this.scope.aggregateSchoolWhere(scope), ...geoWhere(params) };
    if (params.schoolType && params.schoolType !== 'all') where.schoolType = params.schoolType as Prisma.SchoolWhereInput['schoolType'];
    if (params.regionId) where.regionId = params.regionId;
    if (params.districtId) where.districtId = params.districtId;
    if (params.clusterId) where.clusterId = params.clusterId;

    const schools = await this.prisma.school.findMany({
      where,
      select: {
        id: true, regionId: true, districtId: true, subCountyId: true, clusterId: true, accountOwnerId: true,
        region: { select: { name: true } }, district: { select: { name: true } }, cluster: { select: { name: true } },
        subCounty: { select: { name: true } },
        accountOwner: { include: { user: { select: { name: true } } } },
        ssaRecords: { where: { deletedAt: null, fy }, orderBy: { dateOfSsa: 'desc' }, take: 1, include: { scores: true } },
      },
    });

    const keyOf = (s: (typeof schools)[number]): string => {
      switch (groupBy) {
        case 'region': return s.regionId;
        case 'subCounty': return s.subCountyId ?? '__none__';
        case 'cluster': return s.clusterId ?? '__unclustered__';
        case 'cceo': return s.accountOwnerId ?? '__unassigned__';
        default: return s.districtId;
      }
    };
    const nameOf = (s: (typeof schools)[number]): string => {
      switch (groupBy) {
        case 'region': return s.region?.name ?? 'Region';
        case 'subCounty': return s.subCounty?.name ?? 'Unassigned sub-county';
        case 'cluster': return s.cluster?.name ?? 'Unclustered';
        case 'cceo': return s.accountOwner?.user?.name ?? 'Unassigned';
        default: return s.district?.name ?? 'District';
      }
    };

    type Acc = { name: string; schoolCount: number; assessed: number; interv: Map<SsaIntervention, { sum: number; n: number }> };
    const groups = new Map<string, Acc>();
    for (const s of schools) {
      const k = keyOf(s);
      const g = groups.get(k) ?? { name: nameOf(s), schoolCount: 0, assessed: 0, interv: new Map() };
      g.schoolCount++;
      const latest = s.ssaRecords[0];
      if (latest) {
        g.assessed++;
        for (const sc of latest.scores) {
          const cur = g.interv.get(sc.intervention) ?? { sum: 0, n: 0 };
          cur.sum += sc.score; cur.n++;
          g.interv.set(sc.intervention, cur);
        }
      }
      groups.set(k, g);
    }

    const rows = [...groups.entries()].map(([groupId, g]) => {
      const interventions: Record<string, number | null> = {};
      let oSum = 0, oN = 0;
      for (const m of INTERVENTION_META) {
        const acc = g.interv.get(m.key);
        const avg = acc && acc.n ? Math.round((acc.sum / acc.n) * 10) / 10 : null;
        interventions[m.code] = avg;
        if (avg != null) { oSum += avg; oN++; }
      }
      return {
        groupId, groupName: g.name,
        schoolCount: g.schoolCount, schoolsAssessed: g.assessed, schoolsMissingSSA: g.schoolCount - g.assessed,
        interventions, overallAverage: oN ? Math.round((oSum / oN) * 10) / 10 : null,
      };
    }).sort((a, b) => (b.overallAverage ?? 0) - (a.overallAverage ?? 0));

    return {
      fy, groupBy, schoolType: params.schoolType ?? 'all',
      // "By CCEO" grouping is a supervisory lens — only PL/CD/IA may use it (a
      // CCEO would just see themselves). Data is already role-scoped above.
      canGroupByCceo: CCEO_GROUP_ROLES.includes(user.activeRole),
      interventions: INTERVENTION_META.map((m) => ({ code: m.code, label: m.label })),
      rows,
    };
  }

  // ── Intervention Improvement (previous FY vs current FY per intervention) ──
  // Impact ≠ performance. Only schools with BOTH a previous-FY and current-FY SSA
  // count; the rest are surfaced as "no comparison", never faked.
  async interventionImprovement(user: AuthUser, params: {
    groupBy?: SsaGroupBy; schoolType?: string; currentFy?: string; prevFy?: string;
    regionId?: string; districtId?: string; clusterId?: string;
    region?: string; district?: string; cluster?: string;
  }) {
    const scope = await this.scope.resolveUserScope(user);
    const groupBy: SsaGroupBy = params.groupBy ?? 'district';
    const currentFy = params.currentFy ?? getOperationalFY();
    const prevFy = params.prevFy ?? String(Number(currentFy) - 1);

    const where: Prisma.SchoolWhereInput = { deletedAt: null, ...this.scope.aggregateSchoolWhere(scope), ...geoWhere(params) };
    if (params.schoolType && params.schoolType !== 'all') where.schoolType = params.schoolType as Prisma.SchoolWhereInput['schoolType'];
    if (params.regionId) where.regionId = params.regionId;
    if (params.districtId) where.districtId = params.districtId;
    if (params.clusterId) where.clusterId = params.clusterId;

    const schools = await this.prisma.school.findMany({
      where,
      select: {
        id: true, regionId: true, districtId: true, subCountyId: true, clusterId: true, accountOwnerId: true,
        region: { select: { name: true } }, district: { select: { name: true } }, cluster: { select: { name: true } },
        subCounty: { select: { name: true } }, accountOwner: { include: { user: { select: { name: true } } } },
        ssaRecords: { where: { deletedAt: null, fy: { in: [prevFy, currentFy] } }, orderBy: { dateOfSsa: 'desc' }, include: { scores: true } },
      },
    });

    const keyOf = (s: (typeof schools)[number]): string => {
      switch (groupBy) {
        case 'region': return s.regionId;
        case 'subCounty': return s.subCountyId ?? '__none__';
        case 'cluster': return s.clusterId ?? '__unclustered__';
        case 'cceo': return s.accountOwnerId ?? '__unassigned__';
        default: return s.districtId;
      }
    };
    const nameOf = (s: (typeof schools)[number]): string => {
      switch (groupBy) {
        case 'region': return s.region?.name ?? 'Region';
        case 'subCounty': return s.subCounty?.name ?? 'Unassigned sub-county';
        case 'cluster': return s.cluster?.name ?? 'Unclustered';
        case 'cceo': return s.accountOwner?.user?.name ?? 'Unassigned';
        default: return s.district?.name ?? 'District';
      }
    };

    type IAcc = { prevSum: number; prevN: number; currSum: number; currN: number; changeSum: number; changeN: number };
    type Acc = { name: string; improved: number; declined: number; noChange: number; noComparison: number; interv: Map<SsaIntervention, IAcc> };
    const groups = new Map<string, Acc>();

    for (const s of schools) {
      const k = keyOf(s);
      const g = groups.get(k) ?? { name: nameOf(s), improved: 0, declined: 0, noChange: 0, noComparison: 0, interv: new Map() };
      const prev = s.ssaRecords.find((r) => r.fy === prevFy);
      const curr = s.ssaRecords.find((r) => r.fy === currentFy);
      if (!prev || !curr || prev.averageScore == null || curr.averageScore == null) {
        g.noComparison++;
        groups.set(k, g);
        continue;
      }
      const delta = curr.averageScore - prev.averageScore;
      if (delta > 0.05) g.improved++; else if (delta < -0.05) g.declined++; else g.noChange++;
      const pMap = new Map(prev.scores.map((sc) => [sc.intervention, sc.score]));
      const cMap = new Map(curr.scores.map((sc) => [sc.intervention, sc.score]));
      for (const m of INTERVENTION_META) {
        const pv = pMap.get(m.key); const cv = cMap.get(m.key);
        const acc = g.interv.get(m.key) ?? { prevSum: 0, prevN: 0, currSum: 0, currN: 0, changeSum: 0, changeN: 0 };
        if (pv != null) { acc.prevSum += pv; acc.prevN++; }
        if (cv != null) { acc.currSum += cv; acc.currN++; }
        if (pv != null && cv != null) { acc.changeSum += cv - pv; acc.changeN++; }
        g.interv.set(m.key, acc);
      }
      groups.set(k, g);
    }

    const r1 = (x: number) => Math.round(x * 10) / 10;
    const rows = [...groups.entries()].map(([groupId, g]) => {
      const interventions = INTERVENTION_META.map((m) => {
        const a = g.interv.get(m.key);
        return {
          code: m.code, label: m.label,
          prevAvg: a && a.prevN ? r1(a.prevSum / a.prevN) : null,
          currAvg: a && a.currN ? r1(a.currSum / a.currN) : null,
          change: a && a.changeN ? r1(a.changeSum / a.changeN) : null,
        };
      });
      const withChange = interventions.filter((i) => i.change != null);
      const best = withChange.length ? withChange.reduce((b, i) => (i.change! > b.change! ? i : b)) : null;
      const declining = withChange.length ? withChange.reduce((d, i) => (i.change! < d.change! ? i : d)) : null;
      const weakest = interventions.filter((i) => i.currAvg != null).reduce<{ code: string; label: string; currAvg: number | null } | null>((w, i) => (!w || (i.currAvg! < (w.currAvg ?? 99)) ? i : w), null);
      const comparable = g.improved + g.declined + g.noChange;
      return {
        groupId, groupName: g.name,
        schoolsImproved: g.improved, schoolsDeclined: g.declined, schoolsNoChange: g.noChange, schoolsNoComparison: g.noComparison,
        improvementRate: comparable ? Math.round((g.improved / comparable) * 100) : null,
        bestIntervention: best ? { code: best.code, label: best.label, change: best.change } : null,
        decliningIntervention: declining && declining.change! < 0 ? { code: declining.code, label: declining.label, change: declining.change } : null,
        weakestIntervention: weakest ? { code: weakest.code, label: weakest.label, currAvg: weakest.currAvg } : null,
        interventions,
      };
    }).sort((a, b) => (b.improvementRate ?? -1) - (a.improvementRate ?? -1));

    return {
      currentFy, prevFy, groupBy, schoolType: params.schoolType ?? 'all',
      canGroupByCceo: CCEO_GROUP_ROLES.includes(user.activeRole),
      interventions: INTERVENTION_META.map((m) => ({ code: m.code, label: m.label })),
      rows,
    };
  }

  // Drilldown: the source schools behind a group's averages (scope-enforced).
  async ssaPerformanceDrilldown(user: AuthUser, params: { groupBy: SsaGroupBy; groupId: string; fy?: string; schoolType?: string }) {
    const scope = await this.scope.resolveUserScope(user);
    const fy = params.fy ?? getOperationalFY();
    const where: Prisma.SchoolWhereInput = { deletedAt: null, ...this.scope.aggregateSchoolWhere(scope) };
    if (params.schoolType && params.schoolType !== 'all') where.schoolType = params.schoolType as Prisma.SchoolWhereInput['schoolType'];
    switch (params.groupBy) {
      case 'region': where.regionId = params.groupId; break;
      case 'subCounty': where.subCountyId = params.groupId; break;
      case 'cluster': where.clusterId = params.groupId === '__unclustered__' ? null : params.groupId; break;
      case 'cceo': where.accountOwnerId = params.groupId === '__unassigned__' ? null : params.groupId; break;
      default: where.districtId = params.groupId;
    }
    const schools = await this.prisma.school.findMany({
      where,
      select: {
        schoolId: true, name: true, schoolType: true,
        district: { select: { name: true } }, cluster: { select: { name: true } },
        accountOwner: { include: { user: { select: { name: true } } } },
        ssaRecords: { where: { deletedAt: null, fy }, orderBy: { dateOfSsa: 'desc' }, take: 1, include: { scores: true } },
      },
      take: 500,
    });
    return schools.map((s) => {
      const latest = s.ssaRecords[0];
      const scoreMap = new Map(latest?.scores.map((sc) => [sc.intervention, sc.score]) ?? []);
      const interventions: Record<string, number | null> = {};
      for (const m of INTERVENTION_META) interventions[m.code] = scoreMap.get(m.key) ?? null;
      return {
        schoolId: s.schoolId, name: s.name, schoolType: s.schoolType,
        district: s.district?.name ?? null, cluster: s.cluster?.name ?? null,
        cceo: s.accountOwner?.user?.name ?? null,
        ssaDate: latest?.dateOfSsa ?? null, overallAverage: latest?.averageScore ?? null,
        interventions,
      };
    });
  }
}
