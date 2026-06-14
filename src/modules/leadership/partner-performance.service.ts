import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { getOperationalFY } from '../../common/fy/fy.util';
import { DONE_STATUSES } from '../targets/targets-config';
import { clamp100, combineConfidence, pct } from './leadership.types';

export interface PartnerPerfRow {
  partnerId: string;
  partnerName: string;
  assignedActivities: number;
  completedActivities: number;
  targetAchievementRate: number;
  evidenceAcceptanceRate: number;
  iaConfirmationRate: number;
  returnedEvidenceCount: number;
  rescheduleRate: number;
  overdueRate: number;
  capacityUtilization: number;
  interventionImpactScore: number | null; // null = insufficient SSA pairs
  assignedInterventions: string[];
  recommendationStatus: string;
  dataConfidence: number;
}

const REF_PARTNER_ACTIVITY_CAPACITY = 30;

// Partner performance, measured ONLY against the partner's assigned
// interventions. Impact is null when too few prev→current SSA pairs exist —
// the engine never judges a partner on data it does not have.
@Injectable()
export class PartnerPerformanceService {
  constructor(private readonly prisma: PrismaService) {}

  async computeAll(fy = getOperationalFY(), now = new Date()): Promise<PartnerPerfRow[]> {
    const prevFy = String(Number(fy) - 1);
    const partners = await this.prisma.partner.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, expertiseAreas: true, activeStatus: true },
    });
    const rows: PartnerPerfRow[] = [];

    for (const p of partners) {
      const acts = await this.prisma.activity.findMany({
        where: { deletedAt: null, fy, assignedPartnerId: p.id },
        select: {
          schoolId: true, status: true, scheduledDate: true, rescheduleCount: true,
          evidenceStatus: true, iaVerificationStatus: true,
        },
      });
      const assigned = acts.length;
      const completed = acts.filter((a) => DONE_STATUSES.includes(a.status)).length;
      const accepted = acts.filter((a) => a.evidenceStatus === 'accepted').length;
      const submitted = acts.filter((a) => a.evidenceStatus !== 'none').length;
      const returnedEvidenceCount = acts.filter((a) => a.evidenceStatus === 'returned').length;
      const iaConfirmed = acts.filter((a) => a.iaVerificationStatus === 'confirmed').length;
      const overdue = acts.filter(
        (a) => a.scheduledDate && a.scheduledDate < now && !DONE_STATUSES.includes(a.status),
      ).length;
      const rescheduled = acts.filter((a) => (a.rescheduleCount ?? 0) > 0).length;

      const targetAchievementRate = clamp100(pct(completed, assigned));
      const evidenceAcceptanceRate = clamp100(pct(accepted, submitted));
      const iaConfirmationRate = clamp100(pct(iaConfirmed, completed));
      const rescheduleRate = clamp100(pct(rescheduled, assigned));
      const overdueRate = clamp100(pct(overdue, assigned));
      const capacityUtilization = clamp100(pct(assigned, REF_PARTNER_ACTIVITY_CAPACITY));

      // Impact: % of partner-supported schools whose SSA improved prev→current.
      const supportedSchoolIds = [...new Set(acts.map((a) => a.schoolId).filter(Boolean))] as string[];
      let interventionImpactScore: number | null = null;
      if (supportedSchoolIds.length) {
        const ssa = await this.prisma.ssaRecord.findMany({
          where: { deletedAt: null, schoolId: { in: supportedSchoolIds }, fy: { in: [prevFy, fy] } },
          select: { schoolId: true, fy: true, averageScore: true },
        });
        const bySchool = new Map<string, { prev?: number; curr?: number }>();
        for (const r of ssa) {
          const e = bySchool.get(r.schoolId) ?? {};
          if (r.fy === prevFy && r.averageScore != null) e.prev = r.averageScore;
          if (r.fy === fy && r.averageScore != null) e.curr = r.averageScore;
          bySchool.set(r.schoolId, e);
        }
        const pairs = [...bySchool.values()].filter((e) => e.prev != null && e.curr != null);
        if (pairs.length >= 3) {
          const improved = pairs.filter((e) => (e.curr as number) - (e.prev as number) > 0.05).length;
          interventionImpactScore = clamp100(pct(improved, pairs.length));
        }
      }

      const dataConfidence = combineConfidence([
        { label: 'Assigned activities present', ratio: assigned > 0 ? 1 : 0, weight: 1.5 },
        { label: 'Evidence data present', ratio: submitted > 0 ? 1 : 0, weight: 1 },
        { label: 'SSA impact measurable', ratio: interventionImpactScore != null ? 1 : 0, weight: 1.5 },
        { label: 'Assigned interventions defined', ratio: p.expertiseAreas.length ? 1 : 0, weight: 1 },
      ]).score;

      const recommendationStatus = recommendPartnerAction({
        assigned, targetAchievementRate, evidenceAcceptanceRate, interventionImpactScore,
        overdueRate, capacityUtilization, active: p.activeStatus,
      });

      await this.prisma.partnerPerformanceProfile.upsert({
        where: { partnerId_fy_quarter: { partnerId: p.id, fy, quarter: 'FY' } },
        update: {
          assignedActivities: assigned, completedActivities: completed,
          targetAchievementRate, evidenceAcceptanceRate, iaConfirmationRate, returnedEvidenceCount,
          rescheduleRate, overdueRate, capacityUtilization, interventionImpactScore,
          assignedInterventions: p.expertiseAreas, recommendationStatus, dataConfidence,
          computedAt: now,
        },
        create: {
          partnerId: p.id, fy, quarter: 'FY',
          assignedActivities: assigned, completedActivities: completed,
          targetAchievementRate, evidenceAcceptanceRate, iaConfirmationRate, returnedEvidenceCount,
          rescheduleRate, overdueRate, capacityUtilization, interventionImpactScore,
          assignedInterventions: p.expertiseAreas, recommendationStatus, dataConfidence,
        },
      });

      rows.push({
        partnerId: p.id, partnerName: p.name, assignedActivities: assigned, completedActivities: completed,
        targetAchievementRate, evidenceAcceptanceRate, iaConfirmationRate, returnedEvidenceCount,
        rescheduleRate, overdueRate, capacityUtilization, interventionImpactScore,
        assignedInterventions: p.expertiseAreas, recommendationStatus, dataConfidence,
      });
    }
    return rows;
  }
}

