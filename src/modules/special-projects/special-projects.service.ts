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
      code: p.code,
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
    // DB-side existence check (no loading the whole in-scope school set).
    if (!scope.countryScope && !scope.canViewSummaryOnly) {
      const inScope = await this.prisma.projectSchoolAssignment.count({
        where: { projectId: p.id, school: this.scope.aggregateSchoolWhere(scope) },
      });
      if (inScope === 0) throw new NotFoundException('Project not in your scope');
    }

    return {
      id: p.id, code: p.code, name: p.name, category: p.category, intervention: p.intervention, managerStaffId: p.managerStaffId,
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
  // Resolve a project by either its cuid or its business code (e.g. SP-EDTECH).
  private async resolveProject(projectIdOrCode: string) {
    const key = (projectIdOrCode ?? '').trim();
    if (!key) return null;
    return this.prisma.project.findFirst({
      where: { deletedAt: null, OR: [{ id: key }, { code: key }] },
      select: { id: true, name: true, code: true, intervention: true },
    });
  }

  async assignSchool(user: AuthUser, projectId: string, schoolBizId: string) {
    const project = await this.resolveProject(projectId);
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
    const project = await this.resolveProject(projectId);
    if (!project) throw new NotFoundException('Project not found');
    const school = await this.prisma.school.findFirst({ where: { schoolId: (schoolBizId ?? '').trim() }, select: { id: true, schoolId: true } });
    if (!school) throw new NotFoundException(`School ${schoolBizId} is not in the School Directory.`);
    await this.prisma.projectSchoolAssignment.deleteMany({ where: { projectId: project.id, schoolId: school.id } });
    await this.audit.log({
      action: 'project.removeSchool', subjectKind: 'Project', subjectId: project.id,
      actorId: user.userId, actorRole: user.activeRole, payload: { schoolId: school.schoolId },
    });
    return { ok: true, projectId: project.id, schoolId: school.schoolId };
  }

  // ─── Impact: how the project is improving its target SSA intervention ───
  // Per assigned school: baseline (first SSA) vs latest SSA on the project's
  // intervention (or the SSA average when the project has no single target).
  async impact(projectId: string) {
    const project = await this.resolveProject(projectId);
    if (!project) throw new NotFoundException('Project not found');
    const intervention = project.intervention;
    const assignments = await this.prisma.projectSchoolAssignment.findMany({
      where: { projectId: project.id },
      include: {
        school: {
          select: {
            schoolId: true, name: true,
            ssaRecords: { where: { deletedAt: null }, orderBy: { dateOfSsa: 'asc' }, include: { scores: true } },
          },
        },
      },
    });
    type SsaRec = (typeof assignments)[number]['school']['ssaRecords'][number];
    const scoreOf = (rec: SsaRec | undefined) => {
      if (!rec) return null;
      if (!intervention) return rec.averageScore ?? null;
      return rec.scores.find((s) => s.intervention === intervention)?.score ?? null;
    };
    const schools = assignments.map((a) => {
      const recs = a.school.ssaRecords;
      const first = recs[0];
      const last = recs[recs.length - 1];
      const baseline = scoreOf(first);
      const latest = scoreOf(last);
      const delta = baseline != null && latest != null ? Math.round((latest - baseline) * 10) / 10 : null;
      return { schoolId: a.school.schoolId, name: a.school.name, baseline, latest, delta, ssaCount: recs.length };
    });
    const measured = schools.filter((s) => s.delta != null) as { delta: number }[];
    const improvedCount = measured.filter((s) => s.delta > 0).length;
    const avgDelta = measured.length ? Math.round((measured.reduce((s, r) => s + r.delta, 0) / measured.length) * 10) / 10 : null;
    return {
      projectId: project.id, name: project.name, intervention,
      schoolCount: schools.length, measuredCount: measured.length, improvedCount, avgDelta, schools,
    };
  }

  // ─── Partner monitoring (assign / remove / activity progress) ───────
  async assignPartner(user: AuthUser, projectId: string, partnerId: string) {
    const project = await this.resolveProject(projectId);
    if (!project) throw new NotFoundException('Project not found');
    const partner = await this.prisma.partner.findUnique({ where: { id: partnerId }, select: { id: true, name: true } });
    if (!partner) throw new NotFoundException('Partner not found');
    const existing = await this.prisma.projectPartnerAssignment.findFirst({ where: { projectId: project.id, partnerId } });
    const a = existing ?? (await this.prisma.projectPartnerAssignment.create({ data: { projectId: project.id, partnerId } }));
    await this.audit.log({ action: 'project.assignPartner', subjectKind: 'Project', subjectId: project.id, actorId: user.userId, actorRole: user.activeRole, payload: { partnerId, partnerName: partner.name } });
    return { ok: true, assignmentId: a.id, partnerId };
  }

  async removePartner(user: AuthUser, projectId: string, partnerId: string) {
    const project = await this.resolveProject(projectId);
    if (!project) throw new NotFoundException('Project not found');
    await this.prisma.projectPartnerAssignment.deleteMany({ where: { projectId: project.id, partnerId } });
    await this.audit.log({ action: 'project.removePartner', subjectKind: 'Project', subjectId: project.id, actorId: user.userId, actorRole: user.activeRole, payload: { partnerId } });
    return { ok: true, projectId: project.id, partnerId };
  }

  /** Partners on a project + their delivery progress (project activities by partner). */
  async partners(projectId: string) {
    const project = await this.resolveProject(projectId);
    if (!project) throw new NotFoundException('Project not found');
    const assigned = await this.prisma.projectPartnerAssignment.findMany({
      where: { projectId: project.id },
      include: { partner: { select: { id: true, name: true, isCertified: true, certificationStatus: true } } },
    });
    const acts = await this.prisma.activity.findMany({
      where: { projectId: project.id, assignedPartnerId: { not: null }, deletedAt: null },
      select: { assignedPartnerId: true, status: true },
    });
    const byPartner = new Map<string, { total: number; completed: number }>();
    for (const a of acts) {
      const m = byPartner.get(a.assignedPartnerId as string) ?? { total: 0, completed: 0 };
      m.total += 1;
      if (['completed', 'paid', 'closed', 'verified'].includes(a.status)) m.completed += 1;
      byPartner.set(a.assignedPartnerId as string, m);
    }
    return assigned.map((p) => ({
      id: p.partner.id, name: p.partner.name, isCertified: p.partner.isCertified, certificationStatus: p.partner.certificationStatus,
      activityTotal: byPartner.get(p.partner.id)?.total ?? 0,
      activityCompleted: byPartner.get(p.partner.id)?.completed ?? 0,
    }));
  }
}
