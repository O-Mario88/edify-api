import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DomainEventService } from '../../common/realtime/domain-events.service';
import { AuthUser } from '../../common/auth/auth-user';

const HR_ROLES = new Set(['HumanResources', 'CountryDirector', 'Admin']);

/** Inclusive list of ISO yyyy-mm-dd dates between start and end (capped at 60). */
function expandDates(start: string, end: string): string[] {
  const s = new Date(`${start}T00:00:00Z`);
  const e = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e < s) return [];
  const out: string[] = [];
  for (let d = new Date(s), i = 0; d <= e && i < 60; d.setUTCDate(d.getUTCDate() + 1), i++) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// HR — the staff roster (derived from StaffProfile + assignments) and the leave
// request workflow (request → HR approves/rejects).
@Injectable()
export class HrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEventService,
  ) {}

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
    const leave = await this.prisma.leave.create({
      data: {
        staffProfileId: user.staffProfileId, type: body.type ?? 'annual',
        startDate: body.startDate, endDate: body.endDate, days: body.days ?? 1, reason: body.reason, status: 'pending',
      },
    });
    // Close the handoff: route the request into the HR review queue (it was
    // silently created with no signal to anyone who can approve it).
    const hrUserIds = await this.events.usersWithRole('HumanResources');
    await this.events.emit({
      type: 'LeaveRequested', actorId: user.userId, actorRole: user.activeRole,
      subjectKind: 'Leave', subjectId: leave.id, payload: { type: leave.type, days: leave.days },
      notify: hrUserIds.map((rid) => ({
        recipientId: rid, title: 'Leave request to review',
        body: `${user.name}: ${leave.type} leave, ${leave.days} day(s).`,
        targetRoute: '/dashboards/hr', actionRequired: true, priority: 'normal' as const,
      })),
      liveUserIds: [user.userId, ...hrUserIds],
    });
    return leave;
  }

  /** Approved leave shaped for the calendar / planning-availability engine.
   *  Each entry carries the inclusive day list so the calendar can render it
   *  and the planner can block those days. Scoped like listLeave (HR/CD see
   *  the team, a staffer sees their own). */
  async approvedLeaveCalendar(user: AuthUser, from?: string, to?: string) {
    const isHr = HR_ROLES.has(user.activeRole);
    const where = {
      status: 'approved' as const,
      ...(isHr ? {} : { staffProfileId: user.staffProfileId ?? '__none__' }),
    };
    const rows = await this.prisma.leave.findMany({
      where, orderBy: { startDate: 'asc' }, take: 500,
      include: { staff: { include: { user: { select: { name: true } } } } },
    });
    return rows
      .map((l) => ({
        id: l.id, staffName: l.staff.user.name, staffProfileId: l.staffProfileId,
        type: l.type, startDate: l.startDate, endDate: l.endDate,
        dates: expandDates(l.startDate, l.endDate),
      }))
      .filter((l) => l.dates.length > 0)
      .filter((l) => !from || !to || l.dates.some((d) => d >= from && d <= to));
  }

  async reviewLeave(user: AuthUser, id: string, action: 'approve' | 'reject') {
    if (!HR_ROLES.has(user.activeRole)) throw new ForbiddenException('Only HR / CD can review leave.');
    const leave = await this.prisma.leave.findUnique({ where: { id } });
    if (!leave) throw new NotFoundException('Leave request not found');
    const updated = await this.prisma.leave.update({
      where: { id },
      data: { status: action === 'approve' ? 'approved' : 'rejected', reviewedByUserId: user.userId, reviewedAt: new Date() },
    });

    // Scenario A: on approval, scan the staffer's plan for activities scheduled
    // INSIDE the leave window so the conflict surfaces (it was pure mock theater
    // before — the "auto-blocked conflicts" card read a mock store).
    let conflictCount = 0;
    if (action === 'approve') {
      const leaveDays = expandDates(leave.startDate, leave.endDate);
      if (leaveDays.length) {
        conflictCount = await this.prisma.monthlyPlanActivity.count({
          where: {
            scheduledDate: { in: leaveDays },
            status: { notIn: ['Completed', 'Cancelled'] },
            plan: { ownerStaffId: leave.staffProfileId },
          },
        });
      }
    }

    const staffUserId = await this.events.userForStaff(leave.staffProfileId);
    // On approval also notify the staffer's SUPERVISOR (PL/CCEO) who owns the
    // re-planning — previously only the requester was told.
    const supLink =
      action === 'approve'
        ? await this.prisma.staffSupervisorAssignment.findFirst({ where: { superviseeId: leave.staffProfileId }, select: { supervisorId: true } })
        : null;
    const supervisorUserId = supLink ? await this.events.userForStaff(supLink.supervisorId) : null;

    const notify: { recipientId: string; title: string; body: string; targetRoute?: string; actionRequired?: boolean; priority: 'normal' | 'high' }[] = [];
    if (staffUserId) {
      notify.push({
        recipientId: staffUserId,
        title: `Leave ${updated.status}`,
        body:
          action === 'approve' && conflictCount
            ? `Your ${leave.type} leave was approved. ${conflictCount} planned activit${conflictCount === 1 ? 'y' : 'ies'} fall in this window — reschedule them.`
            : `Your ${leave.type} leave request was ${updated.status}.`,
        priority: conflictCount ? 'high' : 'normal',
      });
    }
    if (supervisorUserId) {
      notify.push({
        recipientId: supervisorUserId,
        title: `${leave.type} leave approved for your team`,
        body: `A supervised staff member is on leave ${leave.startDate}→${leave.endDate}${conflictCount ? ` — ${conflictCount} of their planned activit${conflictCount === 1 ? 'y' : 'ies'} conflict and need re-planning.` : '.'}`,
        targetRoute: '/team-plan',
        actionRequired: conflictCount > 0,
        priority: conflictCount ? 'high' : 'normal',
      });
    }
    if (notify.length) {
      await this.events.emit({
        type: action === 'approve' ? 'LeaveApproved' : 'LeaveReviewed',
        actorId: user.userId, actorRole: user.activeRole, subjectKind: 'Leave', subjectId: id,
        payload: { status: updated.status, conflictCount },
        notify,
        liveUserIds: [user.userId, staffUserId, supervisorUserId].filter((x): x is string => !!x),
      });
    }
    return { ...updated, conflictCount };
  }
}
