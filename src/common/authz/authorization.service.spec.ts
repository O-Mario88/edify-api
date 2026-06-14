import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { EdifyRole } from '@prisma/client';
import { AuthorizationService } from './authorization.service';
import { ActivityLike } from './resource-ref';
import { permissionsForRole } from '../rbac/permissions';
import { UserScope } from '../scope/scope.service';
import { AuthUser } from '../auth/auth-user';

// ── Test harness ─────────────────────────────────────────────────────────
// Matches the repo's pure-function spec style (vitest, hand-built deps — no
// Nest TestingModule). The engine takes prisma/scope/audit by constructor, so
// we inject canned fakes.
const COUNTRY: EdifyRole[] = ['CountryDirector', 'ImpactAssessment', 'ProgramAccountant', 'Admin'];

function makeScope(over: Partial<UserScope> & { activeRole: EdifyRole }): UserScope {
  const role = over.activeRole;
  return {
    userId: 'u1',
    permissions: permissionsForRole(role),
    countryScope: COUNTRY.includes(role),
    regionIds: [],
    districtIds: [],
    clusterIds: [],
    schoolIds: [],
    ownSchoolIds: [],
    teamSchoolIds: [],
    coreSchoolIds: [],
    staffIds: ['staff1'],
    supervisedStaffIds: [],
    partnerIds: [],
    canViewSummaryOnly: false,
    canViewSchoolLevelDetail: true,
    canViewPartnerData: false,
    canViewFinancialData: false,
    canViewOwn: true,
    canViewTeam: false,
    canViewCountry: false,
    canApprove: false,
    canAssign: false,
    canExport: false,
    ...over,
  };
}

function userFor(scope: UserScope): AuthUser {
  return { userId: scope.userId, email: 'x@edify.org', name: 'X', roles: [scope.activeRole], activeRole: scope.activeRole, staffProfileId: 'staff1' };
}

function svc(scope: UserScope, activityFallback: ActivityLike | null = null) {
  const audit = { log: vi.fn(async () => undefined) };
  const prisma = { activity: { findUnique: vi.fn(async () => activityFallback) } };
  const scopeSvc = { resolveUserScope: vi.fn(async () => scope) };
  const s = new AuthorizationService(prisma as never, scopeSvc as never, audit as never);
  return { s, audit, user: userFor(scope) };
}

const partnerActivity = (over: Partial<ActivityLike> = {}): ActivityLike => ({
  id: 'a1', schoolId: null, responsibleStaffId: null, assignedPartnerId: 'P1',
  deliveryType: 'partner', status: 'awaiting_ia_verification',
  evidenceStatus: 'accepted', iaVerificationStatus: 'confirmed',
  paymentStatus: 'ia_confirmed', salesforceActivityId: 'SV-123', ...over,
});

afterEach(() => { delete process.env.AUTHZ_MODE; });

// ── Negative cases the spec (§32) demands ──────────────────────────────────
describe('AuthorizationService — required denials', () => {
  it('CCEO cannot access another CCEO’s school (activity out of scope)', async () => {
    const { s, user } = svc(makeScope({ activeRole: 'CCEO', schoolIds: ['A'] }));
    const d = await s.canAccessResource(user, { kind: 'activity', loadedEntity: { id: 'a', schoolId: 'B', deliveryType: 'staff', responsibleStaffId: 'other' } }, 'update');
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('out-of-scope');
  });

  it('partner cannot access the School Directory', async () => {
    const { s, user } = svc(makeScope({ activeRole: 'PartnerFieldOfficer' }));
    const d = await s.canAccessResource(user, { kind: 'school', loadedEntity: { id: 'A' } }, 'view');
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('missing-permission');
  });

  it('accountant cannot read raw evidence outside the payment pipeline', async () => {
    const { s, user } = svc(makeScope({ activeRole: 'ProgramAccountant' }));
    const evidence = { id: 'e1', activityId: 'a1', uploadedBy: 'someoneElse', activity: partnerActivity({ deliveryType: 'staff', paymentStatus: 'none' }) };
    const d = await s.canAccessResource(user, { kind: 'evidence', loadedEntity: evidence }, 'download');
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('out-of-payment-scope');
  });

  it('CD cannot reach the operational School Directory', async () => {
    const { s, user } = svc(makeScope({ activeRole: 'CountryDirector' }));
    const d = await s.canAccessResource(user, { kind: 'school', loadedEntity: { id: 'A' } }, 'view');
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('missing-permission');
  });

  it('IA cannot clear a payment', async () => {
    const { s, user } = svc(makeScope({ activeRole: 'ImpactAssessment' }));
    const d = await s.canAccessResource(user, { kind: 'payment', loadedEntity: partnerActivity() }, 'pay');
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('missing-permission');
  });

  it('partner cannot approve evidence (lacks EVIDENCE_REVIEW)', async () => {
    const { s, user } = svc(makeScope({ activeRole: 'PartnerAdmin', partnerIds: ['P1'] }));
    const evidence = { id: 'e1', activityId: 'a1', uploadedBy: 'u1', activity: partnerActivity() };
    const d = await s.canAccessResource(user, { kind: 'evidence', loadedEntity: evidence }, 'verify');
    expect(d.allowed).toBe(false);
    expect(d.reason).toContain('missing-permission');
  });

  it('a reviewer cannot review evidence they uploaded themselves (no self-approval)', async () => {
    const { s, user } = svc(makeScope({ activeRole: 'CCEO', schoolIds: ['A'] }));
    const evidence = { id: 'e1', activityId: 'a1', uploadedBy: 'u1', activity: partnerActivity({ schoolId: 'A' }) };
    const d = await s.canAccessResource(user, { kind: 'evidence', loadedEntity: evidence }, 'verify');
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('self-review');
  });

  it('payment before IA confirmation is blocked', async () => {
    const { s, user } = svc(makeScope({ activeRole: 'ProgramAccountant' }));
    const d = await s.canAccessResource(user, { kind: 'payment', loadedEntity: partnerActivity({ iaVerificationStatus: 'pending' }) }, 'pay');
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('workflow-gate:ia-unconfirmed');
  });

  it('evidence download outside scope is blocked', async () => {
    const { s, user } = svc(makeScope({ activeRole: 'CCEO', schoolIds: ['A'] }));
    const evidence = { id: 'e1', activityId: 'a1', uploadedBy: 'partnerUser', activity: partnerActivity({ deliveryType: 'staff', schoolId: 'B', assignedPartnerId: null }) };
    const d = await s.canAccessResource(user, { kind: 'evidence', loadedEntity: evidence }, 'download');
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('out-of-scope');
  });

  it('partner cannot touch another partner’s activity (IDOR closed)', async () => {
    const { s, user } = svc(makeScope({ activeRole: 'PartnerFieldOfficer', partnerIds: ['P1'] }));
    const d = await s.canAccessResource(user, { kind: 'activity', loadedEntity: partnerActivity({ assignedPartnerId: 'P2' }) }, 'update');
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe('partner-mismatch');
  });
});

