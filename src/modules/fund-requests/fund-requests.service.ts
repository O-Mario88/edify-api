import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ScopeService } from '../../common/scope/scope.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { getOperationalFY } from '../../common/fy/fy.util';
import { permissionsForRole, PERMISSIONS } from '../../common/rbac/permissions';
import { BudgetService } from '../budget/budget.service';

type Period = 'weekly' | 'monthly' | 'quarterly' | 'annual';

// Fund requests = a submitted, costed snapshot of a period's scheduled work,
// routed for CD approval. The amount comes from the schedule (budget engine) —
// never typed — and a request is blocked while any activity is missing a cost.
@Injectable()
export class FundRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly budget: BudgetService,
  ) {}

  async submit(user: AuthUser, dto: { period?: string; month?: number; quarter?: string }) {
    const period = (dto.period ?? 'monthly') as Period;
    const fy = getOperationalFY();
    const scope = await this.scope.resolveUserScope(user);
    const scopeLabel = scope.countryScope ? 'country' : scope.canViewTeam ? 'team' : 'own';

    let total = 0, count = 0, costMissing = 0, periodKey = fy;

    if (period === 'weekly') {
      const w = await this.budget.weekly(user, { fy });
      total = w.total; count = w.count; costMissing = w.costMissingCount; periodKey = `${fy}-weekly`;
    } else {
      const s = await this.budget.fromSchedule(user, { fy });
      costMissing = s.costMissingCount;
      if (period === 'monthly') {
        const m = dto.month ?? new Date().getMonth() + 1;
        const row = s.byMonth.find((x) => x.month === m);
        total = row?.amount ?? 0; count = row?.count ?? 0; periodKey = `${fy}-M${m}`;
      } else if (period === 'quarterly') {
        const q = (dto.quarter ?? 'Q3').toUpperCase();
        const row = s.byQuarter.find((x) => x.quarter === q);
        total = row?.amount ?? 0; count = row?.count ?? 0; periodKey = `${fy}-${q}`;
      } else {
        total = s.total; count = s.activityCount; periodKey = fy;
      }
    }

    // Spec rail: a request can't be submitted while any activity lacks a cost.
    if (costMissing > 0) {
      throw new BadRequestException(`${costMissing} scheduled activit${costMissing === 1 ? 'y is' : 'ies are'} missing a cost rate. Resolve the rate(s) before requesting funds.`);
    }
    if (total <= 0) throw new BadRequestException('No costed activities in this period to request funds for.');

    const fr = await this.prisma.fundRequest.create({
      data: {
        fy, period: period as never, periodKey, scope: scopeLabel,
        submittedByUserId: user.userId, submittedByRole: user.activeRole,
        totalAmount: total, activityCount: count, status: 'submitted',
      },
    });
    await this.audit.log({
      action: 'fundRequest.submit', subjectKind: 'FundRequest', subjectId: fr.id,
      actorId: user.userId, actorRole: user.activeRole,
      payload: { period, periodKey, total, count },
    });
    return fr;
  }

  // The userIds of the people this approver directly supervises — the ONLY
  // requests they may see or act on. CCEO → their field staff; PL → their CCEOs.
  // An approver never approves their own request: it routes UP to their own
  // supervisor. Returns [] when the caller has no staff profile or no reports.
  private async supervisedUserIds(user: AuthUser): Promise<string[]> {
    if (!user.staffProfileId) return [];
    const links = await this.prisma.staffSupervisorAssignment.findMany({
      where: { supervisorId: user.staffProfileId },
      select: { superviseeId: true },
    });
    const staffIds = links.map((l) => l.superviseeId);
    if (!staffIds.length) return [];
    const profiles = await this.prisma.staffProfile.findMany({
      where: { id: { in: staffIds } },
      select: { userId: true },
    });
    return profiles.map((p) => p.userId);
  }

  // Resolve submitter user ids → display names in one batch.
  private async withNames(rows: { submittedByUserId: string }[]) {
    const ids = [...new Set(rows.map((r) => r.submittedByUserId))];
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    const byId = new Map(users.map((u) => [u.id, u.name]));
    return (id: string) => byId.get(id) ?? 'Unknown';
  }

  async list(user: AuthUser) {
    const canApprove = permissionsForRole(user.activeRole).includes(PERMISSIONS.BUDGET_APPROVE);
    // Approvers see requests from the staff they supervise (their approval
    // queue) AND their own (what they've escalated upward). Non-approvers see
    // only their own. No one sees the whole country's queue — approval is scoped
    // to the supervision chain, not the role.
    const supervised = canApprove ? await this.supervisedUserIds(user) : [];
    const supervisedSet = new Set(supervised);
    const where: Prisma.FundRequestWhereInput = canApprove
      ? { submittedByUserId: { in: [...supervised, user.userId] } }
      : { submittedByUserId: user.userId };
    const rows = await this.prisma.fundRequest.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
    const nameOf = await this.withNames(rows);
    return rows.map((r) => ({
      id: r.id, fy: r.fy, period: r.period, periodKey: r.periodKey, scope: r.scope,
      submittedBy: nameOf(r.submittedByUserId), submittedByRole: r.submittedByRole,
      totalAmount: r.totalAmount, activityCount: r.activityCount, status: r.status,
      reviewedAt: r.reviewedAt, reviewNote: r.reviewNote, createdAt: r.createdAt,
      // True only when this row is from someone you supervise AND still open —
      // so the list never offers "Approve" on your own escalated request.
      canReview: supervisedSet.has(r.submittedByUserId) && r.status === 'submitted',
    }));
  }

  /** Parse the request's period back out of its periodKey. */
  private parsePeriod(periodKey: string): { month?: number; quarter?: string } {
    const m = periodKey.match(/-M(\d+)$/);
    if (m) return { month: Number(m[1]) };
    const q = periodKey.match(/-(Q\d)$/);
    if (q) return { quarter: q[1] };
    return {};
  }

  /** One fund request's full detail, INCLUDING the per-activity cost breakdown
   *  computed in the SUBMITTER's scope from the plan + cost catalogue — so the
   *  approver expands to see exactly which costed activities make up the total
   *  and that each line traces to a CD rate. */
  async getOne(user: AuthUser, id: string) {
    const fr = await this.prisma.fundRequest.findUnique({ where: { id } });
    if (!fr) throw new NotFoundException('Fund request not found');

    const canApprove = permissionsForRole(user.activeRole).includes(PERMISSIONS.BUDGET_APPROVE);
    const isOwn = fr.submittedByUserId === user.userId;
    if (!isOwn) {
      // An approver may only open a request from someone they supervise.
      if (!canApprove) throw new ForbiddenException('Not your fund request');
      const supervised = await this.supervisedUserIds(user);
      if (!supervised.includes(fr.submittedByUserId)) throw new ForbiddenException('This fund request is not in your approval scope.');
    }

    const nameOf = await this.withNames([fr]);

    // Re-derive the costed activities in the submitter's own scope — the
    // breakdown that backs the stored total. Every line comes from the rate card.
    let breakdown: Awaited<ReturnType<BudgetService['breakdown']>> | null = null;
    const submitter = await this.prisma.user.findUnique({
      where: { id: fr.submittedByUserId },
      select: { id: true, email: true, name: true, roles: true, activeRole: true, staffProfile: { select: { id: true } } },
    });
    if (submitter) {
      const submitterAuth: AuthUser = {
        userId: submitter.id, email: submitter.email, name: submitter.name,
        roles: submitter.roles, activeRole: fr.submittedByRole, staffProfileId: submitter.staffProfile?.id,
      };
      breakdown = await this.budget.breakdown(submitterAuth, { fy: fr.fy, ...this.parsePeriod(fr.periodKey) });
    }

    return {
      id: fr.id, fy: fr.fy, period: fr.period, periodKey: fr.periodKey, scope: fr.scope,
      submittedBy: nameOf(fr.submittedByUserId), submittedByRole: fr.submittedByRole,
      totalAmount: fr.totalAmount, activityCount: fr.activityCount, status: fr.status,
      reviewedAt: fr.reviewedAt, reviewNote: fr.reviewNote, createdAt: fr.createdAt,
      canReview: canApprove && !isOwn && fr.status === 'submitted',
      breakdown: breakdown ? { total: breakdown.total, count: breakdown.count, activities: breakdown.activities } : null,
    };
  }

  async review(user: AuthUser, id: string, action: 'approve' | 'return' | 'reject', note?: string) {
    const fr = await this.prisma.fundRequest.findUnique({ where: { id } });
    if (!fr) throw new NotFoundException('Fund request not found');
    if (fr.status !== 'submitted') throw new BadRequestException(`Fund request is already ${fr.status}.`);
    if (!permissionsForRole(user.activeRole).includes(PERMISSIONS.BUDGET_APPROVE)) {
      throw new ForbiddenException('Only an approver (BUDGET_APPROVE) can review fund requests.');
    }
    // A request routes UP the chain — you never approve your own, and you may
    // only act on a request from someone you directly supervise.
    if (fr.submittedByUserId === user.userId) {
      throw new ForbiddenException('You cannot approve your own fund request — it routes to your supervisor.');
    }
    const supervised = await this.supervisedUserIds(user);
    if (!supervised.includes(fr.submittedByUserId)) {
      throw new ForbiddenException('You can only review fund requests from staff you supervise.');
    }
    const status = action === 'approve' ? 'approved' : action === 'return' ? 'returned' : 'rejected';
    const updated = await this.prisma.fundRequest.update({
      where: { id },
      data: { status: status as never, reviewedByUserId: user.userId, reviewedAt: new Date(), reviewNote: note },
    });
    await this.audit.log({
      action: `fundRequest.${action}`, subjectKind: 'FundRequest', subjectId: id,
      actorId: user.userId, actorRole: user.activeRole, payload: { note: note ?? null },
    });
    return updated;
  }
}
