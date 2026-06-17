import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { ContributionService } from './contribution.service';
import { CorrelationService } from './correlation.service';
import { RecruitmentService } from './recruitment.service';
import { ContributionQueryDto, ContributionDrilldownDto } from './dto/contribution-query.dto';
import { SsaPerformanceQueryDto, SsaDrilldownQueryDto, InterventionImprovementQueryDto, GeoFilterDto } from './dto/ssa-performance-query.dto';
import { CorrelationQueryDto } from './dto/correlation-query.dto';
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
    private readonly correlation: CorrelationService,
    private readonly recruitment: RecruitmentService,
  ) {}

  // Recruitment Intelligence — recruit-more vs focus-on-current advisory.
  // Gated on its own permission (CD/RVP/IA/PL/CCEO), NOT analytics-wide.
  @Get('recruitment-recommendation')
  @RequirePermissions(PERMISSIONS.RECRUITMENT_INTELLIGENCE_VIEW)
  recruitment2(@Query('fy') fy: string | undefined, @Query('districtId') districtId: string | undefined, @CurrentUser() u: AuthUser) {
    return this.recruitment.recommendation(u, { fy, districtId });
  }

  // The role-scoped summaries accept an OPTIONAL geography filter (region/district/
  // cluster) so a selected geography narrows EVERY part of the page — not just the
  // grouped tables. The filter only narrows within the caller's role scope.
  @Get('dashboard') dashboard(@Query() g: GeoFilterDto, @CurrentUser() u: AuthUser) { return this.analytics.dashboardSummary(u, g); }
  @Get('leadership-summary') leadershipSummary(@Query() g: GeoFilterDto, @CurrentUser() u: AuthUser) { return this.analytics.leadershipSummary(u, g); }
  @Get('districts') districts(@Query() g: GeoFilterDto, @CurrentUser() u: AuthUser) { return this.analytics.districtRollups(u, g); }
  @Get('coverage') coverage(@Query() g: GeoFilterDto, @CurrentUser() u: AuthUser) { return this.analytics.coverageSummary(u, g); }
  @Get('school-directory') directory(@Query() g: GeoFilterDto, @CurrentUser() u: AuthUser) { return this.analytics.schoolDirectorySummary(u, g); }
  @Get('ssa-performance') ssa(@Query() g: GeoFilterDto, @CurrentUser() u: AuthUser) { return this.analytics.ssaPerformance(u, g); }

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

  // Layer 3 — Support-to-Improvement. Only verified support BEFORE the SSA
  // date counts (timing rule). Associations, never causal claims.
  @Get('support-before-ssa')
  supportBeforeSsa(@Query() q: CorrelationQueryDto, @CurrentUser() u: AuthUser) {
    return this.correlation.supportBeforeSsa(u, q);
  }

  @Get('support-ssa-correlation')
  supportCorrelation(@Query() q: CorrelationQueryDto, @CurrentUser() u: AuthUser) {
    return this.correlation.supportSsaCorrelation(u, q);
  }

  @Get('staff-vs-partner-correlation')
  staffVsPartner(@Query() q: CorrelationQueryDto, @CurrentUser() u: AuthUser) {
    return this.correlation.staffVsPartner(u, q);
  }
  @Get('activity-pipeline') pipeline(@Query() g: GeoFilterDto, @CurrentUser() u: AuthUser) { return this.analytics.activityPipeline(u, g); }

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
