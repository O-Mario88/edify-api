import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ScopeService } from '../../common/scope/scope.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthUser } from '../../common/auth/auth-user';

// Special Projects — interventions/pilots that span schools + partners, with
// impact snapshots. Reads the real Project graph; scoped so non-country roles
// only see projects touching schools in their scope.
@Injectable()
export class SpecialProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  async list(user: AuthUser) {
    const scope = await this.scope.resolveUserScope(user);
    const where: Prisma.ProjectWhereInput = { deletedAt: null };
    if (!scope.countryScope && !scope.canViewSummaryOnly) {
      where.schoolAssignments = { some: { school: this.scope.aggregateSchoolWhere(scope) } };
    }
    const projects = await this.prisma.project.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { schoolAssignments: true, partnerAssignments: true, activities: true } },
        impactSnapshots: { orderBy: { fy: 'desc' }, take: 1 },
      },
    });
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      intervention: p.intervention,
      managerStaffId: p.managerStaffId,
      schoolCount: p._count.schoolAssignments,
      partnerCount: p._count.partnerAssignments,
      activityCount: p._count.activities,
      latestImpact: (p.impactSnapshots[0]?.metricsJson as unknown) ?? null,
      latestImpactFy: p.impactSnapshots[0]?.fy ?? null,
    }));
  }

  async getOne(id: string, user: AuthUser) {
    const scope = await this.scope.resolveUserScope(user);
    const p = await this.prisma.project.findFirst({
      where: { id, deletedAt: null },
      include: {
        schoolAssignments: {
          include: { school: { select: { schoolId: true, name: true, schoolType: true, currentFySsaStatus: true, district: { select: { name: true } } } } },
        },
        partnerAssignments: { include: { partner: { select: { id: true, name: true, isCertified: true, certificationStatus: true } } } },
        impactSnapshots: { orderBy: { fy: 'desc' } },
      },
    });
    if (!p) throw new NotFoundException('Project not found');

    // Scope: non-country roles must have at least one project school in scope.
    if (!scope.countryScope && !scope.canViewSummaryOnly) {
      const inScopeIds = new Set(
        (await this.prisma.school.findMany({ where: this.scope.aggregateSchoolWhere(scope), select: { id: true } })).map((s) => s.id),
      );
      const touches = p.schoolAssignments.some((a) => inScopeIds.has(a.schoolId));
      if (!touches) throw new NotFoundException('Project not in your scope');
    }

    return {
      id: p.id, name: p.name, category: p.category, intervention: p.intervention, managerStaffId: p.managerStaffId,
      schools: p.schoolAssignments.map((a) => ({
        schoolId: a.school.schoolId, name: a.school.name, schoolType: a.school.schoolType,
        district: a.school.district?.name ?? null, ssaStatus: a.school.currentFySsaStatus,
      })),
      partners: p.partnerAssignments.map((a) => ({ id: a.partner.id, name: a.partner.name, isCertified: a.partner.isCertified, certificationStatus: a.partner.certificationStatus })),
      impactSnapshots: p.impactSnapshots.map((s) => ({ fy: s.fy, metrics: s.metricsJson })),
    };
  }

  // ── Assignment (the ONLY backend write path for project schools) ──────────
  // INVARIANT: special-project schools come ONLY from the School Directory.
  // `schoolId` here is the business School ID (e.g. "40118") the Directory uses;
  // we resolve it to a real School row and reject anything not in the Directory.
  async assignSchool(user: AuthUser, projectId: string, schoolBizId: string) {
    const project = await this.prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true, name: true } });
    if (!project) throw new NotFoundException('Project not found');

    const id = (schoolBizId ?? '').trim();
    if (!id) throw new NotFoundException('schoolId is required');
    const school = await this.prisma.school.findFirst({ where: { schoolId: id }, select: { id: true, schoolId: true, name: true } });
    if (!school) throw new NotFoundException(`School ${id} is not in the School Directory — assign it from the Directory only.`);

    const assignment = await this.prisma.projectSchoolAssignment.upsert({
      where: { projectId_schoolId: { projectId: project.id, schoolId: school.id } },
      create: { projectId: project.id, schoolId: school.id },
      update: {},
    });
    await this.audit.log({
      action: 'project.assignSchool', subjectKind: 'Project', subjectId: project.id,
      actorId: user.userId, actorRole: user.activeRole,
      payload: { schoolId: school.schoolId, schoolName: school.name, projectName: project.name },
    });
    return { ok: true, assignmentId: assignment.id, projectId: project.id, schoolId: school.schoolId };
  }

  async removeSchool(user: AuthUser, projectId: string, schoolBizId: string) {
    const school = await this.prisma.school.findFirst({ where: { schoolId: (schoolBizId ?? '').trim() }, select: { id: true, schoolId: true } });
    if (!school) throw new NotFoundException(`School ${schoolBizId} is not in the School Directory.`);
    await this.prisma.projectSchoolAssignment.deleteMany({ where: { projectId, schoolId: school.id } });
    await this.audit.log({
      action: 'project.removeSchool', subjectKind: 'Project', subjectId: projectId,
      actorId: user.userId, actorRole: user.activeRole, payload: { schoolId: school.schoolId },
    });
    return { ok: true, projectId, schoolId: school.schoolId };
  }
}
