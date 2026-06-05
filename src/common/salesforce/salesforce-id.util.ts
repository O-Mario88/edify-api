// Salesforce-ready ID validation. Salesforce is NOT integrated — users enter
// these IDs manually and IA confirms. Visits use SV-, trainings/cluster
// meetings/SIT use TS-. When integration lands, this stays the entry contract.

const SV = /^SV-\w{3,}$/i;
const TS = /^TS-\w{3,}$/i;

export type SalesforceKind = 'visit' | 'training';

export function isValidSalesforceId(id: string, kind: SalesforceKind): boolean {
  const v = (id ?? '').trim();
  return kind === 'visit' ? SV.test(v) : TS.test(v);
}

export function salesforcePrefixFor(kind: SalesforceKind): string {
  return kind === 'visit' ? 'SV-' : 'TS-';
}
