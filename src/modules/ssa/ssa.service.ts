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
}
