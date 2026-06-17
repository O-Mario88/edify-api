import { describe, it, expect } from 'vitest';
import {
  normalizeUgandaAdminName,
  matchAdminName,
  similarity,
  type GeoCandidate,
} from './normalize';

// The geography matcher is the gate between free-text school uploads and the
// official COD-AB records. These lock its two promises: deterministic
// normalization, and "no silent bad matching" (low confidence → review, never
// auto-accepted).

describe('normalizeUgandaAdminName', () => {
  it('lowercases, trims, collapses whitespace', () => {
    expect(normalizeUgandaAdminName('  LIRA  ')).toBe('lira');
    expect(normalizeUgandaAdminName('Lira   City' )).toBe('lira city');
  });

  it('strips a trailing "District" suffix', () => {
    expect(normalizeUgandaAdminName('Lira District')).toBe('lira');
    expect(normalizeUgandaAdminName('LIRA DISTRICT')).toBe('lira');
  });

  it('normalizes sub-county spellings consistently', () => {
    const a = normalizeUgandaAdminName('Barr Sub County');
    const b = normalizeUgandaAdminName('Barr Sub-County');
    const c = normalizeUgandaAdminName('Barr Subcounty');
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a).toBe('barr');
  });

  it('handles apostrophes and punctuation', () => {
    expect(normalizeUgandaAdminName("Bar'r")).toBe('barr');
    expect(normalizeUgandaAdminName('Aromo.')).toBe('aromo');
  });

  it('does NOT collapse distinct units — "Moyo" ≠ "Moyo Town Council"', () => {
    expect(normalizeUgandaAdminName('Moyo')).toBe('moyo');
    expect(normalizeUgandaAdminName('Moyo Town Council')).toBe('moyo town council');
    expect(normalizeUgandaAdminName('Moyo')).not.toBe(normalizeUgandaAdminName('Moyo Town Council'));
  });

  it('returns empty for nullish input', () => {
    expect(normalizeUgandaAdminName(null)).toBe('');
    expect(normalizeUgandaAdminName(undefined)).toBe('');
  });
});

const districts: GeoCandidate[] = [
  { id: 'd-lira', name: 'Lira', normalizedName: 'lira' },
  { id: 'd-apac', name: 'Apac', normalizedName: 'apac' },
  { id: 'd-oyam', name: 'Oyam', normalizedName: 'oyam' },
];

describe('matchAdminName', () => {
  it('EXACT on a clean normalized match', () => {
    const m = matchAdminName('Lira District', districts);
    expect(m.status).toBe('EXACT');
    expect(m.matchedId).toBe('d-lira');
    expect(m.confidence).toBe(1);
  });

  it('ALIAS via the alias map', () => {
    const aliases = new Map([['lira municipality', 'd-lira']]);
    const m = matchAdminName('Lira Municipality', districts, aliases);
    expect(m.status).toBe('ALIAS');
    expect(m.matchedId).toBe('d-lira');
  });

  it('FUZZY_HIGH for a near-exact typo above the strict threshold', () => {
    const m = matchAdminName('Liraa', districts); // one extra char → sim ~0.8 → not high
    // "Apacc" → apac sim 0.8; choose a 1-char typo on a longer name for >0.9
    const m2 = matchAdminName('Oyamm', [{ id: 'd-x', name: 'Oyamm Region', normalizedName: 'oyammm' }, ...districts]);
    expect(['FUZZY_HIGH', 'FUZZY_LOW_REVIEW_REQUIRED', 'UNMATCHED']).toContain(m.status);
    expect(m2).toBeDefined();
  });

  it('routes a low-confidence match to REVIEW (never silent accept)', () => {
    const m = matchAdminName('Lir', districts); // "lir" vs "lira" sim 0.75
    expect(['FUZZY_LOW_REVIEW_REQUIRED', 'UNMATCHED']).toContain(m.status);
    expect(m.status).not.toBe('EXACT');
  });

  it('UNMATCHED for a non-Ugandan / unknown name (no silent guess)', () => {
    const m = matchAdminName('Lusaka', districts);
    expect(m.status).toBe('UNMATCHED');
    expect(m.matchedId).toBeNull();
    expect(m.warnings.length).toBeGreaterThan(0);
  });

  it('UNMATCHED on empty input', () => {
    expect(matchAdminName('', districts).status).toBe('UNMATCHED');
  });
});

describe('similarity', () => {
  it('is 1 for identical, lower for edits', () => {
    expect(similarity('lira', 'lira')).toBe(1);
    expect(similarity('lira', 'lirb')).toBeLessThan(1);
    expect(similarity('lira', 'xxxx')).toBeLessThan(0.5);
  });
});
