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
