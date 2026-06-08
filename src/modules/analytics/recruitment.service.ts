import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ScopeService } from '../../common/scope/scope.service';
import { AuthUser } from '../../common/auth/auth-user';
import { getOperationalFY } from '../../common/fy/fy.util';

// Recruitment Recommendation (spec §6–10).
//
// Answers "should we recruit more schools, or focus on supporting the ones we
// have?" from capacity + SSA readiness + clustering + data quality + impact +
// finance — never from a single signal. The output is advisory, role-scoped,
// and drills to district level so leaders can pause/expand by district.

const DONE = ['completed', 'ia_verified', 'accountant_confirmed'];
const PAYMENT_BACKLOG = ['ia_confirmed', 'pl_approved', 'accountant_cleared']; // partner payments not yet paid

type Reco =
  | 'Continue Recruiting'
  | 'Recruit Carefully'
  | 'Pause Recruitment and Support Current Schools'
  | 'Stop Recruitment in Specific Districts'
  | 'Recruit More in Specific Districts';

function r0(x: number): number { return Math.round(x); }
function pctOf(n: number, d: number): number { return d > 0 ? Math.round((n / d) * 100) : 0; }

@Injectable()
export class RecruitmentService {
  constructor(private readonly prisma: PrismaService, private readonly scope: ScopeService) {}

