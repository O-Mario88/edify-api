import { Injectable } from '@nestjs/common';
import { EdifyRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeService } from './realtime.service';
import { AuditService } from '../audit/audit.service';
import { resolveContextRoute } from '../notifications/context-route';

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

      // 2) Notifications — saved per-recipient, never decorative. Routed to a
      // role-aware deep link, and deduped so the same unresolved alert never spams.
      const created = await this.createNotifications(evt.notify, evt.subjectKind, evt.subjectId);

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
      const created = await this.createNotifications(evt.notify, evt.subjectKind, evt.subjectId);
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

  /**
   * Persist per-recipient notifications with two guarantees:
   *  • role-aware deep link — when the caller didn't pass an explicit targetRoute,
   *    resolve one for the recipient's role + the event context (never a route the
   *    role can't act on);
   *  • dedupe — one UNRESOLVED notification per (recipient, context, title). A repeat
   *    event bumps the existing row to the top instead of spamming a new one.
   */
  private async createNotifications(
    notify: NotifySpec[] | undefined,
    fallbackKind?: string,
    fallbackId?: string,
  ) {
    const specs = notify ?? [];
    if (specs.length === 0) return [];
    const ids = [...new Set(specs.map((s) => s.recipientId))];
    const roleById = new Map<string, EdifyRole>();
    for (const u of await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, activeRole: true } })) {
      roleById.set(u.id, u.activeRole);
    }
    const created: Array<{ id: string; recipientId: string; title: string; actionRequired: boolean; priority: string }> = [];
    for (const n of specs) {
      const contextType = n.contextType ?? fallbackKind ?? null;
      const contextId = n.contextId ?? fallbackId ?? null;
      const role = roleById.get(n.recipientId);
      const targetRoute = n.targetRoute ?? (role && contextType ? resolveContextRoute(role, contextType, contextId) : undefined);
      const data = {
        recipientId: n.recipientId,
        title: n.title,
        body: n.body,
        contextType,
        contextId,
        targetRoute,
        actionRequired: n.actionRequired ?? false,
        priority: (n.priority ?? 'normal') as never,
      };
      // Dedupe against an existing unread notification for the same record + title.
      const existing = await this.prisma.notification.findFirst({
        where: { recipientId: n.recipientId, status: 'unread', title: n.title, contextType, contextId },
        select: { id: true },
      });
      const row = existing
        ? await this.prisma.notification.update({ where: { id: existing.id }, data: { ...data, createdAt: new Date() } })
        : await this.prisma.notification.create({ data });
      created.push(row);
    }
    return created;
  }

  /**
   * Auto-resolve open notifications for a context once the underlying issue is
   * fixed — e.g. uploading evidence resolves the "evidence missing" alert, paying
   * resolves "payment ready". Workflow actions call this post-commit so stale
   * notifications never linger. Pushes a live refresh so the bell badge drops.
   */
  async resolveContext(contextType: string, contextId: string, opts?: { titleIncludes?: string }): Promise<number> {
    try {
      const where: Prisma.NotificationWhereInput = {
        contextType, contextId, status: { in: ['unread', 'read'] },
        ...(opts?.titleIncludes ? { title: { contains: opts.titleIncludes } } : {}),
      };
      const affected = await this.prisma.notification.findMany({ where, select: { recipientId: true } });
      if (affected.length === 0) return 0;
      await this.prisma.notification.updateMany({ where, data: { status: 'archived' } });
      this.realtime.publishMany(
        [...new Set(affected.map((a) => a.recipientId))],
        { type: 'notification.resolved', subjectKind: 'Notification', subjectId: contextId, at: Date.now() },
      );
      return affected.length;
    } catch {
      return 0;
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
