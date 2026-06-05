import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/auth/auth-user';
import { paginate, PaginationDto } from '../../common/dto/pagination.dto';

// Per-user workflow messages, scoped to the recipient.
@Injectable()
export class MessagesService {
  constructor(private readonly prisma: PrismaService) {}

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
}
