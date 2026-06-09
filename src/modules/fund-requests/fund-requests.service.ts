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

  // Resolve submitter user ids → display names in one batch.
  private async withNames(rows: { submittedByUserId: string }[]) {
    const ids = [...new Set(rows.map((r) => r.submittedByUserId))];
    const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
    const byId = new Map(users.map((u) => [u.id, u.name]));
    return (id: string) => byId.get(id) ?? 'Unknown';
  }

  async list(user: AuthUser) {
    const canApprove = permissionsForRole(user.activeRole).includes(PERMISSIONS.BUDGET_APPROVE);
    const where: Prisma.FundRequestWhereInput = canApprove
      ? {} // approvers see the full queue
      : { submittedByUserId: user.userId }; // submitters see their own
    const rows = await this.prisma.fundRequest.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200 });
    const nameOf = await this.withNames(rows);
    return rows.map((r) => ({
      id: r.id, fy: r.fy, period: r.period, periodKey: r.periodKey, scope: r.scope,
      submittedBy: nameOf(r.submittedByUserId), submittedByRole: r.submittedByRole,
      totalAmount: r.totalAmount, activityCount: r.activityCount, status: r.status,
      reviewedAt: r.reviewedAt, reviewNote: r.reviewNote, createdAt: r.createdAt,
    }));
  }

  /** One fund request's full detail (for the dynamic detail panel). */
  async getOne(user: AuthUser, id: string) {
    const fr = await this.prisma.fundRequest.findUnique({ where: { id } });
    if (!fr) throw new NotFoundException('Fund request not found');
    const canApprove = permissionsForRole(user.activeRole).includes(PERMISSIONS.BUDGET_APPROVE);
    if (!canApprove && fr.submittedByUserId !== user.userId) throw new ForbiddenException('Not your fund request');
    const nameOf = await this.withNames([fr]);
    return {
      id: fr.id, fy: fr.fy, period: fr.period, periodKey: fr.periodKey, scope: fr.scope,
      submittedBy: nameOf(fr.submittedByUserId), submittedByRole: fr.submittedByRole,
      totalAmount: fr.totalAmount, activityCount: fr.activityCount, status: fr.status,
      reviewedAt: fr.reviewedAt, reviewNote: fr.reviewNote, createdAt: fr.createdAt,
    };
  }

  async review(user: AuthUser, id: string, action: 'approve' | 'return' | 'reject', note?: string) {
    const fr = await this.prisma.fundRequest.findUnique({ where: { id } });
    if (!fr) throw new NotFoundException('Fund request not found');
    if (fr.status !== 'submitted') throw new BadRequestException(`Fund request is already ${fr.status}.`);
    if (!permissionsForRole(user.activeRole).includes(PERMISSIONS.BUDGET_APPROVE)) {
      throw new ForbiddenException('Only an approver (BUDGET_APPROVE) can review fund requests.');
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
