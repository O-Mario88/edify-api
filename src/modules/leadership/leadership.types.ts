import { DecisionConfidenceLevel, DecisionRiskLevel } from '@prisma/client';

// ── Confidence ────────────────────────────────────────────────────────────
// Confidence is driven by DATA COMPLETENESS, never by how "strong" a signal
// looks. Weak data ⇒ low/insufficient confidence ⇒ the engine must NOT make a
// strong recommendation. Spec: "Do not generate strong recommendations from
// weak data."

export interface ConfidencePart {
  label: string;
  ratio: number; // 0..1 completeness of this input
  weight?: number; // default 1
}

export interface ConfidenceResult {
  score: number; // 0..100
  level: DecisionConfidenceLevel;
  factors: { label: string; ratioPct: number }[];
  missing: string[]; // labels whose completeness is materially below full
}

export function levelFromScore(score: number): DecisionConfidenceLevel {
  if (score >= 80) return 'high';
  if (score >= 60) return 'medium';
  if (score >= 35) return 'low';
  return 'insufficient';
}

export function combineConfidence(parts: ConfidencePart[]): ConfidenceResult {
  const usable = parts.filter((p) => Number.isFinite(p.ratio));
  const totalWeight = usable.reduce((s, p) => s + (p.weight ?? 1), 0) || 1;
  const score = Math.round(
    (usable.reduce((s, p) => s + clamp01(p.ratio) * (p.weight ?? 1), 0) / totalWeight) * 100,
  );
  return {
    score,
    level: levelFromScore(score),
    factors: parts.map((p) => ({ label: p.label, ratioPct: Math.round(clamp01(p.ratio) * 100) })),
    missing: parts.filter((p) => clamp01(p.ratio) < 0.85).map((p) => p.label),
  };
}

// A recommendation may never be stronger than its data supports. When
// confidence is `insufficient`, callers must downgrade the recommendation to a
// "gather data first" posture instead of a strong action.
export function gateRecommendation(level: DecisionConfidenceLevel): boolean {
  return level !== 'insufficient';
}

// ── Reference capacities (proxies, documented as such) ──────────────────────
// No rural/urban or travel data exists yet, so workload difficulty is derived
// from load + geographic spread. These references are deliberately explicit so
// the fairness model is inspectable and CD/IA-tunable later.
export const REF_SCHOOLS_PER_STAFF = 50; // soft direct-support reference
export const REF_CORE_PER_STAFF = 12;
export const REF_PARTNERS_PER_STAFF = 4;
export const REF_PARTNER_ACTIVITY_CAPACITY = 30; // assigned activities / FY

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
export function clamp100(n: number): number {
  return Math.max(0, Math.min(100, n));
}
export function pct(n: number, d: number): number {
  return d > 0 ? (n / d) * 100 : 0;
}

// Risk escalates as readiness/health falls. Shared so every board speaks the
// same risk language.
export function riskFromHealth(healthPct: number): DecisionRiskLevel {
  if (healthPct >= 75) return 'low';
  if (healthPct >= 55) return 'medium';
  if (healthPct >= 35) return 'high';
  return 'critical';
}

// ── Role → board visibility (spec "Access Control") ─────────────────────────
import { DecisionType, EdifyRole } from '@prisma/client';

export const ALL_BOARDS: DecisionType[] = [
  'recruitment',
  'staff_addition',
  'partner',
  'staff_hr',
  'regional_investment',
];

// Which boards a role may see. The page is permission-gated (LEADERSHIP_ENGINE_VIEW);
// this further tailors WHICH boards render per role so HR never sees partner
// MOU termination authority, the accountant sees finance implications only, etc.
export function boardsForRole(role: EdifyRole): DecisionType[] {
  switch (role) {
    case 'Admin':
    case 'CountryDirector':
      return ALL_BOARDS;
    case 'RegionalVicePresident':
      // Country/region summary + investment + the high-level risk boards.
      return ['recruitment', 'staff_addition', 'partner', 'regional_investment'];
    case 'HumanResources':
      return ['staff_hr', 'staff_addition'];
    case 'ImpactAssessment':
      // Data-confidence + SSA-impact readiness lens.
      return ['recruitment', 'regional_investment'];
    case 'ProgramAccountant':
      // Finance-implication view of the investment/partner boards only.
      return ['regional_investment', 'partner'];
    case 'CountryProgramLead':
      // Supervised-team decision support.
      return ['staff_hr', 'staff_addition', 'partner'];
    default:
      return [];
  }
}

// Whether a role may take the human-review action on a given board. Partner MOU
// + staff HR decisions need explicit review authority (LEADERSHIP_DECISION_REVIEW),
// enforced at the controller; this is the board-level nuance.
export function canReviewBoard(role: EdifyRole, board: DecisionType): boolean {
  if (role === 'Admin' || role === 'CountryDirector') return true;
  if (role === 'RegionalVicePresident') return board !== 'staff_hr';
  if (role === 'HumanResources') return board === 'staff_hr' || board === 'staff_addition';
  if (role === 'CountryProgramLead') return board === 'staff_hr' || board === 'staff_addition';
  return false; // IA, Accountant: view only
}
