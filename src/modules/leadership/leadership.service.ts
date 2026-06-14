import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DecisionStatus, DecisionType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ScopeService } from '../../common/scope/scope.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';
import { getOperationalFY } from '../../common/fy/fy.util';
import { LeadershipEngineService } from './leadership-engine.service';
import { boardsForRole, canReviewBoard } from './leadership.types';

export interface BoardsQuery {
  fy?: string;
  decisionType?: string;
  riskLevel?: string;
  confidenceLevel?: string;
  scopeType?: string;
  scopeId?: string;
  status?: string;
}

const REVIEWABLE_STATUSES: DecisionStatus[] = [
  'under_review', 'accepted', 'accepted_with_conditions', 'rejected', 'deferred', 'converted_to_action_plan',
];

// Read + human-review facade over the engine. Enforces role-tailored board
// visibility + supervised-scope narrowing, and records every review/note in the
// audit trail. The engine recommends; this layer is where leadership DECIDES.
@Injectable()
export class LeadershipService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly engine: LeadershipEngineService,
  ) {}

  recompute(fy?: string) {
    return this.engine.recompute(fy ?? getOperationalFY());
  }

  /** Role-tailored, scope-narrowed decision boards grouped by decision type. */
  async boards(user: AuthUser, q: BoardsQuery) {
    const fy = q.fy ?? getOperationalFY();
    const allowed = boardsForRole(user.activeRole);
    const requested = q.decisionType ? [q.decisionType as DecisionType] : allowed;
    const types = requested.filter((t) => allowed.includes(t));
    if (!types.length) return { fy, boards: [] as unknown[], visibleBoards: allowed };

    const where: Prisma.LeadershipDecisionInsightWhereInput = { fy, decisionType: { in: types } };
    if (q.riskLevel) where.riskLevel = q.riskLevel as Prisma.LeadershipDecisionInsightWhereInput['riskLevel'];
    if (q.confidenceLevel) where.confidenceLevel = q.confidenceLevel as Prisma.LeadershipDecisionInsightWhereInput['confidenceLevel'];
    if (q.status) where.status = q.status as Prisma.LeadershipDecisionInsightWhereInput['status'];
    if (q.scopeType) where.scopeType = q.scopeType as Prisma.LeadershipDecisionInsightWhereInput['scopeType'];
    if (q.scopeId) where.scopeId = q.scopeId;

    // Supervised-scope narrowing: a PL only sees staff_hr for staff they supervise.
    const scope = await this.scope.resolveUserScope(user);
    if (!scope.countryScope && user.activeRole === 'CountryProgramLead' && (types.includes('staff_hr'))) {
      where.OR = [
        { decisionType: { not: 'staff_hr' } },
        { decisionType: 'staff_hr', scopeId: { in: scope.supervisedStaffIds.length ? scope.supervisedStaffIds : ['__none__'] } },
      ];
    }

    const rows = await this.prisma.leadershipDecisionInsight.findMany({
      where,
      orderBy: [{ riskLevel: 'desc' }, { confidenceScore: 'desc' }, { generatedAt: 'desc' }],
      include: { evidencePoints: true, _count: { select: { notes: true } } },
      take: 500,
    });

    const grouped = types.map((t) => ({
      decisionType: t,
      canReview: canReviewBoard(user.activeRole, t),
      insights: rows.filter((r) => r.decisionType === t),
    }));
    return { fy, visibleBoards: allowed, boards: grouped };
  }

  /** Leadership Decision Snapshot — the top-of-page executive summary. */
  async snapshot(user: AuthUser, fy = getOperationalFY()) {
    const allowed = boardsForRole(user.activeRole);
    const rows = await this.prisma.leadershipDecisionInsight.findMany({
      where: { fy, decisionType: { in: allowed.length ? allowed : ['recruitment'] } },
      select: { decisionType: true, recommendation: true, riskLevel: true, confidenceScore: true, scopeName: true, riskFlags: true, metrics: true },
      take: 1000,
    });
    const has = (t: DecisionType) => rows.filter((r) => r.decisionType === t);
    const regionsToExpand = has('regional_investment').filter((r) => /expand|healthy/i.test(r.recommendation)).map((r) => r.scopeName);
    const regionsToPause = has('recruitment').filter((r) => /pause/i.test(r.recommendation)).map((r) => r.scopeName);
    const staffOverload = has('staff_hr').filter((r) => r.riskFlags.includes('high-workload')).length;
    const partnerMouRisk = has('partner').filter((r) => /non-renewal|improvement plan|pause/i.test(r.recommendation)).length;
    const partnerCapacityGaps = has('staff_addition').filter((r) => /partner/i.test(r.recommendation)).length;
    const avgConfidence = rows.length ? Math.round(rows.reduce((s, r) => s + r.confidenceScore, 0) / rows.length) : 0;
    const criticalCount = rows.filter((r) => r.riskLevel === 'critical' || r.riskLevel === 'high').length;

    const headlineBits: string[] = [];
    if (regionsToPause.length) headlineBits.push(`pause recruitment in ${regionsToPause.length} area(s)`);
    if (partnerCapacityGaps) headlineBits.push(`add partner capacity in ${partnerCapacityGaps} region(s)`);
    if (partnerMouRisk) headlineBits.push(`review ${partnerMouRisk} partner MOU(s)`);
    if (staffOverload) headlineBits.push(`support ${staffOverload} overloaded staff`);
    const strategicHeadline = headlineBits.length
      ? `Recommended: ${headlineBits.join(', ')} before next quarter.`
      : 'No high-risk leadership actions detected for this period.';

    return {
      fy,
      strategicHeadline,
      regionsReadyToExpand: regionsToExpand,
      regionsToPauseRecruitment: regionsToPause,
      staffOverloadRisks: staffOverload,
      partnerMouRisks: partnerMouRisk,
      partnerCapacityGaps,
      dataConfidence: avgConfidence,
      highRiskDecisions: criticalCount,
      totalInsights: rows.length,
    };
  }

  async getInsight(user: AuthUser, id: string) {
    const insight = await this.prisma.leadershipDecisionInsight.findUnique({
      where: { id },
      include: { evidencePoints: true, notes: { orderBy: { createdAt: 'desc' } } },
    });
    if (!insight) throw new NotFoundException('Insight not found');
    if (!boardsForRole(user.activeRole).includes(insight.decisionType)) {
      throw new ForbiddenException('This decision board is not available for your role.');
    }
    return insight;
  }

  async review(user: AuthUser, id: string, status: string, note?: string) {
    const insight = await this.prisma.leadershipDecisionInsight.findUnique({ where: { id }, select: { id: true, decisionType: true, recommendation: true } });
    if (!insight) throw new NotFoundException('Insight not found');
    if (!canReviewBoard(user.activeRole, insight.decisionType)) {
      throw new ForbiddenException('You may not review decisions on this board.');
    }
    if (!REVIEWABLE_STATUSES.includes(status as DecisionStatus)) {
      throw new BadRequestException('Invalid review status.');
    }
    const updated = await this.prisma.leadershipDecisionInsight.update({
      where: { id },
      data: {
        status: status as DecisionStatus,
        reviewedByUserId: user.userId,
        reviewedByRole: user.activeRole,
        reviewedAt: new Date(),
        reviewNote: note ?? null,
        notes: { create: { authorUserId: user.userId, authorRole: user.activeRole, note: note ?? `Marked ${status}`, kind: 'decision' } },
      },
    });
    await this.audit.log({
      action: 'leadership.review', subjectKind: 'LeadershipDecisionInsight', subjectId: id,
      actorId: user.userId, actorRole: user.activeRole, payload: { status, decisionType: insight.decisionType },
    });
    return { id: updated.id, status: updated.status };
  }

  async addNote(user: AuthUser, id: string, note: string, kind = 'note') {
    if (!note?.trim()) throw new BadRequestException('A note is required.');
    const insight = await this.prisma.leadershipDecisionInsight.findUnique({ where: { id }, select: { id: true, decisionType: true } });
    if (!insight) throw new NotFoundException('Insight not found');
    if (!boardsForRole(user.activeRole).includes(insight.decisionType)) {
      throw new ForbiddenException('This decision board is not available for your role.');
    }
    const created = await this.prisma.decisionNote.create({
      data: { insightId: id, authorUserId: user.userId, authorRole: user.activeRole, note: note.trim(), kind },
    });
    await this.audit.log({
      action: 'leadership.note', subjectKind: 'LeadershipDecisionInsight', subjectId: id,
      actorId: user.userId, actorRole: user.activeRole, payload: { kind },
    });
    return { id: created.id };
  }

  /** Structured decision memo for CD/RVP/board/HR/partner-review meetings. */
  async memo(user: AuthUser, id: string) {
    const insight = await this.getInsight(user, id);
    return {
      decisionType: insight.decisionType,
      scope: insight.scopeName ?? insight.scopeType,
      recommendation: insight.recommendation,
      reason: insight.reason,
      evidence: insight.evidencePoints.map((e) => ({ metric: e.metricName, value: e.metricValue, comparison: e.comparisonValue, note: e.explanation })),
      metrics: insight.metrics,
      contextAdjustment: insight.contextAdjustment,
      confidence: { level: insight.confidenceLevel, score: insight.confidenceScore },
      riskLevel: insight.riskLevel,
      financialImplication: insight.financialImplication,
      alternatives: insight.alternatives,
      suggestedAction: insight.suggestedAction,
      status: insight.status,
      reviewedBy: insight.reviewedByUserId,
      reviewedAt: insight.reviewedAt,
      generatedAt: insight.generatedAt,
      disclaimer: 'Engine recommendation — requires human leadership decision. No action is executed automatically.',
    };
  }
}
