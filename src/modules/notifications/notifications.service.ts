import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/auth/auth-user';
import { paginate, PaginationDto } from '../../common/dto/pagination.dto';

// Per-user notifications, always scoped to the recipient. Never hardcoded.
@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  list(user: AuthUser, q: PaginationDto) {
    const where = { recipientId: user.userId };
    return Promise.all([
      this.prisma.notification.findMany({ where, skip: q.skip, take: q.take, orderBy: { createdAt: 'desc' } }),
      this.prisma.notification.count({ where }),
    ]).then(([data, total]) => paginate(data, total, q));
  }

  recent(user: AuthUser) {
    return this.prisma.notification.findMany({ where: { recipientId: user.userId }, orderBy: { createdAt: 'desc' }, take: 8 });
  }

  async counts(user: AuthUser) {
    const [unread, actionRequired] = await Promise.all([
      this.prisma.notification.count({ where: { recipientId: user.userId, status: 'unread' } }),
      this.prisma.notification.count({ where: { recipientId: user.userId, status: 'unread', actionRequired: true } }),
    ]);
    return { unread, actionRequired };
  }

  async markRead(id: string, user: AuthUser) {
    const n = await this.prisma.notification.findUnique({ where: { id } });
    if (!n) throw new NotFoundException('Notification not found');
    if (n.recipientId !== user.userId) throw new ForbiddenException('Not your notification');
    return this.prisma.notification.update({ where: { id }, data: { status: 'read' } });
  }

  async markAllRead(user: AuthUser) {
    const r = await this.prisma.notification.updateMany({ where: { recipientId: user.userId, status: 'unread' }, data: { status: 'read' } });
    return { updated: r.count };
  }
}
