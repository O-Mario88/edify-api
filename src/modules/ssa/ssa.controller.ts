import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SsaService } from './ssa.service';
import { UploadSsaDto } from './dto/upload-ssa.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermissions } from '../../common/rbac/require-permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthUser } from '../../common/auth/auth-user';

@ApiTags('ssa')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('ssa')
export class SsaController {
  constructor(private readonly ssa: SsaService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.SSA_VIEW)
  list(@Query() query: PaginationDto, @CurrentUser() user: AuthUser) {
    return this.ssa.list(query, user);
  }

  @Get('school/:schoolId')
  @RequirePermissions(PERMISSIONS.SSA_VIEW)
  forSchool(@Param('schoolId') schoolId: string, @CurrentUser() user: AuthUser) {
    return this.ssa.forSchool(schoolId, user);
  }

  /** SSA-driven recommendation (two weakest interventions + severity) — the
   *  backend source that replaces the empty in-memory mock rec-engine. */
  @Get('school/:schoolId/recommendation')
  @RequirePermissions(PERMISSIONS.SSA_VIEW)
  recommendationForSchool(@Param('schoolId') schoolId: string, @CurrentUser() user: AuthUser) {
    return this.ssa.recommendationForSchool(schoolId, user);
  }

  // 10% client-portfolio verification QA (spec §10–§12).
  @Get('verification-requirements')
  @RequirePermissions(PERMISSIONS.SSA_VIEW)
  verificationRequirements(@Query('staffId') staffId: string | undefined, @Query('fy') fy: string | undefined, @CurrentUser() user: AuthUser) {
    return this.ssa.verificationRequirements(user, { staffId, fy });
  }

  @Get('verification-summary')
  @RequirePermissions(PERMISSIONS.SSA_VIEW)
  verificationSummary(@Query('fy') fy: string | undefined, @CurrentUser() user: AuthUser) {
    return this.ssa.verificationSummary(user, { fy });
  }

  @Post()
  @RequirePermissions(PERMISSIONS.SSA_UPLOAD)
  upload(@Body() dto: UploadSsaDto, @CurrentUser() user: AuthUser) {
    return this.ssa.upload(dto, user);
  }
}
