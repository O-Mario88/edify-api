import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/auth/auth-user';
import { paginate, PaginationDto } from '../../common/dto/pagination.dto';
import { DomainEventService } from '../../common/realtime/domain-events.service';
import { resolveContextRoute } from '../../common/notifications/context-route';

// Per-user workflow messages, scoped to the recipient.
@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventService,
  ) {}

  list(user: AuthUser, q: PaginationDto) {
    const where = { recipientId: user.userId };
    return Promise.all([
      this.prisma.message.findMany({ where, skip: q.skip, take: q.take, orderBy: { createdAt: 'desc' }, include: { thread: { select: { subject: true } }, sender: { select: { name: true } } } }),
      this.prisma.message.count({ where }),
    ]).then(([data, total]) => paginate(data, total, q));
  }

  recent(user: AuthUser) {
    return this.prisma.message.findMany({ where: { recipientId: user.userId }, orderBy: { createdAt: 'desc' }, take: 8, include: { thread: { select: { subject: true } }, sender: { select: { name: true } } } });
  }

  async counts(user: AuthUser) {
    const [unread, actionRequired] = await Promise.all([
      this.prisma.message.count({ where: { recipientId: user.userId, status: 'unread' } }),
      this.prisma.message.count({ where: { recipientId: user.userId, status: 'unread', actionRequired: true } }),
    ]);
    return { unread, actionRequired };
  }

  async markRead(id: string, user: AuthUser) {
    const m = await this.prisma.message.findUnique({ where: { id } });
    if (!m) throw new NotFoundException('Message not found');
    if (m.recipientId !== user.userId) throw new ForbiddenException('Not your message');
    return this.prisma.message.update({ where: { id }, data: { status: 'read' } });
  }

  // Active users this caller may address. Partners can only reach Edify staff;
  // staff reach other active users. (Body is free-text typed by the user — the
  // scope here governs WHO can be a recipient, not what's written.)
  async recipients(user: AuthUser) {
    const isPartner = (user.roles ?? []).some((r) => r.startsWith('Partner'));
    const rows = await this.prisma.user.findMany({
      where: {
        isActive: true,
        id: { not: user.userId },
        ...(isPartner ? { roles: { hasSome: ['CCEO', 'CountryProgramLead', 'ProjectCoordinator', 'Admin'] } } : {}),
      },
      select: { id: true, name: true, activeRole: true },
      orderBy: { name: 'asc' },
      take: 200,
    });
    return rows.map((r) => ({ id: r.id, name: r.name, role: r.activeRole }));
  }

  // Start a new thread to a recipient (context-tagged), notifying them.
  async send(user: AuthUser, dto: { recipientId?: string; subject?: string; body?: string; contextType?: string; contextId?: string; category?: string }) {
    if (!dto.recipientId) throw new BadRequestException('A recipient is required.');
    if (!dto.body?.trim()) throw new BadRequestException('Message body is required.');
    if (!dto.contextType?.trim()) throw new BadRequestException('A context is required for a new message.');
    if (dto.recipientId === user.userId) throw new BadRequestException('You cannot message yourself.');
    const recipient = await this.prisma.user.findFirst({ where: { id: dto.recipientId, isActive: true }, select: { id: true, activeRole: true } });
    if (!recipient) throw new BadRequestException('Recipient not found or inactive.');
    // Deep-link the message to the EXACT record, routed for the recipient's role
    // (so a CD doesn't land on a planning route they can't use).
    const route = resolveContextRoute(recipient.activeRole, dto.contextType, dto.contextId);
    const thread = await this.prisma.messageThread.create({
      data: { subject: dto.subject?.trim() || `${dto.contextType} message`, contextType: dto.contextType, contextId: dto.contextId },
    });
    const msg = await this.prisma.message.create({
      data: {
        threadId: thread.id, senderId: user.userId, recipientId: recipient.id, body: dto.body.trim(),
        category: dto.category, contextType: dto.contextType, contextId: dto.contextId, targetRoute: route, status: 'unread',
      },
    });
    await this.events.notifyOnly({
      type: 'Message.Sent', subjectKind: 'Message', subjectId: msg.id, actorId: user.userId,
      notify: [{ recipientId: recipient.id, title: `New message from ${user.name}`, body: dto.body.trim().slice(0, 140), contextType: dto.contextType, contextId: dto.contextId, targetRoute: route, actionRequired: false, priority: 'normal' as const }],
      liveUserIds: [user.userId, recipient.id],
    });
    return { threadId: thread.id, id: msg.id };
  }

  // Reply on an existing thread (caller must be a participant); routes to the other party.
  async reply(user: AuthUser, threadId: string, dto: { body?: string }) {
    if (!dto.body?.trim()) throw new BadRequestException('Message body is required.');
    const thread = await this.prisma.messageThread.findUnique({ where: { id: threadId }, include: { messages: { orderBy: { createdAt: 'asc' } } } });
    if (!thread) throw new NotFoundException('Thread not found');
    const parts = new Set<string>();
    for (const m of thread.messages) { parts.add(m.senderId); if (m.recipientId) parts.add(m.recipientId); }
    if (!parts.has(user.userId)) throw new ForbiddenException('You are not a participant in this thread.');
    const other = [...parts].find((p) => p !== user.userId) ?? null;
    // Resolve the reply's deep-link for the OTHER party's role (the recipient).
    const otherUser = other ? await this.prisma.user.findUnique({ where: { id: other }, select: { activeRole: true } }) : null;
    const route = otherUser ? resolveContextRoute(otherUser.activeRole, thread.contextType, thread.contextId) : '/messages';
    const msg = await this.prisma.message.create({
      data: { threadId, senderId: user.userId, recipientId: other, body: dto.body.trim(), contextType: thread.contextType, contextId: thread.contextId, targetRoute: route, status: 'unread' },
    });
    if (other) {
      await this.events.notifyOnly({
        type: 'Message.Reply', subjectKind: 'Message', subjectId: msg.id, actorId: user.userId,
        notify: [{ recipientId: other, title: `Reply from ${user.name}`, body: dto.body.trim().slice(0, 140), contextType: thread.contextType ?? undefined, contextId: thread.contextId ?? undefined, targetRoute: route, actionRequired: false, priority: 'normal' as const }],
        liveUserIds: [user.userId, other],
      });
    }
    return { threadId, id: msg.id };
  }

  // Full thread for the reader pane (caller must be a participant); marks own messages read.
  async thread(user: AuthUser, id: string) {
    const thread = await this.prisma.messageThread.findUnique({ where: { id }, include: { messages: { orderBy: { createdAt: 'asc' }, include: { sender: { select: { name: true } } } } } });
    if (!thread) throw new NotFoundException('Thread not found');
    const parts = new Set<string>();
    for (const m of thread.messages) { parts.add(m.senderId); if (m.recipientId) parts.add(m.recipientId); }
    if (!parts.has(user.userId)) throw new ForbiddenException('Not your thread.');
    await this.prisma.message.updateMany({ where: { threadId: id, recipientId: user.userId, status: 'unread' }, data: { status: 'read' } });
    return {
      id: thread.id, subject: thread.subject, contextType: thread.contextType, contextId: thread.contextId,
      messages: thread.messages.map((m) => ({ id: m.id, body: m.body, senderId: m.senderId, senderName: m.sender.name, mine: m.senderId === user.userId, createdAt: m.createdAt })),
    };
  }
}
