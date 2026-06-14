/* eslint-disable no-console */
// Verify the AuditLog hash chain end-to-end. Run: `npm run audit:verify`.
// Walks rows in seq order, checks each prevHash links to the prior hash, and
// recomputes each hash from its canonical content. Exits non-zero on any break
// (suitable for a cron integrity check feeding the security dashboard).
import { PrismaClient } from '@prisma/client';
import { canonicalAudit, chainHash } from '../src/common/audit/audit-hash';

async function main() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.auditLog.findMany({
      orderBy: { seq: 'asc' },
      select: {
        seq: true, action: true, subjectKind: true, subjectId: true, actorId: true,
        actorRole: true, success: true, reason: true, ipAddress: true, userAgent: true,
        correlationId: true, payload: true, prevHash: true, hash: true,
      },
    });

    let prev = '';
    let checked = 0;
    for (const r of rows) {
      if (r.hash === null) { prev = ''; continue; } // pre-chain legacy rows
      if ((r.prevHash ?? '') !== prev) {
        console.error(`CHAIN BROKEN at seq=${r.seq} (prevHash mismatch). ${checked} rows verified.`);
        process.exit(1);
      }
      const expected = chainHash(prev, canonicalAudit({ ...r, payload: r.payload ?? null }));
      if (expected !== r.hash) {
        console.error(`CHAIN BROKEN at seq=${r.seq} (hash mismatch — row was altered). ${checked} rows verified.`);
        process.exit(1);
      }
      prev = r.hash;
      checked += 1;
    }
    console.log(`Audit chain OK — ${checked} chained rows verified (of ${rows.length} total).`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
