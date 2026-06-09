import { Injectable } from '@nestjs/common';
import { PlanningReadiness, School } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { getOperationalFY } from '../fy/fy.util';

// The detailed planning lifecycle stage (§16) — derived, human-readable. The
// coarse School.planningReadiness enum (locked/limited/ready) is the stored gate;
// this label is computed from the school's current state.
export type PlanningStage =
  | 'Account Owner Missing'
  | 'Duplicate Review Pending'
  | 'Unclustered'
  | 'Clustered, SSA Required'
  | 'SIT Scheduled, SSA Missing'
  | 'SSA Complete, Planning Ready'
  | 'Core Package Planning';

@Injectable()
export class ReadinessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Pure: the detailed stage for a school row (no DB). */
  stageFor(school: Pick<School, 'accountOwnerStatus' | 'duplicateStatus' | 'clusterStatus' | 'currentFySsaStatus' | 'schoolType'>): PlanningStage {
    if (school.accountOwnerStatus === 'unmatched') return 'Account Owner Missing';
    if (school.duplicateStatus === 'potential') return 'Duplicate Review Pending';
    if (school.clusterStatus !== 'clustered') return 'Unclustered';
    if (school.currentFySsaStatus === 'scheduled') return 'SIT Scheduled, SSA Missing';
    if (school.currentFySsaStatus !== 'done') return 'Clustered, SSA Required';
    return school.schoolType === 'core' ? 'Core Package Planning' : 'SSA Complete, Planning Ready';
  }

  /** Coarse stored gate. */
  private coarse(clustered: boolean, ssaCurrent: boolean): PlanningReadiness {
    return clustered && ssaCurrent ? 'ready' : clustered ? 'limited' : 'locked';
  }

  /** Recompute and persist a school's readiness from its current state + latest SSA.
   *  Call after every trigger (upload, owner, cluster, ssa, activity, etc.). */
  async recompute(schoolId: string): Promise<{ planningReadiness: PlanningReadiness; stage: PlanningStage }> {
    const school = await this.prisma.school.findUniqueOrThrow({
      where: { id: schoolId },
      include: { ssaRecords: { where: { deletedAt: null }, orderBy: { dateOfSsa: 'desc' }, take: 1 } },
    });
    const latest = school.ssaRecords[0];
    const currentFy = getOperationalFY();
    // INVARIANT (corrected): a COMPLETE current-FY SSA unlocks planning. QA
    // verification is a separate quality-assurance layer (the 10% sample), NOT a
    // planning gate — staff SSA is trusted, partner SSA is usable once complete.
    // We must not delay school support across 15,000+ schools waiting on QA.
    // Completeness is enforced at upload (School ID + 8 intervention scores), so a
    // current-FY record present == complete for the planning gate.
    const ssaComplete = !!latest && latest.fy === currentFy;
    const clustered = !!school.clusterId && school.clusterStatus === 'clustered';

    // Authoritative SSA status — keeps the stored enum and the SSA record from
    // drifting (M3): a current-FY record → done; a stale 'done' with no current
    // record → not_done; otherwise preserve scheduled/partner_assigned.
    let ssaStatus = school.currentFySsaStatus;
    if (ssaComplete) ssaStatus = 'done';
    else if (ssaStatus === 'done') ssaStatus = 'not_done';

    // Planning gate uses COMPLETENESS (not QA verification).
    const planningReadiness = this.coarse(clustered, ssaComplete);
    const updated = await this.prisma.school.update({
      where: { id: schoolId },
      data: {
        clusterStatus: clustered ? 'clustered' : (school.clusterStatus === 'needs_review' ? 'needs_review' : 'unclustered'),
        currentFySsaStatus: ssaStatus,
        planningReadiness,
      },
    });
    return { planningReadiness, stage: this.stageFor(updated) };
  }
}
