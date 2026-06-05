import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { AuthModule } from './modules/auth/auth.module';
import { GeographyModule } from './modules/geography/geography.module';
import { SchoolsModule } from './modules/schools/schools.module';
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
    SystemHealthModule,
    // Roadmap modules (scaffolded next): users, staff, clusters, ssa, planning,
    // activities, evidence, salesforce-verification, payments, annual-plan-budget,
    // special-projects, partners, messages, notifications, analytics, reports.
  ],
  controllers: [HealthController],
})
export class AppModule {}
