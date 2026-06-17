import { describe, it, expect } from 'vitest';
import { districtStatus } from './geo-status';

// The geo-map choropleth + district drawer both read this status. Locks the
// leadership signal so a district's colour band never disagrees with its label.

describe('districtStatus', () => {
  it('insufficient_data when there is no SSA average', () => {
    expect(districtStatus(null, 50, 0)).toBe('insufficient_data');
  });

  it('high_risk when the average is below 5', () => {
    expect(districtStatus(4.9, 50, 5)).toBe('high_risk');
  });

  it('high_risk when ≥30% of schools are critical, even if the average is okay', () => {
    expect(districtStatus(7.5, 50, 15)).toBe('high_risk'); // 30% critical
  });

  it('needs_attention for a mid average (5–7)', () => {
    expect(districtStatus(6.2, 50, 0)).toBe('needs_attention');
  });

  it('needs_attention when any school is critical even with a good average', () => {
    expect(districtStatus(7.8, 50, 1)).toBe('needs_attention');
  });

  it('healthy for a strong average with no critical schools', () => {
    expect(districtStatus(7.5, 50, 0)).toBe('healthy');
    expect(districtStatus(9.0, 50, 0)).toBe('healthy');
  });

  it('handles zero schools without dividing by zero', () => {
    expect(districtStatus(8, 0, 0)).toBe('healthy');
  });
});
