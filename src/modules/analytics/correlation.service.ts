import { Injectable } from '@nestjs/common';
import { Prisma, SsaIntervention } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ScopeService } from '../../common/scope/scope.service';
import { AuthUser } from '../../common/auth/auth-user';
import { getOperationalFY } from '../../common/fy/fy.util';

// Layer 3 — Support-to-Improvement Insight.
//
// Answers: "Did schools that received more staff visits, certified-partner
// visits, or trainings BEFORE their SSA improve more?" The cardinal rule
// (spec §15): for a school's current-FY SSA, only count verified support that
// happened AFTER the previous-FY SSA and BEFORE the current-FY SSA date.
// Anything after the SSA date influences the NEXT SSA, not this one — counting
// it would be false attribution.
//
// We never claim causation. Outputs use "associated with" language (spec §17).

const INTERVENTION_META: { key: SsaIntervention; code: string; label: string }[] = [
  { key: 'christlike_behaviour', code: 'CHRIST_LIKE_BEHAVIOR', label: 'Christ-like Behavior' },
  { key: 'exposure_to_word_of_god', code: 'EXPOSURE_TO_WORD_OF_GOD', label: 'Exposure to the Word of God' },
  { key: 'leadership', code: 'LEADERSHIP_BEST_PRACTICE', label: 'Leadership Best Practice' },
  { key: 'teaching_and_learning', code: 'TEACHING_ENVIRONMENT', label: 'Teaching Environment' },
  { key: 'learning_environment', code: 'LEARNING_ENVIRONMENT', label: 'Learning Environment' },
  { key: 'government_requirements', code: 'GOVERNMENT_REQUIREMENTS', label: 'Government Requirements' },
  { key: 'financial_health', code: 'FEES_BUDGET_ACCOUNTS', label: 'Fees / Budget / Accounts' },
  { key: 'education_technology', code: 'ENROLLMENT', label: 'Enrollment' },
];

const TRAINING_TYPES = ['training', 'school_improvement_training', 'cluster_training', 'core_training'];
const VISIT_TYPES = ['school_visit', 'follow_up_visit', 'coaching_visit', 'in_school_support', 'core_visit'];
const DONE_STATUSES = ['completed', 'ia_verified', 'accountant_confirmed'];

// Support count selectors — which variable becomes X in the correlation.
export type SupportFilter = 'all' | 'staff' | 'partner' | 'certified_partner' | 'visit' | 'training' | 'project';

type SchoolSupport = {
  staffVisits: number; certifiedPartnerVisits: number; nonCertifiedPartnerVisits: number;
  staffTrainings: number; partnerTrainings: number; certifiedPartnerTrainings: number;
  clusterMeetings: number; projectActivities: number; inSchoolSupport: number; totalVerified: number;
};

export type SchoolCorrelationRecord = {
  schoolId: string; name: string; schoolType: string;
  district: string | null; cluster: string | null; cceo: string | null;
  prevSsaDate: string | null; currSsaDate: string | null;
  prevAvg: number | null; currAvg: number | null; overallChange: number | null;
  improved: boolean; declined: boolean;
  interventionChange: Record<string, number | null>;
  support: SchoolSupport;
  supportClass: 'staff' | 'certified_partner' | 'mixed' | 'none';
  excludedAfterSsa: number; // verified support that fell AFTER the SSA date (not counted)
};

function mean(xs: number[]): number { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function r1(x: number): number { return Math.round(x * 10) / 10; }
function r2(x: number): number { return Math.round(x * 100) / 100; }

// Pearson r — null when too few points or no variance (can't claim anything).
function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); dx += (xs[i] - mx) ** 2; dy += (ys[i] - my) ** 2; }
  if (dx === 0 || dy === 0) return null;
  return r2(num / Math.sqrt(dx * dy));
}
function strengthLabel(r: number | null): string {
  if (r === null) return 'insufficient data';
  const a = Math.abs(r);
  const dir = r > 0 ? 'positive' : 'negative';
  if (a < 0.1) return 'negligible';
  if (a < 0.3) return `weak ${dir}`;
  if (a < 0.5) return `moderate ${dir}`;
  if (a < 0.7) return `strong ${dir}`;
  return `very strong ${dir}`;
}
function selectSupport(s: SchoolSupport, filter: SupportFilter): number {
  switch (filter) {
    case 'staff': return s.staffVisits + s.staffTrainings;
    case 'partner': return s.certifiedPartnerVisits + s.nonCertifiedPartnerVisits + s.partnerTrainings;
    case 'certified_partner': return s.certifiedPartnerVisits + s.certifiedPartnerTrainings;
    case 'visit': return s.staffVisits + s.certifiedPartnerVisits + s.nonCertifiedPartnerVisits;
    case 'training': return s.staffTrainings + s.partnerTrainings;
    case 'project': return s.projectActivities;
    default: return s.totalVerified;
  }
}

