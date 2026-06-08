import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { ContributionService } from './contribution.service';
import { ContributionQueryDto, ContributionDrilldownDto } from './dto/contribution-query.dto';
import { SsaPerformanceQueryDto, SsaDrilldownQueryDto, InterventionImprovementQueryDto } from './dto/ssa-performance-query.dto';
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
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly contribution: ContributionService,
  ) {}

  @Get('dashboard') dashboard(@CurrentUser() u: AuthUser) { return this.analytics.dashboardSummary(u); }
  @Get('school-directory') directory(@CurrentUser() u: AuthUser) { return this.analytics.schoolDirectorySummary(u); }
  @Get('ssa-performance') ssa(@CurrentUser() u: AuthUser) { return this.analytics.ssaPerformance(u); }

  // SSA Performance = the average of EACH of the 8 interventions per group
  // (region|district|subCounty|cluster|cceo), Client+Core by default. Drillable.
  @Get('ssa-performance-grouped')
  ssaGrouped(@Query() q: SsaPerformanceQueryDto, @CurrentUser() u: AuthUser) {
    return this.analytics.ssaPerformanceByGroup(u, q);
  }

  @Get('ssa-performance-grouped/drilldown')
  ssaGroupedDrilldown(@Query() q: SsaDrilldownQueryDto, @CurrentUser() u: AuthUser) {
    return this.analytics.ssaPerformanceDrilldown(u, q);
  }

  // Impact: previous-FY vs current-FY change per intervention, per group.
  @Get('intervention-improvement')
  interventionImprovement(@Query() q: InterventionImprovementQueryDto, @CurrentUser() u: AuthUser) {
    return this.analytics.interventionImprovement(u, q);
  }
  @Get('activity-pipeline') pipeline(@CurrentUser() u: AuthUser) { return this.analytics.activityPipeline(u); }

  // Scope-aware contribution ("how much am I contributing?"). lens = own|team|combined.
  @Get('contribution-summary')
  contributionSummary(@Query() q: ContributionQueryDto, @CurrentUser() u: AuthUser) {
    return this.contribution.summary(u, q.lens, q);
  }

  @Get('contribution-drilldown')
  contributionDrilldown(@Query() q: ContributionDrilldownDto, @CurrentUser() u: AuthUser) {
    return this.contribution.drilldown(u, q.metric, q.lens, q);
  }
}
