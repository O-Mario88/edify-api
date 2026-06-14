import { Injectable } from '@nestjs/common';
import {
  DecisionConfidenceLevel,
  DecisionRiskLevel,
  DecisionType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { getOperationalFY } from '../../common/fy/fy.util';
import { DONE_STATUSES, PLANNED_EXCLUDE } from '../targets/targets-config';
import { ContextFairnessService } from './context-fairness.service';
import { DataConfidenceService } from './data-confidence.service';
import { PartnerPerformanceService, PartnerPerfRow } from './partner-performance.service';
import {
  clamp100,
  combineConfidence,
  levelFromScore,
  pct,
  riskFromHealth,
} from './leadership.types';

interface EvidenceDraft {
  metricName: string;
  metricValue: string;
  comparisonValue?: string;
  sourceType: string;
  explanation?: string;
  weight?: 'primary' | 'supporting' | 'context';
  tone?: 'red' | 'amber' | 'green';
}

interface InsightDraft {
  decisionType: DecisionType;
  scopeType: Prisma.LeadershipDecisionInsightCreateInput['scopeType'];
  scopeId: string | null;
  scopeName: string | null;
  recommendation: string;
  reason: string;
  riskLevel: DecisionRiskLevel;
  confidenceLevel: DecisionConfidenceLevel;
  confidenceScore: number;
  contextAdjustment?: string | null;
  financialImplication?: string | null;
  suggestedAction: string;
  alternatives: string[];
  metrics: Record<string, unknown>;
  riskFlags: string[];
  evidence: EvidenceDraft[];
}

// The Leadership Decision Engine orchestrator. Recompute generates evidence-
// backed drafts for all five boards; persistence PRESERVES the human-review
// layer (status, reviewer, notes) so the engine refreshes analysis without
// erasing leadership decisions. NOTHING here executes an action — it only
// recommends. Spec: "The engine recommends. Leadership decides."
@Injectable()
export class LeadershipEngineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly confidence: DataConfidenceService,
    private readonly context: ContextFairnessService,
    private readonly partnerPerf: PartnerPerformanceService,
  ) {}

  // ── Recompute ─────────────────────────────────────────────────────────────
  async recompute(fy = getOperationalFY()): Promise<{ fy: string; generated: number; boards: Record<string, number> }> {
    await this.context.computeAll(fy);
    const partnerRows = await this.partnerPerf.computeAll(fy);

    const drafts: InsightDraft[] = [];
    drafts.push(...(await this.recruitmentDrafts(fy)));
    drafts.push(...(await this.regionalInvestmentDrafts(fy)));
    drafts.push(...this.partnerDrafts(partnerRows));
    drafts.push(...(await this.staffHrDrafts(fy)));
    drafts.push(...(await this.staffAdditionDrafts(fy)));

    const boards: Record<string, number> = {};
    for (const d of drafts) {
      await this.persistDraft(fy, d);
      boards[d.decisionType] = (boards[d.decisionType] ?? 0) + 1;
    }
    return { fy, generated: drafts.length, boards };
  }

  /** Upsert by (fy, decisionType, scopeType, scopeId), preserving human review. */
  private async persistDraft(fy: string, d: InsightDraft): Promise<void> {
    const existing = await this.prisma.leadershipDecisionInsight.findFirst({
      where: { fy, decisionType: d.decisionType, scopeType: d.scopeType, scopeId: d.scopeId },
      select: { id: true },
    });
    const data = {
      recommendation: d.recommendation,
      reason: d.reason,
      riskLevel: d.riskLevel,
      confidenceLevel: d.confidenceLevel,
      confidenceScore: d.confidenceScore,
      evidenceSummary: d.evidence.slice(0, 3) as unknown as Prisma.InputJsonValue,
      contextAdjustment: d.contextAdjustment ?? null,
      financialImplication: d.financialImplication ?? null,
      suggestedAction: d.suggestedAction,
      alternatives: d.alternatives as unknown as Prisma.InputJsonValue,
      metrics: d.metrics as Prisma.InputJsonValue,
      riskFlags: d.riskFlags,
      scopeName: d.scopeName,
      generatedAt: new Date(),
    };
    if (existing) {
      await this.prisma.leadershipDecisionInsight.update({ where: { id: existing.id }, data });
      await this.prisma.decisionEvidencePoint.deleteMany({ where: { insightId: existing.id } });
      await this.prisma.decisionEvidencePoint.createMany({
        data: d.evidence.map((e) => ({ ...e, insightId: existing.id })),
      });
    } else {
      const created = await this.prisma.leadershipDecisionInsight.create({
        data: {
          fy,
          decisionType: d.decisionType,
          scopeType: d.scopeType,
          scopeId: d.scopeId,
          ...data,
          evidencePoints: { create: d.evidence },
        },
        select: { id: true },
      });
      void created;
    }
  }

  // ── Board: Recruitment (per district + country) ────────────────────────────
  private async recruitmentDrafts(fy: string): Promise<InsightDraft[]> {
    const prevFy = String(Number(fy) - 1);
    const schools = await this.prisma.school.findMany({
      where: { deletedAt: null },
      select: {
        id: true, districtId: true, district: { select: { name: true } },
        currentFySsaStatus: true, clusterStatus: true, accountOwnerStatus: true,
        ssaRecords: { where: { deletedAt: null, fy: { in: [prevFy, fy] } }, select: { fy: true, averageScore: true } },
      },
      take: 8000,
    });
    if (!schools.length) return [];

    const byDistrict = new Map<string, { name: string; rows: typeof schools }>();
    for (const s of schools) {
      const e = byDistrict.get(s.districtId) ?? { name: s.district?.name ?? s.districtId, rows: [] as typeof schools };
      e.rows.push(s);
      byDistrict.set(s.districtId, e);
    }

    const drafts: InsightDraft[] = [];
    // Per-district drafts + a country roll-up.
    const groups: { scopeType: InsightDraft['scopeType']; scopeId: string | null; name: string; rows: typeof schools }[] = [
      ...[...byDistrict.entries()].map(([id, g]) => ({ scopeType: 'district' as const, scopeId: id, name: g.name, rows: g.rows })),
      { scopeType: 'country' as const, scopeId: null, name: 'Uganda (country)', rows: schools },
    ];

    for (const g of groups) {
      if (g.rows.length < 5 && g.scopeType === 'district') continue; // skip thin districts
      drafts.push(this.recruitmentDraft(g.scopeType, g.scopeId, g.name, g.rows, prevFy, fy));
    }
    return drafts;
  }

  private recruitmentDraft(
    scopeType: InsightDraft['scopeType'],
    scopeId: string | null,
    name: string,
    rows: { currentFySsaStatus: string; clusterStatus: string; accountOwnerStatus: string; ssaRecords: { fy: string; averageScore: number | null }[] }[],
    prevFy: string,
    fy: string,
  ): InsightDraft {
    const total = rows.length;
    const withSsa = rows.filter((s) => s.currentFySsaStatus === 'done').length;
    const missingSsa = total - withSsa;
    const unclustered = rows.filter((s) => s.clusterStatus !== 'clustered').length;
    const owned = rows.filter((s) => s.accountOwnerStatus === 'matched').length;
    const ssaCompletionRate = clamp100(pct(withSsa, total));

    // Impact: prev→curr improvement among schools with both SSAs.
    const pairs = rows
      .map((s) => ({
        prev: s.ssaRecords.find((r) => r.fy === prevFy)?.averageScore,
        curr: s.ssaRecords.find((r) => r.fy === fy)?.averageScore,
      }))
      .filter((p) => p.prev != null && p.curr != null);
    const impactRate = pairs.length >= 3 ? clamp100(pct(pairs.filter((p) => (p.curr as number) - (p.prev as number) > 0.05).length, pairs.length)) : null;

    const conf = combineConfidence([
      { label: 'SSA completion', ratio: withSsa / total, weight: 2 },
      { label: 'Prev-FY SSA (impact)', ratio: rows.filter((s) => s.ssaRecords.some((r) => r.fy === prevFy)).length / total, weight: 1.5 },
      { label: 'Ownership mapped', ratio: owned / total, weight: 1 },
    ]);

    // Recommendation logic (spec School Recruitment Decision Board).
    let recommendation: string;
    let suggestedAction: string;
    const alternatives = ['Recruit more schools', 'Recruit selectively', 'Pause recruitment', 'Focus on current schools', 'Recruit only after SSA backlog is reduced'];
    const ssaWeak = ssaCompletionRate < 70;
    const impactWeak = impactRate != null && impactRate < 50;
    const clusterWeak = pct(unclustered, total) > 30;

    if (conf.level === 'insufficient') {
      recommendation = `Insufficient data for a strong recruitment decision in ${name}`;
      suggestedAction = 'Complete SSA + ownership data before deciding on recruitment.';
    } else if (ssaWeak || impactWeak || clusterWeak) {
      recommendation = `Pause new school recruitment in ${name}`;
      suggestedAction = 'Focus on SSA completion, clustering, and follow-up of current schools before recruiting.';
    } else if (ssaCompletionRate >= 85 && (impactRate == null || impactRate >= 60)) {
      recommendation = `Recruit more schools in ${name}`;
      suggestedAction = 'Capacity and impact support expansion — proceed with recruitment, monitoring workload.';
    } else {
      recommendation = `Recruit selectively in ${name}`;
      suggestedAction = 'Recruit only where support capacity and SSA completion are strong.';
    }

    const healthPct = (ssaCompletionRate * 0.5) + ((impactRate ?? 50) * 0.3) + ((100 - pct(unclustered, total)) * 0.2);
    const evidence: EvidenceDraft[] = [
      { metricName: 'Current-FY SSA completion', metricValue: `${Math.round(ssaCompletionRate)}%`, sourceType: 'ssa', weight: 'primary', tone: ssaWeak ? 'red' : 'green' },
      { metricName: 'Schools missing SSA', metricValue: `${missingSsa}`, comparisonValue: `${total} total`, sourceType: 'ssa', weight: 'supporting', tone: missingSsa > 0 ? 'amber' : 'green' },
      { metricName: 'Schools unclustered', metricValue: `${unclustered}`, sourceType: 'cluster', weight: 'supporting', tone: clusterWeak ? 'red' : 'green' },
      { metricName: 'SSA improvement (prev→current)', metricValue: impactRate == null ? 'Insufficient data' : `${Math.round(impactRate)}% improved`, sourceType: 'ssa', weight: 'primary', tone: impactRate == null ? 'amber' : impactWeak ? 'red' : 'green' },
    ];

    // Persist a readiness profile alongside the insight (best-effort).
    void this.prisma.recruitmentReadinessProfile.upsert({
      where: { scopeType_scopeId_fy_quarter: { scopeType, scopeId: scopeId ?? '', fy, quarter: 'FY' } },
      update: { scopeName: name, ssaCompletionRate, schoolsTotal: total, schoolsMissingSsa: missingSsa, schoolsUnclustered: unclustered, impactScore: impactRate, dataQualityScore: conf.score, dataConfidence: conf.score, recruitmentRecommendation: recommendation, computedAt: new Date() },
      create: { scopeType, scopeId: scopeId ?? '', scopeName: name, fy, quarter: 'FY', ssaCompletionRate, schoolsTotal: total, schoolsMissingSsa: missingSsa, schoolsUnclustered: unclustered, impactScore: impactRate, dataQualityScore: conf.score, dataConfidence: conf.score, recruitmentRecommendation: recommendation },
    }).catch(() => undefined);

    return {
      decisionType: 'recruitment', scopeType, scopeId, scopeName: name,
      recommendation,
      reason: `${Math.round(ssaCompletionRate)}% of schools have current SSA, ${missingSsa} still missing it, ${unclustered} unclustered${impactRate != null ? `, ${Math.round(impactRate)}% improved year-on-year` : ', impact not yet measurable'}.`,
      riskLevel: riskFromHealth(healthPct),
      confidenceLevel: conf.level, confidenceScore: conf.score,
      suggestedAction, alternatives,
      metrics: { ssaCompletionRate, missingSsa, unclustered, impactRate, schoolsTotal: total },
      riskFlags: [ssaWeak ? 'ssa-backlog' : '', clusterWeak ? 'clustering-gap' : '', impactWeak ? 'weak-impact' : ''].filter(Boolean),
      evidence,
    };
  }

  // ── Board: Regional investment (per region) ────────────────────────────────
  private async regionalInvestmentDrafts(fy: string): Promise<InsightDraft[]> {
    const prevFy = String(Number(fy) - 1);
    const regions = await this.prisma.region.findMany({ select: { id: true, name: true } });
    const drafts: InsightDraft[] = [];
    for (const r of regions) {
      const schools = await this.prisma.school.findMany({
        where: { deletedAt: null, regionId: r.id },
        select: { id: true, currentFySsaStatus: true, accountOwnerId: true, ssaRecords: { where: { deletedAt: null, fy: { in: [prevFy, fy] } }, select: { fy: true, averageScore: true } } },
      });
      if (schools.length < 5) continue;
      const total = schools.length;
      const withSsa = schools.filter((s) => s.currentFySsaStatus === 'done').length;
      const owners = new Set(schools.map((s) => s.accountOwnerId).filter(Boolean)).size;
      const schoolsPerOwner = owners ? total / owners : total;
      const pairs = schools.map((s) => ({ prev: s.ssaRecords.find((x) => x.fy === prevFy)?.averageScore, curr: s.ssaRecords.find((x) => x.fy === fy)?.averageScore })).filter((p) => p.prev != null && p.curr != null);
      const impactRate = pairs.length >= 3 ? clamp100(pct(pairs.filter((p) => (p.curr as number) - (p.prev as number) > 0.05).length, pairs.length)) : null;
      const ssaCompletionRate = clamp100(pct(withSsa, total));

      const conf = combineConfidence([
        { label: 'SSA completion', ratio: withSsa / total, weight: 2 },
        { label: 'Ownership', ratio: owners ? 1 : 0, weight: 1 },
        { label: 'Prev-FY SSA', ratio: pairs.length >= 3 ? 1 : 0, weight: 1 },
      ]);

      const overloaded = schoolsPerOwner > 80;
      let recommendation: string;
      let suggestedAction: string;
      if (conf.level === 'insufficient') {
        recommendation = `Insufficient data to direct investment in ${r.name}`;
        suggestedAction = 'Complete SSA and ownership data for this region first.';
      } else if (overloaded) {
        recommendation = `Add field capacity in ${r.name} before further investment`;
        suggestedAction = 'Add staff or partner support — current portfolio load per owner is high.';
      } else if (ssaCompletionRate < 60 || (impactRate != null && impactRate < 45)) {
        recommendation = `Focus investment on SSA completion + improvement in ${r.name}`;
        suggestedAction = 'Prioritise SSA completion, cluster training, and follow-up over expansion.';
      } else {
        recommendation = `${r.name} is healthy enough to expand`;
        suggestedAction = 'Consider recruitment/expansion; monitor capacity.';
      }
      const healthPct = ssaCompletionRate * 0.5 + (impactRate ?? 50) * 0.3 + (overloaded ? 20 : 60) * 0.2;
      drafts.push({
        decisionType: 'regional_investment', scopeType: 'region', scopeId: r.id, scopeName: r.name,
        recommendation,
        reason: `${total} schools, ~${Math.round(schoolsPerOwner)} schools/owner, ${Math.round(ssaCompletionRate)}% SSA complete${impactRate != null ? `, ${Math.round(impactRate)}% improving` : ''}.`,
        riskLevel: riskFromHealth(healthPct), confidenceLevel: conf.level, confidenceScore: conf.score,
        contextAdjustment: overloaded ? 'High portfolio load per owner — capacity, not effort, is the limiter.' : null,
        financialImplication: overloaded ? 'Adding capacity has cost; under-investing risks SSA stagnation.' : null,
        suggestedAction,
        alternatives: ['Expand', 'Pause', 'Add staff', 'Add partner', 'Focus on SSA', 'Review staff workload'],
        metrics: { total, schoolsPerOwner: Math.round(schoolsPerOwner), ssaCompletionRate, impactRate, owners },
        riskFlags: [overloaded ? 'capacity-pressure' : '', ssaCompletionRate < 60 ? 'ssa-backlog' : ''].filter(Boolean),
        evidence: [
          { metricName: 'Schools per account owner', metricValue: `${Math.round(schoolsPerOwner)}`, sourceType: 'workload', weight: 'primary', tone: overloaded ? 'red' : 'green' },
          { metricName: 'SSA completion', metricValue: `${Math.round(ssaCompletionRate)}%`, sourceType: 'ssa', weight: 'supporting', tone: ssaCompletionRate < 60 ? 'red' : 'green' },
          { metricName: 'SSA improvement', metricValue: impactRate == null ? 'Insufficient data' : `${Math.round(impactRate)}%`, sourceType: 'ssa', weight: 'supporting', tone: impactRate == null ? 'amber' : 'green' },
        ],
      });
    }
    return drafts;
  }

  // ── Board: Partner (per partner with assignments) ──────────────────────────
  private partnerDrafts(rows: PartnerPerfRow[]): InsightDraft[] {
    const text: Record<string, { rec: (n: string) => string; action: string; risk: DecisionRiskLevel }> = {
      renew: { rec: (n) => `Renew partner MOU: ${n}`, action: 'Renew the MOU; performance and impact are strong.', risk: 'low' },
      renew_with_conditions: { rec: (n) => `Renew ${n} with conditions`, action: 'Renew with an improvement condition on weak interventions.', risk: 'medium' },
      improvement_plan: { rec: (n) => `Put ${n} on an improvement plan`, action: 'Create a partner improvement plan with measurable targets.', risk: 'high' },
      reduce_or_pause: { rec: (n) => `Pause new assignments to ${n}`, action: 'Pause/reduce assignment volume until backlog clears.', risk: 'high' },
      terminate_review: { rec: (n) => `Review ${n} MOU for non-renewal`, action: 'Convene a leadership review — do NOT auto-terminate. Multiple poor signals present.', risk: 'critical' },
      no_assignments: { rec: (n) => `${n}: no assignments this FY`, action: 'Assign work or consider coverage gap.', risk: 'low' },
      inactive: { rec: (n) => `${n} is inactive`, action: 'No action; partner is deactivated.', risk: 'low' },
    };
    return rows
      .filter((r) => r.assignedActivities > 0 || r.recommendationStatus === 'no_assignments')
      .map((r) => {
        const t = text[r.recommendationStatus] ?? text.improvement_plan;
        const level = levelFromScore(r.dataConfidence);
        return {
          decisionType: 'partner' as const, scopeType: 'partner' as const, scopeId: r.partnerId, scopeName: r.partnerName,
          recommendation: t.rec(r.partnerName),
          reason: `Completed ${Math.round(r.targetAchievementRate)}% of assignments, evidence acceptance ${Math.round(r.evidenceAcceptanceRate)}%${r.interventionImpactScore != null ? `, improved ${Math.round(r.interventionImpactScore)}% of supported schools` : ', impact not yet measurable'}.`,
          riskLevel: level === 'insufficient' ? 'medium' : t.risk,
          confidenceLevel: level, confidenceScore: r.dataConfidence,
          contextAdjustment: r.assignedInterventions.length ? `Measured only on assigned interventions: ${r.assignedInterventions.join(', ')}.` : 'No assigned interventions on record — measured on overall delivery only.',
          financialImplication: r.recommendationStatus === 'renew' ? 'Continued partner spend; impact justifies it.' : 'Review of partner spend recommended.',
          suggestedAction: t.action,
          alternatives: ['Renew', 'Renew with conditions', 'Improvement plan', 'Reduce volume', 'Pause assignments', 'Review for non-renewal', 'Reassign schools'],
          metrics: { targetAchievementRate: r.targetAchievementRate, evidenceAcceptanceRate: r.evidenceAcceptanceRate, iaConfirmationRate: r.iaConfirmationRate, interventionImpactScore: r.interventionImpactScore, overdueRate: r.overdueRate, capacityUtilization: r.capacityUtilization },
          riskFlags: [r.overdueRate > 30 ? 'overdue' : '', r.evidenceAcceptanceRate < 70 ? 'weak-evidence' : '', r.interventionImpactScore != null && r.interventionImpactScore < 40 ? 'weak-impact' : ''].filter(Boolean),
          evidence: [
            { metricName: 'Target achievement', metricValue: `${Math.round(r.targetAchievementRate)}%`, sourceType: 'targets', weight: 'primary', tone: r.targetAchievementRate < 50 ? 'red' : r.targetAchievementRate < 80 ? 'amber' : 'green' },
            { metricName: 'Evidence acceptance', metricValue: `${Math.round(r.evidenceAcceptanceRate)}%`, sourceType: 'partner', weight: 'supporting', tone: r.evidenceAcceptanceRate < 70 ? 'red' : 'green' },
            { metricName: 'Intervention impact', metricValue: r.interventionImpactScore == null ? 'Insufficient data' : `${Math.round(r.interventionImpactScore)}% improved`, sourceType: 'ssa', weight: 'primary', tone: r.interventionImpactScore == null ? 'amber' : r.interventionImpactScore < 40 ? 'red' : 'green' },
          ],
        };
      });
  }

  // ── Board: Staff & HR (per active staff, context-adjusted) ─────────────────
  private async staffHrDrafts(fy: string): Promise<InsightDraft[]> {
    const profiles = await this.prisma.staffContextProfile.findMany({
      where: { fy, quarter: 'FY' },
      select: {
        staffId: true, schoolLoad: true, coreSchoolLoad: true, partnerManagementLoad: true,
        districtSpread: true, distanceBurden: true, contextDifficultyScore: true, dataConfidence: true,
        staff: { select: { user: { select: { name: true } } } },
      },
    });
    const acts = await this.prisma.activity.findMany({
      where: { deletedAt: null, fy, responsibleStaffId: { not: null } },
      select: { responsibleStaffId: true, status: true, evidenceStatus: true },
    });
    const byStaff = new Map<string, { done: number; planned: number; evidenceOk: number; evidenceTotal: number }>();
    for (const a of acts) {
      const k = a.responsibleStaffId as string;
      const e = byStaff.get(k) ?? { done: 0, planned: 0, evidenceOk: 0, evidenceTotal: 0 };
      if (!PLANNED_EXCLUDE.includes(a.status)) e.planned += 1;
      if (DONE_STATUSES.includes(a.status)) e.done += 1;
      if (a.evidenceStatus !== 'none') { e.evidenceTotal += 1; if (a.evidenceStatus === 'accepted') e.evidenceOk += 1; }
      byStaff.set(k, e);
    }

    const drafts: InsightDraft[] = [];
    for (const p of profiles) {
      const name = p.staff?.user?.name ?? 'Staff member';
      const a = byStaff.get(p.staffId) ?? { done: 0, planned: 0, evidenceOk: 0, evidenceTotal: 0 };
      if (a.planned === 0) continue; // nothing to judge
      const rawAchievement = clamp100(pct(a.done, a.planned));
      const executionQuality = clamp100(pct(a.evidenceOk, a.evidenceTotal || 1));
      const difficulty = p.contextDifficultyScore; // 0..100
      // Context adjustment: high difficulty lifts how we READ a modest raw score.
      const adjusted = clamp100(rawAchievement + (difficulty * 0.25));

      const conf = combineConfidence([
        { label: 'Activity data', ratio: a.planned > 0 ? 1 : 0, weight: 2 },
        { label: 'Evidence data', ratio: a.evidenceTotal > 0 ? 1 : 0, weight: 1 },
        { label: 'Context (rural/travel)', ratio: p.dataConfidence / 100, weight: 1 },
      ]);

      let recommendation: string;
      let suggestedAction: string;
      let contextAdjustment: string;
      const highDifficulty = difficulty >= 60;
      if (rawAchievement >= 85 && executionQuality >= 85) {
        recommendation = `Recognize strong performance: ${name}`;
        suggestedAction = highDifficulty ? 'Promotion consideration — strong results under high difficulty.' : 'Recognize performance; consider mentoring role.';
        contextAdjustment = highDifficulty ? 'High-difficulty portfolio — results are especially strong in context.' : 'Standard-difficulty portfolio.';
      } else if (rawAchievement < 60 && highDifficulty) {
        // Fairness rule: do not punish difficulty. Support before PIP.
        recommendation = `Provide workload support: ${name} (not a PIP)`;
        suggestedAction = 'Rebalance schools / add partner support before any performance plan.';
        contextAdjustment = `Manages ${p.schoolLoad} schools across ${p.districtSpread} districts, ${p.coreSchoolLoad} core, ${p.partnerManagementLoad} partners — difficulty ${Math.round(difficulty)}/100.`;
      } else if (rawAchievement < 55 && !highDifficulty) {
        recommendation = `Consider a performance improvement plan: ${name}`;
        suggestedAction = 'Review with the staff member; confirm context before finalising a PIP.';
        contextAdjustment = 'Lower-difficulty portfolio — gap is not explained by workload.';
      } else {
        recommendation = `Maintain + coach: ${name}`;
        suggestedAction = 'Targeted technical coaching on weak areas.';
        contextAdjustment = `Difficulty ${Math.round(difficulty)}/100; adjusted performance ${Math.round(adjusted)}/100.`;
      }

      drafts.push({
        decisionType: 'staff_hr', scopeType: 'staff', scopeId: p.staffId, scopeName: name,
        recommendation,
        reason: `Raw achievement ${Math.round(rawAchievement)}%, execution quality ${Math.round(executionQuality)}%, context difficulty ${Math.round(difficulty)}/100 ⇒ adjusted ${Math.round(adjusted)}/100.`,
        riskLevel: rawAchievement < 55 && !highDifficulty ? 'high' : 'low',
        confidenceLevel: conf.level, confidenceScore: conf.score,
        contextAdjustment,
        suggestedAction,
        alternatives: ['Recognize', 'Promotion consideration', 'Mentoring role', 'Technical coaching', 'Performance improvement plan', 'Reduce workload', 'Rebalance schools', 'Add partner support'],
        metrics: { rawAchievement, adjusted, executionQuality, difficulty, schoolLoad: p.schoolLoad, coreSchoolLoad: p.coreSchoolLoad, partnerManagementLoad: p.partnerManagementLoad, districtSpread: p.districtSpread },
        riskFlags: [rawAchievement < 55 ? 'low-achievement' : '', highDifficulty ? 'high-workload' : ''].filter(Boolean),
        evidence: [
          { metricName: 'Raw target achievement', metricValue: `${Math.round(rawAchievement)}%`, sourceType: 'targets', weight: 'primary', tone: rawAchievement < 55 ? 'red' : rawAchievement < 80 ? 'amber' : 'green' },
          { metricName: 'Context difficulty', metricValue: `${Math.round(difficulty)}/100`, sourceType: 'workload', weight: 'primary', tone: highDifficulty ? 'amber' : 'green', explanation: `${p.schoolLoad} schools, ${p.coreSchoolLoad} core, ${p.partnerManagementLoad} partners, ${p.districtSpread} districts.` },
          { metricName: 'Execution quality (evidence accepted)', metricValue: `${Math.round(executionQuality)}%`, sourceType: 'workload', weight: 'supporting', tone: executionQuality < 70 ? 'red' : 'green' },
          p.distanceBurden != null
            ? { metricName: 'Travel burden (district spread)', metricValue: `${Math.round(p.distanceBurden)}/100`, sourceType: 'workload', weight: 'context' as const, tone: (p.distanceBurden >= 60 ? 'amber' : 'green') as 'amber' | 'green', explanation: 'Haversine spread across the staff member’s covered district centroids. Rural/urban classification is still pending.' }
            : { metricName: 'Rural/urban + travel context', metricValue: 'Insufficient data', sourceType: 'workload', weight: 'context' as const, tone: 'amber' as const, explanation: 'Covered districts are not geocoded yet — travel fairness is partial.' },
        ],
      });
    }
    return drafts;
  }

  // ── Board: Staff addition (per region demand vs capacity) ──────────────────
  private async staffAdditionDrafts(fy: string): Promise<InsightDraft[]> {
    const regions = await this.prisma.region.findMany({ select: { id: true, name: true } });
    const drafts: InsightDraft[] = [];
    for (const r of regions) {
      const total = await this.prisma.school.count({ where: { deletedAt: null, regionId: r.id } });
      if (total < 5) continue;
      const owners = await this.prisma.school.findMany({ where: { deletedAt: null, regionId: r.id, accountOwnerId: { not: null } }, select: { accountOwnerId: true }, distinct: ['accountOwnerId'] });
      const staffCount = owners.length;
      // Partner coverage is recorded as DISTRICT names (Partner.coverageDistricts)
      // plus an optional Partner.regionName — NEVER a region name inside
      // coverageDistricts. Match the region's actual districts (or regionName),
      // not r.name, or this count is structurally ~0 and the board would always
      // recommend "add staff" and never "add partner support".
      const districtNames = (await this.prisma.district.findMany({ where: { regionId: r.id }, select: { name: true } })).map((d) => d.name);
      const partners = await this.prisma.partner.count({
        where: {
          deletedAt: null,
          activeStatus: true,
          OR: [
            { regionName: r.name },
            { coverageDistricts: { hasSome: districtNames.length ? districtNames : ['__none__'] } },
          ],
        },
      });
      const schoolsPerStaff = staffCount ? total / staffCount : total;

      const conf = combineConfidence([
        { label: 'School count', ratio: 1, weight: 1 },
        { label: 'Ownership mapped', ratio: staffCount ? 1 : 0, weight: 1.5 },
        { label: 'Partner coverage data', ratio: 1, weight: 0.5 },
      ]);

      let recommendation: string;
      let suggestedAction: string;
      const overloaded = schoolsPerStaff > 120 || staffCount === 0;
      if (conf.level === 'insufficient') {
        recommendation = `Insufficient data on staffing for ${r.name}`;
        suggestedAction = 'Map account ownership before deciding on staffing.';
      } else if (overloaded && partners >= 2) {
        recommendation = `Add partner support before staff in ${r.name}`;
        suggestedAction = 'Partner capacity exists — leverage it before adding headcount.';
      } else if (overloaded) {
        recommendation = `Add a field staff member in ${r.name}`;
        suggestedAction = 'Add staff before further expansion — load per staff is high and partner cover is thin.';
      } else {
        recommendation = `No new staff needed yet in ${r.name}`;
        suggestedAction = 'Current capacity is adequate; rebalance if pockets are heavy.';
      }
      drafts.push({
        decisionType: 'staff_addition', scopeType: 'region', scopeId: r.id, scopeName: r.name,
        recommendation,
        reason: `${total} schools, ${staffCount} staff (~${Math.round(schoolsPerStaff)} schools/staff), ${partners} active partners covering ${r.name}.`,
        riskLevel: overloaded ? 'high' : 'low', confidenceLevel: conf.level, confidenceScore: conf.score,
        contextAdjustment: overloaded ? 'Capacity pressure is the limiter.' : null,
        financialImplication: overloaded ? (partners >= 2 ? 'Partner support is cheaper than new headcount here.' : 'New headcount cost vs. risk of SSA stagnation.') : null,
        suggestedAction,
        alternatives: ['Add staff immediately', 'Add staff next quarter', 'Do not add staff yet', 'Rebalance current staff', 'Add partner support instead', 'Add technical specialist'],
        metrics: { total, staffCount, schoolsPerStaff: Math.round(schoolsPerStaff), partners },
        riskFlags: [overloaded ? 'capacity-pressure' : ''].filter(Boolean),
        evidence: [
          { metricName: 'Schools per staff', metricValue: `${Math.round(schoolsPerStaff)}`, sourceType: 'workload', weight: 'primary', tone: overloaded ? 'red' : 'green' },
          { metricName: 'Active partners covering region', metricValue: `${partners}`, sourceType: 'partner', weight: 'supporting', tone: partners >= 2 ? 'green' : 'amber' },
          { metricName: 'Schools in region', metricValue: `${total}`, sourceType: 'workload', weight: 'context' },
        ],
      });
    }
    return drafts;
  }
}
