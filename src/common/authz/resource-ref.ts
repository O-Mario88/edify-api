// ── Object-level authorization vocabulary ────────────────────────────────
// The route layer (PermissionsGuard + @RequirePermissions) answers "may this
// ROLE call this endpoint?". This layer answers the harder question the spec
// demands: "may this USER take this ACTION on this specific OBJECT, in its
// current workflow state?" — ownership, supervision, partner-linkage, project
// assignment, geography and stage, not just role. Spec §4.

export type ResourceKind =
  | 'school'
  | 'activity'
  | 'evidence'
  | 'ssa'
  | 'fundRequest'
  | 'payment'
  | 'partner'
  | 'project'
  | 'staff'
  | 'report'
  | 'debrief';

export type Action =
  | 'view'
  | 'create'
  | 'update'
  | 'delete'
  | 'assign'
  | 'schedule'
  | 'upload'
  | 'download'
  | 'verify'
  | 'approve'
  | 'pay'
  | 'export';

// Actions that move money, verify records, or egress data. These are audited
// even when ALLOWED (spec §16 "sensitive allow"), so we keep a forensic trail
// of every payment, verification, approval, export and file download — not just
// the denials.
export const SENSITIVE_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'pay',
  'verify',
  'approve',
  'export',
  'download',
]);

export interface ResourceRef {
  kind: ResourceKind;
  id?: string;
  // The already-loaded row, when the caller has it (the common case — service
  // methods fetch the entity, then check access). Avoids a second query and
  // lets the engine read ownership/stage fields directly.
  loadedEntity?: unknown;
}

export interface AuthzDecision {
  allowed: boolean;
  // Machine-readable reason, e.g. 'out-of-scope', 'workflow-gate:ia-unconfirmed',
  // 'missing-permission:payment.act', 'partner-mismatch', 'self-review'.
  reason: string;
  // True when ACTION ∈ SENSITIVE_ACTIONS — drives the audit-on-allow behaviour.
  sensitive: boolean;
}

// ── Minimal structural views of the entities the engine reasons over. We avoid
// importing full Prisma model types so the engine stays decoupled and unit
// tests can hand-build rows. Fields are the ones the matrix actually reads.

export interface ActivityLike {
  id: string;
  schoolId?: string | null;
  responsibleStaffId?: string | null;
  assignedPartnerId?: string | null;
  deliveryType: string;
  status?: string | null;
  evidenceStatus?: string | null;
  iaVerificationStatus?: string | null;
  paymentStatus?: string | null;
  salesforceActivityId?: string | null;
}

export interface EvidenceLike {
  id: string;
  activityId: string;
  uploadedBy: string;
  status?: string | null;
  // Optionally pre-joined parent activity (avoids a query in the scope check).
  activity?: ActivityLike | null;
}

export interface SchoolLike {
  id: string;
  accountOwnerId?: string | null;
  clusterId?: string | null;
  schoolType?: string | null;
}

export interface SsaLike {
  id: string;
  schoolId: string;
  collectedByUserId?: string | null;
}

export interface FundRequestLike {
  id: string;
  submittedByStaffId?: string | null;
  originStaffId?: string | null;
  status?: string | null;
}

export interface PartnerLike {
  id: string;
}
