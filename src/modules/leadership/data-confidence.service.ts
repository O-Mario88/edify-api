import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { getOperationalFY } from '../../common/fy/fy.util';
import { DONE_STATUSES } from '../targets/targets-config';
import { combineConfidence, ConfidencePart, ConfidenceResult, pct } from './leadership.types';

// Computes a data-confidence score for a school scope, from REAL completeness
// of the inputs a recommendation depends on. Never fabricates: a scope with no
// schools returns an `insufficient` result. Spec §"Decision Engine Must Include
// Data Confidence".
@Injectable()
export class DataConfidenceService {
  constructor(private readonly prisma: PrismaService) {}

  /** Generic combiner exposed so every decision service scores consistently. */
  combine(parts: ConfidencePart[]): ConfidenceResult {
    return combineConfidence(parts);
  }

  /**
   * Confidence for a set of schools (the scope of a recruitment / regional
   * insight). Reads SSA completion, prev-FY availability, IA verification,
   * ownership, clustering, and activity-completion completeness.
   */
  async forSchoolScope(
    where: Prisma.SchoolWhereInput,
    fy = getOperationalFY(),
  ): Promise<ConfidenceResult & { schoolsTotal: number }> {
    const prevFy = String(Number(fy) - 1);
    const schools = await this.prisma.school.findMany({
      where: { deletedAt: null, ...where },
      select: {
        id: true,
        currentFySsaStatus: true,
        clusterStatus: true,
        accountOwnerStatus: true,
        regionId: true,
        districtId: true,
        ssaRecords: { where: { deletedAt: null, fy: { in: [prevFy, fy] } }, select: { fy: true } },
      },
      take: 8000,
    });
    const n = schools.length;
    if (n === 0) {
      // No data ⇒ insufficient by construction. Do not invent a score.
      return { ...combineConfidence([{ label: 'No schools in scope', ratio: 0 }]), schoolsTotal: 0 };
    }

    const withCurrentSsa = schools.filter((s) => s.currentFySsaStatus === 'done').length;
    const withPrevSsa = schools.filter((s) => s.ssaRecords.some((r) => r.fy === prevFy)).length;
    const owned = schools.filter((s) => s.accountOwnerStatus === 'matched').length;
    const clustered = schools.filter((s) => s.clusterStatus === 'clustered').length;
    const geo = schools.filter((s) => !!s.regionId && !!s.districtId).length;

    const ids = schools.map((s) => s.id);
    const acts = await this.prisma.activity.findMany({
      where: { deletedAt: null, fy, schoolId: { in: ids } },
      select: { status: true, iaVerificationStatus: true },
    });
    const actsTotal = acts.length;
    const actsVerified = acts.filter((a) => a.iaVerificationStatus === 'confirmed').length;
    const actsDone = acts.filter((a) => DONE_STATUSES.includes(a.status)).length;

    const parts: ConfidencePart[] = [
      { label: 'Current-FY SSA completion', ratio: withCurrentSsa / n, weight: 2 },
      { label: 'Previous-FY SSA available (for impact)', ratio: withPrevSsa / n, weight: 1.5 },
      { label: 'Account ownership mapped', ratio: owned / n, weight: 1 },
      { label: 'Schools clustered', ratio: clustered / n, weight: 0.5 },
      { label: 'Geography complete', ratio: geo / n, weight: 0.5 },
      {
        label: 'IA verification of activities',
        ratio: actsTotal ? actsVerified / actsTotal : 0,
        weight: 1.5,
      },
      {
        label: 'Activity completion recorded',
        ratio: actsTotal ? actsDone / actsTotal : 0,
        weight: 0.5,
      },
    ];
    return { ...combineConfidence(parts), schoolsTotal: n };
  }

  /** Convenience: % helper re-export for services building evidence strings. */
  pct = pct;
}