// The engine RECOMMENDS a posture; it never terminates an MOU. Termination
// REVIEW is only ever suggested on MULTIPLE poor signals together, never one.
export function recommendPartnerAction(m: {
  assigned: number;
  targetAchievementRate: number;
  evidenceAcceptanceRate: number;
  interventionImpactScore: number | null;
  overdueRate: number;
  capacityUtilization: number;
  active: boolean;
}): string {
  if (!m.active) return 'inactive';
  if (m.assigned === 0) return 'no_assignments';
  const weakTarget = m.targetAchievementRate < 50;
  const weakEvidence = m.evidenceAcceptanceRate < 70;
  const weakImpact = m.interventionImpactScore != null && m.interventionImpactScore < 40;
  const strong = m.targetAchievementRate >= 80 && m.evidenceAcceptanceRate >= 85 && (m.interventionImpactScore == null || m.interventionImpactScore >= 50);

  if (strong) return 'renew';
  if (m.capacityUtilization > 100 || m.overdueRate > 30) return 'reduce_or_pause';
  // Terminate REVIEW requires several poor signals at once — never a single metric.
  if (weakTarget && weakEvidence && (weakImpact || m.interventionImpactScore == null)) return 'terminate_review';
  if (m.targetAchievementRate >= 65) return 'renew_with_conditions';
  return 'improvement_plan';
}
