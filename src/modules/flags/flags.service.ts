import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CdFlagStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { DomainEventService } from '../../common/realtime/domain-events.service';
import { AuthUser } from '../../common/auth/auth-user';

// The CD → PL flag handoff. The Country Director monitors and FLAGS issues to a
// Program Lead (who plans), instead of planning directly. A flag is a persisted,
// PL-assigned action item with a notification + audit — never a CD field action.
const CD_ROLES = new Set(['CountryDirector', 'Admin']);

interface RaiseFlagBody {
  assignedToUserId?: string;
  category?: string;
  note?: string;
  scopeType?: string;
  scopeId?: string;
  scopeName?: string;
  recommendedAction?: string;
  priority?: string;
  dueDate?: string;
}

@Injectable()
export class FlagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventService,
  ) {}

  /** CD raises a flag to a Program Lead — a persisted, PL-assigned action item. */
  async raise(user: AuthUser, body: RaiseFlagBody) {
    if (!CD_ROLES.has(user.activeRole)) throw new ForbiddenException('Only the Country Director can flag issues to a Program Lead.');
    if (!body.assignedToUserId) throw new BadRequestException('A Program Lead (assignedToUserId) is required.');
    if (!body.note?.trim()) throw new BadRequestException('A note describing the issue is required.');
    const pl = await this.prisma.user.findFirst({ where: { id: body.assignedToUserId, isActive: true }, select: { id: true } });
    if (!pl) throw new BadRequestException('Assigned Program Lead not found.');

    const flag = await this.prisma.cdFlag.create({
      data: {
        raisedByUserId: user.userId, raisedByName: user.name,
        assignedToUserId: body.assignedToUserId,
        category: body.category ?? 'general',
        scopeType: body.scopeType, scopeId: body.scopeId, scopeName: body.scopeName,
        note: body.note.trim(), recommendedAction: body.recommendedAction,
        priority: body.priority ?? 'normal', dueDate: body.dueDate,
      },
    });
    await this.events.emit({
      type: 'CdFlagRaised', actorId: user.userId, actorRole: user.activeRole,
      subjectKind: 'CdFlag', subjectId: flag.id,
      payload: { category: flag.category, scope: flag.scopeName, priority: flag.priority },
      notify: [{
        recipientId: body.assignedToUserId,
        title: `Flagged by your Country Director${flag.scopeName ? `: ${flag.scopeName}` : ''}`,
        body: flag.note,
        targetRoute: '/team-plan',
        actionRequired: true,
        priority: flag.priority === 'urgent' || flag.priority === 'high' ? 'high' : 'normal',
      }],
      liveUserIds: [user.userId, body.assignedToUserId],
    });
    return flag;
  }

  /** The caller's flag queue: a PL sees flags assigned to them; a CD sees flags
   *  they raised (so both ends track the handoff). */
  async list(user: AuthUser, status?: string) {
    const where: Prisma.CdFlagWhereInput = CD_ROLES.has(user.activeRole)
      ? { OR: [{ assignedToUserId: user.userId }, { raisedByUserId: user.userId }] }
      : { assignedToUserId: user.userId };
    if (status) where.status = status as CdFlagStatus;
    const flags = await this.prisma.cdFlag.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
    return { flags, count: flags.length, openCount: flags.filter((f) => f.status === 'open').length };
  }

  /** The assigned PL acknowledges or resolves a flag; the raising CD is notified. */
  async update(user: AuthUser, id: string, action: 'acknowledge' | 'resolve', note?: string) {
    const flag = await this.prisma.cdFlag.findUnique({ where: { id } });
    if (!flag) throw new NotFoundException('Flag not found');
    if (flag.assignedToUserId !== user.userId && !CD_ROLES.has(user.activeRole)) {
      throw new ForbiddenException('Only the assigned Program Lead can act on this flag.');
    }
    const status: CdFlagStatus = action === 'resolve' ? 'resolved' : 'acknowledged';
    const updated = await this.prisma.cdFlag.update({
      where: { id },
      data: { status, ...(action === 'resolve' ? { resolutionNote: note ?? null, resolvedAt: new Date() } : {}) },
    });
    await this.events.emit({
      type: 'CdFlagUpdated', actorId: user.userId, actorRole: user.activeRole,
      subjectKind: 'CdFlag', subjectId: id, payload: { status },
      notify: [{
        recipientId: flag.raisedByUserId,
        title: `Flag ${status}${flag.scopeName ? `: ${flag.scopeName}` : ''}`,
        body: action === 'resolve' ? note ?? 'The Program Lead resolved your flag.' : 'The Program Lead acknowledged your flag.',
        targetRoute: '/dashboards/director',
        priority: 'normal',
      }],
      liveUserIds: [user.userId, flag.raisedByUserId],
    });
    return updated;
  }
}
