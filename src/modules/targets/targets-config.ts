// Target-framework shared config: category → activity classification, the
// cumulative period ladder, and small math helpers. Kept separate so the
// service and (later) the analytics layer agree on what counts as a training
// vs a visit, and what "Mid-Year" cumulatively means.

export const DONE_STATUSES = ['completed', 'ia_verified', 'accountant_confirmed'];
// "Planned" denominator — everything except states that mean the work won't happen.
export const PLANNED_EXCLUDE = ['cancelled', 'rejected', 'not_planned'];

// Activity-type buckets (item 6 / item 8). Project/partner activities are
// classified by their underlying type where possible; partner-vs-staff is the
// deliveryType, not the activityType.
export const TRAINING_TYPES = [
  'training', 'school_improvement_training', 'cluster_training', 'core_training',
];
export const VISIT_TYPES = [
  'school_visit', 'follow_up_visit', 'coaching_visit', 'in_school_support', 'core_visit',
];

// Cumulative period ladder. FY starts Oct 1 (Q1 = Oct–Dec … Q4 = Jul–Sep).
// pct = default cumulative fraction of the annual target due by the period end.
export const PERIODS: { label: string; quarters: string[]; pct: number }[] = [
  { label: 'Q1', quarters: ['Q1'], pct: 0.25 },
  { label: 'Q2', quarters: ['Q1', 'Q2'], pct: 0.5 },
  { label: 'Mid-Year', quarters: ['Q1', 'Q2'], pct: 0.5 },
  { label: 'Q3', quarters: ['Q1', 'Q2', 'Q3'], pct: 0.75 },
  { label: 'Q4', quarters: ['Q1', 'Q2', 'Q3', 'Q4'], pct: 1.0 },
  { label: 'End of Year', quarters: ['Q1', 'Q2', 'Q3', 'Q4'], pct: 1.0 },
];

// FY-aware quarter from a calendar month (1–12).
export function quarterOfMonth(month: number): string {
  if (month >= 10 && month <= 12) return 'Q1';
  if (month >= 1 && month <= 3) return 'Q2';
  if (month >= 4 && month <= 6) return 'Q3';
  return 'Q4';
}
export function quarterOfDate(d: Date | null | undefined): string | null {
  if (!d) return null;
  return quarterOfMonth(d.getUTCMonth() + 1);
}

export function pct(achieved: number, target: number): number | null {
  return target > 0 ? Math.round((achieved / target) * 100) : null;
}

export function statusOf(p: number | null): string {
  if (p === null) return 'No Target';
  if (p >= 100) return 'Ahead';
  if (p >= 90) return 'On Track';
  if (p >= 75) return 'Slightly Behind';
  if (p >= 50) return 'Behind';
  return 'Critical';
}

// Overall health across categories = average of the categories that have a
// target set. Returns null when nothing is targeted.
export function overallHealth(pcts: (number | null)[]): { pct: number | null; status: string } {
  const real = pcts.filter((p): p is number => p !== null);
  if (!real.length) return { pct: null, status: 'No Target' };
  const avg = Math.round(real.reduce((s, p) => s + p, 0) / real.length);
  return { pct: avg, status: statusOf(avg) };
}

// Cumulative fraction due by a period, honoring a CD/IA custom distribution
// (a map of per-quarter fractions that should already be cumulative-friendly).
export function cumulativeFraction(
  quarters: string[],
  defaultPct: number,
  custom?: Record<string, number> | null,
): number {
  if (!custom) return defaultPct;
  // Sum the custom per-quarter weights for the quarters in this period.
  const last = quarters[quarters.length - 1];
  if (custom[last] != null) return custom[last]; // treat custom values as cumulative checkpoints
  return defaultPct;
}
