import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BudgetService } from './budget.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermissions } from '../../common/rbac/require-permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthUser } from '../../common/auth/auth-user';

// The budget IS the schedule, costed. Reads gate on PLANNING_VIEW (every
// planning role, incl. CCEO). Setting official rates gates on the CD-only
// COST_SETTINGS_MANAGE.
@ApiTags('budget')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('budget')
export class BudgetController {
  constructor(private readonly budget: BudgetService) {}

  /** The CD rate card — visible to anyone who plans. */
  @Get('cost-settings')
  @RequirePermissions(PERMISSIONS.PLANNING_VIEW)
  costSettings() {
    return this.budget.listCostSettings();
  }

  /** CD sets/updates an official rate. */
  @Post('cost-settings')
  @RequirePermissions(PERMISSIONS.COST_SETTINGS_MANAGE)
  setCostSetting(
    @CurrentUser() user: AuthUser,
    @Body() body: { key?: string; label?: string; unitCost?: number; fy?: string },
  ) {
    return this.budget.upsertCostSetting(user, body);
  }

  /** Cost preview from the CD Country Cost Register — for the scheduling drawer.
   *  Every planning role may preview; the rates themselves are CD-owned. */
  @Post('costing/preview')
  @RequirePermissions(PERMISSIONS.PLANNING_VIEW)
  costPreview(
    @Body() body: { activityType?: string; deliveryType?: string; districtType?: string; teachersAttended?: number; leadersAttended?: number; otherParticipants?: number },
  ) {
    return this.budget.costPreview(body);
  }

  /** Annual budget from the caller's schedule + busy/slow-month intelligence. */
  @Get('from-schedule')
  @RequirePermissions(PERMISSIONS.PLANNING_VIEW)
  fromSchedule(@CurrentUser() user: AuthUser, @Query('fy') fy?: string) {
    return this.budget.fromSchedule(user, { fy });
  }

  /** Weekly fund request — line-item costed activities for CCEO/PL. */
  @Get('weekly')
  @RequirePermissions(PERMISSIONS.PLANNING_VIEW)
  weekly(@CurrentUser() user: AuthUser, @Query('fy') fy?: string, @Query('month') month?: string) {
    return this.budget.weekly(user, { fy, month: month ? Number(month) : undefined });
  }
}
