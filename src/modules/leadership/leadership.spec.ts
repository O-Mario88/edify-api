import { describe, it, expect } from 'vitest';
import { recommendPartnerAction } from './partner-performance.service';
import {
  levelFromScore,
  combineConfidence,
  boardsForRole,
  canReviewBoard,
  riskFromHealth,
} from './leadership.types';

// The engine RECOMMENDS; leadership DECIDES. These tests lock the spec's hard
// rules: confidence tracks data completeness, partners are judged conservatively
// (termination needs MULTIPLE poor signals), and role access is tailored.

describe('confidence levels track data completeness', () => {
  it('maps scores to the right confidence band', () => {
    expect(levelFromScore(95)).toBe('high');
    expect(levelFromScore(80)).toBe('high');
    expect(levelFromScore(70)).toBe('medium');
    expect(levelFromScore(40)).toBe('low');
    expect(levelFromScore(20)).toBe('insufficient');
  });

  it('weak/missing inputs drag confidence down (no strong call on weak data)', () => {
    const strong = combineConfidence([
      { label: 'SSA', ratio: 1, weight: 2 },
      { label: 'IA', ratio: 1, weight: 1 },
    ]);
    expect(strong.level).toBe('high');

    const weak = combineConfidence([
      { label: 'SSA', ratio: 0.3, weight: 2 },
      { label: 'IA', ratio: 0, weight: 1 },
    ]);
    expect(weak.level === 'low' || weak.level === 'insufficient').toBe(true);
    expect(weak.missing).toContain('IA');
  });

  it('empty scope is insufficient, never invented', () => {
    expect(combineConfidence([{ label: 'No schools', ratio: 0 }]).level).toBe('insufficient');
  });
});

describe('partner recommendation — measured fairly, terminates only on multiple signals', () => {
  const base = {
    assigned: 20, targetAchievementRate: 90, evidenceAcceptanceRate: 90,
    interventionImpactScore: 70, overdueRate: 5, capacityUtilization: 60, active: true,
  };
  it('strong performance → renew', () => {
    expect(recommendPartnerAction(base)).toBe('renew');
  });
  it('no assignments → no_assignments (not punished)', () => {
    expect(recommendPartnerAction({ ...base, assigned: 0 })).toBe('no_assignments');
  });
  it('inactive partner → inactive', () => {
    expect(recommendPartnerAction({ ...base, active: false })).toBe('inactive');
  });
  it('a SINGLE weak signal does NOT trigger termination review', () => {
    const oneWeak = recommendPartnerAction({ ...base, targetAchievementRate: 45 });
    expect(oneWeak).not.toBe('terminate_review');
  });
  it('MULTIPLE poor signals together → terminate_review (human review, not auto)', () => {
    const r = recommendPartnerAction({
      ...base, targetAchievementRate: 40, evidenceAcceptanceRate: 50, interventionImpactScore: 20,
    });
    expect(r).toBe('terminate_review');
  });
  it('over-capacity / overdue → reduce_or_pause before any termination', () => {
    expect(recommendPartnerAction({ ...base, capacityUtilization: 130 })).toBe('reduce_or_pause');
    expect(recommendPartnerAction({ ...base, overdueRate: 40 })).toBe('reduce_or_pause');
  });
  it('insufficient impact data does not block a fair conditional renewal', () => {
    const r = recommendPartnerAction({ ...base, targetAchievementRate: 70, interventionImpactScore: null });
    expect(['renew', 'renew_with_conditions']).toContain(r);
  });
});

describe('role-tailored board access (spec Access Control)', () => {
  it('CD/Admin see every board', () => {
    expect(boardsForRole('CountryDirector')).toHaveLength(5);
    expect(boardsForRole('Admin')).toHaveLength(5);
  });
  it('HR sees only staff & staffing boards', () => {
    expect(boardsForRole('HumanResources').sort()).toEqual(['staff_addition', 'staff_hr']);
  });
  it('IA sees the data-confidence / impact lens, not partner MOU or staff HR', () => {
    const b = boardsForRole('ImpactAssessment');
    expect(b).not.toContain('partner');
    expect(b).not.toContain('staff_hr');
  });
  it('Accountant sees finance-implication boards only', () => {
    expect(boardsForRole('ProgramAccountant').sort()).toEqual(['partner', 'regional_investment']);
  });
});

describe('review authority is board-aware', () => {
  it('IA + Accountant cannot review (view only)', () => {
    expect(canReviewBoard('ImpactAssessment', 'recruitment')).toBe(false);
    expect(canReviewBoard('ProgramAccountant', 'partner')).toBe(false);
  });
  it('HR may decide staff HR but not partner MOUs', () => {
    expect(canReviewBoard('HumanResources', 'staff_hr')).toBe(true);
    expect(canReviewBoard('HumanResources', 'partner')).toBe(false);
  });
  it('CD may decide on any board', () => {
    expect(canReviewBoard('CountryDirector', 'partner')).toBe(true);
    expect(canReviewBoard('CountryDirector', 'staff_hr')).toBe(true);
  });
});

describe('risk escalates as health falls', () => {
  it('low health → critical, high health → low', () => {
    expect(riskFromHealth(90)).toBe('low');
    expect(riskFromHealth(60)).toBe('medium');
    expect(riskFromHealth(40)).toBe('high');
    expect(riskFromHealth(20)).toBe('critical');
  });
});
