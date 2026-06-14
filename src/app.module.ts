import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { RealtimeModule } from './common/realtime/realtime.module';
import { AuthModule } from './modules/auth/auth.module';
import { GeographyModule } from './modules/geography/geography.module';
import { SchoolsModule } from './modules/schools/schools.module';
import { ClustersModule } from './modules/clusters/clusters.module';
import { SsaModule } from './modules/ssa/ssa.module';
import { ActivitiesModule } from './modules/activities/activities.module';
import { AssignmentModule } from './modules/assignment/assignment.module';
import { TargetsModule } from './modules/targets/targets.module';
import { PlanningModule } from './modules/planning/planning.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { FiltersModule } from './modules/filters/filters.module';
import { SearchModule } from './modules/search/search.module';
import { MessagesModule } from './modules/messages/messages.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { DebriefsModule } from './modules/debriefs/debriefs.module';
import { SpecialProjectsModule } from './modules/special-projects/special-projects.module';
import { BudgetModule } from './modules/budget/budget.module';
import { CommandCenterModule } from './modules/command-center/command-center.module';
import { EvidenceModule } from './modules/evidence/evidence.module';
import { PartnersModule } from './modules/partners/partners.module';
import { FundRequestsModule } from './modules/fund-requests/fund-requests.module';
import { SystemHealthModule } from './modules/system-health/system-health.module';
import { ReportsModule } from './modules/reports/reports.module';
import { HrModule } from './modules/hr/hr.module';
import { SecurityModule } from './modules/security/security.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    CommonModule,
    RealtimeModule,
    AuthModule,
    GeographyModule,
    SchoolsModule,
    ClustersModule,
    SsaModule,
    ActivitiesModule,
    AssignmentModule,
    TargetsModule,
    PlanningModule,
    AnalyticsModule,
    FiltersModule,
    SearchModule,
    MessagesModule,
    NotificationsModule,
    DebriefsModule,
    SpecialProjectsModule,
    BudgetModule,
    CommandCenterModule,
    EvidenceModule,
    FundRequestsModule,
    PartnersModule,
    SystemHealthModule,
    ReportsModule,
    HrModule,
    SecurityModule,
    // Roadmap modules (scaffolded next): users/staff, planning, evidence,
    // salesforce-verification, payments, annual-plan-budget, special-projects,
    // partners, messages, notifications, reports.
  ],
  controllers: [HealthController],
})
export class AppModule {}
