import {
  Body, Controller, Get, Param, Post, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { createReadStream, mkdirSync } from 'node:fs';
import type { Response } from 'express';
import { EvidenceService, EVIDENCE_DIR, type StoredFile } from './evidence.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermissions } from '../../common/rbac/require-permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthUser } from '../../common/auth/auth-user';

// Ensure the storage dir exists at boot (Railway volume mount point).
mkdirSync(EVIDENCE_DIR, { recursive: true });

@ApiTags('evidence')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('evidence')
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  // Upload an evidence file (multipart) for an activity. Gated on ACTIVITY_COMPLETE
  // (the staff/partner who did the work). multer writes to EVIDENCE_DIR with a
  // random filename; a 10 MB cap and image/pdf-ish types only.
  @Post('upload')
  @RequirePermissions(PERMISSIONS.ACTIVITY_COMPLETE)
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', {
    dest: EVIDENCE_DIR,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      // Images + PDF preview inline; Word/Excel/CSV are accepted for
      // download-based review. octet-stream covers browsers that send a
      // generic type for .docx/.xlsx.
      const ok = new Set([
        'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv', 'application/octet-stream',
      ]).has(file.mimetype);
      cb(ok ? null : new Error('Unsupported file type — use PDF, image, Word, Excel or CSV'), ok);
    },
  }))
  upload(
    @UploadedFile() file: StoredFile,
    @Body() body: { activityId?: string; kind?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.evidence.recordUpload(user, body.activityId ?? '', body.kind ?? '', file);
  }

  @Get('activity/:activityId')
  @RequirePermissions(PERMISSIONS.PLANNING_VIEW)
  list(@Param('activityId') activityId: string, @CurrentUser() user: AuthUser) {
    return this.evidence.listForActivity(user, activityId);
  }

  // Stream the stored file back (for IA / staff review previews + download).
  // Sets the real Content-Type + filename so PDFs/images preview inline and
  // Word/Excel download with the right name.
  @Get(':id/file')
  @RequirePermissions(PERMISSIONS.PLANNING_VIEW)
  async file(@Param('id') id: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const { absPath, mimeType, originalName } = await this.evidence.fileFor(id);
    const inlineable = /^(image\/|application\/pdf)/.test(mimeType);
    res.set({
      'Content-Type': mimeType,
      'Content-Disposition': `${inlineable ? 'inline' : 'attachment'}; filename="${originalName.replace(/"/g, '')}"`,
    });
    return new StreamableFile(createReadStream(absPath));
  }

  // Staff / PL / IA review: accept or return an uploaded evidence file. Drives
  // Activity.evidenceStatus so the IA / accountant payment gate is real.
  @Post(':id/review')
  @RequirePermissions(PERMISSIONS.EVIDENCE_REVIEW)
  review(
    @Param('id') id: string,
    @Body() body: { action?: 'accept' | 'return'; note?: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.evidence.review(user, id, body?.action === 'return' ? 'return' : 'accept', body?.note);
  }
}
