import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/auth/auth-user';

const HR_ROLES = new Set(['HumanResources', 'CountryDirector', 'Admin']);

// HR — the staff roster (derived from StaffProfile + assignments) and the leave
// request workflow (request → HR approves/rejects).
@Injectable()
export class HrService {
  constructor(private readonly prisma: PrismaService) {}

  /** Staff roster: who's on the team, their role, onboarding state, portfolio size. */
  async roster() {
    const staff = await this.prisma.staffProfile.findMany({
      where: { deletedAt: null },
      include: {
        user: { select: { name: true, email: true, activeRole: true, isActive: true } },
        primaryDistrict: { select: { name: true } },
        _count: { select: { schoolLinks: true, superviseeLinks: true } },
      },
      take: 500,
    });
    const rows = staff.map((s) => ({
      staffProfileId: s.id, name: s.user.name, email: s.user.email, role: s.user.activeRole,
      onboardingState: s.onboardingState, active: s.user.isActive,
      primaryDistrict: s.primaryDistrict?.name ?? null,
      schools: s._count.schoolLinks, supervisees: s._count.superviseeLinks,
    }));
    const counts = {
      total: rows.length,
      active: rows.filter((r) => r.onboardingState === 'active').length,
      pending: rows.filter((r) => r.onboardingState !== 'active').length,
    };
    return { counts, staff: rows };
  }

  /** Leave requests — HR/CD see all; a staffer sees their own. */
  async listLeave(user: AuthUser) {
    const isHr = HR_ROLES.has(user.activeRole);
    const where = isHr ? {} : { staffProfileId: user.staffProfileId ?? '__none__' };
    const rows = await this.prisma.leave.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 200,
      include: { staff: { include: { user: { select: { name: true } } } } },
    });
    return rows.map((l) => ({
      id: l.id, staffName: l.staff.user.name, type: l.type, startDate: l.startDate, endDate: l.endDate,
      days: l.days, status: l.status, reason: l.reason, createdAt: l.createdAt,
    }));
  }

  async requestLeave(user: AuthUser, body: { type?: string; startDate?: string; endDate?: string; days?: number; reason?: string }) {
    if (!user.staffProfileId) throw new BadRequestException('Only staff with a profile can request leave.');
    if (!body.startDate || !body.endDate) throw new BadRequestException('start and end dates are required.');
    return this.prisma.leave.create({
      data: {
        staffProfileId: user.staffProfileId, type: body.type ?? 'annual',
        startDate: body.startDate, endDate: body.endDate, days: body.days ?? 1, reason: body.reason, status: 'pending',
      },
    });
  }

  async reviewLeave(user: AuthUser, id: string, action: 'approve' | 'reject') {
    if (!HR_ROLES.has(user.activeRole)) throw new ForbiddenException('Only HR / CD can review leave.');
    const leave = await this.prisma.leave.findUnique({ where: { id } });
    if (!leave) throw new NotFoundException('Leave request not found');
    return this.prisma.leave.update({
      where: { id },
      data: { status: action === 'approve' ? 'approved' : 'rejected', reviewedByUserId: user.userId, reviewedAt: new Date() },
    });
  }
}
