import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ScopeService } from '../../common/scope/scope.service';
import { AssignmentService } from '../assignment/assignment.service';
import { AuthUser } from '../../common/auth/auth-user';
import { getOperationalFY } from '../../common/fy/fy.util';
import {
  DONE_STATUSES, PLANNED_EXCLUDE, TRAINING_TYPES, VISIT_TYPES, PERIODS,
  quarterOfDate, pct, statusOf, overallHealth, cumulativeFraction,
} from './targets-config';

// Only CD or IA (and Admin) may set targets (spec §2).
const TARGET_SETTERS = ['CountryDirector', 'ImpactAssessment', 'Admin'];

// A resolved annual target for a category: a concrete number plus whether it
// came from a CD/IA setting or the 100%-of-base default (spec §3).
type AnnualTarget = { value: number; unit: 'count' | 'percentage'; source: 'set' | 'default'; base: number };

@Injectable()
export class TargetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly assignment: AssignmentService,
  ) {}

  // ── Target setting (CD / IA) ──────────────────────────────────────
  async setTarget(user: AuthUser, dto: {
    fy?: string; targetType: string; scopeType: string; scopeId?: string;
    targetValue?: number; targetUnit?: 'count' | 'percentage'; targetPercentage?: number;
    quarterDistribution?: Record<string, number>; effectiveFrom?: string; effectiveTo?: string; notes?: string;
  }) {
    if (!TARGET_SETTERS.includes(user.activeRole)) {
      throw new ForbiddenException('Only the Country Director or Impact Assessment may set targets.');
    }
    const fy = dto.fy ?? getOperationalFY();
    if (dto.targetValue == null && dto.targetPercentage == null) {
      throw new BadRequestException('A target needs either targetValue (count) or targetPercentage.');
    }
    // One active setting per (fy, type, scope) — deactivate the prior one.
    await this.prisma.targetSetting.updateMany({
      where: { fy, targetType: dto.targetType as never, scopeType: dto.scopeType as never, scopeId: dto.scopeId ?? null, isActive: true },
      data: { isActive: false, effectiveTo: new Date() },
    });
    return this.prisma.targetSetting.create({
      data: {
        fy, targetType: dto.targetType as never, scopeType: dto.scopeType as never, scopeId: dto.scopeId ?? null,
        targetValue: dto.targetValue ?? null,
        targetUnit: (dto.targetUnit ?? (dto.targetPercentage != null ? 'percentage' : 'count')) as never,
        targetPercentage: dto.targetPercentage ?? null,
        quarterDistribution: (dto.quarterDistribution ?? undefined) as Prisma.InputJsonValue | undefined,
        setByUserId: user.userId,
        setByRole: user.activeRole as never,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined,
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
        notes: dto.notes ?? null,
      },
    });
  }

  async listTargets(user: AuthUser, params: { fy?: string; targetType?: string; scopeType?: string; scopeId?: string }) {
    const fy = params.fy ?? getOperationalFY();
    const where: Prisma.TargetSettingWhereInput = { fy, isActive: true };
    if (params.targetType) where.targetType = params.targetType as never;
    if (params.scopeType) where.scopeType = params.scopeType as never;
    if (params.scopeId) where.scopeId = params.scopeId;
    const rows = await this.prisma.targetSetting.findMany({ where, orderBy: [{ targetType: 'asc' }, { scopeType: 'asc' }] });
    return { fy, canSet: TARGET_SETTERS.includes(user.activeRole), setterRole: user.activeRole, rows };
  }

  // Resolve the active setting for a target type — most specific scope wins.
  private async resolvedSetting(fy: string, targetType: string, scopeChain: { scopeType: string; scopeId?: string }[]) {
    for (const s of scopeChain) {
      const hit = await this.prisma.targetSetting.findFirst({
        where: { fy, targetType: targetType as never, scopeType: s.scopeType as never, scopeId: s.scopeId ?? null, isActive: true },
        orderBy: { effectiveFrom: 'desc' },
      });
      if (hit) return hit;
    }
    return null;
  }

  // ── Who the caller may view (self / supervised / country) ─────────
  private async resolveStaffId(user: AuthUser, requested?: string): Promise<string> {
    const self = user.staffProfileId ?? '';
    if (!requested || requested === self) return self;
    const scope = await this.scope.resolveUserScope(user);
    if (scope.countryScope) return requested;
    if (user.activeRole === 'CountryProgramLead' && scope.supervisedStaffIds.includes(requested)) return requested;
    throw new ForbiddenException('You may only view your own targets.');
  }

  // ── Multi-category Targets by Time Period (spec §4) ───────────────
  async timePeriod(user: AuthUser, params: { fy?: string; staffId?: string }) {
    const fy = params.fy ?? getOperationalFY();
    const prevFy = String(Number(fy) - 1);
    const staffId = await this.resolveStaffId(user, params.staffId);
    if (!staffId) throw new BadRequestException('No staff scope — pass staffId to view a staff member’s targets.');

    // Portfolio + reach split (existing behavior, preserved).
    const annualStaffLimit = await this.assignment.limitFor(staffId, fy);
    const portfolio = (await this.prisma.staffSchoolAssignment.findMany({ where: { staffId }, select: { schoolId: true } })).map((s) => s.schoolId);
    const portfolioSet = new Set(portfolio);
    const totalPortfolio = portfolioSet.size;
    const annualStaffTarget = Math.min(annualStaffLimit, totalPortfolio || annualStaffLimit);
    const annualPartnerTarget = Math.max(0, totalPortfolio - annualStaffTarget);
    const scopeChain = [{ scopeType: 'staff', scopeId: staffId }, { scopeType: 'country' as const }];
    const portfolioIds = portfolio.length ? portfolio : ['__none__'];

    // One activity query feeds reach + training + visit categories.
    const acts = await this.prisma.activity.findMany({
      where: {
        deletedAt: null, fy,
        OR: [
          { responsibleStaffId: staffId, deliveryType: 'staff' },
          { schoolId: { in: portfolioIds }, deliveryType: 'partner' },
        ],
      },
      select: { schoolId: true, quarter: true, deliveryType: true, activityType: true, status: true },
    });
    const planned = (a: { status: string }) => !PLANNED_EXCLUDE.includes(a.status);
    const done = (a: { status: string }) => DONE_STATUSES.includes(a.status);
    const isTraining = (t: string) => TRAINING_TYPES.includes(t);
    const isVisit = (t: string) => VISIT_TYPES.includes(t);

    // SSA current + previous FY (impact-readiness, spec §7).
    const ssaRecs = await this.prisma.ssaRecord.findMany({
      where: { deletedAt: null, fy, schoolId: { in: portfolioIds } },
      select: { schoolId: true, dateOfSsa: true },
    });
    const prevSsaSchools = new Set((await this.prisma.ssaRecord.findMany({
      where: { deletedAt: null, fy: prevFy, schoolId: { in: portfolioIds } },
      select: { schoolId: true },
    })).map((r) => r.schoolId));

    // MSCS + Exam achievement.
    const mscs = await this.prisma.mostSignificantChangeStory.findMany({
      where: { deletedAt: null, fy, submittedByStaffId: staffId },
      select: { quarter: true, reviewStatus: true },
    });
    const exams = await this.prisma.examResultCollection.findMany({
      where: { deletedAt: null, fy, schoolId: { in: portfolioIds } },
      select: { schoolId: true, status: true, collectionDate: true },
    });

    // Annual targets per category (CD/IA setting or 100% default).
    const trainingPlannedTotal = acts.filter((a) => isTraining(a.activityType) && planned(a)).length;
    const visitPlannedTotal = acts.filter((a) => isVisit(a.activityType) && planned(a)).length;
    const trainingT = await this.annualFor(fy, 'TRAINING', scopeChain, trainingPlannedTotal);
    const visitT = await this.annualFor(fy, 'SCHOOL_VISIT', scopeChain, visitPlannedTotal);
    const ssaT = await this.annualFor(fy, 'SSA', scopeChain, totalPortfolio);
    const mscsT = await this.annualFor(fy, 'MSCS', scopeChain, 0); // no 100% default — CD/IA sets a number
    const examT = await this.annualFor(fy, 'EXAM_RESULTS', scopeChain, totalPortfolio);
    const reachSetting = await this.resolvedSetting(fy, 'SCHOOL_REACH', scopeChain);
    const dist = (reachSetting?.quarterDistribution as Record<string, number> | null) ?? null;

    const rows = PERIODS.map((p) => {
      const frac = cumulativeFraction(p.quarters, p.pct, dist);
      const inP = acts.filter((a) => p.quarters.includes(a.quarter));

      const reachDone = inP.filter((a) => done(a) && a.schoolId);
      const staffSchools = new Set(reachDone.filter((a) => a.deliveryType === 'staff').map((a) => a.schoolId as string));
      const partnerSchools = new Set(reachDone.filter((a) => a.deliveryType === 'partner').map((a) => a.schoolId as string));
      const allSchools = new Set([...staffSchools, ...partnerSchools]);
      const staffTgt = Math.round(annualStaffTarget * frac), partnerTgt = Math.round(annualPartnerTarget * frac);

      const trainingAch = inP.filter((a) => isTraining(a.activityType) && done(a)).length;
      const visitAch = inP.filter((a) => isVisit(a.activityType) && done(a)).length;
      const ssaAch = new Set(ssaRecs.filter((r) => { const q = quarterOfDate(r.dateOfSsa); return q && p.quarters.includes(q); }).map((r) => r.schoolId)).size;
      const mscsAch = mscs.filter((m) => ['approved', 'donor_ready'].includes(m.reviewStatus) && m.quarter && p.quarters.includes(m.quarter)).length;
      const examAch = new Set(exams.filter((e) => { if (!['validated', 'approved'].includes(e.status)) return false; const q = quarterOfDate(e.collectionDate); return q && p.quarters.includes(q); }).map((e) => e.schoolId)).size;

      const cell = (achieved: number, annual: number) => { const t = Math.round(annual * frac); return { target: t, achieved, pct: pct(achieved, t) }; };
      const trainingCell = cell(trainingAch, trainingT.value);
      const visitCell = cell(visitAch, visitT.value);
      const ssaCell = cell(ssaAch, ssaT.value);
      const mscsCell = cell(mscsAch, mscsT.value);
      const examCell = cell(examAch, examT.value);
      const totalReachTgt = staffTgt + partnerTgt;
      const reachPct = pct(allSchools.size, totalReachTgt);
      const health = overallHealth([reachPct, trainingCell.pct, ssaCell.pct, visitCell.pct, mscsCell.pct, examCell.pct]);

      return {
        period: p.label,
        cumulativePct: Math.round(frac * 100),
        staff: { target: staffTgt, achieved: staffSchools.size, pct: pct(staffSchools.size, staffTgt) },
        partner: { target: partnerTgt, achieved: partnerSchools.size, pct: pct(partnerSchools.size, partnerTgt) },
        total: { target: totalReachTgt, achieved: allSchools.size, pct: reachPct },
        training: trainingCell, ssa: ssaCell, visit: visitCell, mscs: mscsCell, exam: examCell,
        gap: Math.max(0, totalReachTgt - allSchools.size),
        overallPct: health.pct, status: health.status,
      };
    });

    const dataQuality: string[] = [];
    if (totalPortfolio === 0) dataQuality.push('Staff has no assigned schools — targets cannot be computed.');
    if (mscsT.source === 'default') dataQuality.push('MSCS target not set by CD/IA — defaults to 0. Set a number per quarter/FY.');
    const ssaMissingPrev = ssaRecs.filter((r) => !prevSsaSchools.has(r.schoolId)).length;
    if (ssaMissingPrev > 0) dataQuality.push(`${ssaMissingPrev} school(s) have current-FY SSA but no previous-FY SSA — not ready for impact comparison.`);

    return {
      fy, staffId, totalPortfolio,
      annual: {
        staffTarget: annualStaffTarget, partnerTarget: annualPartnerTarget, total: annualStaffTarget + annualPartnerTarget,
        training: trainingT, ssa: ssaT, visit: visitT, mscs: mscsT, exam: examT,
      },
      readiness: {
        currentFySsa: new Set(ssaRecs.map((r) => r.schoolId)).size,
        previousFySsa: prevSsaSchools.size,
        readyForImpactComparison: ssaRecs.filter((r) => prevSsaSchools.has(r.schoolId)).length,
      },
      rows, dataQuality,
    };
  }

  // ── By-category annual summary (spec §1 / targets/summary) ────────
  async summary(user: AuthUser, params: { fy?: string; staffId?: string }) {
    const tp = await this.timePeriod(user, params);
    const eoy = tp.rows.find((r) => r.period === 'End of Year')!;
    const categories = [
      { key: 'SCHOOL_REACH', label: 'School Reach', target: eoy.total.target, achieved: eoy.total.achieved, pct: eoy.total.pct, defaulted: false },
      { key: 'TRAINING', label: 'Training', target: eoy.training.target, achieved: eoy.training.achieved, pct: eoy.training.pct, defaulted: tp.annual.training.source === 'default' },
      { key: 'SSA', label: 'SSA', target: eoy.ssa.target, achieved: eoy.ssa.achieved, pct: eoy.ssa.pct, defaulted: tp.annual.ssa.source === 'default' },
      { key: 'SCHOOL_VISIT', label: 'School Visit', target: eoy.visit.target, achieved: eoy.visit.achieved, pct: eoy.visit.pct, defaulted: tp.annual.visit.source === 'default' },
      { key: 'MSCS', label: 'MSCS', target: eoy.mscs.target, achieved: eoy.mscs.achieved, pct: eoy.mscs.pct, defaulted: tp.annual.mscs.source === 'default' },
      { key: 'EXAM_RESULTS', label: 'Exam Results', target: eoy.exam.target, achieved: eoy.exam.achieved, pct: eoy.exam.pct, defaulted: tp.annual.exam.source === 'default' },
    ].map((c) => ({ ...c, status: statusOf(c.pct) }));
    return { fy: tp.fy, staffId: tp.staffId, categories, overall: overallHealth(categories.map((c) => c.pct)), dataQuality: tp.dataQuality };
  }

  // Resolve a category's ANNUAL target: explicit setting (count or % of base)
  // or the 100%-of-base default.
  private async annualFor(fy: string, targetType: string, scopeChain: { scopeType: string; scopeId?: string }[], base: number): Promise<AnnualTarget> {
    const setting = await this.resolvedSetting(fy, targetType, scopeChain);
    if (setting) {
      if (setting.targetUnit === 'count' && setting.targetValue != null) {
        return { value: Math.round(setting.targetValue), unit: 'count', source: 'set', base };
      }
      const p = setting.targetPercentage ?? setting.targetValue ?? 100;
      return { value: Math.round((base * p) / 100), unit: 'percentage', source: 'set', base };
    }
    return { value: base, unit: 'percentage', source: 'default', base };
  }
}
