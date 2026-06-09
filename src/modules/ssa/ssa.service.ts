import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ScopeService } from '../../common/scope/scope.service';
import { ReadinessService } from '../../common/readiness/readiness.service';
import { AuthUser } from '../../common/auth/auth-user';
import { paginate, PaginationDto } from '../../common/dto/pagination.dto';
import { getOperationalFY, getQuarterForDate } from '../../common/fy/fy.util';
import { UploadSsaDto } from './dto/upload-ssa.dto';

@Injectable()
export class SsaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly scope: ScopeService,
    private readonly readiness: ReadinessService,
  ) {}

  async list(query: PaginationDto, user: AuthUser) {
    const scope = await this.scope.resolveUserScope(user);
    const schoolWhere = this.scope.schoolWhere(scope);
    const schoolIds = scope.countryScope ? undefined : (await this.prisma.school.findMany({ where: { deletedAt: null, ...schoolWhere }, select: { id: true } })).map((s) => s.id);
    const where: Prisma.SsaRecordWhereInput = { deletedAt: null, ...(schoolIds ? { schoolId: { in: schoolIds.length ? schoolIds : ['__none__'] } } : {}) };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.ssaRecord.findMany({ where, skip: query.skip, take: query.take, orderBy: { dateOfSsa: 'desc' }, include: { school: { select: { schoolId: true, name: true } }, scores: true } }),
      this.prisma.ssaRecord.count({ where }),
    ]);
    return paginate(data, total, query);
  }

  async forSchool(schoolId: string, user: AuthUser) {
    const scope = await this.scope.resolveUserScope(user);
    const school = await this.prisma.school.findFirst({ where: { schoolId, deletedAt: null, ...this.scope.schoolWhere(scope) } });
    if (!school) throw new NotFoundException('School not found or outside your scope');
    return this.prisma.ssaRecord.findMany({ where: { schoolId: school.id, deletedAt: null }, orderBy: { dateOfSsa: 'desc' }, include: { scores: true } });
  }

  // IA uploads SSA: derives FY/quarter, writes scores, updates readiness.
  async upload(dto: UploadSsaDto, user: AuthUser) {
    const school = await this.prisma.school.findUnique({ where: { schoolId: dto.schoolId } });
    if (!school) throw new NotFoundException(`School ${dto.schoolId} not in directory`);
    const interventions = new Set(dto.scores.map((s) => s.intervention));
    if (interventions.size !== 8) throw new BadRequestException('All 8 intervention scores are required');

    const date = new Date(dto.dateOfSsa);
    const fy = getOperationalFY(date);
    const quarter = getQuarterForDate(date);
    const average = Math.round((dto.scores.reduce((s, x) => s + x.score, 0) / dto.scores.length) * 10) / 10;

    const record = await this.prisma.ssaRecord.create({
      data: {
        schoolId: school.id, dateOfSsa: date, fy, quarter, newEnrollment: dto.newEnrollment,
        averageScore: average, uploadedBy: user.userId,
        scores: { create: dto.scores.map((s) => ({ intervention: s.intervention, score: s.score })) },
      },
      include: { scores: true },
    });

    if (dto.newEnrollment) {
      await this.prisma.school.update({ where: { id: school.id }, data: { enrollment: dto.newEnrollment } });
      await this.prisma.schoolEnrollmentHistory.upsert({
        where: { schoolId_fy: { schoolId: school.id, fy } }, update: { enrollment: dto.newEnrollment },
        create: { schoolId: school.id, fy, enrollment: dto.newEnrollment },
      });
    }
    // Centralized readiness recompute (§16) — the bridge to planning lists.
    await this.readiness.recompute(school.id);

    await this.audit.log({ action: 'ssa.upload', subjectKind: 'SsaRecord', subjectId: record.id, actorId: user.userId, actorRole: user.activeRole, payload: { schoolId: dto.schoolId, fy, average } });
    return record;
  }

  // ── 10% client-portfolio SSA verification QA (spec §10–§12) ───────
  // Every staff must have ≥10% of their CLIENT portfolio with VERIFIED current-FY
  // SSA. Staff-collected SSA is auto-verified; partner-collected counts only once
  // accepted (verificationStatus=confirmed).
  private readonly QA_RATE = 0.1;

  async verificationRequirements(user: AuthUser, params: { staffId?: string; fy?: string }) {
    const fy = params.fy ?? getOperationalFY();
    const staffId = await this.resolveStaffScope(user, params.staffId);
    if (!staffId) throw new NotFoundException('No staff scope — pass staffId.');
    return this.computeForStaff(staffId, fy);
  }

  private async computeForStaff(staffId: string, fy: string) {
    const clientIds = (await this.prisma.staffSchoolAssignment.findMany({
      where: { staffId, school: { schoolType: 'client', deletedAt: null } },
      select: { schoolId: true },
    })).map((s) => s.schoolId);
    const clientPortfolioCount = clientIds.length;
    const requiredSampleCount = Math.ceil(clientPortfolioCount * this.QA_RATE);
    const inIds = clientIds.length ? clientIds : ['__none__'];
    const [verifiedSampleCount, partnerPending, incomplete] = await Promise.all([
      this.prisma.school.count({ where: { id: { in: inIds }, ssaRecords: { some: { fy, verificationStatus: 'confirmed', deletedAt: null } } } }),
      this.prisma.school.count({ where: { id: { in: inIds }, ssaRecords: { some: { fy, collectorType: 'partner', verificationStatus: 'pending', deletedAt: null } } } }),
      this.prisma.school.count({ where: { id: { in: inIds }, ssaRecords: { none: { fy, deletedAt: null } } } }),
    ]);
    const gap = Math.max(0, requiredSampleCount - verifiedSampleCount);
    const percentage = requiredSampleCount > 0 ? Math.round((verifiedSampleCount / requiredSampleCount) * 100) : 100;
    return {
      staffId, fy, clientPortfolioCount, requiredSampleCount, verifiedSampleCount,
      gap, percentage, meetsRequirement: verifiedSampleCount >= requiredSampleCount,
      partnerPending, schoolsMissingSsa: incomplete,
    };
  }

  // Team/country rollup (spec §12 — IA/CD/PL): per-staff QA + who's below 10%.
  async verificationSummary(user: AuthUser, params: { fy?: string }) {
    const fy = params.fy ?? getOperationalFY();
    const scope = await this.scope.resolveUserScope(user);
    let staffIds: string[];
    if (scope.countryScope || scope.canViewSummaryOnly) {
      staffIds = (await this.prisma.staffProfile.findMany({ where: { deletedAt: null }, select: { id: true } })).map((s) => s.id);
    } else if (user.activeRole === 'CountryProgramLead') {
      staffIds = [...new Set([...scope.supervisedStaffIds, user.staffProfileId].filter((x): x is string => !!x))];
    } else {
      staffIds = user.staffProfileId ? [user.staffProfileId] : [];
    }
    const rows = await Promise.all(staffIds.map((id) => this.computeForStaff(id, fy)));
    const withPortfolio = rows.filter((r) => r.clientPortfolioCount > 0);
    const meeting = withPortfolio.filter((r) => r.meetsRequirement).length;
    return {
      fy,
      staffCount: withPortfolio.length,
      staffMeetingRequirement: meeting,
      staffBelowRequirement: withPortfolio.length - meeting,
      compliancePct: withPortfolio.length ? Math.round((meeting / withPortfolio.length) * 100) : 100,
      totalRequiredSample: withPortfolio.reduce((a, r) => a + r.requiredSampleCount, 0),
      totalVerifiedSample: withPortfolio.reduce((a, r) => a + r.verifiedSampleCount, 0),
      partnerPendingTotal: withPortfolio.reduce((a, r) => a + r.partnerPending, 0),
      belowStaff: withPortfolio.filter((r) => !r.meetsRequirement).sort((a, b) => b.gap - a.gap).slice(0, 25),
    };
  }

  // Self always; PL → supervised; country roles → any staff.
  private async resolveStaffScope(user: AuthUser, requested?: string): Promise<string | null> {
    const self = user.staffProfileId ?? null;
    if (!requested || requested === self) return self;
    const scope = await this.scope.resolveUserScope(user);
    if (scope.countryScope || scope.canViewSummaryOnly) return requested;
    if (user.activeRole === 'CountryProgramLead' && scope.supervisedStaffIds.includes(requested)) return requested;
    return self;
  }
}
