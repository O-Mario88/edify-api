import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ScopeService, UserScope } from '../../common/scope/scope.service';
import { AuthUser } from '../../common/auth/auth-user';
import { fyOptions, getOperationalFY } from '../../common/fy/fy.util';

type FilterQuery = { fy?: string; regionId?: string; districtId?: string; subCountyId?: string; clusterId?: string; schoolType?: string };

// Database-driven, role-scoped filter options + counts. Powers every header
// dropdown and pill — never hardcoded on the frontend.
@Injectable()
export class FiltersService {
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService) {}

  async options(user: AuthUser) {
    const scope = await this.scope.resolveUserScope(user);
    // Geography options scoped: country roles see all; scoped roles see only the
    // regions/districts/sub-counties their schools touch.
    const all = scope.countryScope || scope.canViewSummaryOnly;
    // Country roles see every region/district anyway — don't load the school set
    // just to discard the ids. Scoped roles derive their geography from a
    // DISTINCT projection (bounded, deduped at the DB) rather than every row.
    let regionIds: string[] = [], districtIds: string[] = [], subCountyIds: string[] = [];
    if (!all) {
      const schoolWhere: Prisma.SchoolWhereInput = { deletedAt: null, ...this.scope.aggregateSchoolWhere(scope) };
      const geo = await this.prisma.school.findMany({ where: schoolWhere, select: { regionId: true, districtId: true, subCountyId: true }, distinct: ['regionId', 'districtId', 'subCountyId'], take: 5000 });
      regionIds = uniq(geo.map((s) => s.regionId));
      districtIds = uniq(geo.map((s) => s.districtId));
      subCountyIds = uniq(geo.map((s) => s.subCountyId).filter((x): x is string => !!x));
    }
    const [regions, districts, subCounties, clusters] = await Promise.all([
      this.prisma.region.findMany({ where: all ? {} : { id: { in: regionIds.length ? regionIds : ['__none__'] } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.district.findMany({ where: all ? {} : { id: { in: districtIds.length ? districtIds : ['__none__'] } }, select: { id: true, name: true, regionId: true }, orderBy: { name: 'asc' } }),
      this.prisma.subCounty.findMany({ where: all ? {} : { id: { in: subCountyIds.length ? subCountyIds : ['__none__'] } }, select: { id: true, name: true, districtId: true }, orderBy: { name: 'asc' } }),
      this.prisma.cluster.findMany({ where: { deletedAt: null, ...(all ? {} : { districtId: { in: districtIds.length ? districtIds : ['__none__'] } }) }, select: { id: true, name: true, districtId: true, subCountyId: true }, orderBy: { name: 'asc' } }),
    ]);

    return {
      fy: { options: fyOptions(), default: getOperationalFY() },
      regions, districts, subCounties, clusters,
      schoolType: ['client', 'core', 'potential_core', 'other'],
      clusterStatus: ['unclustered', 'clustered', 'needs_review'],
      ssaStatus: ['not_done', 'scheduled', 'partner_assigned', 'done'],
      planningReadiness: ['locked', 'limited', 'ready'],
    };
  }

  private where(scope: UserScope, q: FilterQuery): Prisma.SchoolWhereInput {
    const w: Prisma.SchoolWhereInput = { deletedAt: null, ...this.scope.aggregateSchoolWhere(scope) };
    if (q.regionId) w.regionId = q.regionId;
    if (q.districtId) w.districtId = q.districtId;
    if (q.subCountyId) w.subCountyId = q.subCountyId;
    if (q.clusterId) w.clusterId = q.clusterId;
    if (q.schoolType) w.schoolType = q.schoolType as Prisma.SchoolWhereInput['schoolType'];
    return w;
  }

  async counts(user: AuthUser, q: FilterQuery) {
    const scope = await this.scope.resolveUserScope(user);
    const base = this.where(scope, q);
    const [total, core, unclustered, planningReady, awaitingSsa, clusteredMissingSsa] = await Promise.all([
      this.prisma.school.count({ where: base }),
      this.prisma.school.count({ where: { ...base, schoolType: 'core' } }),
      this.prisma.school.count({ where: { ...base, clusterStatus: { in: ['unclustered', 'needs_review'] } } }),
      this.prisma.school.count({ where: { ...base, planningReadiness: 'ready' } }),
      this.prisma.school.count({ where: { ...base, schoolType: 'core', currentFySsaStatus: { not: 'done' } } }),
      this.prisma.school.count({ where: { ...base, clusterStatus: 'clustered', currentFySsaStatus: { not: 'done' } } }),
    ]);
    return {
      fy: q.fy ?? getOperationalFY(),
      totalSchools: total, coreSchools: core, clientSchools: total - core,
      corePlans: core,            // backend: a core school == a core plan record
      awaitingSSA: awaitingSsa,   // core schools missing current-FY SSA
      unclustered, planningReady, clusteredMissingSsa,
      champions: 0,               // champion lifecycle lives in the frontend core-store (not yet a backend model)
    };
  }

  /** Compact header summary for the Core Schools page pills. */
  async coreHeaderSummary(user: AuthUser, q: FilterQuery) {
    const c = await this.counts(user, q);
    return {
      fy: c.fy, corePlansCount: c.corePlans, championsCount: c.champions,
      awaitingSSACount: c.awaitingSSA, totalCoreSchools: c.coreSchools, planningReadyCount: c.planningReady,
      lastUpdatedAt: new Date().toISOString(),
    };
  }
}

function uniq<T>(a: T[]): T[] { return Array.from(new Set(a)); }
