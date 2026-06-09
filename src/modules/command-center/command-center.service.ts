import { Injectable } from '@nestjs/common';
import { ActivityStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ScopeService, UserScope } from '../../common/scope/scope.service';
import { AuthUser } from '../../common/auth/auth-user';
import { getOperationalFY } from '../../common/fy/fy.util';

// ── The recommendation engine: "what must I do next?" ────────────────────────
// One role-scoped, priority-ranked feed of ACTIONS, each computed from real
// state (schools, SSA, activities, verification, payment). The app brings the
// work to the user — no hunting for buttons. Every item carries a reason, a
// recommended action label, and a real route. This is the spine of the
// recommendation-led home screen (the three questions: due / red / attention).

export type Priority = 'critical' | 'high' | 'medium';

export interface ActionItem {
  id: string;
  priority: Priority;
  kind: string;
  title: string;
  reason: string;
  subject?: { kind: string; id: string; name: string };
  action: { label: string; href: string };
  count?: number; // for rolled-up "N schools need X" items
}

const EXAMPLES = 6; // top-N concrete examples surfaced per rolled-up source

@Injectable()
export class CommandCenterService {
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService) {}

  async today(user: AuthUser) {
    const scope = await this.scope.resolveUserScope(user);
    const role = scope.activeRole;
    const items: ActionItem[] = [];

    const planningRole = ['CCEO', 'CountryProgramLead', 'CountryDirector', 'ProjectCoordinator', 'Admin'].includes(role);
    if (planningRole) items.push(...(await this.planningActions(scope)));
    if (role === 'ImpactAssessment' || role === 'Admin') items.push(...(await this.iaActions(scope)));
    if (role === 'ProgramAccountant' || role === 'Admin') items.push(...(await this.accountantActions(scope)));

    // Group for the three-question layout.
    const critical = items.filter((i) => i.priority === 'critical');
    const dueOrAction = items.filter((i) => i.priority === 'high');
    const attention = items.filter((i) => i.priority === 'medium');

    return {
      live: true,
      role,
      scope: scope.countryScope ? 'country' : scope.canViewTeam ? 'team' : 'own',
      summary: {
        total: items.length,
        critical: critical.length,
        action: dueOrAction.length,
        attention: attention.length,
      },
      groups: [
        { key: 'critical', label: 'Red alerts — act now', items: critical },
        { key: 'today', label: 'What you must do next', items: dueOrAction },
        { key: 'attention', label: 'Needs attention', items: attention },
      ].filter((g) => g.items.length > 0),
    };
  }

  // ── Planning roles: cluster gaps, SSA gaps, owned-activity steps ───────────
  private async planningActions(scope: UserScope): Promise<ActionItem[]> {
    const out: ActionItem[] = [];
    const schoolWhere = this.scope.schoolWhere(scope);
    const isNoneScope = JSON.stringify(schoolWhere).includes('__none__');
    if (isNoneScope) return out;

    // 1. Unclustered schools — planning is locked until clustered (assign first).
    const unclustered = { ...schoolWhere, deletedAt: null, clusterStatus: { not: 'clustered' as const } };
    const unclusteredCount = await this.prisma.school.count({ where: unclustered });
    if (unclusteredCount > 0) {
      const ex = await this.prisma.school.findMany({ where: unclustered, select: { id: true, name: true }, take: EXAMPLES, orderBy: { name: 'asc' } });
      out.push(this.rollup('cluster-gap', 'high', `${unclusteredCount} school${unclusteredCount === 1 ? '' : 's'} not in a cluster`,
        'Planning is locked until a school is in a cluster. Assign it from the School Directory.',
        { label: 'Assign cluster', href: '/schools' }, unclusteredCount));
      for (const s of ex) out.push(this.one(`cluster-${s.id}`, 'high', 'cluster-gap', s.name, 'Not in a cluster — planning is locked.', { kind: 'School', id: s.id, name: s.name }, { label: 'Assign cluster', href: '/schools' }));
    }

    // 2. Clustered but no VERIFIED current-FY SSA — schedule SSA / assign to partner.
    const ssaGap = { ...schoolWhere, deletedAt: null, clusterStatus: 'clustered' as const, currentFySsaStatus: { not: 'done' as const } };
    const ssaCount = await this.prisma.school.count({ where: ssaGap });
    if (ssaCount > 0) {
      const ex = await this.prisma.school.findMany({ where: ssaGap, select: { id: true, name: true, schoolType: true }, take: EXAMPLES, orderBy: [{ schoolType: 'asc' }, { name: 'asc' }] });
      out.push(this.rollup('ssa-gap', 'high', `${ssaCount} clustered school${ssaCount === 1 ? '' : 's'} need SSA`,
        'No verified current-FY SSA. Schedule School Improvement Training / SSA, or assign SSA to a partner.',
        { label: 'Schedule SSA', href: '/planning' }, ssaCount));
      for (const s of ex) out.push(this.one(`ssa-${s.id}`, s.schoolType === 'core' ? 'high' : 'medium', 'ssa-gap', s.name, `${s.schoolType === 'core' ? 'Core school' : 'School'} has no current-FY SSA — schedule SSA.`, { kind: 'School', id: s.id, name: s.name }, { label: 'Schedule SSA', href: '/planning' }));
    }

    // 3. Owned activities awaiting the caller's action.
    const owned = this.ownedActivityWhere(scope);
    if (owned) {
      const now = new Date();
      // Overdue planned/scheduled work — critical.
      const overdue = await this.prisma.activity.findMany({
        where: { ...owned, deletedAt: null, status: { in: [ActivityStatus.planned, ActivityStatus.scheduled] }, scheduledDate: { lt: now } },
        select: { id: true, activityType: true, school: { select: { name: true } } }, take: EXAMPLES, orderBy: { scheduledDate: 'asc' },
      });
      const overdueCount = await this.prisma.activity.count({ where: { ...owned, deletedAt: null, status: { in: [ActivityStatus.planned, ActivityStatus.scheduled] }, scheduledDate: { lt: now } } });
      if (overdueCount > 0) {
        out.push(this.rollup('overdue', 'critical', `${overdueCount} scheduled activit${overdueCount === 1 ? 'y is' : 'ies are'} overdue`, 'Past their scheduled date. Complete them or reschedule.', { label: 'Open My Plan', href: '/my-plan' }, overdueCount));
        for (const a of overdue) out.push(this.one(`ov-${a.id}`, 'critical', 'overdue', `${this.label(a.activityType)} · ${a.school?.name ?? 'cluster'}`, 'Overdue — complete or reschedule.', undefined, { label: 'Complete', href: '/my-plan' }));
      }

      // Partner evidence uploaded → staff must review.
      const reviewCount = await this.prisma.activity.count({ where: { ...owned, deletedAt: null, status: ActivityStatus.evidence_uploaded } });
      if (reviewCount > 0) out.push(this.rollup('evidence-review', 'high', `${reviewCount} evidence submission${reviewCount === 1 ? '' : 's'} to review`, 'Partner uploaded evidence. Review and accept, return, or reject.', { label: 'Review evidence', href: '/my-plan' }, reviewCount));

      // Salesforce ID needed.
      const sfCount = await this.prisma.activity.count({ where: { ...owned, deletedAt: null, status: { in: [ActivityStatus.evidence_accepted, ActivityStatus.salesforce_id_required] }, salesforceActivityId: null } });
      if (sfCount > 0) out.push(this.rollup('salesforce', 'high', `${sfCount} activit${sfCount === 1 ? 'y needs' : 'ies need'} a Salesforce ID`, 'Evidence accepted. Enter the Salesforce ID so IA can verify.', { label: 'Enter Salesforce ID', href: '/my-plan' }, sfCount));
    }

    return out;
  }

  // ── IA: SSA verification + Salesforce confirmation queues ──────────────────
  private async iaActions(scope: UserScope): Promise<ActionItem[]> {
    const out: ActionItem[] = [];
    const fy = getOperationalFY();
    // Partner-collected SSA awaiting verification.
    const pendingSsa = await this.prisma.ssaRecord.count({ where: { deletedAt: null, fy, verificationStatus: 'pending' } });
    if (pendingSsa > 0) out.push(this.rollup('ssa-verify', 'high', `${pendingSsa} SSA record${pendingSsa === 1 ? '' : 's'} waiting for your confirmation`, 'Partner-collected SSA needs IA verification before it can drive planning or impact.', { label: 'Verify SSA', href: '/data-verification' }, pendingSsa));
    // Activities awaiting IA verification (Salesforce entered).
    const pendingAct = await this.prisma.activity.count({ where: { deletedAt: null, status: ActivityStatus.awaiting_ia_verification } });
    if (pendingAct > 0) out.push(this.rollup('act-verify', 'high', `${pendingAct} activit${pendingAct === 1 ? 'y is' : 'ies are'} waiting for IA confirmation`, 'Salesforce ID entered. Confirm the activity so the accountant can pay.', { label: 'Confirm activities', href: '/data-verification' }, pendingAct));
    return out;
  }

  // ── Accountant: only IA-verified work ready for payment ────────────────────
  private async accountantActions(scope: UserScope): Promise<ActionItem[]> {
    const out: ActionItem[] = [];
    const ready = await this.prisma.activity.count({
      where: {
        deletedAt: null,
        iaVerificationStatus: 'confirmed',
        paymentStatus: { notIn: ['accountant_cleared', 'paid', 'closed', 'rejected'] },
      },
    });
    if (ready > 0) out.push(this.rollup('payment', 'high', `${ready} verified item${ready === 1 ? '' : 's'} ready for payment / accountability`, 'IA-confirmed work. Clear partner payment or staff accountability.', { label: 'Clear payments', href: '/disbursements' }, ready));
    return out;
  }

  // ── helpers ────────────────────────────────────────────────────────────────
  private ownedActivityWhere(scope: UserScope): Prisma.ActivityWhereInput | null {
    if (scope.countryScope) return {};
    const staffIds = [...scope.staffIds, ...scope.supervisedStaffIds];
    const or: Prisma.ActivityWhereInput[] = [];
    if (staffIds.length) or.push({ responsibleStaffId: { in: staffIds } });
    if (scope.schoolIds.length) or.push({ schoolId: { in: scope.schoolIds } });
    if (!or.length) return null;
    return { OR: or };
  }

  private rollup(kind: string, priority: Priority, title: string, reason: string, action: { label: string; href: string }, count: number): ActionItem {
    return { id: `rollup-${kind}`, priority, kind, title, reason, action, count };
  }
  private one(id: string, priority: Priority, kind: string, title: string, reason: string, subject: ActionItem['subject'], action: { label: string; href: string }): ActionItem {
    return { id, priority, kind, title, reason, subject, action };
  }
  private label(t: string): string {
    return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
