import { describe, it, expect } from 'vitest';
import { resolveContextRoute, roleCanActOnContext, notificationDedupeKey } from './context-route';

// The communication nervous system must deep-link the right role to the right
// record — and NEVER send a role to a route it can't act on.
describe('resolveContextRoute — role-aware deep links', () => {
  it('routes a struggling-school context per role (planner→plan, CD→analytics, HR→staff)', () => {
    expect(resolveContextRoute('CCEO', 'school', 'S1')).toBe('/schools/S1?view=plan');
    expect(resolveContextRoute('CountryProgramLead', 'school', 'S1')).toBe('/schools/S1?view=plan');
    expect(resolveContextRoute('ImpactAssessment', 'school', 'S1')).toBe('/schools/S1');
    // CD/RVP get the summary/risk view — NOT a planning route they can't use.
    expect(resolveContextRoute('CountryDirector', 'school', 'S1')).toBe('/analytics');
    expect(resolveContextRoute('RegionalVicePresident', 'school', 'S1')).toBe('/analytics');
    // HR has no school-planning route.
    expect(resolveContextRoute('HumanResources', 'school', 'S1')).toBe('/staff');
  });

  it('routes a planning gap to planners only', () => {
    expect(resolveContextRoute('CCEO', 'planning_gap', 'G1')).toBe('/planning?gapId=G1');
    expect(resolveContextRoute('CountryDirector', 'planning_gap', 'G1')).toBe('/analytics');
  });

  it('routes my-plan/activity per actor (PL→team-plan, CCEO→my-plan, partner→partner)', () => {
    expect(resolveContextRoute('CountryProgramLead', 'my_plan_activity', 'A1')).toBe('/team-plan?activityId=A1');
    expect(resolveContextRoute('CCEO', 'my_plan_activity', 'A1')).toBe('/my-plan?activityId=A1');
    expect(resolveContextRoute('PartnerFieldOfficer', 'activity', 'A1')).toBe('/partner/activities?activityId=A1');
  });

  it('routes evidence per reviewer (IA→verification, partner→partner, CCEO→evidence)', () => {
    expect(resolveContextRoute('ImpactAssessment', 'evidence', 'E1')).toBe('/verification?evidenceId=E1');
    expect(resolveContextRoute('PartnerAdmin', 'evidence', 'E1')).toBe('/partner/activities?evidenceId=E1');
    expect(resolveContextRoute('CCEO', 'evidence', 'E1')).toBe('/evidence?evidenceId=E1');
  });

  it('routes money contexts to finance, never to a planner deep-link they cannot clear', () => {
    expect(resolveContextRoute('ProgramAccountant', 'fund_request', 'F1')).toBe('/fund-requests/F1');
    expect(resolveContextRoute('ProgramAccountant', 'payment', 'P1')).toBe('/payments?paymentId=P1');
    // a partner can see their own payments page, not the accountant queue
    expect(resolveContextRoute('PartnerAdmin', 'payment', 'P1')).toBe('/partner/payments');
  });

  it('routes HR/leave + staff-performance to the people roles', () => {
    expect(resolveContextRoute('HumanResources', 'leave_request', 'L1')).toBe('/leave?leaveId=L1');
    expect(resolveContextRoute('HumanResources', 'staff_performance', 'STF1')).toBe('/team-targets?staffId=STF1');
    expect(resolveContextRoute('CCEO', 'staff_performance', 'STF1')).toBe('/dashboard'); // CCEO can't see peers' bands
  });

  it('falls back safely for an unknown context (never /access-restricted)', () => {
    expect(resolveContextRoute('CCEO', 'totally_unknown', 'X')).toBe('/notifications');
    expect(resolveContextRoute('CCEO', 'planning_gap', null)).toBe('/planning'); // no id → list, still valid
  });
});

describe('roleCanActOnContext', () => {
  it('only planners/partners can act on a planning gap or my-plan item', () => {
    expect(roleCanActOnContext('CCEO', 'planning_gap')).toBe(true);
    expect(roleCanActOnContext('CountryProgramLead', 'my_plan_activity')).toBe(true);
    expect(roleCanActOnContext('CountryDirector', 'planning_gap')).toBe(false);
    expect(roleCanActOnContext('HumanResources', 'my_plan_activity')).toBe(false);
  });
  it('only finance can act on a payment; only HR/PL chain on leave', () => {
    expect(roleCanActOnContext('ProgramAccountant', 'payment')).toBe(true);
    expect(roleCanActOnContext('CCEO', 'payment')).toBe(false);
    expect(roleCanActOnContext('HumanResources', 'leave_request')).toBe(true);
    expect(roleCanActOnContext('ProgramAccountant', 'leave_request')).toBe(false);
  });
  it('observational contexts are open to any authorized recipient', () => {
    expect(roleCanActOnContext('CountryDirector', 'risk_alert')).toBe(true);
    expect(roleCanActOnContext('RegionalVicePresident', 'target_alert')).toBe(true);
  });
});

describe('notificationDedupeKey', () => {
  it('is stable for the same (type, context, recipient) and distinct otherwise', () => {
    const a = notificationDedupeKey('evidence_missing', 'evidence', 'A1', 'U1');
    const b = notificationDedupeKey('evidence_missing', 'evidence', 'A1', 'U1');
    const c = notificationDedupeKey('evidence_missing', 'evidence', 'A2', 'U1');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
