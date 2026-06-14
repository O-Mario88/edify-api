import { describe, it, expect } from 'vitest';
import { canonicalAudit, chainHash, stableStringify, type CanonicalAuditFields } from './audit-hash';

const rec = (over: Partial<CanonicalAuditFields> = {}): CanonicalAuditFields => ({
  action: 'payment.cleared',
  subjectKind: 'Activity',
  subjectId: 'a1',
  actorId: 'u1',
  actorRole: 'ProgramAccountant',
  success: true,
  reason: null,
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
  correlationId: 'c1',
  payload: { amount: 120000 },
  ...over,
});

describe('audit hash chain', () => {
  it('stableStringify is key-order independent', () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
  });

  it('canonicalAudit is deterministic for the same record', () => {
    expect(canonicalAudit(rec())).toBe(canonicalAudit(rec()));
  });

  it('a changed field changes the hash (tamper-evident)', () => {
    const h1 = chainHash('', canonicalAudit(rec()));
    const h2 = chainHash('', canonicalAudit(rec({ payload: { amount: 999999 } })));
    expect(h1).not.toBe(h2);
  });

  it('links: each hash incorporates the previous (a re-link breaks)', () => {
    const h1 = chainHash('', canonicalAudit(rec({ subjectId: 'a1' })));
    const h2 = chainHash(h1, canonicalAudit(rec({ subjectId: 'a2' })));
    // Recomputing h2 with the WRONG prevHash yields a different hash → detect.
    const tampered = chainHash('deadbeef', canonicalAudit(rec({ subjectId: 'a2' })));
    expect(tampered).not.toBe(h2);
  });

  it('verifies a clean 3-link chain', () => {
    const recs = [rec({ subjectId: 'a1' }), rec({ subjectId: 'a2' }), rec({ subjectId: 'a3' })];
    let prev = '';
    const chain = recs.map((r) => {
      const hash = chainHash(prev, canonicalAudit(r));
      const link = { prevHash: prev, hash, r };
      prev = hash;
      return link;
    });
    // Independent verification pass.
    let p = '';
    for (const link of chain) {
      expect(link.prevHash).toBe(p);
      expect(chainHash(p, canonicalAudit(link.r))).toBe(link.hash);
      p = link.hash;
    }
  });
});
