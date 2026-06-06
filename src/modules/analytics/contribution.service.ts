import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ScopeService, UserScope } from '../../common/scope/scope.service';
import { AuthUser } from '../../common/auth/auth-user';

// ─────────────────────────────────────────────────────────────────────────────
// Contribution engine — "how much am I contributing to school improvement?"
//
// Everything here is constrained by resolveUserScope. The lens picks WHICH
// schools count toward the contribution:
//   • own      → schools personally assigned (field work)        — every staff
//   • team     → schools of supervised CCEOs (PL) / country roles — PL/CD/IA/...
//   • combined → own + team                                      — PL/country
// A CCEO has no team, so team/combined collapse to own (and asking for `team`
// without canViewTeam is a 403 — scope is enforced server-side, never hidden in
// the client). Summary-only roles (RVP) get country aggregates but NO row-level
// drilldown.
// ─────────────────────────────────────────────────────────────────────────────

export type Lens = 'own' | 'team' | 'combined';
export type ContributionMetricKey =
  | 'schoolsReached' | 'teachersTrained' | 'schoolLeadersTrained'
  | 'learnersImpacted' | 'districtsCovered' | 'ssaImprovement';

export interface ContributionFilters {
  fy?: string;
  quarter?: string;
  districtId?: string;
  clusterId?: string;
  schoolType?: string;
  activityType?: string;
  projectId?: string;
  partnerId?: string;
}

const TRAINING_TYPES = ['training', 'school_improvement_training', 'cluster_training', 'core_training'];
const VISIT_TYPES = ['school_visit', 'follow_up_visit', 'coaching_visit', 'in_school_support', 'core_visit'];

type ActivityRow = {
  schoolId: string | null;
  clusterId: string | null;
  projectId: string | null;
  activityType: string;
  status: string;
  deliveryType: string;
  teachersAttended: number | null;
  leadersAttended: number | null;
  iaVerificationStatus: string;
  evidenceStatus: string;
  salesforceActivityId: string | null;
};

type SchoolRow = {
  id: string;
  name: string;
  schoolType: string;
  districtId: string;
  regionId: string;
  subCountyId: string | null;
  clusterId: string | null;
  enrollment: number | null;
};

const uniq = <T>(a: T[]) => Array.from(new Set(a));
const delivered = (a: ActivityRow) => a.status === 'completed' || a.iaVerificationStatus === 'confirmed';

