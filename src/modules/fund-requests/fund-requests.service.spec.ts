import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { EdifyRole } from '@prisma/client';
import { FundRequestsService } from './fund-requests.service';
import { AuthUser } from '../../common/auth/auth-user';

// Pure-unit spec (vitest, hand-built fakes — no Nest TestingModule), mirroring
// authorization.service.spec.ts. Locks the money rails: cannot-approve-own,
// only-the-direct-supervisor-reviews, BUDGET_APPROVE/PAYMENT_ACT gates,
// disburse-needs-approved, accountability-needs-disbursed + owner-only, and the
// NetSuite-ID lock. The in-service ForbiddenException/BadRequestException throws
// are unconditional (NOT gated by AUTHZ shadow mode), so they enforce always.

type Fr = Record<string, unknown>;

function makeUser(role: EdifyRole, over: Partial<AuthUser> = {}): AuthUser {
  return { userId: 'u1', email: 'x@edify.org', name: 'X', roles: [role], activeRole: role, staffProfileId: 'staff1', ...over };
}

function svc(opts: { fr?: Fr | null; supLinks?: { superviseeId: string }[]; supProfiles?: { userId: string }[] }) {
  const prisma = {
    fundRequest: {
      findUnique: vi.fn(async () => opts.fr ?? null),
      update: vi.fn(async (a: { data: Record<string, unknown> }) => ({ ...(opts.fr ?? {}), ...a.data })),
      create: vi.fn(async (a: { data: Record<string, unknown> }) => ({ id: 'fr1', ...a.data })),
    },
    staffSupervisorAssignment: { findMany: vi.fn(async () => opts.supLinks ?? []) },
    staffProfile: { findMany: vi.fn(async () => opts.supProfiles ?? []) },
    user: { findUnique: vi.fn(async () => ({ name: 'Sub' })), findMany: vi.fn(async () => []) },
  };
  const scope = { resolveUserScope: vi.fn() };
  const audit = { log: vi.fn(async () => undefined) };
  const budget = {};
  const events = {
    notifyOnly: vi.fn(async () => undefined),
    usersWithRole: vi.fn(async () => ['acc1']),
    userForStaff: vi.fn(async () => 'sup-user'),
  };
  const s = new FundRequestsService(prisma as never, scope as never, audit as never, budget as never, events as never);
  return { s, prisma, events };
}

