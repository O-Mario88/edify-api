import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Activity, ActivityType, Prisma, SalesforceActivityType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ScopeService } from '../../common/scope/scope.service';
import { AuthUser } from '../../common/auth/auth-user';
import { paginate } from '../../common/dto/pagination.dto';
import { isValidSalesforceId } from '../../common/salesforce/salesforce-id.util';
import { AssignmentService } from '../assignment/assignment.service';
import { CompleteActivityDto, CreateActivityDto, QueryActivitiesDto } from './dto/activities.dto';

const TRAINING_TYPES: ActivityType[] = ['training', 'school_improvement_training', 'cluster_meeting', 'cluster_training', 'core_training', 'project_activity'];
const RESCHEDULE_SLIP_LIMIT = 3; // an activity may be moved at most this many times
const sfKind = (t: ActivityType): SalesforceActivityType => (TRAINING_TYPES.includes(t) ? 'training' : 'visit');

@Injectable()
export class ActivitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly assignment: AssignmentService,
  ) {}

  private async scopedSchoolIds(user: AuthUser): Promise<string[] | null> {
    const scope = await this.scope.resolveUserScope(user);
    if (scope.countryScope) return null;
    return (await this.prisma.school.findMany({ where: { deletedAt: null, ...this.scope.schoolWhere(scope) }, select: { id: true } })).map((s) => s.id);
  }

  // Guard mutations against IDOR — an activity must be within the caller's scope.
  private async assertInScope(activity: Activity, user: AuthUser): Promise<void> {
    const scope = await this.scope.resolveUserScope(user);
    if (scope.countryScope) return;
    // Partner roles may act on partner-delivered work (per-partner identity link
    // is a TODO — tightened once User↔Partner is wired).
    if ((scope.activeRole === 'PartnerAdmin' || scope.activeRole === 'PartnerFieldOfficer') && activity.deliveryType === 'partner') return;
    if (activity.schoolId) {
      const ids = await this.scopedSchoolIds(user);
      if (ids && ids.includes(activity.schoolId)) return;
    }
    throw new ForbiddenException('Activity is outside your scope');
  }

  async list(query: QueryActivitiesDto, user: AuthUser) {
    const schoolIds = await this.scopedSchoolIds(user);
    const where: Prisma.ActivityWhereInput = { deletedAt: null };
    if (schoolIds) where.schoolId = { in: schoolIds.length ? schoolIds : ['__none__'] };
    // My Plan: only the caller's own activities.
    if (query.mine === 'true' && user.staffProfileId) where.responsibleStaffId = user.staffProfileId;
    if (query.status) where.status = query.status as Prisma.ActivityWhereInput['status'];
    if (query.activityType) where.activityType = query.activityType as Prisma.ActivityWhereInput['activityType'];
    if (query.deliveryType) where.deliveryType = query.deliveryType as Prisma.ActivityWhereInput['deliveryType'];
    if (query.fy) where.fy = query.fy;
    if (query.quarter) where.quarter = query.quarter;
    if (query.schoolId) {
      const s = await this.prisma.school.findUnique({ where: { schoolId: query.schoolId }, select: { id: true } });
      where.schoolId = s?.id ?? '__none__';
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.activity.findMany({ where, skip: query.skip, take: query.take, orderBy: { createdAt: 'desc' }, include: { school: { select: { schoolId: true, name: true } } } }),
      this.prisma.activity.count({ where }),
    ]);
    return paginate(data, total, query);
  }

  async create(dto: CreateActivityDto, user: AuthUser) {
    let schoolId: string | undefined;
    if (dto.schoolId) {
      const s = await this.prisma.school.findUnique({ where: { schoolId: dto.schoolId } });
      if (!s) throw new NotFoundException(`School ${dto.schoolId} not in directory`);
      schoolId = s.id;
    }
    if (!schoolId && !dto.clusterId) throw new BadRequestException('Activity must reference a school or cluster');

    const isPartner = dto.deliveryType === 'partner' || !!dto.assignedPartnerId;
    // API-enforced assignment policy + staff support capacity (spec §6/§9).
    // Throws ForbiddenException (403) with a clear reason + writes an AssignmentAudit.
    await this.assignment.assertAssignmentAllowed({
      user, internalSchoolId: schoolId, fy: dto.fy,
      responsibleStaffId: dto.responsibleStaffId, assignedPartnerId: dto.assignedPartnerId,
      deliveryType: isPartner ? 'partner' : 'staff',
    });

    // Default a staff-delivered activity's owner to the creator (so it shows in
    // their My Plan); a PL may assign to a supervised CCEO via responsibleStaffId.
    const responsibleStaffId = isPartner
      ? (dto.responsibleStaffId ?? undefined)
      : (dto.responsibleStaffId ?? user.staffProfileId ?? undefined);
    const activity = await this.prisma.activity.create({
      data: {
        activityType: dto.activityType, schoolId, clusterId: dto.clusterId, fy: dto.fy, quarter: dto.quarter,
        plannedMonth: dto.plannedMonth, plannedWeek: dto.plannedWeek, responsibleStaffId,
        assignedPartnerId: dto.assignedPartnerId, deliveryType: isPartner ? 'partner' : 'staff',
        status: isPartner ? 'assigned_to_partner' : 'planned',
        salesforceActivityType: sfKind(dto.activityType),
      },
    });
    await this.audit.log({ action: 'activity.create', subjectKind: 'Activity', subjectId: activity.id, actorId: user.userId, actorRole: user.activeRole, payload: { type: dto.activityType } });
    return activity;
  }

  // Enter the Salesforce ID (manual; Salesforce not integrated). SV- visits,
  // TS- trainings. Moves to awaiting IA verification.
  async complete(id: string, dto: CompleteActivityDto, user: AuthUser) {
    const activity = await this.prisma.activity.findUnique({ where: { id } });
    if (!activity) throw new NotFoundException('Activity not found');
    await this.assertInScope(activity, user);
    const kind = sfKind(activity.activityType);
    if (!isValidSalesforceId(dto.salesforceId, kind)) {
      throw new BadRequestException(`${kind === 'visit' ? 'SV-' : 'TS-'} Salesforce ID required`);
    }
    // Trainings/cluster meetings must record attendance.
    if (kind === 'training' && !((dto.teachersAttended ?? 0) > 0 || (dto.leadersAttended ?? 0) > 0)) {
      throw new BadRequestException('Training completion requires attendance (teachers and/or school leaders)');
    }
    // Partner-delivered evidence must be reviewed (accepted) before it counts;
    // staff-delivered work is accepted on entry.
    const evidenceStatus = activity.deliveryType === 'partner' ? 'uploaded' : 'accepted';
    const updated = await this.prisma.activity.update({
      where: { id },
      data: {
        salesforceActivityId: dto.salesforceId.trim(), salesforceActivityType: kind,
        teachersAttended: dto.teachersAttended, leadersAttended: dto.leadersAttended, otherParticipants: dto.otherParticipants,
        status: 'awaiting_ia_verification', evidenceStatus,
      },
    });
    await this.prisma.activityCompletionVerification.upsert({
      where: { activityId: id }, update: { salesforceId: dto.salesforceId.trim(), enteredBy: user.userId, status: 'pending' },
      create: { activityId: id, salesforceId: dto.salesforceId.trim(), enteredBy: user.userId, status: 'pending' },
    });
    await this.audit.log({ action: 'activity.salesforceEntered', subjectKind: 'Activity', subjectId: id, actorId: user.userId, actorRole: user.activeRole, payload: { salesforceId: dto.salesforceId.trim() } });
    return updated;
  }

  // IA confirms the Salesforce entry (no Salesforce API — manual confirmation).
  async iaConfirm(id: string, user: AuthUser) {
    const activity = await this.prisma.activity.findUnique({ where: { id } });
    if (!activity) throw new NotFoundException('Activity not found');
    if (activity.status !== 'awaiting_ia_verification') throw new BadRequestException('Activity is not awaiting IA verification');
    const updated = await this.prisma.activity.update({
      where: { id },
      data: { status: 'ia_verified', iaVerificationStatus: 'confirmed', iaConfirmedAt: new Date(), iaConfirmedBy: user.userId, paymentStatus: activity.assignedPartnerId ? 'ia_confirmed' : 'netsuite_accountability' },
    });
    await this.prisma.activityCompletionVerification.update({ where: { activityId: id }, data: { status: 'confirmed', iaActorId: user.userId, iaActionAt: new Date() } }).catch(() => undefined);
    await this.audit.log({ action: 'ia.confirm', subjectKind: 'Activity', subjectId: id, actorId: user.userId, actorRole: user.activeRole, payload: { salesforceId: activity.salesforceActivityId, previousStatus: activity.status } });
    return updated;
  }

  // ── Plan-as-list lifecycle (My Plan row actions) ──────────────────
  private async getInScope(id: string, user: AuthUser): Promise<Activity> {
    const activity = await this.prisma.activity.findUnique({ where: { id } });
    if (!activity) throw new NotFoundException('Activity not found');
    await this.assertInScope(activity, user);
    return activity;
  }

  async reschedule(id: string, dto: { scheduledDate: string; reason: string }, user: AuthUser) {
    const a = await this.getInScope(id, user);
    if ((a.rescheduleCount ?? 0) >= RESCHEDULE_SLIP_LIMIT) {
      throw new BadRequestException(`Reschedule limit reached (${RESCHEDULE_SLIP_LIMIT}). Escalate or convert this activity instead.`);
    }
    const updated = await this.prisma.activity.update({
      where: { id },
      data: {
        scheduledDate: new Date(dto.scheduledDate), rescheduleCount: { increment: 1 }, lastReason: dto.reason,
        status: a.status === 'cancelled' || a.status === 'deferred' ? 'planned' : 'rescheduled',
      },
    });
    await this.audit.log({ action: 'activity.reschedule', subjectKind: 'Activity', subjectId: id, actorId: user.userId, actorRole: user.activeRole, payload: { reason: dto.reason, moveNo: (a.rescheduleCount ?? 0) + 1 } });
    return updated;
  }

  async reassign(id: string, dto: { deliveryType: 'staff' | 'partner'; assignedPartnerId?: string; responsibleStaffId?: string }, user: AuthUser) {
    await this.getInScope(id, user);
    const updated = await this.prisma.activity.update({
      where: { id },
      data: {
        deliveryType: dto.deliveryType,
        assignedPartnerId: dto.deliveryType === 'partner' ? (dto.assignedPartnerId ?? undefined) : null,
        responsibleStaffId: dto.deliveryType === 'staff' ? (dto.responsibleStaffId ?? undefined) : undefined,
      },
    });
    await this.audit.log({ action: 'activity.reassign', subjectKind: 'Activity', subjectId: id, actorId: user.userId, actorRole: user.activeRole, payload: { deliveryType: dto.deliveryType } });
    return updated;
  }

  async cancel(id: string, dto: { reason: string }, user: AuthUser) {
    await this.getInScope(id, user);
    const updated = await this.prisma.activity.update({ where: { id }, data: { status: 'cancelled', lastReason: dto.reason } });
    await this.audit.log({ action: 'activity.cancel', subjectKind: 'Activity', subjectId: id, actorId: user.userId, actorRole: user.activeRole, payload: { reason: dto.reason } });
    return updated;
  }

  async defer(id: string, dto: { reason: string }, user: AuthUser) {
    await this.getInScope(id, user);
    const updated = await this.prisma.activity.update({ where: { id }, data: { status: 'deferred', lastReason: dto.reason } });
    await this.audit.log({ action: 'activity.defer', subjectKind: 'Activity', subjectId: id, actorId: user.userId, actorRole: user.activeRole, payload: { reason: dto.reason } });
    return updated;
  }
}
