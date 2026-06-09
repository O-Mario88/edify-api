import { Module } from '@nestjs/common';
import { FundRequestsService } from './fund-requests.service';
import { FundRequestsController } from './fund-requests.controller';
import { BudgetModule } from '../budget/budget.module';

@Module({
  imports: [BudgetModule], // reuse the budget engine to cost the period
  controllers: [FundRequestsController],
  providers: [FundRequestsService],
})
export class FundRequestsModule {}