// ── Positive sanity (no false 403s on legitimate flows) ────────────────────
describe('AuthorizationService — legitimate flows allowed', () => {
  it('CCEO accepts evidence on a school in their portfolio', async () => {
    const { s, user } = svc(makeScope({ activeRole: 'CCEO', schoolIds: ['A'] }));
    const evidence = { id: 'e1', activityId: 'a1', uploadedBy: 'partnerUser', activity: partnerActivity({ schoolId: 'A', assignedPartnerId: null, deliveryType: 'staff' }) };
    const d = await s.canAccessResource(user, { kind: 'evidence', loadedEntity: evidence }, 'verify');
    expect(d.allowed).toBe(true);
  });

  it('accountant pays a fully-verified partner activity', async () => {
    const { s, user } = svc(makeScope({ activeRole: 'ProgramAccountant' }));
    const d = await s.canAccessResource(user, { kind: 'payment', loadedEntity: partnerActivity() }, 'pay');
    expect(d.allowed).toBe(true);
    expect(d.sensitive).toBe(true);
  });

  it('IA confirms an activity awaiting verification', async () => {
    const { s, user } = svc(makeScope({ activeRole: 'ImpactAssessment' }));
    const d = await s.canAccessResource(user, { kind: 'activity', loadedEntity: partnerActivity({ status: 'awaiting_ia_verification' }) }, 'verify');
    expect(d.allowed).toBe(true);
  });

  it('partner uploads evidence to their own assigned activity', async () => {
    const { s, user } = svc(makeScope({ activeRole: 'PartnerFieldOfficer', partnerIds: ['P1'] }));
    const evidence = { id: '', activityId: 'a1', uploadedBy: 'u1', activity: partnerActivity({ assignedPartnerId: 'P1' }) };
    const d = await s.canAccessResource(user, { kind: 'evidence', loadedEntity: evidence }, 'upload');
    expect(d.allowed).toBe(true);
  });

  it('CD reads a country aggregate report', async () => {
    const { s, user } = svc(makeScope({ activeRole: 'CountryDirector' }));
    const d = await s.canAccessResource(user, { kind: 'report' }, 'view');
    expect(d.allowed).toBe(true);
  });
});

// ── Shadow vs enforce behaviour ────────────────────────────────────────────
describe('AuthorizationService — assertCanAccess shadow/enforce', () => {
  it('shadow mode logs authz.deny.shadow and does NOT throw', async () => {
    process.env.AUTHZ_MODE = 'shadow';
    const { s, audit, user } = svc(makeScope({ activeRole: 'CCEO', schoolIds: ['A'] }));
    await expect(
      s.assertCanAccess(user, { kind: 'activity', loadedEntity: { id: 'a', schoolId: 'B', deliveryType: 'staff' } }, 'update'),
    ).resolves.toBeUndefined();
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'authz.deny.shadow' }));
  });

  it('enforce mode logs authz.deny and throws ForbiddenException', async () => {
    process.env.AUTHZ_MODE = 'enforce';
    const { s, audit, user } = svc(makeScope({ activeRole: 'CCEO', schoolIds: ['A'] }));
    await expect(
      s.assertCanAccess(user, { kind: 'activity', loadedEntity: { id: 'a', schoolId: 'B', deliveryType: 'staff' } }, 'update'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'authz.deny' }));
  });

  it('a sensitive ALLOW is audited (authz.allow.sensitive)', async () => {
    process.env.AUTHZ_MODE = 'enforce';
    const { s, audit, user } = svc(makeScope({ activeRole: 'ProgramAccountant' }));
    await s.assertCanAccess(user, { kind: 'payment', loadedEntity: partnerActivity() }, 'pay');
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'authz.allow.sensitive' }));
  });
});
