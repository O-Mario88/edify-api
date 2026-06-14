import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ActivityType, DecisionConfidenceLevel, DecisionRiskLevel, DecisionStatus, ImpactYield, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { getOperationalFY } from '../../common/fy/fy.util';
import { costForActivity, type RateCard } from '../budget/costing';
import { combineConfidence, clamp100, levelFromScore, pct, riskFromHealth } from '../leadership/leadership.types';

// The Budget Intelligence & Financial Decision Engine. Connects every shilling
// to verified activity + target achievement + SSA impact, and recommends where
// leadership should continue / increase / pause / reassign funds. It RECOMMENDS
// — it never moves money. Every figure is computed from real cost-register +
// activity + SSA data; nothing is fabricated.

const ScopeType = {
  country: 'country',
  region: 'region',
  partner: 'partner',
} as const;

const REVIEWABLE_STATUSES: DecisionStatus[] = [
  'under_review', 'accepted', 'accepted_with_conditions', 'rejected', 'deferred', 'converted_to_action_plan',
];
const DONE_STATUSES = new Set<string>(['ia_verified', 'accountant_confirmed', 'completed']);
const ugx = (n: number) => `UGX ${Math.round(n).toLocaleString('en-US')}`;

const ACTIVITY_TYPE_LABEL: Partial<Record<ActivityType, string>> = {
  school_visit: 'School visits',
  follow_up_visit: 'Follow-up visits',
  coaching_visit: 'Coaching visits',
  core_visit: 'Core visits',
  training: 'Trainings',
  school_improvement_training: 'School improvement trainings',
  cluster_training: 'Cluster trainings',
  core_training: 'Core trainings',
  cluster_meeting: 'Cluster meetings',
  partner_activity: 'Partner activities',
  project_activity: 'Special projects',
};

// Financial Impact Yield — does the spend produce verified activity + improvement?
function yieldFromScore(verifiedRatePct: number, improvementRatePct: number | null, level: DecisionConfidenceLevel): ImpactYield {
  if (level === 'insufficient') return ImpactYield.insufficient;
  const impact = improvementRatePct ?? 50; // unknown impact = neutral, never penalised
  const score = verifiedRatePct * 0.5 + impact * 0.5;
  if (score >= 75) return ImpactYield.high;
  if (score >= 55) return ImpactYield.healthy;
  if (score >= 35) return ImpactYield.weak;
  return ImpactYield.low;
}
const YIELD_RISK: Record<ImpactYield, DecisionRiskLevel> = {
  high: 'low', healthy: 'low', weak: 'medium', low: 'high', insufficient: 'medium',
};

type ActivityRow = {
  id: string; activityType: ActivityType; deliveryType: string; status: string;
  iaVerificationStatus: string; paymentStatus: string;
  teachersAttended: number | null; leadersAttended: number | null; otherParticipants: number | null;
  assignedPartnerId: string | null; assignedPartner: { name: string } | null;
  schoolId: string | null;
  school: { regionId: string; region: { name: string } | null; ssaRecords: { fy: string; averageScore: number | null }[] } | null;
};

interface InsightDraft {
  insightType: string;
  scopeType: typeof ScopeType[keyof typeof ScopeType];
  scopeId: string | null;
  scopeName: string | null;
  recommendation: string;
  reason: string;
  riskLevel: DecisionRiskLevel;
  impactYield: ImpactYield;
  confidenceLevel: DecisionConfidenceLevel;
  confidenceScore: number;
  amountAffected: number;
  financialImplication?: string | null;
  suggestedAction: string;
  alternatives: string[];
  metrics: Record<string, unknown>;
  riskFlags: string[];
  evidence: { metricName: string; metricValue: string; tone?: string }[];
}

