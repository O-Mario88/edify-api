import { EdifyRole } from '@prisma/client';

// ── Context-aware, role-aware deep linking ──────────────────────────────────
//
// The communication nervous system: every message and notification points the
// recipient at the EXACT record that needs them — and at a route their role is
// actually allowed to act on. A CCEO with a struggling-school alert lands on the
// planning view; a CD lands on the analytics/risk view with a "send to PL"
// action, never on a planning route they can't use.
//
// resolveContextRoute(role, contextType, contextId) is the single source of
// truth used by the NotificationEngine and the message composer.

export type ContextType =
  | 'school' | 'cluster' | 'activity' | 'planning_gap' | 'my_plan_activity'
  | 'partner_assignment' | 'evidence' | 'verification' | 'salesforce_verification'
  | 'fund_request' | 'payment' | 'accountability' | 'staff_performance'
  | 'target_alert' | 'leave_request' | 'public_holiday' | 'daily_debrief'
  | 'special_project' | 'cost_catalogue' | 'partner_mou' | 'data_quality_issue'
  | 'leadership_decision' | 'recruitment_decision' | 'risk_alert';

// Roles that may act on field-planning routes (My Plan / Planning / scheduling).
const PLANNING_ROLES: EdifyRole[] = ['CCEO', 'CountryProgramLead', 'Admin'];
const isPlanner = (r: EdifyRole) => PLANNING_ROLES.includes(r);
const isPartner = (r: EdifyRole) => r === 'PartnerAdmin' || r === 'PartnerFieldOfficer';

/**
 * Resolve the best route for a recipient to act on a context.
 * Falls back to a safe, role-appropriate landing page rather than a route the
 * role cannot use — so a notification never dead-ends on /access-restricted.
 */
