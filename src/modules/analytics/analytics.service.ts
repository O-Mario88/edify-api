import { Injectable } from '@nestjs/common';
import { Prisma, SsaIntervention } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ScopeService, UserScope } from '../../common/scope/scope.service';
import { AuthUser } from '../../common/auth/auth-user';
import { getOperationalFY } from '../../common/fy/fy.util';

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

  private schoolScope(scope: UserScope): Prisma.SchoolWhereInput {
    // Aggregate scope: summary-only roles (RVP) get country-wide counts.
    return { deletedAt: null, ...this.scope.aggregateSchoolWhere(scope) };
  }

  async dashboardSummary(user: AuthUser) {
    const scope = await this.scope.resolveUserScope(user);
    const where = this.schoolScope(scope);
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

  async schoolDirectorySummary(user: AuthUser) {
    const scope = await this.scope.resolveUserScope(user);
    const where = this.schoolScope(scope);
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

  async ssaPerformance(user: AuthUser) {
    const scope = await this.scope.resolveUserScope(user);
    const where = this.schoolScope(scope);
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

  async activityPipeline(user: AuthUser) {
    const scope = await this.scope.resolveUserScope(user);
    const where = this.schoolScope(scope);
    const schoolIds = (await this.prisma.school.findMany({ where, select: { id: true } })).map((s) => s.id);
    const actWhere: Prisma.ActivityWhereInput = { deletedAt: null, ...(scope.countryScope ? {} : { schoolId: { in: schoolIds.length ? schoolIds : ['__none__'] } }) };
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
  async leadershipSummary(user: AuthUser) {
    const scope = await this.scope.resolveUserScope(user);
    const where = this.schoolScope(scope);
    const fy = getOperationalFY();
    const schoolIds = (await this.prisma.school.findMany({ where, select: { id: true } })).map((s) => s.id);
    const idsOrNone = schoolIds.length ? schoolIds : ['__none__'];
    const actWhere: Prisma.ActivityWhereInput = { deletedAt: null, ...(scope.countryScope ? {} : { schoolId: { in: idsOrNone } }) };
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

  // ── SSA Performance by group (the average of EACH of the 8 interventions) ──
  // Starts from School Directory, joins the latest SSA per school in the FY,
  // scopes by the caller, includes Client + Core by default. Drillable.
  async ssaPerformanceByGroup(user: AuthUser, params: {
    fy?: string; groupBy?: SsaGroupBy; schoolType?: string;
    regionId?: string; districtId?: string; clusterId?: string;
  }) {
    const scope = await this.scope.resolveUserScope(user);
    const groupBy: SsaGroupBy = params.groupBy ?? 'district';
    const fy = params.fy ?? getOperationalFY();

    const where: Prisma.SchoolWhereInput = { deletedAt: null, ...this.scope.aggregateSchoolWhere(scope) };
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
  }) {
    const scope = await this.scope.resolveUserScope(user);
    const groupBy: SsaGroupBy = params.groupBy ?? 'district';
    const currentFy = params.currentFy ?? getOperationalFY();
    const prevFy = params.prevFy ?? String(Number(currentFy) - 1);

    const where: Prisma.SchoolWhereInput = { deletedAt: null, ...this.scope.aggregateSchoolWhere(scope) };
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
