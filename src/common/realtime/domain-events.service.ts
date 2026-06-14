import { Injectable } from '@nestjs/common';
import { EdifyRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from './realtime.service';
import { AuditService } from '../audit/audit.service';

export type NotifySpec = {
  recipientId: string;
  title: string;
  body?: string;
  contextType?: string;
  contextId?: string;
  targetRoute?: string;
  actionRequired?: boolean;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
};

export type DomainEvent = {
  type: string;
  actorId?: string;
  actorRole?: EdifyRole;
  subjectKind?: string;
  subjectId?: string;
  payload?: Prisma.InputJsonValue;
  /** Database-backed notifications to create + push to recipients. */
  notify?: NotifySpec[];
  /** Extra users who should get a live "refresh" patch (beyond notify recipients + actor). */
  liveUserIds?: Array<string | undefined | null>;
};

// The single seam every workflow action calls AFTER its DB transaction commits.
// It makes the system behave like a live command center: one action →
//   1. an audit-log row (leadership trust + the activity timeline)
//   2. database-backed notifications for the right recipients
//   3. real-time push so the affected dashboards/queues refresh without a reload
//
// Emitting never throws into the caller's transaction — the write already
// succeeded; notification/realtime failures must not roll the workflow back.
@Injectable()
export class DomainEventService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  async emit(evt: DomainEvent): Promise<void> {
    const at = Date.now();
    try {
      // 1) Audit — the immutable record of what changed. Routed through the
      // hash-chained AuditService.log (prevHash + chainHash + advisory lock) so
      // every emitted event is tamper-evident, not a raw null-hash row outside
      // the chain.
      await this.audit.log({
        action: evt.type,
        subjectKind: evt.subjectKind,
        subjectId: evt.subjectId,
        actorId: evt.actorId,
        actorRole: evt.actorRole,
        payload: evt.payload,
      });

      // 2) Notifications — saved per-recipient, never decorative.
      const created = [];
      for (const n of evt.notify ?? []) {
        const row = await this.prisma.notification.create({
          data: {
            recipientId: n.recipientId,
            title: n.title,
            body: n.body,
            contextType: n.contextType ?? evt.subjectKind,
            contextId: n.contextId ?? evt.subjectId,
            targetRoute: n.targetRoute,
            actionRequired: n.actionRequired ?? false,
            priority: (n.priority ?? 'normal') as never,
          },
        });
        created.push(row);
      }

      // 3a) Recipients get a live "notification" event (drives the unread badge).
      for (const n of created) {
        this.realtime.publish(n.recipientId, {
          type: 'notification', subjectKind: 'Notification', subjectId: n.id, at,
          meta: { title: n.title, actionRequired: n.actionRequired, priority: n.priority },
        });
      }

      // 3b) Everyone affected gets a domain "refresh" patch (re-fetch the touched surfaces).
      this.realtime.publishMany(
        [...(evt.liveUserIds ?? []), ...created.map((c) => c.recipientId), evt.actorId],
        { type: evt.type, subjectKind: evt.subjectKind, subjectId: evt.subjectId, at },
      );
    } catch {
      // Swallow — the source-of-truth write already committed. A production
      // build would enqueue a retry job here (BullMQ); for now the audit/notify
      // best-effort failure must never surface as a failed workflow action.
    }
  }

  /** Notifications + realtime push WITHOUT writing an audit row. Use this when
   *  the caller already wrote a hash-chained audit entry via AuditService.log
   *  (e.g. money operations, whose audit must stay in the tamper-evident chain)
   *  and only needs the recipient notifications + live refresh. */
  async notifyOnly(evt: Omit<DomainEvent, 'actorRole' | 'payload'>): Promise<void> {
    const at = Date.now();
    try {
      const created = [];
      for (const n of evt.notify ?? []) {
        const row = await this.prisma.notification.create({
          data: {
            recipientId: n.recipientId,
            title: n.title,
            body: n.body,
            contextType: n.contextType ?? evt.subjectKind,
            contextId: n.contextId ?? evt.subjectId,
            targetRoute: n.targetRoute,
            actionRequired: n.actionRequired ?? false,
            priority: (n.priority ?? 'normal') as never,
          },
        });
        created.push(row);
      }
      for (const n of created) {
        this.realtime.publish(n.recipientId, {
          type: 'notification', subjectKind: 'Notification', subjectId: n.id, at,
          meta: { title: n.title, actionRequired: n.actionRequired, priority: n.priority },
        });
      }
      this.realtime.publishMany(
        [...(evt.liveUserIds ?? []), ...created.map((c) => c.recipientId), evt.actorId],
        { type: evt.type, subjectKind: evt.subjectKind, subjectId: evt.subjectId, at },
      );
    } catch {
      // Best-effort — the source-of-truth write + its chained audit already committed.
    }
  }

  /** Resolve the User ids for a role (e.g. all accountants to notify of a ready payment). */
  async usersWithRole(role: EdifyRole): Promise<string[]> {
    const rows = await this.prisma.user.findMany({ where: { roles: { has: role } }, select: { id: true } });
    return rows.map((r) => r.id);
  }

  /** Resolve a StaffProfile id → its User id (notification recipients are Users). */
  async userForStaff(staffProfileId?: string | null): Promise<string | null> {
    if (!staffProfileId) return null;
    const sp = await this.prisma.staffProfile.findUnique({ where: { id: staffProfileId }, select: { userId: true } });
    return sp?.userId ?? null;
  }
}
