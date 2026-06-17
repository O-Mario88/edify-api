import { describe, it, expect } from 'vitest';
import { geoWhere, geoActive, type GeoFilter } from './analytics.service';

// Pure-unit spec for the shared geography filter resolver — the bridge between
// the FE filter bar (district *name*, region *key*) and the backend (cuid +
// relation filters). Locks the two guarantees the filter-accuracy audit cares
// about: (1) a selected geography turns into a NARROWING where-fragment, and
// (2) it ONLY narrows — it never sets `id`, so it composes with the role scope
// (Prisma ANDs them) and a scoped user can never widen past their scope.

describe('geoWhere — name/key → relation filter', () => {
  it('returns an empty fragment when nothing is selected', () => {
    expect(geoWhere(undefined)).toEqual({});
    expect(geoWhere({})).toEqual({});
  });

  it('treats the __all__ sentinel and empty strings as "no filter"', () => {
    expect(geoWhere({ region: '__all__', district: '__all__', cluster: '__all__' })).toEqual({});
    expect(geoWhere({ region: '', district: '' })).toEqual({});
  });

  it('resolves a district by NAME via a relation filter', () => {
    expect(geoWhere({ district: 'Gulu' })).toEqual({ district: { name: 'Gulu' } });
  });

  it('resolves a region by KEY case-insensitively (FE "northern" → "Northern")', () => {
    expect(geoWhere({ region: 'northern' })).toEqual({
      region: { name: { equals: 'northern', mode: 'insensitive' } },
    });
  });

  it('resolves a cluster by its cuid (the FE already holds the backend id)', () => {
    expect(geoWhere({ cluster: 'clu_abc' })).toEqual({ clusterId: 'clu_abc' });
  });

  it('combines multiple selections (AND of relation keys)', () => {
    expect(geoWhere({ region: 'eastern', district: 'Mbale' })).toEqual({
      region: { name: { equals: 'eastern', mode: 'insensitive' } },
      district: { name: 'Mbale' },
    });
  });

  it('NEVER sets `id` — so it cannot overwrite the role scope, only narrow it', () => {
    const all: GeoFilter = { region: 'northern', district: 'Gulu', cluster: 'clu_x' };
    expect('id' in geoWhere(all)).toBe(false);
    // Composed with a role scope that pins id IN (...), the geo keys are ANDed on
    // top — they never replace the id constraint, so an out-of-scope district
    // intersects to 0 rows instead of leaking.
    const scoped = { deletedAt: null, id: { in: ['s1', 's2'] }, ...geoWhere(all) };
    expect(scoped.id).toEqual({ in: ['s1', 's2'] });
    expect(scoped.district).toEqual({ name: 'Gulu' });
  });
});

describe('geoActive — is any geography selected?', () => {
  it('is false for undefined / empty / all-sentinel', () => {
    expect(geoActive(undefined)).toBe(false);
    expect(geoActive({})).toBe(false);
    expect(geoActive({ region: '__all__', district: '__all__' })).toBe(false);
  });

  it('is true as soon as one real value is present', () => {
    expect(geoActive({ district: 'Gulu' })).toBe(true);
    expect(geoActive({ region: 'eastern' })).toBe(true);
    expect(geoActive({ cluster: 'clu_x' })).toBe(true);
  });
});
