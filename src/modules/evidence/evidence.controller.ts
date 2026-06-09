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
      const ok = /^(image\/(jpeg|png|webp|heic)|application\/pdf)$/.test(file.mimetype);
      cb(ok ? null : new Error('Only images or PDFs are allowed'), ok);
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

  // Stream the stored file back (for IA / staff review previews).
  @Get(':id/file')
  @RequirePermissions(PERMISSIONS.PLANNING_VIEW)
  async file(@Param('id') id: string, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const { absPath } = await this.evidence.fileFor(id);
    res.set({ 'Content-Disposition': 'inline' });
    return new StreamableFile(createReadStream(absPath));
  }
}
