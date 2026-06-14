import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import { ScopeService } from '../../common/scope/scope.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthorizationService } from '../../common/authz/authorization.service';
import { AuthUser } from '../../common/auth/auth-user';

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
  ) {}

  async recordUpload(user: AuthUser, activityId: string, kind: string, file: StoredFile) {
    if (!file) throw new BadRequestException('A file is required.');
    if (!VALID_KINDS.has(kind)) throw new BadRequestException(`Invalid evidence kind: ${kind}`);
    const activity = await this.prisma.activity.findFirst({
      where: { id: activityId, deletedAt: null },
      select: { id: true, deliveryType: true, status: true },
    });
    if (!activity) throw new NotFoundException('Activity not found');
    // Object-level: the uploader must own/deliver this activity (a partner is
    // pinned to their own assigned work; staff to their portfolio).
    await this.authz.assertCanAccess(user, { kind: 'evidence', loadedEntity: { id: '', activityId, uploadedBy: user.userId } }, 'upload');

    // The on-disk filename is the stored reference (relative to EVIDENCE_DIR).
    const rec = await this.prisma.evidenceRecord.create({
      data: {
        activityId, kind: kind as never, uri: file.filename,
        originalName: file.originalname, mimeType: file.mimetype,
        uploadedBy: user.userId, status: 'uploaded',
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
      payload: { kind, originalName: file.originalname, size: file.size, mimeType: file.mimetype },
    });
    return { id: rec.id, kind, originalName: file.originalname, size: file.size, status: rec.status };
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

  /** Resolve an evidence record to its absolute on-disk path (for streaming). */
  async fileFor(id: string): Promise<{ absPath: string; mimeType: string; originalName: string }> {
    const record = await this.prisma.evidenceRecord.findUnique({
      where: { id }, select: { uri: true, mimeType: true, originalName: true },
    });
    if (!record) throw new NotFoundException('Evidence not found');
    // Guard against path traversal — the uri is just a filename.
    const safe = record.uri.replace(/[/\\]/g, '');
    const absPath = join(EVIDENCE_DIR, safe);
    if (!existsSync(absPath)) throw new NotFoundException('Evidence file missing on disk');
    return {
      absPath,
      mimeType: record.mimeType ?? 'application/octet-stream',
      originalName: record.originalName ?? safe,
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
    return { id: updated.id, status: updated.status };
  }
}
