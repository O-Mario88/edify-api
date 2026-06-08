import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountOwnerStatus, DuplicateStatus, Prisma, School } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ScopeService, UserScope } from '../../common/scope/scope.service';
import { paginate, Paginated } from '../../common/dto/pagination.dto';
import { AuthUser } from '../../common/auth/auth-user';
import { CreateSchoolDto } from './dto/create-school.dto';
import { BulkUploadDto } from './dto/bulk-upload.dto';
import { QuerySchoolsDto } from './dto/query-schools.dto';

const norm = (s?: string | null) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

@Injectable()
export class SchoolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  // ── Single manual upload ──────────────────────────────────────────
  async createOne(dto: CreateSchoolDto, actor: AuthUser): Promise<School> {
    await this.assertGeography(dto.regionId, dto.districtId, dto.subCountyId, dto.parishId);
    if (await this.prisma.school.findUnique({ where: { schoolId: dto.schoolId } })) {
      throw new BadRequestException(`schoolId ${dto.schoolId} already exists`);
    }

    const { ownerId, ownerStatus } = await this.matchAccountOwner(dto.accountOwnerName);

    const school = await this.prisma.school.create({
      data: {
        schoolId: dto.schoolId,
        name: dto.name,
        regionId: dto.regionId,
        districtId: dto.districtId,
        subCountyId: dto.subCountyId,
        parishId: dto.parishId,
        shippingAddress: dto.shippingAddress,
        schoolPhone: dto.schoolPhone,
        primaryContactName: dto.primaryContactName,
        primaryContactPhone: dto.primaryContactPhone,
        enrollment: dto.enrollment,
        accountOwnerNameRaw: dto.accountOwnerName,
        accountOwnerId: ownerId,
        accountOwnerStatus: ownerStatus,
        createdByIa: actor.activeRole === 'ImpactAssessment',
      },
    });

    if (ownerId) {
      await this.prisma.staffSchoolAssignment.create({ data: { staffId: ownerId, schoolId: school.id } });
    }
    await this.runPostUpload(school.id, actor);
    if (ownerStatus === 'unmatched') await this.notifyUnmatchedOwner(school, actor);

    await this.audit.log({
      action: 'school.upload', subjectKind: 'School', subjectId: school.id,
      actorId: actor.userId, actorRole: actor.activeRole,
      payload: { schoolId: school.schoolId, ownerStatus },
    });
    return this.prisma.school.findUniqueOrThrow({ where: { id: school.id } });
  }

  // ── Bulk upload (CSV/Excel rows) ──────────────────────────────────
  async bulkUpload(dto: BulkUploadDto, actor: AuthUser) {
    const batch = await this.prisma.uploadBatch.create({
      data: { source: 'csv', fileName: dto.fileName, uploadedBy: actor.userId, rowCount: dto.rows.length },
    });

    const results: { schoolId: string; ok: boolean; reason?: string; duplicateOf?: string[] }[] = [];
    let accepted = 0;
    let flagged = 0;

    for (const row of dto.rows) {
      try {
        const exists = await this.prisma.school.findUnique({ where: { schoolId: row.schoolId } });
        if (exists) { results.push({ schoolId: row.schoolId, ok: false, reason: 'duplicate schoolId' }); continue; }
        await this.assertGeography(row.regionId, row.districtId, row.subCountyId, row.parishId);

        const { ownerId, ownerStatus } = await this.matchAccountOwner(row.accountOwnerName);
        const school = await this.prisma.school.create({
          data: {
            schoolId: row.schoolId, name: row.name, regionId: row.regionId, districtId: row.districtId,
            subCountyId: row.subCountyId, parishId: row.parishId, shippingAddress: row.shippingAddress,
            schoolPhone: row.schoolPhone, primaryContactName: row.primaryContactName,
            primaryContactPhone: row.primaryContactPhone, enrollment: row.enrollment,
            accountOwnerNameRaw: row.accountOwnerName, accountOwnerId: ownerId, accountOwnerStatus: ownerStatus,
            uploadBatchId: batch.id, createdByIa: actor.activeRole === 'ImpactAssessment',
          },
        });
        if (ownerId) await this.prisma.staffSchoolAssignment.create({ data: { staffId: ownerId, schoolId: school.id } });
        await this.prisma.schoolAccountOwnerUploadMap.create({
          data: { uploadBatchId: batch.id, schoolIdRaw: row.schoolId, ownerNameRaw: row.accountOwnerName ?? '', matchedStaffId: ownerId, matched: !!ownerId },
        });
        const dupes = await this.runPostUpload(school.id, actor);
        accepted++;
        if (dupes.length) flagged++;
        results.push({ schoolId: row.schoolId, ok: true, duplicateOf: dupes });
      } catch (e) {
        results.push({ schoolId: row.schoolId, ok: false, reason: e instanceof Error ? e.message : 'error' });
      }
    }

    await this.prisma.uploadBatch.update({ where: { id: batch.id }, data: { acceptedCount: accepted, flaggedCount: flagged } });
    await this.audit.log({
      action: 'school.bulkUpload', subjectKind: 'UploadBatch', subjectId: batch.id,
      actorId: actor.userId, actorRole: actor.activeRole, payload: { rows: dto.rows.length, accepted, flagged },
    });
    return { batchId: batch.id, accepted, flagged, results };
  }

  // ── Post-upload workflow: dupes + cluster/SSA/readiness status ─────
  private async runPostUpload(schoolId: string, actor: AuthUser): Promise<string[]> {
    const dupes = await this.detectDuplicates(schoolId);
    await this.recomputeReadiness(schoolId);
    if (dupes.length) {
      await this.audit.log({
        action: 'school.duplicateFlagged', subjectKind: 'School', subjectId: schoolId,
        actorId: actor.userId, actorRole: actor.activeRole, payload: { candidates: dupes },
      });
    }
    return dupes;
  }

  // ── Duplicate detection: FLAG, never block ────────────────────────
  async detectDuplicates(schoolId: string): Promise<string[]> {
    const school = await this.prisma.school.findUniqueOrThrow({ where: { id: schoolId } });
    const peers = await this.prisma.school.findMany({
      where: { id: { not: schoolId }, deletedAt: null, districtId: school.districtId },
    });

    const flagged: string[] = [];
    for (const peer of peers) {
      const reasons: string[] = [];
      if (norm(peer.name) === norm(school.name)) reasons.push('name');
      if (school.schoolPhone && norm(peer.schoolPhone) === norm(school.schoolPhone)) reasons.push('phone');
      if (school.primaryContactName && norm(peer.primaryContactName) === norm(school.primaryContactName)) reasons.push('contact');
      if (school.shippingAddress && norm(peer.shippingAddress) === norm(school.shippingAddress)) reasons.push('address');
      if (peer.subCountyId && peer.subCountyId === school.subCountyId) reasons.push('subcounty');

      const score = Math.min(100, reasons.length * 30 + (reasons.includes('name') ? 25 : 0));
      if (score >= 55) {
        flagged.push(peer.id);
        await this.prisma.schoolDuplicateCandidate.upsert({
          where: { schoolId_candidateId: { schoolId, candidateId: peer.id } },
          update: { score, reasons },
          create: { schoolId, candidateId: peer.id, score, reasons },
        });
      }
    }
    if (flagged.length) {
      await this.prisma.school.update({ where: { id: schoolId }, data: { duplicateStatus: DuplicateStatus.potential } });
    }
    return flagged;
  }

  // ── Account-owner matching ────────────────────────────────────────
  private async matchAccountOwner(rawName?: string): Promise<{ ownerId?: string; ownerStatus: AccountOwnerStatus }> {
    if (!rawName?.trim()) return { ownerStatus: AccountOwnerStatus.pending };
    const staff = await this.prisma.staffProfile.findFirst({
      where: { deletedAt: null, user: { name: { equals: rawName.trim(), mode: 'insensitive' } } },
    });
    return staff ? { ownerId: staff.id, ownerStatus: AccountOwnerStatus.matched } : { ownerStatus: AccountOwnerStatus.unmatched };
  }

  private async notifyUnmatchedOwner(school: School, actor: AuthUser) {
    const recipients = await this.prisma.user.findMany({
      where: { isActive: true, roles: { hasSome: ['ImpactAssessment', 'CountryDirector', 'HumanResources'] } },
      select: { id: true },
    });
    if (recipients.length) {
      await this.prisma.notification.createMany({
        data: recipients.map((r) => ({
          recipientId: r.id, title: 'Unmatched account owner',
          body: `${school.name} (${school.schoolId}) uploaded with owner "${school.accountOwnerNameRaw}" — needs mapping.`,
          contextType: 'School', contextId: school.id, targetRoute: `/schools/${school.schoolId}`,
          actionRequired: true, priority: 'high' as const,
        })),
      });
    }
    void actor;
  }

  // ── Planning readiness: cluster + current FY SSA ──────────────────
  async recomputeReadiness(schoolId: string) {
    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      include: { ssaRecords: { where: { deletedAt: null }, orderBy: { dateOfSsa: 'desc' }, take: 1 } },
    });
    const clustered = !!school.clusterId;
    const latest = school.ssaRecords[0];
    const ssaCurrent = latest ? this.isCurrentFy(latest.fy) : false;

    const readiness = clustered && ssaCurrent ? 'ready' : clustered ? 'limited' : 'locked';
    await this.prisma.school.update({
      where: { id: schoolId },
      data: {
        clusterStatus: clustered ? 'clustered' : 'unclustered',
        currentFySsaStatus: ssaCurrent ? 'done' : school.currentFySsaStatus,
        planningReadiness: readiness,
      },
    });
  }

  private isCurrentFy(fy: string): boolean {
    const now = new Date();
    const currentFy = String(now.getUTCMonth() >= 9 ? now.getUTCFullYear() + 1 : now.getUTCFullYear());
    return fy === currentFy;
  }

  // ── Scoped, paginated directory read ──────────────────────────────
  async list(query: QuerySchoolsDto, actor: AuthUser): Promise<Paginated<School>> {
    const scope = await this.scope.resolveUserScope(actor);
    const where = this.buildWhere(query, scope);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.school.findMany({
        where, skip: query.skip, take: query.take,
        orderBy: query.sortBy ? { [query.sortBy]: query.sortDir ?? 'asc' } : { createdAt: 'desc' },
        include: { region: { select: { name: true } }, district: { select: { name: true } }, cluster: { select: { name: true } } },
      }),
      this.prisma.school.count({ where }),
    ]);
    return paginate(data, total, query);
  }

  private buildWhere(query: QuerySchoolsDto, scope: UserScope): Prisma.SchoolWhereInput {
    const where: Prisma.SchoolWhereInput = { deletedAt: null, ...this.scope.schoolWhere(scope) };
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { schoolId: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.regionId) where.regionId = query.regionId;
    if (query.districtId) where.districtId = query.districtId;
    if (query.subCountyId) where.subCountyId = query.subCountyId;
    if (query.clusterId) where.clusterId = query.clusterId;
    if (query.clusterStatus) where.clusterStatus = query.clusterStatus as Prisma.SchoolWhereInput['clusterStatus'];
    if (query.ssaStatus) where.currentFySsaStatus = query.ssaStatus as Prisma.SchoolWhereInput['currentFySsaStatus'];
    if (query.planningReadiness) where.planningReadiness = query.planningReadiness as Prisma.SchoolWhereInput['planningReadiness'];
    if (query.schoolType) where.schoolType = query.schoolType as Prisma.SchoolWhereInput['schoolType'];
    if (query.duplicateStatus) where.duplicateStatus = query.duplicateStatus as Prisma.SchoolWhereInput['duplicateStatus'];
    if (query.accountOwnerStatus) where.accountOwnerStatus = query.accountOwnerStatus as Prisma.SchoolWhereInput['accountOwnerStatus'];
    return where;
  }

  async getOne(schoolId: string, actor: AuthUser) {
    const scope = await this.scope.resolveUserScope(actor);
    const school = await this.prisma.school.findFirst({
      where: { schoolId, deletedAt: null, ...this.scope.schoolWhere(scope) },
      include: {
        region: true, district: true, cluster: true, accountOwner: { include: { user: { select: { name: true } } } },
        ssaRecords: { where: { deletedAt: null }, orderBy: { dateOfSsa: 'desc' }, take: 5 },
        duplicateCandidates: { include: { candidate: { select: { schoolId: true, name: true } } } },
      },
    });
    if (!school) throw new NotFoundException('School not found or outside your scope');
    return school;
  }

  // The correct next planning action for ONE school (spec §4/§5/§10). Scoped:
  // The full school improvement JOURNEY (spec §3 "fix the main workflow"):
  // Directory → Owner → Cluster → SSA → Plan → Execute → Verify → Pay → Improve.
  // Every step's status is computed from real data + a clear next action + blockers.
  async workflow(schoolId: string, actor: AuthUser, fy?: string) {
    const scope = await this.scope.resolveUserScope(actor);
    const school = await this.prisma.school.findFirst({
      where: { schoolId, deletedAt: null, ...this.scope.schoolWhere(scope) },
      select: {
        id: true, schoolId: true, name: true, schoolType: true,
        accountOwnerId: true, clusterId: true, clusterStatus: true, currentFySsaStatus: true,
        accountOwner: { include: { user: { select: { name: true } } } },
        ssaRecords: { where: { deletedAt: null }, orderBy: { dateOfSsa: 'asc' }, select: { averageScore: true } },
      },
    });
    if (!school) throw new NotFoundException('School not found or outside your scope');

    const acts = await this.prisma.activity.findMany({
      where: { schoolId: school.id, deletedAt: null, status: { notIn: ['cancelled', 'rejected', 'returned'] } },
      select: { status: true, paymentStatus: true, iaVerificationStatus: true },
    });
    const EXEC = ['evidence_uploaded', 'evidence_accepted', 'salesforce_id_required', 'awaiting_ia_verification', 'ia_verified', 'accountant_confirmed', 'completed'];
    const VERIFIED = ['ia_verified', 'accountant_confirmed', 'completed'];
    const PAID = ['paid', 'closed', 'accountant_cleared'];

    const hasPlanned = acts.length > 0;
    const hasExecuted = acts.some((a) => EXEC.includes(a.status));
    const hasVerified = acts.some((a) => VERIFIED.includes(a.status) || a.iaVerificationStatus === 'confirmed');
    const hasPaid = acts.some((a) => PAID.includes(a.paymentStatus));
    const scored = school.ssaRecords.filter((r) => r.averageScore != null);
    const hasImpact = scored.length >= 2 && (scored[scored.length - 1].averageScore ?? 0) > (scored[scored.length - 2].averageScore ?? 0);

    const steps = [
      { key: 'directory', label: 'School Directory', done: true },
      { key: 'owner', label: 'Account Owner', done: !!school.accountOwnerId },
      { key: 'cluster', label: 'Cluster', done: !!school.clusterId },
      { key: 'ssa', label: 'Current-FY SSA', done: school.currentFySsaStatus === 'done' },
      { key: 'planning', label: 'Planned', done: hasPlanned },
      { key: 'execution', label: 'Executed', done: hasExecuted },
      { key: 'verification', label: 'IA Verified', done: hasVerified },
      { key: 'payment', label: 'Paid / Accountability', done: hasPaid },
      { key: 'impact', label: 'Impact (SSA improved)', done: hasImpact },
    ];
    const currentIdx = steps.findIndex((s) => !s.done);
    const stage = currentIdx === -1 ? 'improved' : steps[currentIdx].key;
    const withStatus = steps.map((s, i) => ({ ...s, status: s.done ? 'done' : i === currentIdx ? 'current' : 'pending' }));

    const NEXT: Record<string, { type: string; label: string; reason: string }> = {
      owner: { type: 'ASSIGN_OWNER', label: 'Assign account owner', reason: 'This school has no account owner yet.' },
      cluster: { type: 'ADD_TO_CLUSTER', label: 'Add to cluster', reason: 'A cluster is required before planning.' },
      ssa: { type: 'SCHEDULE_SSA', label: 'Schedule / upload current-FY SSA', reason: 'Planning is SSA-led — capture the current-FY SSA first.' },
      planning: { type: 'PLAN_ACTION', label: 'Plan recommended support', reason: 'SSA is in — plan the recommended visit/training.' },
      execution: { type: 'EXECUTE', label: 'Execute + upload evidence', reason: 'Activity planned — deliver it and upload evidence.' },
      verification: { type: 'VERIFY', label: 'Enter Salesforce ID → IA verify', reason: 'Evidence in — enter the SV-/TS- id for IA confirmation.' },
      payment: { type: 'CLEAR_PAYMENT', label: 'Clear payment / accountability', reason: 'IA-verified — ready for accountant clearance.' },
      impact: { type: 'MEASURE_IMPACT', label: 'Schedule follow-up SSA', reason: 'Package delivered — measure improvement with a follow-up SSA.' },
    };
    const blockers: string[] = [];
    if (!school.accountOwnerId) blockers.push('No account owner');
    if (!school.clusterId) blockers.push('Not clustered');
    if (school.currentFySsaStatus !== 'done') blockers.push('No current-FY SSA');
    if (stage === 'impact' && scored.length < 2) blockers.push('No previous-FY SSA — impact cannot be measured yet');

    return {
      school: { schoolId: school.schoolId, name: school.name, schoolType: school.schoolType, owner: school.accountOwner?.user?.name ?? null },
      fy: fy ?? null,
      stage,
      steps: withStatus,
      nextAction: currentIdx === -1 ? null : NEXT[steps[currentIdx].key] ?? null,
      blockers,
    };
  }

  // 404 if the school is missing or outside the caller's scope. Gate order is
  // fixed — cluster → current-FY SSA → recommended/core planning.
  async nextActions(schoolId: string, actor: AuthUser, fy?: string) {
    const scope = await this.scope.resolveUserScope(actor);
    const school = await this.prisma.school.findFirst({
      where: { schoolId, deletedAt: null, ...this.scope.schoolWhere(scope) },
      select: {
        id: true, schoolId: true, name: true, schoolType: true,
        clusterStatus: true, currentFySsaStatus: true, clusterId: true, planningReadiness: true,
      },
    });
    if (!school) throw new NotFoundException('School not found or outside your scope');

    const clustered = school.clusterStatus === 'clustered';
    const ssaDone = school.currentFySsaStatus === 'done';
    const isCore = school.schoolType === 'core';

    let blockingGate: 'NO_CLUSTER' | 'NO_CURRENT_FY_SSA' | null;
    let allowedActions: string[];
    let recommendedDelivery: 'staff' | 'partner' | null = null;
    if (!clustered) {
      blockingGate = 'NO_CLUSTER';
      allowedActions = ['ADD_TO_CLUSTER'];
    } else if (!ssaDone) {
      blockingGate = 'NO_CURRENT_FY_SSA';
      allowedActions = ['SCHEDULE_SIT', 'ASSIGN_SSA_TO_PARTNER', 'SCHEDULE_SSA_SELF'];
    } else if (isCore) {
      blockingGate = null;
      allowedActions = ['PLAN_CORE_PACKAGE', 'SCHEDULE_VISIT', 'SCHEDULE_TRAINING', 'ASSIGN_PARTNER'];
      recommendedDelivery = 'staff';
    } else {
      blockingGate = null;
      allowedActions = ['SCHEDULE_VISIT', 'SCHEDULE_TRAINING', 'ASSIGN_PARTNER'];
      recommendedDelivery = 'staff';
    }

    return {
      school: { id: school.id, schoolId: school.schoolId, name: school.name, schoolType: school.schoolType },
      fy: fy ?? null,
      clusterStatus: school.clusterStatus,
      currentFySsaStatus: school.currentFySsaStatus,
      planningReadiness: school.planningReadiness,
      blockingGate,
      allowedActions,
      recommendedDelivery,
      canPlan: scope.canAssign && !scope.canViewSummaryOnly,
    };
  }

  async resolveDuplicate(schoolId: string, resolution: 'not_duplicate' | 'merged' | 'archived', actor: AuthUser) {
    const scope = await this.scope.resolveUserScope(actor);
    const school = await this.prisma.school.findFirst({ where: { id: schoolId, ...this.scope.schoolWhere(scope) } });
    if (!school) throw new NotFoundException('School not found or outside your scope');
    const statusMap: Record<string, DuplicateStatus> = {
      not_duplicate: DuplicateStatus.not_duplicate, merged: DuplicateStatus.merged, archived: DuplicateStatus.confirmed,
    };
    await this.prisma.school.update({ where: { id: schoolId }, data: { duplicateStatus: statusMap[resolution], deletedAt: resolution === 'archived' ? new Date() : null } });
    await this.prisma.schoolDuplicateCandidate.updateMany({ where: { schoolId }, data: { resolved: true, resolution } });
    await this.audit.log({ action: 'school.duplicateResolved', subjectKind: 'School', subjectId: schoolId, actorId: actor.userId, actorRole: actor.activeRole, payload: { resolution } });
    return { ok: true, schoolId: school.schoolId, resolution };
  }

  private async assertGeography(regionId: string, districtId: string, subCountyId?: string, parishId?: string) {
    const district = await this.prisma.district.findUnique({ where: { id: districtId } });
    if (!district || district.regionId !== regionId) throw new BadRequestException('district does not belong to region');
    if (subCountyId) {
      const sc = await this.prisma.subCounty.findUnique({ where: { id: subCountyId } });
      if (!sc || sc.districtId !== districtId) throw new BadRequestException('sub-county does not belong to district');
      if (parishId) {
        const p = await this.prisma.parish.findUnique({ where: { id: parishId } });
        if (!p || p.subCountyId !== subCountyId) throw new BadRequestException('parish does not belong to sub-county');
      }
    }
  }
}
