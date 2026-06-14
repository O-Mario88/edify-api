/* eslint-disable no-console */
// Daily audit export (spec §17 "daily audit export/backup"). Writes the day's
// audit rows as newline-delimited JSON to AUDIT_EXPORT_DIR, then verifies the
// chain. Intended to run from cron; pipe the output file to encrypted offsite
// storage (see scripts/backup.sh / backup-recovery-plan.md). Run:
//   npm run audit:export -- 2026-06-14   (defaults to "today" via arg; no Date.now)
import { PrismaClient } from '@prisma/client';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

async function main() {
  const day = process.argv[2]; // YYYY-MM-DD — caller supplies (cron passes date)
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    console.error('Usage: audit:export -- <YYYY-MM-DD>');
    process.exit(2);
  }
  const start = new Date(`${day}T00:00:00.000Z`);
  const end = new Date(`${day}T23:59:59.999Z`);
  const dir = resolve(process.env.AUDIT_EXPORT_DIR ?? 'exports/audit');
  mkdirSync(dir, { recursive: true });

  const prisma = new PrismaClient();
  try {
    const rows = await prisma.auditLog.findMany({
      where: { createdAt: { gte: start, lte: end } },
      orderBy: { seq: 'asc' },
    });
    const out = join(dir, `audit-${day}.ndjson`);
    const body = rows.map((r) => JSON.stringify({ ...r, seq: r.seq.toString() })).join('\n');
    writeFileSync(out, body, { mode: 0o600 });
    console.log(`Exported ${rows.length} audit rows for ${day} -> ${out}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
