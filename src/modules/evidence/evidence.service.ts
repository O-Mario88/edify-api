import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import { ScopeService } from '../../common/scope/scope.service';
import { AuditService } from '../../common/audit/audit.service';
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
  ) {}

  async recordUpload(user: AuthUser, activityId: string, kind: string, file: StoredFile) {
    if (!file) throw new BadRequestException('A file is required.');
    if (!VALID_KINDS.has(kind)) throw new BadRequestException(`Invalid evidence kind: ${kind}`);
    const activity = await this.prisma.activity.findFirst({
      where: { id: activityId, deletedAt: null },
      select: { id: true, deliveryType: true, status: true },
    });
    if (!activity) throw new NotFoundException('Activity not found');

    // The on-disk filename is the stored reference (relative to EVIDENCE_DIR).
    const rec = await this.prisma.evidenceRecord.create({
      data: {
        activityId, kind: kind as never, uri: file.filename,
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
    return rows.map((r) => ({ id: r.id, kind: r.kind, status: r.status, uploadedBy: r.uploadedBy, uploadedAt: r.createdAt }));
  }

  /** Resolve an evidence record to its absolute on-disk path (for streaming). */
  async fileFor(id: string): Promise<{ absPath: string; record: { uri: string } }> {
    const record = await this.prisma.evidenceRecord.findUnique({ where: { id }, select: { uri: true } });
    if (!record) throw new NotFoundException('Evidence not found');
    // Guard against path traversal — the uri is just a filename.
    const safe = record.uri.replace(/[/\\]/g, '');
    const absPath = join(EVIDENCE_DIR, safe);
    if (!existsSync(absPath)) throw new NotFoundException('Evidence file missing on disk');
    return { absPath, record };
  }
}
