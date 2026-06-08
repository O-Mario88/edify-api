import { Module } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { ContributionService } from './contribution.service';
import { CorrelationService } from './correlation.service';
import { RecruitmentService } from './recruitment.service';
import { AnalyticsController } from './analytics.controller';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, ContributionService, CorrelationService, RecruitmentService],
})
export class AnalyticsModule {}
