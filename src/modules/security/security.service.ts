import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';

export interface SecurityAlert {
  severity: 'critical' | 'warning' | 'info';
  key: string;
  message: string;
}

// Admin-only security posture summary. Every number is derived from real
// signals (the audit log, integrity invariants, env, filesystem) — no mocks.
@Injectable()
export class SecurityHealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  private since24h(): Date {
    return new Date(Date.now() - 24 * 60 * 60 * 1000);
  }

  async summary() {
    const since = this.since24h();
    const countAudit = (where: Record<string, unknown>) => this.prisma.auditLog.count({ where });

    const [
      loginOk, loginFail, denies, shadowDenies, sensitiveAllows, downloads24h,
      quarantined, scanGroups,
      paidWithoutIa, paidWithoutEvidence, paidWithoutSf, accountabilityNoNetsuite,
      activeUsers, lockedAccounts, mfaEnabled,
    ] = await Promise.all([
      countAudit({ action: 'auth.login', success: true, createdAt: { gte: since } }),
      countAudit({ action: { in: ['auth.login.failed', 'auth.login.lockout', 'auth.login.locked'] }, createdAt: { gte: since } }),
      countAudit({ action: 'authz.deny', createdAt: { gte: since } }),
      countAudit({ action: 'authz.deny.shadow', createdAt: { gte: since } }),
      countAudit({ action: 'authz.allow.sensitive', createdAt: { gte: since } }),
      countAudit({ action: 'authz.allow.sensitive', payload: { path: ['action'], equals: 'download' }, createdAt: { gte: since } }),
      this.prisma.evidenceRecord.count({ where: { quarantined: true } }),
      this.prisma.evidenceRecord.groupBy({ by: ['scanStatus'], _count: { _all: true } }),
      this.prisma.activity.count({ where: { deletedAt: null, paymentStatus: { in: ['accountant_cleared', 'paid'] }, iaVerificationStatus: { not: 'confirmed' } } }),
      this.prisma.activity.count({ where: { deletedAt: null, deliveryType: 'partner', paymentStatus: { in: ['accountant_cleared', 'paid'] }, evidenceStatus: { not: 'accepted' } } }),
      this.prisma.activity.count({ where: { deletedAt: null, deliveryType: 'partner', paymentStatus: { in: ['accountant_cleared', 'paid'] }, salesforceActivityId: null } }),
      this.prisma.fundRequest.count({ where: { accountabilityStatus: 'approved', accountabilityNetsuiteId: null } }),
      this.prisma.user.count({ where: { isActive: true, deletedAt: null } }),
      this.prisma.user.count({ where: { deletedAt: null, lockedUntil: { gt: new Date() } } }),
      this.prisma.user.count({ where: { isActive: true, deletedAt: null, mfaEnabled: true } }),
    ]);

    const chain = await this.audit.verifyChain();

    const scanBreakdown = Object.fromEntries(scanGroups.map((g) => [g.scanStatus, g._count._all]));

    const nodeEnv = this.config.get<string>('NODE_ENV');
    const productionSafety = {
      nodeEnv,
      mockDataEnabled: this.config.get<boolean>('ENABLE_MOCK_DATA') ?? false,
      devEndpointsEnabled: this.config.get<boolean>('ENABLE_DEV_ENDPOINTS') ?? false,
      authzMode: process.env.AUTHZ_MODE === 'enforce' ? 'enforce' : 'shadow',
      partnerRoleBridge: (process.env.PARTNER_ROLE_BRIDGE ?? 'true').toLowerCase() !== 'false',
      productionSafe:
        nodeEnv !== 'production' ||
        (!this.config.get<boolean>('ENABLE_MOCK_DATA') &&
          !this.config.get<boolean>('ENABLE_DEV_ENDPOINTS') &&
          process.env.AUTHZ_MODE === 'enforce'),
    };

    const backups = this.latestBackup();

    const paymentIntegrity = { paidWithoutIa, paidWithoutEvidence, paidWithoutSf, accountabilityNoNetsuite };

    const alerts = this.deriveAlerts({ chain, paymentIntegrity, quarantined, productionSafety, shadowDenies });

    return {
      generatedAt: new Date().toISOString(),
      // Auth signals are populated as the auth-hardening phase emits failure +
      // lockout + MFA events; today login success/failure are real, the rest null.
      authentication: {
        logins24h: loginOk,
        failedLogins24h: loginFail,
        activeUsers,
        lockedAccounts,
        mfaAdoption: activeUsers > 0 ? Math.round((mfaEnabled / activeUsers) * 100) : 0,
      },
      authorization: { denies24h: denies, shadowDenies24h: shadowDenies, sensitiveAllows24h: sensitiveAllows, evidenceDownloads24h: downloads24h },
      auditIntegrity: { ok: chain.ok, chainedRows: chain.checked, brokenAtSeq: chain.brokenAtSeq ?? null, reason: chain.reason ?? null },
      evidence: { quarantined, scanBreakdown },
      paymentIntegrity,
      productionSafety,
      backups,
      dependencies: { note: 'Run `npm audit --production` in CI; result surfaced here once the pipeline reports it.' },
      alerts,
    };
  }

  private latestBackup() {
    const dir = resolve(process.env.BACKUP_DIR ?? 'backups');
    if (!existsSync(dir)) return { configured: false as const, lastBackupAt: null, ageHours: null };
    const files = readdirSync(dir).filter((f) => f.startsWith('edify-db-'));
    if (!files.length) return { configured: true as const, lastBackupAt: null, ageHours: null };
    const newest = files
      .map((f) => statSync(join(dir, f)).mtime)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    return {
      configured: true as const,
      lastBackupAt: newest.toISOString(),
      ageHours: Math.round((Date.now() - newest.getTime()) / 36e5),
    };
  }

  private deriveAlerts(s: {
    chain: { ok: boolean; brokenAtSeq?: string };
    paymentIntegrity: { paidWithoutIa: number; paidWithoutEvidence: number; paidWithoutSf: number; accountabilityNoNetsuite: number };
    quarantined: number;
    productionSafety: { productionSafe: boolean; nodeEnv?: string };
    shadowDenies: number;
  }): SecurityAlert[] {
    const alerts: SecurityAlert[] = [];
    if (!s.chain.ok) alerts.push({ severity: 'critical', key: 'audit-chain-broken', message: `Audit hash chain broken at seq ${s.chain.brokenAtSeq} — possible tampering.` });
    const pi = s.paymentIntegrity;
    const payViolations = pi.paidWithoutIa + pi.paidWithoutEvidence + pi.paidWithoutSf + pi.accountabilityNoNetsuite;
    if (payViolations > 0) alerts.push({ severity: 'critical', key: 'payment-integrity', message: `${payViolations} payment/accountability integrity violation(s) — money moved without full verification.` });
    if (s.quarantined > 0) alerts.push({ severity: 'warning', key: 'quarantined-evidence', message: `${s.quarantined} evidence file(s) quarantined by the malware scan.` });
    if (!s.productionSafety.productionSafe) alerts.push({ severity: 'warning', key: 'not-production-safe', message: 'Production-safety rails are not all satisfied (mock/dev-endpoints/AUTHZ_MODE).' });
    if (s.shadowDenies > 0) alerts.push({ severity: 'info', key: 'authz-shadow-denies', message: `${s.shadowDenies} authorization denial(s) in the last 24h were only SHADOW-logged — flip AUTHZ_MODE=enforce to block them.` });
    return alerts;
  }
}
