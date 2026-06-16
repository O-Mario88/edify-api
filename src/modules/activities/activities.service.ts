import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Activity, ActivityType, Prisma, SalesforceActivityType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { DomainEventService, type NotifySpec } from '../../common/realtime/domain-events.service';
import { ScopeService } from '../../common/scope/scope.service';
import { AuthorizationService } from '../../common/authz/authorization.service';
import type { Action } from '../../common/authz/resource-ref';
import { AuthUser } from '../../common/auth/auth-user';
import { paginate } from '../../common/dto/pagination.dto';
import { isValidSalesforceId } from '../../common/salesforce/salesforce-id.util';
import { getOperationalFY, getQuarterForDate } from '../../common/fy/fy.util';
import { AssignmentService } from '../assignment/assignment.service';
import { CompleteActivityDto, CreateActivityDto, QueryActivitiesDto } from './dto/activities.dto';

const TRAINING_TYPES: ActivityType[] = ['training', 'school_improvement_training', 'cluster_meeting', 'cluster_training', 'core_training', 'project_activity'];
const RESCHEDULE_SLIP_LIMIT = 3; // an activity may be moved at most this many times
// Active = still actionable (Planning / My Plan). Completed = the log.
const ACTIVE_STATUSES = ['planned', 'scheduled', 'assigned_to_partner', 'partner_scheduled', 'in_progress', 'evidence_uploaded', 'evidence_accepted', 'salesforce_id_required', 'awaiting_ia_verification', 'returned', 'deferred'];
const COMPLETED_STATUSES = ['ia_verified', 'accountant_confirmed', 'completed', 'cancelled', 'rejected'];
const sfKind = (t: ActivityType): SalesforceActivityType => (TRAINING_TYPES.includes(t) ? 'training' : 'visit');

