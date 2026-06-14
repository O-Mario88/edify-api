import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { getOperationalFY } from '../../common/fy/fy.util';
import { DONE_STATUSES } from '../targets/targets-config';
import {
  clamp01,
  clamp100,
  combineConfidence,
  REF_CORE_PER_STAFF,
  REF_PARTNERS_PER_STAFF,
  REF_SCHOOLS_PER_STAFF,
} from './leadership.types';

// The Staff Context Index — the fairness model. It adjusts how raw achievement
// should be READ, by quantifying work difficulty. Rural/urban and travel
// distance are NOT in the data model yet, so ruralityScore and distanceBurden
// stay NULL ("insufficient data") rather than being faked; the geocoding phase
// fills distanceBurden. Everything else is computed from real load + spread.
@Injectable()
export class ContextFairnessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Recompute + upsert StaffContextProfile for every active staff member. */
  async computeAll(fy = getOperationalFY()): Promise<number> {
    const staff = await this.prisma.staffProfile.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        schoolLinks: {
          select: { school: { select: { schoolType: true, districtId: true, subCountyId: true } } },
        },
      },
    });
    if (!staff.length) return 0;

    const acts = await this.prisma.activity.findMany({
      where: { deletedAt: null, fy, responsibleStaffId: { not: null } },
      select: {
        responsibleStaffId: true,
        assignedPartnerId: true,
        projectId: true,
        rescheduleCount: true,
        evidenceStatus: true,
        status: true,
      },
    });
    const byStaff = new Map<string, typeof acts>();
    for (const a of acts) {
      const k = a.responsibleStaffId as string;
      (byStaff.get(k) ?? byStaff.set(k, []).get(k)!).push(a);
    }

    for (const s of staff) {
      const schools = s.schoolLinks.map((l) => l.school);
      const schoolLoad = schools.length;
      const coreSchoolLoad = schools.filter((sc) => sc.schoolType === 'core' || sc.schoolType === 'potential_core').length;
      const clientSchoolLoad = schools.filter((sc) => sc.schoolType === 'client').length;
      const districtSpread = new Set(schools.map((sc) => sc.districtId)).size;
      const subCountySpread = new Set(schools.map((sc) => sc.subCountyId).filter(Boolean)).size;

      const mine = byStaff.get(s.id) ?? [];
      const partnerManagementLoad = new Set(mine.map((a) => a.assignedPartnerId).filter(Boolean)).size;
      const projectLoad = new Set(mine.map((a) => a.projectId).filter(Boolean)).size;
      const rescheduleLoad = mine.reduce((t, a) => t + (a.rescheduleCount ?? 0), 0);
      const evidenceBacklog = mine.filter(
        (a) => (a.evidenceStatus === 'none' || a.evidenceStatus === 'returned') && !DONE_STATUSES.includes(a.status),
      ).length;

      // Difficulty composite (0..100) from normalized load + geographic spread.
      const loadScore = clamp01(schoolLoad / REF_SCHOOLS_PER_STAFF);
      const coreScore = clamp01(coreSchoolLoad / REF_CORE_PER_STAFF);
      const partnerScore = clamp01(partnerManagementLoad / REF_PARTNERS_PER_STAFF);
      const spreadScore = clamp01((Math.max(districtSpread, 1) - 1) / 4); // 5+ districts = max
      const projectScore = clamp01(projectLoad / 3);
      const contextDifficultyScore = clamp100(
        (loadScore * 0.35 + coreScore * 0.2 + partnerScore * 0.15 + spreadScore * 0.2 + projectScore * 0.1) * 100,
      );
      const geographyDifficulty = clamp100(spreadScore * 100);

      // Context data-confidence: deliberately dragged down by the two ABSENT
      // dimensions so leadership sees the fairness model is partially blind.
      const dataConfidence = combineConfidence([
        { label: 'Workload inputs', ratio: 1, weight: 2 },
        { label: 'Geographic spread', ratio: 1, weight: 1 },
        { label: 'Rural/urban classification', ratio: 0, weight: 0.75 },
        { label: 'Travel distance', ratio: 0, weight: 0.75 },
      ]).score;

      await this.prisma.staffContextProfile.upsert({
        where: { staffId_fy_quarter: { staffId: s.id, fy, quarter: 'FY' } },
        update: {
          schoolLoad, clientSchoolLoad, coreSchoolLoad, partnerManagementLoad, projectLoad,
          districtSpread, subCountySpread, rescheduleLoad, evidenceBacklog,
          geographyDifficulty, ruralityScore: null, distanceBurden: null,
          teamContributionScore: 0, contextDifficultyScore, dataConfidence,
          computedAt: new Date(),
        },
        create: {
          staffId: s.id, fy, quarter: 'FY',
          schoolLoad, clientSchoolLoad, coreSchoolLoad, partnerManagementLoad, projectLoad,
          districtSpread, subCountySpread, rescheduleLoad, evidenceBacklog,
          geographyDifficulty, ruralityScore: null, distanceBurden: null,
          teamContributionScore: 0, contextDifficultyScore, dataConfidence,
        },
      });
    }
    return staff.length;
  }
}