  async recommendation(user: AuthUser, params: { fy?: string; districtId?: string }) {
    const scope = await this.scope.resolveUserScope(user);
    const fy = params.fy ?? getOperationalFY();
    const prevFy = String(Number(fy) - 1);

    const where: Prisma.SchoolWhereInput = { deletedAt: null, ...this.scope.aggregateSchoolWhere(scope) };
    if (params.districtId) where.districtId = params.districtId;

    const schools = await this.prisma.school.findMany({
      where,
      select: {
        id: true, schoolType: true, clusterStatus: true, currentFySsaStatus: true,
        accountOwnerStatus: true, duplicateStatus: true, enrollment: true,
        districtId: true, district: { select: { name: true } },
        ssaRecords: { where: { deletedAt: null, fy: { in: [prevFy, fy] } }, select: { fy: true, averageScore: true } },
      },
      take: 5000,
    });
    const schoolIds = schools.map((s) => s.id);

    // Reach + partner-pipeline signals from activities.
    const acts = schoolIds.length ? await this.prisma.activity.findMany({
      where: { deletedAt: null, fy, schoolId: { in: schoolIds } },
      select: { schoolId: true, status: true, deliveryType: true, paymentStatus: true, evidenceStatus: true },
    }) : [];
    const reachedSet = new Set(acts.filter((a) => DONE.includes(a.status) && a.schoolId).map((a) => a.schoolId as string));
    const partnerActs = acts.filter((a) => a.deliveryType === 'partner');
    const partnerPaymentBacklog = partnerActs.filter((a) => PAYMENT_BACKLOG.includes(a.paymentStatus)).length;
    const partnerEvidencePending = partnerActs.filter((a) => a.evidenceStatus !== 'accepted' && DONE.includes(a.status)).length;

    // Staff capacity proxy: distinct CCEOs (account owners) carrying the portfolio
    // vs. a soft target load. Headroom shrinks as schools-per-owner rises.
    const owners = new Set(schools.map((s) => s.accountOwnerStatus === 'matched' ? 'm' : 'u')); // presence only
    void owners;

    const compute = (rows: typeof schools) => {
      const total = rows.length;
      const core = rows.filter((s) => s.schoolType === 'core').length;
      const client = rows.filter((s) => s.schoolType === 'client').length;
      const currentSsa = rows.filter((s) => s.currentFySsaStatus === 'done' || s.ssaRecords.some((r) => r.fy === fy)).length;
      const prevSsa = rows.filter((s) => s.ssaRecords.some((r) => r.fy === prevFy)).length;
      const readyForComparison = rows.filter((s) => s.ssaRecords.some((r) => r.fy === fy) && s.ssaRecords.some((r) => r.fy === prevFy)).length;
      const clustered = rows.filter((s) => s.clusterStatus === 'clustered').length;
      const reached = rows.filter((s) => reachedSet.has(s.id)).length;
      const missingCluster = total - clustered;
      const missingSsa = total - currentSsa;
      const unmatchedOwner = rows.filter((s) => s.accountOwnerStatus !== 'matched').length;
      const duplicates = rows.filter((s) => s.duplicateStatus === 'potential' || s.duplicateStatus === 'confirmed').length;
      const missingEnrollment = rows.filter((s) => s.enrollment == null).length;
      // Impact
      const improved = rows.filter((s) => {
        const p = s.ssaRecords.find((r) => r.fy === prevFy)?.averageScore;
        const c = s.ssaRecords.find((r) => r.fy === fy)?.averageScore;
        return p != null && c != null && c - p > 0.05;
      }).length;
      const declined = rows.filter((s) => {
        const p = s.ssaRecords.find((r) => r.fy === prevFy)?.averageScore;
        const c = s.ssaRecords.find((r) => r.fy === fy)?.averageScore;
        return p != null && c != null && c - p < -0.05;
      }).length;
      return {
        total, core, client,
        ssaCompletionPct: pctOf(currentSsa, total), prevSsaPct: pctOf(prevSsa, total),
        impactReadyPct: pctOf(readyForComparison, total), clusteredPct: pctOf(clustered, total),
        reachedPct: pctOf(reached, total),
        missingCluster, missingSsa, unmatchedOwner, duplicates, missingEnrollment,
        schoolsImproved: improved, schoolsDeclined: declined,
      };
    };

    const country = compute(schools);

    // Composite readiness (0–100). High readiness → room to recruit; low → focus.
    const dataQualityPenalty = pctOf(country.missingCluster + country.unmatchedOwner + country.duplicates, country.total * 2);
    const partnerStrain = pctOf(partnerPaymentBacklog + partnerEvidencePending, Math.max(1, partnerActs.length));
    const readinessScore = r0(Math.max(0, Math.min(100,
      country.ssaCompletionPct * 0.30 +
      country.clusteredPct * 0.20 +
      country.reachedPct * 0.20 +
      country.impactReadyPct * 0.10 +
      (100 - dataQualityPenalty) * 0.10 +
      (100 - partnerStrain) * 0.10,
    )));

    // Per-district breakdown → pause vs expand candidates.
    const byDistrict = new Map<string, { name: string; rows: typeof schools }>();
    for (const s of schools) {
      const k = s.districtId;
      const g = byDistrict.get(k) ?? { name: s.district?.name ?? 'District', rows: [] as typeof schools };
      g.rows.push(s); byDistrict.set(k, g);
    }
    const districts = [...byDistrict.entries()].map(([districtId, g]) => {
      const c = compute(g.rows);
      const dScore = r0(c.ssaCompletionPct * 0.4 + c.clusteredPct * 0.3 + c.reachedPct * 0.3);
      let signal: 'expand' | 'hold' | 'pause' = 'hold';
      if (dScore >= 75 && c.ssaCompletionPct >= 80) signal = 'expand';
      else if (dScore < 50 || c.ssaCompletionPct < 50) signal = 'pause';
      return { districtId, district: g.name, schools: c.total, ...c, score: dScore, signal };
    }).sort((a, b) => a.score - b.score);

    const pauseDistricts = districts.filter((d) => d.signal === 'pause').map((d) => ({ districtId: d.districtId, district: d.district, ssaCompletionPct: d.ssaCompletionPct, score: d.score }));
    const expandDistricts = districts.filter((d) => d.signal === 'expand').map((d) => ({ districtId: d.districtId, district: d.district, ssaCompletionPct: d.ssaCompletionPct, score: d.score }));

    // Decide the headline recommendation.
    let recommendation: Reco;
    if (readinessScore >= 75 && country.ssaCompletionPct >= 80 && partnerStrain < 40) recommendation = 'Continue Recruiting';
    else if (readinessScore >= 55) recommendation = 'Recruit Carefully';
    else recommendation = 'Pause Recruitment and Support Current Schools';
    if (recommendation !== 'Pause Recruitment and Support Current Schools' && pauseDistricts.length && expandDistricts.length) {
      recommendation = 'Stop Recruitment in Specific Districts';
    } else if (recommendation === 'Continue Recruiting' && expandDistricts.length && !pauseDistricts.length) {
      recommendation = 'Recruit More in Specific Districts';
    }

    // Human reason string.
    const reasons: string[] = [];
    reasons.push(`${country.ssaCompletionPct}% of schools have a current-FY SSA`);
    reasons.push(`${country.clusteredPct}% clustered`);
    if (partnerStrain >= 40) reasons.push(`partner backlog is high (${partnerPaymentBacklog} payments, ${partnerEvidencePending} evidence pending)`);
    if (country.missingSsa) reasons.push(`${country.missingSsa} schools still missing current-FY SSA`);
    const reason =
      recommendation.startsWith('Continue') || recommendation.startsWith('Recruit More')
        ? `Capacity and readiness look healthy — ${reasons.slice(0, 2).join(', ')}.`
        : recommendation.startsWith('Recruit Carefully')
          ? `Mixed readiness — ${reasons.slice(0, 3).join(', ')}. Expand selectively.`
          : `Focus on current schools first — ${reasons.slice(0, 3).join(', ')}.`;

    return {
      fy, scope: params.districtId ? 'district' : 'scoped',
      readinessScore,
      recommendation,
      reason,
      capacity: {
        totalSchools: country.total, core: country.core, client: country.client,
        reachedPct: country.reachedPct, partnerPaymentBacklog, partnerEvidencePending, partnerStrainPct: partnerStrain,
      },
      ssaReadiness: {
        currentSsaPct: country.ssaCompletionPct, previousSsaPct: country.prevSsaPct,
        impactReadyPct: country.impactReadyPct, missingCurrentSsa: country.missingSsa,
      },
      dataQuality: {
        missingCluster: country.missingCluster, unmatchedOwner: country.unmatchedOwner,
        duplicates: country.duplicates, missingEnrollment: country.missingEnrollment, penaltyPct: dataQualityPenalty,
      },
      impact: { schoolsImproved: country.schoolsImproved, schoolsDeclined: country.schoolsDeclined },
      suggestedRecruitDistricts: expandDistricts.slice(0, 8),
      pauseDistricts: pauseDistricts.slice(0, 8),
      districts,
      nextAction:
        recommendation.startsWith('Pause')
          ? 'Complete current-FY SSA and verified visits on existing schools before adding more.'
          : recommendation.startsWith('Stop')
            ? 'Hold recruitment in the flagged districts; redirect capacity to SSA and clustering there.'
            : 'Proceed with recruitment where capacity and SSA readiness are strong; monitor partner backlog.',
      disclaimer: 'Advisory only — a decision aid based on current operational readiness, not an automated recruitment action.',
    };
  }
}
