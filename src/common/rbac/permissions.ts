import { EdifyRole } from '@prisma/client';

// Canonical permission keys. Controllers reference these — never raw role lists.
export const PERMISSIONS = {
  SCHOOL_VIEW: 'school.view',
  SCHOOL_UPLOAD: 'school.upload',
  SCHOOL_EDIT: 'school.edit',
  SCHOOL_RESOLVE_DUPLICATE: 'school.resolveDuplicate',
  CLUSTER_VIEW: 'cluster.view',
  CLUSTER_ASSIGN: 'cluster.assign',
  CLUSTER_OVERRIDE: 'cluster.override', // create a 2nd cluster in a sub-county
  PLANNING_RECALC: 'planning.recalc',
  SSA_VIEW: 'ssa.view',
  SSA_UPLOAD: 'ssa.upload',
  PLANNING_VIEW: 'planning.view',
  PLANNING_CREATE: 'planning.create',
  ACTIVITY_ASSIGN: 'activity.assign',
  ACTIVITY_COMPLETE: 'activity.complete',
  EVIDENCE_REVIEW: 'evidence.review',
  IA_VERIFY: 'ia.verify',
  PAYMENT_ACT: 'payment.act',
  BUDGET_VIEW_SUMMARY: 'budget.viewSummary',
  BUDGET_VIEW_DETAIL: 'budget.viewDetail',
  BUDGET_APPROVE: 'budget.approve',
  STAFF_MANAGE: 'staff.manage',
  PARTNER_VIEW: 'partner.view',
  PROJECT_MANAGE: 'project.manage',
  ANALYTICS_VIEW: 'analytics.view',
  EXPORT: 'data.export',
  SYSTEM_ADMIN: 'system.admin',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const P = PERMISSIONS;

// Role → permissions matrix. This is the single source of truth seeded into
// the RolePermission table and used by the PermissionsGuard.
export const ROLE_PERMISSIONS: Record<EdifyRole, PermissionKey[]> = {
  Admin: Object.values(P),
  CountryDirector: [
    P.SCHOOL_VIEW, P.SCHOOL_EDIT, P.CLUSTER_VIEW, P.CLUSTER_ASSIGN, P.CLUSTER_OVERRIDE,
    P.PLANNING_RECALC, P.SSA_VIEW, P.PLANNING_VIEW, P.PLANNING_CREATE, P.ACTIVITY_ASSIGN,
    P.EVIDENCE_REVIEW, P.BUDGET_VIEW_SUMMARY, P.BUDGET_VIEW_DETAIL, P.BUDGET_APPROVE,
    P.STAFF_MANAGE, P.PARTNER_VIEW, P.PROJECT_MANAGE, P.ANALYTICS_VIEW, P.EXPORT,
  ],
  RegionalVicePresident: [
    P.SCHOOL_VIEW, P.CLUSTER_VIEW, P.SSA_VIEW, P.PLANNING_VIEW,
    P.BUDGET_VIEW_SUMMARY, P.ANALYTICS_VIEW,
  ],
  CountryProgramLead: [
    P.SCHOOL_VIEW, P.SCHOOL_EDIT, P.CLUSTER_VIEW, P.CLUSTER_ASSIGN, P.SSA_VIEW,
    P.PLANNING_VIEW, P.PLANNING_CREATE, P.ACTIVITY_ASSIGN, P.ACTIVITY_COMPLETE,
    P.EVIDENCE_REVIEW, P.BUDGET_VIEW_DETAIL, P.PARTNER_VIEW, P.ANALYTICS_VIEW, P.EXPORT,
  ],
  CCEO: [
    P.SCHOOL_VIEW, P.CLUSTER_VIEW, P.SSA_VIEW, P.PLANNING_VIEW, P.PLANNING_CREATE,
    P.ACTIVITY_ASSIGN, P.ACTIVITY_COMPLETE, P.EVIDENCE_REVIEW, P.PARTNER_VIEW,
    P.ANALYTICS_VIEW,
  ],
  ImpactAssessment: [
    P.SCHOOL_VIEW, P.SCHOOL_UPLOAD, P.SCHOOL_EDIT, P.SCHOOL_RESOLVE_DUPLICATE,
    P.CLUSTER_VIEW, P.CLUSTER_ASSIGN, P.CLUSTER_OVERRIDE, P.PLANNING_RECALC,
    P.SSA_VIEW, P.SSA_UPLOAD, P.PLANNING_VIEW, P.EVIDENCE_REVIEW, P.IA_VERIFY,
    P.ANALYTICS_VIEW, P.EXPORT,
  ],
  ProgramAccountant: [
    P.SCHOOL_VIEW, P.PLANNING_VIEW, P.PAYMENT_ACT, P.BUDGET_VIEW_DETAIL,
    P.ANALYTICS_VIEW, P.EXPORT,
  ],
  HumanResources: [
    P.STAFF_MANAGE, P.ANALYTICS_VIEW,
  ],
  ProjectCoordinator: [
    P.SCHOOL_VIEW, P.PLANNING_VIEW, P.PLANNING_CREATE, P.ACTIVITY_ASSIGN,
    P.EVIDENCE_REVIEW, P.PROJECT_MANAGE, P.PARTNER_VIEW, P.ANALYTICS_VIEW,
  ],
  PartnerAdmin: [
    P.ACTIVITY_COMPLETE, P.PLANNING_VIEW,
  ],
  PartnerFieldOfficer: [
    P.ACTIVITY_COMPLETE, P.PLANNING_VIEW,
  ],
};

export function permissionsForRole(role: EdifyRole): PermissionKey[] {
  return ROLE_PERMISSIONS[role] ?? [];
}
