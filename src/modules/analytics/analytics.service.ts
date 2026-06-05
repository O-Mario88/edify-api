import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ScopeService, UserScope } from '../../common/scope/scope.service';
import { AuthUser } from '../../common/auth/auth-user';

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
}
