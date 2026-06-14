// Salesforce-ready ID validation. Salesforce is NOT integrated — users enter
// these IDs manually and IA confirms. Visits use SV-, trainings/cluster
// meetings/SIT use TS-. When integration lands, this stays the entry contract.

// Visits accept SV- (canonical) AND SVE- (the prefix the frontend form emits) —
// otherwise a visit ID a user enters in the FE was silently rejected here,
// breaking completion in backend mode. Both forms round-trip the same.
const SV = /^SVE?-\w{3,}$/i;
const TS = /^TS-\w{3,}$/i;

export type SalesforceKind = 'visit' | 'training';

export function isValidSalesforceId(id: string, kind: SalesforceKind): boolean {
  const v = (id ?? '').trim();
  return kind === 'visit' ? SV.test(v) : TS.test(v);
}

export function salesforcePrefixFor(kind: SalesforceKind): string {
  return kind === 'visit' ? 'SV-' : 'TS-';
}
