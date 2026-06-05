import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/rbac/permissions.guard';
import { RequirePermissions } from '../../common/rbac/require-permissions.decorator';
import { PERMISSIONS } from '../../common/rbac/permissions';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthUser } from '../../common/auth/auth-user';

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.ANALYTICS_VIEW)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('dashboard') dashboard(@CurrentUser() u: AuthUser) { return this.analytics.dashboardSummary(u); }
  @Get('school-directory') directory(@CurrentUser() u: AuthUser) { return this.analytics.schoolDirectorySummary(u); }
  @Get('ssa-performance') ssa(@CurrentUser() u: AuthUser) { return this.analytics.ssaPerformance(u); }
  @Get('activity-pipeline') pipeline(@CurrentUser() u: AuthUser) { return this.analytics.activityPipeline(u); }
}
