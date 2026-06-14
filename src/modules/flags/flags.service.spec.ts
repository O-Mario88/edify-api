import { describe, it, expect, vi } from 'vitest';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { EdifyRole } from '@prisma/client';
import { FlagsService } from './flags.service';
import { AuthUser } from '../../common/auth/auth-user';

// Pure-unit spec for the CD->PL flag handoff. Locks: only a CD raises a flag,
// a flag needs an assigned PL + a note, and only the assigned PL (or a CD) can
// act on it.

function makeUser(role: EdifyRole, over: Partial<AuthUser> = {}): AuthUser {
  return { userId: 'u1', email: 'x@edify.org', name: 'X', roles: [role], activeRole: role, staffProfileId: 'staff1', ...over };
}

function svc(opts: { pl?: { id: string } | null; flag?: Record<string, unknown> | null } = {}) {
  const prisma = {
    user: { findFirst: vi.fn(async () => (opts.pl === undefined ? { id: 'pl1' } : opts.pl)), findMany: vi.fn(async () => []) },
    cdFlag: {
      create: vi.fn(async (a: { data: Record<string, unknown> }) => ({ id: 'f1', note: 'n', ...a.data })),
      findUnique: vi.fn(async () => opts.flag ?? null),
      update: vi.fn(async (a: { data: Record<string, unknown> }) => ({ ...(opts.flag ?? {}), ...a.data })),
      findMany: vi.fn(async () => []),
    },
  };
  const events = { emit: vi.fn(async () => undefined) };
  const s = new FlagsService(prisma as never, events as never);
  return { s, prisma, events };
}

describe('FlagsService.raise', () => {
  it('only the Country Director can raise a flag', async () => {
    const { s } = svc();
    await expect(s.raise(makeUser('CountryProgramLead'), { assignedToUserId: 'pl1', note: 'issue' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a flag requires an assigned Program Lead', async () => {
    const { s } = svc();
    await expect(s.raise(makeUser('CountryDirector'), { note: 'issue' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a flag requires a note', async () => {
    const { s } = svc();
    await expect(s.raise(makeUser('CountryDirector'), { assignedToUserId: 'pl1', note: '  ' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown assigned Program Lead', async () => {
    const { s } = svc({ pl: null });
    await expect(s.raise(makeUser('CountryDirector'), { assignedToUserId: 'ghost', note: 'issue' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a CD raises a valid flag — it is created and the PL is notified', async () => {
    const { s, prisma, events } = svc({ pl: { id: 'pl1' } });
    await s.raise(makeUser('CountryDirector'), { assignedToUserId: 'pl1', note: 'fix this' });
    expect(prisma.cdFlag.create).toHaveBeenCalled();
    expect(events.emit).toHaveBeenCalled();
  });
});

describe('FlagsService.update', () => {
  it('only the assigned PL (or a CD) can act on a flag', async () => {
    const { s } = svc({ flag: { id: 'f1', assignedToUserId: 'plX', raisedByUserId: 'cd1' } });
    await expect(s.update(makeUser('CountryProgramLead', { userId: 'other' }), 'f1', 'resolve')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('the assigned PL resolves a flag', async () => {
    const { s, prisma } = svc({ flag: { id: 'f1', assignedToUserId: 'u1', raisedByUserId: 'cd1' } });
    await s.update(makeUser('CountryProgramLead'), 'f1', 'resolve', 'done');
    const data = prisma.cdFlag.update.mock.calls[0][0].data;
    expect(data.status).toBe('resolved');
    expect(data.resolvedAt).toBeInstanceOf(Date);
  });
});
