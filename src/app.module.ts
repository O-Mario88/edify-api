import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './modules/auth/auth.module';
import { GeographyModule } from './modules/geography/geography.module';
import { SchoolsModule } from './modules/schools/schools.module';
import { ClustersModule } from './modules/clusters/clusters.module';
import { SsaModule } from './modules/ssa/ssa.module';
import { ActivitiesModule } from './modules/activities/activities.module';
import { PlanningModule } from './modules/planning/planning.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { FiltersModule } from './modules/filters/filters.module';
import { SearchModule } from './modules/search/search.module';
import { MessagesModule } from './modules/messages/messages.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SystemHealthModule } from './modules/system-health/system-health.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    CommonModule,
    AuthModule,
    GeographyModule,
    SchoolsModule,
    ClustersModule,
    SsaModule,
    ActivitiesModule,
    PlanningModule,
    AnalyticsModule,
    FiltersModule,
    SearchModule,
    MessagesModule,
    NotificationsModule,
    SystemHealthModule,
    // Roadmap modules (scaffolded next): users/staff, planning, evidence,
    // salesforce-verification, payments, annual-plan-budget, special-projects,
    // partners, messages, notifications, reports.
  ],
  controllers: [HealthController],
})
export class AppModule {}