@Injectable()
export class BudgetIntelligenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ── Cost register (CD-owned CostSetting rate card) ───────────────────────
  private async rateCard(fy: string): Promise<RateCard> {
    const rows = await this.prisma.costSetting.findMany({ where: { OR: [{ fy }, { fy: null }] } });
    const card: RateCard = {};
    // FY-specific rates win over global (null fy) rates.
    for (const r of rows.filter((x) => x.fy == null)) card[r.key] = r.unitCost;
    for (const r of rows.filter((x) => x.fy === fy)) card[r.key] = r.unitCost;
    return card;
  }

  private costOf(a: ActivityRow, rates: RateCard): number {
    return costForActivity(
      {
        activityType: a.activityType,
        deliveryType: a.deliveryType as never,
        teachersAttended: a.teachersAttended,
        leadersAttended: a.leadersAttended,
        otherParticipants: a.otherParticipants,
      },
      rates,
    ).amount;
  }

  private verified(a: ActivityRow): boolean {
    return a.iaVerificationStatus === 'confirmed' || DONE_STATUSES.has(a.status);
  }

  // prev→curr FY SSA improvement rate (% of schools improving) over a set.
  private improvement(rows: ActivityRow[], prevFy: string, fy: string): number | null {
    const bySchool = new Map<string, { prev?: number | null; curr?: number | null }>();
    for (const a of rows) {
      if (!a.schoolId || !a.school) continue;
      const e = bySchool.get(a.schoolId) ?? {};
      for (const r of a.school.ssaRecords) {
        if (r.fy === prevFy) e.prev = r.averageScore;
        if (r.fy === fy) e.curr = r.averageScore;
      }
      bySchool.set(a.schoolId, e);
    }
    const pairs = [...bySchool.values()].filter((p) => p.prev != null && p.curr != null);
    if (pairs.length < 3) return null;
    return clamp100(pct(pairs.filter((p) => (p.curr as number) - (p.prev as number) > 0.05).length, pairs.length));
  }

  // ── Recompute: generate all finance insights from live data ──────────────
  async recompute(fy = getOperationalFY()) {
    const prevFy = String(Number(fy) - 1);
    const rates = await this.rateCard(fy);
    const activities = (await this.prisma.activity.findMany({
      where: { deletedAt: null, fy },
      select: {
        id: true, activityType: true, deliveryType: true, status: true,
        iaVerificationStatus: true, paymentStatus: true,
        teachersAttended: true, leadersAttended: true, otherParticipants: true,
        assignedPartnerId: true, assignedPartner: { select: { name: true } },
        schoolId: true,
        school: { select: { regionId: true, region: { select: { name: true } }, ssaRecords: { where: { deletedAt: null, fy: { in: [prevFy, fy] } }, select: { fy: true, averageScore: true } } } },
      },
      take: 20000,
    })) as ActivityRow[];

    const drafts: InsightDraft[] = [
      ...this.byActivityType(activities, rates, prevFy, fy),
      ...this.byPartner(activities, rates, prevFy, fy),
      ...this.byRegion(activities, rates, prevFy, fy),
      this.country(activities, rates),
    ];

    let generated = 0;
    for (const d of drafts) { await this.persist(fy, d); generated += 1; }
    return { fy, generated };
  }

  // Spend by activity type — where is the money going, and is it producing impact?
  private byActivityType(acts: ActivityRow[], rates: RateCard, prevFy: string, fy: string): InsightDraft[] {
    const groups = new Map<ActivityType, ActivityRow[]>();
    for (const a of acts) (groups.get(a.activityType) ?? groups.set(a.activityType, []).get(a.activityType)!).push(a);
    const total = acts.reduce((s, a) => s + this.costOf(a, rates), 0) || 1;
    const out: InsightDraft[] = [];
    for (const [type, rows] of groups) {
      if (rows.length < 3) continue;
      const spend = rows.reduce((s, a) => s + this.costOf(a, rates), 0);
      const verifiedCount = rows.filter((a) => this.verified(a)).length;
      const verifiedRate = clamp100(pct(verifiedCount, rows.length));
      const improvementRate = this.improvement(rows, prevFy, fy);
      const conf = combineConfidence([
        { label: 'Activity volume', ratio: Math.min(1, rows.length / 10), weight: 1 },
        { label: 'Verification data', ratio: 1, weight: 1 },
        { label: 'SSA impact data', ratio: improvementRate != null ? 1 : 0, weight: 1 },
      ]);
      const yld = yieldFromScore(verifiedRate, improvementRate, conf.level);
      const sharePct = Math.round((spend / total) * 100);
      const label = ACTIVITY_TYPE_LABEL[type] ?? String(type).replace(/_/g, ' ');
      const lowYield = yld === ImpactYield.low || yld === ImpactYield.weak;
      out.push({
        insightType: 'activity',
        scopeType: ScopeType.country, scopeId: type, scopeName: label,
        recommendation: lowYield
          ? `Review ${label} spending — ${sharePct}% of funds, ${yld} yield`
          : `Maintain ${label} funding — ${sharePct}% of funds, ${yld} yield`,
        reason: `${ugx(spend)} (${sharePct}% of activity spend); ${Math.round(verifiedRate)}% verified${improvementRate != null ? `, ${Math.round(improvementRate)}% of schools improved` : ', impact not yet measurable'}.`,
        riskLevel: YIELD_RISK[yld], impactYield: yld,
        confidenceLevel: conf.level, confidenceScore: conf.score,
        amountAffected: spend,
        financialImplication: lowYield ? `Up to ${ugx(spend)} could be reallocated to higher-yield work.` : 'Spend is producing verified results — sustain it.',
        suggestedAction: lowYield
          ? 'Require evidence/verification cleanup and consider shifting funds to higher-yield activity types or core schools.'
          : 'Continue funding; monitor verification + SSA impact.',
        alternatives: ['Continue funding', 'Increase funding', 'Reduce funding', 'Reassign funds', 'Hold until evidence verified'],
        metrics: { spend, sharePct, verifiedRate, improvementRate, count: rows.length },
        riskFlags: [verifiedRate < 60 ? 'low-verification' : '', improvementRate != null && improvementRate < 40 ? 'weak-impact' : ''].filter(Boolean),
        evidence: [
          { metricName: 'Spend', metricValue: ugx(spend), tone: 'green' },
          { metricName: 'Share of activity funds', metricValue: `${sharePct}%` },
          { metricName: 'Verified completion', metricValue: `${Math.round(verifiedRate)}%`, tone: verifiedRate < 60 ? 'red' : 'green' },
          { metricName: 'SSA improvement', metricValue: improvementRate == null ? 'Insufficient data' : `${Math.round(improvementRate)}%`, tone: improvementRate == null ? 'amber' : improvementRate < 40 ? 'red' : 'green' },
        ],
      });
    }
    return out;
  }

  // Spend by partner — cost vs assigned-intervention impact (measured only on
  // the partner's own assigned work).
  private byPartner(acts: ActivityRow[], rates: RateCard, prevFy: string, fy: string): InsightDraft[] {
    const groups = new Map<string, { name: string; rows: ActivityRow[] }>();
    for (const a of acts) {
      if (!a.assignedPartnerId) continue;
      const e = groups.get(a.assignedPartnerId) ?? { name: a.assignedPartner?.name ?? 'Partner', rows: [] };
      e.rows.push(a); groups.set(a.assignedPartnerId, e);
    }
    const out: InsightDraft[] = [];
    for (const [partnerId, g] of groups) {
      if (g.rows.length < 2) continue;
      const spend = g.rows.reduce((s, a) => s + this.costOf(a, rates), 0);
      const paidSpend = g.rows.filter((a) => a.paymentStatus === 'paid').reduce((s, a) => s + this.costOf(a, rates), 0);
      const verifiedRate = clamp100(pct(g.rows.filter((a) => this.verified(a)).length, g.rows.length));
      const improvementRate = this.improvement(g.rows, prevFy, fy);
      const conf = combineConfidence([
        { label: 'Assigned volume', ratio: Math.min(1, g.rows.length / 6), weight: 1 },
        { label: 'Verification data', ratio: 1, weight: 1 },
        { label: 'SSA impact data', ratio: improvementRate != null ? 1 : 0, weight: 1 },
      ]);
      const yld = yieldFromScore(verifiedRate, improvementRate, conf.level);
      const lowYield = yld === ImpactYield.low;
      out.push({
        insightType: 'partner',
        scopeType: ScopeType.partner, scopeId: partnerId, scopeName: g.name,
        recommendation: lowYield
          ? `Reassign / hold funds for ${g.name} — low financial yield`
          : yld === ImpactYield.high ? `Increase funding for ${g.name} — high yield` : `Maintain funding for ${g.name}`,
        reason: `${ugx(spend)} allocated (${ugx(paidSpend)} paid); ${Math.round(verifiedRate)}% verified${improvementRate != null ? `, ${Math.round(improvementRate)}% of supported schools improved` : ', impact not yet measurable'}.`,
        riskLevel: YIELD_RISK[yld], impactYield: yld,
        confidenceLevel: conf.level, confidenceScore: conf.score,
        amountAffected: spend,
        financialImplication: lowYield ? `Reassigning ${g.name}'s ${ugx(spend)} to a higher-yield partner or staff-led work may raise impact per shilling.` : 'Partner spend is producing verified results.',
        suggestedAction: lowYield
          ? 'Convene a partner finance review — hold new assignments until evidence is verified; do NOT auto-terminate.'
          : 'Maintain or increase funding; keep monitoring assigned-intervention impact.',
        alternatives: ['Maintain partner funding', 'Increase partner funding', 'Reduce assignment volume', 'Pause new assignments', 'Reassign funds to higher-yield partner', 'Require improvement plan'],
        metrics: { spend, paidSpend, verifiedRate, improvementRate, assigned: g.rows.length },
        riskFlags: [verifiedRate < 60 ? 'low-verification' : '', improvementRate != null && improvementRate < 40 ? 'weak-impact' : ''].filter(Boolean),
        evidence: [
          { metricName: 'Allocated', metricValue: ugx(spend) },
          { metricName: 'Paid', metricValue: ugx(paidSpend) },
          { metricName: 'Verified completion', metricValue: `${Math.round(verifiedRate)}%`, tone: verifiedRate < 60 ? 'red' : 'green' },
          { metricName: 'Assigned-intervention impact', metricValue: improvementRate == null ? 'Insufficient data' : `${Math.round(improvementRate)}%`, tone: improvementRate == null ? 'amber' : improvementRate < 40 ? 'red' : 'green' },
        ],
      });
    }
    return out;
  }

  // Spend by region — where is investment producing improvement?
  private byRegion(acts: ActivityRow[], rates: RateCard, prevFy: string, fy: string): InsightDraft[] {
    const groups = new Map<string, { name: string; rows: ActivityRow[] }>();
    for (const a of acts) {
      const rid = a.school?.regionId;
      if (!rid) continue;
      const e = groups.get(rid) ?? { name: a.school?.region?.name ?? 'Region', rows: [] };
      e.rows.push(a); groups.set(rid, e);
    }
    const out: InsightDraft[] = [];
    for (const [regionId, g] of groups) {
      if (g.rows.length < 3) continue;
      const spend = g.rows.reduce((s, a) => s + this.costOf(a, rates), 0);
      const verifiedRate = clamp100(pct(g.rows.filter((a) => this.verified(a)).length, g.rows.length));
      const improvementRate = this.improvement(g.rows, prevFy, fy);
      const conf = combineConfidence([
        { label: 'Activity volume', ratio: 1, weight: 1 },
        { label: 'Verification data', ratio: 1, weight: 1 },
        { label: 'SSA impact data', ratio: improvementRate != null ? 1 : 0, weight: 1 },
      ]);
      const yld = yieldFromScore(verifiedRate, improvementRate, conf.level);
      const healthPct = verifiedRate * 0.5 + (improvementRate ?? 50) * 0.5;
      out.push({
        insightType: 'regional',
        scopeType: ScopeType.region, scopeId: regionId, scopeName: g.name,
        recommendation: yld === ImpactYield.low || yld === ImpactYield.weak
          ? `Tighten spend in ${g.name} — focus funds on verification + improvement`
          : `${g.name} spend is productive — sustain or expand`,
        reason: `${ugx(spend)} this FY; ${Math.round(verifiedRate)}% verified${improvementRate != null ? `, ${Math.round(improvementRate)}% improving` : ''}.`,
        riskLevel: riskFromHealth(healthPct), impactYield: yld,
        confidenceLevel: conf.level, confidenceScore: conf.score,
        amountAffected: spend,
        suggestedAction: yld === ImpactYield.low || yld === ImpactYield.weak
          ? 'Hold expansion; direct funds to SSA completion, evidence cleanup, and follow-up.'
          : 'Sustain investment; consider expansion where capacity allows.',
        alternatives: ['Continue funding', 'Increase funding', 'Focus on SSA', 'Hold until evidence verified', 'Shift to core schools'],
        metrics: { spend, verifiedRate, improvementRate, activities: g.rows.length },
        riskFlags: [verifiedRate < 60 ? 'low-verification' : ''].filter(Boolean),
        evidence: [
          { metricName: 'Regional spend', metricValue: ugx(spend) },
          { metricName: 'Verified completion', metricValue: `${Math.round(verifiedRate)}%`, tone: verifiedRate < 60 ? 'red' : 'green' },
          { metricName: 'SSA improvement', metricValue: improvementRate == null ? 'Insufficient data' : `${Math.round(improvementRate)}%`, tone: improvementRate == null ? 'amber' : 'green' },
        ],
      });
    }
    return out;
  }

  // Country monthly/FY summary — planned vs verified spend + overall yield.
  private country(acts: ActivityRow[], rates: RateCard): InsightDraft {
    const planned = acts.reduce((s, a) => s + this.costOf(a, rates), 0);
    const verifiedSpend = acts.filter((a) => this.verified(a)).reduce((s, a) => s + this.costOf(a, rates), 0);
    const paidSpend = acts.filter((a) => a.paymentStatus === 'paid').reduce((s, a) => s + this.costOf(a, rates), 0);
    const verifiedRate = clamp100(pct(verifiedSpend, planned || 1));
    const level = levelFromScore(acts.length ? 80 : 0);
    const yld = yieldFromScore(verifiedRate, null, level);
    return {
      insightType: 'monthly',
      scopeType: ScopeType.country, scopeId: null, scopeName: 'Uganda (country)',
      recommendation: `Country budget yield: ${yld} — ${Math.round(verifiedRate)}% of planned spend is verified`,
      reason: `Planned ${ugx(planned)}; verified ${ugx(verifiedSpend)}; paid ${ugx(paidSpend)}.`,
      riskLevel: YIELD_RISK[yld], impactYield: yld,
      confidenceLevel: level, confidenceScore: acts.length ? 80 : 0,
      amountAffected: planned,
      financialImplication: `Unverified planned spend ≈ ${ugx(planned - verifiedSpend)} — chase verification before it ages.`,
      suggestedAction: 'Prioritise verification + accountability cleanup on the largest unverified lines before new disbursement.',
      alternatives: ['Continue', 'Hold disbursement', 'Focus verification', 'Reallocate to high-yield work'],
      metrics: { planned, verifiedSpend, paidSpend, verifiedRate, activities: acts.length },
      riskFlags: [verifiedRate < 50 ? 'verification-backlog' : ''].filter(Boolean),
      evidence: [
        { metricName: 'Planned spend', metricValue: ugx(planned) },
        { metricName: 'Verified spend', metricValue: ugx(verifiedSpend), tone: verifiedRate < 50 ? 'red' : 'green' },
        { metricName: 'Paid', metricValue: ugx(paidSpend) },
      ],
    };
  }

  private async persist(fy: string, d: InsightDraft): Promise<void> {
    const existing = await this.prisma.budgetIntelligenceInsight.findFirst({
      where: { fy, insightType: d.insightType, scopeType: d.scopeType, scopeId: d.scopeId },
      select: { id: true },
    });
    const common = {
      scopeName: d.scopeName,
      recommendation: d.recommendation, reason: d.reason, riskLevel: d.riskLevel,
      impactYield: d.impactYield, confidenceLevel: d.confidenceLevel, confidenceScore: d.confidenceScore,
      amountAffected: d.amountAffected, financialImplication: d.financialImplication ?? null,
      suggestedAction: d.suggestedAction,
      evidenceSummary: d.evidence.slice(0, 4) as unknown as Prisma.InputJsonValue,
      alternatives: d.alternatives as unknown as Prisma.InputJsonValue,
      metrics: d.metrics as Prisma.InputJsonValue,
      riskFlags: d.riskFlags, generatedAt: new Date(),
    };
    if (existing) {
      await this.prisma.budgetIntelligenceInsight.update({ where: { id: existing.id }, data: common });
    } else {
      await this.prisma.budgetIntelligenceInsight.create({
        data: { fy, periodType: 'fy', period: fy, insightType: d.insightType, scopeType: d.scopeType, scopeId: d.scopeId, ...common },
      });
    }
  }

  // ── Read facade ──────────────────────────────────────────────────────────
  async boards(_user: AuthUser, q: { fy?: string; insightType?: string; impactYield?: string; riskLevel?: string }) {
    const fy = q.fy ?? getOperationalFY();
    const where: Prisma.BudgetIntelligenceInsightWhereInput = { fy };
    if (q.insightType) where.insightType = q.insightType;
    if (q.impactYield) where.impactYield = q.impactYield as ImpactYield;
    if (q.riskLevel) where.riskLevel = q.riskLevel as DecisionRiskLevel;
    const insights = await this.prisma.budgetIntelligenceInsight.findMany({
      where, orderBy: [{ riskLevel: 'desc' }, { amountAffected: 'desc' }, { generatedAt: 'desc' }], take: 500,
    });
    return { fy, insights };
  }

  async snapshot(_user: AuthUser, fy = getOperationalFY()) {
    const rows = await this.prisma.budgetIntelligenceInsight.findMany({ where: { fy }, select: { impactYield: true, amountAffected: true, riskLevel: true, insightType: true, recommendation: true } });
    const lowYield = rows.filter((r) => r.impactYield === 'low' || r.impactYield === 'weak');
    const amountAtRisk = lowYield.reduce((s, r) => s + (r.amountAffected ?? 0), 0);
    const country = rows.find((r) => r.insightType === 'monthly');
    return {
      fy,
      totalInsights: rows.length,
      lowYieldCount: lowYield.length,
      highYieldCount: rows.filter((r) => r.impactYield === 'high').length,
      amountAtRisk,
      headline: country?.recommendation ?? (lowYield.length ? `${lowYield.length} low-yield funding lines (~${ugx(amountAtRisk)}) need review.` : 'No low-yield funding lines this period.'),
    };
  }

  async getInsight(_user: AuthUser, id: string) {
    const insight = await this.prisma.budgetIntelligenceInsight.findUnique({ where: { id }, include: { notes: { orderBy: { createdAt: 'desc' } } } });
    if (!insight) throw new NotFoundException('Budget insight not found');
    return insight;
  }

  async review(user: AuthUser, id: string, status: string, note?: string) {
    if (!REVIEWABLE_STATUSES.includes(status as DecisionStatus)) throw new BadRequestException('Invalid review status.');
    const insight = await this.prisma.budgetIntelligenceInsight.findUnique({ where: { id }, select: { id: true } });
    if (!insight) throw new NotFoundException('Budget insight not found');
    const updated = await this.prisma.budgetIntelligenceInsight.update({
      where: { id },
      data: {
        status: status as DecisionStatus, reviewedByUserId: user.userId, reviewedByRole: user.activeRole,
        reviewedAt: new Date(), reviewNote: note ?? null,
        notes: { create: { authorUserId: user.userId, authorRole: user.activeRole, note: note ?? `Marked ${status}`, kind: 'decision' } },
      },
    });
    await this.audit.log({ action: 'budgetIntelligence.review', subjectKind: 'BudgetIntelligenceInsight', subjectId: id, actorId: user.userId, actorRole: user.activeRole, payload: { status } });
    return { id: updated.id, status: updated.status };
  }

  async addNote(user: AuthUser, id: string, note: string, kind = 'note') {
    if (!note?.trim()) throw new BadRequestException('A note is required.');
    const insight = await this.prisma.budgetIntelligenceInsight.findUnique({ where: { id }, select: { id: true } });
    if (!insight) throw new NotFoundException('Budget insight not found');
    const created = await this.prisma.financeDecisionNote.create({ data: { insightId: id, authorUserId: user.userId, authorRole: user.activeRole, note: note.trim(), kind } });
    await this.audit.log({ action: 'budgetIntelligence.note', subjectKind: 'BudgetIntelligenceInsight', subjectId: id, actorId: user.userId, actorRole: user.activeRole, payload: { kind } });
    return { id: created.id };
  }

  async memo(user: AuthUser, id: string) {
    const insight = await this.getInsight(user, id);
    return {
      insightType: insight.insightType, scope: insight.scopeName ?? insight.scopeType,
      recommendation: insight.recommendation, reason: insight.reason,
      amountAffected: insight.amountAffected, impactYield: insight.impactYield,
      confidence: { level: insight.confidenceLevel, score: insight.confidenceScore },
      riskLevel: insight.riskLevel, financialImplication: insight.financialImplication,
      evidence: insight.evidenceSummary, metrics: insight.metrics, alternatives: insight.alternatives,
      suggestedAction: insight.suggestedAction, status: insight.status,
      reviewedBy: insight.reviewedByUserId, reviewedAt: insight.reviewedAt, generatedAt: insight.generatedAt,
      disclaimer: 'Engine recommendation — requires human finance/leadership decision. No funds move automatically.',
    };
  }
}
