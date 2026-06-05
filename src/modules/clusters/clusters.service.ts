import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ScopeService } from '../../common/scope/scope.service';
import { AuthUser } from '../../common/auth/auth-user';
import { getOperationalFY } from '../../common/fy/fy.util';

@Injectable()
export class ClustersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  async list(user: AuthUser) {
    const scope = await this.scope.resolveUserScope(user);
    const where: Prisma.ClusterWhereInput = { deletedAt: null };
    if (!scope.countryScope && !scope.canViewSummaryOnly) where.districtId = { in: scope.districtIds.length ? scope.districtIds : ['__none__'] };
    return this.prisma.cluster.findMany({
      where, orderBy: { name: 'asc' },
      include: { district: { select: { name: true } }, _count: { select: { schools: true } } },
    });
  }

  async create(name: string, regionId: string, districtId: string, user: AuthUser) {
    const district = await this.prisma.district.findUnique({ where: { id: districtId } });
    if (!district || district.regionId !== regionId) throw new BadRequestException('district does not belong to region');
    const cluster = await this.prisma.cluster.create({ data: { name, regionId, districtId } });
    await this.audit.log({ action: 'cluster.create', subjectKind: 'Cluster', subjectId: cluster.id, actorId: user.userId, actorRole: user.activeRole, payload: { name } });
    return cluster;
  }

  // The cluster gate: assigning a cluster unlocks (or limits) planning readiness.
  async assignSchool(schoolId: string, clusterId: string, user: AuthUser) {
    const school = await this.prisma.school.findUnique({ where: { schoolId } });
    if (!school) throw new NotFoundException('School not found');
    const cluster = await this.prisma.cluster.findUnique({ where: { id: clusterId } });
    if (!cluster) throw new NotFoundException('Cluster not found');

    await this.prisma.schoolClusterAssignment.upsert({
      where: { schoolId_clusterId: { schoolId: school.id, clusterId } },
      update: {}, create: { schoolId: school.id, clusterId, assignedBy: user.userId },
    });
    const ssaCurrent = school.currentFySsaStatus === 'done';
    await this.prisma.school.update({
      where: { id: school.id },
      data: { clusterId, clusterStatus: 'clustered', planningReadiness: ssaCurrent ? 'ready' : 'limited' },
    });
    await this.audit.log({ action: 'cluster.assignSchool', subjectKind: 'School', subjectId: school.id, actorId: user.userId, actorRole: user.activeRole, payload: { clusterId, fy: getOperationalFY() } });
    return { ok: true, schoolId, clusterId, planningReadiness: ssaCurrent ? 'ready' : 'limited' };
  }

  // Recommendations: same district (then region) unclustered peers can share a cluster.
  async recommendations(schoolId: string, user: AuthUser) {
    const scope = await this.scope.resolveUserScope(user);
    const school = await this.prisma.school.findFirst({ where: { schoolId, deletedAt: null, ...this.scope.schoolWhere(scope) } });
    if (!school) throw new NotFoundException('School not found or outside scope');
    const sameDistrict = await this.prisma.cluster.findMany({ where: { districtId: school.districtId, deletedAt: null }, include: { _count: { select: { schools: true } } } });
    return { schoolId, district: school.districtId, clusters: sameDistrict };
  }
}
