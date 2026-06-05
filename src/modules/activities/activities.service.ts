import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ActivityType, Prisma, SalesforceActivityType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ScopeService } from '../../common/scope/scope.service';
import { AuthUser } from '../../common/auth/auth-user';
import { paginate } from '../../common/dto/pagination.dto';
import { isValidSalesforceId } from '../../common/salesforce/salesforce-id.util';
import { CompleteActivityDto, CreateActivityDto, QueryActivitiesDto } from './dto/activities.dto';

const TRAINING_TYPES: ActivityType[] = ['training', 'school_improvement_training', 'cluster_meeting', 'cluster_training', 'core_training', 'project_activity'];
const sfKind = (t: ActivityType): SalesforceActivityType => (TRAINING_TYPES.includes(t) ? 'training' : 'visit');

@Injectable()
export class ActivitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
  ) {}

  private async scopedSchoolIds(user: AuthUser): Promise<string[] | null> {
    const scope = await this.scope.resolveUserScope(user);
    if (scope.countryScope) return null;
    return (await this.prisma.school.findMany({ where: { deletedAt: null, ...this.scope.schoolWhere(scope) }, select: { id: true } })).map((s) => s.id);
  }

  async list(query: QueryActivitiesDto, user: AuthUser) {
    const schoolIds = await this.scopedSchoolIds(user);
    const where: Prisma.ActivityWhereInput = { deletedAt: null };
    if (schoolIds) where.schoolId = { in: schoolIds.length ? schoolIds : ['__none__'] };
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

    const activity = await this.prisma.activity.create({
      data: {
        activityType: dto.activityType, schoolId, clusterId: dto.clusterId, fy: dto.fy, quarter: dto.quarter,
        plannedMonth: dto.plannedMonth, plannedWeek: dto.plannedWeek, responsibleStaffId: dto.responsibleStaffId,
        assignedPartnerId: dto.assignedPartnerId, deliveryType: dto.assignedPartnerId ? 'partner' : 'staff',
        status: dto.assignedPartnerId ? 'assigned_to_partner' : 'planned',
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
    const kind = sfKind(activity.activityType);
    if (!isValidSalesforceId(dto.salesforceId, kind)) {
      throw new BadRequestException(`${kind === 'visit' ? 'SV-' : 'TS-'} Salesforce ID required`);
    }
    const updated = await this.prisma.activity.update({
      where: { id },
      data: {
        salesforceActivityId: dto.salesforceId.trim(), salesforceActivityType: kind,
        teachersAttended: dto.teachersAttended, leadersAttended: dto.leadersAttended, otherParticipants: dto.otherParticipants,
        status: 'awaiting_ia_verification', evidenceStatus: 'accepted',
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
    await this.audit.log({ action: 'ia.confirm', subjectKind: 'Activity', subjectId: id, actorId: user.userId, actorRole: user.activeRole });
    return updated;
  }
}