@Injectable()
export class ActivitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: DomainEventService,
    private readonly scope: ScopeService,
    private readonly authz: AuthorizationService,
    private readonly assignment: AssignmentService,
  ) {}

  private async scopedSchoolIds(user: AuthUser): Promise<string[] | null> {
    const scope = await this.scope.resolveUserScope(user);
    if (scope.countryScope) return null;
    return (await this.prisma.school.findMany({ where: { deletedAt: null, ...this.scope.schoolWhere(scope) }, select: { id: true } })).map((s) => s.id);
  }

  // Guard mutations against IDOR — an activity must be within the caller's
  // scope. Delegates to the central object-level engine (ownership / partner
  // identity / supervision / geography), which also closes the old partner
  // bypass: a partner user is now pinned to their OWN partner's work, not any
  // partner-delivered activity. Honours AUTHZ_MODE (shadow logs, enforce throws).
  private async assertInScope(activity: Activity, user: AuthUser, action: Action = 'update'): Promise<void> {
    await this.authz.assertCanAccess(user, { kind: 'activity', id: activity.id, loadedEntity: activity }, action);
  }

  async list(query: QueryActivitiesDto, user: AuthUser) {
    const schoolIds = await this.scopedSchoolIds(user);
    const where: Prisma.ActivityWhereInput = { deletedAt: null };
    // My Plan: the caller's own activities — scope by responsibleStaffId only.
    // This MUST NOT also filter by schoolId, or cluster activities (schoolId is
    // null) would be dropped from My Plan. A user's own activity is in scope by
    // definition. The general (not-mine) list still scopes by school portfolio.
    if (query.mine === 'true' && user.staffProfileId) {
      where.responsibleStaffId = user.staffProfileId;
    } else if (schoolIds) {
      where.schoolId = { in: schoolIds.length ? schoolIds : ['__none__'] };
    }
    if (query.status) where.status = query.status as Prisma.ActivityWhereInput['status'];
    else if (query.statusGroup === 'active') where.status = { in: ACTIVE_STATUSES as never };
    else if (query.statusGroup === 'completed') where.status = { in: COMPLETED_STATUSES as never };
    if (query.activityType) where.activityType = query.activityType as Prisma.ActivityWhereInput['activityType'];
    if (query.deliveryType) where.deliveryType = query.deliveryType as Prisma.ActivityWhereInput['deliveryType'];
    if (query.fy) where.fy = query.fy;
    if (query.quarter) where.quarter = query.quarter;
    if (query.schoolId) {
      const s = await this.prisma.school.findUnique({ where: { schoolId: query.schoolId }, select: { id: true } });
      where.schoolId = s?.id ?? '__none__';
    }
    const [data, total] = await this.prisma.$transaction([
      this.prisma.activity.findMany({ where, skip: query.skip, take: query.take, orderBy: { createdAt: 'desc' }, include: { school: { select: { schoolId: true, name: true, district: { select: { name: true } } } }, cluster: { select: { name: true } }, assignedPartner: { select: { name: true } } } }),
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
    // Period integrity: fy + quarter are DERIVED from the scheduled date (the
    // source of truth) so they can never disagree with scheduledDate and the
    // analytics rollups (which group by these columns) stay correct. Only when
    // an activity is planned-but-undated do we fall back to the client values.
    const scheduledDate = dto.scheduledDate ? new Date(dto.scheduledDate) : undefined;
    const fy = scheduledDate ? getOperationalFY(scheduledDate) : dto.fy;
    const quarter = scheduledDate ? getQuarterForDate(scheduledDate) : dto.quarter;
    const activity = await this.prisma.activity.create({
      data: {
        activityType: dto.activityType, schoolId, clusterId: dto.clusterId, fy, quarter,
        plannedMonth: dto.plannedMonth, plannedWeek: dto.plannedWeek, responsibleStaffId,
        scheduledDate,
        assignedPartnerId: dto.assignedPartnerId, deliveryType: isPartner ? 'partner' : 'staff',
        clusterSlot: dto.clusterSlot ?? undefined,
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
    // ID-integrity lock: once IA has confirmed, the Salesforce ID is frozen. A
    // correction requires IA to RETURN the activity first (resets the status),
    // so a confirmed verification can never be silently overwritten.
    if (activity.iaVerificationStatus === 'confirmed') {
      throw new ForbiddenException('Salesforce ID is locked after IA confirmation. Ask IA to return the activity to make a correction.');
    }
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
    // Live: the activity is now in the IA verification queue — push it there.
    const iaUserIds = await this.events.usersWithRole('ImpactAssessment');
    await this.events.emit({
      type: 'SalesforceIdEntered',
      actorId: user.userId, actorRole: user.activeRole, subjectKind: 'Activity', subjectId: id,
      payload: { salesforceId: dto.salesforceId.trim(), salesforceType: kind },
      notify: iaUserIds.map((rid): NotifySpec => ({
        recipientId: rid,
        title: `${dto.salesforceId.trim()} submitted for IA verification`,
        body: `A ${kind} was completed and needs your Salesforce confirmation.`,
        targetRoute: '/queue', actionRequired: true, priority: 'high',
      })),
      liveUserIds: [user.userId],
    });
    return updated;
  }

  // IA confirms the Salesforce entry (no Salesforce API — manual confirmation).
  async iaConfirm(id: string, user: AuthUser) {
    const activity = await this.prisma.activity.findUnique({ where: { id } });
    if (!activity) throw new NotFoundException('Activity not found');
    if (activity.status !== 'awaiting_ia_verification') throw new BadRequestException('Activity is not awaiting IA verification');
    // Partner-delivered work must have its evidence reviewed + ACCEPTED before
    // IA verifies — IA confirms verified delivery, not unreviewed uploads.
    // (Staff work is auto-accepted on completion.) Payment is already gated on
    // accepted evidence; this moves the gate earlier so IA can't confirm first.
    if (activity.deliveryType === 'partner' && activity.evidenceStatus !== 'accepted') {
      throw new BadRequestException('Evidence must be reviewed and accepted before IA verification.');
    }
    // Object-level check (IA_VERIFY) + audit the sensitive verification.
    await this.authz.assertCanAccess(user, { kind: 'activity', id, loadedEntity: activity }, 'verify');
    const updated = await this.prisma.activity.update({
      where: { id },
      data: { status: 'ia_verified', iaVerificationStatus: 'confirmed', iaConfirmedAt: new Date(), iaConfirmedBy: user.userId, paymentStatus: activity.assignedPartnerId ? 'ia_confirmed' : 'netsuite_accountability' },
    });
    await this.prisma.activityCompletionVerification.update({ where: { activityId: id }, data: { status: 'confirmed', iaActorId: user.userId, iaActionAt: new Date() } }).catch(() => undefined);

    // Live: verification moves the activity to the accountant's payment queue
    // (partner) and updates the responsible staff's dashboard + target progress.
    const staffUserId = await this.events.userForStaff(activity.responsibleStaffId);
    const isPartner = !!activity.assignedPartnerId;
    const accountantIds = isPartner ? await this.events.usersWithRole('ProgramAccountant') : [];
    const sf = activity.salesforceActivityId ?? 'activity';
    const notify: NotifySpec[] = [];
    if (staffUserId) {
      notify.push({
        recipientId: staffUserId,
        title: `IA verified ${sf}`,
        body: isPartner ? 'Sent to the accountant for payment.' : 'Ready for NetSuite accountability.',
        targetRoute: '/plans',
      });
    }
    for (const rid of accountantIds) {
      notify.push({
        recipientId: rid,
        title: `Payment ready: ${sf}`,
        body: 'IA confirmed a partner activity — clear the payment.',
        targetRoute: '/dashboards/accountant', actionRequired: true, priority: 'high',
      });
    }
    await this.events.emit({
      type: 'IASalesforceConfirmed',
      actorId: user.userId, actorRole: user.activeRole, subjectKind: 'Activity', subjectId: id,
      payload: { salesforceId: activity.salesforceActivityId, previousStatus: activity.status },
      notify, liveUserIds: [user.userId, staffUserId, ...accountantIds],
    });
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
    // Recompute the period from the new date so a rescheduled activity counts in
    // its NEW quarter/FY, not the old one (otherwise rollups double-count or
    // miscount across period boundaries).
    const newDate = new Date(dto.scheduledDate);
    const updated = await this.prisma.activity.update({
      where: { id },
      data: {
        scheduledDate: newDate, fy: getOperationalFY(newDate), quarter: getQuarterForDate(newDate),
        rescheduleCount: { increment: 1 }, lastReason: dto.reason,
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

  // ── Partner-to-payment (accountant) ───────────────────────────────
  // The accountant's queue: partner-delivered activities in the payment pipeline.
  async paymentQueue(user: AuthUser) {
    const schoolIds = await this.scopedSchoolIds(user);
    const where: Prisma.ActivityWhereInput = {
      deletedAt: null, deliveryType: 'partner',
      paymentStatus: { in: ['ia_confirmed', 'pl_approved', 'accountant_cleared'] },
    };
    if (schoolIds) where.schoolId = { in: schoolIds.length ? schoolIds : ['__none__'] };
    const acts = await this.prisma.activity.findMany({
      where, take: 200, orderBy: { updatedAt: 'desc' },
      select: {
        id: true, activityType: true, salesforceActivityId: true, evidenceStatus: true,
        iaVerificationStatus: true, paymentStatus: true,
        school: { select: { schoolId: true, name: true } }, assignedPartner: { select: { name: true } },
      },
    });
    return acts.map((a) => ({
      ...a,
      ready: a.evidenceStatus === 'accepted' && !!a.salesforceActivityId && a.iaVerificationStatus === 'confirmed' && a.paymentStatus !== 'paid',
    }));
  }

  // Clear a partner payment. BLOCKED until evidence accepted + Salesforce ID +
  // IA confirmed (spec §10 — payment never bypasses verification).
  async clearPayment(id: string, user: AuthUser) {
    const a = await this.prisma.activity.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Activity not found');
    // Explicit, friendly business gates — these are the AUTHORITATIVE payment
    // guard and stay enforcing at all times (never shadowed): money never moves
    // before evidence is accepted, a Salesforce ID exists, and IA has confirmed.
    if (a.deliveryType !== 'partner') throw new BadRequestException('Payment clearance is for partner-delivered activities.');
    if (a.iaVerificationStatus !== 'confirmed') throw new ForbiddenException('Cannot clear payment — activity is not IA-verified.');
    if (!a.salesforceActivityId) throw new ForbiddenException('Cannot clear payment — no Salesforce ID entered.');
    if (a.evidenceStatus !== 'accepted') throw new ForbiddenException('Cannot clear payment — evidence not accepted.');
    if (a.paymentStatus === 'paid' || a.paymentStatus === 'closed') throw new BadRequestException('Payment already cleared.');
    // Object-level check (PAYMENT_ACT + scope) + audit the sensitive money-move.
    await this.authz.assertCanAccess(user, { kind: 'payment', id: a.id, loadedEntity: a }, 'pay');

    const updated = await this.prisma.activity.update({ where: { id }, data: { paymentStatus: 'paid' } });

    // Live: the partner payment closed — refresh the staff/CCEO + partner views.
    const staffUserId = await this.events.userForStaff(a.responsibleStaffId);
    const sf = a.salesforceActivityId ?? 'the partner activity';
    await this.events.emit({
      type: 'AccountantPaymentPaid',
      actorId: user.userId, actorRole: user.activeRole, subjectKind: 'Activity', subjectId: id,
      payload: { partner: a.assignedPartnerId, salesforceId: a.salesforceActivityId },
      notify: staffUserId
        ? [{ recipientId: staffUserId, title: 'Partner payment cleared', body: `Payment for ${sf} is paid.`, targetRoute: '/plans' }]
        : [],
      liveUserIds: [user.userId, staffUserId],
    });
    return updated;
  }
}