@Injectable()
export class ContributionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
  ) {}

  // Resolve the schools that count toward this lens, enforcing scope.
  private async lensSchools(scope: UserScope, lens: Lens, f: ContributionFilters) {
    const filterWhere: Prisma.SchoolWhereInput = { deletedAt: null };
    if (f.districtId) filterWhere.districtId = f.districtId;
    if (f.clusterId) filterWhere.clusterId = f.clusterId;
    if (f.schoolType) filterWhere.schoolType = f.schoolType as Prisma.SchoolWhereInput['schoolType'];

    let where: Prisma.SchoolWhereInput;
    let summaryOnly = false;
    if (scope.canViewCountry) {
      where = filterWhere; // country roles: all schools (+ explicit filters)
    } else if (scope.canViewSummaryOnly) {
      where = filterWhere; // RVP: country aggregate, no drilldown
      summaryOnly = true;
    } else {
      let ids: string[];
      if (lens === 'team') {
        if (!scope.canViewTeam) throw new ForbiddenException('No team lens for your role');
        ids = scope.teamSchoolIds;
      } else if (lens === 'combined') {
        ids = scope.schoolIds;
      } else {
        ids = scope.ownSchoolIds;
      }
      where = { ...filterWhere, id: { in: ids.length ? ids : ['__none__'] } };
    }
    const schools = (await this.prisma.school.findMany({
      where,
      select: { id: true, name: true, schoolType: true, districtId: true, regionId: true, subCountyId: true, clusterId: true, enrollment: true },
    })) as SchoolRow[];
    return { schools, summaryOnly };
  }

  private async activitiesFor(schoolIds: string[], f: ContributionFilters, countryAll: boolean): Promise<ActivityRow[]> {
    const where: Prisma.ActivityWhereInput = { deletedAt: null };
    if (!countryAll) where.schoolId = { in: schoolIds.length ? schoolIds : ['__none__'] };
    if (f.fy) where.fy = f.fy;
    if (f.quarter) where.quarter = f.quarter;
    if (f.activityType) where.activityType = f.activityType as Prisma.ActivityWhereInput['activityType'];
    if (f.projectId) where.projectId = f.projectId;
    if (f.partnerId) where.assignedPartnerId = f.partnerId;
    return (await this.prisma.activity.findMany({
      where,
      select: {
        schoolId: true, clusterId: true, projectId: true, activityType: true, status: true, deliveryType: true,
        teachersAttended: true, leadersAttended: true, iaVerificationStatus: true, evidenceStatus: true, salesforceActivityId: true,
      },
    })) as ActivityRow[];
  }

  async summary(user: AuthUser, lens: Lens, f: ContributionFilters) {
    const scope = await this.scope.resolveUserScope(user);
    const { schools, summaryOnly } = await this.lensSchools(scope, lens, f);
    const schoolById = new Map(schools.map((s) => [s.id, s]));
    const inScopeIds = schools.map((s) => s.id);
    const countryAll = scope.canViewCountry || scope.canViewSummaryOnly;

    const acts = await this.activitiesFor(inScopeIds, f, countryAll);
    const done = acts.filter(delivered);

    // Reach — unique schools with ≥1 delivered activity.
    const reached = uniq(done.map((a) => a.schoolId).filter((x): x is string => !!x));
    const reachedSchools = reached.map((id) => schoolById.get(id)).filter((s): s is SchoolRow => !!s);

    const isTraining = (t: string) => TRAINING_TYPES.includes(t);
    const isVisit = (t: string) => VISIT_TYPES.includes(t);
    const trainings = done.filter((a) => isTraining(a.activityType));

    // Learners impacted = sum of latest enrollment of UNIQUE reached schools.
    // Never multiply enrollment by activity count.
    const missingEnrollment = reachedSchools.filter((s) => s.enrollment == null).length;
    const learnersImpacted = reachedSchools.reduce((n, s) => n + (s.enrollment ?? 0), 0);
    const trainingsMissingAttendance = trainings.filter((a) => a.teachersAttended == null && a.leadersAttended == null).length;

    // SSA improvement — latest vs previous averageScore per in-scope school.
    const ssa = await this.prisma.ssaRecord.findMany({
      where: { deletedAt: null, ...(countryAll ? {} : { schoolId: { in: inScopeIds.length ? inScopeIds : ['__none__'] } }), ...(f.fy ? {} : {}) },
      select: { schoolId: true, averageScore: true, dateOfSsa: true, scores: { select: { intervention: true, score: true } } },
      orderBy: { dateOfSsa: 'asc' },
    });
    const bySchool = new Map<string, { avg: number | null }[]>();
    for (const r of ssa) {
      const arr = bySchool.get(r.schoolId) ?? [];
      arr.push({ avg: r.averageScore });
      bySchool.set(r.schoolId, arr);
    }
    let schoolsImproved = 0;
    let noComparison = 0;
    for (const arr of bySchool.values()) {
      const scored = arr.filter((x) => x.avg != null);
      if (scored.length < 2) { noComparison++; continue; }
      if ((scored[scored.length - 1].avg ?? 0) > (scored[scored.length - 2].avg ?? 0)) schoolsImproved++;
    }
    // Best / worst intervention by average score across in-scope SSA.
    const interv = new Map<string, { sum: number; n: number }>();
    for (const r of ssa) for (const sc of r.scores) {
      const cur = interv.get(sc.intervention) ?? { sum: 0, n: 0 };
      cur.sum += sc.score; cur.n++; interv.set(sc.intervention, cur);
    }
    const ranked = [...interv.entries()].map(([k, v]) => ({ intervention: k, average: Math.round((v.sum / v.n) * 10) / 10 })).sort((a, b) => b.average - a.average);

    const metrics = {
      schoolsReached: reached.length,
      clientSchoolsReached: reachedSchools.filter((s) => s.schoolType === 'client').length,
      coreSchoolsSupported: reachedSchools.filter((s) => s.schoolType === 'core').length,
      projectSchoolsSupported: uniq(done.filter((a) => a.projectId).map((a) => a.schoolId).filter(Boolean)).length,
      learnersImpacted,
      teachersTrained: trainings.reduce((n, a) => n + (a.teachersAttended ?? 0), 0),
      schoolLeadersTrained: trainings.reduce((n, a) => n + (a.leadersAttended ?? 0), 0),
      districtsCovered: uniq(reachedSchools.map((s) => s.districtId)).length,
      subCountiesCovered: uniq(reachedSchools.map((s) => s.subCountyId).filter(Boolean)).length,
      clustersCovered: uniq(reachedSchools.map((s) => s.clusterId).filter(Boolean)).length,
      regionsCovered: uniq(reachedSchools.map((s) => s.regionId)).length,
      visitsCompleted: done.filter((a) => isVisit(a.activityType)).length,
      trainingsCompleted: trainings.length,
      clusterMeetingsCompleted: done.filter((a) => a.activityType === 'cluster_meeting').length,
      ssaCompleted: ssa.length,
      schoolsImproved,
      bestIntervention: ranked[0]?.intervention ?? null,
      worstIntervention: ranked[ranked.length - 1]?.intervention ?? null,
      partnerActivities: done.filter((a) => a.deliveryType === 'partner').length,
      staffActivities: done.filter((a) => a.deliveryType === 'staff').length,
      evidencePending: done.filter((a) => a.evidenceStatus !== 'accepted').length,
      salesforceIdsPending: done.filter((a) => !a.salesforceActivityId).length,
      iaVerifiedActivities: acts.filter((a) => a.iaVerificationStatus === 'confirmed').length,
    };

    const dataQuality: string[] = [];
    if (missingEnrollment > 0) dataQuality.push(`Learners impacted may be undercounted — ${missingEnrollment} reached school(s) missing enrollment.`);
    if (trainingsMissingAttendance > 0) dataQuality.push(`Teachers/leaders trained pending — ${trainingsMissingAttendance} completed training(s) missing attendance counts.`);
    if (noComparison > 0) dataQuality.push(`SSA improvement unavailable for ${noComparison} school(s) with no comparison SSA.`);

    return {
      lens,
      role: scope.activeRole,
      summaryOnly,
      canViewTeam: scope.canViewTeam,
      schoolsInScope: schools.length,
      metrics,
      dataQuality,
    };
  }

  async drilldown(user: AuthUser, metric: ContributionMetricKey, lens: Lens, f: ContributionFilters) {
    const scope = await this.scope.resolveUserScope(user);
    if (scope.canViewSummaryOnly) throw new ForbiddenException('Summary-only role: no row-level drilldown');
    const { schools } = await this.lensSchools(scope, lens, f);
    const schoolById = new Map(schools.map((s) => [s.id, s]));
    const inScopeIds = schools.map((s) => s.id);
    const countryAll = scope.canViewCountry;
    const acts = await this.activitiesFor(inScopeIds, f, countryAll);
    const done = acts.filter(delivered);

    if (metric === 'schoolsReached') {
      const reached = uniq(done.map((a) => a.schoolId).filter((x): x is string => !!x));
      return reached.map((id) => schoolById.get(id)).filter(Boolean).map((s) => ({ schoolId: s!.id, name: s!.name, schoolType: s!.schoolType, districtId: s!.districtId }));
    }
    if (metric === 'learnersImpacted') {
      const reached = uniq(done.map((a) => a.schoolId).filter((x): x is string => !!x));
      return reached.map((id) => schoolById.get(id)).filter(Boolean).map((s) => ({ schoolId: s!.id, name: s!.name, enrollment: s!.enrollment ?? null }));
    }
    if (metric === 'districtsCovered') {
      const reachedSchools = uniq(done.map((a) => a.schoolId).filter((x): x is string => !!x)).map((id) => schoolById.get(id)).filter((s): s is SchoolRow => !!s);
      const byDistrict = new Map<string, number>();
      for (const s of reachedSchools) byDistrict.set(s.districtId, (byDistrict.get(s.districtId) ?? 0) + 1);
      return [...byDistrict.entries()].map(([districtId, schools]) => ({ districtId, schools }));
    }
    if (metric === 'teachersTrained' || metric === 'schoolLeadersTrained') {
      return done.filter((a) => TRAINING_TYPES.includes(a.activityType) && a.schoolId).map((a) => {
        const s = schoolById.get(a.schoolId!);
        return { schoolId: a.schoolId, name: s?.name ?? null, activityType: a.activityType, teachersAttended: a.teachersAttended ?? 0, leadersAttended: a.leadersAttended ?? 0 };
      });
    }
    if (metric === 'ssaImprovement') {
      const ssa = await this.prisma.ssaRecord.findMany({
        where: { deletedAt: null, ...(countryAll ? {} : { schoolId: { in: inScopeIds.length ? inScopeIds : ['__none__'] } }) },
        select: { schoolId: true, averageScore: true, dateOfSsa: true },
        orderBy: { dateOfSsa: 'asc' },
      });
      const bySchool = new Map<string, number[]>();
      for (const r of ssa) if (r.averageScore != null) { const a = bySchool.get(r.schoolId) ?? []; a.push(r.averageScore); bySchool.set(r.schoolId, a); }
      const out: { schoolId: string; name: string | null; before: number; after: number; change: number }[] = [];
      for (const [schoolId, scores] of bySchool) {
        if (scores.length < 2) continue;
        const before = scores[scores.length - 2];
        const after = scores[scores.length - 1];
        out.push({ schoolId, name: schoolById.get(schoolId)?.name ?? null, before, after, change: Math.round((after - before) * 10) / 10 });
      }
      return out.sort((a, b) => b.change - a.change);
    }
    return [];
  }
}
