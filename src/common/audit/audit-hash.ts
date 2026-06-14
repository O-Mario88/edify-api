import { createHash } from 'node:crypto';

// Pure audit hash-chain helpers (no Nest deps) so they can be reused by the
// AuditService, the chain verifier CLI, and unit tests.

// Deterministic JSON: object keys sorted recursively, so a payload re-serialized
// from the DB hashes identically to the original.
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export interface CanonicalAuditFields {
  action: string;
  subjectKind?: string | null;
  subjectId?: string | null;
  actorId?: string | null;
  actorRole?: string | null;
  success: boolean;
  reason?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  correlationId?: string | null;
  payload: unknown;
}

// The canonical, hashed representation of an audit record's business fields.
export function canonicalAudit(r: CanonicalAuditFields): string {
  return stableStringify([
    r.action,
    r.subjectKind ?? null,
    r.subjectId ?? null,
    r.actorId ?? null,
    r.actorRole ?? null,
    r.success,
    r.reason ?? null,
    r.ipAddress ?? null,
    r.userAgent ?? null,
    r.correlationId ?? null,
    r.payload ?? null,
  ]);
}

export function chainHash(prevHash: string, canonical: string): string {
  return createHash('sha256').update(`${prevHash}\n${canonical}`).digest('hex');
}
