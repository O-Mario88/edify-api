import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ScopeService } from '../../common/scope/scope.service';
import { AuthUser } from '../../common/auth/auth-user';

export type SearchResult = {
  id: string; type: string; title: string; subtitle: string; status?: string;
  route: string; metadata?: Record<string, unknown>;
};

// Backend-powered, role-scoped, context-aware search. Never searches outside the
// caller's permission scope; never returns local/static data.
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService) {}

  async search(user: AuthUser, q: string, context = 'all'): Promise<{ query: string; context: string; results: SearchResult[] }> {
    const term = (q ?? '').trim();
    if (term.length < 2) return { query: term, context, results: [] };
    const scope = await this.scope.resolveUserScope(user);
    const schoolWhere: Prisma.SchoolWhereInput = { deletedAt: null, ...this.scope.schoolWhere(scope) };
    const coreOnly = context === 'core-schools';

    const insensitive = { contains: term, mode: 'insensitive' as const };
    const schools = await this.prisma.school.findMany({
      where: {
        ...schoolWhere,
        ...(coreOnly ? { schoolType: 'core' } : {}),
        OR: [
          { name: insensitive }, { schoolId: insensitive },
          { district: { name: insensitive } }, { subCounty: { name: insensitive } },
          { cluster: { name: insensitive } }, { accountOwner: { user: { name: insensitive } } },
        ],
      },
      include: { district: { select: { name: true } }, subCounty: { select: { name: true } }, cluster: { select: { name: true } } },
      take: 15,
    });

    const results: SearchResult[] = schools.map((s) => ({
      id: s.id, type: s.schoolType === 'core' ? 'core_school' : 'school',
      title: s.name,
      subtitle: [s.district.name, s.subCounty?.name, s.cluster?.name].filter(Boolean).join(' · '),
      status: s.currentFySsaStatus === 'done' ? 'SSA Complete' : s.clusterStatus !== 'clustered' ? 'Unclustered' : 'SSA Required',
      route: s.schoolType === 'core' ? `/core-schools/${s.schoolId}` : `/schools/${s.schoolId}`,
      metadata: { schoolId: s.schoolId, district: s.district.name, ssaStatus: s.currentFySsaStatus, clusterStatus: s.clusterStatus },
    }));

    if (!coreOnly && (context === 'all' || context === 'clusters')) {
      const districtScope = scope.countryScope || scope.canViewSummaryOnly ? {} : { districtId: { in: scope.districtIds.length ? scope.districtIds : ['__none__'] } };
      const clusters = await this.prisma.cluster.findMany({ where: { deletedAt: null, name: insensitive, ...districtScope }, include: { district: { select: { name: true } }, _count: { select: { schools: true } } }, take: 8 });
      results.push(...clusters.map((c) => ({ id: c.id, type: 'cluster', title: c.name, subtitle: `${c.district.name} · ${c._count.schools} schools`, status: c.status, route: `/clusters/${c.id}`, metadata: { districtId: c.districtId } })));
    }

    if (context === 'all' || context === 'special-projects') {
      const projects = await this.prisma.project.findMany({ where: { deletedAt: null, name: insensitive }, take: 6 });
      results.push(...projects.map((p) => ({ id: p.id, type: 'project', title: p.name, subtitle: `Project · ${p.category}`, route: `/special-projects/${p.id}`, metadata: { category: p.category } })));
    }

    return { query: term, context, results };
  }
}
