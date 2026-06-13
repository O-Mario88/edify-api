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
    const rows = await this.prisma.cluster.findMany({
      where, orderBy: { name: 'asc' }, take: 1000, // safety bound on payload
      include: {
        district: { select: { name: true } },
        subCounty: { select: { name: true } },
        coveredSubCounties: { include: { subCounty: { select: { id: true, name: true } } } },
        schools: { where: { deletedAt: null }, select: { currentFySsaStatus: true } },
        _count: { select: { schools: true } },
      },
    });
    return rows.map((c) => ({
      id: c.id, name: c.name, clusterType: c.clusterType, status: c.status,
      district: c.district ? { name: c.district.name } : null,
      subCounty: c.subCounty ? { name: c.subCounty.name } : null,
      subCountyName: c.subCountyName, responsibleStaffId: c.responsibleStaffId,
      clusterLeaderName: c.clusterLeaderName, clusterLeaderPhone: c.clusterLeaderPhone,
      subCounties: c.coveredSubCounties.map((x) => x.subCounty.name),
      subCountyIds: c.coveredSubCounties.map((x) => x.subCountyId),
      schoolCount: c._count.schools,
      schoolsWithSsa: c.schools.filter((s) => s.currentFySsaStatus === 'done').length,
      _count: c._count,
    }));
  }

  /** The cluster's school roster (§12). */
  async clusterSchools(clusterId: string, user: AuthUser) {
    const scope = await this.scope.resolveUserScope(user);
    const cluster = await this.prisma.cluster.findUnique({ where: { id: clusterId } });
    if (!cluster) throw new NotFoundException('Cluster not found');
    if (!scope.countryScope && !scope.canViewSummaryOnly && !scope.districtIds.includes(cluster.districtId)) throw new ForbiddenException('Cluster outside your scope');
    const schools = await this.prisma.school.findMany({
      where: { clusterId, deletedAt: null }, take: 500, // a cluster roster is small; bound anyway
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
      where: { ...districtFilter, clusters: { none: { deletedAt: null, status: 'active' } } }, take: 1000,
      include: { district: { select: { name: true } }, _count: { select: { schools: { where: { deletedAt: null, clusterStatus: 'unclustered' } } } } },
      orderBy: [{ district: { name: 'asc' } }, { name: 'asc' }],
    });
    return subs.map((s) => ({ subCountyId: s.id, subCounty: s.name, district: s.district.name, districtId: s.districtId, unclusteredSchools: s._count.schools }));
  }

  /** Per-cluster meeting-slot planning status, derived from REAL cluster
   *  activities (no fabricated slots). SIT = the cluster's SIT/cluster-training
   *  activity; meetings 1/2/3 = its cluster_meeting activities ordered by
   *  planned date. Later meetings are "Not Yet Due" until the prior completes. */
  async clusterPlanning(user: AuthUser) {
    const scope = await this.scope.resolveUserScope(user);
    const where: Prisma.ClusterWhereInput = { deletedAt: null, status: 'active' };
    if (!scope.countryScope && !scope.canViewSummaryOnly) where.districtId = { in: scope.districtIds.length ? scope.districtIds : ['__none__'] };

    const clusters = await this.prisma.cluster.findMany({
      where, take: 1000, orderBy: { name: 'asc' },
      include: {
        district: { select: { name: true } },
        subCounty: { select: { name: true } },
        _count: { select: { schools: true } },
        schools: { where: { deletedAt: null }, select: { currentFySsaStatus: true } },
        activities: {
          // Exclude cancelled/rejected/deferred work — a dropped meeting must
          // not count toward a filled slot.
          where: {
            deletedAt: null,
            activityType: { in: ['cluster_meeting', 'cluster_training', 'school_improvement_training'] },
            status: { notIn: ['cancelled', 'rejected', 'deferred', 'not_planned'] },
          },
          select: { activityType: true, status: true, scheduledDate: true, plannedMonth: true, rescheduleCount: true, clusterSlot: true },
          orderBy: [{ plannedMonth: 'asc' }, { scheduledDate: 'asc' }],
        },
      },
    });

    const DONE = new Set(['completed', 'evidence_uploaded', 'evidence_accepted', 'salesforce_id_required', 'awaiting_ia_verification', 'ia_verified', 'accountant_confirmed']);
    type Slot = 'Completed' | 'Scheduled' | 'Rescheduled' | 'Missing' | 'Not Yet Due';
    const slotOf = (a?: { status: string; rescheduleCount: number }): Slot => {
      if (!a) return 'Missing';
      if (DONE.has(a.status)) return 'Completed';
      if (a.rescheduleCount > 0) return 'Rescheduled';
      return 'Scheduled';
    };

    return clusters.map((c) => {
      const schoolsWithSsa = c.schools.filter((s) => s.currentFySsaStatus === 'done').length;
      // Prefer the EXPLICIT slot tag; fall back to ordering for untagged (legacy)
      // meetings so historical data still reads sensibly.
      const bySlot = (slot: string) => c.activities.find((a) => a.clusterSlot === slot);
      const untagged = c.activities.filter((a) => a.activityType === 'cluster_meeting' && !a.clusterSlot);
      let u = 0;
      const sitAct = bySlot('sit') ?? c.activities.find((a) => !a.clusterSlot && (a.activityType === 'school_improvement_training' || a.activityType === 'cluster_training'));
      const firstAct = bySlot('first_meeting') ?? untagged[u++];
      const secondAct = bySlot('second_meeting') ?? untagged[u++];
      const thirdAct = bySlot('third_meeting') ?? untagged[u++];

      const sit = slotOf(sitAct);
      const firstMeeting = slotOf(firstAct);
      const secondMeeting = firstMeeting === 'Completed' ? slotOf(secondAct) : 'Not Yet Due';
      const thirdMeeting = secondMeeting === 'Completed' ? slotOf(thirdAct) : 'Not Yet Due';

      // First outstanding slot drives the bucket (SIT first, then meetings in order).
      const gapCategory =
        sit === 'Missing' ? 'no_sit'
          : firstMeeting === 'Missing' ? 'no_first_meeting'
            : secondMeeting === 'Missing' ? 'no_second_meeting'
              : thirdMeeting === 'Missing' ? 'no_third_meeting'
                : 'no_third_meeting';

      return {
        id: c.id, clusterName: c.name,
        district: c.district?.name ?? '', subCounty: c.subCounty?.name ?? c.subCountyName ?? '',
        schoolsCount: c._count.schools, schoolsWithSsa,
        sit, firstMeeting, secondMeeting, thirdMeeting, gapCategory,
      };
    });
  }

  // Shared include so cluster recommendations / eligibility carry the covered
  // sub-county set + leader contact the directory drawer needs.
  private readonly clusterCardInclude = {
    district: { select: { name: true } },
    subCounty: { select: { name: true } },
    coveredSubCounties: { include: { subCounty: { select: { name: true } } } },
    _count: { select: { schools: true } },
  } as const;

  /** Eligibility: same sub-county (cluster COVERS it) → same district (→ region
   *  needs override). A cluster is "same sub-county" iff the school's sub-county
   *  is in its covered set. */
  async recommendations(schoolId: string, user: AuthUser) {
    const scope = await this.scope.resolveUserScope(user);
    const school = await this.prisma.school.findFirst({ where: { schoolId, deletedAt: null, ...this.scope.schoolWhere(scope) }, include: { subCounty: true } });
    if (!school) throw new NotFoundException('School not found or outside scope');
    const base = { deletedAt: null, status: 'active' as const };
    const [sameSubRaw, sameDistrictRaw] = await Promise.all([
      school.subCountyId
        ? this.prisma.cluster.findMany({
            where: { ...base, OR: [{ subCountyId: school.subCountyId }, { coveredSubCounties: { some: { subCountyId: school.subCountyId } } }] },
            include: this.clusterCardInclude,
          })
        : Promise.resolve([]),
      this.prisma.cluster.findMany({ where: { ...base, districtId: school.districtId }, include: this.clusterCardInclude }),
    ]);
    const card = (c: (typeof sameSubRaw)[number]) => ({
      id: c.id, name: c.name, district: c.district?.name, status: c.status, clusterType: c.clusterType,
      subCounty: c.subCounty?.name ?? c.subCountyName,
      subCounties: c.coveredSubCounties.map((x) => x.subCounty.name),
      clusterLeaderName: c.clusterLeaderName, clusterLeaderPhone: c.clusterLeaderPhone,
      schoolCount: c._count.schools, _count: c._count,
    });
    const sameSub = sameSubRaw.map(card);
    const sameSubIds = new Set(sameSub.map((c) => c.id));
    // District alternatives exclude the same-sub-county ones (already eligible).
    const sameDistrict = sameDistrictRaw.map(card).filter((c) => !sameSubIds.has(c.id));
    return {
      schoolId, district: school.districtId, subCounty: school.subCounty?.name,
      sameSubCounty: sameSub, sameDistrict,
      canCreate: scope.permissions.includes(PERMISSIONS.CLUSTER_ASSIGN),
      hint: sameSub.length === 0 && school.subCountyId ? `No eligible cluster exists for this school's sub-county (${school.subCounty?.name}). Create one.` : undefined,
    };
  }

  /** Flat eligible-cluster list for a school (§5 assignment drawer). */
  async eligibleForSchool(schoolId: string, user: AuthUser) {
    const r = await this.recommendations(schoolId, user);
    return {
      schoolId, subCounty: r.subCounty,
      eligible: r.sameSubCounty, districtAlternatives: r.sameDistrict,
      canCreate: r.canCreate, hint: r.hint,
    };
  }

  // ── Create (one OR MORE sub-counties, §4/§5) ──────────────────────
  async create(dto: CreateClusterDto, user: AuthUser) {
    const district = await this.prisma.district.findUnique({ where: { id: dto.districtId } });
    if (!district || district.regionId !== dto.regionId) throw new BadRequestException('district does not belong to region');
    const scope = await this.scope.resolveUserScope(user);
    if (!scope.countryScope && !scope.districtIds.includes(dto.districtId)) throw new ForbiddenException('District outside your scope');

    // The covered sub-county set: prefer subCountyIds[], fall back to subCountyId.
    const subCountyIds = [...new Set(
      dto.subCountyIds?.length ? dto.subCountyIds : dto.subCountyId ? [dto.subCountyId] : [],
    )];
    if (subCountyIds.length === 0) throw new BadRequestException('At least one sub-county is required');
    const subs = await this.prisma.subCounty.findMany({ where: { id: { in: subCountyIds } } });
    if (subs.length !== subCountyIds.length) throw new BadRequestException('Unknown sub-county');
    for (const sc of subs) if (sc.districtId !== dto.districtId) throw new BadRequestException('sub-county does not belong to district');
    const primary = subs.find((s) => s.id === subCountyIds[0])!;

    // Sub-county uniqueness (§10): one active cluster per sub-county by default —
    // checked across BOTH the legacy primary column and the coverage join, so a
    // multi-sub-county cluster can't overlap an existing one.
    let needsReview = false;
    const taken = await this.prisma.subCounty.findMany({
      where: {
        id: { in: subCountyIds },
        OR: [
          { clusters: { some: { deletedAt: null, status: 'active' } } },
          { clusterLinks: { some: { cluster: { deletedAt: null, status: 'active' } } } },
        ],
      },
      select: { id: true, name: true },
    });
    if (taken.length) {
      const canOverride = permissionsForRole(user.activeRole).includes(PERMISSIONS.CLUSTER_OVERRIDE);
      if (!canOverride || !dto.overrideReason?.trim()) {
        await this.audit.log({ action: 'cluster.createBlocked', subjectKind: 'SubCounty', subjectId: taken[0].id, actorId: user.userId, actorRole: user.activeRole, payload: { reason: 'sub-county already has an active cluster', taken: taken.map((t) => t.name) } });
        throw new BadRequestException(`${taken.map((t) => t.name).join(', ')} already ${taken.length > 1 ? 'have' : 'has'} an active cluster. Provide an override reason (requires permission) to add another.`);
      }
      needsReview = true;
    }

    let cluster;
    try {
      cluster = await this.prisma.cluster.create({
        data: {
          name: dto.name, regionId: dto.regionId, districtId: dto.districtId,
          subCountyId: primary.id, subCountyName: primary.name,
          clusterLeaderName: dto.clusterLeaderName?.trim() || undefined,
          clusterLeaderPhone: dto.clusterLeaderPhone?.trim() || undefined,
          clusterType: dto.clusterType ?? ClusterType.mixed,
          status: needsReview ? 'needs_review' : 'active',
          overrideReason: needsReview ? dto.overrideReason : undefined, responsibleStaffId: dto.responsibleStaffId,
          coveredSubCounties: { create: subCountyIds.map((id) => ({ subCountyId: id })) },
        },
      });
    } catch (e) {
      // Race backstop: the partial unique index rejected a concurrent 2nd active
      // cluster for the primary sub-county.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('This sub-county already has an active cluster.');
      }
      throw e;
    }
    await this.audit.log({ action: needsReview ? 'cluster.createOverride' : 'cluster.create', subjectKind: 'Cluster', subjectId: cluster.id, actorId: user.userId, actorRole: user.activeRole, payload: { name: dto.name, subCountyIds, districtId: dto.districtId, overrideReason: dto.overrideReason } });
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
    // Geography must match — district AND the cluster's COVERED sub-county set
    // (§4/§5/§10/§11). A school is eligible iff its sub-county is one the cluster
    // covers (single- or multi-sub-county). Backend-enforced, not just UI.
    if (cluster.districtId !== school.districtId) throw new BadRequestException('Cluster and school are in different districts');
    const coveredLinks = await this.prisma.clusterSubCounty.findMany({ where: { clusterId }, select: { subCountyId: true } });
    const coveredIds = coveredLinks.length ? coveredLinks.map((c) => c.subCountyId) : cluster.subCountyId ? [cluster.subCountyId] : [];
    if (coveredIds.length && school.subCountyId && !coveredIds.includes(school.subCountyId)) {
      throw new BadRequestException("This cluster does not cover the school's sub-county");
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
