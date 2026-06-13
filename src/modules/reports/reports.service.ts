import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/auth/auth-user';

const TYPES = new Set(['program_summary', 'ssa_performance', 'activity_pipeline']);

// Reports — a generated, PERSISTED summary computed from live program data.
// Generating one snapshots the current numbers into a Report row so leadership
// has a dated record (not a live re-query each view).
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(_user: AuthUser) {
    const rows = await this.prisma.report.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((r) => ({ id: r.id, title: r.title, type: r.type, fy: r.fy, scope: r.scope, createdAt: r.createdAt }));
  }

  async getOne(id: string) {
    const r = await this.prisma.report.findUnique({ where: { id } });
    if (!r) throw new NotFoundException('Report not found');
    return r;
  }

  /** Compute the summary for a type from live data, then persist + return it. */
  async generate(user: AuthUser, type: string, fy: string) {
    if (!TYPES.has(type)) throw new BadRequestException(`Unknown report type: ${type}`);
    const summary = await this.compute(type, fy);
    const title = `${TITLE[type]} · FY ${fy}`;
    const report = await this.prisma.report.create({
      data: { title, type, fy, scope: 'country', createdByUserId: user.userId, summaryJson: summary as Prisma.InputJsonObject },
    });
    return report;
  }

  private async compute(type: string, fy: string): Promise<Record<string, unknown>> {
    if (type === 'program_summary') {
      const where = { deletedAt: null };
      const [schools, core, client, ready, unclustered, ssaDone] = await Promise.all([
        this.prisma.school.count({ where }),
        this.prisma.school.count({ where: { ...where, schoolType: 'core' } }),
        this.prisma.school.count({ where: { ...where, schoolType: 'client' } }),
        this.prisma.school.count({ where: { ...where, planningReadiness: 'ready' } }),
        this.prisma.school.count({ where: { ...where, clusterStatus: 'unclustered' } }),
        this.prisma.school.count({ where: { ...where, currentFySsaStatus: 'done' } }),
      ]);
      return { schools, coreSchools: core, clientSchools: client, planningReady: ready, unclustered, ssaDone };
    }
    if (type === 'activity_pipeline') {
      const grouped = await this.prisma.activity.groupBy({ by: ['status'], where: { deletedAt: null, fy }, _count: { _all: true } });
      const total = grouped.reduce((s, g) => s + g._count._all, 0);
      return { fy, total, byStatus: grouped.map((g) => ({ status: g.status, count: g._count._all })) };
    }
    // ssa_performance — average per intervention across the latest SSA per school.
    const scores = await this.prisma.ssaScore.groupBy({ by: ['intervention'], _avg: { score: true }, _count: { _all: true } });
    return { fy, byIntervention: scores.map((s) => ({ intervention: s.intervention, average: s._avg.score ? Math.round(s._avg.score * 10) / 10 : null, n: s._count._all })) };
  }
}

const TITLE: Record<string, string> = {
  program_summary: 'Program Summary',
  ssa_performance: 'SSA Performance',
  activity_pipeline: 'Activity Pipeline',
};
