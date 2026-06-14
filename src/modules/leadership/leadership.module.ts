import { Module } from '@nestjs/common';
import { LeadershipController } from './leadership.controller';
import { LeadershipService } from './leadership.service';
import { LeadershipEngineService } from './leadership-engine.service';
import { DataConfidenceService } from './data-confidence.service';
import { ContextFairnessService } from './context-fairness.service';
import { PartnerPerformanceService } from './partner-performance.service';

// Leadership Decision Engine — evidence + context + fairness + recommendation +
// human review. All dependencies (Prisma, ScopeService, AuditService) come from
// global modules, so no extra imports are needed.
@Module({
  controllers: [LeadershipController],
  providers: [
    LeadershipService,
    LeadershipEngineService,
    DataConfidenceService,
    ContextFairnessService,
    PartnerPerformanceService,
  ],
})
export class LeadershipModule {}
