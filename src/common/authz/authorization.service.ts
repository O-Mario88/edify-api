import { ForbiddenException, Injectable } from '@nestjs/common';
import { EdifyRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ScopeService, UserScope } from '../scope/scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../auth/auth-user';
import { PERMISSIONS, PermissionKey } from '../rbac/permissions';
import { authzMode } from './authz.config';
import {
  Action,
  ActivityLike,
  AuthzDecision,
  EvidenceLike,
  FundRequestLike,
  PartnerLike,
  ResourceKind,
  ResourceRef,
  SchoolLike,
  SENSITIVE_ACTIONS,
  SsaLike,
} from './resource-ref';

const PARTNER_ROLES: EdifyRole[] = ['PartnerAdmin', 'PartnerFieldOfficer'];
const isPartnerRole = (r: EdifyRole) => PARTNER_ROLES.includes(r);

// Layer-1: the route permission a (kind, action) requires. Mirrors the RBAC
// matrix so the object-check is correct even when reached from a code path that
// isn't behind the matching @RequirePermissions guard. A missing entry means
// "no extra permission beyond authentication" (rare — e.g. report:view defers
// to ANALYTICS_VIEW explicitly).
const PERMISSION_MAP: Partial<Record<string, PermissionKey>> = {
  'school:view': PERMISSIONS.SCHOOL_DIRECTORY_VIEW,
  'school:update': PERMISSIONS.SCHOOL_EDIT,
  'school:create': PERMISSIONS.SCHOOL_UPLOAD,
  'school:upload': PERMISSIONS.SCHOOL_UPLOAD,

  'activity:view': PERMISSIONS.PLANNING_VIEW,
  'activity:create': PERMISSIONS.PLANNING_CREATE,
  'activity:update': PERMISSIONS.ACTIVITY_COMPLETE,
  'activity:schedule': PERMISSIONS.ACTIVITY_COMPLETE,
  'activity:assign': PERMISSIONS.ACTIVITY_ASSIGN,
  'activity:verify': PERMISSIONS.IA_VERIFY,

  'evidence:upload': PERMISSIONS.ACTIVITY_COMPLETE,
  'evidence:verify': PERMISSIONS.EVIDENCE_REVIEW,
  'evidence:view': PERMISSIONS.PLANNING_VIEW,
  'evidence:download': PERMISSIONS.PLANNING_VIEW,

  'payment:pay': PERMISSIONS.PAYMENT_ACT,

  'ssa:view': PERMISSIONS.SSA_VIEW,
  'ssa:upload': PERMISSIONS.SSA_UPLOAD,

  'fundRequest:approve': PERMISSIONS.BUDGET_APPROVE,

  'partner:view': PERMISSIONS.PARTNER_VIEW,
  'partner:update': PERMISSIONS.PARTNER_MANAGE,

  'project:view': PERMISSIONS.PROJECT_MANAGE,
  'project:update': PERMISSIONS.PROJECT_MANAGE,
  'project:assign': PERMISSIONS.PROJECT_MANAGE,

  'staff:view': PERMISSIONS.STAFF_MANAGE,
  'staff:update': PERMISSIONS.STAFF_MANAGE,

  'report:view': PERMISSIONS.ANALYTICS_VIEW,
  'report:export': PERMISSIONS.EXPORT,
};

// Friendly, non-leaking 403 messages keyed by reason prefix (spec §24 — never
// expose internals; a coarse cause is fine and helps the legitimate user).
function publicReason(reason: string): string {
  if (reason.startsWith('missing-permission')) return 'Your role does not permit this action.';
  if (reason === 'out-of-scope') return 'This record is outside your assigned scope.';
  if (reason === 'partner-mismatch') return 'This work is not assigned to your organisation.';
  if (reason === 'self-review') return 'You cannot review evidence you submitted yourself.';
  if (reason.startsWith('workflow-gate')) return 'This action is not allowed at the current workflow stage.';
  return 'You are not permitted to perform this action.';
}

