import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { EdifyRole } from '@prisma/client';
import { HrService } from './hr.service';
import { AuthUser } from '../../common/auth/auth-user';

// Pure-unit spec for HR leave. Locks: only HR/CD review leave; staff with no
// profile can't request; the Scenario-A conflict scan runs on approval (counts
// the staffer's planned activities inside the leave window) and NOT on reject.

function makeUser(role: EdifyRole, over: Partial<AuthUser> = {}): AuthUser {
  return { userId: 'u1', email: 'x@edify.org', name: 'X', roles: [role], activeRole: role, staffProfileId: 'staff1', ...over };
}

function svc(opts: { leave?: Record<string, unknown> | null; conflicts?: number } = {}) {
  const prisma = {
    leave: {
      findUnique: vi.fn(async () => opts.leave ?? null),
      create: vi.fn(async (a: { data: Record<string, unknown> }) => ({ id: 'l1', ...a.data })),
      update: vi.fn(async (a: { data: Record<string, unknown> }) => ({ ...(opts.leave ?? {}), ...a.data })),
      findMany: vi.fn(async () => []),
    },
    monthlyPlanActivity: { count: vi.fn(async () => opts.conflicts ?? 0) },
    staffSupervisorAssignment: { findFirst: vi.fn(async () => null) },
  };
  const events = {
    emit: vi.fn(async () => undefined),
    usersWithRole: vi.fn(async () => ['hr1']),
    userForStaff: vi.fn(async () => 'staff-user'),
  };
  const s = new HrService(prisma as never, events as never);
  return { s, prisma, events };
}

describe('HrService.reviewLeave', () => {
  it('only HR / CD can review leave', async () => {
    const { s } = svc({ leave: { id: 'l1', staffProfileId: 'staff2', startDate: '2026-06-10', endDate: '2026-06-11', type: 'annual' } });
    await expect(s.reviewLeave(makeUser('CCEO'), 'l1', 'approve')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('approving scans the plan for conflicts inside the leave window', async () => {
    const { s, prisma } = svc({
      leave: { id: 'l1', staffProfileId: 'staff2', startDate: '2026-06-10', endDate: '2026-06-11', type: 'annual' },
      conflicts: 2,
    });
    const res = await s.reviewLeave(makeUser('HumanResources'), 'l1', 'approve');
    expect(res.conflictCount).toBe(2);
    expect(prisma.monthlyPlanActivity.count).toHaveBeenCalled();
    const data = prisma.leave.update.mock.calls[0][0].data;
    expect(data.status).toBe('approved');
  });

  it('rejecting does NOT run the conflict scan', async () => {
    const { s, prisma } = svc({
      leave: { id: 'l1', staffProfileId: 'staff2', startDate: '2026-06-10', endDate: '2026-06-11', type: 'annual' },
      conflicts: 5,
    });
    const res = await s.reviewLeave(makeUser('HumanResources'), 'l1', 'reject');
    expect(res.conflictCount).toBe(0);
    expect(prisma.monthlyPlanActivity.count).not.toHaveBeenCalled();
    const data = prisma.leave.update.mock.calls[0][0].data;
    expect(data.status).toBe('rejected');
  });
});

describe('HrService.requestLeave', () => {
  it('staff without a profile cannot request leave', async () => {
    const { s } = svc();
    await expect(s.requestLeave(makeUser('CCEO', { staffProfileId: undefined }), { startDate: '2026-06-10', endDate: '2026-06-11' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a leave request requires start and end dates', async () => {
    const { s } = svc();
    await expect(s.requestLeave(makeUser('CCEO'), { type: 'annual' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
