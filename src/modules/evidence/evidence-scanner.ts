import { Injectable } from '@nestjs/common';

// ── Malware-scan seam (spec §11) ───────────────────────────────────────────
// Evidence uploads should be virus-scanned where possible. We define the seam
// now and ship a no-op default (returns 'skipped'). Bind a real scanner (e.g. a
// ClamAV `clamd` client) to EVIDENCE_SCANNER in production; the upload pipeline
// quarantines anything that comes back 'infected' and never serves it.

export type ScanResult = 'clean' | 'infected' | 'skipped';

export interface EvidenceScanner {
  scan(absPath: string, head: Buffer): Promise<ScanResult>;
}

export const EVIDENCE_SCANNER = Symbol('EVIDENCE_SCANNER');

/** Default: no scanner configured → 'skipped'. A skipped file is allowed but is
 *  recorded as unscanned (surfaced on the security dashboard, Phase 7). */
@Injectable()
export class NoopEvidenceScanner implements EvidenceScanner {
  async scan(): Promise<ScanResult> {
    return 'skipped';
  }
}
