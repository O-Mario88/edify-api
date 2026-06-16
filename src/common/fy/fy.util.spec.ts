import { describe, it, expect } from "vitest";
import { getOperationalFY, getQuarterForDate, getCumulativeTargetPercentage } from "./fy.util";

// FY runs Oct 1 → Sep 30; label = the calendar year the FY ends in.
describe("operational FY label", () => {
  it("Oct–Dec maps to next year's FY", () => {
    expect(getOperationalFY(new Date(Date.UTC(2025, 9, 1)))).toBe("2026"); // Oct
    expect(getOperationalFY(new Date(Date.UTC(2025, 11, 31)))).toBe("2026"); // Dec
  });
  it("Jan–Sep maps to the same calendar year's FY", () => {
    expect(getOperationalFY(new Date(Date.UTC(2026, 0, 15)))).toBe("2026"); // Jan
    expect(getOperationalFY(new Date(Date.UTC(2026, 8, 30)))).toBe("2026"); // Sep
  });
});

describe("operational quarter", () => {
  it("maps months to the right quarter (Q1 Oct–Dec … Q4 Jul–Sep)", () => {
    expect(getQuarterForDate(new Date(Date.UTC(2025, 9, 1)))).toBe("Q1"); // Oct
    expect(getQuarterForDate(new Date(Date.UTC(2026, 1, 1)))).toBe("Q2"); // Feb
    expect(getQuarterForDate(new Date(Date.UTC(2026, 4, 1)))).toBe("Q3"); // May
    expect(getQuarterForDate(new Date(Date.UTC(2026, 7, 1)))).toBe("Q4"); // Aug
  });
});

describe("cumulative target percentages", () => {
  it("mid-year expects 50%, end-year 100%", () => {
    expect(getCumulativeTargetPercentage("MidYear")).toBe(50);
    expect(getCumulativeTargetPercentage("FY")).toBe(100);
    expect(getCumulativeTargetPercentage("Q1")).toBe(25);
    expect(getCumulativeTargetPercentage("Q3")).toBe(75);
  });
});

// Period-integrity reconciliation — guards the activities.service period
// derivation that backs every quarter/FY rollup. The audit found the seed had
// hardcoded quarter='Q2' on May/June scheduledDates (operationally Q3); the
// service + seed now DERIVE period from the date. These pin the contract those
// derivations rely on, including quarter boundaries and the FY rollover.
describe("period derivation reconciliation (audit P0#40 / P1-D)", () => {
  const q = (y: number, m: number, d: number) => getQuarterForDate(new Date(Date.UTC(y, m, d)));
  const fy = (y: number, m: number, d: number) => getOperationalFY(new Date(Date.UTC(y, m, d)));

  it("the seeded May–June 2026 window is Q3, not Q2", () => {
    expect(q(2026, 4, 11)).toBe("Q3"); // May 11 2026 (seed min scheduledDate)
    expect(q(2026, 5, 24)).toBe("Q3"); // Jun 24 2026 (seed max scheduledDate)
    expect(fy(2026, 5, 12)).toBe("2026");
  });

  it("first and last day of every quarter resolve correctly", () => {
    // Q1 Oct–Dec
    expect(q(2025, 9, 1)).toBe("Q1");
    expect(q(2025, 11, 31)).toBe("Q1");
    // Q2 Jan–Mar
    expect(q(2026, 0, 1)).toBe("Q2");
    expect(q(2026, 2, 31)).toBe("Q2");
    // Q3 Apr–Jun
    expect(q(2026, 3, 1)).toBe("Q3");
    expect(q(2026, 5, 30)).toBe("Q3");
    // Q4 Jul–Sep
    expect(q(2026, 6, 1)).toBe("Q4");
    expect(q(2026, 8, 30)).toBe("Q4");
  });

  it("FY rolls over exactly at Sep 30 → Oct 1", () => {
    expect(fy(2026, 8, 30)).toBe("2026"); // Sep 30 2026 — last day of FY2026
    expect(q(2026, 8, 30)).toBe("Q4");
    expect(fy(2026, 9, 1)).toBe("2027"); // Oct 1 2026 — first day of FY2027
    expect(q(2026, 9, 1)).toBe("Q1");
  });

  it("a baseline SSA dated in FY2025 is a real prior-FY record (impact comparison)", () => {
    expect(fy(2025, 1, 15)).toBe("2025"); // Feb 2025 — the corrected baseline date
    expect(fy(2025, 9, 1)).toBe("2026"); // Oct 2025 — would WRONGLY be FY2026 (the old bug)
  });
});