@Injectable()
export class CorrelationService {
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService) {}

  // The per-school engine every endpoint builds on. Computes SSA change AND the
  // verified support that happened strictly before the current SSA date.
  private async computeRecords(user: AuthUser, params: {
    currentFy?: string; prevFy?: string; schoolType?: string; regionId?: string; districtId?: string; clusterId?: string;
  }): Promise<{ currentFy: string; prevFy: string; records: SchoolCorrelationRecord[]; dataQuality: string[] }> {
    const scope = await this.scope.resolveUserScope(user);
    const currentFy = params.currentFy ?? getOperationalFY();
    const prevFy = params.prevFy ?? String(Number(currentFy) - 1);

    const where: Prisma.SchoolWhereInput = { deletedAt: null, ...this.scope.aggregateSchoolWhere(scope) };
    if (params.schoolType && params.schoolType !== 'all') where.schoolType = params.schoolType as Prisma.SchoolWhereInput['schoolType'];
    if (params.regionId) where.regionId = params.regionId;
    if (params.districtId) where.districtId = params.districtId;
    if (params.clusterId) where.clusterId = params.clusterId;

    const schools = await this.prisma.school.findMany({
      where,
      select: {
        id: true, schoolId: true, name: true, schoolType: true,
        district: { select: { name: true } }, cluster: { select: { name: true } },
        accountOwner: { include: { user: { select: { name: true } } } },
        ssaRecords: { where: { deletedAt: null, fy: { in: [prevFy, currentFy] } }, orderBy: { dateOfSsa: 'desc' }, include: { scores: true } },
        activities: {
          where: { deletedAt: null },
          select: {
            activityType: true, deliveryType: true, scheduledDate: true, iaConfirmedAt: true, projectId: true,
            status: true, iaVerificationStatus: true, assignedPartner: { select: { isCertified: true } },
          },
        },
      },
      take: 1000,
    });

    const dq = { missingPrev: 0, missingCurr: 0, missingDate: 0, noSupport: 0, unverifiedExcluded: 0 };
    const records: SchoolCorrelationRecord[] = [];

    for (const s of schools) {
      const prev = s.ssaRecords.find((r) => r.fy === prevFy);
      const curr = s.ssaRecords.find((r) => r.fy === currentFy);
      const currDate = curr?.dateOfSsa ?? null;
      const prevDate = prev?.dateOfSsa ?? null;
      if (!curr) dq.missingCurr++;
      if (!prev) dq.missingPrev++;

      // SSA change.
      let overallChange: number | null = null, improved = false, declined = false;
      const interventionChange: Record<string, number | null> = {};
      if (prev && curr && prev.averageScore != null && curr.averageScore != null) {
        overallChange = r1(curr.averageScore - prev.averageScore);
        improved = overallChange > 0.05; declined = overallChange < -0.05;
        const pMap = new Map(prev.scores.map((sc) => [sc.intervention, sc.score]));
        const cMap = new Map(curr.scores.map((sc) => [sc.intervention, sc.score]));
        for (const m of INTERVENTION_META) {
          const pv = pMap.get(m.key); const cv = cMap.get(m.key);
          interventionChange[m.code] = pv != null && cv != null ? r1(cv - pv) : null;
        }
      } else {
        for (const m of INTERVENTION_META) interventionChange[m.code] = null;
      }

      // Support BEFORE the current SSA date (the timing rule). Window opens at
      // the previous SSA date (so we attribute the right interval) and closes
      // strictly before the current SSA date.
      const sup: SchoolSupport = {
        staffVisits: 0, certifiedPartnerVisits: 0, nonCertifiedPartnerVisits: 0,
        staffTrainings: 0, partnerTrainings: 0, certifiedPartnerTrainings: 0,
        clusterMeetings: 0, projectActivities: 0, inSchoolSupport: 0, totalVerified: 0,
      };
      let excludedAfter = 0;
      for (const a of s.activities) {
        const verified = a.iaVerificationStatus === 'confirmed' || DONE_STATUSES.includes(a.status);
        if (!verified) { dq.unverifiedExcluded++; continue; }
        const when = a.scheduledDate ?? a.iaConfirmedAt ?? null;
        if (!when) { dq.missingDate++; continue; }
        // Only count activities strictly before the current SSA date.
        if (currDate && when >= currDate) { excludedAfter++; continue; }
        // And after the previous SSA (when we have one) — earlier support belongs to a prior cycle.
        if (prevDate && when < prevDate) continue;

        const isVisit = VISIT_TYPES.includes(a.activityType);
        const isTraining = TRAINING_TYPES.includes(a.activityType);
        const certified = !!a.assignedPartner?.isCertified;
        sup.totalVerified++;
        if (a.activityType === 'cluster_meeting') sup.clusterMeetings++;
        if (a.activityType === 'in_school_support') sup.inSchoolSupport++;
        if (a.activityType === 'project_activity' || a.projectId) sup.projectActivities++;
        if (isVisit) {
          if (a.deliveryType === 'partner') { certified ? sup.certifiedPartnerVisits++ : sup.nonCertifiedPartnerVisits++; }
          else sup.staffVisits++;
        }
        if (isTraining) {
          if (a.deliveryType === 'partner') { sup.partnerTrainings++; if (certified) sup.certifiedPartnerTrainings++; }
          else sup.staffTrainings++;
        }
      }
      if (sup.totalVerified === 0) dq.noSupport++;

      const staffSupport = sup.staffVisits + sup.staffTrainings;
      const certPartnerSupport = sup.certifiedPartnerVisits + sup.certifiedPartnerTrainings;
      let supportClass: SchoolCorrelationRecord['supportClass'] = 'none';
      if (staffSupport > 0 && certPartnerSupport > 0) supportClass = 'mixed';
      else if (staffSupport > 0) supportClass = 'staff';
      else if (certPartnerSupport > 0 || sup.nonCertifiedPartnerVisits + sup.partnerTrainings > 0) supportClass = 'certified_partner';

      records.push({
        schoolId: s.schoolId, name: s.name, schoolType: s.schoolType,
        district: s.district?.name ?? null, cluster: s.cluster?.name ?? null, cceo: s.accountOwner?.user?.name ?? null,
        prevSsaDate: prevDate ? prevDate.toISOString().slice(0, 10) : null,
        currSsaDate: currDate ? currDate.toISOString().slice(0, 10) : null,
        prevAvg: prev?.averageScore ?? null, currAvg: curr?.averageScore ?? null, overallChange,
        improved, declined, interventionChange, support: sup, supportClass, excludedAfterSsa: excludedAfter,
      });
    }

    const dataQuality: string[] = [];
    if (dq.missingPrev) dataQuality.push(`${dq.missingPrev} school(s) missing previous-FY SSA — excluded from change.`);
    if (dq.missingCurr) dataQuality.push(`${dq.missingCurr} school(s) missing current-FY SSA — excluded from change.`);
    if (dq.missingDate) dataQuality.push(`${dq.missingDate} verified activity(ies) had no date — could not be placed relative to the SSA.`);
    if (dq.unverifiedExcluded) dataQuality.push(`${dq.unverifiedExcluded} unverified activity(ies) excluded — only IA-verified/completed support counts.`);
    if (dq.noSupport) dataQuality.push(`${dq.noSupport} school(s) had no verified support before their SSA.`);
    dataQuality.push('Activities dated after the SSA are excluded — they may influence the next SSA, not this one.');

    return { currentFy, prevFy, records, dataQuality };
  }

  // §16A + §21 — per-school support-before-SSA with a headline summary (drilldown-ready).
  async supportBeforeSsa(user: AuthUser, params: Parameters<CorrelationService['computeRecords']>[1]) {
    const { currentFy, prevFy, records, dataQuality } = await this.computeRecords(user, params);
    const comparable = records.filter((r) => r.overallChange != null);
    const summary = {
      schoolsTotal: records.length,
      schoolsWithComparison: comparable.length,
      avgVisitsBeforeSsa: comparable.length ? r1(mean(comparable.map((r) => r.support.staffVisits + r.support.certifiedPartnerVisits + r.support.nonCertifiedPartnerVisits))) : null,
      avgTrainingsBeforeSsa: comparable.length ? r1(mean(comparable.map((r) => r.support.staffTrainings + r.support.partnerTrainings))) : null,
      avgVerifiedSupportBeforeSsa: comparable.length ? r1(mean(comparable.map((r) => r.support.totalVerified))) : null,
      avgSsaImprovement: comparable.length ? r1(mean(comparable.map((r) => r.overallChange!))) : null,
      schoolsImproved: comparable.filter((r) => r.improved).length,
      schoolsDeclined: comparable.filter((r) => r.declined).length,
    };
    return { currentFy, prevFy, summary, schools: records, dataQuality };
  }

  // §16A + §16B + §16C — correlation summary, scatter points, intervention bins.
  async supportSsaCorrelation(user: AuthUser, params: Parameters<CorrelationService['computeRecords']>[1] & { support?: SupportFilter }) {
    const filter: SupportFilter = params.support ?? 'all';
    const { currentFy, prevFy, records, dataQuality } = await this.computeRecords(user, params);
    const comparable = records.filter((r) => r.overallChange != null);

    const xs = comparable.map((r) => selectSupport(r.support, filter));
    const ys = comparable.map((r) => r.overallChange!);
    const r = pearson(xs, ys);

    // Scatter points (X = selected support, Y = SSA improvement), colored by class.
    const chartPoints = comparable.map((rec) => ({
      schoolId: rec.schoolId, name: rec.name,
      support: selectSupport(rec.support, filter), improvement: rec.overallChange!, supportClass: rec.supportClass,
    }));

    // Intervention-level bins: avg change for 0 / 1–2 / 3+ support schools.
    const binOf = (n: number): '0' | '1-2' | '3+' => (n === 0 ? '0' : n <= 2 ? '1-2' : '3+');
    const interventionBins = INTERVENTION_META.map((m) => {
      const buckets: Record<string, number[]> = { '0': [], '1-2': [], '3+': [] };
      for (const rec of comparable) {
        const ch = rec.interventionChange[m.code];
        if (ch == null) continue;
        buckets[binOf(selectSupport(rec.support, filter))].push(ch);
      }
      return {
        code: m.code, label: m.label,
        zero: buckets['0'].length ? r1(mean(buckets['0'])) : null, zeroN: buckets['0'].length,
        low: buckets['1-2'].length ? r1(mean(buckets['1-2'])) : null, lowN: buckets['1-2'].length,
        high: buckets['3+'].length ? r1(mean(buckets['3+'])) : null, highN: buckets['3+'].length,
      };
    });

    return {
      currentFy, prevFy, support: filter,
      summary: {
        schoolsWithComparison: comparable.length,
        correlation: r, strength: strengthLabel(r),
        avgSupport: comparable.length ? r1(mean(xs)) : null,
        avgImprovement: comparable.length ? r1(mean(ys)) : null,
        interpretation: r === null
          ? 'Not enough comparable schools to assess a relationship.'
          : `Schools with more verified ${filter === 'all' ? 'support' : filter.replace('_', ' ')} before SSA showed a ${strengthLabel(r)} association with SSA improvement. Association only — not proof of cause.`,
      },
      chartPoints, interventionBins, dataQuality,
    };
  }

  // §16D — staff vs certified-partner vs mixed support comparison.
  async staffVsPartner(user: AuthUser, params: Parameters<CorrelationService['computeRecords']>[1]) {
    const { currentFy, prevFy, records, dataQuality } = await this.computeRecords(user, params);
    const comparable = records.filter((r) => r.overallChange != null && r.supportClass !== 'none');

    const groupFor = (cls: SchoolCorrelationRecord['supportClass']) => {
      const g = comparable.filter((r) => r.supportClass === cls);
      const interventionAvg = (r: SchoolCorrelationRecord) => {
        const vals = Object.values(r.interventionChange).filter((v): v is number => v != null);
        return vals.length ? mean(vals) : null;
      };
      const ivAvgs = g.map(interventionAvg).filter((v): v is number => v != null);
      return {
        supportClass: cls, schools: g.length,
        avgOverallImprovement: g.length ? r1(mean(g.map((r) => r.overallChange!))) : null,
        avgInterventionImprovement: ivAvgs.length ? r1(mean(ivAvgs)) : null,
        schoolsImprovedPct: g.length ? Math.round((g.filter((r) => r.improved).length / g.length) * 100) : null,
        schoolsDeclinedPct: g.length ? Math.round((g.filter((r) => r.declined).length / g.length) * 100) : null,
        avgVerifiedSupport: g.length ? r1(mean(g.map((r) => r.support.totalVerified))) : null,
      };
    };

    return {
      currentFy, prevFy,
      groups: [groupFor('staff'), groupFor('certified_partner'), groupFor('mixed')],
      note: 'Differences are associations, not causal effects — support type is not randomly assigned across schools.',
      dataQuality,
    };
  }
}
