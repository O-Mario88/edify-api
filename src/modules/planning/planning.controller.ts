import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlanningService } from './planning.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermissions } from '../../common/rbac/require-permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthUser } from '../../common/auth/auth-user';

@ApiTags('planning')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('planning')
export class PlanningController {
  constructor(private readonly planning: PlanningService) {}

  @Get('setup')
  @RequirePermissions(PERMISSIONS.PLANNING_VIEW)
  setup(
    @CurrentUser() user: AuthUser,
    @Query('regionId') regionId?: string,
    @Query('districtId') districtId?: string,
    @Query('subCountyId') subCountyId?: string,
    @Query('fy') fy?: string,
  ) {
    return this.planning.setup(user, { regionId, districtId, subCountyId, fy });
  }

  @Get('core')
  @RequirePermissions(PERMISSIONS.PLANNING_VIEW)
  core(
    @CurrentUser() user: AuthUser,
    @Query('districtId') districtId?: string,
    @Query('subCountyId') subCountyId?: string,
  ) {
    return this.planning.corePlanning(user, { districtId, subCountyId });
  }

  @Post('recompute/:schoolId')
  @RequirePermissions(PERMISSIONS.PLANNING_RECALC)
  recompute(@Param('schoolId') schoolId: string) {
    return this.planning.recompute(schoolId);
  }
}
