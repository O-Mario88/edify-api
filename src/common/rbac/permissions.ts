import { EdifyRole } from '@prisma/client';

// Canonical permission keys. Controllers reference these — never raw role lists.
export const PERMISSIONS = {
  SCHOOL_VIEW: 'school.view',
  // Operational School Directory list/profile. Distinct from SCHOOL_VIEW:
  // the directory is an operational working surface, limited to the roles
  // that actually work schools (CCEO, PL, IA) + the project coordinator who
  // assigns project schools. CD/RVP/HR/Accountant/Partner are blocked — they
  // get aggregates from analytics, never the operational list.
  SCHOOL_DIRECTORY_VIEW: 'schoolDirectory.view',
  // Recruitment Intelligence — the recruit-more-vs-focus advisory.
  RECRUITMENT_INTELLIGENCE_VIEW: 'recruitment.view',
  // HR people surfaces — staff performance, leave planner, daily field debrief.
  STAFF_PERFORMANCE_VIEW: 'staffPerformance.view',
  LEAVE_PLANNER_VIEW: 'leavePlanner.view',
  DAILY_DEBRIEF_VIEW: 'dailyDebrief.view',
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
  // The CD-owned rate card. Only the Country Director (and Admin) may create or
  // edit official cost settings — no staff invents costs. Spec §10.
  COST_SETTINGS_MANAGE: 'costSettings.manage',
  STAFF_MANAGE: 'staff.manage',
  PARTNER_VIEW: 'partner.view',
  // CD onboards/activates partners and sets coverage/certification. Eligibility
  // for assignment is driven by this onboarding data.
  PARTNER_MANAGE: 'partner.manage',
  PROJECT_MANAGE: 'project.manage',
  ANALYTICS_VIEW: 'analytics.view',
  EXPORT: 'data.export',
  SYSTEM_ADMIN: 'system.admin',
  // Leadership Decision Engine — the executive intelligence layer. VIEW gates
  // the decision boards (role-tailored inside the service); REVIEW gates the
  // human-review actions (accept/reject/condition/defer + leadership notes).
  // The engine RECOMMENDS; these permissions never auto-execute a decision.
  LEADERSHIP_ENGINE_VIEW: 'leadership.view',
  LEADERSHIP_DECISION_REVIEW: 'leadership.review',
  // Budget Intelligence & Financial Decision Engine — the financial brain. VIEW
  // gates the budget-intelligence boards (role-tailored inside the service);
  // REVIEW gates the human finance-decision actions (accept/hold/reallocate +
  // finance notes). Recommends; never auto-moves money.
  BUDGET_INTELLIGENCE_VIEW: 'budgetIntelligence.view',
  BUDGET_DECISION_REVIEW: 'budgetDecision.review',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

const P = PERMISSIONS;

// Role → permissions matrix. This is the single source of truth seeded into
// the RolePermission table and used by the PermissionsGuard.
export const ROLE_PERMISSIONS: Record<EdifyRole, PermissionKey[]> = {
  Admin: Object.values(P),
  CountryDirector: [
    // No SCHOOL_DIRECTORY_VIEW — CD leads through analytics, not the
    // operational directory. SCHOOL_VIEW retained for any aggregate that
    // still references it; the directory endpoints now gate on the new perm.
    P.SCHOOL_VIEW, P.SCHOOL_EDIT, P.CLUSTER_VIEW, P.CLUSTER_ASSIGN, P.CLUSTER_OVERRIDE,
    // CD does NOT plan or assign field work (spec: "CD doesn't plan"; CD flags
    // issues to the PL instead). PLANNING_CREATE + ACTIVITY_ASSIGN removed —
    // CD keeps recalc/view for oversight only. (CD has no staffProfile, so plan
    // authoring was already blocked at the service layer; this aligns the matrix.)
    P.PLANNING_RECALC, P.SSA_VIEW, P.PLANNING_VIEW,
    // CD owns the rate card and sees every budget — but does NOT approve fund
    // requests. Approval lives in the field chain: CCEO → PL. (Spec correction.)
    P.EVIDENCE_REVIEW, P.BUDGET_VIEW_SUMMARY, P.BUDGET_VIEW_DETAIL,
    P.COST_SETTINGS_MANAGE,
    P.STAFF_MANAGE, P.PARTNER_VIEW, P.PARTNER_MANAGE, P.PROJECT_MANAGE, P.ANALYTICS_VIEW, P.EXPORT,
    P.RECRUITMENT_INTELLIGENCE_VIEW,
    // Full country leadership decision authority.
    P.LEADERSHIP_ENGINE_VIEW, P.LEADERSHIP_DECISION_REVIEW,
    // Full country financial intelligence + reallocation decision authority.
    P.BUDGET_INTELLIGENCE_VIEW, P.BUDGET_DECISION_REVIEW,
  ],
  RegionalVicePresident: [
    // No SCHOOL_DIRECTORY_VIEW — summary analytics + recruitment intelligence only.
    P.SCHOOL_VIEW, P.CLUSTER_VIEW, P.SSA_VIEW, P.PLANNING_VIEW,
    P.BUDGET_VIEW_SUMMARY, P.ANALYTICS_VIEW, P.RECRUITMENT_INTELLIGENCE_VIEW,
    // Region/country summary + approval-level decision review.
    P.LEADERSHIP_ENGINE_VIEW, P.LEADERSHIP_DECISION_REVIEW,
    P.BUDGET_INTELLIGENCE_VIEW, // summary budget view
  ],
  CountryProgramLead: [
    P.SCHOOL_VIEW, P.SCHOOL_DIRECTORY_VIEW, P.SCHOOL_EDIT, P.CLUSTER_VIEW, P.CLUSTER_ASSIGN, P.SSA_VIEW,
    P.PLANNING_VIEW, P.PLANNING_CREATE, P.ACTIVITY_ASSIGN, P.ACTIVITY_COMPLETE,
    // PL approves the monthly fund request + plan rolled up from the CCEOs they
    // supervise (the top of the field approval chain).
    P.EVIDENCE_REVIEW, P.BUDGET_VIEW_DETAIL, P.BUDGET_APPROVE, P.PARTNER_VIEW, P.ANALYTICS_VIEW, P.EXPORT,
    P.RECRUITMENT_INTELLIGENCE_VIEW,
    // Supervised-team decision support + review within their scope.
    P.LEADERSHIP_ENGINE_VIEW, P.LEADERSHIP_DECISION_REVIEW,
    P.BUDGET_INTELLIGENCE_VIEW, // supervised-team budget/fund view
  ],
  CCEO: [
    // The CCEO is the primary cluster-assigning field role: they run the
    // assignment drawer after upload, slotting their portfolio schools into a
    // cluster (per the spec). Not CLUSTER_OVERRIDE — only CD/IA may stand up a
    // 2nd cluster in a sub-county.
    P.SCHOOL_VIEW, P.SCHOOL_DIRECTORY_VIEW, P.CLUSTER_VIEW, P.CLUSTER_ASSIGN, P.SSA_VIEW, P.PLANNING_VIEW, P.PLANNING_CREATE,
    P.ACTIVITY_ASSIGN, P.ACTIVITY_COMPLETE, P.EVIDENCE_REVIEW, P.PARTNER_VIEW,
    // CCEO approves the fund requests of the staff they supervise, then submits
    // their own consolidated monthly request up to the PL.
    P.BUDGET_VIEW_DETAIL, P.BUDGET_APPROVE,
    P.ANALYTICS_VIEW, P.RECRUITMENT_INTELLIGENCE_VIEW,
    P.BUDGET_INTELLIGENCE_VIEW, // own planned/funded activities view
  ],
  ImpactAssessment: [
    P.SCHOOL_VIEW, P.SCHOOL_DIRECTORY_VIEW, P.SCHOOL_UPLOAD, P.SCHOOL_EDIT, P.SCHOOL_RESOLVE_DUPLICATE,
    P.CLUSTER_VIEW, P.CLUSTER_ASSIGN, P.CLUSTER_OVERRIDE, P.PLANNING_RECALC,
    P.SSA_VIEW, P.SSA_UPLOAD, P.PLANNING_VIEW, P.EVIDENCE_REVIEW, P.IA_VERIFY,
    P.ANALYTICS_VIEW, P.EXPORT, P.RECRUITMENT_INTELLIGENCE_VIEW,
    // Data-confidence + SSA-impact readiness lens (no decision review authority).
    P.LEADERSHIP_ENGINE_VIEW,
  ],
  ProgramAccountant: [
    // No SCHOOL_DIRECTORY_VIEW — finance/accountability only.
    P.SCHOOL_VIEW, P.PLANNING_VIEW, P.PAYMENT_ACT, P.BUDGET_VIEW_DETAIL,
    P.ANALYTICS_VIEW, P.EXPORT,
    // Finance-implication view only — no staff/partner decision authority.
    P.LEADERSHIP_ENGINE_VIEW,
    // Finance execution + accountability + finance-decision review.
    P.BUDGET_INTELLIGENCE_VIEW, P.BUDGET_DECISION_REVIEW,
  ],
  HumanResources: [
    // People surfaces only — staff performance, leave planner, daily debrief.
    // No SCHOOL_DIRECTORY_VIEW.
    P.STAFF_MANAGE, P.ANALYTICS_VIEW,
    P.STAFF_PERFORMANCE_VIEW, P.LEAVE_PLANNER_VIEW, P.DAILY_DEBRIEF_VIEW,
    // Staff & HR decision board + review (promotion/PIP/workload — human-decided).
    P.LEADERSHIP_ENGINE_VIEW, P.LEADERSHIP_DECISION_REVIEW,
  ],
  ProjectCoordinator: [
    // Explicitly granted directory access — the coordinator assigns project
    // schools from the directory (spec §1 "unless explicitly granted").
    P.SCHOOL_VIEW, P.SCHOOL_DIRECTORY_VIEW, P.PLANNING_VIEW, P.PLANNING_CREATE, P.ACTIVITY_ASSIGN,
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
