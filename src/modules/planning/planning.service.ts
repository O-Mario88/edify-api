import { Injectable } from '@nestjs/common';
import { Prisma, School } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ScopeService } from '../../common/scope/scope.service';
import { ReadinessService } from '../../common/readiness/readiness.service';
import { AuthUser } from '../../common/auth/auth-user';

type Filters = { regionId?: string; districtId?: string; subCountyId?: string; fy?: string };

// Planning consumes the School Directory + cluster status. Unclustered schools
// only appear in "Not Yet Clustered"; clustered-no-SSA in "Clustered, SSA
// Required"; clustered+SSA in "Ready to Plan" / Core Planning. This is the
// bridge from cluster assignment to planning.
@Injectable()
export class PlanningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly readiness: ReadinessService,
  ) {}

  private async baseWhere(user: AuthUser, f: Filters): Promise<Prisma.SchoolWhereInput> {
    const scope = await this.scope.resolveUserScope(user);
    const where: Prisma.SchoolWhereInput = { deletedAt: null, ...this.scope.schoolWhere(scope) };
    if (f.regionId) where.regionId = f.regionId;
    if (f.districtId) where.districtId = f.districtId;
    if (f.subCountyId) where.subCountyId = f.subCountyId;
    return where;
  }

  private item(s: School & { subCounty?: { name: string } | null; accountOwner?: { user: { name: string } } | null }) {
    return {
      schoolId: s.schoolId, name: s.name, schoolType: s.schoolType, districtId: s.districtId,
      subCounty: s.subCounty?.name, owner: s.accountOwner?.user.name, ssaStatus: s.currentFySsaStatus,
      planningReadiness: s.planningReadiness, stage: this.readiness.stageFor(s),
    };
  }

  /** The planning setup buckets (§13/§15) — each consumes cluster + SSA status. */
  async setup(user: AuthUser, f: Filters, sample = 8) {
    const base = await this.baseWhere(user, f);
    const buckets: { key: string; label: string; where: Prisma.SchoolWhereInput }[] = [
      { key: 'notYetClustered', label: 'Not Yet Clustered', where: { ...base, clusterStatus: { in: ['unclustered', 'needs_review'] } } },
      { key: 'clusteredSsaRequired', label: 'Clustered Schools Missing SSA', where: { ...base, clusterStatus: 'clustered', currentFySsaStatus: { in: ['not_done', 'partner_assigned'] } } },
      { key: 'sitScheduledSsaMissing', label: 'SIT Scheduled, SSA Missing', where: { ...base, clusterStatus: 'clustered', currentFySsaStatus: 'scheduled' } },
      { key: 'readyToPlan', label: 'SSA Complete, Ready to Plan', where: { ...base, clusterStatus: 'clustered', currentFySsaStatus: 'done', schoolType: { not: 'core' } } },
      { key: 'coreSchoolPlanning', label: 'Core School Planning', where: { ...base, clusterStatus: 'clustered', currentFySsaStatus: 'done', schoolType: 'core' } },
    ];
    const include = { subCounty: { select: { name: true } }, accountOwner: { include: { user: { select: { name: true } } } } } as const;
    return Promise.all(buckets.map(async (b) => {
      const [count, items] = await this.prisma.$transaction([
        this.prisma.school.count({ where: b.where }),
        this.prisma.school.findMany({ where: b.where, take: sample, orderBy: { name: 'asc' }, include }),
      ]);
      return { key: b.key, label: b.label, count, items: items.map((s) => this.item(s)) };
    }));
  }

  /** Core School Planning accordion sections (§14) — visit/training gaps derived
   *  from completed core activities. Each school lands in its NEXT-needed bucket. */
  async corePlanning(user: AuthUser, f: Filters) {
    const base = await this.baseWhere(user, f);
    const cores = await this.prisma.school.findMany({
      where: { ...base, schoolType: 'core' },
      include: {
        subCounty: { select: { name: true } }, accountOwner: { include: { user: { select: { name: true } } } },
        activities: { where: { deletedAt: null, activityType: { in: ['core_visit', 'core_training'] } }, select: { activityType: true, status: true } },
        ssaRecords: { where: { deletedAt: null }, orderBy: { dateOfSsa: 'desc' }, take: 1 },
      },
    });

    const sections: Record<string, { label: string; schools: unknown[] }> = {
      missingSsa: { label: 'Core Schools Missing SSA', schools: [] },
      ready: { label: 'Core Schools Ready for Planning', schools: [] },
      missingVisit1: { label: 'Missing Visit 1', schools: [] }, missingVisit2: { label: 'Missing Visit 2', schools: [] },
      missingVisit3: { label: 'Missing Visit 3', schools: [] }, missingVisit4: { label: 'Missing Visit 4', schools: [] },
      missingTraining1: { label: 'Missing Training 1', schools: [] }, missingTraining2: { label: 'Missing Training 2', schools: [] },
      missingTraining3: { label: 'Missing Training 3', schools: [] }, missingTraining4: { label: 'Missing Training 4', schools: [] },
      fullPackage: { label: 'Full Core Package Complete', schools: [] },
      potentialChampion: { label: 'Potential Champion Schools', schools: [] },
    };

    for (const s of cores) {
      const visits = s.activities.filter((a) => a.activityType === 'core_visit' && a.status === 'completed').length;
      const trainings = s.activities.filter((a) => a.activityType === 'core_training' && a.status === 'completed').length;
      const latest = s.ssaRecords[0];
      const ssaCurrent = s.currentFySsaStatus === 'done';
      const card = {
        schoolId: s.schoolId, name: s.name, district: s.districtId, subCounty: s.subCounty?.name,
        cluster: s.clusterId ? 'clustered' : 'unclustered', owner: s.accountOwner?.user.name,
        ssaStatus: s.currentFySsaStatus, latestSsa: latest?.averageScore ?? null,
        visitProgress: `${visits}/4`, trainingProgress: `${trainings}/4`,
        nextAction: !ssaCurrent ? 'Upload SSA' : visits < 4 ? `Schedule Visit ${visits + 1}` : trainings < 4 ? `Schedule Training ${trainings + 1}` : 'Follow-Up SSA',
      };

      if (!ssaCurrent || !s.clusterId) { sections.missingSsa.schools.push(card); continue; }
      if (visits === 0 && trainings === 0) sections.ready.schools.push(card);
      if (visits < 4) sections[`missingVisit${visits + 1}` as keyof typeof sections].schools.push(card);
      if (trainings < 4) sections[`missingTraining${trainings + 1}` as keyof typeof sections].schools.push(card);
      if (visits >= 4 && trainings >= 4) {
        sections.fullPackage.schools.push(card);
        if ((latest?.averageScore ?? 0) >= 8) sections.potentialChampion.schools.push(card);
      }
    }

    return Object.entries(sections).map(([key, v]) => ({ key, label: v.label, count: v.schools.length, schools: v.schools }));
  }

  /** Recalculate a single school's readiness on demand (admin/IA/CD). */
  recompute(schoolId: string) {
    return this.prisma.school.findUnique({ where: { schoolId }, select: { id: true } }).then((s) => {
      if (!s) throw new Error('not found');
      return this.readiness.recompute(s.id);
    });
  }
}
