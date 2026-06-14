import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { closeSync, existsSync, openSync, readSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import { ScopeService } from '../../common/scope/scope.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthorizationService } from '../../common/authz/authorization.service';
import { DomainEventService } from '../../common/realtime/domain-events.service';
import { AuthUser } from '../../common/auth/auth-user';
import { assertSafeUpload, sanitizeOriginalName } from './file-validation';
import { EVIDENCE_SCANNER, type EvidenceScanner } from './evidence-scanner';

// Where uploaded evidence files live. On Railway, mount a persistent volume at
// this path (EVIDENCE_STORAGE_DIR) so files survive redeploys.
export const EVIDENCE_DIR = resolve(process.env.EVIDENCE_STORAGE_DIR ?? 'uploads/evidence');

// Minimal shape of a multer-stored file (avoids depending on @types/multer).
export interface StoredFile {
  originalname: string;
  mimetype: string;
  size: number;
  filename: string; // the random name multer wrote to EVIDENCE_DIR
  path: string;
}

const VALID_KINDS = new Set([
  'visit_form', 'school_stamp', 'attendance_form', 'meeting_minutes', 'resolutions',
  'evaluation_form', 'assessment_form', 'photo', 'pdf', 'project_report', 'coaching_notes',
]);

@Injectable()
export class EvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly authz: AuthorizationService,
    private readonly events: DomainEventService,
    @Inject(EVIDENCE_SCANNER) private readonly scanner: EvidenceScanner,
  ) {}

  /** Remove a rejected/temp upload from disk (best-effort). */
  private discard(absPath?: string): void {
    if (absPath) rmSync(absPath, { force: true });
  }

  /** Read the first ~4KB of a stored file for magic-byte + scan inspection. */
  private readHead(absPath: string, bytes = 4100): Buffer {
    const fd = openSync(absPath, 'r');
    try {
      const buf = Buffer.alloc(bytes);
      const read = readSync(fd, buf, 0, bytes, 0);
      return buf.subarray(0, read);
    } finally {
      closeSync(fd);
    }
  }

  async recordUpload(user: AuthUser, activityId: string, kind: string, file: StoredFile) {
    if (!file) throw new BadRequestException('A file is required.');
    if (!VALID_KINDS.has(kind)) throw new BadRequestException(`Invalid evidence kind: ${kind}`);
    const activity = await this.prisma.activity.findFirst({
      where: { id: activityId, deletedAt: null },
      select: { id: true, deliveryType: true, status: true },
    });
    if (!activity) {
      this.discard(file.path);
      throw new NotFoundException('Activity not found');
    }
    // Object-level: the uploader must own/deliver this activity (a partner is
    // pinned to their own assigned work; staff to their portfolio).
    await this.authz.assertCanAccess(user, { kind: 'evidence', loadedEntity: { id: '', activityId, uploadedBy: user.userId } }, 'upload');

    // Content validation: extension + MIME + magic-byte sniff. The declared
    // type is NOT trusted — bytes must match, and active/executable content is
    // rejected. On any failure the temp file is removed.
    const head = this.readHead(file.path);
    try {
      assertSafeUpload(file, head);
    } catch (err) {
      this.discard(file.path);
      throw err;
    }

    // Malware scan (no-op default → 'skipped'). An infected file is quarantined
    // and deleted; it never reaches storage as servable.
    const scanStatus = await this.scanner.scan(file.path, head);
    if (scanStatus === 'infected') {
      this.discard(file.path);
      await this.audit.log({
        action: 'evidence.quarantine', subjectKind: 'Activity', subjectId: activityId,
        actorId: user.userId, actorRole: user.activeRole,
        payload: { originalName: sanitizeOriginalName(file.originalname), reason: 'malware-scan' },
      });
      throw new BadRequestException('The file was rejected by the malware scan.');
    }

    // The on-disk filename is the stored reference (relative to EVIDENCE_DIR).
    const rec = await this.prisma.evidenceRecord.create({
      data: {
        activityId, kind: kind as never, uri: file.filename,
        originalName: sanitizeOriginalName(file.originalname), mimeType: file.mimetype,
        uploadedBy: user.userId, status: 'uploaded', scanStatus,
      },
    });
    // Partner-delivered work moves to "evidence uploaded" awaiting staff review;
    // staff-delivered just flags evidence present.
    await this.prisma.activity.update({
      where: { id: activityId },
      data: {
        evidenceStatus: 'uploaded',
        ...(activity.deliveryType === 'partner' && activity.status === 'assigned_to_partner'
          ? { status: 'evidence_uploaded' as never }
          : activity.deliveryType === 'partner' && activity.status === 'partner_scheduled'
            ? { status: 'evidence_uploaded' as never }
            : {}),
      },
    });
    await this.audit.log({
      action: 'evidence.upload', subjectKind: 'Activity', subjectId: activityId,
      actorId: user.userId, actorRole: user.activeRole,
      payload: { kind, originalName: rec.originalName, size: file.size, mimeType: file.mimetype, scanStatus },
    });
    return { id: rec.id, kind, originalName: rec.originalName, size: file.size, status: rec.status };
  }

  async listForActivity(_user: AuthUser, activityId: string) {
    const rows = await this.prisma.evidenceRecord.findMany({
      where: { activityId }, orderBy: { createdAt: 'desc' }, take: 100,
    });
    return rows.map((r) => ({
      id: r.id, kind: r.kind, status: r.status, originalName: r.originalName, mimeType: r.mimeType,
      uploadedBy: r.uploadedBy, uploadedAt: r.createdAt, reviewNote: r.reviewNote,
    }));
  }

  /** Resolve an evidence record to its absolute on-disk path (for streaming).
   *  Authorizes the CALLER against the parent activity (closes the download
   *  IDOR — the endpoint used to gate only on PLANNING_VIEW with no row check),
   *  blocks quarantined files, and audits the access as a sensitive download. */
  async fileFor(user: AuthUser, id: string): Promise<{ absPath: string; mimeType: string; originalName: string }> {
    const record = await this.prisma.evidenceRecord.findUnique({
      where: { id },
      select: { id: true, activityId: true, uploadedBy: true, uri: true, mimeType: true, originalName: true, quarantined: true },
    });
    if (!record) throw new NotFoundException('Evidence not found');
    if (record.quarantined) throw new NotFoundException('Evidence file is unavailable');
    // Object-level: the parent activity must be in the caller's scope.
    await this.authz.assertCanAccess(user, { kind: 'evidence', id, loadedEntity: record }, 'download');
    // Guard against path traversal — the uri is just a filename.
    const safe = record.uri.replace(/[/\\]/g, '');
    const absPath = join(EVIDENCE_DIR, safe);
    if (!existsSync(absPath)) throw new NotFoundException('Evidence file missing on disk');
    return {
      absPath,
      mimeType: record.mimeType ?? 'application/octet-stream',
      originalName: sanitizeOriginalName(record.originalName ?? safe),
    };
  }

  /** Staff/PL/IA review of an uploaded evidence file: accept or return with a
   *  reason. Propagates to Activity.evidenceStatus so the IA / accountant
   *  payment gate is backed by an actually-reviewed file. */
  async review(user: AuthUser, id: string, action: 'accept' | 'return', note?: string) {
    const rec = await this.prisma.evidenceRecord.findUnique({ where: { id }, select: { id: true, activityId: true, uploadedBy: true } });
    if (!rec) throw new NotFoundException('Evidence not found');
    if (action === 'return' && !note?.trim()) throw new BadRequestException('A reason is required when returning evidence.');
    // Object-level: reviewer needs EVIDENCE_REVIEW + the activity in scope, and
    // can NEVER review evidence they uploaded themselves (no self-approval).
    await this.authz.assertCanAccess(user, { kind: 'evidence', id, loadedEntity: rec }, 'verify');
    const status = action === 'accept' ? 'accepted' : 'returned';
    const updated = await this.prisma.evidenceRecord.update({
      where: { id },
      data: { status: status as never, reviewedBy: user.userId, reviewedAt: new Date(), reviewNote: note ?? null },
    });
    await this.prisma.activity.update({
      where: { id: rec.activityId },
      data: { evidenceStatus: status as never },
    });
    await this.audit.log({
      action: `evidence.${action}`, subjectKind: 'Activity', subjectId: rec.activityId,
      actorId: user.userId, actorRole: user.activeRole, payload: { evidenceId: id, note },
    });
    // Close the handoff: tell the uploader their evidence was accepted/returned.
    // A return is actionable (re-upload); an accept is informational. Without
    // this, the partner/staff who submitted had no signal and had to poll.
    if (rec.uploadedBy) {
      await this.events.emit({
        type: action === 'accept' ? 'EvidenceAccepted' : 'EvidenceReturned',
        actorId: user.userId, actorRole: user.activeRole, subjectKind: 'Activity', subjectId: rec.activityId,
        payload: { evidenceId: id },
        notify: [{
          recipientId: rec.uploadedBy,
          title: action === 'accept' ? 'Evidence accepted' : 'Evidence returned — re-upload needed',
          body: action === 'accept'
            ? 'Your submitted evidence was accepted.'
            : note ? `Returned: ${note}` : 'Please review and re-upload your evidence.',
          targetRoute: '/my-plan',
          actionRequired: action === 'return',
          priority: action === 'return' ? 'high' : 'normal',
        }],
        liveUserIds: [user.userId, rec.uploadedBy],
      });
    }
    return { id: updated.id, status: updated.status };
  }
}
