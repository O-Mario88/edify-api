import { Module } from '@nestjs/common';
import { BudgetIntelligenceController } from './budget-intelligence.controller';
import { BudgetIntelligenceService } from './budget-intelligence.service';

// Budget Intelligence & Financial Decision Engine. All dependencies (Prisma,
// AuditService) come from global modules, so no extra imports are needed.
@Module({
  controllers: [BudgetIntelligenceController],
  providers: [BudgetIntelligenceService],
})
export class BudgetIntelligenceModule {}