describe('FundRequestsService.review — approval rails', () => {
  it('an approver cannot approve their OWN request', async () => {
    const { s, prisma } = svc({ fr: { id: 'fr1', status: 'submitted', submittedByUserId: 'u1' } });
    await expect(s.review(makeUser('CountryProgramLead'), 'fr1', 'approve')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.fundRequest.update).not.toHaveBeenCalled();
  });

  it('only the DIRECT supervisor may review (non-supervised submitter is rejected)', async () => {
    const { s } = svc({ fr: { id: 'fr1', status: 'submitted', submittedByUserId: 'other' }, supLinks: [], supProfiles: [] });
    await expect(s.review(makeUser('CountryProgramLead'), 'fr1', 'approve')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a role without BUDGET_APPROVE cannot review', async () => {
    const { s } = svc({ fr: { id: 'fr1', status: 'submitted', submittedByUserId: 'other' } });
    await expect(s.review(makeUser('ProgramAccountant'), 'fr1', 'approve')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('cannot re-review a request that is not still submitted', async () => {
    const { s } = svc({ fr: { id: 'fr1', status: 'approved', submittedByUserId: 'other' } });
    await expect(s.review(makeUser('CountryProgramLead'), 'fr1', 'approve')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a supervisor approves a supervised submitter and the request is marked approved', async () => {
    const { s, prisma, events } = svc({
      fr: { id: 'fr1', status: 'submitted', submittedByUserId: 'sub1', periodKey: 'FY2026-M6', totalAmount: 1000 },
      supLinks: [{ superviseeId: 'staffSub' }],
      supProfiles: [{ userId: 'sub1' }],
    });
    await s.review(makeUser('CountryProgramLead'), 'fr1', 'approve');
    expect(prisma.fundRequest.update).toHaveBeenCalled();
    const data = prisma.fundRequest.update.mock.calls[0][0].data;
    expect(data.status).toBe('approved');
    expect(events.notifyOnly).toHaveBeenCalled();
  });
});

describe('FundRequestsService.disburse — payment rails', () => {
  it('only PAYMENT_ACT (accountant) can disburse', async () => {
    const { s, prisma } = svc({ fr: { id: 'fr1', status: 'approved', submittedByUserId: 'sub1', totalAmount: 1000 } });
    await expect(s.disburse(makeUser('CountryProgramLead'), 'fr1', {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.fundRequest.update).not.toHaveBeenCalled();
  });

  it('disburse requires an APPROVED request', async () => {
    const { s } = svc({ fr: { id: 'fr1', status: 'submitted', submittedByUserId: 'sub1', totalAmount: 1000 } });
    await expect(s.disburse(makeUser('ProgramAccountant'), 'fr1', {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('the accountant disburses an approved request', async () => {
    const { s, prisma } = svc({ fr: { id: 'fr1', status: 'approved', submittedByUserId: 'sub1', periodKey: 'FY2026-M6', totalAmount: 1000 } });
    await s.disburse(makeUser('ProgramAccountant'), 'fr1', {});
    const data = prisma.fundRequest.update.mock.calls[0][0].data;
    expect(data.status).toBe('disbursed');
    expect(data.accountabilityStatus).toBe('none');
  });
});

describe('FundRequestsService.submitAccountability — owner-only + NetSuite-ID lock', () => {
  it('only the requester (or Admin) accounts for their own funds', async () => {
    const { s } = svc({ fr: { id: 'fr1', status: 'disbursed', submittedByUserId: 'someoneElse' } });
    await expect(s.submitAccountability(makeUser('CCEO'), 'fr1', { netsuiteId: '6161' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('accountability needs a DISBURSED request', async () => {
    const { s } = svc({ fr: { id: 'fr1', status: 'approved', submittedByUserId: 'u1' } });
    await expect(s.submitAccountability(makeUser('CCEO'), 'fr1', { netsuiteId: '6161' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('an APPROVED accountability is locked — the NetSuite ID is frozen', async () => {
    const { s, prisma } = svc({ fr: { id: 'fr1', status: 'disbursed', submittedByUserId: 'u1', accountabilityStatus: 'approved' } });
    await expect(s.submitAccountability(makeUser('CCEO'), 'fr1', { netsuiteId: '9999' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.fundRequest.update).not.toHaveBeenCalled();
  });

  it('the owner submits accountability on a disbursed request', async () => {
    const { s, prisma } = svc({ fr: { id: 'fr1', status: 'disbursed', submittedByUserId: 'u1', periodKey: 'FY2026-M6', accountabilityStatus: 'none' } });
    await s.submitAccountability(makeUser('CCEO'), 'fr1', { netsuiteId: '6161', amountSpent: 900 });
    const data = prisma.fundRequest.update.mock.calls[0][0].data;
    expect(data.accountabilityStatus).toBe('submitted');
    expect(data.accountabilityNetsuiteId).toBe('6161');
  });
});

describe('FundRequestsService.reviewAccountability', () => {
  it('only BUDGET_APPROVE can review accountability', async () => {
    const { s } = svc({ fr: { id: 'fr1', accountabilityStatus: 'submitted' } });
    await expect(s.reviewAccountability(makeUser('ProgramAccountant'), 'fr1', 'approve')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('needs a SUBMITTED accountability to review', async () => {
    const { s } = svc({ fr: { id: 'fr1', accountabilityStatus: 'none' } });
    await expect(s.reviewAccountability(makeUser('CountryProgramLead'), 'fr1', 'approve')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a supervisor approves a submitted accountability', async () => {
    const { s, prisma } = svc({ fr: { id: 'fr1', accountabilityStatus: 'submitted', submittedByUserId: 'sub1', periodKey: 'FY2026-M6' } });
    await s.reviewAccountability(makeUser('CountryProgramLead'), 'fr1', 'approve');
    const data = prisma.fundRequest.update.mock.calls[0][0].data;
    expect(data.accountabilityStatus).toBe('approved');
  });
});