@Injectable()
export class AuthorizationService {
  // Per-request memoization of the (multi-query) user scope. The JWT strategy
  // builds exactly one AuthUser object per request, so its identity is a safe
  // key; a WeakMap avoids leaks and keeps the change isolated to this service
  // (no need to make ScopeService request-scoped).
  private readonly scopeCache = new WeakMap<AuthUser, Promise<UserScope>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
  ) {}

  private getScope(user: AuthUser): Promise<UserScope> {
    let p = this.scopeCache.get(user);
    if (!p) {
      p = this.scope.resolveUserScope(user);
      this.scopeCache.set(user, p);
    }
    return p;
  }

  /** Pure decision: resolve scope, evaluate the 3 layers, return allow/deny. */
  async canAccessResource(user: AuthUser, ref: ResourceRef, action: Action): Promise<AuthzDecision> {
    const scope = await this.getScope(user);
    const sensitive = SENSITIVE_ACTIONS.has(action);
    const deny = (reason: string): AuthzDecision => ({ allowed: false, reason, sensitive });
    const allow = (reason = 'ok'): AuthzDecision => ({ allowed: true, reason, sensitive });

    // ── Layer 1: role permission (RBAC) ──────────────────────────────────
    const need = PERMISSION_MAP[`${ref.kind}:${action}`];
    if (need && !scope.permissions.includes(need)) return deny(`missing-permission:${need}`);

    // ── Layers 2 & 3: object scope + workflow stage, per resource kind ────
    switch (ref.kind) {
      case 'activity':
        return this.activityDecision(scope, ref, action, allow, deny);
      case 'payment':
        return this.paymentDecision(scope, ref, allow, deny);
      case 'evidence':
        return this.evidenceDecision(user, scope, ref, action, allow, deny);
      case 'school':
        return this.schoolDecision(scope, ref, allow, deny);
      case 'ssa':
        return this.ssaDecision(scope, ref, allow, deny);
      case 'fundRequest':
        return this.fundRequestDecision(scope, ref, allow, deny);
      case 'partner':
        return this.partnerDecision(scope, ref, allow, deny);
      case 'project':
        return this.projectDecision(scope, ref, allow, deny);
      case 'staff':
      case 'report':
      case 'debrief':
        // People/analytics/debrief surfaces are governed by layer-1 permission
        // + the collection-level scope filters in their services; no extra
        // per-row ownership gate beyond the permission already checked.
        return allow();
      default:
        return deny('unknown-resource-kind');
    }
  }

  /**
   * Throwing wrapper used inside service methods. Owns the shadow-vs-enforce
   * behaviour and the audit side-effects:
   *  - deny  → audit (`authz.deny` | `authz.deny.shadow`); throw only in enforce.
   *  - sensitive allow → audit `authz.allow.sensitive`.
   */
  async assertCanAccess(user: AuthUser, ref: ResourceRef, action: Action): Promise<void> {
    const decision = await this.canAccessResource(user, ref, action);
    const subjectId = ref.id ?? (ref.loadedEntity as { id?: string } | undefined)?.id;
    const mode = authzMode();

    if (!decision.allowed) {
      await this.audit.log({
        action: mode === 'enforce' ? 'authz.deny' : 'authz.deny.shadow',
        subjectKind: ref.kind,
        subjectId,
        actorId: user.userId,
        actorRole: user.activeRole,
        payload: { action, reason: decision.reason },
      });
      if (mode === 'enforce') throw new ForbiddenException(publicReason(decision.reason));
      return; // shadow: let it through, the log is the signal
    }

    if (decision.sensitive) {
      await this.audit.log({
        action: 'authz.allow.sensitive',
        subjectKind: ref.kind,
        subjectId,
        actorId: user.userId,
        actorRole: user.activeRole,
        payload: { action },
      });
    }
  }

  // ── Shared scope helper used by activity / evidence / payment ───────────
  private activityInScope(scope: UserScope, a: ActivityLike): { ok: boolean; reason: string } {
    if (isPartnerRole(scope.activeRole)) {
      // Partner identity is the ONLY lens for a partner user — they see exactly
      // their org's partner-delivered work. Closes the IDOR where any partner
      // could act on any partner-delivery activity.
      if (a.deliveryType === 'partner' && a.assignedPartnerId && scope.partnerIds.includes(a.assignedPartnerId)) {
        return { ok: true, reason: 'partner-owned' };
      }
      return { ok: false, reason: 'partner-mismatch' };
    }
    if (scope.countryScope) return { ok: true, reason: 'country' };
    if (a.schoolId && scope.schoolIds.includes(a.schoolId)) return { ok: true, reason: 'school-in-scope' };
    // Cluster activities have no schoolId — fall back to staff ownership (the
    // `mine` lens), incl. a PL acting for a supervised CCEO.
    if (
      a.responsibleStaffId &&
      (scope.staffIds.includes(a.responsibleStaffId) || scope.supervisedStaffIds.includes(a.responsibleStaffId))
    ) {
      return { ok: true, reason: 'staff-owned' };
    }
    return { ok: false, reason: 'out-of-scope' };
  }

  // ── Per-kind decisions ──────────────────────────────────────────────────
  private activityDecision(
    scope: UserScope,
    ref: ResourceRef,
    action: Action,
    allow: (r?: string) => AuthzDecision,
    deny: (r: string) => AuthzDecision,
  ): AuthzDecision {
    const a = ref.loadedEntity as ActivityLike | undefined;
    if (!a) return allow('no-entity'); // create/list-scoped: nothing to row-check
    const s = this.activityInScope(scope, a);
    if (!s.ok) return deny(s.reason);
    // Workflow gate: IA confirmation only on an activity awaiting it.
    if (action === 'verify' && a.status && a.status !== 'awaiting_ia_verification') {
      return deny('workflow-gate:not-awaiting-ia');
    }
    return allow(s.reason);
  }

  private paymentDecision(
    scope: UserScope,
    ref: ResourceRef,
    allow: (r?: string) => AuthzDecision,
    deny: (r: string) => AuthzDecision,
  ): AuthzDecision {
    const a = ref.loadedEntity as ActivityLike | undefined;
    // Layer-2: PAYMENT_ACT holders (Accountant/Admin) are country-scoped; a
    // non-country holder would still need the activity in scope.
    if (a && !scope.countryScope) {
      const s = this.activityInScope(scope, a);
      if (!s.ok) return deny(s.reason);
    }
    if (!a) return allow('no-entity');
    // Layer-3: the hard payment gate — money never moves before verification.
    if (a.deliveryType !== 'partner') return deny('workflow-gate:not-partner');
    if (a.iaVerificationStatus !== 'confirmed') return deny('workflow-gate:ia-unconfirmed');
    if (!a.salesforceActivityId) return deny('workflow-gate:no-salesforce-id');
    if (a.evidenceStatus !== 'accepted') return deny('workflow-gate:evidence-not-accepted');
    if (a.paymentStatus === 'paid' || a.paymentStatus === 'closed') return deny('workflow-gate:already-paid');
    return allow('payment-gate-passed');
  }

  private async evidenceDecision(
    user: AuthUser,
    scope: UserScope,
    ref: ResourceRef,
    action: Action,
    allow: (r?: string) => AuthzDecision,
    deny: (r: string) => AuthzDecision,
  ): Promise<AuthzDecision> {
    const rec = ref.loadedEntity as EvidenceLike | undefined;
    if (!rec) return allow('no-entity');
    // No self-review: the uploader can never accept/return their own evidence,
    // even with EVIDENCE_REVIEW (a partner can't approve their own work; a CCEO
    // can't sign off a file they uploaded). Spec §15.
    if (action === 'verify' && rec.uploadedBy === user.userId) return deny('self-review');
    // Row scope is the PARENT ACTIVITY's scope — this is the fix for the
    // download hole (endpoint formerly gated only on PLANNING_VIEW, no row check).
    const activity = rec.activity ?? (await this.loadActivity(rec.activityId));
    if (!activity) return deny('out-of-scope');
    // The Accountant is country-scoped for the payment queue, but must NOT browse
    // raw program evidence at large (spec §3). Restrict their evidence access to
    // partner-delivered work that is actually in the payment pipeline.
    if ((action === 'download' || action === 'view') && scope.activeRole === 'ProgramAccountant') {
      const PIPELINE = ['ia_confirmed', 'pl_approved', 'accountant_cleared', 'paid'];
      const inPipeline = activity.deliveryType === 'partner' && PIPELINE.includes(activity.paymentStatus ?? '');
      return inPipeline ? allow('payment-scope') : deny('out-of-payment-scope');
    }
    const s = this.activityInScope(scope, activity);
    if (!s.ok) return deny(s.reason);
    return allow(s.reason);
  }

  private schoolDecision(
    scope: UserScope,
    ref: ResourceRef,
    allow: (r?: string) => AuthzDecision,
    deny: (r: string) => AuthzDecision,
  ): AuthzDecision {
    // Layer-1 already blocked roles without SCHOOL_DIRECTORY_VIEW (CD, RVP, HR,
    // Accountant, Partner) — that is the "CD cannot reach the operational
    // directory" rule. Here we only constrain the row for non-country roles.
    const sc = ref.loadedEntity as SchoolLike | undefined;
    if (scope.countryScope) return allow('country');
    if (!sc) return allow('no-entity');
    if (scope.schoolIds.includes(sc.id)) return allow('school-in-scope');
    return deny('out-of-scope');
  }

  private ssaDecision(
    scope: UserScope,
    ref: ResourceRef,
    allow: (r?: string) => AuthzDecision,
    deny: (r: string) => AuthzDecision,
  ): AuthzDecision {
    if (scope.countryScope) return allow('country');
    const ssa = ref.loadedEntity as SsaLike | undefined;
    if (!ssa) return allow('no-entity');
    if (scope.schoolIds.includes(ssa.schoolId)) return allow('school-in-scope');
    return deny('out-of-scope');
  }

  private fundRequestDecision(
    scope: UserScope,
    ref: ResourceRef,
    allow: (r?: string) => AuthzDecision,
    deny: (r: string) => AuthzDecision,
  ): AuthzDecision {
    if (scope.countryScope) return allow('country');
    const fr = ref.loadedEntity as FundRequestLike | undefined;
    if (!fr) return allow('no-entity');
    // CCEO/PL approve fund requests of the staff they supervise (the field
    // approval chain), never their own.
    const origin = fr.originStaffId ?? fr.submittedByStaffId ?? undefined;
    if (origin && scope.supervisedStaffIds.includes(origin)) return allow('supervised');
    return deny('out-of-scope');
  }

  private partnerDecision(
    scope: UserScope,
    ref: ResourceRef,
    allow: (r?: string) => AuthzDecision,
    deny: (r: string) => AuthzDecision,
  ): AuthzDecision {
    // A partner USER (if ever granted PARTNER_VIEW) sees only their own record;
    // staff roles with PARTNER_VIEW see the partner roster.
    const p = ref.loadedEntity as PartnerLike | undefined;
    if (isPartnerRole(scope.activeRole)) {
      if (p && scope.partnerIds.includes(p.id)) return allow('own-partner');
      return deny('partner-mismatch');
    }
    return allow('staff-partner-view');
  }

  private projectDecision(
    scope: UserScope,
    ref: ResourceRef,
    allow: (r?: string) => AuthzDecision,
    deny: (r: string) => AuthzDecision,
  ): AuthzDecision {
    // Project membership scoping is wired with the special-projects retrofit;
    // country/admin always allow, others fall through to the service's
    // project-assignment filter for now.
    if (scope.countryScope) return allow('country');
    if (!ref.loadedEntity) return allow('no-entity');
    return allow('project-perm');
  }

  private async loadActivity(activityId: string): Promise<ActivityLike | null> {
    return this.prisma.activity.findUnique({
      where: { id: activityId },
      select: {
        id: true,
        schoolId: true,
        responsibleStaffId: true,
        assignedPartnerId: true,
        deliveryType: true,
        status: true,
        evidenceStatus: true,
        iaVerificationStatus: true,
        paymentStatus: true,
        salesforceActivityId: true,
      },
    }) as Promise<ActivityLike | null>;
  }
}
