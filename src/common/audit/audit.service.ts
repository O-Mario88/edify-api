import { Injectable, Logger } from '@nestjs/common';
import { EdifyRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { requestContext } from '../context/request-context';
import { canonicalAudit, chainHash } from './audit-hash';

export interface AuditInput {
  action: string;
  subjectKind?: string;
  subjectId?: string;
  actorId?: string;
  actorRole?: EdifyRole;
  payload?: Prisma.InputJsonValue;
  // Optional explicit provenance / outcome. ip/ua/correlationId default from the
  // request context; success defaults to true.
  success?: boolean;
  reason?: string;
  ipAddress?: string;
  userAgent?: string;
  correlationId?: string;
}

// A single Postgres advisory lock key serializes audit inserts so the hash
// chain is strictly linear even under concurrency. Arbitrary constant.
const AUDIT_LOCK_KEY = 947_113;

@Injectable()
export class AuditService {
  private readonly logger = new Logger('AuditService');

  constructor(private readonly prisma: PrismaService) {}

  async log(input: AuditInput): Promise<void> {
    const ctx = requestContext.get();
    const fields = {
      action: input.action,
      subjectKind: input.subjectKind ?? null,
      subjectId: input.subjectId ?? null,
      actorId: input.actorId ?? null,
      actorRole: (input.actorRole ?? null) as EdifyRole | null,
      success: input.success ?? true,
      reason: input.reason ?? null,
      ipAddress: input.ipAddress ?? ctx?.ipAddress ?? null,
      userAgent: input.userAgent ?? ctx?.userAgent ?? null,
      correlationId: input.correlationId ?? ctx?.correlationId ?? null,
      payload: input.payload ?? Prisma.JsonNull,
    };

    try {
      await this.prisma.$transaction(async (tx) => {
        // Serialize chain appends so prevHash always points at the true tail.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`;
        const last = await tx.auditLog.findFirst({ orderBy: { seq: 'desc' }, select: { hash: true } });
        const prevHash = last?.hash ?? '';
        const hash = chainHash(prevHash, canonicalAudit({ ...fields, payload: input.payload ?? null }));
        await tx.auditLog.create({ data: { ...fields, prevHash, hash } });
      });
    } catch (err) {
      // Audit must never break the primary action. Log and continue.
      this.logger.error(`Failed to write audit (${input.action}): ${(err as Error).message}`);
    }
  }

  /**
   * Verify the hash chain end-to-end: each row's prevHash must equal the prior
   * row's hash, and each hash must recompute from its canonical content. Returns
   * the first break (if any). Powers the security dashboard's integrity check.
   */
  async verifyChain(limit = 100_000): Promise<{ ok: boolean; checked: number; brokenAtSeq?: string; reason?: string }> {
    const rows = await this.prisma.auditLog.findMany({
      orderBy: { seq: 'asc' },
      take: limit,
      select: {
        seq: true, action: true, subjectKind: true, subjectId: true, actorId: true,
        actorRole: true, success: true, reason: true, ipAddress: true, userAgent: true,
        correlationId: true, payload: true, prevHash: true, hash: true,
      },
    });
    let prev = '';
    let checked = 0;
    for (const r of rows) {
      // Pre-chain legacy rows (no hash) are skipped until the first chained row.
      if (r.hash === null) {
        prev = '';
        continue;
      }
      if ((r.prevHash ?? '') !== prev) {
        return { ok: false, checked, brokenAtSeq: r.seq.toString(), reason: 'prevHash-mismatch' };
      }
      const expected = chainHash(prev, canonicalAudit({ ...r, payload: r.payload ?? null }));
      if (expected !== r.hash) {
        return { ok: false, checked, brokenAtSeq: r.seq.toString(), reason: 'hash-mismatch' };
      }
      prev = r.hash;
      checked += 1;
    }
    return { ok: true, checked };
  }
}
