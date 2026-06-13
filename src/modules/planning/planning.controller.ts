import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PlanningService } from './planning.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermissions } from '../../common/rbac/require-permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthUser } from '../../common/auth/auth-user';
import { CreatePlanDto, DraftActivityDto, ReturnPlanDto } from './dto/plans.dto';

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

  // ─── Monthly plan lifecycle ───────────────────────────────────────

  @Get('plans')
  @RequirePermissions(PERMISSIONS.PLANNING_VIEW)
  listPlans(@CurrentUser() user: AuthUser) {
    return this.planning.listPlans(user);
  }

  @Get('plans/:id')
  @RequirePermissions(PERMISSIONS.PLANNING_VIEW)
  getPlan(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.planning.getPlan(user, id);
  }

  @Post('plans')
  @RequirePermissions(PERMISSIONS.PLANNING_CREATE)
  createPlan(@Body() dto: CreatePlanDto, @CurrentUser() user: AuthUser) {
    return this.planning.createPlan(user, dto);
  }

  @Post('plans/:id/activities')
  @RequirePermissions(PERMISSIONS.PLANNING_CREATE)
  addActivity(@Param('id') id: string, @Body() dto: DraftActivityDto, @CurrentUser() user: AuthUser) {
    return this.planning.addActivity(user, id, dto);
  }

  @Post('plans/:id/submit')
  @RequirePermissions(PERMISSIONS.PLANNING_CREATE)
  submitPlan(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.planning.submitPlan(user, id);
  }

  @Post('plans/:id/approve')
  @RequirePermissions(PERMISSIONS.BUDGET_APPROVE)
  approvePlan(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.planning.approvePlan(user, id);
  }

  @Post('plans/:id/return')
  @RequirePermissions(PERMISSIONS.BUDGET_APPROVE)
  returnPlan(@Param('id') id: string, @Body() dto: ReturnPlanDto, @CurrentUser() user: AuthUser) {
    return this.planning.returnPlan(user, id, dto.reason);
  }
}
