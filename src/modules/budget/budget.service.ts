import { BadRequestException, Injectable } from '@nestjs/common';
import { ActivityStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ScopeService, UserScope } from '../../common/scope/scope.service';
import { AuthUser } from '../../common/auth/auth-user';
import { getOperationalFY } from '../../common/fy/fy.util';
import { AuditService } from '../../common/audit/audit.service';
import { costForActivity, RateCard, CostableActivity } from './costing';

// ── Budget = the schedule, costed ────────────────────────────────────────────
// There is NO manual budget building for program activities. The budget is the
// caller's scheduled activities, each auto-costed from the CD rate card, rolled
// up to week / month / quarter / year. Weekly = "what you need next; the
// monthly roll-up is the country fund request. Busy/slow months fall straight
// out of the monthly distribution (spec §11–§14).

// Statuses that represent committed/planned work that needs funding. Anything
// cancelled/rejected/not-yet-planned is excluded from the budget.
const BUDGETABLE_STATUSES: ActivityStatus[] = [
  ActivityStatus.planned,
  ActivityStatus.scheduled,
  ActivityStatus.rescheduled, // a moved activity is still committed, funded work
  ActivityStatus.assigned_to_partner,
  ActivityStatus.partner_scheduled,
  ActivityStatus.in_progress,
  ActivityStatus.evidence_uploaded,
  ActivityStatus.evidence_accepted,
  ActivityStatus.salesforce_id_required,
  ActivityStatus.awaiting_ia_verification,
  ActivityStatus.ia_verified,
  ActivityStatus.accountant_confirmed,
  ActivityStatus.completed,
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

@Injectable()
export class BudgetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  // ── Rate card ──────────────────────────────────────────────────────────────

  /** The full rate card (CD-owned). Visible to anyone who can plan. */
  async listCostSettings() {
    const rows = await this.prisma.costSetting.findMany({ orderBy: { key: 'asc' } });
    return {
      settings: rows.map((r) => ({
        id: r.id,
        key: r.key,
        label: r.label,
        unitCost: r.unitCost,
        fy: r.fy,
        version: r.version,
        updatedAt: r.updatedAt,
      })),
      count: rows.length,
    };
  }

  /** CD upserts a single rate by key. Guarded by COST_SETTINGS_MANAGE at the
   *  controller — this is the only way official costs are set. */
  async upsertCostSetting(user: AuthUser, body: { key?: string; label?: string; unitCost?: number; fy?: string; reason?: string }) {
    const key = (body.key ?? '').trim();
    if (!key) throw new BadRequestException('key is required');
    if (typeof body.unitCost !== 'number' || body.unitCost < 0)
      throw new BadRequestException('unitCost must be a non-negative number');
    const label = (body.label ?? key).trim();

    // Versioned register: bump the version on a real rate change and append an
    // immutable history row (old→new, who, when, why). Past budgets keep their
    // snapshotted ActivityBudgetLine.unitCost, so they never change retroactively.
    const existing = await this.prisma.costSetting.findUnique({ where: { key } });
    const changed = !existing || existing.unitCost !== body.unitCost;
    const version = existing ? existing.version + (changed ? 1 : 0) : 1;

    const saved = await this.prisma.costSetting.upsert({
      where: { key },
      create: { key, label, unitCost: body.unitCost, fy: body.fy ?? null, version: 1, createdBy: user.userId },
      update: { label, unitCost: body.unitCost, version, ...(body.fy !== undefined ? { fy: body.fy } : {}) },
    });

    if (changed) {
      await this.prisma.costSettingHistory.create({
        data: {
          key, label, oldUnitCost: existing?.unitCost ?? null, newUnitCost: body.unitCost,
          version, fy: saved.fy, changedByUserId: user.userId, reason: body.reason?.trim() || null,
        },
      });
      await this.audit.log({
        action: 'costRegister.rateChanged', subjectKind: 'CostSetting', subjectId: saved.id,
        actorId: user.userId, actorRole: user.activeRole,
        payload: { key, oldUnitCost: existing?.unitCost ?? null, newUnitCost: body.unitCost, version, reason: body.reason ?? null },
      });
    }
    return { ok: true, setting: { id: saved.id, key: saved.key, label: saved.label, unitCost: saved.unitCost, version: saved.version } };
  }

  /** Versioned change history for one rate (or the whole register). */
  async costSettingHistory(key?: string) {
    const rows = await this.prisma.costSettingHistory.findMany({
      where: key ? { key } : {}, orderBy: { changedAt: 'desc' }, take: 200,
    });
    return { history: rows, count: rows.length };
  }

  private async rateCard(): Promise<RateCard> {
    const rows = await this.prisma.costSetting.findMany({ select: { key: true, unitCost: true } });
    const card: RateCard = {};
    for (const r of rows) card[r.key] = r.unitCost;
    return card;
  }

  /** Cost preview for the scheduling drawer — the exact lines + total the CD
   *  rate card (Country Cost Register) produces for an activity BEFORE it is
   *  scheduled. Source of truth = official CostSetting rates; no manual cost.
   *  A missing rate surfaces costMissing so the UI can warn + block fund use. */
  async costPreview(input: {
    activityType?: string; deliveryType?: string; districtType?: string;
    teachersAttended?: number; leadersAttended?: number; otherParticipants?: number;
  }) {
    if (!input.activityType) throw new BadRequestException('activityType is required for a cost preview.');
    const rates = await this.rateCard();
    const cost = costForActivity(
      {
        activityType: input.activityType as CostableActivity['activityType'],
        deliveryType: (input.deliveryType ?? 'staff') as CostableActivity['deliveryType'],
        districtType: input.districtType,
        teachersAttended: input.teachersAttended,
        leadersAttended: input.leadersAttended,
        otherParticipants: input.otherParticipants,
      },
      rates,
    );
    return {
      source: `Uganda · FY ${getOperationalFY()} Country Cost Register`,
      currency: 'UGX',
      amount: cost.amount,
      costMissing: cost.costMissing,
      lines: cost.lines,
    };
  }

  // ── Activity scope (own work + work in own schools) ─────────────────────────

  private activityWhere(scope: UserScope): Prisma.ActivityWhereInput {
    const base: Prisma.ActivityWhereInput = {
      deletedAt: null,
      status: { in: BUDGETABLE_STATUSES },
    };
    if (scope.countryScope) return base;
    const staffIds = [...scope.staffIds, ...scope.supervisedStaffIds];
    const or: Prisma.ActivityWhereInput[] = [];
    if (staffIds.length) or.push({ responsibleStaffId: { in: staffIds } });
    if (scope.schoolIds.length) or.push({ schoolId: { in: scope.schoolIds } });
    if (!or.length) return { ...base, id: '__none__' };
    return { ...base, OR: or };
  }

  // ── The budget, built from the schedule ─────────────────────────────────────

  /**
   * The caller's full scheduled-work budget for an FY, auto-costed and rolled up
   * by month (→ busy/slow), activity type, and delivery (staff/partner). This is
   * the one read that powers weekly fund requests, the monthly country request,
   * and quarterly/annual summaries — the period param just changes the lens.
   */
  async fromSchedule(user: AuthUser, opts: { fy?: string } = {}) {
    const scope = await this.scope.resolveUserScope(user);
    const fy = opts.fy || getOperationalFY();
    const rates = await this.rateCard();

    const activities = await this.prisma.activity.findMany({
      where: { ...this.activityWhere(scope), fy },
      select: {
        id: true,
        activityType: true,
        deliveryType: true,
        status: true,
        quarter: true,
        month: true,
        plannedMonth: true,
        scheduledDate: true,
        teachersAttended: true,
        leadersAttended: true,
        otherParticipants: true,
        school: { select: { schoolType: true } },
      },
    });

    // Per-month accumulators (busy/slow), per-type, per-delivery, totals.
    const byMonth = MONTHS.map((m, i) => ({ month: i + 1, label: m, amount: 0, count: 0, trainings: 0 }));
    const byType = new Map<string, { amount: number; count: number }>();
    const byDelivery = { staff: { amount: 0, count: 0 }, partner: { amount: 0, count: 0 } };
    let total = 0;
    let costMissingCount = 0;

    for (const a of activities) {
      const costable: CostableActivity = {
        activityType: a.activityType,
        deliveryType: a.deliveryType,
        teachersAttended: a.teachersAttended,
        leadersAttended: a.leadersAttended,
        otherParticipants: a.otherParticipants,
      };
      const cost = costForActivity(costable, rates);
      if (cost.costMissing) costMissingCount += 1;
      total += cost.amount;

      const mIdx = this.monthIndexOf(a);
      if (mIdx != null) {
        byMonth[mIdx].amount += cost.amount;
        byMonth[mIdx].count += 1;
        if (/training/.test(a.activityType)) byMonth[mIdx].trainings += 1;
      }

      const t = byType.get(a.activityType) ?? { amount: 0, count: 0 };
      t.amount += cost.amount;
      t.count += 1;
      byType.set(a.activityType, t);

      const d = a.deliveryType === 'partner' ? byDelivery.partner : byDelivery.staff;
      d.amount += cost.amount;
      d.count += 1;
    }

    // Busy/slow are judged against the average of the MONTHS that carry work —
    // using month-attributed spend only (activities with no schedule month are
    // in `total` but cannot be placed on the calendar).
    const monthsWithWork = byMonth.filter((m) => m.count > 0);
    const attributedTotal = monthsWithWork.reduce((s, m) => s + m.amount, 0);
    const avg = monthsWithWork.length ? attributedTotal / monthsWithWork.length : 0;
    // Busy = clearly above the active-month average; slow = has work but well below.
    const busyMonths = byMonth
      .filter((m) => m.count > 0 && m.amount > avg * 1.4)
      .map((m) => ({ ...m, insight: `${m.label} is overloaded: ${m.count} activities · ${ugx(m.amount)}` }));
    const slowMonths = byMonth
      .filter((m) => m.count > 0 && m.amount < avg * 0.5)
      .map((m) => ({ ...m, insight: `${m.label} is under-planned: only ${m.count} activities · ${ugx(m.amount)}` }));

    return {
      live: true,
      fy,
      role: scope.activeRole,
      scope: scope.countryScope ? 'country' : scope.canViewTeam ? 'team' : 'own',
      total,
      activityCount: activities.length,
      costMissingCount,
      scheduledTotal: attributedTotal,
      unscheduledCount: activities.length - monthsWithWork.reduce((s, m) => s + m.count, 0),
      unscheduledAmount: total - attributedTotal,
      byMonth,
      byQuarter: this.rollQuarters(byMonth),
      byType: Array.from(byType.entries())
        .map(([type, v]) => ({ type, ...v }))
        .sort((a, b) => b.amount - a.amount),
      byDelivery,
      busyMonths,
      slowMonths,
      avgMonthlyCost: Math.round(avg),
    };
  }

  /**
   * Per-activity cost breakdown for a period — the exact rows that make up a
   * fund request total, each priced from the CD rate card (the cost catalogue).
   * This is what an approver expands to verify the rule "every cost of an
   * activity comes from the plan and the cost catalogue." fy + optional
   * month/quarter narrow to the request's period.
   */
  async breakdown(user: AuthUser, opts: { fy?: string; month?: number; quarter?: string } = {}) {
    const scope = await this.scope.resolveUserScope(user);
    const fy = opts.fy || getOperationalFY();
    const rates = await this.rateCard();
    const q = opts.quarter?.toUpperCase();
    const QMONTHS: Record<string, number[]> = { Q1: [7, 8, 9], Q2: [10, 11, 12], Q3: [1, 2, 3], Q4: [4, 5, 6] };

    const activities = await this.prisma.activity.findMany({
      where: { ...this.activityWhere(scope), fy },
      select: {
        id: true, activityType: true, deliveryType: true, status: true,
        quarter: true, month: true, plannedMonth: true, scheduledDate: true,
        teachersAttended: true, leadersAttended: true, otherParticipants: true,
        school: { select: { name: true, schoolType: true } },
        cluster: { select: { name: true } },
      },
    });

    const rows = activities
      .map((a) => ({ a, month: this.monthNumberOf(a) }))
      .filter(({ month }) => {
        if (opts.month != null) return month === opts.month;
        if (q) return month != null && (QMONTHS[q]?.includes(month) ?? false);
        return true;
      })
      .map(({ a, month }) => {
        const cost = costForActivity(
          {
            activityType: a.activityType,
            deliveryType: a.deliveryType,
            teachersAttended: a.teachersAttended,
            leadersAttended: a.leadersAttended,
            otherParticipants: a.otherParticipants,
          },
          rates,
        );
        return {
          id: a.id,
          activityType: a.activityType,
          deliveryType: a.deliveryType,
          target: a.school?.name ?? a.cluster?.name ?? 'cluster',
          month,
          amount: cost.amount,
          costMissing: cost.costMissing,
          lines: cost.lines.map((l) => ({ label: l.label, qty: l.qty, unit: l.unit, amount: l.amount, missing: l.missing })),
        };
      })
      .sort((x, y) => y.amount - x.amount);

    return { fy, activities: rows, total: rows.reduce((s, r) => s + r.amount, 0), count: rows.length };
  }

  /**
   * Weekly fund request — the operational view for CCEO/PL. The activities
   * scheduled for a given ISO week, each line-item costed, with the total the
   * caller should request. Defaults to the current FY's upcoming scheduled work
   * grouped by (week-of-month) when exact dates are sparse.
   */
  async weekly(user: AuthUser, opts: { fy?: string; month?: number } = {}) {
    const scope = await this.scope.resolveUserScope(user);
    const fy = opts.fy || getOperationalFY();
    const rates = await this.rateCard();

    const activities = await this.prisma.activity.findMany({
      where: { ...this.activityWhere(scope), fy },
      select: {
        id: true,
        activityType: true,
        deliveryType: true,
        status: true,
        month: true,
        plannedMonth: true,
        plannedWeek: true,
        week: true,
        scheduledDate: true,
        quarter: true,
        teachersAttended: true,
        leadersAttended: true,
        otherParticipants: true,
        paymentStatus: true,
        iaVerificationStatus: true,
        school: { select: { name: true, schoolType: true, district: { select: { name: true } } } },
        cluster: { select: { name: true } },
        responsibleStaff: { select: { user: { select: { name: true } } } },
        assignedPartner: { select: { name: true } },
      },
      orderBy: [{ scheduledDate: 'asc' }, { plannedWeek: 'asc' }],
    });

    const monthFilter = opts.month ?? null;
    const lines = activities
      .filter((a) => monthFilter == null || this.monthNumberOf(a) === monthFilter)
      .map((a) => {
        const cost = costForActivity(
          {
            activityType: a.activityType,
            deliveryType: a.deliveryType,
            teachersAttended: a.teachersAttended,
            leadersAttended: a.leadersAttended,
            otherParticipants: a.otherParticipants,
          },
          rates,
        );
        return {
          id: a.id,
          activityType: a.activityType,
          deliveryType: a.deliveryType,
          status: a.status,
          month: this.monthNumberOf(a),
          week: a.plannedWeek ?? a.week ?? null,
          scheduledDate: a.scheduledDate,
          place: a.school?.name ?? a.cluster?.name ?? '—',
          district: a.school?.district?.name ?? null,
          staff: a.responsibleStaff?.user?.name ?? null,
          partner: a.assignedPartner?.name ?? null,
          amount: cost.amount,
          costMissing: cost.costMissing,
          lines: cost.lines,
          paymentStatus: a.paymentStatus,
          iaVerificationStatus: a.iaVerificationStatus,
        };
      });

    // Group into weeks (month*10 + week) for the request rows.
    const weeks = new Map<string, { key: string; month: number | null; week: number | null; amount: number; count: number }>();
    for (const l of lines) {
      const key = `${l.month ?? 0}-${l.week ?? 0}`;
      const g = weeks.get(key) ?? { key, month: l.month, week: l.week, amount: 0, count: 0 };
      g.amount += l.amount;
      g.count += 1;
      weeks.set(key, g);
    }

    return {
      live: true,
      fy,
      role: scope.activeRole,
      total: lines.reduce((s, l) => s + l.amount, 0),
      count: lines.length,
      costMissingCount: lines.filter((l) => l.costMissing).length,
      weeks: Array.from(weeks.values()).sort((a, b) => (a.month! - b.month!) || (a.week! - b.week!)),
      lines,
    };
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private monthNumberOf(a: { scheduledDate?: Date | null; month?: number | null; plannedMonth?: number | null }): number | null {
    if (a.scheduledDate) return a.scheduledDate.getMonth() + 1;
    return a.month ?? a.plannedMonth ?? null;
  }
  private monthIndexOf(a: { scheduledDate?: Date | null; month?: number | null; plannedMonth?: number | null }): number | null {
    const m = this.monthNumberOf(a);
    return m == null ? null : m - 1;
  }

  private rollQuarters(byMonth: { month: number; amount: number; count: number }[]) {
    // Edify FY quarters: Q1 Jul-Sep, Q2 Oct-Dec, Q3 Jan-Mar, Q4 Apr-Jun.
    const map: Record<string, number[]> = { Q1: [7, 8, 9], Q2: [10, 11, 12], Q3: [1, 2, 3], Q4: [4, 5, 6] };
    return Object.entries(map).map(([q, months]) => {
      const rows = byMonth.filter((m) => months.includes(m.month));
      return { quarter: q, amount: rows.reduce((s, r) => s + r.amount, 0), count: rows.reduce((s, r) => s + r.count, 0) };
    });
  }
}

function ugx(n: number): string {
  if (n >= 1_000_000) return `UGX ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `UGX ${Math.round(n / 1_000)}K`;
  return `UGX ${Math.round(n)}`;
}
