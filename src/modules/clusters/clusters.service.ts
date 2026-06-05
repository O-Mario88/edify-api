import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ClusterType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ScopeService } from '../../common/scope/scope.service';
import { ReadinessService } from '../../common/readiness/readiness.service';
import { permissionsForRole, PERMISSIONS } from '../../common/rbac/permissions';
import { AuthUser } from '../../common/auth/auth-user';
import { CreateClusterDto, CreateClusterFromSchoolDto } from './dto/cluster.dto';

@Injectable()
export class ClustersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly readiness: ReadinessService,
  ) {}

  // ── Lists ─────────────────────────────────────────────────────────
  async list(user: AuthUser) {
    const scope = await this.scope.resolveUserScope(user);
    const where: Prisma.ClusterWhereInput = { deletedAt: null };
    if (!scope.countryScope && !scope.canViewSummaryOnly) where.districtId = { in: scope.districtIds.length ? scope.districtIds : ['__none__'] };
    return this.prisma.cluster.findMany({
      where, orderBy: { name: 'asc' },
      include: { district: { select: { name: true } }, subCounty: { select: { name: true } }, _count: { select: { schools: true } } },
    });
  }

  /** The cluster's school roster (§12). */
  async clusterSchools(clusterId: string, user: AuthUser) {
    const scope = await this.scope.resolveUserScope(user);
    const cluster = await this.prisma.cluster.findUnique({ where: { id: clusterId } });
    if (!cluster) throw new NotFoundException('Cluster not found');
    if (!scope.countryScope && !scope.canViewSummaryOnly && !scope.districtIds.includes(cluster.districtId)) throw new ForbiddenException('Cluster outside your scope');
    const schools = await this.prisma.school.findMany({
      where: { clusterId, deletedAt: null },
      include: { subCounty: { select: { name: true } }, accountOwner: { include: { user: { select: { name: true } } } }, ssaRecords: { where: { deletedAt: null }, orderBy: { dateOfSsa: 'desc' }, take: 1 } },
      orderBy: { name: 'asc' },
    });
    return {
      cluster: { id: cluster.id, name: cluster.name, status: cluster.status, type: cluster.clusterType },
      count: schools.length,
      schools: schools.map((s) => ({
        schoolId: s.schoolId, name: s.name, schoolType: s.schoolType, subCounty: s.subCounty?.name,
        accountOwner: s.accountOwner?.user.name, ssaStatus: s.currentFySsaStatus, planningReadiness: s.planningReadiness,
        latestSsa: s.ssaRecords[0]?.averageScore ?? null, stage: this.readiness.stageFor(s),
      })),
    };
  }

  /** Sub-counties with NO active cluster + their unclustered school counts (the
   *  default cluster-creation list, §9). */
  async subCountiesWithoutClusters(user: AuthUser) {
    const scope = await this.scope.resolveUserScope(user);
    const districtFilter: Prisma.SubCountyWhereInput = (!scope.countryScope && !scope.canViewSummaryOnly)
      ? { districtId: { in: scope.districtIds.length ? scope.districtIds : ['__none__'] } } : {};
    const subs = await this.prisma.subCounty.findMany({
      where: { ...districtFilter, clusters: { none: { deletedAt: null, status: 'active' } } },
      include: { district: { select: { name: true } }, _count: { select: { schools: { where: { deletedAt: null, clusterStatus: 'unclustered' } } } } },
      orderBy: [{ district: { name: 'asc' } }, { name: 'asc' }],
    });
    return subs.map((s) => ({ subCountyId: s.id, subCounty: s.name, district: s.district.name, districtId: s.districtId, unclusteredSchools: s._count.schools }));
  }

  /** Recommendations: same sub-county → same district (→ region needs override). */
  async recommendations(schoolId: string, user: AuthUser) {
    const scope = await this.scope.resolveUserScope(user);
    const school = await this.prisma.school.findFirst({ where: { schoolId, deletedAt: null, ...this.scope.schoolWhere(scope) }, include: { subCounty: true } });
    if (!school) throw new NotFoundException('School not found or outside scope');
    const base = { deletedAt: null, status: 'active' as const };
    const [sameSub, sameDistrict] = await Promise.all([
      school.subCountyId ? this.prisma.cluster.findMany({ where: { ...base, subCountyId: school.subCountyId }, include: { _count: { select: { schools: true } } } }) : Promise.resolve([]),
      this.prisma.cluster.findMany({ where: { ...base, districtId: school.districtId }, include: { subCounty: { select: { name: true } }, _count: { select: { schools: true } } } }),
    ]);
    return {
      schoolId, district: school.districtId, subCounty: school.subCounty?.name,
      sameSubCounty: sameSub, sameDistrict,
      canCreate: scope.permissions.includes(PERMISSIONS.CLUSTER_ASSIGN),
      hint: sameSub.length === 0 && school.subCountyId ? `No cluster exists for ${school.subCounty?.name}. Create one now.` : undefined,
    };
  }

  // ── Create ────────────────────────────────────────────────────────
  async create(dto: CreateClusterDto, user: AuthUser) {
    const district = await this.prisma.district.findUnique({ where: { id: dto.districtId } });
    if (!district || district.regionId !== dto.regionId) throw new BadRequestException('district does not belong to region');
    const scope = await this.scope.resolveUserScope(user);
    if (!scope.countryScope && !scope.districtIds.includes(dto.districtId)) throw new ForbiddenException('District outside your scope');

    let subCountyName: string | undefined;
    let needsReview = false;
    if (dto.subCountyId) {
      const sc = await this.prisma.subCounty.findUnique({ where: { id: dto.subCountyId } });
      if (!sc || sc.districtId !== dto.districtId) throw new BadRequestException('sub-county does not belong to district');
      subCountyName = sc.name;
      // Sub-county uniqueness (§10): one active cluster per sub-county by default.
      const existing = await this.prisma.cluster.findFirst({ where: { subCountyId: dto.subCountyId, deletedAt: null, status: 'active' } });
      if (existing) {
        const canOverride = permissionsForRole(user.activeRole).includes(PERMISSIONS.CLUSTER_OVERRIDE);
        if (!canOverride || !dto.overrideReason?.trim()) {
          await this.audit.log({ action: 'cluster.createBlocked', subjectKind: 'SubCounty', subjectId: dto.subCountyId, actorId: user.userId, actorRole: user.activeRole, payload: { reason: 'sub-county already has an active cluster' } });
          throw new BadRequestException('This sub-county already has an active cluster. Provide an override reason (requires permission) to add another.');
        }
        needsReview = true;
      }
    }

    let cluster;
    try {
      cluster = await this.prisma.cluster.create({
        data: {
          name: dto.name, regionId: dto.regionId, districtId: dto.districtId, subCountyId: dto.subCountyId,
          subCountyName, clusterType: dto.clusterType ?? ClusterType.mixed,
          status: needsReview ? 'needs_review' : 'active',
          overrideReason: needsReview ? dto.overrideReason : undefined, responsibleStaffId: dto.responsibleStaffId,
        },
      });
    } catch (e) {
      // Race backstop: the partial unique index rejected a concurrent 2nd active
      // cluster for this sub-county (the findFirst check above lost the race).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('This sub-county already has an active cluster.');
      }
      throw e;
    }
    await this.audit.log({ action: needsReview ? 'cluster.createOverride' : 'cluster.create', subjectKind: 'Cluster', subjectId: cluster.id, actorId: user.userId, actorRole: user.activeRole, payload: { name: dto.name, subCountyId: dto.subCountyId, districtId: dto.districtId, overrideReason: dto.overrideReason } });
    return cluster;
  }

  /** Create a cluster from a selected school — prefills geography + auto-assigns. */
  async createFromSchool(dto: CreateClusterFromSchoolDto, user: AuthUser) {
    const scope = await this.scope.resolveUserScope(user);
    const school = await this.prisma.school.findFirst({ where: { schoolId: dto.schoolId, deletedAt: null, ...this.scope.schoolWhere(scope) } });
    if (!school) throw new NotFoundException('School not found or outside scope');
    const cluster = await this.create({
      name: dto.name, regionId: school.regionId, districtId: school.districtId, subCountyId: school.subCountyId ?? undefined,
      clusterType: dto.clusterType, overrideReason: dto.overrideReason,
    }, user);
    try {
      const assigned = await this.assignSchool(dto.schoolId, cluster.id, undefined, user);
      return { cluster, assignment: assigned };
    } catch (e) {
      // Compensate: don't leave an orphan cluster occupying the sub-county slot.
      await this.prisma.cluster.update({ where: { id: cluster.id }, data: { deletedAt: new Date(), status: 'inactive' } });
      throw e;
    }
  }

  // ── Assign (the bridge to planning) ───────────────────────────────
  async assignSchool(schoolId: string, clusterId: string, reason: string | undefined, user: AuthUser) {
    const scope = await this.scope.resolveUserScope(user);
    const school = await this.prisma.school.findFirst({ where: { schoolId, deletedAt: null, ...this.scope.schoolWhere(scope) } });
    if (!school) throw new NotFoundException('School not found or outside your scope');
    const cluster = await this.prisma.cluster.findUnique({ where: { id: clusterId } });
    if (!cluster || cluster.deletedAt) throw new NotFoundException('Cluster not found');
    // Scope the cluster too (H4) — a scoped role can't assign into out-of-scope clusters.
    if (!scope.countryScope && !scope.districtIds.includes(cluster.districtId)) throw new ForbiddenException('Cluster is outside your scope');
    // Geography must match — district AND sub-county (§4/§10/§11).
    if (cluster.districtId !== school.districtId) throw new BadRequestException('Cluster and school are in different districts');
    if (cluster.subCountyId && school.subCountyId && cluster.subCountyId !== school.subCountyId) {
      throw new BadRequestException('Cluster and school are in different sub-counties');
    }

    const previousClusterId = school.clusterId;
    await this.prisma.schoolClusterAssignment.upsert({
      where: { schoolId_clusterId: { schoolId: school.id, clusterId } },
      update: { assignedBy: user.userId }, create: { schoolId: school.id, clusterId, assignedBy: user.userId },
    });
    await this.prisma.school.update({ where: { id: school.id }, data: { clusterId, clusterStatus: 'clustered' } });
    // Recompute planning readiness — the bridge to the planning lists (§16).
    const { planningReadiness, stage } = await this.readiness.recompute(school.id);

    await this.audit.log({
      action: previousClusterId && previousClusterId !== clusterId ? 'cluster.moveSchool' : 'cluster.assignSchool',
      subjectKind: 'School', subjectId: school.id, actorId: user.userId, actorRole: user.activeRole,
      payload: { clusterId, previousClusterId, subCountyId: school.subCountyId, districtId: school.districtId, reason, planningReadiness },
    });
    return { ok: true, schoolId, clusterId, previousClusterId, planningReadiness, stage };
  }
}
