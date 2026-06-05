// Operational Fiscal Year utilities. FY runs October 1 → September 30.
// FY label is the calendar year in which the FY ENDS (so Oct 2025 → "2026").
// Quarters: Q1 Oct–Dec, Q2 Jan–Mar, Q3 Apr–Jun, Q4 Jul–Sep.

export type Quarter = 'Q1' | 'Q2' | 'Q3' | 'Q4';
export type CumulativePeriod = 'Q1' | 'Q2' | 'MidYear' | 'Q3' | 'Q4' | 'FY';

/** The operational FY label for a date (FY starts Oct 1). */
export function getOperationalFY(date: Date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth(); // 0=Jan
  return String(m >= 9 ? y + 1 : y); // Oct(9)–Dec → next year's FY
}

/** Calendar date range [start, end) for an FY label. */
export function getFYDateRange(fy: string): { start: Date; end: Date } {
  const fyNum = Number(fy);
  // FY "2026" = Oct 1 2025 → Oct 1 2026.
  return {
    start: new Date(Date.UTC(fyNum - 1, 9, 1)),
    end: new Date(Date.UTC(fyNum, 9, 1)),
  };
}

const QUARTER_START_MONTH: Record<Quarter, number> = { Q1: 9, Q2: 0, Q3: 3, Q4: 6 };

/** The quarter a date falls in within the operational FY. */
export function getQuarterForDate(date: Date = new Date()): Quarter {
  const m = date.getUTCMonth();
  if (m >= 9) return 'Q1'; // Oct–Dec
  if (m <= 2) return 'Q2'; // Jan–Mar
  if (m <= 5) return 'Q3'; // Apr–Jun
  return 'Q4'; // Jul–Sep
}

export function getQuarterDateRange(fy: string, quarter: Quarter): { start: Date; end: Date } {
  const fyNum = Number(fy);
  const startMonth = QUARTER_START_MONTH[quarter];
  // Q1 sits in the prior calendar year; Q2–Q4 in the FY year.
  const startYear = quarter === 'Q1' ? fyNum - 1 : fyNum;
  const start = new Date(Date.UTC(startYear, startMonth, 1));
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 3);
  return { start, end };
}

/** Mid-Year = Q1 + Q2 (Oct → Mar). */
export function getMidYearRange(fy: string): { start: Date; end: Date } {
  const q1 = getQuarterDateRange(fy, 'Q1');
  const q2 = getQuarterDateRange(fy, 'Q2');
  return { start: q1.start, end: q2.end };
}

/** Calendar month range for a 1-based month-of-FY (1 = October). */
export function getMonthDateRange(fy: string, monthOfFy: number): { start: Date; end: Date } {
  const { start: fyStart } = getFYDateRange(fy);
  const start = new Date(fyStart);
  start.setUTCMonth(start.getUTCMonth() + (monthOfFy - 1));
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}

/** Cumulative target percentage expected by the end of a period. */
export function getCumulativeTargetPercentage(period: CumulativePeriod): number {
  switch (period) {
    case 'Q1': return 25;
    case 'Q2':
    case 'MidYear': return 50;
    case 'Q3': return 75;
    case 'Q4':
    case 'FY': return 100;
  }
}

/** FY dropdown options from FY 2025 upward through the current FY (+1 ahead). */
export function fyOptions(now: Date = new Date()): string[] {
  const current = Number(getOperationalFY(now));
  const out: string[] = [];
  for (let y = 2025; y <= current + 1; y++) out.push(String(y));
  return out;
}
