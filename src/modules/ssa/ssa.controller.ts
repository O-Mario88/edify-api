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

  @Post()
  @RequirePermissions(PERMISSIONS.SSA_UPLOAD)
  upload(@Body() dto: UploadSsaDto, @CurrentUser() user: AuthUser) {
    return this.ssa.upload(dto, user);
  }
}