export function resolveContextRoute(
  role: EdifyRole,
  contextType: string | null | undefined,
  contextId: string | null | undefined,
): string {
  const id = contextId ?? '';
  const q = (base: string, key: string) => (id ? `${base}?${key}=${encodeURIComponent(id)}` : base);

  switch (contextType as ContextType) {
    case 'school': {
      if (isPlanner(role)) return id ? `/schools/${id}?view=plan` : '/schools';
      if (role === 'ImpactAssessment') return id ? `/schools/${id}` : '/schools';
      if (role === 'ProjectCoordinator') return id ? `/schools/${id}` : '/schools';
      if (role === 'CountryDirector' || role === 'RegionalVicePresident') return '/analytics'; // country/risk view, summary only
      if (role === 'HumanResources') return '/staff'; // no school-planning route for HR
      return '/dashboard';
    }
    case 'cluster':
      if (isPlanner(role) || role === 'ImpactAssessment') return id ? `/clusters/${id}` : '/clusters';
      return '/analytics';
    case 'planning_gap':
      if (isPlanner(role)) return q('/planning', 'gapId');
      return '/analytics';
    case 'activity':
    case 'my_plan_activity':
      if (role === 'CountryProgramLead') return q('/team-plan', 'activityId');
      if (isPlanner(role)) return q('/my-plan', 'activityId');
      if (isPartner(role)) return q('/partner/activities', 'activityId');
      return '/dashboard';
    case 'partner_assignment':
      if (isPartner(role)) return q('/partner/activities', 'assignmentId');
      if (isPlanner(role)) return q('/partners', 'assignmentId');
      return '/partners';
    case 'evidence':
      if (isPartner(role)) return q('/partner/activities', 'evidenceId');
      if (role === 'ImpactAssessment') return q('/verification', 'evidenceId');
      if (isPlanner(role)) return q('/evidence', 'evidenceId');
      return '/dashboard';
    case 'verification':
      if (role === 'ImpactAssessment') return q('/verification', 'itemId');
      if (isPlanner(role)) return q('/evidence', 'itemId');
      return '/dashboard';
    case 'salesforce_verification':
      if (role === 'ImpactAssessment') return q('/verification', 'activityId');
      if (isPlanner(role)) return q('/my-plan', 'activityId');
      return '/dashboard';
    case 'fund_request':
      // Finance + approval chain land on the request; everyone else gets the list.
      if (['ProgramAccountant', 'CountryDirector', 'RegionalVicePresident', 'CountryProgramLead', 'CCEO', 'Admin'].includes(role))
        return id ? `/fund-requests/${id}` : '/fund-requests';
      return '/dashboard';
    case 'payment':
    case 'accountability':
      if (role === 'ProgramAccountant' || role === 'Admin') return q('/payments', 'paymentId');
      if (isPartner(role)) return '/partner/payments';
      if (isPlanner(role)) return q('/my-plan', 'activityId');
      return '/dashboard';
    case 'staff_performance':
      if (['HumanResources', 'CountryProgramLead', 'CountryDirector', 'RegionalVicePresident', 'Admin'].includes(role))
        return q('/team-targets', 'staffId');
      return '/dashboard';
    case 'target_alert':
      if (role === 'CountryProgramLead') return '/team-targets';
      if (role === 'CCEO') return '/my-targets';
      if (['CountryDirector', 'RegionalVicePresident', 'Admin'].includes(role)) return '/analytics';
      return '/dashboard';
    case 'leave_request':
      if (['HumanResources', 'CountryProgramLead', 'CCEO', 'CountryDirector', 'Admin'].includes(role))
        return q('/leave', 'leaveId');
      return '/dashboard';
    case 'public_holiday':
      if (isPlanner(role)) return '/calendar';
      return '/dashboard';
    case 'daily_debrief':
      return q('/debriefs', 'debriefId');
    case 'special_project':
      if (role === 'ProjectCoordinator' || role === 'Admin') return id ? `/projects/${id}` : '/special-projects';
      return '/special-projects';
    case 'cost_catalogue':
      if (['ProgramAccountant', 'CountryDirector', 'Admin'].includes(role)) return '/cost-settings';
      return '/dashboard';
    case 'partner_mou':
      if (['CountryDirector', 'CountryProgramLead', 'Admin'].includes(role)) return id ? `/partners/${id}` : '/partners';
      return '/partners';
    case 'data_quality_issue':
      if (role === 'ImpactAssessment') return id ? `/schools/${id}` : '/quality-checks';
      if (isPlanner(role)) return id ? `/schools/${id}` : '/schools';
      return '/analytics';
    case 'leadership_decision':
    case 'recruitment_decision':
      if (['CountryDirector', 'RegionalVicePresident', 'CountryProgramLead', 'HumanResources', 'ImpactAssessment', 'Admin'].includes(role))
        return '/analytics/decision-engine';
      return '/dashboard';
    case 'risk_alert':
      if (['CountryDirector', 'RegionalVicePresident', 'CountryProgramLead', 'Admin'].includes(role)) return '/analytics';
      return '/dashboard';
    default:
      return '/notifications';
  }
}

/**
 * Whether a role can actually ACT on a context (vs. only observe it). Used to
 * avoid routing a notification to a role that cannot do anything about it.
 */
export function roleCanActOnContext(role: EdifyRole, contextType: string | null | undefined): boolean {
  switch (contextType as ContextType) {
    case 'planning_gap':
    case 'my_plan_activity':
      return isPlanner(role) || isPartner(role);
    case 'evidence':
    case 'verification':
    case 'salesforce_verification':
      return isPlanner(role) || isPartner(role) || role === 'ImpactAssessment';
    case 'payment':
    case 'accountability':
      return role === 'ProgramAccountant' || role === 'Admin' || isPartner(role);
    case 'fund_request':
      return ['ProgramAccountant', 'CountryDirector', 'RegionalVicePresident', 'CountryProgramLead', 'CCEO', 'Admin'].includes(role);
    case 'leave_request':
      return ['HumanResources', 'CountryProgramLead', 'CCEO', 'Admin'].includes(role);
    case 'staff_performance':
      return ['HumanResources', 'CountryProgramLead', 'CountryDirector', 'RegionalVicePresident', 'Admin'].includes(role);
    default:
      return true; // observational contexts are fine for any authorized recipient
  }
}

/**
 * Stable dedupe key — one unresolved notification per (type, context, recipient).
 * The engine updates the existing row instead of spamming a new one.
 */
export function notificationDedupeKey(type: string, contextType: string | null | undefined, contextId: string | null | undefined, recipientId: string): string {
  return [type, contextType ?? 'none', contextId ?? 'none', recipientId].join('|');
}
